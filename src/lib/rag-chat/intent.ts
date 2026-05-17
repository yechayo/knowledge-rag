import { completeDeepSeekJSON } from "./deepseek";
import type { RagChatIntent, RagChatRoute } from "./types";

interface ClassifierPayload {
  route?: RagChatRoute;
  confidence?: number;
  needsKnowledge?: boolean;
  normalizedQuery?: string;
  reason?: string;
}

const GREETING_RE = /^(你好|您好|hi|hello|hey|嗨|在吗|早上好|下午好|晚上好)[！!。.\s]*$/i;
const KNOWLEDGE_RE = /(知识库|站内|文章|内容|分类|项目|笔记|文档|博客|这篇|有哪些|列出|查一下|检索|搜索|地址|网址|链接|网站|url|site)/i;
const COMPLEX_RE = /(对比|比较|总结|归纳|共同点|不同点|多篇|分别|综合|整理|根据.*和|跨.*文章|多跳|详细分析)/i;
const GENERAL_DIRECT_RE = /^(什么是|解释一下|解释|为什么|如何|怎么)\s*\S+/i;

export async function classifyChatIntent(message: string): Promise<RagChatIntent> {
  const query = message.trim();
  const rule = classifyByRules(query);
  if (rule) return rule;

  try {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), classifierTimeoutMs());
    const payload = await completeDeepSeekJSON<ClassifierPayload>(
      buildClassifierPrompt(query),
      {
        maxTokens: 180,
        temperature: 0,
        signal: abortController.signal,
      }
    ).finally(() => clearTimeout(timeoutId));
    return normalizeClassifierPayload(payload, query);
  } catch {
    return {
      route: "retrieve_once",
      confidence: 0.4,
      needsKnowledge: true,
      normalizedQuery: query,
      reason: "intent classifier failed; defaulting to safe knowledge retrieval",
      source: "fallback",
    };
  }
}

function classifyByRules(query: string): RagChatIntent | null {
  if (!query) {
    return {
      route: "direct",
      confidence: 1,
      needsKnowledge: false,
      normalizedQuery: query,
      reason: "empty input",
      source: "rules",
    };
  }

  if (GREETING_RE.test(query)) {
    return {
      route: "direct",
      confidence: 0.95,
      needsKnowledge: false,
      normalizedQuery: query,
      reason: "greeting or lightweight conversation",
      source: "rules",
      localReply: "你好！有什么可以帮你的吗？",
    };
  }

  if (COMPLEX_RE.test(query) && KNOWLEDGE_RE.test(query)) {
    return {
      route: "react_retrieve",
      confidence: 0.86,
      needsKnowledge: true,
      normalizedQuery: query,
      reason: "complex knowledge-base question",
      source: "rules",
    };
  }

  if (KNOWLEDGE_RE.test(query)) {
    return {
      route: "retrieve_once",
      confidence: 0.84,
      needsKnowledge: true,
      normalizedQuery: query,
      reason: "explicit knowledge-base or site-content question",
      source: "rules",
    };
  }

  if (query.length <= 8 && /^(谢谢|好的|可以|行|嗯|ok|OK|明白)$/.test(query)) {
    return {
      route: "direct",
      confidence: 0.9,
      needsKnowledge: false,
      normalizedQuery: query,
      reason: "short conversational acknowledgement",
      source: "rules",
      localReply: buildAcknowledgementReply(query),
    };
  }

  if (GENERAL_DIRECT_RE.test(query)) {
    return {
      route: "direct",
      confidence: 0.78,
      needsKnowledge: false,
      normalizedQuery: query,
      reason: "general question without explicit knowledge-base intent",
      source: "rules",
    };
  }

  return null;
}

function buildAcknowledgementReply(query: string): string {
  if (/谢谢/.test(query)) return "不客气。";
  return "好的。";
}

function classifierTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.RAG_CLASSIFIER_TIMEOUT_MS || "1200", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1200;
}

function buildClassifierPrompt(query: string): string {
  return `你是前台 RAG 助手的意图分类器。只返回 JSON，不要解释。

可选 route:
- direct: 不需要站内知识库，直接回答
- retrieve_once: 需要知识库，但单次检索足够
- react_retrieve: 复杂、多跳、比较、总结、需要多次检索或工具判断

用户问题: ${JSON.stringify(query)}

返回格式:
{"route":"direct|retrieve_once|react_retrieve","confidence":0.0,"needsKnowledge":false,"normalizedQuery":"...","reason":"..."}`;
}

function normalizeClassifierPayload(payload: ClassifierPayload, query: string): RagChatIntent {
  const allowed: RagChatRoute[] = ["direct", "retrieve_once", "react_retrieve"];
  const route = allowed.includes(payload.route as RagChatRoute) ? payload.route as RagChatRoute : "retrieve_once";
  return {
    route,
    confidence: clampConfidence(payload.confidence),
    needsKnowledge: payload.needsKnowledge ?? route !== "direct",
    normalizedQuery: (payload.normalizedQuery || query).trim() || query,
    reason: payload.reason || "classified by DeepSeek",
    source: "deepseek",
  };
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}
