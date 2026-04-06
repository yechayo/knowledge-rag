import { NextResponse } from 'next/server';

/**
 * POST /api/chat - 全局 RAG 聊天接口（公开，SSE 流式输出）
 *
 * 入参:
 * - messages: 对话消息数组 [{role, content}]
 *
 * 出参:
 * - SSE 流 (text/event-stream)
 *   - type: 'answer' -> AI 回答片段
 *   - type: 'sources' -> 引用来源列表
 *   - type: 'error' -> 错误信息
 */
export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response('Missing messages', { status: 400 });
    }

    const lastUserMessage = messages
      .filter((m: { role: string }) => m.role === 'user')
      .pop();

    if (!lastUserMessage?.content) {
      return new Response('Missing user message', { status: 400 });
    }

    const query = lastUserMessage.content;

    // 调用全局检索接口
    const retrieveRes = await fetch(new URL('/api/retrieve', req.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK: 5 }),
    });
    const retrieveData = await retrieveRes.json();
    const sources: Array<{
      title: string;
      slug: string;
      category: string;
      content: string;
    }> = retrieveData.results || [];

    // 构建 RAG 提示词
    const systemPrompt =
      sources.length > 0
        ? `你是一个专业的知识库助手。请基于以下检索到的内容回答用户问题。
回答要求：
1. 优先使用提供的文档片段内容
2. 如果文档中没有相关信息，请明确告知
3. 回答时注明引用来源
4. 保持简洁准确

检索到的内容：
${sources
  .map(
    (s, i) =>
      `[${i + 1}] ${s.title} (${s.category}/${s.slug})\n${s.content}`
  )
  .join('\n\n---\n\n')}`
        : `你是一个友好的网站助手。用户的问题是关于网站内容的，但目前知识库中没有找到相关内容。请友好地回复并建议用户浏览网站的其他内容。`;

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages
        .slice(0, -1)
        .map((m: { role: string; content: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      { role: 'user' as const, content: query },
    ];

    // 使用 ReadableStream 进行 SSE 流式响应
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          const apiKey = process.env.BIGMODEL_API_KEY;
          if (!apiKey) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'error', data: '服务配置异常：缺少 API Key' })}\n\n`
              )
            );
            controller.close();
            return;
          }

          // 调用智谱 GLM API（流式）
          const response = await fetch(
            'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model: 'glm-4-flash',
                messages: chatMessages,
                temperature: 0.7,
                max_tokens: 2000,
                stream: true,
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'error', data: errorText })}\n\n`
              )
            );
            controller.close();
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'error', data: 'No response body' })}\n\n`
              )
            );
            controller.close();
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const data = trimmed.slice(5).trim();
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ type: 'answer', data: content })}\n\n`
                    )
                  );
                }
              } catch {
                // 忽略解析错误
              }
            }
          }

          // 发送引用来源
          if (sources.length > 0) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'sources',
                  data: sources.map((s) => ({
                    title: s.title,
                    slug: s.slug,
                    category: s.category,
                  })),
                })}\n\n`
              )
            );
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                data: String(error),
              })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat failed:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}
