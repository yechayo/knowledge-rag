/**
 * MCP 工具定义
 * 业务逻辑以 Agent 工具为准，MCP 层仅做格式适配
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, vectorToPostgresFormat } from '@/lib/embedding';
import { indexContent } from '@/lib/content-indexer';

function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9一-鿿-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function ensureUniqueSlug(slug: string): Promise<string> {
  const existing = await prisma.content.findUnique({ where: { slug } });
  if (!existing) return slug;
  return `${slug}-${Date.now()}`;
}

/**
 * 手动发布内容（用于 publish_content 工具）
 */
async function publishContent(contentId: string) {
  const content = await prisma.content.findUnique({ where: { id: contentId } });
  if (!content || !content.body?.trim()) {
    throw new Error('Content not found or body is empty');
  }

  const stats = await indexContent(content);

  await prisma.content.update({
    where: { id: contentId },
    data: { status: 'published' },
  });

  return stats;
}

export function registerTools(server: McpServer): void {

  // ── list_content ──
  server.tool(
    'list_content',
    '查询内容列表。不传 category 则返回所有分类。',
    {
      category: z.string().optional().describe('内容分类，不传则返回所有'),
      status: z.string().optional().describe('状态过滤：draft / published'),
      limit: z.coerce.number().optional().describe('返回数量，默认 100'),
    },
    async ({ category, status, limit }) => {
      const where: Record<string, string> = {};
      if (category && category.trim()) where.category = category;
      if (status) where.status = status;

      const contents = await prisma.content.findMany({
        where,
        select: {
          id: true, title: true, slug: true, category: true,
          status: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit || 100, 100),
      });

      const items = contents.map((c) => ({
        ...c,
        link: `/${c.category}/${c.slug}`,
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }],
      };
    },
  );

  // ── get_content ──
  server.tool(
    'get_content',
    '根据 ID 或 slug 获取单篇内容的完整详情（含正文）',
    {
      id: z.string().describe('内容的 ID 或 slug'),
    },
    async ({ id }) => {
      const content = await prisma.content.findFirst({
        where: { OR: [{ id }, { slug: id }] },
      });

      if (!content) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Content not found' }) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(content, null, 2) }],
      };
    },
  );

  // ── create_content ──
  server.tool(
    'create_content',
    '创建新内容。使用 upsert 避免 slug 冲突，自动发布并生成向量索引。',
    {
      title: z.string().describe('内容标题'),
      body: z.string().describe('正文（Markdown 格式）'),
      category: z.string().describe('分类：article / project / note / page / link / slogan'),
      slug: z.string().optional().describe('URL slug，不提供则从标题自动生成'),
      status: z.string().optional().describe('状态：draft 或 published，默认 published'),
    },
    async ({ title, body, category, slug: inputSlug, status }) => {
      if (!title || !body || !category) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: '缺少必要参数', provided: { title: !!title, body: !!body, category: !!category },
          }) }],
          isError: true,
        };
      }

      const baseSlug = inputSlug || titleToSlug(title) || title.replace(/\s+/g, '-').replace(/[\/\\#?&]/g, '').slice(0, 80) || `content-${Date.now()}`;
      if (!baseSlug) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'slug 生成为空，请检查标题' }) }],
          isError: true,
        };
      }
      const finalSlug = await ensureUniqueSlug(baseSlug);
      const finalStatus = status || 'published';

      const content = await prisma.content.upsert({
        where: { slug: finalSlug },
        update: { title, body, category, status: finalStatus },
        create: { title, body, category, slug: finalSlug, status: finalStatus },
      });

      if (finalStatus !== 'published') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ message: 'Content created (draft)', content }, null, 2) }],
        };
      }

      try {
        const stats = await indexContent(content);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            message: 'Content created, published and indexed',
            content: { id: content.id, title: content.title, slug: content.slug, category: content.category },
            indexStats: stats,
          }, null, 2) }],
        };
      } catch (err) {
        await prisma.content.update({ where: { id: content.id }, data: { status: 'draft' } });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            message: 'Content created but indexing failed, reverted to draft',
            error: err instanceof Error ? err.message : String(err),
          }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  // ── update_content ──
  server.tool(
    'update_content',
    '更新已有内容。仅更新传入字段，已发布内容更新后自动重建索引。',
    {
      id: z.string().describe('要更新的内容 ID'),
      title: z.string().optional().describe('新标题'),
      body: z.string().optional().describe('新正文（Markdown）'),
      category: z.string().optional().describe('新分类'),
      slug: z.string().optional().describe('新 URL slug'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('新元数据'),
      status: z.string().optional().describe('新状态：draft 或 published'),
    },
    async ({ id, title, body, category, slug, metadata, status }) => {
      const existing = await prisma.content.findUnique({ where: { id } });
      if (!existing) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: '内容不存在' }) }],
          isError: true,
        };
      }

      const updateData: Record<string, unknown> = {};
      if (title !== undefined) updateData.title = title;
      if (body !== undefined) updateData.body = body;
      if (category !== undefined) updateData.category = category;
      if (status !== undefined) updateData.status = status;
      if (metadata !== undefined) updateData.metadata = metadata;

      if (slug !== undefined && slug !== existing.slug) {
        const conflict = await prisma.content.findUnique({ where: { slug } });
        if (conflict) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Slug 已被占用' }) }],
            isError: true,
          };
        }
        updateData.slug = slug;
      }

      if (Object.keys(updateData).length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No fields to update' }) }],
          isError: true,
        };
      }

      const updated = await prisma.content.update({ where: { id }, data: updateData });

      // 如果从 published 变为非 published，清理向量块
      if (existing.status === 'published' && updated.status !== 'published') {
        await prisma.$transaction(async (tx) => {
          await tx.chunk.deleteMany({ where: { contentId: id } });
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            message: 'Content updated, index cleared',
            content: { id: updated.id, title: updated.title, status: updated.status },
            indexCleared: true,
          }, null, 2) }],
        };
      }

      // 内容变更且状态为 published，重建索引
      const needsReindex = (title !== undefined || body !== undefined || category !== undefined || slug !== undefined || metadata !== undefined || status === 'published');
      if (updated.status === 'published' && needsReindex) {
        try {
          const stats = await indexContent(updated);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              message: 'Content updated and re-indexed',
              content: { id: updated.id, title: updated.title, slug: updated.slug },
              indexStats: stats,
            }, null, 2) }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({
              message: 'Content updated but re-indexing failed',
              error: err instanceof Error ? err.message : String(err),
            }, null, 2) }],
            isError: true,
          };
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ message: 'Content updated', content: updated }, null, 2) }],
      };
    },
  );

  // ── delete_content ──
  server.tool(
    'delete_content',
    '删除内容及其关联的所有向量块（不可恢复）',
    {
      id: z.string().describe('要删除的内容 ID'),
    },
    async ({ id }) => {
      const content = await prisma.content.findUnique({
        where: { id },
        include: { chunks: { select: { id: true } } },
      });

      if (!content) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Content not found' }) }],
          isError: true,
        };
      }

      await prisma.$transaction([
        prisma.chunk.deleteMany({ where: { contentId: id } }),
        prisma.content.delete({ where: { id } }),
      ]);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          message: 'Content deleted',
          deleted: { id: content.id, title: content.title, chunksDeleted: content.chunks.length },
        }, null, 2) }],
      };
    },
  );

  // ── publish_content ──
  server.tool(
    'publish_content',
    '手动发布草稿内容并生成向量嵌入索引。',
    {
      id: z.string().describe('要发布的内容 ID'),
    },
    async ({ id }) => {
      try {
        const stats = await publishContent(id);
        const content = await prisma.content.findUnique({ where: { id } });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            message: 'Content published and indexed',
            content: { id: content!.id, title: content!.title, status: content!.status },
            indexStats: stats,
          }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({
            error: 'Failed to publish',
            details: err instanceof Error ? err.message : String(err),
          }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  // ── search_content ──
  server.tool(
    'search_content',
    '对已发布内容进行 RAG 语义搜索。输入自然语言查询，返回最相关的文本片段及来源。',
    {
      query: z.string().describe('自然语言搜索查询'),
      topK: z.number().int().min(1).max(20).optional().describe('返回结果数量，默认 5'),
    },
    async ({ query, topK }) => {
      const k = Math.min(Math.max(1, topK || 5), 20);
      const embedding = await generateEmbedding(query);
      const embeddingStr = vectorToPostgresFormat(embedding);

      const results = await prisma.$queryRaw<Array<{
        id: string; contentId: string; title: string; slug: string;
        category: string; content: string; score: number;
      }>>`
        SELECT
          c.id, c."contentId", co.title, co.slug, co.category, c.content,
          1 - (c.embedding <=> ${embeddingStr}::vector(256)) AS score
        FROM "Chunk" c
        JOIN "Content" co ON c."contentId" = co.id
        WHERE co.status = 'published' AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${embeddingStr}::vector(256) ASC
        LIMIT ${k}
      `;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({
          results: results.map((r) => ({
            chunkId: r.id, contentId: r.contentId, title: r.title,
            slug: r.slug, category: r.category, content: r.content, score: r.score,
          })),
        }, null, 2) }],
      };
    },
  );

  // ── get_site_config ──
  server.tool(
    'get_site_config',
    '获取站点的全局配置信息。',
    {},
    async () => {
      const configs = await prisma.siteConfig.findMany({
        select: { key: true, value: true },
      });
      const map: Record<string, string> = {};
      for (const c of configs) map[c.key] = c.value;
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(map, null, 2) }],
      };
    },
  );
}
