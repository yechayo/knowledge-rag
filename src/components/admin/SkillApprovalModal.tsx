"use client";

import { useState, useEffect } from "react";

interface MarketInfo {
  name: string;
  description: string | null;
  author: string | null;
  category: string | null;
}

interface InstallRequest {
  id: string;
  userId: string;
  skillName: string;
  version: string;
  reason: string | null;
  marketInfo: MarketInfo | null;
  createdAt: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export default function SkillApprovalModal({
  isOpen,
  onClose,
  onUpdate,
}: Props) {
  const [requests, setRequests] = useState<InstallRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchRequests();
    }
  }, [isOpen]);

  async function fetchRequests() {
    setLoading(true);
    try {
      const res = await fetch("/api/agent/skills/requests?status=pending");
      const data = await res.json();
      setRequests(data.requests || []);
    } catch (err) {
      console.error("Failed to fetch requests:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(requestId: string) {
    setProcessingId(requestId);
    try {
      const res = await fetch(`/api/agent/skills/requests/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      const data = await res.json();
      if (data.success) {
        setRequests((prev) => prev.filter((r) => r.id !== requestId));
        onUpdate?.();
      } else {
        alert(data.error || "操作失败");
      }
    } catch (err) {
      console.error("Failed to approve:", err);
      alert("操作失败");
    } finally {
      setProcessingId(null);
    }
  }

  async function handleReject(requestId: string) {
    setProcessingId(requestId);
    try {
      const res = await fetch(`/api/agent/skills/requests/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: false }),
      });
      const data = await res.json();
      if (data.success) {
        setRequests((prev) => prev.filter((r) => r.id !== requestId));
        onUpdate?.();
      } else {
        alert(data.error || "操作失败");
      }
    } catch (err) {
      console.error("Failed to reject:", err);
      alert("操作失败");
    } finally {
      setProcessingId(null);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[80vh] bg-[var(--card)] rounded-xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-semibold text-[var(--text-1)]">
            Skill 安装审批
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[var(--bg)] transition-colors"
          >
            <svg
              className="w-5 h-5 text-[var(--text-3)]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-3)]">
              暂无待审批的安装申请
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--text-1)]">
                          /{request.skillName}
                        </span>
                        <span className="text-xs text-[var(--text-3)]">
                          v{request.version}
                        </span>
                        {request.marketInfo?.category && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-bg)] text-[var(--accent)]">
                            {request.marketInfo.category}
                          </span>
                        )}
                      </div>

                      {request.marketInfo && (
                        <p className="text-sm text-[var(--text-3)] mt-1">
                          作者: {request.marketInfo.author || "未知"}
                        </p>
                      )}

                      {request.reason && (
                        <p className="text-sm text-[var(--text-2)] mt-2 p-2 rounded bg-[var(--card)]">
                          申请理由: {request.reason}
                        </p>
                      )}

                      <p className="text-xs text-[var(--text-3)] mt-2">
                        申请时间:{" "}
                        {new Date(request.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => handleApprove(request.id)}
                        disabled={processingId === request.id}
                        className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors disabled:opacity-50"
                      >
                        批准
                      </button>
                      <button
                        onClick={() => handleReject(request.id)}
                        disabled={processingId === request.id}
                        className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
