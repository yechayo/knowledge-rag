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