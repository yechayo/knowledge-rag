"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import MessageBubble from "./MessageBubble";
import {
  createAssistantChatMessage,
  reduceAssistantStreamEvent,
  type ChatMessage,
  type UserChatMessage,
} from "./chatState";

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionKeyRef = useRef(`rag:chat:${Date.now()}`);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const applyAssistantEvent = useCallback((assistantId: string, event: { type: string; data?: unknown }) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.role !== "assistant" || message.id !== assistantId) {
          return message;
        }
        return reduceAssistantStreamEvent(message, event);
      })
    );
  }, []);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: UserChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      isComplete: true,
    };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage = createAssistantChatMessage(assistantId);

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionKey: sessionKeyRef.current,
        }),
      });

      if (!res.ok) {
        applyAssistantEvent(assistantId, {
          type: "error",
          data: { message: "抱歉，服务出现异常，请稍后再试。" },
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        applyAssistantEvent(assistantId, {
          type: "error",
          data: { message: "抱歉，无法读取响应。" },
        });
        return;
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        while (buffer.includes("\n\n")) {
          const eventEnd = buffer.indexOf("\n\n");
          const eventBlock = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          const dataParts: string[] = [];
          for (const line of eventBlock.split("\n")) {
            if (line.startsWith("data:")) {
              dataParts.push(line.slice(5).trim());
            }
          }

          if (dataParts.length === 0) continue;

          try {
            const parsed = JSON.parse(dataParts.join(""));
            if (!parsed.type) continue;

            if (parsed.type === "init" && parsed.data?.sessionKey) {
              sessionKeyRef.current = parsed.data.sessionKey;
              continue;
            }

            applyAssistantEvent(assistantId, parsed);
          } catch {
            // Ignore malformed SSE event blocks and continue streaming.
          }
        }
      }
    } catch {
      applyAssistantEvent(assistantId, {
        type: "error",
        data: { message: "网络错误，请检查网络连接后重试。" },
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed bottom-24 right-6 z-50 flex h-[460px] w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[34px]"
      style={{
        background: "var(--card)",
        border: "3px solid var(--border)",
        boxShadow: "var(--island-shadow-press)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "var(--island-yellow)", borderBottom: "3px solid #e6bb2c" }}
      >
        <h3 className="text-sm font-black text-[var(--island-on-warm)]">知识岛助手</h3>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--island-on-warm)] transition-colors hover:bg-white/30"
          aria-label="关闭"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ background: "var(--island-paper-white)" }}>
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm font-bold text-[var(--text-3)]">你好！有什么可以帮你的吗？</p>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} className="mb-3">
            <MessageBubble message={message} assistantLabel="知识助手" />
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <div className="px-3 py-3" style={{ background: "var(--island-paper-soft)", borderTop: "3px solid #e8dcc8" }}>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题..."
            disabled={isLoading}
            className="flex-1 rounded-full border-[3px] border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-sm font-bold text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
            style={{ boxShadow: "var(--island-shadow-press-small)" }}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-opacity disabled:opacity-50"
            style={{ boxShadow: "0 4px 0 var(--island-teal-deep)" }}
            aria-label="发送"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
