"use client";

import { useEffect, useMemo, useState } from "react";

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

  const headings = useMemo<TocItem[]>(() => {
    // 从 Markdown 原文解析标题
    const regex = /^(#{2,3})\s+(.+)$/gm;
    const items: TocItem[] = [];
    let match;
    while ((match = regex.exec(body)) !== null) {
      const level = match[1].length; // 2 = h2, 3 = h3
      const text = match[2].trim();
      // 生成 id：去除特殊字符，用连字符连接
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
        .replace(/\s+/g, "-");
      items.push({ id, text, level });
    }
    return items;
  }, [body]);

  useEffect(() => {
    if (headings.length === 0) return;

    // 给页面中已渲染的标题元素设置 id（marked 生成的标题默认没有 id）
    headings.forEach(({ id, text, level }) => {
      // 找到对应的 h2/h3 元素
      const elements = document.querySelectorAll(`.markdown-content h${level}`);
      for (const el of elements) {
        if (el.textContent?.trim() === text && !el.id) {
          el.id = id;
          break;
        }
      }
    });

    // IntersectionObserver 高亮当前阅读位置
    const observer = new IntersectionObserver(
      (entries) => {
        // 找到最上方可见的标题
        const visible: { id: string; ratio: number }[] = [];
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.push({
              id: entry.target.id,
              ratio: entry.intersectionRatio,
            });
          }
        }
        if (visible.length > 0) {
          // 选择 ratio 最高的
          visible.sort((a, b) => b.ratio - a.ratio);
          setActiveId(visible[0].id);
        }
      },
      {
        rootMargin: "-80px 0px -60% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    headings.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [headings]);

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
