import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeFile } from 'fs/promises';

// PATCH /api/documents/[id]/update - 更新文档内容
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: docId } = await params;

  try {
    const { content } = await req.json();

    if (content === undefined) {
      return NextResponse.json({ error: 'Missing content' }, { status: 400 });
    }

    // 1. 验证文档归属
    const document = await prisma.document.findFirst({
      where: {
        id: docId,
        userId: session.user.id,
      },
    });

    if (!document) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // 2. 更新文件内容
    await writeFile(document.storagePath, content, 'utf-8');

    // 3. 更新文档状态（如果已索引，需要重新索引）
    if (document.status === 'ready') {
      await prisma.document.update({
        where: { id: docId },
        data: { status: 'uploaded' },
      });
    }

    return NextResponse.json({
      message: 'Document updated successfully',
      document,
    });
  } catch (error) {
    console.error('Document update failed:', error);
    return NextResponse.json({
      error: 'Update Failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
