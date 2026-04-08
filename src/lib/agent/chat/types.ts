/**
 * 长对话核心类型定义
 * 参考 Claude Code 长对话机制实现
 */

/**
 * 工具调用信息
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

/**
 * 对话消息结构
 */
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  tokenCount?: number;
  toolCalls?: ToolCall[];
}

/**
 * 对话折叠信息（Context Collapse）
 */
export interface CollapsedContext {
  summary: string;
  messageCount: number;
  startIndex: number;
  endIndex: number;
  tokenCount: number;
}

/**
 * Token 预算状态
 */
export interface TokenBudgetStatus {
  usedTokens: number;
  budgetTokens: number;
  remainingTokens: number;
  usagePercent: number;
  isNearLimit: boolean;
  compressionNeeded: boolean;
  nudgeMessage?: string;
}

/**
 * AutoCompact 配置
 */
export interface AutoCompactConfig {
  enabled: boolean;
  compressionThreshold: number;
  targetTokenCount: number;
  maxHistoryRounds: number;
}

/**
 * 长对话配置
 */
export interface LongChatConfig {
  sessionKey: string;
  userId: string;
  agentId: string;
  maxTokens: number;
  autoCompact: AutoCompactConfig;
  enableContextCollapse: boolean;
}

/**
 * QueryEngine 选项
 */
export interface QueryEngineOptions {
  maxTokens?: number;
  maxHistoryRounds?: number;
  enableAutoCompact?: boolean;
  enableContextCollapse?: boolean;
  apiKey: string;
}

/**
 * SSE 事件类型
 */
export interface SSETokenBudgetEvent {
  type: "token_budget";
  data: TokenBudgetStatus;
}

export interface SSEContextCollapsedEvent {
  type: "context_collapsed";
  data: {
    collapsedCount: number;
    summary: string;
  };
}

export interface SSEErrorEvent {
  type: "error";
  data: string;
}

export type SSEEvent =
  | { type: "init"; data: { sessionKey: string } }
  | { type: "answer"; data: string }
  | { type: "sources"; data: SourceCitation[] }
  | SSETokenBudgetEvent
  | SSEContextCollapsedEvent
  | SSEErrorEvent
  | { type: "done" };

/**
 * 引用来源
 */
export interface SourceCitation {
  title: string;
  slug: string;
  category: string;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  contentPreview: string;
}

/**
 * Chat API v2 请求
 */
export interface ChatV2Request {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  sessionKey?: string;
  systemPrompt?: string;
  enableAutoCompact?: boolean;
  enableContextCollapse?: boolean;
}
