# OpenClaw 管理聊天窗口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/admin/chat` 路由创建独立聊天页面，连接 OpenClaw MCP WebChat Server，实现网站内容管理。

**Architecture:** 使用 `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport` 直连 MCP Server，SSE 订阅工具执行状态，轮询 `get_messages` 获取 AI 回复。会话状态通过 Context 管理，sessionId/sessionKey 持久化到 localStorage。

**Tech Stack:** Next.js App Router, `@modelcontextprotocol/sdk`, React Context + Hooks, Tailwind CSS v4

---

## 文件结构

```
src/
├── app/
│   └── admin/
│       └── chat/
│           └── page.tsx              # 入口页面
├── components/
│   └── chat/
│       ├── ChatSidebar.tsx           # 左侧会话管理
│       ├── ChatWindow.tsx            # 消息展示区
│       ├── ChatInput.tsx             # 输入组件
│       └── MessageBubble.tsx         # 单条消息
└── contexts/
    └── McpChatContext.tsx            # Context 状态管理（含 MCP 连接逻辑）
```

---

## Task 1: 依赖检查

**Files:**
- Check: `package.json` 确认 `@modelcontextprotocol/sdk` 已安装

- [ ] **Step 1: 检查依赖是否已安装**

```bash
cd knowledge-rag
grep "@modelcontextprotocol/sdk" package.json
```

预期输出：`"@modelcontextprotocol/sdk": "^1.29.0"`

如果未安装，执行：
```bash
pnpm add @modelcontextprotocol/sdk
```

---

## Task 2: 环境变量配置

**Files:**
- Modify: `.env.local` (添加 MCP 配置)
- Modify: `.env.example` (同步更新)

- [ ] **Step 1: 检查现有 .env.example 中的 MCP 变量**

```bash
grep "MCP" .env.example
```

预期输出：`MCP_API_KEY="your_mcp_api_key"`

- [ ] **Step 2: 添加 MCP 环境变量到 .env.local**

```bash
# MCP WebChat Server 配置
NEXT_PUBLIC_MCP_URL=http://your-server:3001/mcp
MCP_API_KEY=your_auth_token
```

注意：`MCP_API_KEY` 与 `.env.example` 保持一致，前端通过 `NEXT_PUBLIC_` 前缀的变量访问服务器 URL。

---

## Task 3: 创建目录结构

**Files:**
- Create: `src/app/admin/chat/` 目录
- Create: `src/contexts/` 目录（如不存在）

- [ ] **Step 1: 创建必要目录**

```bash
mkdir -p src/app/admin/chat
mkdir -p src/contexts
```

---

## Task 4: McpChatContext 完整实现

**Files:**
- Create: `src/contexts/McpChatContext.tsx`

- [ ] **Step 1: 创建完整的 McpChatContext**

```tsx
"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamable-http.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || "http://localhost:3001/mcp";
const AUTH_TOKEN = process.env.MCP_API_KEY || "";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatSession {
  sessionKey: string;
  label: string;
  createdAt: number;
}

interface McpChatState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  messages: ChatMessage[];
  isLoadingResponse: boolean;
}

interface McpChatContextValue extends McpChatState {
  connect: () => Promise<void>;
  disconnect: () => void;
  createSession: (label?: string) => Promise<string>;
  selectSession: (sessionKey: string) => void;
  deleteSession: (sessionKey: string) => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
}

const McpChatContext = createContext<McpChatContextValue | null>(null);

export function McpChatProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<McpChatState>({
    isConnected: false,
    isConnecting: false,
    error: null,
    sessions: [],
    currentSession: null,
    messages: [],
    isLoadingResponse: false,
  });

  const clientRef = useRef<Client | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 连接 MCP Server
  const connect = useCallback(async () => {
    if (clientRef.current) return;

    setState(s => ({ ...s, isConnecting: true, error: null }));

    try {
      const transport = new StreamableHTTPClientTransport({
        url: MCP_URL,
        headers: { "Authorization": `Bearer ${AUTH_TOKEN}` }
      });

      const client = new Client(
        { name: "admin-chat", version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      // 初始化
      await client.request({
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "admin-chat", version: "1.0.0" }
        }
      }, CallToolResultSchema);

      clientRef.current = client;

      setState(s => ({ ...s, isConnected: true, isConnecting: false }));

      // 加载会话列表
      await refreshSessions();
    } catch (error) {
      setState(s => ({
        ...s,
        isConnected: false,
        isConnecting: false,
        error: error instanceof Error ? error.message : "连接失败"
      }));
    }
  }, []);

  // 刷新会话列表
  const refreshSessions = useCallback(async () => {
    if (!clientRef.current) return;

    try {
      const result = await clientRef.current.request({
        method: "tools/call",
        params: { name: "list_sessions", arguments: {} }
      }, CallToolResultSchema);

      const text = result.content[0].type === "text" ? result.content[0].text : "[]";
      const sessionList = JSON.parse(text);

      setState(s => ({ ...s, sessions: sessionList }));
    } catch (error) {
      console.error("Failed to refresh sessions:", error);
    }
  }, []);

  // 创建新会话
  const createSession = useCallback(async (label?: string) => {
    if (!clientRef.current) throw new Error("Not connected");

    const result = await clientRef.current.request({
      method: "tools/call",
      params: { name: "create_session", arguments: { label: label || `会话 ${Date.now()}` } }
    }, CallToolResultSchema);

    const text = result.content[0].type === "text" ? result.content[0].text : "{}";
    const data = JSON.parse(text);

    await refreshSessions();

    const sessionKey = data.sessionKey || data.key;
    setState(s => ({ ...s, currentSession: { sessionKey, label: label || "新会话", createdAt: Date.now() } }));

    return sessionKey;
  }, [refreshSessions]);

  // 选择会话
  const selectSession = useCallback((sessionKey: string) => {
    setState(s => {
      const session = s.sessions.find(sess => sess.sessionKey === sessionKey);
      return { ...s, currentSession: session || null, messages: [] };
    });
  }, []);

  // 删除会话
  const deleteSession = useCallback(async (sessionKey: string) => {
    if (!clientRef.current) return;

    await clientRef.current.request({
      method: "tools/call",
      params: { name: "delete_session", arguments: { sessionKey } }
    }, CallToolResultSchema);

    setState(s => ({
      ...s,
      sessions: s.sessions.filter(sess => sess.sessionKey !== sessionKey),
      currentSession: s.currentSession?.sessionKey === sessionKey ? null : s.currentSession
    }));
  }, []);

  // 发送消息
  const sendMessage = useCallback(async (content: string) => {
    if (!clientRef.current || !state.currentSession) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };

    setState(s => ({
      ...s,
      messages: [...s.messages, userMessage],
      isLoadingResponse: true,
    }));

    // 发送消息到 OpenClaw
    await clientRef.current.request({
      method: "tools/call",
      params: {
        name: "send_message",
        arguments: { sessionKey: state.currentSession.sessionKey, content }
      }
    }, CallToolResultSchema);

    // 轮询获取 AI 回复
    const pollForResponse = async () => {
      const maxAttempts = 30;
      let attempts = 0;

      const poll = async () => {
        if (!clientRef.current) return;

        try {
          const result = await clientRef.current.request({
            method: "tools/call",
            params: {
              name: "get_messages",
              arguments: { sessionKey: state.currentSession!.sessionKey, limit: 5 }
            }
          }, CallToolResultSchema);

          const text = result.content[0].type === "text" ? result.content[0].text : "[]";
          const data = JSON.parse(text);
          const messages = Array.isArray(data) ? data : data.messages || [];

          // 找最新的 assistant 消息
          const assistantMsg = messages.find((m: any) => m.role === "assistant" && m.content);

          if (assistantMsg) {
            const aiMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: assistantMsg.content,
              timestamp: Date.now(),
            };

            setState(s => ({
              ...s,
              messages: [...s.messages.filter(m => m.role === "user"), aiMessage],
              isLoadingResponse: false,
            }));

            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            setState(s => ({
              ...s,
              isLoadingResponse: false,
              error: "响应超时"
            }));
            return;
          }
        } catch (error) {
          console.error("Poll error:", error);
        }
      };

      pollIntervalRef.current = setInterval(poll, 2000);
    };

    pollForResponse();
  }, [state.currentSession]);

  // 断开连接
  const disconnect = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    clientRef.current = null;
    sessionIdRef.current = null;
    setState({
      isConnected: false,
      isConnecting: false,
      error: null,
      sessions: [],
      currentSession: null,
      messages: [],
      isLoadingResponse: false,
    });
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const value: McpChatContextValue = {
    ...state,
    connect,
    disconnect,
    createSession,
    selectSession,
    deleteSession,
    sendMessage,
    refreshSessions,
  };

  return (
    <McpChatContext.Provider value={value}>
      {children}
    </McpChatContext.Provider>
  );
}

export function useMcpChat() {
  const context = useContext(McpChatContext);
  if (!context) {
    throw new Error("useMcpChat must be used within McpChatProvider");
  }
  return context;
}
```

---

## Task 5: ChatSidebar 组件

**Files:**
- Create: `src/components/chat/ChatSidebar.tsx`

- [ ] **Step 1: 创建 ChatSidebar 组件**

```tsx
"use client";

import { useMcpChat } from "@/contexts/McpChatContext";

export default function ChatSidebar() {
  const { sessions, currentSession, isConnected, createSession, selectSession, deleteSession, error } = useMcpChat();

  const statusColor = isConnected ? "bg-green-500" : "bg-red-500";
  const statusText = isConnected ? "已连接" : error ? "连接失败" : "未连接";

  return (
    <aside className="w-60 h-full flex flex-col border-r border-[var(--border)] bg-[var(--card)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border)]">
        <h2 className="font-bold text-lg text-[var(--text-1)]">OpenClaw</h2>
        <div className="flex items-center gap-2 mt-1">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-xs text-[var(--text-3)]">{statusText}</span>
        </div>
      </div>

      {/* 新建会话按钮 */}
      <div className="p-3">
        <button
          onClick={() => createSession()}
          disabled={!isConnected}
          className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          + 新建会话
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {sessions.map((session) => (
          <div
            key={session.sessionKey}
            onClick={() => selectSession(session.sessionKey)}
            className={`px-4 py-3 cursor-pointer border-b border-[var(--border)] transition-colors ${
              currentSession?.sessionKey === session.sessionKey
                ? "bg-[var(--accent-bg)]"
                : "hover:bg-[var(--card-hover)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--text-1)] truncate">
                {session.label || "未命名会话"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteSession(session.sessionKey);
                }}
                className="p-1 text-[var(--text-3)] hover:text-red-500 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
```

---

## Task 6: MessageBubble 组件

**Files:**
- Create: `src/components/chat/MessageBubble.tsx`

- [ ] **Step 1: 创建 MessageBubble 组件**

```tsx
"use client";

import { ChatMessage } from "@/contexts/McpChatContext";

interface MessageBubbleProps {
  message: ChatMessage;
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-[var(--accent)] text-white rounded-br-md"
            : "bg-[var(--card)] border border-[var(--border)] text-[var(--text-1)] rounded-bl-md"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
```

---

## Task 7: ChatInput 组件

**Files:**
- Create: `src/components/chat/ChatInput.tsx`

- [ ] **Step 1: 创建 ChatInput 组件**

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { useMcpChat } from "@/contexts/McpChatContext";

export default function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendMessage, isLoadingResponse, currentSession } = useMcpChat();

  const handleSubmit = async () => {
    if (!input.trim() || !currentSession || isLoadingResponse) return;
    const content = input.trim();
    setInput("");
    await sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, [currentSession]);

  return (
    <div className="p-4 border-t border-[var(--border)] bg-[var(--card)]">
      <div className="flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={currentSession ? "输入消息..." : "请先选择或创建会话"}
          disabled={!currentSession || isLoadingResponse}
          className="flex-1 px-4 py-3 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-xl resize-none focus:outline-none focus:border-[var(--accent)] text-[var(--text-1)] placeholder:text-[var(--text-3)] disabled:opacity-50"
          rows={1}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || !currentSession || isLoadingResponse}
          className="px-5 py-3 text-sm font-medium rounded-xl bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoadingResponse ? (
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
```

---

## Task 8: ChatWindow 组件

**Files:**
- Create: `src/components/chat/ChatWindow.tsx`

- [ ] **Step 1: 创建 ChatWindow 组件**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { useMcpChat } from "@/contexts/McpChatContext";
import MessageBubble from "./MessageBubble";

export default function ChatWindow() {
  const { messages, isLoadingResponse, currentSession } = useMcpChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (!currentSession) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--card)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--text-3)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <p className="text-[var(--text-2)]">选择或创建一个会话开始聊天</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isLoadingResponse && (
          <div className="text-center py-8">
            <p className="text-[var(--text-3)] text-sm">
              开始发送消息，OpenClaw 将通过 MCP 工具管理网站内容
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoadingResponse && (
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
    </div>
  );
}
```

---

## Task 9: Chat 页面入口

**Files:**
- Create: `src/app/admin/chat/page.tsx`

- [ ] **Step 1: 创建聊天页面**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/hooks/useAdmin";
import { McpChatProvider, useMcpChat } from "@/contexts/McpChatContext";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatWindow from "@/components/chat/ChatWindow";
import ChatInput from "@/components/chat/ChatInput";

function ChatContent() {
  const router = useRouter();
  const { isAdmin, isLoading } = useAdmin();
  const { connect, isConnected } = useMcpChat();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/login");
    }
  }, [isLoading, isAdmin, router]);

  useEffect(() => {
    if (isAdmin && !isConnected) {
      connect();
    }
  }, [isAdmin, isConnected, connect]);

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
      <div className="flex-1 flex flex-col max-w-6xl mx-auto">
        <div className="flex-1 flex overflow-hidden rounded-2xl bg-[var(--card)] border border-[var(--border)] m-4">
          <ChatSidebar />
          <div className="flex-1 flex flex-col">
            <ChatWindow />
            <ChatInput />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <McpChatProvider>
      <ChatContent />
    </McpChatProvider>
  );
}
```

---

## Task 10: 测试验证

- [ ] **Step 1: 启动开发服务器**
  ```bash
  cd knowledge-rag && pnpm dev
  ```

- [ ] **Step 2: 访问 /admin/chat 页面**
  - 验证：页面正常加载
  - 验证：显示"未连接"或"连接失败"状态（如果 MCP Server 未启动）
  - 验证：非管理员用户被重定向到登录页

- [ ] **Step 3: 测试连接**
  - 确保 MCP WebChat Server 正在运行
  - 验证：状态变为"已连接"
  - 验证：会话列表加载（或为空）

- [ ] **Step 4: 测试发送消息**
  - 创建新会话
  - 发送测试消息
  - 验证：收到 AI 回复
