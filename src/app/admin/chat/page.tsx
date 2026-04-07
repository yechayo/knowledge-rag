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