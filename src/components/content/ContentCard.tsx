"use client";

import Link from "next/link";
import Image from "next/image";

interface ContentCardProps {
  id: string;
  title: string;
  slug: string;
  category: string;
  categoryLabel?: string;
  metadata: {
    tags?: string[];
    description?: string;
    coverImage?: string;
    [key: string]: unknown;
  };
  createdAt: string;
  viewCount: number;
  isAdmin?: boolean;
}

function getCoverImage(id: string, coverImage?: string): string {
  if (coverImage) return coverImage;
  return `https://picsum.photos/seed/${id}/600/300`;
}

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
  categoryLabel: propCategoryLabel,
  metadata,
  createdAt,
  viewCount,
  isAdmin = false,
}: ContentCardProps) {
  const tags = metadata?.tags || [];
  const description = metadata?.description || "";
  const displayLabel = propCategoryLabel || category;

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
          {/* Cover Image */}
          <div className="relative h-[140px] overflow-hidden">
            <Image
              src={getCoverImage(id, metadata.coverImage)}
              alt={title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            />
            {/* Category label */}
            <span
              className="absolute top-3 left-3 px-2.5 py-0.5 rounded-full text-xs font-medium"
              style={{
                background: "rgba(0,0,0,0.4)",
                color: "#fff",
                backdropFilter: "blur(4px)",
              }}
            >
              {displayLabel}
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

      {/* Admin edit indicator */}
      {isAdmin && (
        <Link
          href={`/${category}/${slug}`}
          className="absolute top-[148px] right-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 px-3 py-1.5 rounded-lg text-xs font-medium text-white shadow-md"
          style={{ background: "var(--accent)" }}
        >
          编辑
        </Link>
      )}
    </div>
  );
}
