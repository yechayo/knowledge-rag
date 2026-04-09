/**
 * Cron 任务计算逻辑
 */
import { CronExpressionParser } from "cron-parser";
import type { CronJob, CronSchedule } from "./types";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

/**
 * 计算下次执行时间（毫秒时间戳）
 */
export function computeNextRunAtMs(schedule: CronSchedule, nowMs: number): number | undefined {
  if (schedule.kind === "at") {
    const atMs = (schedule as { kind: "at"; atMs: number }).atMs;
    return atMs > nowMs ? atMs : undefined;
  }

  if (schedule.kind === "every") {
    const s = schedule as { kind: "every"; everyMs: number; anchorMs?: number };
    const anchor = s.anchorMs ?? nowMs;
    if (nowMs < anchor) {
      return anchor;
    }
    const elapsed = nowMs - anchor;
    const steps = Math.max(1, Math.floor((elapsed + s.everyMs - 1) / s.everyMs));
    return anchor + steps * s.everyMs;
  }

  // kind === "cron"
  const s = schedule as { kind: "cron"; expr: string; tz?: string };
  try {
    const tz = s.tz || DEFAULT_TIMEZONE;
    const interval = CronExpressionParser.parse(s.expr, {
      currentDate: new Date(nowMs),
      tz,
    });
    const next = interval.next();
    return next.getTime();
  } catch {
    return undefined;
  }
}

/**
 * 检查任务是否到期
 */
export function isJobDue(job: CronJob, nowMs: number, forced = false): boolean {
  if (!job.enabled) return false;
  if (typeof job.state.runningAtMs === "number") return false;

  const nextRunAt = job.state.nextRunAtMs;
  if (!nextRunAt) return forced;

  return forced || nextRunAt <= nowMs;
}

/**
 * 判断 one-shot at 任务是否应删除
 */
export function shouldDeleteOneShot(job: CronJob): boolean {
  return job.schedule.kind === "at" && job.state.nextRunAtMs !== undefined;
}

/**
 * 验证 cron 表达式是否有效
 */
export function isValidCronExpr(expr: string, tz?: string): boolean {
  try {
    CronExpressionParser.parse(expr, { tz: tz || DEFAULT_TIMEZONE });
    return true;
  } catch {
    return false;
  }
}

/**
 * 验证间隔是否有效
 */
export function isValidEveryMs(everyMs: number): boolean {
  return Number.isFinite(everyMs) && everyMs > 0;
}

/**
 * 创建新任务状态
 */
export function createInitialJobState(nextRunAtMs: number | undefined): CronJob["state"] {
  return {
    nextRunAtMs,
    runningAtMs: undefined,
    lastRunAtMs: undefined,
    lastError: undefined,
    consecutiveErrors: 0,
  };
}

/**
 * 计算下次执行时间（入口函数）
 */
export function computeJobNextRunAtMs(
  schedule: CronSchedule,
  nowMs: number,
  _currentNextRunMs?: number
): number | undefined {
  const next = computeNextRunAtMs(schedule, nowMs);

  // 如果计算出的下次时间早于当前（可能是调度漂移），尝试找下一个
  if (next !== undefined && next <= nowMs) {
    // 对于 at 类型，返回 undefined 表示已完成
    if (schedule.kind === "at") {
      return undefined;
    }
    // 对于 every 和 cron，递归找下一个（最多10次避免死循环）
    let attempts = 0;
    let current = next;
    while (current <= nowMs && attempts < 10) {
      const next_ = computeNextRunAtMs(schedule, current + 1);
      if (next_ === undefined || next_ <= current) break;
      current = next_;
      attempts++;
    }
    return current > nowMs ? current : undefined;
  }

  return next;
}
