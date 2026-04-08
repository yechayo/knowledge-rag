import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET /api/stats - 获取站点统计（公开）
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const usageDays = parseInt(searchParams.get('usageDays') || '7', 10);

    const publishedWhere = { status: 'published' };

    // 计算使用量日期范围
    const usageStartDate = new Date();
    usageStartDate.setDate(usageStartDate.getDate() - usageDays);
    usageStartDate.setHours(0, 0, 0, 0);

    const [
      totalArticles,
      totalProjects,
      totalNotes,
      allContent,
    ] = await Promise.all([
      prisma.content.count({ where: { ...publishedWhere, category: 'article' } }),
      prisma.content.count({ where: { ...publishedWhere, category: 'project' } }),
      prisma.content.count({ where: { ...publishedWhere, category: 'note' } }),
      prisma.content.findMany({
        where: publishedWhere,
        select: { metadata: true },
      }),
    ]);

    // 使用量统计（可能失败，设为默认值）
    let usageStats = {
      periodDays: usageDays,
      totalQuestions: 0,
      totalCitations: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      recentLogs: [] as Array<{
        id: string;
        query: string;
        answerLength: number;
        citations: number;
        latencyMs: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        createdAt: string;
      }>,
      dailyStats: [] as Array<{
        date: string;
        count: number;
        totalCitations: number;
        totalTokens: number;
        avgLatencyMs: number;
      }>,
    };

    try {
      const [totalQuestions, totalCitations, totalTokensResult, avgLatency, recentLogs, dailyUsageStats] = await Promise.all([
        prisma.usageLog.count({
          where: { createdAt: { gte: usageStartDate } },
        }),
        prisma.usageLog.aggregate({
          _sum: { citations: true },
          where: { createdAt: { gte: usageStartDate } },
        }),
        prisma.usageLog.aggregate({
          _sum: { totalTokens: true },
          where: { createdAt: { gte: usageStartDate } },
        }),
        prisma.usageLog.aggregate({
          _avg: { latencyMs: true },
          where: { createdAt: { gte: usageStartDate } },
        }),
        prisma.usageLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        prisma.$queryRaw<Array<{
          date: string;
          count: bigint;
          total_citations: bigint;
          total_tokens: bigint;
          avg_latency: number;
        }>>`
          SELECT
            DATE("createdAt") as date,
            COUNT(*) as count,
            COALESCE(SUM("citations"), 0) as total_citations,
            COALESCE(SUM("totalTokens"), 0) as total_tokens,
            COALESCE(AVG("latencyMs"), 0)::float as avg_latency
          FROM "UsageLog"
          WHERE "createdAt" >= ${usageStartDate}
          GROUP BY DATE("createdAt")
          ORDER BY date DESC
        `,
      ]);

      usageStats = {
        periodDays: usageDays,
        totalQuestions,
        totalCitations: totalCitations._sum.citations || 0,
        totalTokens: totalTokensResult._sum.totalTokens || 0,
        avgLatencyMs: Math.round(avgLatency._avg.latencyMs || 0),
        recentLogs: recentLogs.map(log => ({
          id: log.id,
          query: log.query,
          answerLength: log.answerLength,
          citations: log.citations,
          latencyMs: log.latencyMs,
          promptTokens: log.promptTokens,
          completionTokens: log.completionTokens,
          totalTokens: log.totalTokens,
          createdAt: log.createdAt.toISOString(),
        })),
        dailyStats: dailyUsageStats.map(day => ({
          date: day.date,
          count: Number(day.count),
          totalCitations: Number(day.total_citations),
          totalTokens: Number(day.total_tokens),
          avgLatencyMs: Math.round(day.avg_latency),
        })),
      };
    } catch (usageError) {
      console.error('[Stats] Usage stats query failed:', usageError);
      // 使用量统计失败不影响主查询
    }

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
      // 内容统计
      daysSinceCreation,
      totalArticles,
      totalProjects,
      totalNotes,
      totalTags: tagSet.size,
      totalViews: totalViews._sum.viewCount || 0,
      // 使用量统计
      usageStats,
    });
  } catch (error) {
    console.error('Failed to fetch stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 },
    );
  }
}
