/**
 * ReAct Chat Graph 编译和执行
 *
 * 简化架构：
 * 1. 先执行 retrieveNode 获取 RAG 上下文
 * 2. 将上下文注入 systemPrompt
 * 3. 调用 runAgentStream 执行 ReAct 循环
 *
 * 流式输出由 runAgentStream 内部处理
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { ReActChatState, RetrievedContext } from "./state";
import { retrieveNode, RetrieveNodeConfig } from "./nodes/retrieveNode";
import { runAgentStream, AgentRunInput, AgentRunResult } from "@/lib/agent/stream/agentRunner";
import type { LoopGuard } from "@/lib/agent/guard";
import type { QueryEngine } from "@/lib/agent/chat/queryEngine";
import type { SSESender } from "@/lib/agent/stream/sse";

export interface ReActChatInput {
  /** 对话消息历史 */
  messages: BaseMessage[];
  /** 系统提示词 */
  systemPrompt: string;
  /** LLM 实例 */
  llm: unknown;
  /** 工具列表 */
  tools: unknown[];
  /** 原始工具列表 */
  rawTools: unknown[];
  /** Loop Guard */
  guard: LoopGuard;
  /** Query Engine */
  engine: QueryEngine;
  /** Abort Signal */
  signal: AbortSignal;
  /** SSE 发送器 */
  send: SSESender;
  /** 基础 URL */
  baseUrl: string;
  /** 是否启用逐 token 流式 */
  enableTokenStreaming?: boolean;
}

export interface ReActChatResult extends AgentRunResult {
  /** 检索到的上下文 */
  retrievedContext: RetrievedContext | null;
  /** 来源列表 */
  sources: any[];
}

/**
 * 构建 RAG 上下文到 systemPrompt
 */
function buildRAGContext(context: RetrievedContext | null): string {
  if (!context) return "";

  const hasContent =
    context.nav_structure.length > 0 ||
    context.content_meta.length > 0 ||
    context.toc_entry.length > 0 ||
    context.content_body.length > 0;

  if (!hasContent) {
    return `【知识库状态】
知识库中暂未收录与当前问题相关的内容。
`;
  }

  function buildNavSection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无站点结构信息";
    return chunks.map((c) => c.content).join("\n");
  }

  function buildContentMetaSection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无相关内容概览";
    return chunks
      .map((c, i) => {
        const tags = c.sourceTags?.length ? " - " + c.sourceTags.join(", ") : "";
        const preview = c.content.length > 150 ? c.content.slice(0, 150) + "..." : c.content;
        return (
          "[" +
          (i + 1) +
          "] 《" +
          c.title +
          "》- " +
          c.category +
          tags +
          " (链接: /" +
          c.category +
          "/" +
          c.slug +
          ") - " +
          preview
        );
      })
      .join("\n");
  }

  function buildTocSection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无相关目录信息";
    return chunks
      .map((c, i) => "[" + (i + 1) + "] 《" + c.title + "》目录: " + (c.sectionPath || c.content))
      .join("\n");
  }

  function buildContentBodySection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无详细内容";
    return chunks
      .map((c, i) => {
        const link = c.headingAnchor
          ? "/" + c.category + "/" + c.slug + "#" + c.headingAnchor
          : "/" + c.category + "/" + c.slug;
        return (
          "[" +
          (i + 1) +
          "] 《" +
          c.title +
          "》" +
          (c.sectionPath ? "- " + c.sectionPath : "") +
          " (链接: " +
          link +
          ")\n" +
          c.content
        );
      })
      .join("\n\n---\n\n");
  }

  return `【知识库内容】
## 网站结构
${buildNavSection(context.nav_structure)}

## 相关内容概览
${buildContentMetaSection(context.content_meta)}

## 相关目录
${buildTocSection(context.toc_entry)}

## 详细内容
${buildContentBodySection(context.content_body)}
`;
}

/**
 * 生成标题锚点
 */
function generateHeadingAnchor(headingText: string): string {
  return headingText
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 提取引用来源
 */
function extractSources(context: RetrievedContext | null): any[] {
  if (!context) return [];

  const seen = new Map<string, any>();

  for (const chunk of context.content_body || []) {
    const key = chunk.slug + "::" + (chunk.headingAnchor || "");
    if (!seen.has(key)) {
      seen.set(key, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: chunk.headingText
          ? generateHeadingAnchor(chunk.headingText)
          : chunk.headingAnchor || null,
        headingText: chunk.headingText || null,
        sectionPath: chunk.sectionPath || null,
        contentPreview:
          chunk.content.length > 100
            ? chunk.content.slice(0, 100) + "..."
            : chunk.content,
      });
    }
  }

  const existingSlugs = new Set((context.content_body || []).map((c) => c.slug));
  for (const chunk of context.content_meta || []) {
    if (!existingSlugs.has(chunk.slug)) {
      seen.set(chunk.slug, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: null,
        headingText: null,
        sectionPath: null,
        contentPreview:
          chunk.content.length > 100
            ? chunk.content.slice(0, 100) + "..."
            : chunk.content,
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * 执行 ReAct Chat
 *
 * 流程：
 * 1. 执行 RAG 检索
 * 2. 构建包含上下文的 systemPrompt
 * 3. 调用 runAgentStream 执行 ReAct 循环
 * 4. 提取来源并返回
 */
export async function runReActChat(input: ReActChatInput): Promise<ReActChatResult> {
  const {
    messages,
    systemPrompt,
    llm,
    tools,
    rawTools,
    guard,
    engine,
    signal,
    send,
    baseUrl,
    enableTokenStreaming,
  } = input;

  // 1. 执行 RAG 检索
  const initialState: ReActChatState = {
    messages,
    retrievedContext: null,
    toolResults: [],
    hasCalledTools: false,
    guardStatus: {
      turnCount: 0,
      totalToolCalls: 0,
      shouldStop: false,
    },
    finalAnswer: "",
    sources: [],
  };

  const retrieveConfig: RetrieveNodeConfig = { baseUrl };
  const retrieveResult = await retrieveNode(initialState, retrieveConfig);
  const retrievedContext = retrieveResult.retrievedContext || null;

  // 2. 构建包含 RAG 上下文的 systemPrompt
  const ragContext = buildRAGContext(retrievedContext);
  const fullSystemPrompt = ragContext
    ? systemPrompt.replace("【知识库内容】", ragContext)
    : systemPrompt;

  // 3. 调用 runAgentStream 执行 ReAct 循环
  const runInput: AgentRunInput = {
    inputMessages: messages,
    guardedTools: tools,
    rawTools,
    systemPrompt: fullSystemPrompt,
    llm,
    engine,
    guard,
    signal,
    send,
    recursionLimit: 15,
    enableTokenStreaming,
  };

  const result = await runAgentStream(runInput);

  // 4. 提取来源
  const sources = extractSources(retrievedContext);

  return {
    ...result,
    retrievedContext,
    sources,
  };
}
