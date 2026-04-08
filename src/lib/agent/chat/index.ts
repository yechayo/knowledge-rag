/**
 * 长对话模块统一导出
 */

// 类型导出
export {
  type ChatMessage,
  type ToolCall,
  type CollapsedContext,
  type TokenBudgetStatus,
  type AutoCompactConfig,
  type LongChatConfig,
  type QueryEngineOptions,
  type SSEEvent,
  type SourceCitation,
  type ChatV2Request,
} from "./types";

// 历史管理
export {
  loadChatHistory,
  saveChatHistory,
  appendChatMessage,
  getCollapsedContext,
  saveCollapsedContext,
  updateSessionStats,
  getSessionStats,
  clearChatHistory,
} from "./history";

// Token 计算
export {
  estimateTokenCount,
  calculateMessagesTokenCount,
  isNearTokenLimit,
  estimateSystemPromptTokenCount,
  estimateContextTokenCount,
  shouldCompress,
  estimateMaxRounds,
} from "./tokenizer";

// Token 预算
export {
  checkTokenBudget,
  injectNudgeMessage,
  estimateMaxRounds as estimateMaxRoundsFromBudget,
  getBudgetSummary,
} from "./tokenBudget";

// 自动压缩
export {
  generateSummary,
  performAutoCompact,
  shouldAutoCompact,
  simpleCompact,
  calculateCompressionEffect,
} from "./autoCompact";

// 轻量折叠
export {
  createCollapsedContext,
  expandCollapsedContext,
  shouldCollapse,
  getCollapseInfo,
} from "./contextCollapse";

// 核心引擎
export { QueryEngine, createQueryEngine } from "./queryEngine";
