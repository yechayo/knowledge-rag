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
  timestamp: number;
}

export default function AgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentAssistantId, setCurrentAssistantId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string>(() => `agent:chat:${Math.random().toString(36).substring(2, 15)}`);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const contentBufferRef = useRef<{ [assistantId: string]: string }>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolIdCounterRef = useRef(0);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      toolCalls: [],
      isComplete: true,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantId = `assistant-${Date.now()}`;
    setCurrentAssistantId(assistantId);
    const assistantMsg: AgentMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolCalls: [],
      isComplete: false,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, assistantMsg]);

    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, sessionKey }),
        signal: abortControllerRef.current.signal,
      });

      if (!res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isComplete: true, error: "请求失败" } : m
          )
        );
        return;
      }

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
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            if (!data.type) continue;

            if (data.type === "init") {
              if (data.data?.sessionKey) setSessionKey(data.data.sessionKey);
            } else if (data.type === "delta") {
              const current = contentBufferRef.current[assistantId] || "";
              contentBufferRef.current[assistantId] = current + (data.data?.content || "");

              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: contentBufferRef.current[assistantId] || m.content }
                      : m
                  )
                );
              }, 50);
            } else if (data.type === "tool_start") {
              const toolBlock: ToolCallBlock = {
                id: `tool-${++toolIdCounterRef.current}`,
                name: data.data?.toolName || "unknown",
                status: "running",
                input: JSON.parse(data.data?.arguments || "{}"),
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, toolCalls: [...m.toolCalls, toolBlock] }
                    : m
                )
              );
            } else if (data.type === "tool_end") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const toolIndex = m.toolCalls.findIndex((tc) => tc.status === "running");
                  if (toolIndex === -1) return m;
                  const newToolCalls = [...m.toolCalls];
                  newToolCalls[toolIndex] = {
                    ...newToolCalls[toolIndex],
                    status: data.data?.success !== false ? "done" : "error",
                    result:
                      typeof data.data?.result === "string"
                        ? data.data.result
                        : JSON.stringify(data.data?.result),
                  };
                  return { ...m, toolCalls: newToolCalls };
                })
              );
            } else if (data.type === "done") {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, isComplete: true } : m))
              );
            } else if (data.type === "error") {
              const errorMsg = typeof data.data === "string"
                ? data.data
                : data.data?.message || "Unknown error";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, isComplete: true, error: errorMsg } : m
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
            m.id === assistantId ? { ...m, isComplete: true, error: "请求已取消" } : m
          )
        );
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, isComplete: true, error: "连接失败" } : m
          )
        );
      }
    } finally {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      contentBufferRef.current[assistantId] = "";
      setIsLoading(false);
      setCurrentAssistantId(null);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, sessionKey]);

  const startNewSession = useCallback(() => {
    if (isLoading) {
      abortControllerRef.current?.abort();
    }
    setMessages([]);
    setSessionKey(`agent:chat:${Math.random().toString(36).substring(2, 15)}`);
  }, [isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-base font-semibold text-[var(--text-1)]">Agent 对话</h2>
        <button
          onClick={startNewSession}
          disabled={isLoading}
          className="rounded-md px-3 py-1.5 text-xs text-[var(--text-3)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-1)] disabled:opacity-50"
        >
          新建会话
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--text-3)]">
              你好！我是 AI Agent，可以帮助你管理知识库、查询文档等。
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Loading indicator */}
        {isLoading && !currentAssistantId && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 px-3 py-2">
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--text-3)] [animation-delay:0ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--text-3)] [animation-delay:150ms]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--text-3)] [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
            disabled={isLoading}
            rows={3}
            className="flex-1 resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent)] text-white transition-opacity disabled:opacity-50"
            aria-label="发送"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
