/**
 * QueryEngine 核心引擎
 * 负责管理对话历史、自动压缩、token 预算等
 */

import {
  ChatMessage,
  LongChatConfig,
  TokenBudgetStatus,
  QueryEngineOptions,
  CollapsedContext,
} from "./types";
import {
  loadChatHistory,
  saveChatHistory,
  appendChatMessage,
  getCollapsedContext,
  saveCollapsedContext,
  updateSessionStats,
} from "./history";
import { checkTokenBudget } from "./tokenBudget";
import { performAutoCompact, shouldAutoCompact } from "./autoCompact";
import { createCollapsedContext } from "./contextCollapse";
import {
  estimateSystemPromptTokenCount,
  calculateMessagesTokenCount,
} from "./tokenizer";
import { getOrCreateSession, acquireSessionLock, SessionLock } from "../session";

/**
 * QueryEngine - 长对话核心引擎
 */
export class QueryEngine {
  private sessionId: string;
  private config: LongChatConfig;
  private apiKey: string;
  private lock: SessionLock | null = null;

  constructor(sessionId: string, config: LongChatConfig, apiKey: string) {
    this.sessionId = sessionId;
    this.config = config;
    this.apiKey = apiKey;
  }

  /**
   * 获取 Session ID
   */
  get sessionIdValue(): string {
    return this.sessionId;
  }

  /**
   * 初始化引擎，加载对话历史并获取锁
   */
  async initialize(): Promise<ChatMessage[]> {
    this.lock = await acquireSessionLock(this.sessionId, this.config.userId);
    if (!this.lock) {
      throw new Error("Failed to acquire session lock");
    }

    const history = await loadChatHistory(this.sessionId);
    return history;
  }

  /**
   * 获取对话历史
   */
  async getMessages(): Promise<ChatMessage[]> {
    return loadChatHistory(this.sessionId);
  }

  /**
   * 添加用户消息
   */
  async addUserMessage(content: string): Promise<void> {
    const message: ChatMessage = {
      role: "user",
      content,
      timestamp: Date.now(),
    };
    await appendChatMessage(this.sessionId, message);
  }

  /**
   * 添加助手消息
   */
  async addAssistantMessage(content: string): Promise<void> {
    const message: ChatMessage = {
      role: "assistant",
      content,
      timestamp: Date.now(),
    };
    await appendChatMessage(this.sessionId, message);
  }

  /**
   * 获取带有 Token 预算信息的对话历史
   */
  async getMessagesWithBudget(
    systemPrompt: string
  ): Promise<{
    messages: ChatMessage[];
    budget: TokenBudgetStatus;
  }> {
    const messages = await this.getMessages();
    const budget = checkTokenBudget(
      messages,
      systemPrompt,
      this.config.maxTokens
    );

    return { messages, budget };
  }

  /**
   * 检查并执行自动压缩
   */
  async checkAndCompact(
    systemPrompt: string
  ): Promise<{
    compacted: boolean;
    messages: ChatMessage[];
    budget: TokenBudgetStatus;
  }> {
    const messages = await this.getMessages();
    const totalTokens =
      estimateSystemPromptTokenCount(systemPrompt) +
      calculateMessagesTokenCount(messages.map((m) => ({
        content: m.content,
        role: m.role,
      })));

    const budget = checkTokenBudget(
      messages,
      systemPrompt,
      this.config.maxTokens
    );

    if (!budget.compressionNeeded || !this.config.autoCompact.enabled) {
      return { compacted: false, messages, budget };
    }

    // 执行 AutoCompact
    const result = await performAutoCompact(
      messages,
      this.config.autoCompact,
      this.apiKey
    );

    // 保存压缩后的消息
    await saveChatHistory(this.sessionId, result.compactedMessages);

    // 保存折叠上下文信息
    await saveCollapsedContext(this.sessionId, {
      summary: result.summary,
      messageCount: result.collapsedMessageCount,
      startIndex: 0,
      endIndex: result.collapsedMessageCount,
      tokenCount: 0,
    });

    // 更新统计
    await updateSessionStats(this.sessionId, {
      compactCount: 1, // 递增压缩计数
    });

    return { compacted: true, messages: result.compactedMessages, budget };
  }

  /**
   * 检查并执行轻量折叠（不调用 AI）
   */
  async checkAndCollapse(
    systemPrompt: string
  ): Promise<{
    collapsed: boolean;
    visibleMessages: ChatMessage[];
    collapsedContext: CollapsedContext | null;
  }> {
    if (!this.config.enableContextCollapse) {
      return {
        collapsed: false,
        visibleMessages: await this.getMessages(),
        collapsedContext: null,
      };
    }

    const messages = await this.getMessages();
    const totalTokens =
      estimateSystemPromptTokenCount(systemPrompt) +
      calculateMessagesTokenCount(messages.map((m) => ({
        content: m.content,
        role: m.role,
      })));

    // 如果超过 50% 预算，执行轻量折叠
    if (totalTokens < this.config.maxTokens * 0.5) {
      return {
        collapsed: false,
        visibleMessages: messages,
        collapsedContext: null,
      };
    }

    const { collapsedContext, visibleMessages } = createCollapsedContext(
      messages,
      this.config.maxTokens * 0.3
    );

    // 保存折叠上下文
    await saveCollapsedContext(this.sessionId, collapsedContext);

    return {
      collapsed: true,
      visibleMessages,
      collapsedContext,
    };
  }

  /**
   * 释放锁
   */
  async release(): Promise<void> {
    if (this.lock) {
      await this.lock.release();
      this.lock = null;
    }
  }

  /**
   * 获取 Token 预算状态
   */
  async getBudgetStatus(systemPrompt: string): Promise<TokenBudgetStatus> {
    const messages = await this.getMessages();
    return checkTokenBudget(messages, systemPrompt, this.config.maxTokens);
  }
}

/**
 * 创建 QueryEngine 实例
 */
export async function createQueryEngine(
  sessionKey: string,
  userId: string,
  agentId: string,
  options: QueryEngineOptions
): Promise<QueryEngine> {
  // 获取或创建 Session
  const session = await getOrCreateSession(sessionKey, agentId, userId);

  const config: LongChatConfig = {
    sessionKey,
    userId,
    agentId,
    maxTokens: options.maxTokens || 128000,
    autoCompact: {
      enabled: options.enableAutoCompact !== false,
      compressionThreshold: (options.maxTokens || 128000) * 0.85,
      targetTokenCount: (options.maxTokens || 128000) * 0.5,
      maxHistoryRounds: options.maxHistoryRounds || 10,
    },
    enableContextCollapse: options.enableContextCollapse !== false,
  };

  return new QueryEngine(session.id, config, options.apiKey);
}
