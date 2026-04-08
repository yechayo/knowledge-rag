"use client";

import { useEffect, useRef, useState } from "react";

interface StatItem {
  label: string;
  value: number;
}

const FALLBACK: StatItem[] = [
  { label: "运行天数", value: 0 },
  { label: "文章数", value: 0 },
  { label: "标签数", value: 0 },
  { label: "总浏览", value: 0 },
];

function StatCountUp({ value, label }: { value: number; label: string }) {
  const [count, setCount] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!Number.isFinite(value) || value < 0) {
      setCount(0);
      return;
    }

    const start = performance.now();
    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / 1200, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * value));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setCount(value);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [value]);

  return (
    <div className="text-center py-2">
      <span
        className="text-2xl font-bold tabular-nums"
        style={{ color: "var(--text-1)" }}
      >
        {count}
      </span>
      <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
        {label}
      </p>
    </div>
  );
}

export default function StatsCard() {
  const [stats, setStats] = useState<StatItem[]>(FALLBACK);

  useEffect(() => {
    fetch("/api/stats", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats api failed"))))
      .then((data) => {
        // 固定从 2026/3/9 开始计算运行天数
        const startDate = new Date("2026-03-09");
        const now = new Date();
        const daysSinceCreation = Math.max(
          0,
          Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
        );

        const totalArticles = Number(data.totalArticles ?? 0);
        const totalProjects = Number(data.totalProjects ?? 0);
        const totalNotes = Number(data.totalNotes ?? 0);
        const totalTags = Number(data.totalTags ?? 0);
        const totalViews = Number(data.totalViews ?? 0);

        setStats([
          { label: "运行天数", value: Number.isFinite(daysSinceCreation) ? daysSinceCreation : 0 },
          {
            label: "文章数",
            value:
              (Number.isFinite(totalArticles) ? totalArticles : 0) +
              (Number.isFinite(totalProjects) ? totalProjects : 0) +
              (Number.isFinite(totalNotes) ? totalNotes : 0),
          },
          { label: "标签数", value: Number.isFinite(totalTags) ? totalTags : 0 },
          { label: "总浏览", value: Number.isFinite(totalViews) ? totalViews : 0 },
        ]);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="card h-full flex flex-col justify-center">
      <div className="grid grid-cols-2 gap-4">
        {stats.map((stat) => (
          <StatCountUp key={stat.label} value={stat.value} label={stat.label} />
        ))}
      </div>
    </div>
  );
}
