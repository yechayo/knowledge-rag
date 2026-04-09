"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/hooks/useAdmin";
import ReactECharts from "echarts-for-react";

interface DailyUsageStat {
  date: string;
  count: number;
  totalCitations: number;
  totalTokens: number;
  avgLatencyMs: number;
}

interface UsageLogItem {
  id: string;
  query: string;
  answerLength: number;
  citations: number;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
}

interface UsageStats {
  periodDays: number;
  totalQuestions: number;
  totalCitations: number;
  totalTokens: number;
  avgLatencyMs: number;
  recentLogs: UsageLogItem[];
  dailyStats: DailyUsageStat[];
}

interface StatsResponse {
  daysSinceCreation: number;
  totalArticles: number;
  totalProjects: number;
  totalNotes: number;
  totalTags: number;
  totalViews: number;
  usageStats: UsageStats;
}

// 通用主题配置
const chartTheme = {
  backgroundColor: "transparent",
  textStyle: { color: "#8b949e" },
};

export default function StatsPage() {
  const router = useRouter();
  const { isAdmin, isLoading } = useAdmin();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [usageDays, setUsageDays] = useState(7);

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/login");
    }
  }, [isLoading, isAdmin, router]);

  useEffect(() => {
    if (isAdmin) {
      fetch(`/api/stats?usageDays=${usageDays}`)
        .then((res) => res.json())
        .then((data) => setStats(data))
        .catch(console.error);
    }
  }, [isAdmin, usageDays]);

  if (isLoading || !stats || !stats.usageStats) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-[var(--text-2)]">加载中...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const { usageStats } = stats;

  // 每日问答趋势图配置
  const questionTrendOption = {
    ...chartTheme,
    title: {
      text: "每日问答趋势",
      textStyle: { color: "#c9d1d9", fontSize: 14, fontWeight: 500 },
      left: 0,
      top: 0,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(33, 38, 45, 0.95)",
      borderColor: "#30363d",
      textStyle: { color: "#c9d1d9" },
    },
    legend: {
      data: ["问答数", "引用数"],
      textStyle: { color: "#8b949e" },
      top: 0,
      right: 0,
    },
    grid: {
      left: 50,
      right: 20,
      top: 40,
      bottom: 30,
    },
    xAxis: {
      type: "category",
      data: usageStats.dailyStats
        .slice()
        .reverse()
        .map((d) =>
          new Date(d.date).toLocaleDateString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
          })
        ),
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e" },
    },
    yAxis: {
      type: "value",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e" },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    series: [
      {
        name: "问答数",
        type: "line",
        smooth: true,
        data: usageStats.dailyStats.slice().reverse().map((d) => d.count),
        lineStyle: { color: "#58a6ff", width: 2 },
        itemStyle: { color: "#58a6ff" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(88, 166, 255, 0.3)" },
              { offset: 1, color: "rgba(88, 166, 255, 0)" },
            ],
          },
        },
      },
      {
        name: "引用数",
        type: "line",
        smooth: true,
        data: usageStats.dailyStats
          .slice()
          .reverse()
          .map((d) => d.totalCitations),
        lineStyle: { color: "#3fb950", width: 2 },
        itemStyle: { color: "#3fb950" },
      },
    ],
  };

  // Token 消耗柱状图配置
  const tokenBarOption = {
    ...chartTheme,
    title: {
      text: "每日 Token 消耗",
      textStyle: { color: "#c9d1d9", fontSize: 14, fontWeight: 500 },
      left: 0,
      top: 0,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(33, 38, 45, 0.95)",
      borderColor: "#30363d",
      textStyle: { color: "#c9d1d9" },
      formatter: "{b}: {c} tokens",
    },
    grid: {
      left: 50,
      right: 20,
      top: 40,
      bottom: 30,
    },
    xAxis: {
      type: "category",
      data: usageStats.dailyStats
        .slice()
        .reverse()
        .map((d) =>
          new Date(d.date).toLocaleDateString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
          })
        ),
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e" },
    },
    yAxis: {
      type: "value",
      axisLine: { lineStyle: { color: "#30363d" } },
      axisLabel: { color: "#8b949e" },
      splitLine: { lineStyle: { color: "#21262d" } },
    },
    series: [
      {
        name: "Token",
        type: "bar",
        data: usageStats.dailyStats.slice().reverse().map((d) => d.totalTokens),
        itemStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "#bc8cff" },
              { offset: 1, color: "#8b5cf6" },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: "50%",
      },
    ],
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] p-6">
      <div className="max-w-7xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--text-1)]">数据统计</h1>
          <p className="text-[var(--text-2)] mt-1">查看网站内容和使用量数据</p>
        </div>

        {/* 时间范围选择 */}
        <div className="mb-6 flex gap-2">
          {[7, 14, 30].map((days) => (
            <button
              key={days}
              onClick={() => setUsageDays(days)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                usageDays === days
                  ? "bg-[var(--accent)] text-white"
                  : "bg-[var(--card)] text-[var(--text-2)] hover:bg-[var(--card-hover)]"
              }`}
            >
              近 {days} 天
            </button>
          ))}
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard
            label="问答总数"
            value={usageStats.totalQuestions}
            subText={`近 ${usageStats.periodDays} 天`}
            color="blue"
          />
          <StatCard
            label="Token 消耗"
            value={(usageStats.totalTokens / 1000).toFixed(1)}
            unit="k"
            subText="总消耗量"
            color="purple"
          />
          <StatCard
            label="引用总数"
            value={usageStats.totalCitations}
            subText={`均 ${usageStats.totalQuestions > 0 ? (usageStats.totalCitations / usageStats.totalQuestions).toFixed(1) : 0} 个/次`}
            color="green"
          />
          <StatCard
            label="平均延迟"
            value={usageStats.avgLatencyMs}
            unit="ms"
            subText="响应速度"
            color="orange"
          />
          <StatCard
            label="日均问答"
            value={
              usageStats.dailyStats.length > 0
                ? Math.round(
                    usageStats.totalQuestions / usageStats.dailyStats.length
                  )
                : 0
            }
            subText={`${usageStats.dailyStats.length} 天有数据`}
            color="cyan"
          />
        </div>

        {/* 图表区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* 问答趋势图 */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <ReactECharts
              option={questionTrendOption}
              style={{ height: 280 }}
              opts={{ renderer: "svg" }}
            />
          </div>

          {/* Token 消耗图 */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <ReactECharts
              option={tokenBarOption}
              style={{ height: 280 }}
              opts={{ renderer: "svg" }}
            />
          </div>
        </div>

        {/* 最近问答记录 */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <h2 className="text-lg font-semibold text-[var(--text-1)] mb-4">
            最近问答记录
          </h2>
          {usageStats.recentLogs.length === 0 ? (
            <div className="text-[var(--text-3)] text-center py-8">暂无记录</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left py-2 px-3 text-[var(--text-3)] text-sm font-medium">
                      问题
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-3)] text-sm font-medium">
                      Tokens
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-3)] text-sm font-medium">
                      字数
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-3)] text-sm font-medium">
                      引用
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-3)] text-sm font-medium">
                      延迟
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-3)] text-sm font-medium">
                      时间
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {usageStats.recentLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)] transition-colors"
                    >
                      <td className="py-3 px-3 text-[var(--text-1)] text-sm max-w-md truncate">
                        {log.query}
                      </td>
                      <td className="py-3 px-3 text-right text-[var(--text-2)] text-sm">
                        {log.totalTokens}
                      </td>
                      <td className="py-3 px-3 text-right text-[var(--text-2)] text-sm">
                        {log.answerLength}
                      </td>
                      <td className="py-3 px-3 text-right text-[var(--text-2)] text-sm">
                        {log.citations}
                      </td>
                      <td className="py-3 px-3 text-right text-[var(--text-2)] text-sm">
                        {log.latencyMs}ms
                      </td>
                      <td className="py-3 px-3 text-right text-[var(--text-3)] text-sm">
                        {new Date(log.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// 统计卡片组件
function StatCard({
  label,
  value,
  unit,
  subText,
  color,
}: {
  label: string;
  value: number | string;
  unit?: string;
  subText: string;
  color: "blue" | "purple" | "green" | "orange" | "cyan";
}) {
  const colors = {
    blue: "from-blue-500/20 to-blue-500/5 border-blue-500/30",
    purple: "from-purple-500/20 to-purple-500/5 border-purple-500/30",
    green: "from-green-500/20 to-green-500/5 border-green-500/30",
    orange: "from-orange-500/20 to-orange-500/5 border-orange-500/30",
    cyan: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30",
  };

  return (
    <div
      className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-4`}
    >
      <div className="text-[var(--text-3)] text-xs mb-1">{label}</div>
      <div className="text-2xl font-bold text-[var(--text-1)]">
        {value}
        {unit && <span className="text-sm font-normal ml-0.5">{unit}</span>}
      </div>
      <div className="text-[var(--text-3)] text-xs mt-1">{subText}</div>
    </div>
  );
}
