"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import TopNav from "@/components/layout/TopNav";
import FilterBar from "@/components/content/FilterBar";
import ContentGrid from "@/components/content/ContentGrid";
import Pagination from "@/components/content/Pagination";

const categoryLabels: Record<string, string> = {
  article: "文章",
  project: "项目",
  note: "笔记",
  page: "页面",
};

interface ContentItem {
  id: string;
  title: string;
  slug: string;
  category: string;
  metadata: {
    tags?: string[];
    description?: string;
    [key: string]: unknown;
  };
  status: string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function CategoryPage() {
  const params = useParams<{ category: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: session } = useSession();

  const category = params.category;
  const categoryLabel = categoryLabels[category] || category;
  const isAdmin = !!(session?.user as any)?.isAdmin;

  const [items, setItems] = useState<ContentItem[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [tags, setTags] = useState<string[]>([]);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Sync URL search params to state on mount and when URL changes
  useEffect(() => {
    const pageParam = searchParams.get("page");
    const tagParam = searchParams.get("tag");
    setCurrentPage(pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1);
    setActiveTag(tagParam);
    setInitialized(true);
  }, [searchParams]);

  // Fetch data
  const fetchData = useCallback(
    async (page: number, tag: string | null) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          category,
          status: "published",
          page: String(page),
          limit: "12",
        });
        if (tag) params.set("tag", tag);

        const res = await fetch(`/api/content?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json();

        setItems(data.items || []);
        setTotalPages(data.totalPages || 0);
        setCurrentPage(data.page || page);
      } catch (err) {
        console.error("Failed to fetch content:", err);
      } finally {
        setLoading(false);
      }
    },
    [category]
  );

  // Fetch when initialized or params change
  useEffect(() => {
    if (!initialized) return;
    fetchData(currentPage, activeTag);
  }, [initialized, currentPage, activeTag, fetchData]);

  // Also fetch all tags once for counts
  useEffect(() => {
    if (!category) return;
    async function fetchAllTags() {
      try {
        const res = await fetch(
          `/api/content?category=${category}&status=published&limit=100`
        );
        if (!res.ok) return;
        const data = await res.json();
        const allTags = new Set<string>();
        const counts: Record<string, number> = {};
        (data.items || []).forEach((item: ContentItem) => {
          (item.metadata?.tags || []).forEach((t: string) => {
            allTags.add(t);
            counts[t] = (counts[t] || 0) + 1;
          });
        });
        setTags(Array.from(allTags).sort());
        setTagCounts(counts);
      } catch {
        // ignore
      }
    }
    fetchAllTags();
  }, [category]);

  function handlePageChange(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page > 1) {
      params.set("page", String(page));
    } else {
      params.delete("page");
    }
    router.push(`/${category}?${params.toString()}`);
  }

  function handleTagChange(tag: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (tag) {
      params.set("tag", tag);
    } else {
      params.delete("tag");
    }
    params.delete("page"); // Reset page when tag changes
    router.push(`/${category}?${params.toString()}`);
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <TopNav />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1
            className="text-2xl font-bold mb-1"
            style={{ color: "var(--text-1)" }}
          >
            {categoryLabel}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            共 {totalPages > 0 ? "多" : "0"} 篇内容
          </p>
        </div>

        {/* Filter Bar */}
        {tags.length > 0 && (
          <div className="mb-6">
            <FilterBar
              tags={tags}
              activeTag={activeTag}
              onTagChange={handleTagChange}
              tagCounts={tagCounts}
            />
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div
              className="flex items-center gap-2 text-sm"
              style={{ color: "var(--text-3)" }}
            >
              <svg
                className="animate-spin w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              加载中...
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <svg
              className="w-16 h-16 mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              style={{ color: "var(--text-3)" }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
            <p
              className="text-base font-medium mb-1"
              style={{ color: "var(--text-2)" }}
            >
              {activeTag ? `没有包含"${activeTag}"标签的内容` : "暂无内容"}
            </p>
            <p className="text-sm" style={{ color: "var(--text-3)" }}>
              {activeTag
                ? "尝试选择其他标签或查看全部"
                : "敬请期待更多内容发布"}
            </p>
          </div>
        )}

        {/* Content Grid */}
        {!loading && items.length > 0 && (
          <>
            <ContentGrid items={items} isAdmin={isAdmin} />

            {/* Pagination */}
            <div className="mt-8">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
