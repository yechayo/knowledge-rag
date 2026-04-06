/**
 * MCP 工具定义
 * 为 yechayo 提供 CRUD 和搜索能力
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, generateEmbeddings, vectorToPostgresFormat } from '@/lib/embedding';
import { randomUUID } from 'crypto';

// 内容分类枚举
const CONTENT_CATEGORIES = ['article', 'project', 'note', 'page', 'link', 'slogan'] as const;
const CONTENT_STATUSES = ['draft', 'published'] as const;

/**
 * 中文标题转 URL 安全的 slug（复用 content route 逻辑）
 */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 确保 slug 唯一
 */
async function ensureUniqueSlug(slug: string): Promise<string> {
  const existing = await prisma.content.findUnique({ where: { slug } });
  if (!existing) return slug;
  return `${slug}-${Date.now()}`;
}

/**
 * Markdown 感知的文本分块器（复用 publish route 逻辑）
 */
function chunkMarkdown(text: string, chunkSize = 500, overlap = 100): string[] {
  const chunks: string[] = [];
  const sections = text.split(/(?=#{1,3}\s)/);

  let buffer = '';
  for (const section of sections) {
    if (!section.trim()) continue;
    if (buffer.length + section.length > chunkSize && buffer) {
      chunks.push(buffer.trim());
      buffer = buffer.slice(-overlap) + section;
    } else {
      buffer += section;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

/**
 * 生成内容哈希（复用 publish route 逻辑）
 */
function generateContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * 注册所有 MCP 工具
 */
export function registerTools(server: McpServer): void {

  // ──────────────────────────────────────────────
  // list_content - 查询内容列表
  // ──────────────────────────────────────────────
  server.tool(
    'list_content',
    '查询内容列表，支持按分类、状态、标签筛选和分页',
    {
      category: z.enum(CONTENT_CATEGORIES).optional().describe('内容分类: article/project/note/page/link/slogan'),
      status: z.enum(CONTENT_STATUSES).optional().describe('内容状态: draft/published，默认 published'),
      page: z.number().int().min(1).optional().describe('页码，默认 1'),
      limit: z.number().int().min(1).max(100).optional().describe('每页数量，默认 12'),
      tag: z.string().optional().describe('按标签筛选'),
    },
    async ({ category, status, page, limit, tag }) => {
      const where: any = {};
      if (category) where.category = category;
      if (status) where.status = status;
      if (tag) {
        where.metadata = { path: ['tags'], array_contains: [tag] };
      }

      const p = page || 1;
      const l = Math.min(limit || 12, 100);

      const [items, total] = await Promise.all([
        prisma.content.findMany({
          where,
          select: {
            id: true, title: true, slug: true, category: true,
            metadata: true, status: true, viewCount: true, createdAt: true, updatedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip: (p - 1) * l,
          take: l,
        }),
        prisma.content.count({ where }),
      ]);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ items, total, page: p, totalPages: Math.ceil(total / l) }, null, 2),
        }],
      };
    },
  );

  // ──────────────────────────────────────────────
  // get_content - 获取单篇内容
  // ──────────────────────────────────────────────
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

  // ──────────────────────────────────────────────
  // create_content - 创建内容
  // ──────────────────────────────────────────────
  server.tool(
    'create_content',
    '创建新内容。创建后状态为 draft，需要调用 publish_content 发布后才会生成向量索引。',
    {
      title: z.string().describe('内容标题'),
      body: z.string().describe('Markdown 格式的正文内容'),
      category: z.enum(CONTENT_CATEGORIES).describe('内容分类'),
      slug: z.string().optional().describe('URL 友好的别名，不提供则从标题自动生成'),
      metadata: z.record(z.string(), z.any()).optional().describe('分类特定的元数据，如 tags、cover、url 等'),
      status: z.enum(CONTENT_STATUSES).optional().describe('初始状态，默认 draft'),
    },
    async ({ title, body, category, slug: inputSlug, metadata, status }) => {
      let slug = inputSlug || titleToSlug(title);
      slug = await ensureUniqueSlug(slug);

      const content = await prisma.content.create({
        data: {
          title,
          slug,
          body,
          category,
          metadata: metadata ?? {},
          status: status || 'draft',
        },
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Content created', content }, null, 2),
        }],
      };
    },
  );

  // ──────────────────────────────────────────────
  // update_content - 更新内容
  // ──────────────────────────────────────────────
  server.tool(
    'update_content',
    '更新已有内容。仅更新传入的字段，未传入的字段保持不变。更新后如需重新生成向量索引，请调用 publish_content。',
    {
      id: z.string().describe('内容的 ID'),
      title: z.string().optional().describe('新标题'),
      body: z.string().optional().describe('新正文（Markdown）'),
      category: z.enum(CONTENT_CATEGORIES).optional().describe('新分类'),
      metadata: z.record(z.string(), z.any()).optional().describe('新元数据'),
      status: z.enum(CONTENT_STATUSES).optional().describe('新状态'),
    },
    async ({ id, title, body, category, metadata, status }) => {
      const existing = await prisma.content.findUnique({ where: { id } });
      if (!existing) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Content not found' }) }],
          isError: true,
        };
      }

      const updateData: any = {};
      if (title !== undefined) updateData.title = title;
      if (body !== undefined) updateData.body = body;
      if (category !== undefined) updateData.category = category;
      if (metadata !== undefined) updateData.metadata = metadata;
      if (status !== undefined) updateData.status = status;

      if (Object.keys(updateData).length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No fields to update' }) }],
          isError: true,
        };
      }

      const updated = await prisma.content.update({ where: { id }, data: updateData });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Content updated', content: updated }, null, 2),
        }],
      };
    },
  );

  // ──────────────────────────────────────────────
  // delete_content - 删除内容
  // ──────────────────────────────────────────────
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

      await prisma.content.delete({ where: { id } });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: 'Content deleted',
            deletedContent: {
              id: content.id,
              title: content.title,
              chunksDeleted: content.chunks.length,
            },
          }, null, 2),
        }],
      };
    },
  );

  // ──────────────────────────────────────────────
  // publish_content - 发布并生成向量索引
  // ──────────────────────────────────────────────
  server.tool(
    'publish_content',
    '发布内容并自动生成向量嵌入索引。将 Markdown 正文分块后调用 Embedding API，写入 pgvector。发布后内容状态变为 published。',
    {
      id: z.string().describe('要发布的内容 ID'),
    },
    async ({ id }) => {
      const content = await prisma.content.findUnique({ where: { id } });

      if (!content) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Content not found' }) }],
          isError: true,
        };
      }

      if (!content.body || content.body.trim().length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Content body is empty' }) }],
          isError: true,
        };
      }

      // 1. 分块
      const chunkTexts = chunkMarkdown(content.body);
      if (chunkTexts.length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No valid chunks generated' }) }],
          isError: true,
        };
      }

      // 2. 生成 embedding
      const embeddings = await generateEmbeddings(chunkTexts);

      // 3. 事务：删除旧 chunks + 插入新 chunks
      await prisma.$transaction(async (tx) => {
        await tx.chunk.deleteMany({ where: { contentId: id } });
        for (let i = 0; i < chunkTexts.length; i++) {
          const chunkId = randomUUID();
          await tx.$queryRaw`
            INSERT INTO "Chunk" (
              id, content, "contentHash", embedding, "contentId", "createdAt"
            ) VALUES (
              ${chunkId},
              ${chunkTexts[i]},
              ${generateContentHash(chunkTexts[i])},
              ${vectorToPostgresFormat(embeddings[i])}::vector(256),
              ${id},
              DEFAULT
            )
          `;
        }
      }, {
        maxWait: 10000,
        timeout: 120000,
      });

      // 4. 更新状态
      const published = await prisma.content.update({
        where: { id },
        data: { status: 'published' },
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: 'Content published and indexed',
            content: published,
            stats: { totalChunks: chunkTexts.length },
          }, null, 2),
        }],
      };
    },
  );

  // ──────────────────────────────────────────────
  // search_content - RAG 语义搜索
  // ──────────────────────────────────────────────
  server.tool(
    'search_content',
    '对已发布内容进行语义搜索。输入自然语言查询，返回最相关的文本片段及其来源文章信息。',
    {
      query: z.string().describe('自然语言搜索查询'),
      topK: z.number().int().min(1).max(20).optional().describe('返回结果数量，默认 5'),
    },
    async ({ query, topK }) => {
      const validTopK = Math.min(Math.max(1, topK || 5), 20);
      const queryEmbedding = await generateEmbedding(query);
      const embeddingStr = vectorToPostgresFormat(queryEmbedding);

      const results = await prisma.$queryRaw<Array<{
        id: string;
        contentId: string;
        title: string;
        slug: string;
        category: string;
        content: string;
        score: number;
      }>>`
        SELECT
          c.id,
          c."contentId",
          co.title,
          co.slug,
          co.category,
          c.content,
          1 - (c.embedding <=> ${embeddingStr}::vector(256)) AS score
        FROM "Chunk" c
        JOIN "Content" co ON c."contentId" = co.id
        WHERE co.status = 'published'
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> ${embeddingStr}::vector(256) ASC
        LIMIT ${validTopK}
      `;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            results: results.map((r) => ({
              chunkId: r.id,
              contentId: r.contentId,
              title: r.title,
              slug: r.slug,
              category: r.category,
              content: r.content,
              score: r.score,
            })),
          }, null, 2),
        }],
      };
    },
  );

  // ──────────────────────────────────────────────
  // get_site_config - 获取站点配置
  // ──────────────────────────────────────────────
  server.tool(
    'get_site_config',
    '获取站点的全局配置信息（如站点名称、描述等）',
    {},
    async () => {
      const configs = await prisma.siteConfig.findMany({
        select: { key: true, value: true },
      });

      const configMap: Record<string, string> = {};
      for (const config of configs) {
        configMap[config.key] = config.value;
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(configMap, null, 2) }],
      };
    },
  );
}
