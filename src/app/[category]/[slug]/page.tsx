"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/layout/TopNav";
import Sidebar from "@/components/detail/Sidebar";
import ArticleBody from "@/components/detail/ArticleBody";
import AnimatedWrapper from "@/components/ui/AnimatedWrapper";

interface ContentData {
  id: string;
  title: string;
  slug: string;
  body: string;
  category: string;
  metadata: {
    tags?: string[];
    [key: string]: unknown;
  };
  status: string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AdjacentArticle {
  slug: string;
  title: string;
  category: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function estimateReadingTime(body: string): number {
  // 中文按 300 字/分钟估算
  const chineseChars = (body.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = body.replace(/[\u4e00-\u9fff]/g, "").split(/\s+/).filter(Boolean).length;
  const totalMinutes = Math.ceil(chineseChars / 300 + englishWords / 200);
  return Math.max(1, totalMinutes);
}

const categoryLabels: Record<string, string> = {
  article: "文章",
  project: "项目",
  note: "笔记",
  page: "页面",
};

export default function DetailPage() {
  const { category, slug } = useParams<{ category: string; slug: string }>();
  const [content, setContent] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [prevArticle, setPrevArticle] = useState<AdjacentArticle | null>(null);
  const [nextArticle, setNextArticle] = useState<AdjacentArticle | null>(null);

  useEffect(() => {
    if (!slug) return;

    async function fetchContent() {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await fetch(`/api/content/${slug}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setContent(data);

        // 获取相邻文章（同分类，按时间排序）
        fetchAdjacentArticles(data.category, data.createdAt);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }

    fetchContent();
  }, [slug]);

  async function fetchAdjacentArticles(currentCategory: string, currentCreatedAt: string) {
    try {
      const res = await fetch(`/api/content?category=${currentCategory}&limit=100`);
      if (!res.ok) return;
      const data = await res.json();
      const items = (data.items || [])
        .filter((item: any) => item.status === "published")
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const currentIndex = items.findIndex(
        (item: any) => item.createdAt === currentCreatedAt
      );

      if (currentIndex > 0) {
        setPrevArticle(items[currentIndex - 1]);
      }
      if (currentIndex < items.length - 1) {
        setNextArticle(items[currentIndex + 1]);
      }
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <TopNav />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 80px)" }}>
          <div className="flex items-center gap-2" style={{ color: "var(--text-3)" }}>
            <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            加载中...
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !content) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <TopNav />
        <div className="flex flex-col items-center justify-center" style={{ minHeight: "calc(100vh - 80px)" }}>
          <h1 className="text-6xl font-bold mb-4" style={{ color: "var(--text-3)" }}>404</h1>
          <p className="text-lg mb-6" style={{ color: "var(--text-2)" }}>页面不存在</p>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const tags = content.metadata?.tags || [];
  const readingTime = estimateReadingTime(content.body);
  const categoryLabel = categoryLabels[content.category] || content.category;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <TopNav />

      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex gap-6">
          {/* Sidebar */}
          <Sidebar body={content.body} category={content.category} currentSlug={content.slug} />

          {/* Main Content */}
          <main className="flex-1 min-w-0">
            {/* Banner */}
            <AnimatedWrapper index={0}>
            <div
              className="rounded-2xl p-6 sm:p-8 mb-6"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(168,85,247,0.08))",
                border: "1px solid var(--border)",
              }}
            >
              {/* Category + Tags */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span
                  className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: "var(--accent-bg)", color: "var(--accent)" }}
                >
                  {categoryLabel}
                </span>
                {tags.map((tag: string) => (
                  <span
                    key={tag}
                    className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: "var(--card)", color: "var(--text-2)", border: "1px solid var(--border)" }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              {/* Title */}
              <h1
                className="text-2xl sm:text-3xl font-bold mb-3 leading-tight"
                style={{ color: "var(--text-1)" }}
              >
                {content.title}
              </h1>

              {/* Meta */}
              <div
                className="flex flex-wrap items-center gap-4 text-sm"
                style={{ color: "var(--text-3)" }}
              >
                <span>{formatDate(content.createdAt)}</span>
                <span>{readingTime} 分钟阅读</span>
                <span>{content.viewCount} 次浏览</span>
              </div>
            </div>
            </AnimatedWrapper>

            {/* Article Body */}
            <AnimatedWrapper index={1}>
            <div
              className="rounded-2xl p-6 sm:p-8"
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
              }}
            >
              <ArticleBody content={content.body} />
            </div>
            </AnimatedWrapper>

            {/* Prev / Next Navigation */}
            <AnimatedWrapper index={2}>
            {(prevArticle || nextArticle) && (
              <div
                className="mt-6 rounded-2xl p-4 flex gap-4"
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                }}
              >
                {prevArticle ? (
                  <Link
                    href={`/${prevArticle.category}/${prevArticle.slug}`}
                    className="flex-1 group p-3 rounded-xl transition-colors"
                    style={{ background: "var(--card-hover)" }}
                  >
                    <div className="text-xs mb-1" style={{ color: "var(--text-3)" }}>
                      上一篇
                    </div>
                    <div
                      className="text-sm font-medium truncate transition-colors"
                      style={{ color: "var(--text-2)" }}
                    >
                      {prevArticle.title}
                    </div>
                  </Link>
                ) : (
                  <div className="flex-1" />
                )}

                {nextArticle ? (
                  <Link
                    href={`/${nextArticle.category}/${nextArticle.slug}`}
                    className="flex-1 group p-3 rounded-xl text-right transition-colors"
                    style={{ background: "var(--card-hover)" }}
                  >
                    <div className="text-xs mb-1" style={{ color: "var(--text-3)" }}>
                      下一篇
                    </div>
                    <div
                      className="text-sm font-medium truncate transition-colors"
                      style={{ color: "var(--text-2)" }}
                    >
                      {nextArticle.title}
                    </div>
                  </Link>
                ) : (
                  <div className="flex-1" />
                )}
              </div>
            )}
            </AnimatedWrapper>
          </main>
        </div>
      </div>
    </div>
  );
}
