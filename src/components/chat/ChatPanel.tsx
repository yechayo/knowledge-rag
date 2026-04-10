"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Source {
  title: string;
  slug: string;
  category: string;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  contentPreview: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

interface ChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/** 内联引用标记，点击直接跳转来源 */
function InlineRef({
  href,
  label,
  refText,
}: {
  href: string;
  label: string;
  refText?: string;
}) {
  const buildJumpHref = () => {
    try {
      const url = new URL(href, window.location.origin);
      const candidateRef = (refText || label || "").trim().replace(/\.{2,}|…/g, "");
      if (candidateRef && !url.searchParams.has("ref")) {
        url.searchParams.set("ref", candidateRef.slice(0, 140));
      }
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return href;
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.location.href = buildJumpHref();
  };

  return (
    <a
      href={href}
      className="inline-block align-middle mx-0.5 px-1 py-0.5 rounded cursor-pointer text-[var(--accent)] opacity-70 hover:opacity-100 underline underline-offset-2 text-xs leading-none"
      title={label}
      onClick={handleClick}
    >
      {label}
    </a>
  );
}

/** 解析 [[REF:/path/to/article#anchor|缩写内容]] 格式的内联引用 */
function parseInlineRefs(content: string, sources?: Source[]): React.ReactNode[] {
  const refPattern = /\[\[REF:([^|\]]+)\|([^\]]+)\]\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  const resolveRefText = (href: string, label: string) => {
    if (!sources || sources.length === 0) return label;

    try {
      const url = new URL(href, window.location.origin);
      const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "");
      const hashAnchor = decodeURIComponent(url.hash.replace(/^#/, ""));

      const matched = sources.find((s) => {
        const sourcePath = decodeURIComponent(`/${s.category}/${s.slug}`).replace(/\/+$/, "");
        if (sourcePath !== pathname) return false;
        if (!hashAnchor) return true;
        return (s.headingAnchor || "").trim() === hashAnchor;
      });

      if (matched?.contentPreview) return matched.contentPreview;
      if (matched?.headingText) return matched.headingText;
      if (matched?.sectionPath) return matched.sectionPath;

      const loose = sources.find((s) => pathname.includes(`/${s.slug}`));
      if (loose?.contentPreview) return loose.contentPreview;
    } catch {
      // ignore
    }

    return label;
  };

  while ((match = refPattern.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <MarkdownText key={`text-${lastIndex}`} text={content.slice(lastIndex, match.index)} />
      );
    }

    const href = match[1]; // 完整链接，如 /article/react-hooks#usestate基础用法
    const label = match[2]; // 缩写内容

    parts.push(
      <InlineRef
        key={`ref-${match.index}`}
        href={href}
        label={label}
        refText={resolveRefText(href, label)}
      />
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(<MarkdownText key={`text-${lastIndex}`} text={content.slice(lastIndex)} />);
  }

  return parts.length > 0 ? parts : [<MarkdownText key="plain" text={content} />];
}

/** 纯文本片段的 Markdown 渲染（bold、code、code block） */
function MarkdownText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|```[\s\S]*?```)/g);

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const code = part.slice(3, -3).replace(/^\w+\n/, "");
          return (
            <code key={i} className="block rounded bg-[var(--bg)] px-2 py-1 text-xs my-1">
              {code}
            </code>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={i} className="rounded bg-[var(--bg)] px-1 py-0.5 text-xs">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

/** 消息内容渲染：支持内联引用和 Markdown */
function RichMessageContent({ content, sources }: { content: string; sources?: Source[] }) {
  return <span className="whitespace-pre-wrap">{parseInlineRefs(content, sources)}</span>;
}

export default function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const assistantMessage: Message = { role: "assistant", content: "" };
    setMessages([...newMessages, assistantMessage]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "抱歉，服务出现异常，请稍后再试。" };
          return updated;
        });
        setIsLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "抱歉，无法读取响应。" };
          return updated;
        });
        setIsLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith("data:")) continue;
          const data = trimmedLine.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            // 新格式：delta（文本增量）
            if (parsed.type === "delta") {
              accumulatedContent += parsed.data;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: accumulatedContent };
                return updated;
              });
            }
            // 旧格式兼容：answer
            else if (parsed.type === "answer") {
              accumulatedContent += parsed.data;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: "assistant", content: accumulatedContent };
                return updated;
              });
            } else if (parsed.type === "sources") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], sources: parsed.data };
                return updated;
              });
            } else if (parsed.type === "error") {
              if (!accumulatedContent) {
                accumulatedContent = "抱歉，AI 服务出现错误，请稍后再试。";
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: accumulatedContent };
                  return updated;
                });
              }
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (!lastMsg.content) {
          updated[updated.length - 1] = { role: "assistant", content: "网络错误，请检查网络连接后重试。" };
        }
        return updated;
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
    <div className="fixed bottom-20 right-6 z-50 flex h-[460px] w-[360px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--text-1)]">AI 问答</h3>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-1)]"
          aria-label="关闭"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--text-3)]">你好！有什么可以帮你的吗？</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`mb-3 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user" ? "bg-[var(--accent)] text-white" : "bg-[var(--card-hover)] text-[var(--text-1)]"
              }`}
            >
              <RichMessageContent content={msg.content} sources={msg.sources} />
              {msg.role === "assistant" && isLoading && idx === messages.length - 1 && !msg.content && (
                <span className="inline-block animate-pulse text-[var(--text-3)]">思考中...</span>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t border-[var(--border)] px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题..."
            disabled={isLoading}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white transition-opacity disabled:opacity-50"
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
