"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import MessageBubble from "@/components/chat/MessageBubble";
import ModelSelector, { type ModelConfig } from "@/components/admin/ModelSelector";

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
  thinking?: string;
  thinkingComplete?: boolean;
  toolCalls: ToolCallBlock[];
  isComplete: boolean;
  error?: string;
  timestamp: number;
}

interface SkillInfo {
  name: string;
  description: string;
  userInvocable: boolean;
}

export default function AgentChat() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentAssistantId, setCurrentAssistantId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string>(() => `agent:chat:${Math.random().toString(36).substring(2, 15)}`);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [showSkillMenu, setShowSkillMenu] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const contentBufferRef = useRef<{ [assistantId: string]: string }>({});
  const contentTypingRef = useRef<{ [assistantId: string]: number }>({});
  const contentTimerRef = useRef<{ [assistantId: string]: ReturnType<typeof setTimeout> | null }>({});
  const thinkingBufferRef = useRef<{ [assistantId: string]: string }>({});
  const thinkingTypingRef = useRef<{ [assistantId: string]: number }>({});
  const thinkingTimerRef = useRef<{ [assistantId: string]: ReturnType<typeof setTimeout> | null }>({});
  const thinkingDoneRef = useRef<{ [assistantId: string]: boolean }>({});
  const toolIdCounterRef = useRef(0);
  const skillMenuRef = useRef<HTMLDivElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // 加载 skills 列表
  useEffect(() => {
    fetch("/api/agent/skills")
      .then((r) => r.json())
      .then((data) => {
        if (data.skills) setSkills(data.skills);
      })
      .catch(console.warn);
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (skillMenuRef.current && !skillMenuRef.current.contains(e.target as Node)) {
        setShowSkillMenu(false);
      }
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setSlashMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const switchSkill = useCallback((skillName: string | null) => {
    if (isLoading) return;
    setActiveSkill(skillName);
    setMessages([]);
    setSessionKey(`agent:chat:${Math.random().toString(36).substring(2, 15)}`);
    setShowSkillMenu(false);
  }, [isLoading]);

  const handleSend = useCallback(async () => {
    let content = input.trim();
    if (!content || isLoading) return;

    // 检测斜杠命令
    const slashMatch = content.match(/^\/(\w+)(?:\s+(.*))?$/);
    let explicitSkill: string | undefined;
    if (slashMatch) {
      const cmd = slashMatch[1].toLowerCase();
      // 检查是否是已注册的 skill 命令
      const matchedSkill = skills.find((s) => s.name === cmd && s.userInvocable);
      if (matchedSkill) {
        explicitSkill = cmd;
        content = slashMatch[2]?.trim() || "";
      }
    }

    // 如果 activeSkill 存在，也作为参数传递
    const skillParam = explicitSkill || activeSkill;

    setInput("");
    setIsLoading(true);
    setSlashMenuOpen(false);

    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: explicitSkill ? `/${explicitSkill} ${content}`.trim() : content,
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
      thinking: "",
      thinkingComplete: false,
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
        body: JSON.stringify({ message: content || `/${skillParam}`, sessionKey, skill: skillParam, modelConfig }),
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

        // SSE 事件以空行 (\n\n) 分隔，逐个处理完整事件
        while (buffer.includes("\n\n")) {
          const eventEnd = buffer.indexOf("\n\n");
          const eventBlock = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          // 从事件块中提取所有 "data:" 后的内容并拼接
          const dataParts: string[] = [];
          let pos = 0;
          while (true) {
            const dataIdx = eventBlock.indexOf("data:", pos);
            if (dataIdx === -1) break;
            const lineEnd = eventBlock.indexOf("\n", dataIdx + 5);
            const content = lineEnd === -1
              ? eventBlock.slice(dataIdx + 5)
              : eventBlock.slice(dataIdx + 5, lineEnd);
            dataParts.push(content.trim());
            pos = dataIdx + 5;
          }

          if (dataParts.length === 0) continue;

          try {
            const dataStr = dataParts.join("");
            const data = JSON.parse(dataStr);
            if (!data.type) continue;

            if (data.type === "init") {
              if (data.data?.sessionKey) setSessionKey(data.data.sessionKey);
              if (data.data?.activeSkill) setActiveSkill(data.data.activeSkill);
            } else if (data.type === "delta") {
              // 第一个 delta 到达时标记 thinking 完成，自动关闭思考窗口
              if (!thinkingDoneRef.current[assistantId]) {
                thinkingDoneRef.current[assistantId] = true;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId ? { ...m, thinkingComplete: true } : m
                  )
                );
              }

              const chunk = data.data?.content || "";
              if (!chunk) continue;

              // 追加到缓冲区
              const currentLen = contentTypingRef.current[assistantId] || 0;
              contentBufferRef.current[assistantId] = (contentBufferRef.current[assistantId] || "") + chunk;

              // 打字机效果：停止旧计时器，从当前可见位置继续打字
              if (contentTimerRef.current[assistantId]) {
                clearTimeout(contentTimerRef.current[assistantId]!);
              }
              const fullContent = contentBufferRef.current[assistantId];
              const typeNext = () => {
                const visible = contentTypingRef.current[assistantId] || 0;
                const next = visible + 1;
                contentTypingRef.current[assistantId] = next;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: fullContent.slice(0, next) }
                      : m
                  )
                );
                if (next < fullContent.length) {
                  contentTimerRef.current[assistantId] = setTimeout(typeNext, 15);
                }
              };
              contentTimerRef.current[assistantId] = setTimeout(typeNext, 15);
            } else if (data.type === "thinking") {
              const content = data.data?.content || "";
              thinkingBufferRef.current[assistantId] = (thinkingBufferRef.current[assistantId] || "") + content;
              // 打字机效果：每次新内容追加时，重置计时器，从当前可见位置继续打字
              if (thinkingTimerRef.current[assistantId]) {
                clearTimeout(thinkingTimerRef.current[assistantId]!);
              }
              const startLen = thinkingTypingRef.current[assistantId] || 0;
              const fullLen = thinkingBufferRef.current[assistantId].length;
              const typeNextChunk = () => {
                const currentLen = thinkingTypingRef.current[assistantId] || 0;
                const nextLen = Math.min(currentLen + 3, fullLen);
                thinkingTypingRef.current[assistantId] = nextLen;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, thinking: thinkingBufferRef.current[assistantId].slice(0, nextLen) }
                      : m
                  )
                );
                if (nextLen < fullLen) {
                  thinkingTimerRef.current[assistantId] = setTimeout(typeNextChunk, 15);
                }
              };
              thinkingTimerRef.current[assistantId] = setTimeout(typeNextChunk, 15);
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
              if (data.data?.toolCompleted) {
                // 工具执行完毕，停止思考打字机，但不结束消息
                // 继续等待模型生成最终回答
                if (thinkingTimerRef.current[assistantId]) {
                  clearTimeout(thinkingTimerRef.current[assistantId]!);
                  thinkingTimerRef.current[assistantId] = null;
                }
                // 重置 content buffer，准备接收最终回答
                contentBufferRef.current[assistantId] = "";
                contentTypingRef.current[assistantId] = 0;
                if (contentTimerRef.current[assistantId]) {
                  clearTimeout(contentTimerRef.current[assistantId]!);
                  contentTimerRef.current[assistantId] = null;
                }
              } else {
                // 真正结束：停止所有打字机，立即显示完整内容
                if (thinkingTimerRef.current[assistantId]) {
                  clearTimeout(thinkingTimerRef.current[assistantId]!);
                  thinkingTimerRef.current[assistantId] = null;
                }
                if (contentTimerRef.current[assistantId]) {
                  clearTimeout(contentTimerRef.current[assistantId]!);
                  contentTimerRef.current[assistantId] = null;
                }
                const fullThinking = thinkingBufferRef.current[assistantId] || "";
                const fullContent = contentBufferRef.current[assistantId] || "";
                setMessages((prev) =>
                  prev.map((m) => m.id === assistantId
                    ? { ...m, thinking: fullThinking, thinkingComplete: true, content: fullContent, isComplete: true }
                    : m)
                );
              }
            } else if (data.type === "error") {
              const errorMsg = typeof data.data === "string"
                ? data.data
                : data.data?.message || "Unknown error";
              // 停止所有打字机
              if (thinkingTimerRef.current[assistantId]) {
                clearTimeout(thinkingTimerRef.current[assistantId]!);
                thinkingTimerRef.current[assistantId] = null;
              }
              if (contentTimerRef.current[assistantId]) {
                clearTimeout(contentTimerRef.current[assistantId]!);
                contentTimerRef.current[assistantId] = null;
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, thinking: thinkingBufferRef.current[assistantId] || m.thinking, thinkingComplete: true, content: contentBufferRef.current[assistantId] || m.content, isComplete: true, error: errorMsg }
                    : m
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
      contentBufferRef.current[assistantId] = "";
      contentTypingRef.current[assistantId] = 0;
      if (contentTimerRef.current[assistantId]) {
        clearTimeout(contentTimerRef.current[assistantId]!);
        contentTimerRef.current[assistantId] = null;
      }
      thinkingBufferRef.current[assistantId] = "";
      thinkingTypingRef.current[assistantId] = 0;
      if (thinkingTimerRef.current[assistantId]) {
        clearTimeout(thinkingTimerRef.current[assistantId]!);
        thinkingTimerRef.current[assistantId] = null;
      }
      thinkingDoneRef.current[assistantId] = false;
      setIsLoading(false);
      setCurrentAssistantId(null);
    }
  }, [input, isLoading, sessionKey, activeSkill, skills, modelConfig]);

  const startNewSession = useCallback(() => {
    if (isLoading) {
      abortControllerRef.current?.abort();
    }
    setMessages([]);
    setActiveSkill(null);
    setSessionKey(`agent:chat:${Math.random().toString(36).substring(2, 15)}`);
  }, [isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    // 斜杠命令菜单
    if (e.key === "Enter" || e.key === "Tab" || e.key === " ") {
      // noop
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // 检测斜杠命令
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/(\w*)$/);

    if (slashMatch) {
      setSlashFilter(slashMatch[1]);
      setSlashMenuOpen(true);
    } else {
      setSlashMenuOpen(false);
      setSlashFilter("");
    }
  };

  const insertSlashCommand = (skillName: string) => {
    const slashCmd = `/${skillName} `;
    // 找到斜杠位置并替换
    const match = input.match(/(?:^|\s)\/\w*$/);
    if (match) {
      const pos = match.index!;
      const newInput = input.slice(0, pos) + (pos === 0 ? "" : " ") + slashCmd + input.slice(match.index! + match[0].length);
      setInput(newInput);
    } else {
      setInput(slashCmd);
    }
    setSlashMenuOpen(false);
    textareaRef.current?.focus();
  };

  const filteredSkills = skills.filter(
    (s) => s.userInvocable && (slashFilter === "" || s.name.includes(slashFilter))
  );

  const activeSkillInfo = skills.find((s) => s.name === activeSkill);

  const getWelcomeMessage = () => {
    if (activeSkill === "brainstorming") {
      return "你好！我是设计引导师。请告诉我你想做什么——功能、组件、重构或任何创意工作，我会引导你将想法转化为完整的设计方案。";
    }
    return "你好！我是 AI Agent，可以帮助你管理知识库、查询文档等。";
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-[var(--text-1)]">
            {activeSkill === "brainstorming" ? "Brainstorming" : "Agent 对话"}
          </h2>
          {activeSkillInfo && activeSkill !== "brainstorming" && (
            <span className="rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-xs text-[var(--accent)]">
              {activeSkillInfo.name}
            </span>
          )}
          {modelConfig && (
            <span className="rounded-full bg-[var(--bg)] px-2 py-0.5 text-xs text-[var(--text-3)] border border-[var(--border)]">
              {modelConfig.modelName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* 模型选择器 */}
          <ModelSelector onModelChange={setModelConfig} disabled={isLoading} />

          {/* Skill 切换按钮 */}
          {skills.length > 0 && (
            <div className="relative" ref={skillMenuRef}>
              <button
                onClick={() => setShowSkillMenu((v) => !v)}
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs text-[var(--text-3)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-1)]"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Skill
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showSkillMenu && (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
                  <div className="px-3 py-1.5 text-xs font-medium text-[var(--text-3)]">切换 Skill 模式</div>
                  <button
                    onClick={() => switchSkill(null)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--card-hover)] ${
                      !activeSkill ? "text-[var(--accent)]" : "text-[var(--text-1)]"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-[var(--text-3)]" />
                    默认模式
                  </button>
                  {skills.filter((s) => s.userInvocable).map((skill) => (
                    <button
                      key={skill.name}
                      onClick={() => switchSkill(skill.name)}
                      className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--card-hover)] ${
                        activeSkill === skill.name ? "text-[var(--accent)]" : "text-[var(--text-1)]"
                      }`}
                    >
                      <span className="font-medium">/{skill.name}</span>
                      <span className="text-xs text-[var(--text-3)] line-clamp-1">{skill.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            onClick={startNewSession}
            disabled={isLoading}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--text-3)] transition-colors hover:bg-[var(--card-hover)] hover:text-[var(--text-1)] disabled:opacity-50"
          >
            新建会话
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--text-3)]">{getWelcomeMessage()}</p>
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
        {/* 斜杠命令菜单 */}
        {slashMenuOpen && filteredSkills.length > 0 && (
          <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-md" ref={slashMenuRef}>
            <div className="px-3 py-1 text-xs text-[var(--text-3)]">可用 Skill</div>
            {filteredSkills.map((skill) => (
              <button
                key={skill.name}
                onClick={() => insertSlashCommand(skill.name)}
                className="flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-[var(--card-hover)]"
              >
                <span className="font-medium text-[var(--text-1)]">/{skill.name}</span>
                <span className="text-xs text-[var(--text-3)] line-clamp-1">{skill.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={activeSkill === "brainstorming" ? "输入你的想法... (输入 / 查看可用 Skill)" : "输入消息... (Enter 发送，Shift+Enter 换行)"}
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
