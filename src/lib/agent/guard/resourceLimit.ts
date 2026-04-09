export interface ResourceLimits {
  maxResultChars: number;
  /** 最大 agent 循环轮次 */
  maxTurns: number;
  /** 单次请求 token 预算上限 */
  tokenBudget: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxResultChars: 10_000,
  maxTurns: 15,
  tokenBudget: 100_000,
};

export function truncateToolResult(
  result: string,
  maxChars: number = DEFAULT_RESOURCE_LIMITS.maxResultChars
): string {
  if (typeof result !== "string") {
    result = JSON.stringify(result);
  }
  if (result.length <= maxChars) return result;
  return (
    result.slice(0, maxChars) +
    `\n\n[结果已截断，原始长度 ${result.length} 字符。请基于已显示的内容回答。]`
  );
}
