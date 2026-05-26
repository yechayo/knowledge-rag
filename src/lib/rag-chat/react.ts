import { tool } from "@langchain/core/tools";
import type { BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createReadOnlyToolRegistry } from "@/lib/agent/tools/registry";
import { DEFAULT_RESOURCE_LIMITS, LoopGuard } from "@/lib/agent/guard";
import { runAgentStream, type ToolResultEntry } from "@/lib/agent/stream/agentRunner";
import type { QueryEngine } from "@/lib/agent/chat/queryEngine";
import type { SSESender } from "@/lib/agent/stream/sse";
import { createDeepSeekChatModel } from "./deepseek";
import { searchKnowledgeBase } from "./retrieve";
import type { RagChatRoute } from "./types";
import type { SourceCitation } from "./types";

type RagAgentMode = Exclude<RagChatRoute, "direct">;

interface RagAgentModeConfig {
  systemPrompt: string;
  maxTurns: number;
  maxTotalCalls: number;
  maxPerTool: number;
  recursionLimit: number;
}

export async function runRagReactAnswer(input: {
  mode: RagAgentMode;
  messages: BaseMessage[];
  engine: QueryEngine;
  signal: AbortSignal;
  send: SSESender;
}): Promise<{ answer: string; sources: SourceCitation[] }> {
  const config = getRagAgentModeConfig(input.mode);
  const limits = { ...DEFAULT_RESOURCE_LIMITS, maxTurns: config.maxTurns };
  const guard = new LoopGuard({
    maxTurns: config.maxTurns,
    tokenBudget: limits.tokenBudget,
    maxTotalCalls: config.maxTotalCalls,
    maxPerTool: config.maxPerTool,
  });
  const searchTool = tool(
    async ({ query }: { query: string }) => {
      guard.check("search_knowledge_base", { query });
      return searchKnowledgeBase(query);
    },
    {
      name: "search_knowledge_base",
      description: "对已发布知识库内容进行语义检索，返回相关片段和可引用链接。",
      schema: z.object({
        query: z.string().describe("要检索的自然语言问题或关键词"),
      }),
    }
  );
  const { tools, rawTools } = createReadOnlyToolRegistry({ userId: "anonymous", guard, limits });
  const result = await runAgentStream({
    inputMessages: input.messages,
    guardedTools: [searchTool, ...tools],
    rawTools: [searchTool, ...rawTools],
    systemPrompt: config.systemPrompt,
    llm: createDeepSeekChatModel({ temperature: 0.3, maxTokens: 4000 }),
    engine: input.engine,
    guard,
    signal: input.signal,
    send: input.send,
    recursionLimit: config.recursionLimit,
  });
  return {
    answer: result.finalText,
    sources: extractSourcesFromToolResults(result.toolResults),
  };
}

export function getRagAgentModeConfig(mode: RagAgentMode): RagAgentModeConfig {
  if (mode === "retrieve_once") {
    return {
      systemPrompt: [
        "你是知识库问答助手。",
        "回答前必须先调用 search_knowledge_base 检索相关内容。",
        "默认一次检索后直接回答；只有首轮结果不足时，才允许改写问题再补充检索一次。",
        "回答只能依据工具返回的知识库内容，并使用 [[REF:/category/slug#anchor|短标签]] 引用。",
        "不要编造链接、slug、anchor 或未检索到的事实；如果工具结果不足，直接说明“知识库中暂无相关内容”。",
      ].join(" "),
      maxTurns: 4,
      maxTotalCalls: 3,
      maxPerTool: 2,
      recursionLimit: 6,
    };
  }

  return {
    systemPrompt: [
      "你是知识库 ReAct 助手。",
      "复杂问题应先拆解，再多轮调用 search_knowledge_base 检索不同角度的信息，最后汇总回答。",
      "回答只能依据工具返回的知识库内容，并使用 [[REF:/category/slug#anchor|短标签]] 引用。",
      "不要编造链接、slug、anchor 或未检索到的事实；如果工具结果不足，直接说明“知识库中暂无相关内容”。",
    ].join(" "),
    maxTurns: 8,
    maxTotalCalls: 8,
    maxPerTool: 5,
    recursionLimit: 10,
  };
}

export function extractSourcesFromToolResults(toolResults: ToolResultEntry[]): SourceCitation[] {
  const seen = new Map<string, SourceCitation>();

  for (const entry of toolResults) {
    if (entry.toolName !== "search_knowledge_base" && entry.toolName !== "searchKnowledgeBase") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.result);
    } catch {
      continue;
    }

    const sources = (parsed as { sources?: unknown }).sources;
    if (!Array.isArray(sources)) continue;

    for (const source of sources) {
      const citation = normalizeSourceCitation(source);
      if (!citation) continue;
      const key = `${citation.category}/${citation.slug}#${citation.headingAnchor || ""}`;
      if (!seen.has(key)) seen.set(key, citation);
    }
  }

  return Array.from(seen.values());
}

function normalizeSourceCitation(value: unknown): SourceCitation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = stringOrNull(raw.title);
  const slug = stringOrNull(raw.slug);
  const category = stringOrNull(raw.category);
  if (!title || !slug || !category) return null;

  return {
    title,
    slug,
    category,
    headingAnchor: stringOrNull(raw.headingAnchor),
    headingText: stringOrNull(raw.headingText),
    sectionPath: stringOrNull(raw.sectionPath),
    contentPreview: stringOrNull(raw.contentPreview) || "",
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
