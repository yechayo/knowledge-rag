import { NextResponse } from 'next/server';
import { generateHeadingAnchor } from '@/lib/heading-anchor';

/**
 * 用于接收 grouped 模式检索结果的单条 chunk 类型
 */
interface GroupedChunk {
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

interface GroupedResult {
  nav_structure: GroupedChunk[];
  content_meta: GroupedChunk[];
  toc_entry: GroupedChunk[];
  content_body: GroupedChunk[];
}

/**
 * 用于 SSE sources 事件的引用来源
 */
interface SourceCitation {
  title: string;
  slug: string;
  category: string;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  contentPreview: string;
}

/**
 * 构建 nav_structure 部分的系统提示词内容
 */
function buildNavSection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return '暂无站点结构信息';
  return chunks.map((c) => c.content).join('\n');
}

/**
 * 构建 content_meta 部分的系统提示词内容
 */
function buildContentMetaSection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return '暂无相关内容概览';
  return chunks
    .map((c, i) => {
      const tags = c.sourceTags?.length ? ' - ' + c.sourceTags.join(', ') : '';
      const preview = c.content.length > 150 ? c.content.slice(0, 150) + '...' : c.content;
      return '[' + (i + 1) + '] 《' + c.title + '》- ' + c.category + tags + ' (链接: /' + c.category + '/' + c.slug + ') - ' + preview;
    })
    .join('\n');
}

/**
 * 构建 toc_entry 部分的系统提示词内容
 */
function buildTocSection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return '暂无相关目录信息';
  return chunks
    .map((c, i) => {
      return '[' + (i + 1) + '] 《' + c.title + '》目录: ' + (c.sectionPath || c.content);
    })
    .join('\n');
}

/**
 * 构建 content_body 部分的系统提示词内容
 */
function buildContentBodySection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return '暂无详细内容';
  return chunks
    .map((c, i) => {
      const normalizedAnchor = c.headingText
        ? generateHeadingAnchor(c.headingText)
        : (c.headingAnchor || '');
      const link = normalizedAnchor
        ? '/' + c.category + '/' + c.slug + '#' + normalizedAnchor
        : '/' + c.category + '/' + c.slug;
      return '[' + (i + 1) + '] 《' + c.title + '》' + (c.sectionPath ? '- ' + c.sectionPath : '') + ' (链接: ' + link + ')\n' + c.content;
    })
    .join('\n\n---\n\n');
}

/**
 * 从分组结果中提取去重后的引用来源
 * 优先使用 content_body chunks，回退到 content_meta
 */
function extractSources(grouped: GroupedResult): SourceCitation[] {
  const seen = new Map<string, SourceCitation>();

  // 优先从 content_body 提取来源
  for (const chunk of grouped.content_body) {
    const key = chunk.slug + '::' + (chunk.headingAnchor || '');
    if (!seen.has(key)) {
      seen.set(key, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: chunk.headingText
          ? generateHeadingAnchor(chunk.headingText)
          : chunk.headingAnchor,
        headingText: chunk.headingText,
        sectionPath: chunk.sectionPath,
        contentPreview: chunk.content.length > 100 ? chunk.content.slice(0, 100) + '...' : chunk.content,
      });
    }
  }

  // 回退从 content_meta 补充（仅补充 content_body 中未出现过的 slug）
  const existingSlugs = new Set(grouped.content_body.map((c) => c.slug));
  for (const chunk of grouped.content_meta) {
    if (!existingSlugs.has(chunk.slug)) {
      seen.set(chunk.slug, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: null,
        headingText: null,
        sectionPath: null,
        contentPreview: chunk.content.length > 100 ? chunk.content.slice(0, 100) + '...' : chunk.content,
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * 获取无内容时的固定回复
 */
const NO_CONTENT_REPLY = '你是知识库问答助手。当前知识库中没有找到与用户问题相关的内容。\n\n你必须原话回复："知识库中暂未收录此内容，建议浏览网站寻找相关文章。"\n\n严禁使用你自身的任何知识来回答问题。';

/**
 * 获取有内容时的系统提示词
 */
function buildSystemPrompt(grouped: GroupedResult): string {
  const prompt = '[角色设定]\n' +
'你是一个知识库问答助手。你的全部知识来源于下方提供的知识库内容。\n\n' +
'[核心原则]\n' +
'- 你的知识来源只有下方"知识库内容"，严禁使用自身的预训练知识来回答\n' +
'- 但你可以对知识库中已有的信息进行对比、归纳、总结、推理\n' +
'- 例如：用户要求对比 React 和 Vue，即使知识库中没有直接写"React和Vue的对比"，只要知识库中有 React 相关内容和 Vue 相关内容，你就应该分别提取这两部分信息进行对比回答\n\n' +
'[知识库内容]\n' +
'## 网站结构\n' +
buildNavSection(grouped.nav_structure) + '\n\n' +
'## 相关内容概览\n' +
buildContentMetaSection(grouped.content_meta) + '\n\n' +
'## 相关目录\n' +
buildTocSection(grouped.toc_entry) + '\n\n' +
'## 详细内容\n' +
buildContentBodySection(grouped.content_body) + '\n\n' +
'[引用标记规则 - 必须遵守]\n' +
'你的回答中使用内联省略内容标记来引用知识库，格式为 [[REF:完整链接|缩写内容]]。\n' +
'- 完整链接直接使用详细内容中给出的"链接"值，例如：[[REF:/article/react-hooks#usestate基础用法|最基础的 Hook]]\n' +
'- 标记由两部分组成：完整链接（含 /category/slug#anchor）和 |后的缩写内容\n' +
'- 链接不带引号，直接从"详细内容"的"链接:"后面复制\n' +
'- 缩写内容用简短几个字概括被引用内容的核心含义，显示在回答中\n' +
'- 同一来源多次引用使用相同标记（链接相同）\n' +
'- 禁止在回答末尾额外列出引用来源\n' +
'- 绝对不使用自身的预训练知识回答问题\n' +
'- 如果知识库中没有相关内容，原话回复："知识库中暂未收录此内容，建议浏览网站寻找相关文章。"（不包含任何引用标记）\n\n' +
'[回答前自省 - 你必须按以下步骤思考后再输出最终回答]\n\n' +
'在输出正式回答之前，请严格完成以下自省检查：\n\n' +
'1. 检查语料引用是否正确：\n' +
'   - 我的每一个 [[REF:...|...]] 标记中的链接是否与"详细内容"中给出的"链接"完全一致？\n' +
'   - 链接格式是否正确：以 / 开头，包含 /category/slug，如需要锚点则加 #锚点\n' +
'   - 我有没有捏造 slug 或 headingAnchor？\n\n' +
'2. 检查是否使用了预训练知识：\n' +
'   - 我的回答中有没有任何信息是来自"知识库内容"之外的？\n' +
'   - 如果有，请删除那些未经证实的陈述\n\n' +
'3. 确认引用覆盖度：\n' +
'   - 用户问题涉及的所有关键信息是否都已被引用标记覆盖？\n' +
'   - 是否有遗漏的重要知识点没有引用？\n\n' +
'完成自省后，直接输出最终回答（不要在回答中提及"自省"或任何反思过程）。如果自省发现问题，请先修正后再输出。';

  return prompt;
}

/**
 * POST /api/chat - 全局 RAG 聊天接口（公开，SSE 流式输出）
 *
 * 入参:
 * - messages: 对话消息数组 [{role, content}]
 *
 * 出参:
 * - SSE 流 (text/event-stream)
 *   - type: 'answer' -> AI 回答片段
 *   - type: 'sources' -> 引用来源列表（含结构化引用信息）
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

    // 调用全局检索接口（grouped 模式）
    const retrieveRes = await fetch(new URL('/api/retrieve', req.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, grouped: true }),
    });
    const retrieveData = await retrieveRes.json();
    const grouped: GroupedResult = retrieveData.grouped || {
      nav_structure: [],
      content_meta: [],
      toc_entry: [],
      content_body: [],
    };

    // 判断是否有相关内容
    const hasContent =
      grouped.nav_structure.length > 0 ||
      grouped.content_meta.length > 0 ||
      grouped.toc_entry.length > 0 ||
      grouped.content_body.length > 0;

    const systemPrompt = hasContent ? buildSystemPrompt(grouped) : NO_CONTENT_REPLY;

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

    // 提取去重后的引用来源
    const sources = extractSources(grouped);

    // 使用 ReadableStream 进行 SSE 流式响应
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          const apiKey = process.env.BIGMODEL_API_KEY;
          if (!apiKey) {
            controller.enqueue(
              encoder.encode(
                'data: ' + JSON.stringify({ type: 'error', data: '服务配置异常：缺少 API Key' }) + '\n\n'
              )
            );
            controller.close();
            return;
          }

          // 调用智谱 GLM API（流式 + 思考模式）
          const response = await fetch(
            'https://open.bigmodel.cn/api/paas/v4/chat/completions',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey,
              },
              body: JSON.stringify({
                model: 'GLM-4.5-AirX',
                messages: chatMessages,
                temperature: 0.5,
                max_tokens: 4000,
                stream: true,
                do_sample: true,
                // 启用思考模式
                thinking: {
                  enable: true,
                  budget_tokens: 2000,
                },
              }),
            }
          );

          if (!response.ok) {
            const errorText = await response.text();
            controller.enqueue(
              encoder.encode(
                'data: ' + JSON.stringify({ type: 'error', data: errorText }) + '\n\n'
              )
            );
            controller.close();
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            controller.enqueue(
              encoder.encode(
                'data: ' + JSON.stringify({ type: 'error', data: 'No response body' }) + '\n\n'
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
                const choice = parsed.choices?.[0];

                // 思考内容：暂不发送给前端
                if (choice?.delta?.reasoning_content) {
                  // 可选：可将思考内容也发送给前端显示
                }

                // 正式回答内容
                const content = choice?.delta?.content;
                if (content) {
                  controller.enqueue(
                    encoder.encode(
                      'data: ' + JSON.stringify({ type: 'answer', data: content }) + '\n\n'
                    )
                  );
                }
              } catch {
                // 忽略解析错误
              }
            }
          }

          // 发送结构化引用来源
          if (sources.length > 0) {
            controller.enqueue(
              encoder.encode(
                'data: ' + JSON.stringify({
                  type: 'sources',
                  data: sources,
                }) + '\n\n'
              )
            );
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              'data: ' + JSON.stringify({
                type: 'error',
                data: String(error),
              }) + '\n\n'
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
