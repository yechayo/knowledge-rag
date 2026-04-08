import { BaseMessage } from "@langchain/core/messages";

/**
 * 新闻 Agent 的 LangGraph 状态定义
 */
export interface NewsAgentState {
  /** 对话消息历史 */
  messages: BaseMessage[];
  /** 搜索到的新闻结果 */
  newsResults: string[];
  /** 起草的报告内容 */
  draftedReport: string | null;
  /** 已发布的内容 ID */
  publishedContentId: string | null;
  /** 已清理的内容 ID 列表 */
  cleanedUpIds: string[];
  /** 最终执行报告 */
  finalReport: string | null;
  /** 错误信息 */
  error: string | null;
}
