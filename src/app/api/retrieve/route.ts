import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, vectorToPostgresFormat } from '@/lib/embedding';

/**
 * POST /api/retrieve - 全局向量检索接口（公开，无需鉴权）
 *
 * 入参:
 * - query: 查询文本
 * - topK: 返回结果数量（默认 5，最大 20）
 *
 * 出参:
 * - results: 检索结果数组（含 chunkId, contentId, title, slug, category, content, score）
 */
export async function POST(req: Request) {
  try {
    const { query, topK = 5 } = await req.json();

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const validTopK = Math.min(Math.max(1, topK), 20);

    // 生成查询 embedding
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = vectorToPostgresFormat(queryEmbedding);

    // 搜索所有已发布内容的 chunks
    const results = await prisma.$queryRaw<Array<{
      id: string;
      contentId: string;
      title: string;
      slug: string;
      category: string;
      content: string;
      score: number;
    }>>`
      SELECT
        c.id,
        c."contentId",
        co.title,
        co.slug,
        co.category,
        c.content,
        1 - (c.embedding <=> ${embeddingStr}::vector(256)) AS score
      FROM "Chunk" c
      JOIN "Content" co ON c."contentId" = co.id
      WHERE co.status = 'published'
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${embeddingStr}::vector(256) ASC
      LIMIT ${validTopK}
    `;

    return NextResponse.json({
      results: results.map((r) => ({
        chunkId: r.id,
        contentId: r.contentId,
        title: r.title,
        slug: r.slug,
        category: r.category,
        content: r.content,
        score: r.score,
      })),
    });
  } catch (error) {
    console.error('Retrieve failed:', error);
    return NextResponse.json({ error: 'Retrieve failed' }, { status: 500 });
  }
}
