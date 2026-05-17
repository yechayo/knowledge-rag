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
import type { SourceCitation } from "./types";

export async function runRagReactAnswer(input: {
  messages: BaseMessage[];
  systemPrompt: string;
  engine: QueryEngine;
  signal: AbortSignal;
  send: SSESender;
}): Promise<{ answer: string; sources: SourceCitation[] }> {
  const limits = { ...DEFAULT_RESOURCE_LIMITS, maxTurns: 8 };
  const guard = new LoopGuard({
    maxTurns: limits.maxTurns,
    tokenBudget: limits.tokenBudget,
    maxTotalCalls: 8,
    maxPerTool: 5,
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
    systemPrompt: input.systemPrompt,
    llm: createDeepSeekChatModel({ temperature: 0.3, maxTokens: 4000 }),
    engine: input.engine,
    guard,
    signal: input.signal,
    send: input.send,
    recursionLimit: 10,
  });
  return {
    answer: result.finalText,
    sources: extractSourcesFromToolResults(result.toolResults),
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
