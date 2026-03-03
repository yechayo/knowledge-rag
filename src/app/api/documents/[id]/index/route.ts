import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parsePDF } from '@/lib/pdf-parser';
import { chunkPages, generateContentHash } from '@/lib/chunker';
import { generateEmbeddings, vectorToPostgresFormat } from '@/lib/embedding';
import { stat } from 'fs/promises';
import { basename, isAbsolute, resolve } from 'path';
import { randomUUID } from 'crypto';
import { UPLOAD_DIR } from '@/lib/constants';

/**
 * 查找文件的实际路径（兼容历史路径/相对路径）
 */
async function findExistingFilePath(storagePath: string): Promise<string | null> {
  const fileName = basename(storagePath);
  const cwd = process.cwd();

  const candidates = [
    storagePath,
    isAbsolute(storagePath) ? null : resolve(cwd, storagePath),
    resolve(cwd, UPLOAD_DIR, fileName),
    resolve(cwd, 'uploads', fileName),
    resolve(cwd, '..', UPLOAD_DIR, fileName),
    resolve(cwd, '..', 'uploads', fileName),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

// POST /api/documents/[id]/index - 手动触发文档索引
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. 鉴权
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: docId } = await params;

  try {
    // 2. 查询文档并验证用户归属
    const document = await prisma.document.findUnique({
      where: {
        id: docId,
        userId: session.user.id,
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 3. 更新状态为 processing
    await prisma.document.update({
      where: { id: docId },
      data: {
        status: 'processing',
        error: null,
      },
    });

    // 4. 查找文件路径
    const resolvedPath = await findExistingFilePath(document.storagePath);
    if (!resolvedPath) {
      await prisma.document.update({
        where: { id: docId },
        data: {
          status: 'error',
          error: 'File not found on disk',
        },
      });
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    // 5. 解析 PDF
    const parseResult = await parsePDF(resolvedPath);

    // 6. 生成分块
    const chunks = chunkPages(parseResult.pages);

    // 7. 生成所有 chunk 的 embeddings
    const chunkTexts = chunks.map(c => c.content);
    const embeddings = await generateEmbeddings(chunkTexts);

    // 8. 使用事务：删除旧 chunks + 插入新 chunks（带 embedding）
    await prisma.$transaction(async (tx) => {
      // 删除该文档的所有旧 chunks
      await tx.chunk.deleteMany({
        where: { docId },
      });

      // 插入新 chunks（使用 Raw SQL 支持 vector 类型）
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkId = randomUUID();
        await tx.$queryRaw`
          INSERT INTO "Chunk" (
            "content", "contentHash", "pageStart", "pageEnd", "embedding",
            "kbId", "docId", "userId", "id", "createdAt"
          ) VALUES (
            ${chunk.content},
            ${generateContentHash(chunk.content)},
            ${chunk.pageStart},
            ${chunk.pageEnd},
            ${vectorToPostgresFormat(embeddings[i])}::vector(256),
            ${document.kbId},
            ${document.id},
            ${session.user.id},
            ${chunkId},
            DEFAULT
          )
        `;
      }
    }, {
      maxWait: 10000,
      timeout: 120000,
    });

    // 8. 更新文档状态为 ready
    const updatedDocument = await prisma.document.update({
      where: { id: docId },
      data: {
        status: 'ready',
        indexedAt: new Date(),
      },
    });

    return NextResponse.json({
      message: 'Document indexed successfully',
      document: {
        id: updatedDocument.id,
        status: updatedDocument.status,
        indexedAt: updatedDocument.indexedAt,
      },
      stats: {
        totalPages: parseResult.totalPages,
        totalChunks: chunks.length,
        totalCharacters: parseResult.fullText.length,
      },
    });

  } catch (error) {
    console.error('Indexing failed:', error);

    // 更新文档状态为 error
    await prisma.document.update({
      where: { id: docId },
      data: {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
    });

    return NextResponse.json({
      error: 'Indexing failed',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
