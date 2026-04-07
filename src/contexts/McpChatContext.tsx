"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

const MCP_PROXY_URL = "/api/mcp-proxy";

// 固定的会话 Key
const FIXED_SESSION_KEY = "agent:main:main";

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

// MCP JSON-RPC 类型
interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: any;
  id?: number | string;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

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

  const requestIdRef = useRef<number>(1);

  // 发送 MCP 请求的辅助函数
  const sendRequest = useCallback(async <T,>(
    method: string,
    params?: any
  ): Promise<T> => {
    const id = requestIdRef.current++;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
      const response = await fetch(MCP_PROXY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
          params,
          id,
        } as JsonRpcRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MCP 请求失败 (${response.status}): ${errorText}`);
      }

      // 解析 SSE 格式的响应
      const text = await response.text();
      const lines = text.split("\n");

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data) {
            const json: JsonRpcResponse = JSON.parse(data);
            if (json.error) {
              throw new Error(`MCP 错误: ${json.error.message}`);
            }
            return json.result as T;
          }
        }
      }

      throw new Error("无效的响应格式");
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MCP 请求超时: ${method}`);
      }
      throw error;
    }
  }, []);

  // 刷新会话列表 - 内部版本
  const refreshSessionsInternal = useCallback(async () => {
    try {
      interface ListSessionsResult {
        content: Array<{ type: string; text: string }>;
      }

      const result = await sendRequest<ListSessionsResult>("tools/call", {
        name: "list_sessions",
        arguments: {},
      });

      const text = result?.content?.[0]?.type === "text"
        ? result.content[0].text
        : "[]";

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error("[MCP] 解析会话列表失败:", text.substring(0, 200));
        return;
      }

      const sessionList = data.sessions || data || [];
      setState(s => ({ ...s, sessions: sessionList }));
    } catch (error) {
      console.error("[MCP] 获取会话列表失败:", error);
    }
  }, [sendRequest]);

  // 连接 MCP Server
  const connect = useCallback(async () => {
    setState(s => ({ ...s, isConnecting: true, error: null }));

    try {
      // 发送初始化请求
      try {
        await sendRequest<{
          protocolVersion: string;
          capabilities: { tools?: any };
          serverInfo: { name: string; version: string };
        }>("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "admin-chat", version: "1.0.0" },
        });

        // 发送 initialized 通知
        fetch(MCP_PROXY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {},
          }),
        }).catch(() => {});
      } catch (initError) {
        // 如果是"已初始化"错误，也视为连接成功
        if (initError instanceof Error && initError.message.includes("already initialized")) {
          // 静默处理
        } else {
          throw initError;
        }
      }

      setState(s => ({ ...s, isConnected: true, isConnecting: false }));

      // 加载会话列表
      await refreshSessionsInternal();
    } catch (error) {
      console.error("[MCP] 连接失败:", error);
      setState(s => ({
        ...s,
        isConnected: false,
        isConnecting: false,
        error: error instanceof Error ? error.message : "连接失败"
      }));
    }
  }, [sendRequest, refreshSessionsInternal]);

  // 刷新会话列表 - 暴露给外部
  const refreshSessions = useCallback(async () => {
    await refreshSessionsInternal();
  }, [refreshSessionsInternal]);

  // 创建新会话
  const createSession = useCallback(async (label?: string) => {
    interface CreateSessionResult {
      content: Array<{ type: string; text: string }>;
    }

    try {
      const result = await sendRequest<CreateSessionResult>("tools/call", {
        name: "create_session",
        arguments: { label: label || `会话 ${Date.now()}` },
      });

      const text = result?.content?.[0]?.type === "text"
        ? result.content[0].text
        : "{}";

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        console.error("[MCP] 解析会话响应失败:", text.substring(0, 200));
        throw new Error(`解析会话响应失败: ${text.substring(0, 100)}`);
      }

      await refreshSessionsInternal();

      const sessionKey = data.sessionKey || data.key;
      setState(s => ({
        ...s,
        currentSession: { sessionKey, label: label || "新会话", createdAt: Date.now() }
      }));

      return sessionKey;
    } catch (error) {
      console.error("[MCP] 创建会话失败:", error);
      throw error;
    }
  }, [sendRequest, refreshSessionsInternal]);

  // 选择会话
  const selectSession = useCallback(async (sessionKey: string) => {
    const session = state.sessions.find(sess => sess.sessionKey === sessionKey);

    // 加载该会话的历史消息
    try {
      interface GetMessagesResult {
        content: Array<{ type: string; text: string }>;
      }

      const result = await sendRequest<GetMessagesResult>("tools/call", {
        name: "get_messages",
        arguments: { sessionKey, limit: 50 },
      });

      const text = result?.content?.[0]?.type === "text"
        ? result.content[0].text
        : "{}";

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }

      const messages = Array.isArray(data) ? data : data.messages || [];

      // 转换消息格式
      const chatMessages: ChatMessage[] = messages
        .filter((m: any) => m.role === "user" || m.role === "assistant")
        .map((m: any, index: number) => {
          let contentStr = "";
          const content = m.content;

          if (typeof content === 'string') {
            contentStr = content;
          } else if (Array.isArray(content)) {
            const textParts = content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text);
            contentStr = textParts.join("\n");
          } else if (content?.text) {
            contentStr = content.text;
          }

          return {
            id: `msg-${index}`,
            role: m.role as "user" | "assistant",
            content: contentStr,
            timestamp: m.timestamp || Date.now(),
          };
        });

      setState(s => ({
        ...s,
        currentSession: session || null,
        messages: chatMessages,
      }));
    } catch (error) {
      console.error("[MCP] 加载历史消息失败:", error);
      setState(s => ({
        ...s,
        currentSession: session || null,
        messages: [],
      }));
    }
  }, [state.sessions, sendRequest]);

  // 删除会话
  const deleteSession = useCallback(async (sessionKey: string) => {
    await sendRequest("tools/call", {
      name: "delete_session",
      arguments: { sessionKey },
    });

    setState(s => ({
      ...s,
      sessions: s.sessions.filter(sess => sess.sessionKey !== sessionKey),
      currentSession: s.currentSession?.sessionKey === sessionKey ? null : s.currentSession
    }));
  }, [sendRequest]);

  // 内部发送消息方法
  const sendMcpMessage = useCallback(async (content: string) => {
    if (!state.currentSession) return;

    interface SendMessageResult {
      content: Array<{ type: string; text: string }>;
    }

    try {
      await sendRequest<SendMessageResult>("tools/call", {
        name: "send_message",
        arguments: { sessionKey: state.currentSession.sessionKey, content },
      });
    } catch (sendError) {
      console.error("[MCP] send_message 失败:", sendError);
      throw sendError;
    }

    // 记录我们发送的消息内容，用于后续匹配
    const myMessageContent = content;

    // 轮询获取 AI 回复
    const pollInterval = setInterval(async () => {
      try {
        interface GetMessagesResult {
          content: Array<{ type: string; text: string }>;
        }

        // 获取消息
        const result = await sendRequest<GetMessagesResult>("tools/call", {
          name: "get_messages",
          arguments: {
            sessionKey: state.currentSession!.sessionKey,
            limit: 50,
          },
        });

        const text = result?.content?.[0]?.type === "text"
          ? result.content[0].text
          : "{}";

        let data;
        try {
          data = JSON.parse(text);
        } catch (parseError) {
          return;
        }

        const messages = Array.isArray(data) ? data : data.messages || [];

        // 找我们自己发送的用户消息
        const myUserMsg = messages.find((m: any) => {
          if (m.role !== "user") return false;
          const msgContent = Array.isArray(m.content)
            ? m.content.find((c: any) => c.type === "text")?.text
            : m.content;
          return msgContent === myMessageContent;
        });

        if (!myUserMsg) {
          return; // 还没看到我们自己的消息，继续等待
        }

        const myMsgIndex = messages.indexOf(myUserMsg);

        // 找我的消息之后的第一条真正的 assistant 回复（不是 announce）
        let assistantMsg = null;
        for (let i = myMsgIndex + 1; i < messages.length; i++) {
          const m = messages[i];
          if (m.role !== "assistant" || !m.content) continue;

          // 检查是否是真正的回复（不是 announce/skip）
          const contentStr = Array.isArray(m.content)
            ? m.content.find((c: any) => c.type === "text")?.text || ""
            : (typeof m.content === "string" ? m.content : "");

          if (!contentStr.includes("ANNOUNCE_SKIP") && !contentStr.includes("announce")) {
            assistantMsg = m;
            break;
          }
        }

        if (assistantMsg) {
          clearInterval(pollInterval);

          // 提取文本内容
          let contentStr = "";
          const msgContent = assistantMsg.content;

          if (typeof msgContent === 'string') {
            contentStr = msgContent;
          } else if (Array.isArray(msgContent)) {
            const textParts = msgContent
              .filter((c: any) => c.type === "text" && c.text && !c.text.includes("SKIP") && !c.text.includes("announce"))
              .map((c: any) => c.text);
            contentStr = textParts.join("\n");
          } else if (msgContent?.text) {
            contentStr = msgContent.text;
          }

          if (contentStr) {
            const aiMessage: ChatMessage = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: contentStr,
              timestamp: Date.now(),
            };

            setState(s => ({
              ...s,
              messages: [...s.messages.filter(m => m.role === "user"), aiMessage],
              isLoadingResponse: false,
            }));
          }
        }
      } catch (error) {
        console.error("Poll error:", error);
        clearInterval(pollInterval);
        setState(s => ({ ...s, isLoadingResponse: false, error: "获取回复失败" }));
      }
    }, 2000);
  }, [state.currentSession, sendRequest]);

  // 发送消息
  const sendMessage = useCallback(async (content: string) => {
    if (!state.currentSession) return;

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

    try {
      await sendMcpMessage(content);
    } catch (error) {
      console.error("[MCP] 发送消息失败:", error);
      setState(s => ({
        ...s,
        isLoadingResponse: false,
        error: "发送失败"
      }));
    }
  }, [state.currentSession, sendMcpMessage]);

  // 断开连接
  const disconnect = useCallback(() => {
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
