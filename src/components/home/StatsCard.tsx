"use client";

import { useEffect, useRef, useState } from "react";

interface StatItem {
  label: string;
  value: number;
  suffix?: string;
}

const defaultStats: StatItem[] = [
  { label: "运行天数", value: 365 },
  { label: "文章数", value: 42 },
  { label: "标签数", value: 18 },
  { label: "项目数", value: 6 },
];

function useCountUp(target: number, duration = 1200) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          const start = performance.now();
          const animate = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            setCount(Math.floor(eased * target));
            if (progress < 1) {
              requestAnimationFrame(animate);
            } else {
              setCount(target);
            }
          };
          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration]);

  return { count, ref };
}

export default function StatsCard() {
  const stats = defaultStats.map((stat) => {
    const { count, ref } = useCountUp(stat.value);
    return { ...stat, count, ref };
  });

  return (
    <div className="card h-full flex flex-col justify-center">
      <div className="grid grid-cols-2 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="text-center py-2">
            <span
              ref={stat.ref}
              className="text-2xl font-bold tabular-nums"
              style={{ color: "var(--text-1)" }}
            >
              {stat.count}
            </span>
            <p
              className="text-xs mt-1"
              style={{ color: "var(--text-3)" }}
            >
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
