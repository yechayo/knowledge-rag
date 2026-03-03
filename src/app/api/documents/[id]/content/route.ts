import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parsePDF } from '@/lib/pdf-parser';
import { chunkPages } from '@/lib/chunker';
import { stat } from 'fs/promises';
import { basename, isAbsolute, join, resolve } from 'path';
import { UPLOAD_DIR } from '@/lib/constants';

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

// GET /api/documents/[id]/content - 获取文档解析内容
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
    // 1. 查询文档并验证归属
    const document = await prisma.document.findUnique({
      where: {
        id: docId,
        userId: session.user.id,
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 2. 解析并检查文件路径（兼容历史路径/相对路径）
    const resolvedPath = await findExistingFilePath(document.storagePath);
    if (!resolvedPath) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
    }

    if (resolvedPath !== document.storagePath) {
      await prisma.document.update({
        where: { id: document.id },
        data: { storagePath: resolvedPath },
      });
    }

    // 3. 根据文档类型选择解析器
    let parseResult;
    let chunks;

    if (document.mime === 'text/markdown') {
      const { parseMarkdown } = await import('@/lib/md-parser');
      const mdResult = await parseMarkdown(resolvedPath);

      // Markdown 使用章节分块（复用现有接口结构）
      chunks = mdResult.sections.map((section) => ({
        content: section.content,
        pageStart: section.lineNumber,
        pageEnd: section.lineNumber + section.content.split('\n').length,
      }));

      return NextResponse.json({
        document: {
          id: document.id,
          filename: document.filename,
          status: document.status,
        },
        parseResult: {
          type: 'markdown',
          sections: mdResult.sections,
          fullText: mdResult.fullText,
          metadata: mdResult.metadata,
        },
        chunks: chunks.map((c, i) => ({
          id: i + 1,
          content: c.content,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          length: c.content.length,
        })),
        stats: {
          totalCharacters: mdResult.fullText.length,
          totalChunks: chunks.length,
          avgChunkSize: chunks.length > 0
            ? Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length)
            : 0,
        },
      });
    }

    // 解析 PDF（现有逻辑）
    parseResult = await parsePDF(resolvedPath);
    chunks = chunkPages(parseResult.pages);

    return NextResponse.json({
      document: {
        id: document.id,
        filename: document.filename,
        status: document.status,
      },
      parseResult: {
        totalPages: parseResult.totalPages,
        fullText: parseResult.fullText,
        pages: parseResult.pages,
      },
      chunks: chunks.map((c, i) => ({
        id: i + 1,
        content: c.content,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
        length: c.content.length,
      })),
      stats: {
        totalCharacters: parseResult.fullText.length,
        totalChunks: chunks.length,
        avgChunkSize: chunks.length > 0
          ? Math.round(chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length)
          : 0,
      },
    });

  } catch (error) {
    console.error('Failed to parse document:', error);
    return NextResponse.json({
      error: 'Failed to parse document',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
