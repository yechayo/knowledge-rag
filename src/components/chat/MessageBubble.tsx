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