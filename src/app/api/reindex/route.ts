import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateEmbeddings, vectorToPostgresFormat } from '@/lib/embedding';
import { generateContentChunks, generateContentHash } from '@/lib/chunkGenerator';
import { generateSiteStructureChunks } from '@/lib/siteIndexer';
import { describeImage } from '@/lib/vision';
import { buildImageDataUrl } from '@/lib/oss';
import type { GeneratedChunk } from '@/lib/chunkGenerator';
import { randomUUID } from 'crypto';

/**
 * 等待指定毫秒数
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 将分块数组写入数据库（使用 Raw SQL 支持 vector 类型）
 */
async function insertChunks(
  tx: any,
  chunks: GeneratedChunk[],
  embeddings: number[][],
  contentId: string,
) {
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = randomUUID();
    const chunk = chunks[i];
    await tx.$queryRaw`
      INSERT INTO "Chunk" (
        id, content, "contentHash", embedding, "contentId", "createdAt",
        "chunkType", "headingLevel", "headingAnchor", "headingText",
        "sourceTitle", "sourceSlug", "sourceCategory", "sourceTags", "sectionPath"
      ) VALUES (
        ${chunkId},
        ${chunk.content},
        ${generateContentHash(chunk.content)},
        ${vectorToPostgresFormat(embeddings[i])}::vector(256),
        ${contentId},
        DEFAULT,
        ${chunk.chunkType},
        ${chunk.headingLevel ?? null},
        ${chunk.headingAnchor ?? null},
        ${chunk.headingText ?? null},
        ${chunk.sourceTitle ?? null},
        ${chunk.sourceSlug ?? null},
        ${chunk.sourceCategory ?? null},
        ${JSON.stringify(chunk.sourceTags ?? [])}::jsonb,
        ${chunk.sectionPath ?? null}
      )
    `;
  }
}

// POST /api/reindex - 重建所有已发布内容的索引（仅管理员）
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. 获取所有已发布内容
    const allContent = await prisma.content.findMany({
      where: { status: 'published' },
    });

    if (allContent.length === 0) {
      return NextResponse.json({
        message: 'No published content found, nothing to reindex',
        stats: { totalContents: 0, totalChunks: 0, navStructureChunks: 0 },
      });
    }

    // 2. 读取分类配置
    const categoryConfig = await prisma.siteConfig.findUnique({ where: { key: 'siteCategories' } });
    let categoryLabelMap: Record<string, string> = {};
    if (categoryConfig) {
      try {
        const cats = JSON.parse(categoryConfig.value) as { key: string; label: string }[];
        for (const c of cats) categoryLabelMap[c.key] = c.label;
      } catch { /* ignore */ }
    }

    // 3. 删除所有现有分块
    await prisma.chunk.deleteMany({});

    // 3. 使用事务：重建所有内容的分块
    const result = await prisma.$transaction(async (tx) => {
      let totalChunks = 0;
      let totalImageDescriptions = 0;
      const reindexErrors: string[] = [];

      // 逐条处理每篇已发布内容，生成 content_body / content_meta / toc_entry 分块
      for (const content of allContent) {
        if (!content.body || content.body.trim().length === 0) continue;

        const chunks = generateContentChunks(content.body, {
          id: content.id,
          title: content.title,
          slug: content.slug,
          category: content.category,
          metadata: (content.metadata as Record<string, unknown>) || {},
        });

        // 提取图片并生成描述 chunks
        const imageUrlRegex = /\/api\/images\/([a-z0-9]+)/g;
        const imageIds = new Set<string>();
        const bodyMatches = content.body.matchAll(imageUrlRegex);
        for (const m of bodyMatches) imageIds.add(m[1]);
        const metadata = (content.metadata as Record<string, unknown>) || {};
        const coverImage = metadata.coverImage as string | undefined;
        if (coverImage) {
          const coverMatch = coverImage.match(imageUrlRegex);
          if (coverMatch) imageIds.add(coverMatch[1]);
        }

        const imageDescriptionChunks: GeneratedChunk[] = [];
        for (const imageId of imageIds) {
          try {
            const image = await prisma.image.findUnique({ where: { id: imageId } });
            if (!image) continue;

            const dataUrl = await buildImageDataUrl(image);
            if (!dataUrl) {
              reindexErrors.push(`图片${imageId}: image file not found`);
              continue;
            }

            const description = await describeImage(dataUrl);
            console.log(`[Reindex Vision] 图片 ${imageId} 描述: ${description}`);
            imageDescriptionChunks.push({
              content: `[图片描述] ${description}`,
              chunkType: 'content_body',
              sourceTitle: content.title,
              sourceSlug: content.slug,
              sourceCategory: content.category,
              sourceTags: ((content.metadata as Record<string, unknown>)?.tags as string[]) || [],
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Reindex Vision] 图片 ${imageId} 描述生成失败:`, msg);
            reindexErrors.push(`图片${imageId}: ${msg}`);
          }
        }

        const allChunks = [...chunks, ...imageDescriptionChunks];
        if (allChunks.length === 0) continue;

        // 生成 embedding
        const chunkTexts = allChunks.map(c => c.content);
        const embeddings = await generateEmbeddings(chunkTexts);

        // 写入数据库
        await insertChunks(tx, allChunks, embeddings, content.id);

        totalChunks += allChunks.length;
        totalImageDescriptions += imageDescriptionChunks.length;

        // 在批量之间添加延迟，避免触发 API 限速
        await sleep(100);
      }

      // 4. 生成 nav_structure 分块（整站导航结构）
      const siteContentItems = allContent.map(c => ({
        title: c.title,
        slug: c.slug,
        category: c.category,
        metadata: (c.metadata as Record<string, unknown>) || {},
      }));

      const navChunks = generateSiteStructureChunks(siteContentItems, categoryLabelMap);

      let navStructureChunks = 0;

      if (navChunks.length > 0) {
        // 注意：由于 Chunk 模型的 contentId 字段有外键约束（必须指向一条 Content 记录），
        // nav_structure 类型的分块无法独立存在。这里使用第一条已发布内容的 ID 作为
        // contentId 的值。这是一个数据库模型层面的限制，未来如果需要独立存储站点结构分块，
        // 需要将 contentId 改为可选字段或引入新的关联关系。
        const fallbackContentId = allContent[0].id;

        const navTexts = navChunks.map(c => c.content);
        const navEmbeddings = await generateEmbeddings(navTexts);

        await insertChunks(tx, navChunks, navEmbeddings, fallbackContentId);

        navStructureChunks = navChunks.length;
        totalChunks += navStructureChunks;
      }

      return { totalChunks, navStructureChunks, totalImageDescriptions, reindexErrors };
    }, {
      maxWait: 10000,
      timeout: 600000, // 10 分钟超时，因为可能处理大量内容
    });

    return NextResponse.json({
      message: 'Reindex completed successfully',
      stats: {
        totalContents: allContent.length,
        totalChunks: result.totalChunks,
        navStructureChunks: result.navStructureChunks,
        totalImageDescriptions: result.totalImageDescriptions,
      },
      ...(result.reindexErrors.length > 0 ? {
        warnings: {
          visionFailedImages: result.reindexErrors,
        },
      } : {}),
    });
  } catch (error) {
    console.error('Failed to reindex:', error);
    return NextResponse.json(
      { error: 'Failed to reindex', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
