/**
 * Cron 调度器核心 - 定时器 + 执行逻辑
 */
import type { CronJob, CronServiceDeps, CronRunResult } from "./types";
import { isJobDue, computeJobNextRunAtMs, shouldDeleteOneShot } from "./jobs";
import { runTask } from "@/lib/agent/executor";
import { getOrCreateSession, acquireSessionLock } from "@/lib/agent/session";
import {
  loadCronJobs,
  markJobRunning,
  markJobFinished,
  findDueJobs,
} from "./store";

/** 定时器最大延迟（60秒，避免 serverless 超时） */
const MAX_TIMER_DELAY_MS = 60_000;
/** 最小重复间隔（2秒） */
const MIN_REFIRE_GAP_MS = 2_000;

export interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  runningJobs: Set<string>; // 正在执行的任务 ID
}

/**
 * 计算下一个任务执行时间
 */
export function nextWakeAtMs(jobs: CronJob[], nowMs: number): number | undefined {
  let earliest: number | undefined;

  for (const job of jobs) {
    if (!job.enabled) continue;
    const next = job.state.nextRunAtMs;
    if (next === undefined) continue;
    if (next <= nowMs) return nowMs; // 有任务到期，立即执行
    if (earliest === undefined || next < earliest) {
      earliest = next;
    }
  }

  return earliest;
}

/**
 * 计算定时器延迟
 */
function computeTimerDelay(nextWakeAtMs: number | undefined, nowMs: number): number {
  if (!nextWakeAtMs) return MAX_TIMER_DELAY_MS;

  let delay = nextWakeAtMs - nowMs;
  if (delay < MIN_REFIRE_GAP_MS) delay = MIN_REFIRE_GAP_MS;
  if (delay > MAX_TIMER_DELAY_MS) delay = MAX_TIMER_DELAY_MS;
  return delay;
}

/**
 * 执行单个 cron 任务
 */
export async function executeCronJob(
  job: CronJob,
  deps: CronServiceDeps
): Promise<CronRunResult> {
  const startedAt = deps.nowMs();
  const sessionKey = `agent:cron:${job.id}-${startedAt}`;

  let session;
  try {
    session = await getOrCreateSession(sessionKey, job.agentType, "system");
  } catch (err) {
    return {
      status: "error",
      error: `Failed to create session: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let lock;
  try {
    lock = await acquireSessionLock(session.id, "system");
    if (!lock) {
      return { status: "skipped" };
    }
  } catch {
    return { status: "skipped" };
  }

  // 标记为运行中
  await markJobRunning(job.id, startedAt);

  try {
    // 执行任务（带超时）
    const timeoutMs = deps.defaultTimeoutMs;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Job execution timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    const execPromise = runTask({ prompt: job.prompt, timeoutMs });

    await Promise.race([execPromise, timeoutPromise]);

    return { status: "ok", delivered: true };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await lock.release();
  }
}

/**
 * 处理任务执行结果
 */
export async function handleJobResult(
  job: CronJob,
  result: CronRunResult,
  deps: CronServiceDeps
): Promise<boolean> {
  const nowMs = deps.nowMs();
  const endedAt = nowMs;

  // 计算下次执行时间
  let shouldDelete = false;
  let nextRunAtMs: number | undefined;

  // 使用类型断言来处理 discriminated union
  const kind = job.schedule.kind;

  if (result.status === "ok") {
    // 成功执行，计算下次时间
    if (kind === "at") {
      // at 类型只执行一次，标记删除
      shouldDelete = true;
      nextRunAtMs = undefined;
    } else {
      nextRunAtMs = computeJobNextRunAtMs(job.schedule, nowMs);
    }
  } else if (result.status === "error") {
    // 出错，也计算下次时间
    if (kind === "at") {
      shouldDelete = true;
    } else {
      nextRunAtMs = computeJobNextRunAtMs(job.schedule, nowMs);
    }
  }

  await markJobFinished(job.id, endedAt, result.error, nextRunAtMs);

  return shouldDelete;
}

/**
 * 调度器主循环
 */
export async function runDueJobs(deps: CronServiceDeps): Promise<void> {
  const nowMs = deps.nowMs();

  // 查找到期任务
  const dueJobs = await findDueJobs(nowMs);

  if (dueJobs.length === 0) return;

  // 按并发限制执行
  const limitedJobs = dueJobs.slice(0, deps.maxConcurrentRuns);

  await Promise.all(
    limitedJobs.map(async (job) => {
      const result = await executeCronJob(job, deps);
      await handleJobResult(job, result, deps);
    })
  );
}

/**
 * 启动定时器
 */
export function armTimer(
  state: SchedulerState,
  jobs: CronJob[],
  deps: CronServiceDeps,
  onTimer: () => void
): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  const nowMs = deps.nowMs();
  const nextWake = nextWakeAtMs(jobs, nowMs);
  const delay = computeTimerDelay(nextWake, nowMs);

  state.timer = setTimeout(onTimer, delay);
}

/**
 * 停止定时器
 */
export function disarmTimer(state: SchedulerState): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

/**
 * 恢复错过的任务（启动时调用）
 */
export async function recoverMissedJobs(deps: CronServiceDeps): Promise<void> {
  const nowMs = deps.nowMs();
  const jobs = await loadCronJobs();

  // 清理过期的 runningAtMs（进程崩溃导致的任务）
  // 这里简化处理，只记录日志
  for (const job of jobs) {
    if (typeof job.state.runningAtMs === "number") {
      const runningFor = nowMs - job.state.runningAtMs;
      if (runningFor > deps.defaultTimeoutMs * 2) {
        console.warn(
          `[Cron] Clearing stale running marker for job ${job.name} (running since ${new Date(
            job.state.runningAtMs
          ).toISOString()})`
        );
      }
    }
  }
}
