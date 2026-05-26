"use client";

import { useState } from "react";
import {
  buildChatJumpHref,
  renderChatMarkdownToHtml,
} from "./chatMarkdown";
import type {
  ChatSource,
  ChatTimelineStep,
} from "./chatState";

interface MessageBubbleProps {
  assistantLabel?: string;
  message: {
    id: string;
    role: "user" | "assistant";
    content: string;
    timeline?: ChatTimelineStep[];
    traceSteps?: ChatTimelineStep[];
    sources?: ChatSource[];
    isComplete?: boolean;
    error?: string;
  };
}

function AssistantMarkdownContent({
  content,
  sources,
}: {
  content: string;
  sources?: ChatSource[];
}) {
  const html = renderChatMarkdownToHtml(content);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest("a[data-ref-href]") as HTMLAnchorElement | null;
    if (!link) return;

    event.preventDefault();
    event.stopPropagation();

    const href = link.dataset.refHref || link.getAttribute("href") || "";
    const label = link.dataset.refLabel || link.textContent || href;
    window.location.href = buildChatJumpHref(href, label, sources);
  };

  return (
    <div
      className="chat-markdown"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function TimelineItem({
  step,
  sources,
}: {
  step: ChatTimelineStep;
  sources?: ChatSource[];
}) {
  const [isOpen, setIsOpen] = useState(step.defaultOpen);
  const isAnswer = step.type === "delta";
  const isRunning = step.status === "running";
  const isError = step.status === "error";

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className={`group rounded-xl border px-3 py-2 ${
        isAnswer
          ? "border-[#e8dcc8] bg-[var(--island-paper-soft)] shadow-[0_2px_0_var(--island-sand-deep)]"
          : isError
          ? "border-red-500/25 bg-red-500/5"
          : "border-[var(--border)] bg-[var(--card)]"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs outline-none [&::-webkit-details-marker]:hidden">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            isError
              ? "bg-red-500"
              : isRunning
              ? "animate-pulse bg-[var(--accent)]"
              : "bg-[var(--text-3)]"
          }`}
        />
        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-1)]">
          {step.title}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--text-3)]">
          {statusLabel(step.status)}
        </span>
        <span
          className={`shrink-0 text-[10px] text-[var(--text-3)] transition-transform ${
            isOpen ? "rotate-90" : ""
          }`}
          aria-hidden="true"
        >
          &gt;
        </span>
      </summary>

      {isAnswer ? (
        <div className="mt-2 text-sm leading-relaxed text-[var(--text-1)]">
          {step.content ? (
            <AssistantMarkdownContent content={step.content} sources={sources} />
          ) : (
            <span className="text-[var(--text-3)]">等待回答输出...</span>
          )}
        </div>
      ) : step.detail ? (
        <div className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-[var(--bg)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--text-2)]">
          {step.detail}
        </div>
      ) : (
        <div className="mt-2 text-xs text-[var(--text-3)]">无详细内容</div>
      )}
    </details>
  );
}

function Timeline({
  steps,
  sources,
}: {
  steps: ChatTimelineStep[];
  sources?: ChatSource[];
}) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-1.5">
      {steps.map((step) => (
        <TimelineItem key={step.id} step={step} sources={sources} />
      ))}
    </div>
  );
}

export default function MessageBubble({
  assistantLabel = "Agent",
  message,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.role === "assistant" && !message.isComplete;
  const timeline = getTimeline(message);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <div className="max-w-[70%] rounded-[20px] rounded-br-md border-2 border-[#7adfd7] bg-[var(--accent)] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white shadow-[0_3px_0_var(--island-teal-deep)]">
          {message.content}
        </div>
      ) : (
        <div className="w-full max-w-[85%]">
          <div className="mb-1.5 flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] shadow-[0_2px_0_var(--island-teal-deep)]">
              <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-[var(--text-2)]">{assistantLabel}</span>
            {isStreaming && <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />}
          </div>

          {timeline.length > 0 ? (
            <Timeline steps={timeline} sources={message.sources} />
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text-3)]">
              等待响应...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getTimeline(message: MessageBubbleProps["message"]): ChatTimelineStep[] {
  if (message.timeline?.length) return message.timeline;
  if (message.traceSteps?.length) return message.traceSteps;

  if (message.content) {
    return [{
      id: `${message.id}-answer`,
      type: "delta",
      title: "最终回答",
      status: message.isComplete ? "done" : "running",
      defaultOpen: true,
      timestampIndex: 1,
      content: message.content,
    }];
  }

  if (message.error) {
    return [{
      id: `${message.id}-error`,
      type: "error",
      title: "发生错误",
      status: "error",
      defaultOpen: false,
      timestampIndex: 1,
      detail: message.error,
    }];
  }

  return [];
}

function statusLabel(status: ChatTimelineStep["status"]): string {
  if (status === "running") return "运行中";
  if (status === "done") return "完成";
  if (status === "error") return "错误";
  return "等待";
}
