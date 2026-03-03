import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { unlink } from 'fs/promises';
import { basename, isAbsolute, resolve } from 'path';
import { UPLOAD_DIR } from '@/lib/constants';
import { stat } from 'fs/promises';

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

// GET /api/documents/[id] - 获取文档详情
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: docId } = await params;

  try {
    const document = await prisma.document.findUnique({
      where: {
        id: docId,
        userId: session.user.id,
      },
      include: {
        knowledgeBase: {
          select: { id: true, name: true },
        },
        chunks: {
          select: { id: true, pageStart: true, pageEnd: true },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 检查文件是否存在
    const resolvedPath = await findExistingFilePath(document.storagePath);
    const fileExists = resolvedPath !== null;

    return NextResponse.json({
      id: document.id,
      filename: document.filename,
      status: document.status,
      mime: document.mime,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      indexedAt: document.indexedAt,
      error: document.error,
      knowledgeBase: document.knowledgeBase,
      chunksCount: document.chunks.length,
      fileExists,
      storagePath: document.storagePath,
    });
  } catch (error) {
    console.error('Failed to fetch document:', error);
    return NextResponse.json({
      error: 'Failed to fetch document',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

// DELETE /api/documents/[id] - 删除文档及其关联数据
export async function DELETE(
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
      include: {
        chunks: {
          select: { id: true },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 3. 删除本地 PDF 文件
    const resolvedPath = await findExistingFilePath(document.storagePath);
    let fileDeleted = false;
    let fileError = null;

    if (resolvedPath) {
      try {
        await unlink(resolvedPath);
        fileDeleted = true;
      } catch (error) {
        fileError = error instanceof Error ? error.message : String(error);
        console.error('Failed to delete file:', error);
        // 即使文件删除失败，也继续删除数据库记录
      }
    }

    // 4. 删除数据库记录（由于设置了 onDelete: Cascade，Chunk 会自动被删除）
    await prisma.document.delete({
      where: { id: docId },
    });

    return NextResponse.json({
      message: 'Document deleted successfully',
      document: {
        id: document.id,
        filename: document.filename,
      },
      deletionResult: {
        fileDeleted,
        fileError,
        chunksDeleted: document.chunks.length,
      },
    });

  } catch (error) {
    console.error('Document deletion failed:', error);
    return NextResponse.json({
      error: 'Deletion failed',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
