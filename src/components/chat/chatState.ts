export interface ChatSource {
  title: string;
  slug: string;
  category: string;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  contentPreview: string;
}

export interface ToolCallBlock {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  input: Record<string, unknown>;
  result?: string;
}

export interface ChatTimelineStep {
  id: string;
  type: string;
  title: string;
  status: "pending" | "running" | "done" | "error";
  defaultOpen: boolean;
  timestampIndex: number;
  detail?: string;
  content?: string;
}

export type TraceStep = ChatTimelineStep;

export interface UserChatMessage {
  id: string;
  role: "user";
  content: string;
  isComplete: true;
  timestamp?: number;
}

export interface AssistantChatMessage {
  id: string;
  role: "assistant";
  content: string;
  thinking?: string[];
  thinkingComplete?: boolean;
  toolCalls: ToolCallBlock[];
  timeline: ChatTimelineStep[];
  traceSteps: ChatTimelineStep[];
  sources?: ChatSource[];
  isComplete: boolean;
  error?: string;
  eventCounter: number;
  timestamp?: number;
}

export type ChatMessage = UserChatMessage | AssistantChatMessage;

export interface AssistantStreamEvent {
  type: string;
  data?: unknown;
}

export function createAssistantChatMessage(id: string): AssistantChatMessage {
  return {
    id,
    role: "assistant",
    content: "",
    thinking: [],
    thinkingComplete: false,
    toolCalls: [],
    timeline: [],
    traceSteps: [],
    sources: [],
    isComplete: false,
    eventCounter: 0,
  };
}

export function reduceAssistantStreamEvent(
  message: AssistantChatMessage,
  event: AssistantStreamEvent
): AssistantChatMessage {
  const data = asRecord(event.data);

  if (event.type === "route") {
    return appendTimelineStep(message, {
      type: "route",
      title: `选择路线：${summarizeRoute(data.route)}`,
      status: "done",
      detail: summarizeRouteDetail(event.data),
    });
  }

  if (event.type === "thinking") {
    const content = stringOrEmpty(data.content).trim();
    if (!content) return message;

    const round = typeof data.round === "number" ? data.round : undefined;
    return appendTimelineStep(
      {
        ...message,
        thinking: appendThinkingBlock(message.thinking || [], content, round),
        thinkingComplete: false,
      },
      {
        type: "thinking",
        title: round ? `思考 #${round}` : "思考",
        status: "done",
        detail: content,
      }
    );
  }

  if (event.type === "tool_start") {
    const toolName = getToolName(event.data);
    const input = parseToolArguments(data.arguments);
    const toolCall: ToolCallBlock = {
      id: `tool-${message.toolCalls.length + 1}`,
      name: toolName,
      status: "running",
      input,
    };

    return appendTimelineStep(
      {
        ...message,
        toolCalls: [...message.toolCalls, toolCall],
      },
      {
        type: "tool_start",
        title: getToolStartTitle(toolName),
        status: "running",
        detail: summarizeToolStart(toolName, input),
      }
    );
  }

  if (event.type === "tool_end") {
    const eventToolName = getToolName(event.data);
    const toolName = eventToolName === "unknown" ? getLastRunningToolName(message.toolCalls) : eventToolName;
    const result = stringifyResult(data.result);
    const status = data.success === false ? "error" : "done";
    const toolCalls = [...message.toolCalls];
    const runningIndex = findLastRunningToolCall(toolCalls, toolName);

    if (runningIndex !== -1) {
      toolCalls[runningIndex] = {
        ...toolCalls[runningIndex],
        status,
        result,
      };
    }

    return appendTimelineStep(
      {
        ...message,
        toolCalls,
      },
      {
        type: "tool_end",
        title: getToolEndTitle(toolName, status),
        status,
        detail: summarizeToolResult(toolName, result),
      }
    );
  }

  if (event.type === "sources") {
    const sources = Array.isArray(event.data) ? event.data as ChatSource[] : [];
    return appendTimelineStep(
      {
        ...message,
        sources,
      },
      {
        type: "sources",
        title: "引用来源",
        status: "done",
        detail: `已附加 ${sources.length} 条来源`,
      }
    );
  }

  if (event.type === "delta" || event.type === "answer") {
    const text = typeof event.data === "string"
      ? event.data
      : stringOrEmpty(data.content);
    if (!text) return message;

    return appendOrUpdateAnswerStep({
      ...message,
      content: message.content + text,
      thinkingComplete: true,
    });
  }

  if (event.type === "done") {
    const withCompletedAnswer = updateAnswerStep(message, { status: "done" });
    return appendTimelineStep(
      {
        ...withCompletedAnswer,
        isComplete: true,
        thinkingComplete: true,
      },
      {
        type: "done",
        title: "完成",
        status: "done",
        detail: summarizeDone(event.data),
      }
    );
  }

  if (event.type === "error") {
    const error = getErrorMessage(event.data);
    return appendTimelineStep(
      {
        ...message,
        error,
        isComplete: true,
        thinkingComplete: true,
      },
      {
        type: "error",
        title: "发生错误",
        status: "error",
        detail: error,
      }
    );
  }

  return message;
}

function appendTimelineStep(
  message: AssistantChatMessage,
  step: Omit<ChatTimelineStep, "id" | "timestampIndex" | "defaultOpen"> & { defaultOpen?: boolean }
): AssistantChatMessage {
  const timestampIndex = message.eventCounter + 1;
  const timeline = [
    ...message.timeline,
    {
      id: `${message.id}-timeline-${timestampIndex}`,
      timestampIndex,
      defaultOpen: step.defaultOpen ?? false,
      ...step,
    },
  ];

  return syncTimeline({
    ...message,
    eventCounter: timestampIndex,
    timeline,
  });
}

function appendOrUpdateAnswerStep(message: AssistantChatMessage): AssistantChatMessage {
  const answerIndex = message.timeline.findIndex((step) => step.type === "delta");
  if (answerIndex === -1) {
    return appendTimelineStep(message, {
      type: "delta",
      title: "最终回答",
      status: "running",
      content: message.content,
      defaultOpen: true,
    });
  }

  return updateTimelineAt(message, answerIndex, {
    status: "running",
    content: message.content,
  });
}

function updateAnswerStep(
  message: AssistantChatMessage,
  patch: Partial<ChatTimelineStep>
): AssistantChatMessage {
  const answerIndex = message.timeline.findIndex((step) => step.type === "delta");
  if (answerIndex === -1) return message;
  return updateTimelineAt(message, answerIndex, patch);
}

function updateTimelineAt(
  message: AssistantChatMessage,
  index: number,
  patch: Partial<ChatTimelineStep>
): AssistantChatMessage {
  const timeline = [...message.timeline];
  timeline[index] = { ...timeline[index], ...patch };
  return syncTimeline({ ...message, timeline });
}

function syncTimeline(message: AssistantChatMessage): AssistantChatMessage {
  return {
    ...message,
    traceSteps: message.timeline,
  };
}

function appendThinkingBlock(blocks: string[], content: string, round?: number): string[] {
  if (round !== undefined && round > blocks.length) {
    return [...blocks, content];
  }
  if (round !== undefined && round >= 1 && blocks[round - 1] !== undefined) {
    const next = [...blocks];
    next[round - 1] += content;
    return next;
  }
  return [...blocks, content];
}

function summarizeRoute(route: unknown): string {
  if (route === "retrieve_once") return "知识库单次检索";
  if (route === "react_retrieve") return "知识库多步检索";
  if (route === "direct") return "直接回答";
  return "默认路线";
}

function summarizeRouteDetail(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const raw = data as Record<string, unknown>;
  const parts = [
    typeof raw.reason === "string" && raw.reason ? `原因：${raw.reason}` : "",
    typeof raw.source === "string" && raw.source ? `来源：${raw.source}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

function summarizeToolStart(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "search_knowledge_base" && typeof input.query === "string" && input.query.trim()) {
    return `正在进行向量 + 关键词混合检索：“${input.query.trim()}”`;
  }

  const serialized = safeJsonStringify(input);
  return serialized === "{}" ? "正在执行工具调用" : serialized;
}

export function summarizeToolResult(toolName: string, result: string): string {
  if (toolName === "search_knowledge_base") {
    try {
      const parsed = JSON.parse(result) as { sources?: unknown[] };
      const sourceCount = Array.isArray(parsed.sources) ? parsed.sources.length : 0;
      if (sourceCount > 0) return `混合检索找到 ${sourceCount} 条可引用来源`;
      return "混合检索未找到可引用来源";
    } catch {
      return "混合检索已完成";
    }
  }

  return truncateDetail(result || "工具调用完成");
}

function getToolStartTitle(toolName: string): string {
  if (toolName === "search_knowledge_base") return "混合检索知识库";
  return `开始工具：${toolName}`;
}

function getToolEndTitle(toolName: string, status: ChatTimelineStep["status"]): string {
  if (toolName === "search_knowledge_base") {
    return status === "error" ? "混合检索失败" : "混合检索完成";
  }
  return `${status === "error" ? "工具失败" : "工具完成"}：${toolName}`;
}

function summarizeDone(data: unknown): string {
  if (!data || typeof data !== "object") return "流式响应结束";
  const reason = (data as Record<string, unknown>).reason;
  return typeof reason === "string" && reason ? `流式响应结束：${reason}` : "流式响应结束";
}

function getToolName(data: unknown): string {
  if (!data || typeof data !== "object") return "unknown";
  const raw = data as Record<string, unknown>;
  return stringOrEmpty(raw.toolName) || stringOrEmpty(raw.name) || "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getLastRunningToolName(toolCalls: ToolCallBlock[]): string {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    if (toolCalls[index].status === "running") {
      return toolCalls[index].name;
    }
  }
  return "unknown";
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function findLastRunningToolCall(toolCalls: ToolCallBlock[], toolName: string): number {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = toolCalls[index];
    if (toolCall.status !== "running") continue;
    if (toolCall.name === toolName || toolName === "unknown") {
      return index;
    }
  }
  return -1;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return safeJsonStringify(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getErrorMessage(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const message = (data as Record<string, unknown>).message;
    if (typeof message === "string" && message) return message;
  }
  return "模型调用失败";
}

function truncateDetail(value: string): string {
  return value.length > 600 ? `${value.slice(0, 600)}...` : value;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}
