"use client";

interface FilterBarProps {
  tags: string[];
  activeTag: string | null;
  onTagChange: (tag: string | null) => void;
  tagCounts?: Record<string, number>;
}

export default function FilterBar({
  tags,
  activeTag,
  onTagChange,
  tagCounts,
}: FilterBarProps) {
  if (tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => onTagChange(null)}
        className="px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-1"
        style={{
          background: activeTag === null ? "var(--accent)" : "var(--card)",
          color: activeTag === null ? "#fff" : "var(--text-2)",
          border:
            activeTag === null ? "1px solid var(--accent)" : "1px solid var(--border)",
        }}
      >
        全部
        {tagCounts && (
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{
              background: activeTag === null ? "rgba(255,255,255,0.2)" : "var(--bg-2)",
              color: activeTag === null ? "#fff" : "var(--text-3)",
            }}
          >
            {Object.values(tagCounts).reduce((sum, count) => sum + count, 0)}
          </span>
        )}
      </button>
      {tags.map((tag) => (
        <button
          key={tag}
          onClick={() => onTagChange(tag === activeTag ? null : tag)}
          className="px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 flex items-center gap-1"
          style={{
            background: activeTag === tag ? "var(--accent)" : "var(--card)",
            color: activeTag === tag ? "#fff" : "var(--text-2)",
            border:
              activeTag === tag ? "1px solid var(--accent)" : "1px solid var(--border)",
          }}
        >
          {tag}
          {tagCounts && tagCounts[tag] !== undefined && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                background: activeTag === tag ? "rgba(255,255,255,0.2)" : "var(--bg-2)",
                color: activeTag === tag ? "#fff" : "var(--text-3)",
              }}
            >
              {tagCounts[tag]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
