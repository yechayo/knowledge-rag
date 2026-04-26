"use client";

interface ToolCallBlock {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  input: Record<string, unknown>;
  result?: string;
}

interface MessageBubbleProps {
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    thinking?: string | string[];
    thinkingComplete?: boolean;
    toolCalls?: ToolCallBlock[];
    isComplete?: boolean;
    error?: string;
  };
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.role === "assistant" && !message.isComplete;
  const hasError = !!message.error;
  const toolCalls = message.toolCalls || [];
  const thinkingBlocks: string[] = Array.isArray(message.thinking)
    ? message.thinking
    : message.thinking ? [message.thinking] : [];

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <div className="max-w-[70%] px-4 py-2.5 rounded-2xl rounded-br-md bg-[var(--accent)] text-white text-sm leading-relaxed">
          {message.content}
        </div>
      ) : (
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

          {/* Error state */}
          {hasError ? (
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
              {message.error}
            </div>
          ) : (
            <>
              {/* Thinking content - 每轮思考独立显示 */}
              {thinkingBlocks.length > 0 && thinkingBlocks.map((block, i) => (
                <details key={i} className="mb-2" open={!message.thinkingComplete}>
                  <summary className="cursor-pointer text-xs text-[var(--text-3)] hover:text-[var(--text-2)] px-1 select-none">
                    💭 思考过程{thinkingBlocks.length > 1 ? ` #${i + 1}` : ""}
                  </summary>
                  <div className="mt-1 px-3 py-2 rounded-xl rounded-bl-md bg-[var(--accent)]/5 border border-[var(--accent)]/20 text-xs text-[var(--text-2)] leading-relaxed whitespace-pre-wrap font-mono">
                    {block}
                  </div>
                </details>
              ))}

              {/* Text content */}
              <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-[var(--card)] border border-[var(--border)] text-[var(--text-1)] text-sm leading-relaxed">
                {message.content}
                {isStreaming && (
                  <span className="inline-block w-2 h-4 ml-1 bg-[var(--text-2)] animate-pulse" />
                )}
              </div>

              {/* Tool call blocks */}
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
