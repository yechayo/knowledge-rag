"use client";

import { useState } from "react";
import { useCategories, type CategoryItem } from "@/hooks/useCategories";

export default function CategoryManager() {
  const { categories, categoryLabels } = useCategories();
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (updated: CategoryItem[]) => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "siteCategories", value: JSON.stringify(updated) }),
      });
      if (!res.ok) throw new Error();
      setMsg("已保存");
      window.location.reload();
    } catch {
      setMsg("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    const key = newKey.trim().toLowerCase();
    const label = newLabel.trim();
    if (!key || !label) return;
    if (categories.some((c) => c.key === key)) {
      setMsg("key 已存在");
      return;
    }
    save([...categories, { key, label }]);
    setNewKey("");
    setNewLabel("");
  };

  const handleRemove = (key: string) => {
    const label = categoryLabels[key] || key;
    if (!window.confirm(`确定删除分类「${label}」？该分类下的文章不会被删除，重新添加后即可恢复。`)) return;
    save(categories.filter((c) => c.key !== key));
  };

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--card)", border: "1px solid var(--border)" }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {categories.map((c) => (
          <div
            key={c.key}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
            style={{ background: "var(--card-hover)", border: "1px solid var(--border)" }}
          >
            <span style={{ color: "var(--text-1)" }}>{c.label}</span>
            <span className="text-xs" style={{ color: "var(--text-3)" }}>{c.key}</span>
            <button
              onClick={() => handleRemove(c.key)}
              className="ml-1 p-0.5 rounded hover:bg-red-500/20 transition-colors"
              style={{ color: "var(--text-3)" }}
              title="删除"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="key (英文)"
          className="px-3 py-1.5 rounded-lg text-sm outline-none w-28"
          style={{ background: "var(--card-hover)", border: "1px solid var(--border)", color: "var(--text-1)" }}
        />
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="显示名称"
          className="px-3 py-1.5 rounded-lg text-sm outline-none w-28"
          style={{ background: "var(--card-hover)", border: "1px solid var(--border)", color: "var(--text-1)" }}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <button
          onClick={handleAdd}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ background: "var(--accent)" }}
        >
          添加
        </button>
        {msg && (
          <span className="text-xs" style={{ color: msg === "已保存" ? "var(--accent)" : "#ef4444" }}>
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
