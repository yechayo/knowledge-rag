/**
 * CronService - 定时任务调度服务
 */
import type { CronJob, CronServiceDeps, CronServiceStatus, CronSchedule } from "./types";
import { computeJobNextRunAtMs } from "./jobs";
import {
  runDueJobs,
  armTimer,
  disarmTimer,
  recoverMissedJobs,
  nextWakeAtMs,
  SchedulerState,
} from "./scheduler";
import { loadCronJobs, updateCronJobState } from "./store";

const DEFAULT_DEPS: CronServiceDeps = {
  nowMs: () => Date.now(),
  cronEnabled: true,
  maxConcurrentRuns: 1,
  defaultTimeoutMs: 5 * 60 * 1000, // 5分钟
};

export class CronService {
  private state: SchedulerState = { timer: null, runningJobs: new Set() };
  private deps: CronServiceDeps;
  private started = false;

  constructor(deps: Partial<CronServiceDeps> = {}) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  /** 启动调度器 */
  async start(): Promise<void> {
    if (!this.deps.cronEnabled) {
      console.log("[CronService] disabled");
      return;
    }

    if (this.started) return;
    this.started = true;

    // 恢复错过的任务
    await recoverMissedJobs(this.deps);

    // 加载任务并启动定时器
    const jobs = await loadCronJobs();
    this.scheduleNext(jobs);

    console.log(`[CronService] started with ${jobs.length} jobs`);
  }

  /** 停止调度器 */
  stop(): void {
    disarmTimer(this.state);
    this.started = false;
    console.log("[CronService] stopped");
  }

  /** 获取状态 */
  async status(): Promise<CronServiceStatus> {
    const jobs = await loadCronJobs();
    const nextWake = nextWakeAtMs(jobs, this.deps.nowMs());

    return {
      enabled: this.deps.cronEnabled,
      jobs: jobs.filter((j) => j.enabled).length,
      nextWakeAtMs: nextWake ?? null,
      running: this.state.runningJobs.size,
    };
  }

  /** 列出所有任务 */
  async list(): Promise<CronJob[]> {
    return await loadCronJobs();
  }

  /** 手动触发一次执行 */
  async run(id: string, forced = false): Promise<{ ok: boolean; reason?: string }> {
    const jobs = await loadCronJobs();
    const job = jobs.find((j) => j.id === id);

    if (!job) {
      return { ok: false, reason: "Job not found" };
    }

    if (!job.enabled) {
      return { ok: false, reason: "Job is disabled" };
    }

    const nowMs = this.deps.nowMs();

    if (!forced && !this.isDue(job, nowMs)) {
      return { ok: false, reason: "Job is not due yet" };
    }

    if (this.state.runningJobs.has(id)) {
      return { ok: false, reason: "Job is already running" };
    }

    this.state.runningJobs.add(id);

    try {
      // 动态导入避免循环依赖
      const { executeCronJob, handleJobResult } = await import("./scheduler");
      const result = await executeCronJob(job, this.deps);
      await handleJobResult(job, result, this.deps);

      return { ok: true };
    } finally {
      this.state.runningJobs.delete(id);
    }
  }

  /** 检查任务是否到期 */
  private isDue(job: CronJob, nowMs: number): boolean {
    const nextRunAt = job.state.nextRunAtMs;
    if (!nextRunAt) return false;
    return nextRunAt <= nowMs;
  }

  /** 调度下次执行 */
  private async scheduleNext(jobs?: CronJob[]): Promise<void> {
    if (!jobs) {
      jobs = await loadCronJobs();
    }

    // 确保所有任务都有 nextRunAt
    const nowMs = this.deps.nowMs();
    let changed = false;

    for (const job of jobs) {
      if (!job.enabled) continue;

      if (job.state.nextRunAtMs === undefined) {
        const nextRunAtMs = computeJobNextRunAtMs(job.schedule, nowMs);
        if (nextRunAtMs !== undefined) {
          await updateCronJobState(job.id, {}, nextRunAtMs);
          job.state.nextRunAtMs = nextRunAtMs;
          changed = true;
        }
      }
    }

    // 重新加载确保一致
    if (changed) {
      jobs = await loadCronJobs();
    }

    // 设置定时器
    armTimer(this.state, jobs, this.deps, () => this.onTimer());
  }

  /** 定时器回调 */
  private async onTimer(): Promise<void> {
    try {
      await runDueJobs(this.deps);
    } catch (err) {
      console.error("[CronService] runDueJobs error:", err);
    }

    // 重新调度
    const jobs = await loadCronJobs();
    this.scheduleNext(jobs);
  }

  /** 是否已启动 */
  isStarted(): boolean {
    return this.started;
  }
}

// 单例实例
let cronServiceInstance: CronService | null = null;

/**
 * 获取 CronService 单例
 */
export function getCronService(): CronService {
  if (!cronServiceInstance) {
    cronServiceInstance = new CronService();
  }
  return cronServiceInstance;
}

/**
 * 初始化并启动 CronService
 */
export async function startCronService(): Promise<CronService> {
  const service = getCronService();
  await service.start();
  return service;
}
