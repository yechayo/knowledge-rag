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
 * 检查用户问题是否是"元问题"（关于分类、结构等）
 * 如果是，直接返回内容列表；否则返回 null
 */
async function checkMetaQuestion(
  query: string,
  baseUrl: string
): Promise<GroupedResult | null> {
  const metaPatterns = [
    /分类|category|有哪些类型/,
    /文章列表|内容列表|所有内容/,
    /结构|structure|导航/,
    /有多少|数量|count/,
  ];

  const isMetaQuestion = metaPatterns.some((pattern) => pattern.test(query));
  if (!isMetaQuestion) {
    return null;
  }

  // 元问题：直接查询所有内容，获取分类统计
  try {
    const contentRes = await fetch(`${baseUrl.replace('/retrieve', '/content')}?status=published&limit=100`);
    if (!contentRes.ok) return null;

    const contentData = await contentRes.json();
    const contents = contentData.items || [];

    if (contents.length === 0) return null;

    // 按分类统计
    const categoryMap = new Map<string, typeof contents>();
    for (const c of contents) {
      const cat = c.category;
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, []);
      }
      categoryMap.get(cat)!.push(c);
    }

    // 构建 content_meta 格式的内容概览
    const contentMetaChunks: GroupedChunk[] = [];

    // 添加分类统计概览
    const categorySummary = Array.from(categoryMap.entries()).map(([cat, items]) => {
      const titles = items.slice(0, 3).map((c: { title: string }) => c.title).join('、');
      const more = items.length > 3 ? `等${items.length}篇` : `${items.length}篇`;
      return `${cat}（${more}）：${titles}${items.length > 3 ? '...' : ''}`;
    }).join('\n');

    contentMetaChunks.push({
      chunkId: 'category-summary',
      contentId: 'all',
      title: '全部分类概览',
      slug: '',
      category: 'summary',
      content: `## 网站内容分类统计\n\n共 ${contents.length} 篇文章，分为以下分类：\n\n${categorySummary}`,
      score: 1.0,
      chunkType: 'content_meta',
      sourceTags: [],
    });

    // 添加每个分类的代表性内容
    for (const [cat, items] of categoryMap.entries()) {
      const sampleItems = items.slice(0, 5);
      for (const item of sampleItems) {
        contentMetaChunks.push({
          chunkId: `meta-${item.id}`,
          contentId: item.id,
          title: item.title,
          slug: item.slug,
          category: item.category,
          content: `标题：${item.title}，分类：${item.category}${item.metadata?.tags?.length ? `，标签：${item.metadata.tags.join(', ')}` : ''}`,
          score: 1.0,
          chunkType: 'content_meta',
          sourceTitle: item.title,
          sourceTags: item.metadata?.tags || [],
        });
      }
    }

    return {
      nav_structure: [],
      content_meta: contentMetaChunks,
      toc_entry: [],
      content_body: [],
    };
  } catch (error) {
    console.error('Failed to fetch content list for meta question:', error);
    return null;
  }
}

/**
 * 第一阶段：让 AI 分析用户问题，生成搜索关键词/策略
 */
async function analyzeQueryForSearch(
  query: string,
  apiKey: string
): Promise<string[]> {
  const analysisPrompt = `你是一个智能搜索助手。你的任务是根据用户的问题，分析并生成最合适的搜索关键词。

用户问题："${query}"

请分析这个问题，判断用户真正想要查找什么内容。注意：
1. 用户的表述可能与知识库中的术语不完全一致，你需要推断用户的真实意图
2. 考虑同义词、近义词、相关概念
3. 如果用户询问某个分类/类别的内容，生成该分类的名称和相关关键词
4. 如果用户询问某个主题，生成该主题的多个表述方式

请以 JSON 数组格式返回 2-5 个搜索关键词，例如：["关键词1", "关键词2", "关键词3"]

只返回 JSON 数组，不要包含任何其他内容。`;

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
        messages: [
          {
            role: 'user',
            content: analysisPrompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
        stream: false,
      }),
    }
  );

  if (!response.ok) {
    console.error('Analysis API failed:', await response.text());
    // 分析失败时，返回原始查询作为回退
    return [query];
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // 尝试解析 JSON 数组
  try {
    // 清理可能的 markdown 代码块标记
    const cleaned = content.replace(/```json\n?|```\n?/g, '').trim();
    const keywords = JSON.parse(cleaned);
    if (Array.isArray(keywords) && keywords.length > 0) {
      return keywords.slice(0, 5);
    }
  } catch {
    // 解析失败，尝试从文本中提取可能的关键词
    const lines = content.split('\n').filter((l: string) => l.trim());
    const keywords = lines
      .map((l: string) => l.replace(/^[-*]\s*/, '').replace(/^"\s*|\s*"$/g, '').trim())
      .filter((k: string) => k.length > 0 && k.length < 50)
      .slice(0, 5);
    if (keywords.length > 0) {
      return keywords;
    }
  }

  // 回退：返回原始查询
  return [query];
}

/**
 * 根据 AI 分析的关键词，判断是否需要查询内容列表
 * 如果关键词中包含分类名（如 news、article、project），则返回该分类的内容列表
 */
async function fetchContentListByKeywords(
  baseUrl: string,
  keywords: string[]
): Promise<GroupedChunk[]> {
  // 已知的分类列表
  const knownCategories = ['news', 'article', 'project', 'note', 'page', 'link', 'slogan'];

  // 检查关键词中是否包含分类名
  const matchedCategories = keywords.filter(k =>
    knownCategories.includes(k.toLowerCase())
  );

  // 如果没有匹配到分类，检查关键词是否包含中文分类名
  const chineseCategoryMap: Record<string, string> = {
    '新闻': 'news',
    '文章': 'article',
    '项目': 'project',
    '笔记': 'note',
    '页面': 'page',
    '链接': 'link',
    '标语': 'slogan',
  };
  for (const [cn, en] of Object.entries(chineseCategoryMap)) {
    if (keywords.some(k => k.includes(cn) || k.includes(en))) {
      matchedCategories.push(en);
    }
  }

  // 如果有关键词是 category 或 分类，返回所有分类的内容列表
  if (keywords.some(k => k.includes('分类') || k.includes('category') || k.includes('列表'))) {
    matchedCategories.push(...knownCategories);
  }

  if (matchedCategories.length === 0) {
    return [];
  }

  // 去重分类
  const uniqueCategories = [...new Set(matchedCategories)];

  try {
    // 获取所有已发布内容
    const contentRes = await fetch(`${baseUrl.replace('/retrieve', '/content')}?status=published`);
    if (!contentRes.ok) return [];

    const contentData = await contentRes.json();
    const contents = contentData.items || [];

    // 过滤出匹配的分类
    const filteredContents = contents.filter((c: { category: string }) =>
      uniqueCategories.includes(c.category.toLowerCase())
    );

    // 转换为 content_meta 格式的 chunks
    return filteredContents.map((c: { id: string; title: string; slug: string; category: string; metadata: { tags?: string[] } }) => ({
      chunkId: `meta-${c.id}`,
      contentId: c.id,
      title: c.title,
      slug: c.slug,
      category: c.category,
      content: `标题：${c.title}，分类：${c.category}${c.metadata?.tags?.length ? `，标签：${c.metadata.tags.join(', ')}` : ''}`,
      score: 1.0,
      chunkType: 'content_meta',
      sourceTitle: c.title,
      sourceTags: c.metadata?.tags || [],
    }));
  } catch (error) {
    console.error('Failed to fetch content list:', error);
    return [];
  }
}

/**
 * 使用多个关键词进行综合检索
 */
async function multiQueryRetrieve(
  baseUrl: string,
  keywords: string[]
): Promise<GroupedResult> {
  const groupedResult: GroupedResult = {
    nav_structure: [],
    content_meta: [],
    toc_entry: [],
    content_body: [],
  };

  // 使用 Set 来去重（基于 chunkId）
  const seenChunkIds = new Set<string>();

  // 并行发送多个检索请求
  const promises = keywords.map(async (keyword) => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: keyword, grouped: true, topK: 10 }),
    });
    const data = await res.json();
    return data.grouped || {
      nav_structure: [],
      content_meta: [],
      toc_entry: [],
      content_body: [],
    };
  });

  const results = await Promise.all(promises);

  // 合并去重后的结果
  for (const group of results) {
    for (const type of ['nav_structure', 'content_meta', 'toc_entry', 'content_body'] as const) {
      const chunks = group[type];
      const limits: Record<string, number> = {
        nav_structure: 2,
        content_meta: 5,
        toc_entry: 5,
        content_body: 8,
      };

      for (const chunk of chunks) {
        if (!seenChunkIds.has(chunk.chunkId) && groupedResult[type].length < limits[type]) {
          seenChunkIds.add(chunk.chunkId);
          groupedResult[type].push(chunk);
        }
      }
    }
  }

  return groupedResult;
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

    const apiKey = process.env.BIGMODEL_API_KEY;
    if (!apiKey) {
      return new Response(
        'data: ' + JSON.stringify({ type: 'error', data: '服务配置异常：缺少 API Key' }) + '\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } }
      );
    }

    // 检查是否是元问题（关于分类、结构等）
    const metaGrouped = await checkMetaQuestion(
      query,
      new URL('/api/retrieve', req.url).toString()
    );

    // 如果是元问题，直接使用预检结果；否则进行两阶段检索
    let grouped: GroupedResult;
    if (metaGrouped) {
      grouped = metaGrouped;
    } else {
      // 第一阶段：让 AI 分析问题，生成搜索关键词
      const searchKeywords = await analyzeQueryForSearch(query, apiKey);

      // 第二阶段：使用多个关键词综合检索
      grouped = await multiQueryRetrieve(
        new URL('/api/retrieve', req.url).toString(),
        searchKeywords
      );

      // 第三阶段：如果关键词中包含分类名，额外查询内容列表
      const baseUrl = new URL('/api/retrieve', req.url).toString();
      const contentList = await fetchContentListByKeywords(baseUrl, searchKeywords);
      if (contentList.length > 0) {
        // 合并到 content_meta 中（去重）
        const existingIds = new Set(grouped.content_meta.map(c => c.contentId));
        for (const item of contentList) {
          if (!existingIds.has(item.contentId)) {
            grouped.content_meta.push(item);
          }
        }
      }
    }

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
