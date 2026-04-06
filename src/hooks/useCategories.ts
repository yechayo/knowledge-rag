"use client";

import { useEffect, useState } from "react";

export interface CategoryItem {
  key: string;
  label: string;
}

const FALLBACK: CategoryItem[] = [
  { key: "article", label: "文章" },
  { key: "project", label: "项目" },
  { key: "note", label: "笔记" },
  { key: "page", label: "页面" },
];

export function useCategories() {
  const [categories, setCategories] = useState<CategoryItem[]>(FALLBACK);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        if (config.siteCategories) {
          try {
            setCategories(JSON.parse(config.siteCategories));
          } catch { /* ignore */ }
        }
      })
      .catch(() => { /* use fallback */ });
  }, []);

  const categoryLabels: Record<string, string> = {};
  for (const c of categories) {
    categoryLabels[c.key] = c.label;
  }

  return { categories, categoryLabels };
}
