"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import { useAdmin } from "@/hooks/useAdmin";
import { useCategories } from "@/hooks/useCategories";
import CategoryManager from "@/components/admin/CategoryManager";

// 直接显示在导航栏的分类
const PRIMARY_CATEGORIES = ["article", "project", "note", "page"];

export default function TopNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [showCatManager, setShowCatManager] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const { isAdmin } = useAdmin();
  const { categories } = useCategories();

  const normalizePathPart = (value: string) => value.replace(/^\/+|\/+$/g, "").toLowerCase();

  const navItems = categories
    .map((c) => ({
      label: c.label,
      key: normalizePathPart(c.key),
      href: `/${normalizePathPart(c.key)}`,
      primary: PRIMARY_CATEGORIES.includes(c.key.toLowerCase()),
    }))
    .filter((item) => item.key.length > 0);

  const primaryItems = navItems.filter((i) => i.primary);
  const moreItems = navItems.filter((i) => !i.primary);

  const currentTopSegment = normalizePathPart(pathname.split("/")[1] || "");

  const isActive = (key: string) => {
    if (!key) return pathname === "/";
    return currentTopSegment === key;
  };

  // 点击外部关闭下拉
  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  // 路由变化时关闭移动端菜单
  useEffect(() => {
    setMobileOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  const linkClass = (key: string) =>
    `px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
      isActive(key)
        ? "text-[var(--text-1)] bg-[var(--accent-bg)]"
        : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--card-hover)]"
    }`;

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <nav
          className="flex items-center justify-between h-14 rounded-xl mt-3 px-4 sm:px-6"
          style={{
            background: "transparent",
            border: "none",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}
        >
          {/* Left: Logo */}
          <Link href="/" className="flex-shrink-0">
            <span className="text-lg font-bold text-[var(--text-1)]">
              yechayo
            </span>
          </Link>

          {/* Center: Primary Category Links (desktop) */}
          <div className="hidden md:flex items-center gap-1">
            {primaryItems.map((item) => (
              <Link key={item.href} href={item.href} className={linkClass(item.key)}>
                {item.label}
              </Link>
            ))}

            {/* "More" dropdown for extra categories */}
            {moreItems.length > 0 && (
              <div className="relative" ref={moreRef}>
                <button
                  onClick={() => setMoreOpen(!moreOpen)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1 ${
                    moreItems.some((i) => isActive(i.key))
                      ? "text-[var(--text-1)] bg-[var(--accent-bg)]"
                      : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--card-hover)]"
                  }`}
                >
                  更多
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {moreOpen && (
                  <div
                    className="absolute top-full left-0 mt-2 rounded-xl p-1.5 shadow-lg min-w-[120px]"
                    style={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    {moreItems.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`block px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                          isActive(item.key)
                            ? "text-[var(--text-1)] bg-[var(--accent-bg)]"
                            : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--card-hover)]"
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Search + Theme Toggle */}
          <div className="flex items-center gap-1">
            <button
              className="p-2 rounded-lg text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--card-hover)] transition-colors"
              aria-label="搜索"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            <ThemeToggle />

            {/* Mobile hamburger */}
            <button
              className="md:hidden p-2 rounded-lg text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--card-hover)] transition-colors ml-1"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="菜单"
            >
              {mobileOpen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </nav>

        {/* Mobile Navigation Menu */}
        {mobileOpen && (
          <div
            className="md:hidden mt-2 rounded-xl p-2 shadow-lg"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
            }}
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  isActive(item.key)
                    ? "text-[var(--text-1)] bg-[var(--accent-bg)]"
                    : "text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--card-hover)]"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}

        {/* Admin: Category Manager */}
        {isAdmin && (
          <div className="mt-2">
            <button
              onClick={() => setShowCatManager(!showCatManager)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{ color: "var(--text-3)", background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              分类管理
              <svg className={`w-3 h-3 transition-transform ${showCatManager ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showCatManager && (
              <div className="mt-2">
                <CategoryManager />
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
