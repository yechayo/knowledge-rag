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