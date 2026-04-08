"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/hooks/useAdmin";
import TaskPanel from "@/components/admin/TaskPanel";

export default function ChatPage() {
  const router = useRouter();
  const { isAdmin, isLoading } = useAdmin();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      router.push("/login");
    }
  }, [isLoading, isAdmin, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-[var(--text-2)]">加载中...</div>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen flex bg-[var(--bg)]">
      <div className="flex-1 flex flex-col max-w-4xl mx-auto p-4">
        <TaskPanel />
      </div>
    </div>
  );
}
