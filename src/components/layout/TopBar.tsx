'use client';

import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function TopBar() {
  const { data: session } = useSession();
  const router = useRouter();

  if (!session) return null;

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-100 px-6 flex items-center justify-between z-50">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
          KnowledgeRAG
        </Link>
        <nav className="flex gap-4">
          <Link href="/" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
            知识库
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex flex-col items-end">
          <span className="text-sm font-semibold text-gray-900">{session.user?.name || 'User'}</span>
          <span className="text-xs text-gray-500">{session.user?.email}</span>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
        >
          退出
        </button>
      </div>
    </header>
  );
}
