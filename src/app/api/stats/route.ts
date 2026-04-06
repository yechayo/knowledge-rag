import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/stats - 获取站点统计（公开）
export async function GET() {
  try {
    const publishedWhere = { status: 'published' };

    const [totalArticles, totalProjects, totalNotes, allContent] = await Promise.all([
      prisma.content.count({ where: { ...publishedWhere, category: 'article' } }),
      prisma.content.count({ where: { ...publishedWhere, category: 'project' } }),
      prisma.content.count({ where: { ...publishedWhere, category: 'note' } }),
      prisma.content.findMany({
        where: publishedWhere,
        select: { metadata: true },
      }),
    ]);

    // 统计所有标签
    const tagSet = new Set<string>();
    for (const item of allContent) {
      const tags = (item.metadata as Record<string, unknown>)?.tags;
      if (Array.isArray(tags)) {
        for (const t of tags) {
          if (typeof t === 'string') tagSet.add(t);
        }
      }
    }

    // 统计运行天数（取最早一篇内容的创建日期）
    const earliest = await prisma.content.findFirst({
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const daysSinceCreation = earliest
      ? Math.max(1, Math.floor((Date.now() - earliest.createdAt.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    // 总浏览量
    const totalViews = await prisma.content.aggregate({
      _sum: { viewCount: true },
      where: publishedWhere,
    });

    return NextResponse.json({
      daysSinceCreation,
      totalArticles,
      totalProjects,
      totalNotes,
      totalTags: tagSet.size,
      totalViews: totalViews._sum.viewCount || 0,
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 },
    );
  }
}
