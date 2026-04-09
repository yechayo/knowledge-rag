/**
 * Cron 任务数据库存储
 */
import { prisma } from "@/lib/prisma";
import type { CronJob, CronJobState, CronSchedule } from "./types";

/**
 * 从 Prisma Task 模型转换为 CronJob
 */
function taskToCronJob(task: {
  id: string;
  name: string;
  description: string | null;
  agentType: string;
  cronExpr: string | null;
  scheduleKind: string | null;
  everyMs: number | null;
  atMs: Date | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
  enabled: boolean;
  prompt: string;
  tools: unknown;
  createdAt: Date;
  updatedAt: Date;
}): CronJob {
  let schedule: CronSchedule;

  if (task.scheduleKind === "every" && task.everyMs) {
    schedule = { kind: "every", everyMs: task.everyMs };
  } else if (task.scheduleKind === "at" && task.atMs) {
    schedule = { kind: "at", atMs: task.atMs.getTime() };
  } else if (task.cronExpr) {
    schedule = { kind: "cron", expr: task.cronExpr, tz: "Asia/Shanghai" };
  } else {
    // 默认 cron 表达式
    schedule = { kind: "cron", expr: task.cronExpr || "0 8 * * *", tz: "Asia/Shanghai" };
  }

  return {
    id: task.id,
    name: task.name,
    description: task.description ?? undefined,
    agentType: task.agentType,
    schedule,
    enabled: task.enabled,
    prompt: task.prompt,
    tools: Array.isArray(task.tools) ? (task.tools as string[]) : [],
    state: {
      nextRunAtMs: task.nextRunAt?.getTime(),
      runningAtMs: undefined,
      lastRunAtMs: task.lastRunAt?.getTime(),
      lastError: task.lastError ?? undefined,
      consecutiveErrors: task.lastError ? 1 : 0,
    },
    createdAtMs: task.createdAt.getTime(),
    updatedAtMs: task.updatedAt.getTime(),
  };
}

/**
 * 加载所有 cron 任务
 */
export async function loadCronJobs(): Promise<CronJob[]> {
  const tasks = await prisma.task.findMany({
    where: { triggerType: "cron" },
  });
  return tasks.map((t) =>
    taskToCronJob({
      id: t.id,
      name: t.name,
      description: t.description,
      agentType: t.agentType,
      cronExpr: t.cronExpr,
      scheduleKind: t.scheduleKind,
      everyMs: t.everyMs,
      atMs: t.atMs,
      nextRunAt: t.nextRunAt,
      lastRunAt: t.lastRunAt,
      lastError: t.lastError,
      enabled: t.enabled,
      prompt: t.prompt,
      tools: t.tools,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
  );
}

/**
 * 保存任务状态更新
 */
export async function updateCronJobState(
  jobId: string,
  _state: Partial<CronJobState>,
  nextRunAtMs?: number
): Promise<void> {
  await prisma.task.update({
    where: { id: jobId },
    data: {
      lastRunAt: _state.lastRunAtMs ? new Date(_state.lastRunAtMs) : undefined,
      lastError: _state.lastError ?? null,
      nextRunAt: nextRunAtMs ? new Date(nextRunAtMs) : undefined,
    },
  });
}

/**
 * 标记任务为运行中
 */
export async function markJobRunning(jobId: string, startedAtMs: number): Promise<void> {
  await prisma.task.update({
    where: { id: jobId },
    data: { lastRunAt: new Date(startedAtMs) },
  });
}

/**
 * 标记任务运行结束
 */
export async function markJobFinished(
  jobId: string,
  endedAtMs: number,
  error?: string,
  nextRunAtMs?: number
): Promise<void> {
  await prisma.task.update({
    where: { id: jobId },
    data: {
      lastRunAt: new Date(endedAtMs),
      lastError: error ?? null,
      nextRunAt: nextRunAtMs ? new Date(nextRunAtMs) : undefined,
    },
  });
}

/**
 * 获取运行中的任务数
 */
export async function getRunningJobsCount(): Promise<number> {
  const now = new Date();
  // 5分钟内有更新且未完成的视为运行中
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

  return await prisma.task.count({
    where: {
      triggerType: "cron",
      enabled: true,
      lastRunAt: {
        gte: fiveMinutesAgo,
        lte: now,
      },
    },
  });
}

/**
 * 查找到期的任务
 */
export async function findDueJobs(nowMs: number): Promise<CronJob[]> {
  const tasks = await prisma.task.findMany({
    where: {
      triggerType: "cron",
      enabled: true,
      nextRunAt: {
        lte: new Date(nowMs),
      },
    },
  });
  return tasks.map((t) =>
    taskToCronJob({
      id: t.id,
      name: t.name,
      description: t.description,
      agentType: t.agentType,
      cronExpr: t.cronExpr,
      scheduleKind: t.scheduleKind,
      everyMs: t.everyMs,
      atMs: t.atMs,
      nextRunAt: t.nextRunAt,
      lastRunAt: t.lastRunAt,
      lastError: t.lastError,
      enabled: t.enabled,
      prompt: t.prompt,
      tools: t.tools,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
  );
}

/**
 * 获取最近一次运行的超时任务
 */
export async function findStaleRunningJobs(): Promise<CronJob[]> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  // 查找5分钟前开始但还没结束的任务（可能是崩溃了）
  const tasks = await prisma.task.findMany({
    where: {
      triggerType: "cron",
      enabled: true,
      lastRunAt: {
        gte: fiveMinutesAgo,
      },
    },
  });

  return tasks.map((t) =>
    taskToCronJob({
      id: t.id,
      name: t.name,
      description: t.description,
      agentType: t.agentType,
      cronExpr: t.cronExpr,
      scheduleKind: t.scheduleKind,
      everyMs: t.everyMs,
      atMs: t.atMs,
      nextRunAt: t.nextRunAt,
      lastRunAt: t.lastRunAt,
      lastError: t.lastError,
      enabled: t.enabled,
      prompt: t.prompt,
      tools: t.tools,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })
  );
}
