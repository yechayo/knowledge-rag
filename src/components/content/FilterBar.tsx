"use client";

interface FilterBarProps {
  tags: string[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
}

export default function FilterBar({
  tags,
  activeTag,
  onTagChange,
}: FilterBarProps) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => onTagChange(null)}
        className="px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200"
        style={{
          background: activeTag === null ? "var(--accent)" : "var(--card)",
          color: activeTag === null ? "#fff" : "var(--text-2)",
          border:
            activeTag === null ? "1px solid var(--accent)" : "1px solid var(--border)",
        }}
      >
        全部
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onTagChange(tag === activeTag ? null : tag)}
          className="px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200"
          style={{
            background: activeTag === tag ? "var(--accent)" : "var(--card)",
            color: activeTag === tag ? "#fff" : "var(--text-2)",
            border:
              activeTag === tag ? "1px solid var(--accent)" : "1px solid var(--border)",
          }}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
