"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createUniqueHeadingAnchorGenerator } from "@/lib/heading-anchor";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TocWidgetProps {
  body: string;
}

export default function TocWidget({ body }: TocWidgetProps) {
  const [activeId, setActiveId] = useState<string>("");
  const tickingRef = useRef(false);

  const headings = useMemo<TocItem[]>(() => {
    // 从 Markdown 原文解析标题
    const regex = /^(#{2,3})\s+(.+)$/gm;
    const nextHeadingAnchor = createUniqueHeadingAnchorGenerator();
    const items: TocItem[] = [];
    let match;
    while ((match = regex.exec(body)) !== null) {
      const level = match[1].length; // 2 = h2, 3 = h3
      const text = match[2].trim();
      const id = nextHeadingAnchor(text);
      if (!id) continue;
      items.push({ id, text, level });
    }
    return items;
  }, [body]);

  const updateActive = useCallback(() => {
    // 找到当前最靠近视口顶部的标题
    let closest: { id: string; top: number } | null = null;
    for (const { id } of headings) {
      const el = document.getElementById(id);
      if (!el) continue;
      const top = el.getBoundingClientRect().top;
      // 标题在导航栏下方（80px）且在视口上半部分
      if (top <= 100) {
        if (!closest || top > closest.top) {
          closest = { id, top };
        }
      }
    }
    setActiveId(closest ? closest.id : headings[0]?.id || "");
  }, [headings]);

  useEffect(() => {
    if (headings.length === 0) return;

    // 初始化时设置一次
    const initialFrame = requestAnimationFrame(updateActive);

    const onScroll = () => {
      if (!tickingRef.current) {
        tickingRef.current = true;
        requestAnimationFrame(() => {
          updateActive();
          tickingRef.current = false;
        });
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(initialFrame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [headings, updateActive]);

  if (headings.length === 0) return null;

  const handleClick = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div>
      <h3
        className="text-xs font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--text-3)" }}
      >
        目录
      </h3>
      <ul className="space-y-1 text-sm">
        {headings.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => handleClick(item.id)}
              className="block w-full text-left transition-colors rounded px-2 py-1"
              style={{
                paddingLeft: item.level === 3 ? "1.25rem" : "0.5rem",
                color:
                  activeId === item.id
                    ? "var(--accent)"
                    : "var(--text-2)",
                fontWeight: activeId === item.id ? 600 : 400,
                background:
                  activeId === item.id ? "var(--accent-bg)" : "transparent",
              }}
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
