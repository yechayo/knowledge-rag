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

interface ParsedContent {
  document: {
    id: string;
    filename: string;
    status: string;
  };
  parseResult: {
    totalPages: number;
    fullText: string;
    pages: Array<{
      pageNumber: number;
      text: string;
    }>;
  };
  chunks: Array<{
    id: number;
    content: string;
    pageStart: number;
    pageEnd: number;
    length: number;
  }>;
  stats: {
    totalCharacters: number;
    totalChunks: number;
    avgChunkSize: number;
  };
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
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [parsedContent, setParsedContent] = useState<ParsedContent | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUploadSubMenuOpen, setIsUploadSubMenuOpen] = useState(false);

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

  // 获取文档解析内容
  const fetchDocumentContent = useCallback(async (docId: string) => {
    setLoadingContent(true);
    setParsedContent(null);
    setContentError(null);
    try {
      const res = await fetch(`/api/documents/${docId}/content`);
      if (res.ok) {
        const data = await res.json();
        setParsedContent(data);
      } else {
        let errorMessage = `请求失败（${res.status}）`;
        try {
          const errorData = await res.json();
          if (typeof errorData?.details === 'string' && errorData.details.trim()) {
            errorMessage = errorData.details;
          } else if (typeof errorData?.error === 'string' && errorData.error.trim()) {
            errorMessage = errorData.error;
          }
        } catch {
          // ignore json parse error
        }
        setContentError(errorMessage);
        console.error('Failed to fetch document content:', errorMessage);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '网络异常，请稍后重试';
      setContentError(message);
      console.error('Failed to fetch document content:', error);
    } finally {
      setLoadingContent(false);
    }
  }, []);

  // 当选择的文档变化时，获取内容
  useEffect(() => {
    if (selectedDocId) {
      fetchDocumentContent(selectedDocId);
    } else {
      setParsedContent(null);
      setContentError(null);
    }
  }, [selectedDocId, fetchDocumentContent]);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
    } else if (authStatus === 'authenticated') {
      fetchDocuments();
    }
  }, [authStatus, fetchDocuments, router]);

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
        setSelectedDocId(null);
      } else {
        alert('上传失败');
      }
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleStartIndex = async () => {
    alert('索引功能开发中...');
  };

  if (authStatus === 'loading' || loading) {
    return <div className="min-h-screen bg-white flex items-center justify-center font-bold text-blue-600 animate-pulse">加载中...</div>;
  }

  const selectedDoc = documents.find((d) => d.id === selectedDocId) || null;

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      <TopBar />
      
      <main className="flex-1 flex pt-16 overflow-hidden">
        <div className="flex flex-1 w-full h-full overflow-hidden">
          {/* 左栏：列表目录 */}
          <div className="w-80 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col h-full">
            <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between relative">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-gray-800 text-sm tracking-tight">文档目录</h3>
                <div className="relative">
                  <button 
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="p-1 hover:bg-gray-100 rounded transition-colors text-gray-500"
                  >
                    <svg className={`w-4 h-4 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {isMenuOpen && (
                    <div className="absolute left-0 mt-2 w-48 bg-white rounded shadow-xl border border-gray-100 py-1 z-50">
                      <div className="relative">
                        <button 
                          onMouseEnter={() => setIsUploadSubMenuOpen(true)}
                          onMouseLeave={() => setIsUploadSubMenuOpen(false)}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-600 hover:text-white flex items-center justify-between"
                        >
                          <span>上传文件</span>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          
                          {isUploadSubMenuOpen && (
                            <div className="absolute left-full top-0 -mt-1 ml-0.5 w-40 bg-white rounded shadow-xl border border-gray-100 py-1">
                              <label className="block px-4 py-2 text-sm text-gray-700 hover:bg-blue-600 hover:text-white cursor-pointer">
                                <span>PDF 上传</span>
                                <input type="file" accept=".pdf" className="hidden" onChange={(e) => { handleUpload(e); setIsMenuOpen(false); }} />
                              </label>
                              <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-600 hover:text-white">
                                Word 上传 (预留)
                              </button>
                              <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-600 hover:text-white">
                                TXT 上传 (预留)
                              </button>
                            </div>
                          )}
                        </button>
                      </div>
                      <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-600 hover:text-white">
                        新建文件夹 (预留)
                      </button>
                      <button className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-600 hover:text-white">
                        批量重命名 (预留)
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-bold">{documents.length}</span>
            </div>
            
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {documents.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm font-medium">暂无文档</div>
              ) : (
                documents.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-100 transition-colors ${
                      selectedDocId === doc.id ? 'bg-white border-l-2 border-blue-600 shadow-sm' : ''
                    }`}
                  >
                    <div className={`${selectedDocId === doc.id ? 'text-blue-600' : 'text-red-400'}`}>
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" /></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${selectedDocId === doc.id ? 'text-blue-600' : 'text-gray-700'}`}>{doc.filename}</div>
                      <div className="text-[10px] text-gray-400 font-mono">
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 右栏：内容内容区域 */}
          <div className="flex-1 flex flex-col bg-white h-full relative">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-4">
                  <button onClick={() => router.push('/')} className="p-1.5 hover:bg-gray-100 rounded text-gray-400 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                  <h3 className="text-lg font-bold text-gray-900 truncate">
                    {selectedDoc ? selectedDoc.filename : kbName || '未选择文档'}
                  </h3>
                </div>
                {selectedDoc && (
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      selectedDoc.status === 'ready' ? 'bg-green-100 text-green-700' :
                      selectedDoc.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>
                      {selectedDoc.status}
                    </span>
                    <button 
                      onClick={handleStartIndex}
                      className="text-[10px] font-bold px-3 py-1.5 bg-gray-900 text-white hover:bg-black transition-colors"
                    >
                      重新索引
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {selectedDoc ? (
                  <div className="max-w-4xl mx-auto">
                    {/* 文档统计信息 */}
                    <div className="flex items-center gap-4 mb-6 pb-4 border-b border-gray-100 text-xs text-gray-500">
                      <span className="font-mono">ID: {selectedDoc.id.slice(0, 8)}...</span>
                      <span>|</span>
                      <span>创建: {new Date(selectedDoc.createdAt).toLocaleString()}</span>
                      {parsedContent && (
                        <>
                          <span>|</span>
                          <span className="text-blue-600 font-medium">
                            {parsedContent.stats.totalCharacters.toLocaleString()} 字符
                          </span>
                          <span>|</span>
                          <span className="text-green-600 font-medium">
                            {parsedContent.parseResult.totalPages} 页
                          </span>
                          <span>|</span>
                          <span className="text-purple-600 font-medium">
                            {parsedContent.stats.totalChunks} chunks
                          </span>
                        </>
                      )}
                    </div>

                    {/* 加载状态 */}
                    {loadingContent && (
                      <div className="flex items-center justify-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent"></div>
                        <span className="ml-3 text-gray-500 font-medium">正在解析 PDF...</span>
                      </div>
                    )}

                    {/* 解析内容展示 */}
                    {parsedContent && !loadingContent && (
                      <div className="space-y-6">
                        {/* 按页展示内容 */}
                        {parsedContent.parseResult.pages.map((page) => (
                          <div key={page.pageNumber} className="border border-gray-100 rounded-lg overflow-hidden">
                            <div className="bg-gray-50 px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                              <span className="text-xs font-bold text-gray-600">第 {page.pageNumber} 页</span>
                              <span className="text-[10px] text-gray-400">{page.text.length} 字符</span>
                            </div>
                            <div className="p-4 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-serif">
                              {page.text || <span className="text-gray-400 italic">（此页无文本内容）</span>}
                            </div>
                          </div>
                        ))}

                        {/* Chunks 预览 */}
                        {parsedContent.chunks.length > 0 && (
                          <div className="mt-8 pt-6 border-t border-gray-200">
                            <h4 className="text-sm font-bold text-gray-800 mb-4">
                              Chunks 预览（共 {parsedContent.chunks.length} 个分块）
                            </h4>
                            <div className="space-y-3">
                              {parsedContent.chunks.slice(0, 5).map((chunk) => (
                                <div key={chunk.id} className="bg-gray-50 rounded p-3 border border-gray-100">
                                  <div className="flex items-center justify-between mb-2 text-[10px]">
                                    <span className="font-bold text-gray-500">Chunk #{chunk.id}</span>
                                    <span className="text-gray-400">页码: {chunk.pageStart} | {chunk.length} 字符</span>
                                  </div>
                                  <p className="text-xs text-gray-600 line-clamp-3">
                                    {chunk.content}
                                  </p>
                                </div>
                              ))}
                              {parsedContent.chunks.length > 5 && (
                                <p className="text-xs text-gray-400 text-center py-2">
                                  ... 还有 {parsedContent.chunks.length - 5} 个 chunks
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 解析失败 */}
                    {!loadingContent && !parsedContent && (
                      <div className="p-12 border-2 border-dashed border-gray-100 text-center rounded-sm">
                        <p className="font-medium text-gray-400">无法解析此文档</p>
                        <p className="text-[10px] mt-1 text-gray-400 break-all">
                          {contentError || '请确保文件是有效的 PDF 格式'}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-gray-300">
                    <svg className="w-16 h-16 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <p className="font-medium">请从左侧选择一个文档进行阅读</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
