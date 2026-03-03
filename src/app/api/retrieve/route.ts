import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateEmbedding, vectorToPostgresFormat } from '@/lib/embedding';

interface RetrieveRequest {
  kbId: string;
  query: string;
  topK?: number;
}

interface RetrieveResult {
  chunkId: string;
  docId: string;
  content: string;
  pageStart: number;
  pageEnd: number;
  score: number;
}

/**
 * POST /api/retrieve - 向量检索接口
 *
 * 入参:
 * - kbId: 知识库 ID
 * - query: 查询文本
 * - topK: 返回结果数量（默认 5，最大 20）
 *
 * 出参:
 * - results: 检索结果数组
 * - query: 原始查询
 */
export async function POST(req: Request) {
  // 1. 鉴权
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 2. 解析请求参数
    const body: RetrieveRequest = await req.json();

    if (!body.kbId || !body.query) {
      return NextResponse.json(
        { error: 'Missing required fields: kbId, query' },
        { status: 400 }
      );
    }

    const { kbId, query, topK = 5 } = body;

    // 验证 topK 范围
    const validTopK = Math.min(Math.max(1, topK), 20);

    // 3. 验证知识库归属
    const kb = await prisma.knowledgeBase.findUnique({
      where: {
        id: kbId,
        userId: session.user.id,
      },
    });

    if (!kb) {
      return NextResponse.json(
        { error: 'Knowledge base not found' },
        { status: 404 }
      );
    }

    // 4. 生成查询 embedding
    const queryEmbedding = await generateEmbedding(query);
    const embeddingStr = vectorToPostgresFormat(queryEmbedding);

    // 5. 使用 pgvector 余弦相似度检索
    // 余弦相似度: 1 - (embedding <=> query_embedding)
    const results = await prisma.$queryRaw<Array<{
      id: string;
      doc_id: string;
      doc_name: string;
      content: string;
      page_start: number;
      page_end: number;
      score: number;
    }>>`
      SELECT
        c.id,
        c."docId" AS doc_id,
        d.filename AS doc_name,
        c.content,
        c."pageStart" AS page_start,
        c."pageEnd" AS page_end,
        1 - (c.embedding <=> ${embeddingStr}::vector(256)) AS score
      FROM "Chunk" c
      JOIN "Document" d ON c."docId" = d.id
      WHERE c."kbId" = ${kbId}
        AND c."userId" = ${session.user.id}
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${embeddingStr}::vector(256) ASC
      LIMIT ${validTopK}
    `;

    // 6. 格式化返回结果
    const formattedResults = results.map(r => ({
      chunkId: r.id,
      docId: r.doc_id,
      docName: r.doc_name,
      content: r.content,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      score: r.score,
    }));

    return NextResponse.json({
      results: formattedResults,
      query,
      kbId,
      count: formattedResults.length,
    });

  } catch (error) {
    console.error('Retrieve failed:', error);

    return NextResponse.json({
      error: 'Retrieve failed',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
