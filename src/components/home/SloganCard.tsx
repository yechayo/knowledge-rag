"use client";

import { useState, useEffect, useCallback } from "react";

const defaultSlogans = [
  "代码是最好的文档。",
  "保持简单，保持愚蠢。",
  "先让它工作，再让它正确，最后让它快速。",
  "好的设计是显而易见的，伟大的设计是透明的。",
  "重复是软件中一切邪恶的根源。",
  "过早优化是万恶之源。",
  "简单是终极的复杂。",
];

export default function SloganCard() {
  const [slogans, setSlogans] = useState<string[]>(defaultSlogans);
  const [index, setIndex] = useState(0);
  const [isSpinning, setIsSpinning] = useState(false);

  useEffect(() => {
    fetch("/api/content?category=slogan&status=published")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setSlogans(data.map((item: Record<string, string>) => item.content || item.title));
          setIndex(0);
        }
      })
      .catch(() => {
        // Use defaults
      });
  }, []);

  const refresh = useCallback(() => {
    if (isSpinning) return;
    setIsSpinning(true);
    setIndex((prev) => (prev + 1) % slogans.length);
    setTimeout(() => setIsSpinning(false), 500);
  }, [isSpinning, slogans.length]);

  return (
    <div className="card h-full flex flex-col items-center justify-center relative">
      {/* Quotation marks */}
      <div
        className="text-5xl font-serif leading-none select-none mb-2"
        style={{ color: "var(--accent)", opacity: 0.3 }}
      >
        &ldquo;
      </div>

      {/* Slogan text */}
      <p
        className="text-sm text-center leading-relaxed px-2"
        style={{ color: "var(--text-2)" }}
      >
        {slogans[index]}
      </p>

      {/* Close quote */}
      <div
        className="text-5xl font-serif leading-none select-none mt-2 self-end mr-2"
        style={{ color: "var(--accent)", opacity: 0.3 }}
      >
        &rdquo;
      </div>

      {/* Refresh button */}
      <button
        onClick={refresh}
        className="absolute bottom-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300"
        style={{
          border: "1px solid var(--border)",
          color: "var(--text-3)",
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.color = "var(--accent)";
          el.style.borderColor = "rgba(99,102,241,0.3)";
          el.style.transform = "rotate(180deg)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.color = "var(--text-3)";
          el.style.borderColor = "var(--border)";
          el.style.transform = "rotate(0deg)";
        }}
        aria-label="刷新格言"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>
  );
}
