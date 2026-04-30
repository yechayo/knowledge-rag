import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { indexContent } from '@/lib/content-indexer';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

// PATCH /api/content/[id]/update - 更新内容（仅管理员）
export async function PATCH(
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
    const body = await req.json();
    const { title, body: contentBody, category, slug, metadata, status } = body;

    // 检查内容是否存在
    const existing = await prisma.content.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

    // 构建更新数据，仅包含提供的字段
    const updateData: {
      title?: string;
      body?: string;
      category?: string;
      slug?: string;
      metadata?: Prisma.InputJsonValue;
      status?: string;
    } = {};
    if (title !== undefined) updateData.title = title;
    if (contentBody !== undefined) updateData.body = contentBody;
    if (category !== undefined) updateData.category = category;
    if (slug !== undefined) updateData.slug = slug;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (status !== undefined) updateData.status = status;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    if (slug !== undefined && slug !== existing.slug) {
      const slugConflict = await prisma.content.findUnique({ where: { slug } });
      if (slugConflict) {
        return NextResponse.json({ error: 'Slug already exists', slug }, { status: 409 });
      }
    }

    const updated = await prisma.content.update({
      where: { id },
      data: updateData,
    });

    if (existing.status === 'published' && updated.status !== 'published') {
      await prisma.chunk.deleteMany({ where: { contentId: id } });
      return NextResponse.json({
        ...updated,
        indexCleared: true,
      });
    }

    const changesAffectIndex =
      title !== undefined ||
      contentBody !== undefined ||
      category !== undefined ||
      slug !== undefined ||
      metadata !== undefined ||
      status === 'published';

    if (updated.status !== 'published' || !changesAffectIndex) {
      return NextResponse.json(updated);
    }

    const indexResult = await indexContent(updated);
    const { warnings, ...indexStats } = indexResult;

    return NextResponse.json({
      ...updated,
      indexed: true,
      indexStats,
      ...(warnings ? { warnings } : {}),
    });
  } catch (error) {
    console.error('Failed to update content:', error);
    return NextResponse.json(
      { error: 'Failed to update content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
