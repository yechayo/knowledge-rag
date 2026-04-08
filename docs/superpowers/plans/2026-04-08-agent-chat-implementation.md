# Agent Chat 界面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 实现 Phase 1 — 端到端 SSE 流式对话界面，包括 executor 改造、Admin Chat prompt、流式 API、前端组件（AgentChat + MessageBubble + ToolCallBlock）、Tab 容器。

**架构：** 流式 API 使用 LangGraph `stream()` 模式逐个产出 chunk，通过 `ReadableStream` + SSE 格式推送到前端。前端 `AgentChat` 组件消费 SSE，实时渲染流式消息。

**技术栈：** Next.js 16 App Router, TypeScript, Tailwind CSS, Prisma, SSE, LangGraph `@langchain/langgraph/prebuilt`

---

## 文件结构

```
src/
├── app/
│   └── api/agent/
│       └── stream/route.ts          # 新建: SSE 流式端点
├── components/
│   ├── admin/
│   │   └── AgentChat.tsx            # 新建: 对话主组件
│   └── chat/
│       └── MessageBubble.tsx        # 改造: 支持流式 + 工具调用
└── lib/agent/
    ├── executor.ts                  # 改造: 抽取 executor 创建逻辑
    └── prompts/
        └── admin_chat.ts            # 新建: Admin Agent 对话 prompt
```

---

## Task 1: 改造 executor.ts — 抽取 executor 创建逻辑

**Files:**
- Modify: `src/lib/agent/executor.ts`

**Context:** 现有 `createNewsAgentExecutor()` 硬编码了 `NEWS_AGENT_PROMPT`。需要抽取通用逻辑，支持动态 prompt 参数。

- [ ] **Step 1: 阅读现有代码**

确认 `createNewsAgentExecutor` 的完整实现（已在上文读取）：
- LLM: `createGLM5({ temperature: 0.7, maxTokens: 4000 })`
- Agent: `createReactAgent({ llm, tools, prompt: getSystemPrompt(NEWS_AGENT_PROMPT) })`
- Executor: `createAgentExecutor({ agentRunnable: agent, tools })`
- tools: `any[]` 类型，包含 `duckduckgoSearch, createContent, listContent, deleteContent`

- [ ] **Step 2: 抽取 `createAgentExecutorCore(tools, systemPrompt)` 函数**

```typescript
// 在 executor.ts 中添加:

async function createAgentExecutorCore(
  tools: any[],
  systemPrompt: string
) {
  const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });
  const agent = await createReactAgent({
    llm,
    tools,
    prompt: getSystemPrompt(systemPrompt),
  });
  return createAgentExecutor({ agentRunnable: agent, tools });
}
```

- [ ] **Step 3: 改造 `createNewsAgentExecutor` 复用通用逻辑**

```typescript
export async function createNewsAgentExecutor() {
  const tools: any[] = [duckduckgoSearch, createContent, listContent, deleteContent];
  return createAgentExecutorCore(tools, NEWS_AGENT_PROMPT);
}
```

- [ ] **Step 4: 导出 `createAgentExecutorCore`**

在文件底部添加导出（如果尚未存在）：`export { createAgentExecutorCore };`

- [ ] **Step 5: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent/executor.ts
git commit -m "refactor: extract executor creation logic for dynamic prompt"
```

---

## Task 2: 创建 Admin Chat prompt 文件

**Files:**
- Create: `src/lib/agent/prompts/admin_chat.ts`

**Context:** 需要一个通用的 Admin Agent system prompt，供流式对话使用。

- [ ] **Step 1: 创建 prompt 文件**

```typescript
/**
 * Admin Agent 通用对话 prompt
 */

export const ADMIN_CHAT_PROMPT = `你是一个 Admin Agent，负责帮助管理员管理网站内容。

核心能力：
- 使用 duckduckgo_search 搜索互联网信息
- 使用 create_content 创建网站内容（文章、新闻、页面等）
- 使用 list_content 查询现有内容列表
- 使用 delete_content 删除不需要的内容

工作原则：
- 主动理解用户意图，用户没有明确要求时不要随意创建/删除内容
- 创建内容前先向用户确认关键信息（标题、分类、正文要点）
- 删除内容前必须确认
- 搜索结果要筛选高质量信息，不要堆砌无关内容
- 回答简洁明了，避免冗长

用户可能要求你：
- 搜索特定主题的新闻或资讯
- 发布文章或新闻到网站
- 整理和删除旧内容
- 生成定时任务（如每日新闻早报）
`;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent/prompts/admin_chat.ts
git commit -m "feat: add admin chat prompt for general purpose agent"
```

---

## Task 3: 实现 `/api/agent/stream` SSE 端点

**Files:**
- Create: `src/app/api/agent/stream/route.ts`

**Context:** 核心流式 API。接收用户消息，返回 SSE 流。需处理：Session 管理、Agent 执行（stream 模式）、SSE 事件发送、锁管理。

- [ ] **Step 1: 创建流式端点**

```typescript
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAgentExecutorCore } from "@/lib/agent/executor";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "@/lib/agent/tools";
import { getOrCreateSession, acquireSessionLock, appendSessionMessage } from "@/lib/agent/session";
import { ADMIN_CHAT_PROMPT } from "@/lib/agent/prompts/admin_chat";

// 管理员认证
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) throw new Error("Unauthorized");
  return session;
}

// 发送 SSE 事件的辅助函数
function sseEvent(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// 生成唯一 ID
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

export async function POST(req: NextRequest) {
  // 认证
  try {
    await requireAdmin();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json();
  const { message, sessionKey } = body;

  if (!message || typeof message !== "string") {
    return new Response("message is required", { status: 400 });
  }

  // 创建或获取 Session
  const sk = sessionKey || `agent:chat:${generateId()}`;
  const agentSession = await getOrCreateSession(sk, "chat", "admin");

  // 尝试获取锁
  const lock = await acquireSessionLock(agentSession.id, "admin");
  if (!lock) {
    return new Response("Agent is busy", { status: 409 });
  }

  // 持久化用户消息
  await appendSessionMessage(agentSession.id, "user", message, "admin");

  // 构建 SSE 流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        // 发送 init
        send("init", { sessionKey: sk, sessionId: agentSession.id });

        // 创建 Agent
        const tools: any[] = [duckduckgoSearch, createContent, listContent, deleteContent];
        const executor = await createAgentExecutorCore(tools, ADMIN_CHAT_PROMPT);

        // 使用 stream() 模式
        const input = { messages: [{ role: "user", content: message }] };
        let accumulatedContent = "";
        let finalResult = "";

        // 工具调用跟踪：pending tool_calls 在这里注册，已完成的工具结果在这里查找
        const pendingTools: Map<string, string> = new Map(); // toolCallId -> toolName
        const toolResults: Map<string, string> = new Map(); // toolCallId -> result

        for await (const chunk of executor.stream(input)) {
          // chunk 结构说明:
          // LangGraph prebuilt ReAct agent stream() yields chunks，其中:
          // - AIMessage 带 tool_calls: 表示 LLM 决定调用工具 -> 发送 tool_start
          // - ToolMessage 带 content (string): 表示工具执行结果 -> 发送 tool_end (带实际结果)
          // - AIMessage 带 content (string): 表示 LLM 的文字回复 -> 发送 delta
          for (const [key, value] of Object.entries(chunk)) {
            if (!value || typeof value !== "object") continue;

            const msg = value as Record<string, unknown>;
            const content = msg.content as string | unknown[];
            const toolCalls = msg.tool_calls as Array<{ name?: string; args?: Record<string, unknown>; id?: string }> | undefined;
            const lcName = msg.lc_serializable as string || (msg as any).lc_name;

            // 情况 1: ToolMessage — 工具执行结果
            if (lcName === "ToolMessage" || (msg as any).type === "tool") {
              const toolContent = typeof content === "string" ? content : JSON.stringify(content);
              const toolCallId = (msg as any).tool_call_id as string || key;
              toolResults.set(toolCallId, toolContent);

              // 找到对应的 tool_name 并发送 tool_end
              let toolName = "";
              for (const [tcId, tcName] of pendingTools.entries()) {
                if (toolResults.has(tcId)) {
                  toolName = tcName;
                  pendingTools.delete(tcId);
                  break;
                }
              }
              if (!toolName) toolName = "tool";

              send("tool_end", {
                name: toolName,
                result: toolContent,
                success: true,
              });
              continue;
            }

            // 情况 2: AIMessage 带 tool_calls — LLM 决定调用工具
            if (toolCalls && toolCalls.length > 0) {
              for (const tc of toolCalls) {
                if (tc.name) {
                  const tcId = tc.id || tc.name;
                  pendingTools.set(tcId, tc.name);
                  send("tool_start", {
                    name: tc.name,
                    input: tc.args || {},
                  });
                  // 注意: tool_end 不会在这里发送，会在后续的 ToolMessage chunk 中发送
                }
              }
              continue;
            }

            // 情况 3: AIMessage 带文字内容 — LLM 回复文字
            if (typeof content === "string" && content.trim()) {
              accumulatedContent += content;
              send("delta", { content });
            } else if (Array.isArray(content)) {
              // content 可能是混合数组 (text + tool_use)，逐个处理
              for (const part of content) {
                if (typeof part === "string" && part.trim()) {
                  accumulatedContent += part;
                  send("delta", { content: part });
                } else if (part && typeof part === "object") {
                  const p = part as Record<string, unknown>;
                  if (p.type === "text" && typeof p.text === "string") {
                    accumulatedContent += p.text;
                    send("delta", { content: p.text });
                  }
                  // type="tool_use" 的部分由 tool_calls 处理，跳过
                }
              }
            }

            // 收集最终结果
            if (typeof content === "string") {
              finalResult = content;
            }
          }
        }

        // 如果有未完成的工具调用（理论上不应该发生），发送占位 end
        for (const [tcId, toolName] of pendingTools.entries()) {
          send("tool_end", {
            name: toolName,
            result: toolResults.get(tcId) || "[no result]",
            success: true,
          });
        }

        // 持久化 assistant 消息
        await appendSessionMessage(
          agentSession.id,
          "assistant",
          finalResult || accumulatedContent,
          "admin"
        );

        send("done", { sessionKey: sk });
      } catch (error) {
        console.error("[stream] Agent error:", error);
        send("error", {
          message: error instanceof Error ? error.message : "Agent execution failed",
        });
      } finally {
        await lock.release().catch(console.error);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

> **⚠️ 重要验证步骤（Task 3 完成后必须执行）：**
>
> LangGraph `stream()` 的 chunk 结构取决于具体版本。实现后，在 `for await` 循环内添加临时 `console.log`：
> ```typescript
> console.log("[stream] chunk keys:", Object.keys(chunk));
> console.log("[stream] chunk:", JSON.stringify(chunk).slice(0, 500));
> ```
> 发送一条测试消息，观察控制台输出。验证：
> 1. AIMessage 带 `tool_calls` 时是否能正确发送 `tool_start`
> 2. ToolMessage 出现时是否能正确提取 `content` 并发送 `tool_end`
> 3. `delta` 事件是否能正常输出
>
> 验证通过后，删除临时 console.log 并 commit。

> **注意：** `executor.stream()` 的 chunk 结构需要根据实际 LangGraph 版本验证。上面的遍历逻辑是初始猜测，实现时需打印 chunk 结构并调整。上传前运行 TypeScript 编译检查。

- [ ] **Step 2: 确保 `lib/validations.ts` 中没有 `stream` 相关 schema（不需要额外验证）**

- [ ] **Step 3: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误（可能有类型推断相关的 warning，但不应有 error）

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/stream/route.ts
git commit -m "feat: add SSE streaming endpoint /api/agent/stream"
```

---

## Task 4: 创建 AgentChat 组件

**Files:**
- Create: `src/components/admin/AgentChat.tsx`

**Context:** 对话主组件，管理消息状态和 SSE 连接。消费 `/api/agent/stream`，实时渲染流式消息。

- [ ] **Step 1: 定义类型**

```typescript
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import MessageBubble from "@/components/chat/MessageBubble";

export interface ToolCallBlock {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  input: Record<string, unknown>;
  result?: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCallBlock[];
  isComplete: boolean;
  error?: string;
}
```

- [ ] **Step 2: 状态定义**

```typescript
export default function AgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentAssistantId, setCurrentAssistantId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string>(() => `agent:chat:${Math.random().toString(36).substring(2, 15)}`);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
```

- [ ] **Step 3: 滚动到底部 effect**

```typescript
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
```

- [ ] **Step 4: 发送消息 + SSE 消费逻辑**

```typescript
  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || isLoading) return;

    setInput("");
    setIsLoading(true);

    // 1. 添加用户消息
    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      toolCalls: [],
      isComplete: true,
    };
    setMessages((prev) => [...prev, userMsg]);

    // 2. 创建空的 assistant 消息占位
    const assistantId = `assistant-${Date.now()}`;
    setCurrentAssistantId(assistantId);
    const assistantMsg: AgentMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
      isComplete: false,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    // 3. AbortController 用于取消请求
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, sessionKey }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "请求失败" }));
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, isComplete: true, error: errorData.error || `HTTP ${res.status}` }
              : m
          )
        );
        setIsLoading(false);
        return;
      }

      // 4. SSE 消费
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          // SSE 格式: event: <name>\ndata: <json>\n\n
          // 每行以 "data: " 开头的是数据行
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);

            // data 对象中必须包含 type 字段以区分事件类型
            if (!data.type) continue;

            if (data.type === "init") {
              // 更新 sessionKey
              if (data.sessionKey) setSessionKey(data.sessionKey);
            } else if (data.type === "delta") {
              // 累加文字内容
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + (data.content || "") }
                    : m
                )
              );
            } else if (data.type === "tool_start") {
              // 添加工具调用块
              const toolBlock: ToolCallBlock = {
                id: `tool-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                name: data.name,
                status: "running",
                input: data.input || {},
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, toolCalls: [...m.toolCalls, toolBlock] }
                    : m
                )
              );
            } else if (data.type === "tool_end") {
              // 更新工具调用块
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        toolCalls: m.toolCalls.map((tc) =>
                          tc.name === data.name
                            ? {
                                ...tc,
                                status: data.success !== false ? "done" : "error",
                                result: typeof data.result === "string" ? data.result : JSON.stringify(data.result),
                              }
                            : tc
                        ),
                      }
                    : m
                )
              );
            } else if (data.type === "done") {
              // 标记完成
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, isComplete: true } : m
                )
              );
            } else if (data.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, isComplete: true, error: data.message }
                    : m
                )
              );
            }
          } catch (parseError) {
            console.warn("[AgentChat] Failed to parse SSE data:", parseError);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, isComplete: true, error: "请求已取消" }
              : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, isComplete: true, error: "连接失败" }
              : m
          )
        );
      }
    } finally {
      setIsLoading(false);
      setCurrentAssistantId(null);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, sessionKey]);
```

- [ ] **Step 5: 新会话逻辑**

```typescript
  const startNewSession = useCallback(() => {
    if (isLoading) {
      abortControllerRef.current?.abort();
    }
    setMessages([]);
    setSessionKey(`agent:chat:${Math.random().toString(36).substring(2, 15)}`);
  }, [isLoading]);
```

- [ ] **Step 6: 输入框 KeyDown 处理**

```typescript
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
```

- [ ] **Step 7: 渲染 JSX**

```tsx
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="text-center py-8">
            <p className="text-[var(--text-3)] text-sm">
              开始对话，Agent 将帮你管理网站内容
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && !currentAssistantId && (
          <div className="flex justify-start">
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-[var(--card)] border border-[var(--border)]">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 bg-[var(--text-3)] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-[var(--text-3)] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-[var(--text-3)] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="p-4 border-t border-[var(--border)] bg-[var(--card)]">
        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            disabled={isLoading}
            rows={1}
            className="flex-1 px-4 py-3 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)] text-[var(--text-1)] placeholder:text-[var(--text-3)] disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="px-5 py-3 text-sm font-medium rounded-xl bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
```

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/AgentChat.tsx
git commit -m "feat: add AgentChat component with SSE streaming"
```

---

## Task 5: 改造 MessageBubble — 支持流式 + 工具调用

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx`

**Context:** 当前 `MessageBubble` 只渲染纯文本。需要支持：Agent 消息内联工具调用块、流式进行中的闪烁光标、错误状态展示。

- [ ] **Step 1: 阅读现有代码**

现有 `MessageBubble` 非常简洁（约 25 行），接收 `ChatMessage`（来自 `McpChatContext`）。

- [ ] **Step 2: 导入 Agent 消息类型**

```typescript
// 复用 AgentChat 中定义的类型（通过 prop 类型扩展）
interface ToolCallBlock {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  input: Record<string, unknown>;
  result?: string;
}

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCallBlock[];
  isComplete: boolean;
  error?: string;
}
```

- [ ] **Step 3: 改造 props 接口**

```typescript
// 支持两种消息格式（向后兼容原有的 ChatMessage）
interface MessageBubbleProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    toolCalls?: ToolCallBlock[];
    isComplete?: boolean;
    error?: string;
  };
}
```

- [ ] **Step 4: 改造渲染逻辑**

```typescript
export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.role === "assistant" && !message.isComplete;
  const hasError = !!message.error;

  // 工具调用内联展示
  const toolCalls = message.toolCalls || [];

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        // 用户消息：保持原有样式
        <div className="max-w-[70%] px-4 py-2.5 rounded-2xl rounded-br-md bg-[var(--accent)] text-white text-sm leading-relaxed">
          {message.content}
        </div>
      ) : (
        // Agent 消息：包含工具调用块
        <div className="max-w-[75%] w-full">
          {/* Agent Header */}
          <div className="flex items-center gap-2 mb-1 px-1">
            <div className="w-6 h-6 rounded-full bg-[var(--accent)] flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-[var(--text-2)]">Agent</span>
            {isStreaming && (
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            )}
          </div>

          {/* 错误状态 */}
          {hasError ? (
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
              {message.error}
            </div>
          ) : (
            <>
              {/* 文字内容 */}
              <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-[var(--card)] border border-[var(--border)] text-[var(--text-1)] text-sm leading-relaxed">
                {message.content}
                {isStreaming && (
                  <span className="inline-block w-2 h-4 ml-1 bg-[var(--text-2)] animate-pulse" />
                )}
              </div>

              {/* 工具调用块 */}
              {toolCalls.length > 0 && (
                <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-[var(--accent)]/30">
                  {toolCalls.map((tc) => (
                    <div
                      key={tc.id}
                      className={`text-xs px-3 py-2 rounded-lg border ${
                        tc.status === "error"
                          ? "bg-red-500/5 border-red-500/20"
                          : tc.status === "done"
                          ? "bg-green-500/5 border-green-500/20"
                          : "bg-[var(--card)] border-[var(--border)]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[var(--accent)]">⚡</span>
                        <span className="font-medium text-[var(--text-1)]">{tc.name}</span>
                        {tc.status === "running" && (
                          <span className="text-[var(--text-3)] animate-pulse">运行中...</span>
                        )}
                        {tc.status === "done" && (
                          <span className="text-green-500">✓</span>
                        )}
                        {tc.status === "error" && (
                          <span className="text-red-500">✗</span>
                        )}
                      </div>
                      {tc.status === "done" && tc.result && (
                        <div className="mt-1 text-[var(--text-2)] font-mono whitespace-pre-wrap break-all">
                          {tc.result.length > 300
                            ? tc.result.slice(0, 300) + "..."
                            : tc.result}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/MessageBubble.tsx
git commit -m "feat: enhance MessageBubble with streaming and tool call display"
```

---

## Task 6: 改造 chat/page.tsx — Tab 容器

**Files:**
- Modify: `src/app/admin/chat/page.tsx`

**Context:** 现有页面只渲染 TaskPanel。需要改为左侧 Tab 栏（对话/任务）+ 右侧内容区的布局。

- [ ] **Step 1: 改造 page.tsx**

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/hooks/useAdmin";
import AgentChat from "@/components/admin/AgentChat";
import TaskPanel from "@/components/admin/TaskPanel";

type Tab = "chat" | "tasks";

export default function ChatPage() {
  const router = useRouter();
  const { isAdmin, isLoading } = useAdmin();
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/login");
    }
  }, [isLoading, isAdmin, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-[var(--text-2)]">加载中...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen flex bg-[var(--bg)]">
      {/* 左侧 Tab 栏 */}
      <div className="w-16 flex flex-col items-center py-6 border-r border-[var(--border)] bg-[var(--card)]">
        {/* 标题 */}
        <div className="mb-8 text-center">
          <div className="w-8 h-8 mx-auto rounded-lg bg-[var(--accent)] flex items-center justify-center mb-1">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-[10px] text-[var(--text-3)]">Agent</span>
        </div>

        {/* Tab 按钮 */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => setActiveTab("chat")}
            className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === "chat"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-3)] hover:bg-[var(--bg)] hover:text-[var(--text-1)]"
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-[9px] font-medium">对话</span>
          </button>

          <button
            onClick={() => setActiveTab("tasks")}
            className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
              activeTab === "tasks"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-3)] hover:bg-[var(--bg)] hover:text-[var(--text-1)]"
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <span className="text-[9px] font-medium">任务</span>
          </button>
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "chat" ? <AgentChat /> : <TaskPanel />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 编译检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/chat/page.tsx
git commit -m "feat: transform chat page into tab layout with chat and tasks views"
```

---

## Task 7: 改造 TaskPanel — 暴露 refreshTasks 供外部调用

**Files:**
- Modify: `src/components/admin/TaskPanel.tsx`

**Context:** TaskPanel 当前在 `useEffect` 中自动 fetch 任务。Phase 2 中 SSE `task_update` 事件需要触发任务列表刷新。通过 `onRefreshKey` prop 接收外部刷新信号（Phase 2 由 AgentChat 通过 context/callback 传递）。

> **注：** Phase 1 验收时，`onRefreshKey` 暂不传入，TaskPanel 仅保留首屏自动加载行为。Phase 2 实现 `task_update` 后，Tab 容器会传入刷新信号。

- [ ] **Step 1: 阅读现有代码**

TaskPanel 的 `fetchTasks` 是内部函数。需要通过 `forwardRef` + `useImperativeHandle` 暴露，或改为 `useEffect` 依赖外部刷新信号。

**采用方案：** 将 `fetchTasks` 暴露为导出的函数，通过 `useEffect` 监听刷新，同时暴露刷新触发器。

- [ ] **Step 2: 添加 `onRefreshKey` prop**

```typescript
// 修改接口
interface TaskPanelProps {
  onRefreshKey?: number | string;  // 变化时自动刷新
}
```

- [ ] **Step 3: 添加 useEffect 触发刷新**

```typescript
  // 外部刷新触发
  useEffect(() => {
    if (props.onRefreshKey !== undefined) {
      fetchTasks();
    }
  }, [props.onRefreshKey]);
```

- [ ] **Step 4: 同时保留原有的 useEffect（首次加载）**

原有的 `useEffect(() => { fetchTasks(); }, [])` 保持不变（首屏加载），新增的 `useEffect` 负责外部触发刷新。

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/TaskPanel.tsx
git commit -m "feat: add onRefreshKey prop to TaskPanel for external refresh"
```

---

## Task 8: 端到端验收

**Files:**
- None (验证步骤)

- [ ] **Step 1: TypeScript 全量编译**

Run: `npx tsc --noEmit`
Expected: 零错误

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 所有 route 编译成功，无 error

- [ ] **Step 3: 本地开发测试**（非必需，可选）

Run: `npm run dev`
然后手动验证：
- 打开 `/admin/chat`
- 点击左侧「对话」Tab（默认）
- 输入一条消息，如「你好」
- 确认流式响应正常显示
- 确认 Agent 消息中有工具调用块（如果有）
- 点击左侧「任务」Tab
- 确认任务列表正常显示
- Tab 切换保持对话上下文

---

## 执行顺序

1. Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8
2. 每个 Task 完成后运行 TypeScript 编译检查
3. Task 8（验收）确保全量编译通过
