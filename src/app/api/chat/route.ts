import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { chat, buildRAGPrompt, type Message } from '@/lib/glm';

interface ChatRequest {
  kbId: string;
  messages: Array<{ role: string; content: string }>;
}

interface Source {
  chunkId: string;
  docId: string;
  docName?: string;
  content: string;
  pageStart: number;
  pageEnd: number;
  score: number;
}

function parseUsedSourceIndexes(answer: string, max: number): number[] {
  const sourceLineMatch = answer.match(/SOURCES\s*[:：]\s*([^\n\r]+)/i);
  if (!sourceLineMatch) return [];

  const raw = sourceLineMatch[1].trim();
  if (!raw || /none|无|没有/i.test(raw)) return [];

  const numbers = raw
    .split(/[,，\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((num) => Number.isInteger(num) && num >= 1 && num <= max);

  return Array.from(new Set(numbers));
}

function cleanAnswerText(answer: string): string {
  return answer.replace(/\n?SOURCES\s*[:：]\s*[^\n\r]*/gi, '').trim();
}

/**
 * POST /api/chat - RAG 聊天接口
 *
 * 入参:
 * - kbId: 知识库 ID
 * - messages: 对话消息数组
 *
 * 出参:
 * - answer: AI 回答
 * - sources: 引用来源列表
 */
export async function POST(req: Request) {
  // 1. 鉴权
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 2. 解析请求参数
    const body: ChatRequest = await req.json();

    if (!body.kbId || !body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: '缺少必填参数: kbId, messages' },
        { status: 400 }
      );
    }

    const { kbId, messages } = body;

    // 3. 验证知识库归属
    const kb = await prisma.knowledgeBase.findUnique({
      where: {
        id: kbId,
        userId: session.user.id,
      },
    });

    if (!kb) {
      return NextResponse.json(
        { error: '知识库不存在或无权访问' },
        { status: 404 }
      );
    }

    // 4. 获取最后一条用户消息作为查询
    const lastUserMessage = messages
      .filter((m) => m.role === 'user')
      .pop();

    if (!lastUserMessage || !lastUserMessage.content) {
      return NextResponse.json(
        { error: '未找到有效的用户问题' },
        { status: 400 }
      );
    }

    const query = lastUserMessage.content;

    // 5. 调用检索接口
    const retrieveResponse = await fetch(
      new URL('/api/retrieve', req.url),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.get('cookie') || '',
        },
        body: JSON.stringify({ kbId, query, topK: 5 }),
      }
    );

    if (!retrieveResponse.ok) {
      const errorData = await retrieveResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: '检索失败', details: errorData.error || '未知错误' },
        { status: retrieveResponse.status }
      );
    }

    const retrieveData = await retrieveResponse.json();

    if (!retrieveData.results || retrieveData.results.length === 0) {
      return NextResponse.json({
        answer: '抱歉，我在知识库中没有找到与您问题相关的内容。请尝试换个问题或上传更多相关文档。',
        sources: [],
      });
    }

    const sources: Source[] = retrieveData.results;

    // 6. 构建 RAG 提示词并调用 LLM
    const ragPrompt = buildRAGPrompt(
      query,
      sources.map((s: Source) => ({
        content: s.content,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
        docName: s.docName,
      }))
    );

    // 转换消息格式以适配历史消息
    const chatMessages: Message[] = [
      ragPrompt[0], // system prompt with context
      ...messages.slice(0, -1).map((m) => ({
        role: (m.role === 'user' || m.role === 'assistant' ? m.role : 'user') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: ragPrompt[1].content }, // current query
    ];

    const rawAnswer = await chat(chatMessages);
    const usedIndexes = parseUsedSourceIndexes(rawAnswer, sources.length);
    const answer = cleanAnswerText(rawAnswer);
    const usedSources = usedIndexes.map((idx) => sources[idx - 1]).filter(Boolean);

    // 7. 返回结果
    return NextResponse.json({
      answer,
      sources: usedSources.map((s: Source) => ({
        chunkId: s.chunkId,
        docId: s.docId,
        docName: s.docName,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
        score: s.score,
      })),
    });

  } catch (error) {
    console.error('Chat failed:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);

    // 提供友好的错误提示
    if (errorMessage.includes('BIGMODEL_API_KEY')) {
      return NextResponse.json(
        { error: '服务配置异常，请联系管理员配置 API Key' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      error: '对话服务异常',
      details: errorMessage,
    }, { status: 500 });
  }
}
