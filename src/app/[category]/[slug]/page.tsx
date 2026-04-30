"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { ChangeEvent } from "react";
import TopNav from "@/components/layout/TopNav";
import Sidebar from "@/components/detail/Sidebar";
import ArticleBody from "@/components/detail/ArticleBody";
import InlineEditor from "@/components/editor/InlineEditor";
import { useAdmin } from "@/hooks/useAdmin";
import { useCategories } from "@/hooks/useCategories";
import { signOut } from "next-auth/react";
import { generateHeadingAnchor } from "@/lib/heading-anchor";

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

type ContentListItem = Pick<ContentData, "slug" | "title" | "category" | "status" | "createdAt">;

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function estimateReadingTime(body: string): number {
  const chineseChars = (body.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = body.replace(/[\u4e00-\u9fff]/g, "").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(chineseChars / 300 + englishWords / 200));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：,.!?;:\-_'"`~()[\]{}<>]/g, "")
    .replace(/\.{2,}|…/g, "");
}

function findHeadingByHash(hash: string): HTMLElement | null {
  if (typeof window === "undefined") return null;

  const id = decodeURIComponent(hash.replace(/^#/, "")).trim();
  if (!id) return null;

  const byId = document.getElementById(id);
  if (byId) return byId;

  const normalizedHash = generateHeadingAnchor(id);
  const headings = Array.from(document.querySelectorAll(".markdown-content h2, .markdown-content h3"));
  for (const node of headings) {
    const el = node as HTMLElement;
    const normalizedId = generateHeadingAnchor(el.id || "");
    const normalizedText = generateHeadingAnchor(el.textContent || "");
    if (normalizedId === normalizedHash || normalizedText === normalizedHash) {
      return el;
    }
  }

  return null;
}

function findElementByRefText(refText: string): HTMLElement | null {
  if (typeof window === "undefined") return null;

  const normalizedRef = normalizeText(refText);
  if (!normalizedRef) return null;

  const candidates = Array.from(
    document.querySelectorAll(
      ".markdown-content h2, .markdown-content h3, .markdown-content p, .markdown-content li, .markdown-content blockquote, .markdown-content pre"
    )
  ) as HTMLElement[];

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    const text = normalizeText(el.textContent || "");
    if (!text) continue;
    const idx = text.indexOf(normalizedRef);
    if (idx >= 0 && idx < bestScore) {
      best = el;
      bestScore = idx;
      if (idx === 0) break;
    }
  }

  return best;
}

export default function DetailPage() {
  const { category, slug } = useParams<{ category: string; slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAdmin } = useAdmin();
  const [content, setContent] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [prevArticle, setPrevArticle] = useState<AdjacentArticle | null>(null);
  const [nextArticle, setNextArticle] = useState<AdjacentArticle | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [showTopBtn, setShowTopBtn] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const { categories: allCategories, categoryLabels } = useCategories();

  const jumpJobRef = useRef<number | null>(null);

  const tryJumpToReference = useCallback(() => {
    const hash = window.location.hash;
    const refText = searchParams.get("ref") || "";

    let attempts = 0;
    const maxAttempts = 12;

    const run = () => {
      const byHash = hash ? findHeadingByHash(hash) : null;
      if (byHash) {
        byHash.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const byRef = refText ? findElementByRefText(refText) : null;
      if (byRef) {
        byRef.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        jumpJobRef.current = window.setTimeout(run, 180);
      }
    };

    run();
  }, [searchParams]);

  // 获取文章内容
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
        fetchAdjacentArticles(data.category, data.createdAt);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }

    fetchContent();
  }, [slug]);

  useEffect(() => {
    if (!content) return;
    tryJumpToReference();

    return () => {
      if (jumpJobRef.current !== null) {
        clearTimeout(jumpJobRef.current);
      }
    };
  }, [content, tryJumpToReference]);

  // ?edit=true 自动进入编辑模式
  useEffect(() => {
    if (content && searchParams.get("edit") === "true" && !isEditing) {
      setEditBody(content.body);
      setEditCategory(content.category);
      setIsEditing(true);
      // 清除 URL 中的 edit 参数
      router.replace(`/${category}/${slug}`, { scroll: false });
    }
  }, [content, searchParams]);

  useEffect(() => {
    function onScroll() {
      setShowTopBtn(window.scrollY > 400);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function fetchAdjacentArticles(currentCategory: string, currentCreatedAt: string) {
    try {
      const res = await fetch(`/api/content?category=${currentCategory}&limit=100`);
      if (!res.ok) return;
      const data = await res.json();
      const items = ((data.items || []) as ContentListItem[])
        .filter((item) => item.status === "published")
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      const currentIndex = items.findIndex((item) => item.createdAt === currentCreatedAt);
      if (currentIndex > 0) setPrevArticle(items[currentIndex - 1]);
      if (currentIndex < items.length - 1) setNextArticle(items[currentIndex + 1]);
    } catch {
      // ignore
    }
  }

  const enterEditMode = useCallback(() => {
    if (content) {
      setEditTitle(content.title);
      setEditBody(content.body);
      setEditCategory(content.category);
      setIsEditing(true);
    }
  }, [content]);

  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setSaveMsg(null);
  }, []);

  const handleEditorChange = useCallback((newBody: string) => {
    setEditBody(newBody);
  }, []);

  const saveContent = async (reindexAfterSave: boolean): Promise<boolean> => {
    if (!content) return false;
    setSaving(true);
    setSaveMsg(null);
    try {
      const titleChanged = editTitle !== content.title;
      const bodyChanged = editBody !== content.body;
      const categoryChanged = editCategory !== content.category;

      const res = await fetch(`/api/content/${content.id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, body: editBody, category: editCategory }),
      });
      if (!res.ok) throw new Error("保存失败");
      const updatedContent = await res.json();

      const shouldReindex =
        reindexAfterSave &&
        (categoryChanged || (content.status === "published" && (titleChanged || bodyChanged)));

      if (shouldReindex) {
        const publishRes = await fetch(`/api/content/${content.id}/publish`, { method: "POST" });
        if (!publishRes.ok) throw new Error("重新索引失败");
        const publishData = await publishRes.json();
        setContent(publishData.content ?? { ...updatedContent, status: "published" });
        setSaveMsg("已保存并重新索引");
        if (categoryChanged) {
          router.replace(`/${editCategory}/${slug}`, { scroll: false });
        }
      } else {
        setContent(updatedContent);
        setSaveMsg("已保存");
      }
      return true;
    } catch {
      setSaveMsg("保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await saveContent(true);
  };

  const handlePublish = async () => {
    if (!content) return;
    setPublishing(true);
    try {
      const saved = await saveContent(false);
      if (!saved) return;
      const res = await fetch(`/api/content/${content.id}/publish`, { method: "POST" });
      if (!res.ok) throw new Error("发布失败");
      const publishData = await res.json();
      setSaveMsg("已发布并索引");
      setIsEditing(false);
      setContent(publishData.content ?? { ...content, title: editTitle, body: editBody, category: editCategory, status: "published" });
      // 分类变更后跳转到新 URL
      if (editCategory !== content.category) {
        router.replace(`/${editCategory}/${slug}`, { scroll: false });
      }
    } catch {
      setSaveMsg("发布失败");
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!content) return;
    if (!window.confirm(`确定要删除「${content.title}」吗？此操作不可撤销。`)) return;
    try {
      const res = await fetch(`/api/content/${content.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      router.push(`/${content.category}`);
    } catch {
      setSaveMsg("删除失败");
    }
  };

  const handleCoverUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !content) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("上传失败");
      const { url } = await res.json();
      const updatedMetadata = { ...(content.metadata as Record<string, unknown>), coverImage: url };
      const updateRes = await fetch(`/api/content/${content.id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: updatedMetadata }),
      });
      if (!updateRes.ok) throw new Error("更新失败");
      setContent({ ...content, metadata: updatedMetadata });
      setSaveMsg("封面已更新");
    } catch {
      setSaveMsg("封面上传失败");
    }
    // 重置 input 以允许重复选择同一文件
    e.target.value = "";
  };

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
          <Link href="/" className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ background: "var(--accent)" }}>返回首页</Link>
        </div>
      </div>
    );
  }

  const tags = content.metadata?.tags || [];
  const readingTime = estimateReadingTime(content.body);
  const categoryLabel = categoryLabels[content.category] || content.category;
  const coverImage = typeof content.metadata?.coverImage === "string" && content.metadata.coverImage.trim()
    ? content.metadata.coverImage
    : `https://picsum.photos/seed/${content.id}/1200/400`;

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
            <div className="rounded-2xl overflow-hidden mb-6" style={{ border: "1px solid var(--border)" }}>
              {/* Cover Image */}
              <div className="relative h-[200px] sm:h-[260px] group">
                <Image
                  src={coverImage}
                  alt={content.title}
                  fill
                  className="object-cover"
                  sizes="(max-width: 1024px) 100vw, 66vw"
                  priority
                />
                <input
                  id="cover-upload"
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleCoverUpload}
                />
                {/* 文本区域（父，最顶层 z-30） > 渐变遮罩（子） */}
                <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-8 z-30">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent -m-6 sm:-m-8 pointer-events-none" />
                  <div className="relative z-10">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      {isEditing ? (
                        <select
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="px-2.5 py-0.5 rounded-full text-xs font-medium outline-none cursor-pointer"
                          style={{ background: "rgba(255,255,255,0.2)", color: "#fff", backdropFilter: "blur(4px)", border: "none", appearance: "auto" }}
                        >
                          {allCategories.map((c) => (
                            <option key={c.key} value={c.key} style={{ color: "#000", background: "#fff" }}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(255,255,255,0.2)", color: "#fff", backdropFilter: "blur(4px)" }}>
                          {categoryLabel}
                        </span>
                      )}
                      {tags.map((tag: string) => (
                        <span key={tag} className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(255,255,255,0.15)", color: "#fff", backdropFilter: "blur(4px)" }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    {isEditing ? (
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="text-2xl sm:text-3xl font-bold mb-2 leading-tight bg-white/20 text-white rounded-lg px-3 py-1 outline-none placeholder-white/50 focus:bg-white/30"
                        placeholder="输入标题..."
                      />
                    ) : (
                      <h1 className="text-2xl sm:text-3xl font-bold mb-2 leading-tight text-white">
                        {content.title}
                      </h1>
                    )}
                    <div className="flex flex-wrap items-center gap-4 text-sm text-white/80">
                      <span>{formatDate(content.createdAt)}</span>
                      <span>{readingTime} 分钟阅读</span>
                      <span>{content.viewCount} 次浏览</span>
                    </div>
                  </div>
                </div>
                {/* 编辑模式：更换封面 */}
                {isEditing && (
                  <label htmlFor="cover-upload" className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-20">
                    <span className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-black/60 backdrop-blur-sm">更换封面</span>
                  </label>
                )}
              </div>
            </div>

            {/* Article Body or Editor */}
            <div
              className="rounded-2xl p-6 sm:p-8"
              style={{
                background: "var(--card)",
                border: isEditing ? "2px solid var(--accent)" : "1px solid var(--border)",
              }}
            >
              {isEditing ? (
                <InlineEditor content={editBody} onChange={handleEditorChange} editable />
              ) : (
                <ArticleBody content={content.body} />
              )}
            </div>

            {/* Prev / Next Navigation */}
            {!isEditing && (prevArticle || nextArticle) && (
              <div className="mt-6 rounded-2xl p-4 flex gap-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                {prevArticle ? (
                  <Link href={`/${prevArticle.category}/${prevArticle.slug}`} className="flex-1 group p-3 rounded-xl transition-colors" style={{ background: "var(--card-hover)" }}>
                    <div className="text-xs mb-1" style={{ color: "var(--text-3)" }}>上一篇</div>
                    <div className="text-sm font-medium truncate" style={{ color: "var(--text-2)" }}>{prevArticle.title}</div>
                  </Link>
                ) : <div className="flex-1" />}
                {nextArticle ? (
                  <Link href={`/${nextArticle.category}/${nextArticle.slug}`} className="flex-1 group p-3 rounded-xl text-right transition-colors" style={{ background: "var(--card-hover)" }}>
                    <div className="text-xs mb-1" style={{ color: "var(--text-3)" }}>下一篇</div>
                    <div className="text-sm font-medium truncate" style={{ color: "var(--text-2)" }}>{nextArticle.title}</div>
                  </Link>
                ) : <div className="flex-1" />}
              </div>
            )}
          </main>
          {/* 底部留白，避免被 admin 浮动栏遮挡 */}
          {isAdmin && <div className="h-16" />}
        </div>
      </div>

      {/* Back to top */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed bottom-[4.5rem] right-6 z-40 w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-300"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          opacity: showTopBtn ? 1 : 0,
          pointerEvents: showTopBtn ? "auto" : "none",
          transform: showTopBtn ? "translateY(0)" : "translateY(16px)",
        }}
        aria-label="回到顶部"
      >
        <svg className="w-5 h-5" style={{ color: "var(--text-2)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Admin floating edit bar */}
      {isAdmin && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur-sm" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3 text-sm" style={{ color: "var(--text-2)" }}>
              {isEditing ? (
                <>
                  <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
                  <span>编辑模式</span>
                </>
              ) : (
                <span>管理员模式</span>
              )}
              {saveMsg && (
                <span className={saveMsg.includes("失败") ? "text-red-500" : "text-green-600"}>{saveMsg}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => signOut({ callbackUrl: `/${category}/${slug}` })}
                className="px-3 py-2 rounded-lg text-sm transition-colors"
                style={{ color: "var(--text-3)" }}
                title="退出登录"
              >
                退出
              </button>
              {!isEditing ? (
                <>
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                    style={{ background: "#ef4444" }}
                  >
                    删除
                  </button>
                  <button
                    onClick={enterEditMode}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors"
                    style={{ background: "var(--accent)" }}
                  >
                    编辑
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={exitEditMode}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    style={{ color: "var(--text-2)" }}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
                    style={{ background: "#3b82f6" }}
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
                    style={{ background: "#22c55e" }}
                  >
                    {publishing ? "发布中..." : "发布"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
