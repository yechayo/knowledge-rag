'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import TopBar from '@/components/layout/TopBar';
import CreateKBModal from '@/components/kb/CreateKBModal';

interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [kbList, setKbList] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
    } else if (status === 'authenticated') {
      fetchKBList();
    }
  }, [status, router]);

  const fetchKBList = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/kb');
      if (res.ok) {
        const data = await res.json();
        setKbList(data);
      }
    } catch (error) {
      console.error('Failed to fetch KB list:', error);
    } finally {
      setLoading(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50/50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent shadow-sm"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      <TopBar />
      
      <main className="max-w-7xl mx-auto px-6 pt-24 pb-12">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-10">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">知识库列表</h1>
            <p className="text-sm font-medium text-gray-500">管理您的文档集合并构建个性化问答</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:shadow-blue-500/20 text-white rounded-xl font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            创建知识库
          </button>
        </div>

        {kbList.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center shadow-sm max-w-2xl mx-auto">
            <div className="bg-blue-50 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
               <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
               </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">还没有知识库</h3>
            <p className="text-gray-500 mb-8 max-w-sm mx-auto font-medium">创建一个知识库，上传您的 PDF 文档，即可开始 RAG 问答。</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-8 py-3.5 bg-gray-900 hover:bg-black text-white rounded-xl font-bold transition-all hover:scale-105 active:scale-95"
            >
              立刻开始
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {kbList.map((kb) => (
              <div
                key={kb.id}
                onClick={() => router.push(`/kb/${kb.id}`)}
                className="group relative bg-white rounded-2xl border border-gray-100 p-6 cursor-pointer hover:border-blue-500 hover:shadow-xl hover:shadow-blue-500/5 transition-all flex flex-col h-[200px]"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="p-3 bg-blue-50/50 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 012-2v-5a2 2 0 01-2-2H9l-2-2H5a2 2 0 01-2 2v10a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-blue-400"></div>
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300 group-hover:bg-blue-400"></div>
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors truncate mb-1">{kb.name}</h3>
                <p className="text-sm font-medium text-gray-500 line-clamp-2 flex-grow mb-4 leading-relaxed">{kb.description || '暂无描述'}</p>
                
                <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-50 uppercase tracking-widest font-bold text-[10px] text-gray-400 group-hover:text-blue-400">
                  <span>更新于 {new Date(kb.updatedAt).toLocaleDateString()}</span>
                  <svg className="w-4 h-4 opacity-0 group-hover:opacity-100 transform translate-x-[-10px] group-hover:translate-x-0 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {isModalOpen && (
        <CreateKBModal
          onClose={() => setIsModalOpen(false)}
          onSuccess={fetchKBList}
        />
      )}
    </div>
  );
}
