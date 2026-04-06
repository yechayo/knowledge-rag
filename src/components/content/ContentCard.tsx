"use client";

import Link from "next/link";

interface ContentCardProps {
  id: string;
  title: string;
  slug: string;
  category: string;
  metadata: {
    tags?: string[];
    description?: string;
    [key: string]: unknown;
  };
  createdAt: string;
  viewCount: number;
  isAdmin?: boolean;
}

const categoryConfig: Record<
  string,
  { label: string; gradient: string; icon: string }
> = {
  article: {
    label: "文章",
    gradient: "linear-gradient(135deg, #6366f1, #8b5cf6)",
    icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  },
  project: {
    label: "项目",
    gradient: "linear-gradient(135deg, #f59e0b, #ef4444)",
    icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  },
  note: {
    label: "笔记",
    gradient: "linear-gradient(135deg, #10b981, #06b6d4)",
    icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  },
  page: {
    label: "页面",
    gradient: "linear-gradient(135deg, #ec4899, #8b5cf6)",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ContentCard({
  id,
  title,
  slug,
  category,
  metadata,
  createdAt,
  viewCount,
  isAdmin = false,
}: ContentCardProps) {
  const tags = metadata?.tags || [];
  const description = metadata?.description || "";
  const config = categoryConfig[category] || categoryConfig.article;

  return (
    <div className="group relative">
      <Link href={`/${category}/${slug}`} className="block">
        <div
          className="rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          {/* Gradient Banner */}
          <div
            className="relative h-[140px] flex items-center justify-center"
            style={{ background: config.gradient }}
          >
            <svg
              className="w-12 h-12 text-white/80"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={config.icon}
              />
            </svg>

            {/* Category label */}
            <span
              className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-xs font-medium"
              style={{
                background: "rgba(255,255,255,0.2)",
                color: "#fff",
                backdropFilter: "blur(4px)",
              }}
            >
              {config.label}
            </span>
          </div>

          {/* Content */}
          <div className="p-4">
            {/* Tag chips */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {tags.slice(0, 3).map((tag: string) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-xs"
                    style={{
                      background: "var(--accent-bg)",
                      color: "var(--accent)",
                    }}
                  >
                    {tag}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span
                    className="px-2 py-0.5 rounded-full text-xs"
                    style={{
                      background: "var(--card-hover)",
                      color: "var(--text-3)",
                    }}
                  >
                    +{tags.length - 3}
                  </span>
                )}
              </div>
            )}

            {/* Title */}
            <h3
              className="text-base font-semibold leading-snug mb-2 transition-colors duration-200 group-hover:text-[var(--accent)]"
              style={{
                color: "var(--text-1)",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {title}
            </h3>

            {/* Description (optional) */}
            {description && (
              <p
                className="text-sm mb-3 leading-relaxed"
                style={{
                  color: "var(--text-2)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {description}
              </p>
            )}

            {/* Meta */}
            <div
              className="flex items-center gap-3 text-xs"
              style={{ color: "var(--text-3)" }}
            >
              <span>{formatDate(createdAt)}</span>
              {viewCount > 0 && (
                <>
                  <span style={{ color: "var(--border)" }}>-</span>
                  <span>{viewCount} 次浏览</span>
                </>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Admin edit button */}
      {isAdmin && (
        <Link
          href={`/admin/edit/${id}`}
          className="absolute top-[148px] right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-md"
          style={{ background: "var(--accent)" }}
        >
          编辑
        </Link>
      )}
    </div>
  );
}
