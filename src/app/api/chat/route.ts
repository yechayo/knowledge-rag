import { NextResponse } from 'next/server';
import { generateHeadingAnchor } from '@/lib/heading-anchor';
import { evaluateCitationQuality, getQualitySummary } from '@/lib/citation-evaluator';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { createReadOnlyToolRegistry } from '@/lib/agent/tools/registry';
import { createSSESender, SSE_HEADERS } from '@/lib/agent/stream/sse';
import { LoopGuard, DEFAULT_RESOURCE_LIMITS } from '@/lib/agent/guard';
import { createAgentModel } from '@/lib/langchain/llm';
import { HumanMessage, AIMessage, trimMessages, BaseMessage } from '@langchain/core/messages';
import { REACT_CHAT_PROMPT, REACT_CHAT_NO_CONTENT_PROMPT } from '@/lib/agent/prompts/react_chat';
import { getOrCreateSession } from '@/lib/agent/session';
import { createQueryEngine } from '@/lib/agent/chat';
import { runAgentStream, type ToolResultEntry } from '@/lib/agent/stream/agentRunner';

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
 * 构建知识库上下文文本（用于注入 systemPrompt）
 */
function buildKnowledgeBaseContext(grouped: GroupedResult): string {
  return `## 网站结构\n${buildNavSection(grouped.nav_structure)}\n\n` +
    `## 相关内容概览\n${buildContentMetaSection(grouped.content_meta)}\n\n` +
    `## 相关目录\n${buildTocSection(grouped.toc_entry)}\n\n` +
    `## 详细内容\n${buildContentBodySection(grouped.content_body)}`;
}

/**
 * 自定义 token 计数器
 */
function countTokens(msgs: BaseMessage[]): number {
  return msgs.reduce((total, msg) => {
    const text = typeof msg.content === "string" ? msg.content : String(msg.content || "");
    const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const en = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter((w: string) => w.length > 0).length;
    return total + Math.ceil(cn * 2 + en * 1.3) + 4;
  }, 0);
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
 * RRF (Reciprocal Rank Fusion) 算法
 * 用于融合多个检索结果，按排名计算相关性分数
 * @param results 每个关键词的检索结果数组
 * @param k RRF 参数，通常取 60
 * @returns 融合后的 chunkId -> RRF 分数 Map
 */
function reciprocalRankFusion<T extends { chunkId: string }>(
  results: T[][],
  k: number = 60
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const result of results) {
    for (let rank = 0; rank < result.length; rank++) {
      const chunkId = result[rank].chunkId;
      // RRF 分数 = 1 / (k + rank)
      const rrfScore = 1 / (k + rank + 1);
      scores.set(chunkId, (scores.get(chunkId) || 0) + rrfScore);
    }
  }

  return scores;
}

/**
 * 使用 RRF 算法对 content_body 进行重排序
 * @param contentBodyChunks 分组后的 content_body chunks
 * @param originalResults 每个关键词检索返回的原始 content_body 数组
 * @param limits 每个类型的数量限制
 * @returns 重排序后的 content_body chunks
 */
function rerankContentBody(
  contentBodyChunks: GroupedChunk[],
  originalResults: GroupedChunk[][],
  limits: Record<string, number>
): GroupedChunk[] {
  if (originalResults.length <= 1) {
    // 单查询不需要 RRF
    return contentBodyChunks;
  }

  // 使用 RRF 计算每个 chunk 的融合分数
  const rrfScores = reciprocalRankFusion(originalResults);

  // 将原始分数与 RRF 分数结合
  const reranked = contentBodyChunks.map(chunk => ({
    ...chunk,
    // 综合分数 = RRF 分数 * 原始余弦相似度分数
    // 这样做可以兼顾多查询融合和原始相似度
    score: (rrfScores.get(chunk.chunkId) || 0) * (chunk.score || 1),
  }));

  // 按综合分数降序排序
  reranked.sort((a, b) => (b.score || 0) - (a.score || 0));

  // 截取指定数量
  return reranked.slice(0, limits.content_body);
}

/**
 * 使用多个关键词进行综合检索（带 RRF 重排序）
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

  // 每个 chunkType 的数量上限
  const limits: Record<string, number> = {
    nav_structure: 2,
    content_meta: 5,
    toc_entry: 5,
    content_body: 8,
  };

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

  // 分别处理每个 chunkType
  for (const type of ['nav_structure', 'content_meta', 'toc_entry', 'content_body'] as const) {
    if (type === 'content_body') {
      // content_body 使用 RRF 重排序
      const allChunksByKeyword = results.map(r => r[type]);
      const mergedChunks = mergeAndDedupeChunks(allChunksByKeyword, limits[type]);
      groupedResult[type] = rerankContentBody(mergedChunks, allChunksByKeyword, limits);
    } else {
      // 其他类型使用简单的合并去重
      const allChunks = results.flatMap(r => r[type]);
      const seen = new Set<string>();
      for (const chunk of allChunks) {
        if (!seen.has(chunk.chunkId) && groupedResult[type].length < limits[type]) {
          seen.add(chunk.chunkId);
          groupedResult[type].push(chunk);
        }
      }
    }
  }

  return groupedResult;
}

/**
 * 合并多个检索结果的 chunks 并去重
 */
function mergeAndDedupeChunks(chunksArray: GroupedChunk[][], limit: number): GroupedChunk[] {
  const seen = new Set<string>();
  const result: GroupedChunk[] = [];

  for (const chunks of chunksArray) {
    for (const chunk of chunks) {
      if (!seen.has(chunk.chunkId) && result.length < limit) {
        seen.add(chunk.chunkId);
        result.push(chunk);
      }
    }
  }

  return result;
}

/**
 * 从分组结果中提去重后的引用来源
 */
function extractSources(grouped: GroupedResult): SourceCitation[] {
  const seen = new Map<string, SourceCitation>();

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

/** 从 session metadata 读取上轮工具结果（工作上下文） */
async function loadWorkingContext(sessionId: string): Promise<string> {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });
  if (!session?.metadata) return "";
  const meta = session.metadata as Record<string, unknown>;
  const results = meta.toolResults as ToolResultEntry[] | undefined;
  if (!results?.length) return "";

  const lines = results.map((r) => `[${r.toolName}]\n${r.result}`);
  return `\n\n【上轮工具结果（工作上下文）】\n${lines.join("\n\n---\n\n")}\n`;
}

/** 将本轮工具结果持久化到 session metadata */
async function saveWorkingContext(sessionId: string, toolResults: ToolResultEntry[]): Promise<void> {
  if (!toolResults.length) return;
  await prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    const meta = (session.metadata as Record<string, unknown>) || {};
    meta.toolResults = toolResults;
    await tx.agentSession.update({
      where: { id: sessionId },
      data: { metadata: meta as unknown as Prisma.InputJsonValue },
    });
  });
}

/**
 * POST /api/chat - 全局 RAG 聊天接口（ReAct 架构）
 * 使用 QueryEngine 持久化对话历史，与 Admin Agent 对齐
 */
export async function POST(req: Request) {
  try {
    const { message, sessionKey } = await req.json();

    if (!message || typeof message !== 'string') {
      return new Response('Missing message', { status: 400 });
    }

    const query = message.trim();
    const apiKey = process.env.BIGMODEL_API_KEY;

    if (!apiKey) {
      return new Response(
        'data: ' + JSON.stringify({ type: 'error', data: '服务配置异常：缺少 API Key' }) + '\n\n',
        { headers: SSE_HEADERS }
      );
    }

    // 会话初始化（使用 QueryEngine 持久化历史）
    const key = sessionKey || `rag:chat:${Date.now()}`;
    let session;
    try { session = await getOrCreateSession(key, 'chat', 'anonymous'); } catch {
      return new Response('data: ' + JSON.stringify({ type: 'error', data: 'Session error' }) + '\n\n', { status: 500, headers: SSE_HEADERS });
    }

    let engine;
    try { engine = await createQueryEngine(key, 'anonymous', 'chat', { apiKey }); } catch {
      return new Response('data: ' + JSON.stringify({ type: 'error', data: 'Session error' }) + '\n\n', { status: 500, headers: SSE_HEADERS });
    }

    let engineInitialized = false;
    try { await engine.initialize(); engineInitialized = true; } catch {
      return new Response('data: ' + JSON.stringify({ type: 'error', data: 'Session lock error' }) + '\n\n', { status: 409, headers: SSE_HEADERS });
    }

    try { await engine.addUserMessage(query); } catch {}

    // RRF 多关键词检索（保留原有逻辑）
    const baseUrl = new URL('/api/retrieve', req.url).toString();
    const metaGrouped = await checkMetaQuestion(query, baseUrl);

    let grouped: GroupedResult;
    if (metaGrouped) {
      grouped = metaGrouped;
    } else {
      const searchKeywords = await analyzeQueryForSearch(query, apiKey);
      grouped = await multiQueryRetrieve(baseUrl, searchKeywords);
      const contentList = await fetchContentListByKeywords(baseUrl, searchKeywords);
      if (contentList.length > 0) {
        const existingIds = new Set(grouped.content_meta.map(c => c.contentId));
        for (const item of contentList) {
          if (!existingIds.has(item.contentId)) {
            grouped.content_meta.push(item);
          }
        }
      }
    }

    // 构建 sources
    const sources = extractSources(grouped);

    // 判断是否有相关内容，决定使用哪个提示词
    const hasContent =
      grouped.nav_structure.length > 0 ||
      grouped.content_meta.length > 0 ||
      grouped.toc_entry.length > 0 ||
      grouped.content_body.length > 0;

    const knowledgeBaseContext = buildKnowledgeBaseContext(grouped);
    const baseSystemPrompt = hasContent
      ? REACT_CHAT_PROMPT.replace('{KNOWLEDGE_BASE}', knowledgeBaseContext)
      : REACT_CHAT_NO_CONTENT_PROMPT;

    // 加载工作上下文 + 构建完整 systemPrompt
    const workingContext = await loadWorkingContext(session.id);
    const systemPrompt = workingContext
      ? baseSystemPrompt + workingContext + '\n\n回答要求：简洁、直接、不重复。'
      : baseSystemPrompt + '\n\n回答要求：简洁、直接、不重复。';

    // 加载历史（从 DB）
    try { await engine.checkAndCompact(baseSystemPrompt); } catch {}
    let persistentHistory: any[] = [];
    try { persistentHistory = await engine.getMessages(); } catch {}

    const allMessages = persistentHistory.map((h: any) => {
      const content = typeof h.content === 'string' ? h.content : String(h.content);
      if (h.role === 'assistant') return new AIMessage(content);
      return new HumanMessage(content);
    });
    allMessages.push(new HumanMessage(query));

    // 裁剪消息
    const inputMessages = await trimMessages(allMessages, {
      maxTokens: 4000,
      strategy: 'last',
      includeSystem: true,
      startOn: 'human',
      allowPartial: true,
      tokenCounter: countTokens,
    });

    // 创建 Guard 和工具
    const limits = { ...DEFAULT_RESOURCE_LIMITS };
    const guard = new LoopGuard({ maxTurns: limits.maxTurns, tokenBudget: limits.tokenBudget });
    const { tools, rawTools } = createReadOnlyToolRegistry({ userId: 'anonymous', guard, limits });

    // 创建 LLM
    const llm = createAgentModel({ temperature: 0.7, maxTokens: 4000 });

    // AbortController
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 5 * 60 * 1000);
    if (req.signal) {
      req.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        abortCtrl.abort();
      }, { once: true });
    }

    // SSE 流式响应
    const stream = new ReadableStream({
      async start(controller) {
        const send = createSSESender(controller);
        const startTime = Date.now();
        let fullAnswer = '';

        try {
          send('init', { sessionKey: key });

          const result = await runAgentStream({
            inputMessages,
            guardedTools: tools,
            rawTools,
            systemPrompt,
            llm,
            engine,
            guard,
            signal: abortCtrl.signal,
            send,
          });

          fullAnswer = result.finalText;

          // 持久化本轮工具结果作为下轮工作上下文
          if (result.toolResults.length > 0) {
            try { await saveWorkingContext(session.id, result.toolResults); } catch {}
          }

          // 发送 sources（从 RAG 检索结果中提取，不在 runAgentStream 中）
          if (sources.length > 0) {
            send('sources', sources);
          }

          // 引用质量评估
          if (fullAnswer.length > 0 && sources.length > 0) {
            try {
              const qualityReport = evaluateCitationQuality(fullAnswer, query, sources);
              const summary = getQualitySummary(qualityReport);
              console.log('[引用质量评估]', JSON.stringify({ query: query.slice(0, 50), ...qualityReport, summary }));
            } catch (evalError) {
              console.error('[引用质量评估] 评估出错:', evalError);
            }
          }

          // 使用日志
          try {
            await prisma.usageLog.create({
              data: {
                query: query.slice(0, 500),
                answerLength: fullAnswer.length,
                citations: sources.length,
                latencyMs: Date.now() - startTime,
              },
            });
          } catch (logError) {
            console.error('[使用日志] 记录失败:', logError);
          }

          send('done', {});
        } catch (err: any) {
          if (err.name === 'AbortError') {
            send('done', { reason: 'cancelled' });
          } else {
            console.error('[chat] error:', err);
            send('error', { message: err.message || '模型调用失败' });
          }
        } finally {
          clearTimeout(timeoutId);
          if (engine && engineInitialized) { try { await engine.release(); } catch {} }
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    console.error('Chat failed:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}
