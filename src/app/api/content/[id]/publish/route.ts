import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateEmbeddings, vectorToPostgresFormat } from '@/lib/embedding';
import { generateContentChunks, generateContentHash } from '@/lib/chunkGenerator';
import { describeImage } from '@/lib/vision';
import { buildImageDataUrl } from '@/lib/oss';
import { randomUUID } from 'crypto';

// POST /api/content/[id]/publish - 发布内容并生成向量索引（仅管理员）
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    // 查找内容
    const content = await prisma.content.findUnique({
      where: { id },
    });

    if (!content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    if (!content.body || content.body.trim().length === 0) {
      return NextResponse.json({ error: 'Content body is empty' }, { status: 400 });
    }

    // 1. 使用新的分块生成器生成所有类型的分块
    const chunks = generateContentChunks(content.body, {
      id: content.id,
      title: content.title,
      slug: content.slug,
      category: content.category,
      metadata: (content.metadata as Record<string, unknown>) || {},
    });

    if (chunks.length === 0) {
      return NextResponse.json({ error: 'No valid chunks generated from body' }, { status: 400 });
    }

    // 1.5 提取所有图片 ID，从数据库读取 BYTEA 转为 base64，用视觉模型生成描述
    const imageUrlRegex = /\/api\/images\/([a-z0-9]+)/g;
    const imageIds = new Set<string>();

    // 从正文提取
    const bodyMatches = content.body.matchAll(imageUrlRegex);
    for (const m of bodyMatches) imageIds.add(m[1]);

    // 从封面图提取
    const metadata = (content.metadata as Record<string, unknown>) || {};
    const coverImage = metadata.coverImage as string | undefined;
    if (coverImage) {
      const coverMatch = coverImage.match(imageUrlRegex);
      if (coverMatch) imageIds.add(coverMatch[1]);
    }

    // 为每张图片生成描述 chunk
    const imageDescriptionChunks: typeof chunks = [];
    const failedImages: string[] = [];
    for (const imageId of imageIds) {
      try {
        const image = await prisma.image.findUnique({ where: { id: imageId } });
        if (!image) {
          failedImages.push(imageId);
          continue;
        }

        const dataUrl = await buildImageDataUrl(image);
        if (!dataUrl) {
          failedImages.push(`${imageId}(image file not found)`);
          continue;
        }

        const description = await describeImage(dataUrl);
        console.log(`[Vision] 图片 ${imageId} 描述: ${description}`);
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
        console.error(`[Vision] 图片 ${imageId} 描述生成失败:`, msg);
        failedImages.push(`${imageId}(${msg})`);
      }
    }

    const allChunks = [...chunks, ...imageDescriptionChunks];
    const chunkTexts = allChunks.map(c => c.content);
    const embeddings = await generateEmbeddings(chunkTexts);

    // 3. 使用事务：删除旧 chunks + 插入新 chunks
    await prisma.$transaction(async (tx) => {
      // 删除该内容的所有旧 chunks
      await tx.chunk.deleteMany({
        where: { contentId: id },
      });

      // 逐条插入新 chunks（使用 Raw SQL 支持 vector 类型）
      for (let i = 0; i < allChunks.length; i++) {
        const chunkId = randomUUID();
        const chunk = allChunks[i];
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
            ${id},
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
    }, {
      maxWait: 10000,
      timeout: 120000,
    });

    // 4. 更新内容状态为 published
    const published = await prisma.content.update({
      where: { id },
      data: { status: 'published' },
    });

    // 按类型统计分块数量
    const stats = {
      totalChunks: allChunks.length,
      contentBody: allChunks.filter(c => c.chunkType === 'content_body').length,
      contentMeta: allChunks.filter(c => c.chunkType === 'content_meta').length,
      tocEntry: allChunks.filter(c => c.chunkType === 'toc_entry').length,
      imageDescriptions: imageDescriptionChunks.length,
    };

    return NextResponse.json({
      message: 'Content published and indexed successfully',
      content: published,
      stats,
      ...(failedImages.length > 0 ? {
        warnings: {
          visionFailedImages: failedImages,
        },
      } : {}),
    });
  } catch (error) {
    console.error('Failed to publish content:', error);
    return NextResponse.json(
      { error: 'Failed to publish content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
