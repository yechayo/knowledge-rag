import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, vectorToPostgresFormat } from '@/lib/embedding';

interface ChunkResult {
  id: string;
  contentId: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  score: number;
  chunkType: string;
  headingLevel: number | null;
  headingAnchor: string | null;
  headingText: string | null;
  sectionPath: string | null;
  sourceTitle: string | null;
  sourceSlug: string | null;
  sourceCategory: string | null;
  sourceTags: unknown;
}

interface FormattedResult {
  chunkId: string;
  contentId: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  score: number;
  chunkType: string;
  headingLevel?: number | null;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  sourceTitle?: string | null;
  sourceTags?: string[];
}

const GROUPED_LIMITS: Record<string, number> = {
  nav_structure: 2,
  content_meta: 5,
  toc_entry: 5,
  content_body: 8,
};

/**
 * 将数据库行格式化为统一的 result 对象
 */
function formatResult(r: ChunkResult): FormattedResult {
  return {
    chunkId: r.id,
    contentId: r.contentId,
    title: r.title,
    slug: r.slug,
    category: r.category,
    content: r.content,
    score: r.score,
    chunkType: r.chunkType,
    headingLevel: r.headingLevel,
    headingAnchor: r.headingAnchor,
    headingText: r.headingText,
    sectionPath: r.sectionPath,
    sourceTitle: r.sourceTitle,
    sourceTags: Array.isArray(r.sourceTags) ? r.sourceTags : [],
  };
}

/**
 * POST /api/retrieve - 全局向量检索接口（公开，无需鉴权）
 *
 * 入参:
 * - query: 查询文本
 * - topK: 返回结果数量（默认 5，最大 20）
 * - grouped: 是否按 chunkType 分组返回（默认 false）
 *
 * 出参（标准模式）:
 * - results: 检索结果数组
 *
 * 出参（分组模式 grouped: true）:
 * - grouped: 按 chunkType 分组的结果
 *   - nav_structure: top-2
 *   - content_meta: top-5
 *   - toc_entry: top-5
 *   - content_body: top-8
 */
export async function POST(req: Request) {
  try {
    const { query, topK = 5, grouped = false } = await req.json();

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const validTopK = Math.min(Math.max(1, topK), 20);

    // 生成查询 embedding
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = vectorToPostgresFormat(queryEmbedding);

    if (grouped) {
      const groups: Record<string, FormattedResult[]> = {
        nav_structure: [],
        content_meta: [],
        toc_entry: [],
        content_body: [],
      };

      await Promise.all(
        Object.entries(GROUPED_LIMITS).map(async ([chunkType, limit]) => {
          const rows = await prisma.$queryRaw<ChunkResult[]>`
            SELECT
              c.id,
              c."contentId",
              co.title,
              co.slug,
              co.category,
              c.content,
              1 - (c.embedding <=> ${embeddingStr}::vector(256)) AS score,
              c."chunkType",
              c."headingLevel",
              c."headingAnchor",
              c."headingText",
              c."sectionPath",
              c."sourceTitle",
              c."sourceSlug",
              c."sourceCategory",
              c."sourceTags"
            FROM "Chunk" c
            JOIN "Content" co ON c."contentId" = co.id
            WHERE co.status = 'published'
              AND c.embedding IS NOT NULL
              AND c."chunkType" = ${chunkType}
            ORDER BY c.embedding <=> ${embeddingStr}::vector(256) ASC
            LIMIT ${limit}
          `;

          groups[chunkType] = rows.map(formatResult);
        })
      );

      return NextResponse.json({ grouped: groups });
    }

    // 搜索所有已发布内容的 chunks
    // 标准模式使用用户指定的 topK
    const limit = validTopK;

    const results = await prisma.$queryRaw<ChunkResult[]>`
      SELECT
        c.id,
        c."contentId",
        co.title,
        co.slug,
        co.category,
        c.content,
        1 - (c.embedding <=> ${embeddingStr}::vector(256)) AS score,
        c."chunkType",
        c."headingLevel",
        c."headingAnchor",
        c."headingText",
        c."sectionPath",
        c."sourceTitle",
        c."sourceSlug",
        c."sourceCategory",
        c."sourceTags"
      FROM "Chunk" c
      JOIN "Content" co ON c."contentId" = co.id
      WHERE co.status = 'published'
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${embeddingStr}::vector(256) ASC
      LIMIT ${limit}
    `;

    // 标准模式：直接返回格式化后的结果
    return NextResponse.json({
      results: results.map(formatResult),
    });
  } catch (error) {
    console.error('Retrieve failed:', error);
    return NextResponse.json({ error: 'Retrieve failed' }, { status: 500 });
  }
}
