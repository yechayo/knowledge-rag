/**
 * Cron 调度器类型定义
 */

/** 调度类型 */
export type ScheduleKind = "cron" | "every" | "at";

/** 所有调度类型联合 */
export type CronSchedule = CronScheduleExpr | EverySchedule | AtSchedule;

/** Cron 表达式调度 */
export interface CronScheduleExpr {
  kind: "cron";
  expr: string;
  tz?: string; // 时区，默认 Asia/Shanghai
}

/** 固定间隔调度 */
export interface EverySchedule {
  kind: "every";
  everyMs: number;
  anchorMs?: number;
}

/** 一次性时间调度 */
export interface AtSchedule {
  kind: "at";
  atMs: number;
}

/** 任务运行时状态 */
export interface CronJobState {
  nextRunAtMs: number | undefined;
  runningAtMs: number | undefined;
  lastRunAtMs: number | undefined;
  lastError: string | undefined;
  consecutiveErrors: number;
}

/** Cron 任务完整结构 */
export interface CronJob {
  id: string;
  name: string;
  description: string | undefined;
  agentType: string;
  schedule: CronSchedule;
  enabled: boolean;
  prompt: string;
  tools: string[];
  state: CronJobState;
  createdAtMs: number;
  updatedAtMs: number;
}

/** CronService 依赖项 */
export interface CronServiceDeps {
  /** 获取当前时间（毫秒） */
  nowMs: () => number;
  /** 是否启用 cron */
  cronEnabled: boolean;
  /** 最大并发执行数 */
  maxConcurrentRuns: number;
  /** 默认超时时间 */
  defaultTimeoutMs: number;
}

/** 执行结果 */
export interface CronRunResult {
  status: "ok" | "error" | "skipped";
  error?: string;
  delivered?: boolean;
  summary?: string;
  sessionId?: string;
  sessionKey?: string;
  model?: string;
  provider?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** 调度器状态 */
export interface CronServiceStatus {
  enabled: boolean;
  jobs: number;
  nextWakeAtMs: number | null;
  running: number;
}
