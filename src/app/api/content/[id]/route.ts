import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/content/[id] - 获取单条内容
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 尝试通过 id 或 slug 查找
    const content = await prisma.content.findFirst({
      where: {
        OR: [
          { id },
          { slug: id },
        ],
      },
    });

    if (!content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    // 已发布的内容递增浏览量
    if (content.status === 'published') {
      const updated = await prisma.content.update({
        where: { id: content.id },
        data: { viewCount: { increment: 1 } },
      });
      return NextResponse.json(updated);
    }

    return NextResponse.json(content);
  } catch (error) {
    console.error('Failed to fetch content:', error);
    return NextResponse.json(
      { error: 'Failed to fetch content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/content/[id] - 删除内容（仅管理员）
export async function DELETE(
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

    const content = await prisma.content.findUnique({
      where: { id },
      include: {
        chunks: { select: { id: true } },
      },
    });

    if (!content) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    // 删除内容（chunks 通过 onDelete: Cascade 自动删除）
    await prisma.content.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Content deleted successfully',
      deletedContent: {
        id: content.id,
        title: content.title,
        chunksDeleted: content.chunks.length,
      },
    });
  } catch (error) {
    console.error('Failed to delete content:', error);
    return NextResponse.json(
      { error: 'Failed to delete content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
