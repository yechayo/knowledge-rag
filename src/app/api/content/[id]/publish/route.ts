import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { indexContent } from '@/lib/content-indexer';
import { prisma } from '@/lib/prisma';

// POST /api/content/[id]/publish - 发布内容并生成向量索引（仅管理员）
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const user = session?.user as { isAdmin?: boolean } | undefined;
  const isAdmin = !!user?.isAdmin;
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

    const indexResult = await indexContent(content);
    const { warnings, ...stats } = indexResult;

    // 4. 更新内容状态为 published
    const published = await prisma.content.update({
      where: { id },
      data: { status: 'published' },
    });

    return NextResponse.json({
      message: 'Content published and indexed successfully',
      content: published,
      stats,
      ...(warnings ? { warnings } : {}),
    });
  } catch (error) {
    console.error('Failed to publish content:', error);
    return NextResponse.json(
      { error: 'Failed to publish content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
