"use client";

import { useState } from "react";
import { useAdmin } from "@/hooks/useAdmin";

interface AdminEditBarProps {
  contentId: string;
  initialBody: string;
  category: string;
  onSave?: () => void;
  onPublish?: () => void;
  onCancel?: () => void;
}

export default function AdminEditBar({
  contentId,
  initialBody,
  category,
  onSave,
  onPublish,
  onCancel,
}: AdminEditBarProps) {
  const { isAdmin, isLoading } = useAdmin();
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  if (isLoading || !isAdmin) return null;

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/content/${contentId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: initialBody, category }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存失败");
      }
      setMessage({ type: "success", text: "已保存" });
      onSave?.();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    setPublishing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/content/${contentId}/publish`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "发布失败");
      }
      setMessage({ type: "success", text: "已发布并索引" });
      onPublish?.();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "发布失败" });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-lg">
      <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="text-sm text-gray-500">
          管理员编辑模式
          {message && (
            <span
              className={`ml-3 font-medium ${
                message.type === "success" ? "text-green-600" : "text-red-600"
              }`}
            >
              {message.text}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors"
          >
            {publishing ? "发布中..." : "发布"}
          </button>
        </div>
      </div>
    </div>
  );
}
