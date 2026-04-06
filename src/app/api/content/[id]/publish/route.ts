import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateEmbeddings, vectorToPostgresFormat } from '@/lib/embedding';
import { randomUUID } from 'crypto';

/**
 * Markdown 感知的文本分块器
 * 按标题分割，然后按 ~500 字符边界切分，支持重叠
 */
function chunkMarkdown(text: string, chunkSize = 500, overlap = 100): string[] {
  const chunks: string[] = [];
  // 按标题（#、##、###）分割
  const sections = text.split(/(?=#{1,3}\s)/);

  let buffer = '';
  for (const section of sections) {
    if (!section.trim()) continue;
    if (buffer.length + section.length > chunkSize && buffer) {
      chunks.push(buffer.trim());
      // 保留重叠部分
      buffer = buffer.slice(-overlap) + section;
    } else {
      buffer += section;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

/**
 * 生成内容的简单哈希（用于去重）
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

    // 1. 将 Markdown 正文分块
    const chunkTexts = chunkMarkdown(content.body);
    if (chunkTexts.length === 0) {
      return NextResponse.json({ error: 'No valid chunks generated from body' }, { status: 400 });
    }

    // 2. 批量生成 embedding
    const embeddings = await generateEmbeddings(chunkTexts);

    // 3. 使用事务：删除旧 chunks + 插入新 chunks
    await prisma.$transaction(async (tx) => {
      // 删除该内容的所有旧 chunks
      await tx.chunk.deleteMany({
        where: { contentId: id },
      });

      // 逐条插入新 chunks（使用 Raw SQL 支持 vector 类型）
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

    // 4. 更新内容状态为 published
    const published = await prisma.content.update({
      where: { id },
      data: { status: 'published' },
    });

    return NextResponse.json({
      message: 'Content published and indexed successfully',
      content: published,
      stats: {
        totalChunks: chunkTexts.length,
      },
    });
  } catch (error) {
    console.error('Failed to publish content:', error);
    return NextResponse.json(
      { error: 'Failed to publish content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
