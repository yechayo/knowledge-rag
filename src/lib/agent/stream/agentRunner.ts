/**
 * Agent 流式执行核心
 * 从 route.ts 提取，负责 LangGraph agent 的流式执行和 SSE 事件转换
 *
 * 默认使用 streamMode: "values"（保证 thinking 等字段完整），
 * 当 LLM 支持逐 token 流式时可切换为 "messages" 模式获得更细粒度输出。
 */

import { AIMessageChunk, isBaseMessageChunk, ToolMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { QueryEngine } from "@/lib/agent/chat/queryEngine";
import type { SSESender } from "./sse";
import { extractToolContent } from "./sse";
import { detectTextToolCall } from "./textToolDetector";
import { LoopGuard } from "@/lib/agent/guard";

export interface AgentRunInput {
  inputMessages: BaseMessage[];
  guardedTools: unknown[];
  rawTools: unknown[];
  systemPrompt: string;
  llm: unknown;
  engine: QueryEngine;
  guard: LoopGuard;
  signal: AbortSignal;
  send: SSESender;
  /** recursionLimit，默认 15 */
  recursionLimit?: number;
  /** 是否启用逐 token 流式（需要 LLM 支持），默认 false */
  enableTokenStreaming?: boolean;
}

export interface ToolResultEntry {
  toolName: string;
  result: string;
}

export interface AgentRunResult {
  finalText: string;
  totalToolCalls: number;
  /** 本轮所有工具调用的结果，用于持久化工作上下文 */
  toolResults: ToolResultEntry[];
}

/**
 * 执行 Agent 流式调用 — 默认使用 values 模式，可选 messages 逐 token 模式
 */
export async function runAgentStream(input: AgentRunInput): Promise<AgentRunResult> {
  const {
    inputMessages,
    guardedTools,
    rawTools,
    systemPrompt,
    llm,
    engine,
    guard,
    signal,
    send,
    recursionLimit = 15,
    enableTokenStreaming = false,
  } = input;

  const { createReactAgent } = await import("@langchain/langgraph/prebuilt");

  const agent = createReactAgent({
    llm: llm as any,
    tools: guardedTools as any,
    prompt: systemPrompt,
  });

  let finalAssistantText = "";
  let totalToolCalls = 0;
  let toolResults: ToolResultEntry[] = [];

  if (enableTokenStreaming) {
    // 尝试 messages 逐 token 模式
    const result = await runWithMessagesMode(agent, inputMessages, rawTools, guard, send, recursionLimit, signal);
    finalAssistantText = result.finalText;
    totalToolCalls = result.totalToolCalls;
    toolResults = result.toolResults;
  } else {
    // 默认 values 模式（保证 thinking 等字段完整）
    const result = await runWithValuesMode(agent, inputMessages, rawTools, guard, send, recursionLimit, signal);
    finalAssistantText = result.finalText;
    totalToolCalls = result.totalToolCalls;
    toolResults = result.toolResults;
  }

  // 持久化助手消息（截断到 300 字，打断复读链）
  // 详细的工具结果已通过工作上下文持久化，这里只需保留简要回答
  if (finalAssistantText) {
    const persistedText = finalAssistantText.length > 300
      ? finalAssistantText.slice(0, 300) + "\n...(详细内容已省略)"
      : finalAssistantText;
    try { await engine.addAssistantMessage(persistedText); } catch { /* ignore */ }
  }

  return { finalText: finalAssistantText, totalToolCalls, toolResults };
}

// ─── values 模式（默认，稳定可靠） ───

async function runWithValuesMode(
  agent: any,
  inputMessages: BaseMessage[],
  rawTools: unknown[],
  guard: LoopGuard,
  send: SSESender,
  recursionLimit: number,
  signal: AbortSignal,
): Promise<{ finalText: string; totalToolCalls: number; toolResults: ToolResultEntry[] }> {
  const agentStream = await agent.stream(
    { messages: inputMessages },
    { signal, streamMode: "values", recursionLimit }
  );

  let finalAssistantText = "";
  let totalToolCalls = 0;
  let processedMsgCount = 0;
  const toolResults: ToolResultEntry[] = [];

  for await (const event of agentStream) {
    if (!event?.messages) continue;
    const messages = event.messages;
    if (messages.length <= processedMsgCount) continue;

    for (let i = processedMsgCount; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg) continue;
      const msgType = msg._getType ? msg._getType() : (msg.type || "unknown");

      if (msgType === "ai") {
        const aiMsg = msg as any;

        // Turn 计数
        guard.incrementTurn();
        const stopCheck = guard.shouldStop();
        if (stopCheck.stop) {
          send("delta", { content: `\n\n[${stopCheck.reason}]` });
          break;
        }

        // thinking — values 模式下完整 AIMessage 携带 additional_kwargs.thinking
        if (aiMsg.additional_kwargs?.thinking) {
          send("thinking", { content: aiMsg.additional_kwargs.thinking });
        }

        // 结构化工具调用
        if (aiMsg.tool_calls?.length > 0) {
          for (const tc of aiMsg.tool_calls) {
            send("tool_start", { toolName: tc.name, arguments: JSON.stringify(tc.args) });
            totalToolCalls++;
          }
        }

        // 文本内容
        const textContent = typeof aiMsg.content === "string"
          ? aiMsg.content
          : Array.isArray(aiMsg.content)
            ? aiMsg.content.filter((c: any) => typeof c === "string").join("")
            : "";

        if (textContent && !aiMsg.tool_calls?.length) {
          const textToolCall = detectTextToolCall(textContent, rawTools);
          if (textToolCall) {
            if (textToolCall.prefix) {
              send("delta", { content: textToolCall.prefix });
              finalAssistantText += textToolCall.prefix;
            }
            send("tool_start", { toolName: textToolCall.toolName, arguments: JSON.stringify(textToolCall.args) });
            totalToolCalls++;
            try {
              const result = await (textToolCall.tool as any).invoke(textToolCall.args);
              const resultStr = typeof result === "string" ? result : JSON.stringify(result);
              send("tool_end", { toolName: textToolCall.toolName, result: resultStr, success: true });
            } catch (err: any) {
              const errMsg = err instanceof Error ? err.message : String(err);
              send("tool_end", { toolName: textToolCall.toolName, result: errMsg, success: false });
              guard.recordError(err);
            }
          } else {
            send("delta", { content: textContent });
            finalAssistantText += textContent;
          }
        }
      } else if (msgType === "tool") {
        const toolMsg = msg as any;
        const aiMsgs = messages.filter((m: any) => (m._getType ? m._getType() : m.type) === "ai");
        const lastAiMsg = aiMsgs[aiMsgs.length - 1] as any;
        const matchedCall = lastAiMsg?.tool_calls?.find((tc: any) => tc.id === toolMsg.tool_call_id);

        const resultStr = extractToolContent(toolMsg.content);

        send("tool_end", {
          toolName: matchedCall?.name || "unknown",
          result: resultStr,
          success: !resultStr.includes("LoopGuardError") && !resultStr.includes("Tool not found"),
        });

        guard.recordToolResult(matchedCall?.name || "unknown", resultStr.slice(0, 200));

        // 收集工具结果用于持久化工作上下文
        const toolName = matchedCall?.name || "unknown";
        toolResults.push({ toolName, result: resultStr.slice(0, 3000) });
      }
    }

    processedMsgCount = messages.length;
  }

  return { finalText: finalAssistantText, totalToolCalls, toolResults };
}

// ─── messages 逐 token 模式（实验性，需要 LLM 支持） ───

async function runWithMessagesMode(
  agent: any,
  inputMessages: BaseMessage[],
  rawTools: unknown[],
  guard: LoopGuard,
  send: SSESender,
  recursionLimit: number,
  signal: AbortSignal,
): Promise<{ finalText: string; totalToolCalls: number; toolResults: ToolResultEntry[] }> {
  let finalAssistantText = "";
  let totalToolCalls = 0;
  let lastToolCallName = "";
  const toolResults: ToolResultEntry[] = [];

  try {
    const agentStream = await agent.stream(
      { messages: inputMessages },
      { signal, streamMode: "messages", recursionLimit }
    );

    for await (const rawEvent of agentStream) {
      // LangGraph messages 模式返回 StreamMessageOutput = [BaseMessage, metadata]
      const event = rawEvent as any[];
      let message: any;
      if (Array.isArray(event) && event.length === 2) {
        message = event[0];
      } else if (Array.isArray(event) && event.length === 3 && event[1] === "messages") {
        message = Array.isArray(event[2]) ? event[2][0] : event[2];
      } else {
        continue;
      }

      if (!message) continue;

      if (message instanceof ToolMessage) {
        const resultStr = extractToolContent(message.content);
        send("tool_end", {
          toolName: lastToolCallName || "unknown",
          result: resultStr,
          success: !resultStr.includes("LoopGuardError") && !resultStr.includes("Tool not found"),
        });
        guard.recordToolResult(lastToolCallName || "unknown", resultStr.slice(0, 200));
        toolResults.push({ toolName: lastToolCallName || "unknown", result: resultStr.slice(0, 3000) });

      } else if (isBaseMessageChunk(message) || message instanceof AIMessageChunk) {
        const aiChunk = message as AIMessageChunk;

        const rawToolCalls = (aiChunk as any).tool_calls || aiChunk.additional_kwargs?.tool_calls;
        if (rawToolCalls?.length > 0) {
          for (const tc of rawToolCalls) {
            lastToolCallName = tc.name || tc.function?.name || "unknown";
            send("tool_start", { toolName: lastToolCallName, arguments: JSON.stringify(tc.args || {}) });
            totalToolCalls++;
          }
        } else if (aiChunk.content && typeof aiChunk.content === "string" && aiChunk.content.length > 0) {
          send("delta", { content: aiChunk.content });
          finalAssistantText += aiChunk.content;
        } else if ((aiChunk as any).additional_kwargs?.thinking) {
          send("thinking", { content: (aiChunk as any).additional_kwargs.thinking });
        }

      } else if (message instanceof AIMessage) {
        const aiMsg = message as AIMessage;

        guard.incrementTurn();
        const stopCheck = guard.shouldStop();
        if (stopCheck.stop) {
          send("delta", { content: `\n\n[${stopCheck.reason}]` });
          break;
        }

        // thinking（来自最终完整消息）
        if ((aiMsg as any).additional_kwargs?.thinking) {
          send("thinking", { content: (aiMsg as any).additional_kwargs.thinking });
        }
      }
    }
  } catch (err: any) {
    // messages 模式失败，降级到 values 模式
    console.warn("[agentRunner] messages mode failed, falling back to values mode:", err.message);
    return runWithValuesMode(agent, inputMessages, rawTools, guard, send, recursionLimit, signal);
  }

  return { finalText: finalAssistantText, totalToolCalls, toolResults };
}
