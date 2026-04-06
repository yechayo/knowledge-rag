import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// PATCH /api/content/[id]/update - 更新内容（仅管理员）
export async function PATCH(
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
    const body = await req.json();
    const { title, body: contentBody, category, metadata, status } = body;

    // 检查内容是否存在
    const existing = await prisma.content.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    // 构建更新数据，仅包含提供的字段
    const updateData: any = {};
    if (title !== undefined) updateData.title = title;
    if (contentBody !== undefined) updateData.body = contentBody;
    if (category !== undefined) updateData.category = category;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (status !== undefined) updateData.status = status;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updated = await prisma.content.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update content:', error);
    return NextResponse.json(
      { error: 'Failed to update content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
