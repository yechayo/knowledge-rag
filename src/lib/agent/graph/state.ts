/**
 * ReAct Chat Graph 的状态定义
 * 用于 chat/v2 的 LangGraph ReAct 架构
 */

import { BaseMessage } from "@langchain/core/messages";

/**
 * 检索到的知识库上下文
 */
export interface RetrievedContext {
  nav_structure: any[];
  content_meta: any[];
  toc_entry: any[];
  content_body: any[];
}

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
 * 工具调用结果条目
 */
export interface ToolResultEntry {
  toolName: string;
  result: string;
}

/**
 * Guard 状态快照
 */
export interface GuardStatus {
  turnCount: number;
  totalToolCalls: number;
  shouldStop: boolean;
  stopReason?: string;
}

/**
 * ReAct Chat Graph 的状态定义
 */
export interface ReActChatState {
  /** 对话消息历史（包含 Human/AI/Tool messages） */
  messages: BaseMessage[];

  /** 本轮检索到的知识库内容（grouped 格式） */
  retrievedContext: RetrievedContext | null;

  /** 工具调用结果收集 */
  toolResults: ToolResultEntry[];

  /** 是否已调用过工具（用于判断是否仍在循环中） */
  hasCalledTools: boolean;

  /** Guard 状态快照（用于路由决策） */
  guardStatus: GuardStatus;

  /** 最终回答文本（answer 节点写入） */
  finalAnswer: string;

  /** 引用来源 */
  sources: SourceCitation[];
}
