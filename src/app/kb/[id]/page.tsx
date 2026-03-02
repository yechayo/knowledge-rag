'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import TopBar from '@/components/layout/TopBar';

interface Document {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
}

export default function KBDetailPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const params = useParams();
  const kbId = params.id as string;

  const [kbName, setKbName] = useState('');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`/api/kb/${kbId}/documents`);
      if (res.ok) {
        const data = await res.json();
        setKbName(data.kbName);
        setDocuments(data.documents);
      } else if (res.status === 404) {
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoading(false);
    }
  }, [kbId, router]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    } else if (authStatus === 'authenticated') {
      fetchDocuments();
    }
  }, [authStatus, fetchDocuments, router]);

  // 轮询逻辑：如果存在状态为 'uploaded' 或 'processing' 的文档，每 2 秒刷新一次
  useEffect(() => {
    const hasProcessing = documents.some(doc => ['uploaded', 'processing'].includes(doc.status));
    if (hasProcessing) {
      const timer = setInterval(fetchDocuments, 2000);
      return () => clearInterval(timer);
    }
  }, [documents, fetchDocuments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('kbId', kbId);

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        fetchDocuments();
      } else {
        alert('上传失败');
      }
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
      e.target.value = ''; // Reset input
    }
  };

  const handleStartIndex = async () => {
    // 暂时留空，后续 Prompt 实现 API
    alert('索引功能开发中...');
  };

  if (authStatus === 'loading' || loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center font-bold text-blue-600 animate-pulse">加载中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopBar />
      
      <main className="max-w-7xl mx-auto px-6 pt-24 pb-12">
        <div className="mb-8 flex items-center gap-4">
          <button onClick={() => router.push('/')} className="p-2 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-gray-200">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{kbName || '知识库详情'}</h1>
            <p className="text-sm text-gray-500 font-medium">ID: {kbId}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* 左侧：文档列表 */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
               <div className="px-6 py-4 border-b border-gray-50 flex justify-between items-center">
                  <h3 className="font-bold text-gray-900">文档列表 ({documents.length})</h3>
                  <button 
                    onClick={handleStartIndex}
                    className="text-xs font-bold px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    全部重新索引
                  </button>
               </div>
               
               <div className="divide-y divide-gray-50">
                  {documents.length === 0 ? (
                    <div className="p-12 text-center text-gray-400 font-medium">暂无文档，请在右侧上传</div>
                  ) : (
                    documents.map(doc => (
                      <div key={doc.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                        <div className="flex items-center gap-4">
                           <div className="p-2 bg-red-50 text-red-500 rounded-lg">
                             <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" /></svg>
                           </div>
                           <div>
                             <div className="font-semibold text-gray-900 line-clamp-1">{doc.filename}</div>
                             <div className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                               {new Date(doc.createdAt).toLocaleString()}
                             </div>
                           </div>
                        </div>
                        <div className="flex items-center gap-3">
                           <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                             doc.status === 'ready' ? 'bg-green-100 text-green-700' :
                             doc.status === 'failed' ? 'bg-red-100 text-red-700' :
                             'bg-blue-100 text-blue-700 animate-pulse'
                           }`}>
                             {doc.status}
                           </span>
                        </div>
                      </div>
                    ))
                  )}
               </div>
            </div>
          </div>

          {/* 右侧：上传与操作 */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center hover:border-blue-400 transition-colors group">
               <input 
                 type="file" 
                 accept=".pdf" 
                 onChange={handleUpload} 
                 className="hidden" 
                 id="pdf-upload"
                 disabled={uploading}
               />
               <label htmlFor="pdf-upload" className="cursor-pointer block">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    {uploading ? (
                      <svg className="animate-spin h-8 w-8 text-blue-600" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    ) : (
                      <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    )}
                  </div>
                  <div className="font-bold text-gray-900 mb-1">{uploading ? '正在上传...' : '上传 PDF 文档'}</div>
                  <p className="text-xs text-gray-500 font-medium">支持最大 10MB 的 PDF 文件</p>
               </label>
            </div>

            <div className="bg-gradient-to-br from-gray-900 to-black rounded-2xl p-6 text-white">
              <h4 className="font-bold mb-2">注意事项</h4>
              <ul className="text-xs text-gray-400 space-y-2 list-disc list-inside font-medium leading-relaxed">
                <li>上传后的文档将自动进入待索引队列。</li>
                <li>索引过程包括文本提取、向量计算及存储。</li>
                <li>完成后状态将变为 <span className="text-green-400 font-bold">READY</span>。</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
