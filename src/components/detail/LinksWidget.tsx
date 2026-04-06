"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ArticleItem {
  slug: string;
  title: string;
  category: string;
}

interface LinksWidgetProps {
  category: string;
  currentSlug: string;
}

export default function LinksWidget({ category, currentSlug }: LinksWidgetProps) {
  const [articles, setArticles] = useState<ArticleItem[]>([]);

  useEffect(() => {
    async function fetchArticles() {
      try {
        const res = await fetch(`/api/content?category=${category}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          const items = (data.items || [])
            .filter((item: any) => item.slug !== currentSlug)
            .slice(0, 8) as ArticleItem[];
          setArticles(items);
        }
      } catch {
        // ignore
      }
    }

    fetchArticles();
  }, [category, currentSlug]);

  if (articles.length === 0) return null;

  return (
    <div>
      <h3
        className="text-xs font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--text-3)" }}
      >
        相关文章
      </h3>
      <ul className="space-y-1">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/${article.category}/${article.slug}`}
              className="block text-sm px-2 py-1.5 rounded transition-colors truncate"
              style={{
                color: "var(--text-2)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.background = "var(--accent-bg)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-2)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              {article.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
