/**
 * LoopGuard — 循环防护系统
 * 参考 Claude Code 的 queryLoop 终止条件，提供多层防护：
 * 1. 连续重复调用检测
 * 2. 单工具调用次数限制
 * 3. 总工具调用次数限制
 * 4. Turn 级别轮次限制
 * 5. Token 预算追踪
 * 6. 收益递减检测
 * 7. 死亡螺旋防护
 */

export interface LoopGuardConfig {
  /** 连续相同调用上限，默认 1 */
  maxConsecutiveSame: number;
  /** 单工具调用上限，默认 5 */
  maxPerTool: number;
  /** 总工具调用上限，默认 12 */
  maxTotalCalls: number;
  /** 最大 agent 循环轮次，默认 15 */
  maxTurns: number;
  /** 单次请求 token 预算上限，默认 100000 */
  tokenBudget: number;
  /** 连续 N 轮无新信息时判定收益递减，默认 3 */
  diminishingReturnsThreshold: number;
}

const DEFAULT_CONFIG: LoopGuardConfig = {
  maxConsecutiveSame: 1,
  maxPerTool: 5,
  maxTotalCalls: 12,
  maxTurns: 15,
  tokenBudget: 100_000,
  diminishingReturnsThreshold: 3,
};

export class LoopGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopGuardError";
  }
}

export class LoopDetectedError extends LoopGuardError {
  public readonly toolName: string;
  constructor(toolName: string) {
    super(`工具 ${toolName} 连续重复调用，请基于已有结果直接回答用户问题`);
    this.name = "LoopDetectedError";
    this.toolName = toolName;
  }
}

export class ToolCallLimitError extends LoopGuardError {
  public readonly toolName: string;
  public readonly count: number;
  constructor(toolName: string, count: number) {
    super(`工具 ${toolName} 已调用 ${count} 次，达到上限。请基于已有信息生成最终回答。`);
    this.name = "ToolCallLimitError";
    this.toolName = toolName;
    this.count = count;
  }
}

export class TotalToolLimitError extends LoopGuardError {
  public readonly count: number;
  constructor(count: number) {
    super(`已调用 ${count} 次工具，达到总上限。请立即总结已有结果回答用户。`);
    this.name = "TotalToolLimitError";
    this.count = count;
  }
}

export class TurnLimitError extends LoopGuardError {
  public readonly turnCount: number;
  public readonly maxTurns: number;
  constructor(turnCount: number, maxTurns: number) {
    super(`已达到最大轮次 ${maxTurns}，当前轮次 ${turnCount}。请立即总结已有结果。`);
    this.name = "TurnLimitError";
    this.turnCount = turnCount;
    this.maxTurns = maxTurns;
  }
}

export class TokenBudgetExhaustedError extends LoopGuardError {
  public readonly usedTokens: number;
  public readonly budget: number;
  constructor(usedTokens: number, budget: number) {
    super(`Token 预算已耗尽（${usedTokens}/${budget}）。请立即基于已有信息回答。`);
    this.name = "TokenBudgetExhaustedError";
    this.usedTokens = usedTokens;
    this.budget = budget;
  }
}

export class DiminishingReturnsError extends LoopGuardError {
  public readonly consecutiveSimilar: number;
  constructor(consecutiveSimilar: number) {
    super(`连续 ${consecutiveSimilar} 轮工具调用未产生新信息，判定收益递减。请基于已有结果直接回答。`);
    this.name = "DiminishingReturnsError";
    this.consecutiveSimilar = consecutiveSimilar;
  }
}

export class DeathSpiralError extends LoopGuardError {
  constructor() {
    super("检测到死亡螺旋（连续错误快速循环），已强制终止。");
    this.name = "DeathSpiralError";
  }
}

function hashArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

/**
 * 计算两个字符串的简单相似度（0-1，1 为完全相同）
 * 使用字符级 Jaccard 相似度，避免复杂计算
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const setA = new Set(a.split(""));
  const setB = new Set(b.split(""));
  let intersection = 0;
  for (const ch of setA) {
    if (setB.has(ch)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

export class LoopGuard {
  private config: LoopGuardConfig;
  private callCounts: Map<string, number> = new Map();
  private lastCallKey: string | null = null;
  private consecutiveSameCount: number = 0;
  private totalCalls: number = 0;

  // Turn 级别追踪
  private turnCount: number = 0;
  private tokenUsed: number = 0;

  // 收益递减检测：保留最近 N 次工具结果摘要
  private recentToolResults: string[] = [];
  private diminishingReturnsCount: number = 0;

  // 死亡螺旋检测
  private errorTimestamps: number[] = [];

  constructor(config?: Partial<LoopGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 工具调用频率检查（原有逻辑）
   */
  check(toolName: string, args: Record<string, unknown>): void {
    this.totalCalls++;
    const argsHash = hashArgs(args);
    const callKey = `${toolName}:${argsHash}`;

    if (this.totalCalls > this.config.maxTotalCalls) {
      throw new TotalToolLimitError(this.totalCalls);
    }

    const toolCount = (this.callCounts.get(toolName) || 0) + 1;
    if (toolCount > this.config.maxPerTool) {
      throw new ToolCallLimitError(toolName, toolCount);
    }
    this.callCounts.set(toolName, toolCount);

    if (callKey === this.lastCallKey) {
      this.consecutiveSameCount++;
      if (this.consecutiveSameCount >= this.config.maxConsecutiveSame) {
        throw new LoopDetectedError(toolName);
      }
    } else {
      this.consecutiveSameCount = 0;
    }

    this.lastCallKey = callKey;
  }

  /**
   * Turn 计数 — 每次 AI 回复后调用
   */
  incrementTurn(): void {
    this.turnCount++;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  /**
   * Token 预算追踪
   */
  addTokenUsage(tokens: number): void {
    this.tokenUsed += tokens;
  }

  isOverBudget(): boolean {
    return this.tokenUsed >= this.config.tokenBudget;
  }

  getTokenUsage(): { used: number; budget: number; percent: number } {
    return {
      used: this.tokenUsed,
      budget: this.config.tokenBudget,
      percent: this.tokenUsed / this.config.tokenBudget,
    };
  }

  /**
   * 记录工具结果 — 用于收益递减检测
   * 保留最近 (diminishingReturnsThreshold + 1) 次结果的摘要
   */
  recordToolResult(toolName: string, resultSummary: string): void {
    this.recentToolResults.push(resultSummary);
    // 只保留需要的窗口大小
    const windowSize = this.config.diminishingReturnsThreshold + 1;
    if (this.recentToolResults.length > windowSize) {
      this.recentToolResults = this.recentToolResults.slice(-windowSize);
    }

    // 检查最近 N 次结果是否高度相似
    this.updateDiminishingReturns();
  }

  private updateDiminishingReturns(): void {
    const threshold = this.config.diminishingReturnsThreshold;
    if (this.recentToolResults.length < threshold + 1) {
      this.diminishingReturnsCount = 0;
      return;
    }

    const latest = this.recentToolResults[this.recentToolResults.length - 1];
    let similarCount = 0;
    for (let i = this.recentToolResults.length - 2; i >= 0; i--) {
      if (similarity(latest, this.recentToolResults[i]) > 0.8) {
        similarCount++;
      }
    }
    this.diminishingReturnsCount = similarCount;
  }

  isDiminishingReturns(): boolean {
    return this.diminishingReturnsCount >= this.config.diminishingReturnsThreshold;
  }

  /**
   * 死亡螺旋检测 — 连续错误且间隔 < 5 秒
   */
  recordError(_error: Error): void {
    const now = Date.now();
    this.errorTimestamps.push(now);
    // 只保留最近 5 秒内的错误
    this.errorTimestamps = this.errorTimestamps.filter(t => now - t < 5000);
  }

  isDeathSpiral(): boolean {
    // 最近 5 秒内有 3 次以上错误
    const now = Date.now();
    const recent = this.errorTimestamps.filter(t => now - t < 5000);
    return recent.length >= 3;
  }

  /**
   * 综合检查 — 是否应该停止循环
   * 参考 Claude Code 的多个终止条件
   */
  shouldStop(): { stop: boolean; reason?: string } {
    if (this.turnCount > this.config.maxTurns) {
      return { stop: true, reason: `max_turns_reached:${this.turnCount}/${this.config.maxTurns}` };
    }
    if (this.isOverBudget()) {
      return { stop: true, reason: `token_budget_exhausted:${this.tokenUsed}/${this.config.tokenBudget}` };
    }
    if (this.isDiminishingReturns()) {
      return { stop: true, reason: `diminishing_returns:${this.diminishingReturnsCount}` };
    }
    if (this.isDeathSpiral()) {
      return { stop: true, reason: "death_spiral_detected" };
    }
    return { stop: false };
  }

  reset(): void {
    this.callCounts.clear();
    this.lastCallKey = null;
    this.consecutiveSameCount = 0;
    this.totalCalls = 0;
    this.turnCount = 0;
    this.tokenUsed = 0;
    this.recentToolResults = [];
    this.diminishingReturnsCount = 0;
    this.errorTimestamps = [];
  }

  getStatus(): {
    totalCalls: number;
    turnCount: number;
    tokenUsage: { used: number; budget: number; percent: number };
    perTool: Record<string, number>;
    lastCallKey: string | null;
    diminishingReturnsCount: number;
  } {
    return {
      totalCalls: this.totalCalls,
      turnCount: this.turnCount,
      tokenUsage: this.getTokenUsage(),
      perTool: Object.fromEntries(this.callCounts),
      lastCallKey: this.lastCallKey,
      diminishingReturnsCount: this.diminishingReturnsCount,
    };
  }
}
