"use client";

import { useState, useEffect } from "react";

interface Task {
  id: string;
  name: string;
  description: string | null;
  agentType: string;
  triggerType: string;
  cronExpr: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function TaskPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const [togglingTasks, setTogglingTasks] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // 获取任务列表
  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/agent");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // 触发任务执行
  const runTask = async (taskId: string) => {
    setLoading(true);
    setRunningTasks((prev) => new Set(prev).add(taskId));
    setError(null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to run task");
      }

      const result = await res.json();
      alert(`任务执行完成: ${JSON.stringify(result.result, null, 2)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task execution failed");
    } finally {
      setLoading(false);
      setRunningTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  // 切换任务激活状态
  const toggleTask = async (taskId: string, isActive: boolean) => {
    setTogglingTasks((prev) => new Set(prev).add(taskId));
    try {
      const res = await fetch(`/api/agent/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      fetchTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setTogglingTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">任务面板</h3>
        <button
          onClick={fetchTasks}
          className="text-sm text-[var(--text-2)] hover:text-[var(--text-1)]"
        >
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-2)]">
            <p>暂无任务</p>
            <p className="text-sm mt-1">数据库中将自动创建一个示例新闻早报任务</p>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="bg-[var(--bg)] rounded-lg p-4 border border-[var(--border)]"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{task.name}</h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        task.isActive
                          ? "bg-green-500/20 text-green-500"
                          : "bg-gray-500/20 text-gray-500"
                      }`}
                    >
                      {task.isActive ? "激活" : "禁用"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-500">
                      {task.triggerType}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-sm text-[var(--text-2)] mt-1">
                      {task.description}
                    </p>
                  )}
                  {task.cronExpr && (
                    <p className="text-xs text-[var(--text-2)] mt-1">
                      Cron: {task.cronExpr}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleTask(task.id, !task.isActive)}
                    disabled={togglingTasks.has(task.id)}
                    className="text-xs px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)] disabled:opacity-50"
                  >
                    {togglingTasks.has(task.id) ? "处理中..." : task.isActive ? "禁用" : "激活"}
                  </button>
                  <button
                    onClick={() => runTask(task.id)}
                    disabled={loading || runningTasks.has(task.id)}
                    className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    {runningTasks.has(task.id) ? "运行中..." : "执行"}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 快速创建示例任务 */}
      {tasks.length === 0 && (
        <button
          onClick={async () => {
            try {
              await fetch("/api/agent", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: "daily-news",
                  description: "每日新闻早报",
                  agentType: "react",
                  triggerType: "manual",
                  prompt:
                    "你是一个新闻助手，请搜索今日新闻并整理成早报发布到网站",
                  tools: ["duckduckgo_search", "create_content", "list_content", "delete_content"],
                }),
              });
              fetchTasks();
            } catch (err) {
              setError("Failed to create task");
            }
          }}
          className="mt-4 w-full py-2 rounded bg-blue-500 text-white hover:bg-blue-600"
        >
          创建示例新闻任务
        </button>
      )}
    </div>
  );
}
