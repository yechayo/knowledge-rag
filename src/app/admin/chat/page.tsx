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
      {/* Left Tab Bar */}
      <div className="w-16 flex flex-col items-center py-6 border-r border-[var(--border)] bg-[var(--card)]">
        {/* Title */}
        <div className="mb-8 text-center">
          <div className="w-8 h-8 mx-auto rounded-lg bg-[var(--accent)] flex items-center justify-center mb-1">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <span className="text-[10px] text-[var(--text-3)]">Agent</span>
        </div>

        {/* Tab Buttons */}
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

      {/* Right Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeTab === "chat" ? <AgentChat /> : <TaskPanel />}
      </div>
    </div>
  );
}
