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

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{
    chunkId: string;
    docId: string;
    docName?: string;
    pageStart: number;
    pageEnd: number;
    score: number;
  }>;
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
  const [indexingDocId, setIndexingDocId] = useState<string | null>(null);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ docId: string; filename: string } | null>(null);

  // 聊天相关状态
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

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

  const handleStartIndex = async (docId: string) => {
    if (indexingDocId === docId) return;
    setIndexingDocId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}/index`, {
        method: 'POST',
      });
      if (res.ok) {
        fetchDocuments();
        // 如果当前选中的是正在索引的文档，自动刷新内容
        if (selectedDocId === docId) {
          fetchDocumentContent(docId);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '索引启动失败');
      }
    } catch (error) {
      console.error('Index error:', error);
      alert('网络异常，索引启动失败');
    } finally {
      setIndexingDocId(null);
    }
  };

  const handleDelete = async (docId: string) => {
    if (deletingDocId === docId) return;
    setDeletingDocId(docId);
    try {
      const res = await fetch(`/api/documents/${docId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        // 如果删除的是当前选中的文档，清除选中状态
        if (selectedDocId === docId) {
          setSelectedDocId(null);
          setParsedContent(null);
        }
        fetchDocuments();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || '删除失败');
      }
    } catch (error) {
      console.error('Delete error:', error);
      alert('网络异常，删除失败');
    } finally {
      setDeletingDocId(null);
      setDeleteConfirm(null);
    }
  };

  const confirmDelete = (docId: string, filename: string) => {
    setDeleteConfirm({ docId, filename });
  };

  // 发送聊天消息
  const handleSendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading) return;

    setChatLoading(true);
    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kbId,
          messages: [...chatMessages, userMessage],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setChatMessages((prev) => [...prev, {
          role: 'assistant',
          content: data.answer,
          sources: data.sources || [],
        }]);
      } else {
        const data = await res.json().catch(() => ({}));
        setChatMessages((prev) => [...prev, {
          role: 'assistant',
          content: `错误: ${data.error || '未知错误'}`,
        }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages((prev) => [...prev, {
        role: 'assistant',
        content: '网络异常，请稍后重试',
      }]);
    } finally {
      setChatLoading(false);
    }
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
                      <div 
                        className="relative group"
                        onMouseEnter={() => setIsUploadSubMenuOpen(true)}
                        onMouseLeave={() => setIsUploadSubMenuOpen(false)}
                      >
                        <div className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-600 hover:text-white flex items-center justify-between cursor-default">
                          <span>上传文件</span>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                          
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
                documents.map((doc) => {
                  // 索引状态配置
                  const indexStatus = {
                    ready: {
                      label: '已索引',
                      bgColor: 'bg-green-100',
                      textColor: 'text-green-700',
                      icon: (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ),
                    },
                    processing: {
                      label: '索引中',
                      bgColor: 'bg-blue-100',
                      textColor: 'text-blue-700',
                      icon: (
                        <div className="w-3 h-3 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      ),
                    },
                    uploaded: {
                      label: '待索引',
                      bgColor: 'bg-amber-100',
                      textColor: 'text-amber-700',
                      icon: (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                      ),
                    },
                    failed: {
                      label: '失败',
                      bgColor: 'bg-red-100',
                      textColor: 'text-red-700',
                      icon: (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      ),
                    },
                    error: {
                      label: '错误',
                      bgColor: 'bg-red-100',
                      textColor: 'text-red-700',
                      icon: (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      ),
                    },
                  };

                  const status = indexStatus[doc.status as keyof typeof indexStatus] || indexStatus.uploaded;

                  return (
                    <div key={doc.id} className="relative group/item overflow-hidden">
                      <button
                        onClick={() => setSelectedDocId(doc.id)}
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-all duration-200 ${
                          selectedDocId === doc.id 
                          ? 'bg-blue-50/50 border-l-2 border-blue-600 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.05)]' 
                          : 'hover:bg-gray-100 bg-transparent border-l-2 border-transparent'
                        }`}
                      >
                        <div className={`transition-colors duration-200 ${selectedDocId === doc.id ? 'text-blue-600' : 'text-gray-400 group-hover/item:text-gray-500'}`}>
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" /></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate transition-colors duration-200 ${selectedDocId === doc.id ? 'text-blue-700' : 'text-gray-700'}`}>{doc.filename}</div>
                          <div className="text-[10px] text-gray-400 font-medium">
                            {new Date(doc.createdAt).toLocaleDateString()}
                          </div>
                        </div>

                        {/* 状态标识：在默认状态下显示，在 Hover 且非选中状态下为删除按钮腾出空间 */}
                        <div className={`flex items-center gap-1.5 ${status.bgColor} ${status.textColor} px-2 py-0.5 rounded-full text-[10px] font-bold transition-all duration-200 group-hover/item:opacity-0 group-hover/item:translate-x-4`}>
                          {status.icon}
                          <span>{status.label}</span>
                        </div>
                      </button>

                      {/* 浮动操作按钮区：仅在 Hover 时平滑滑入 */}
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 translate-x-4 group-hover/item:opacity-100 group-hover/item:translate-x-0 transition-all duration-300 pointer-events-none group-hover/item:pointer-events-auto">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(doc.id, doc.filename);
                          }}
                          disabled={deletingDocId === doc.id}
                          className="p-1.5 bg-white shadow-sm border border-red-100 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
                          title="删除文档"
                        >
                          {deletingDocId === doc.id ? (
                            <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 右栏：内容内容区域 */}
          <div className="flex-1 flex flex-col bg-white h-full relative min-w-0">
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
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
                      onClick={() => selectedDoc && handleStartIndex(selectedDoc.id)}
                      disabled={indexingDocId === selectedDoc.id || selectedDoc.status === 'processing'}
                      className={`text-[10px] font-bold px-3 py-1.5 transition-colors flex items-center gap-1.5 ${
                        indexingDocId === selectedDoc.id || selectedDoc.status === 'processing'
                        ? 'bg-gray-400 cursor-not-allowed text-white' 
                        : 'bg-gray-900 text-white hover:bg-black'
                      }`}
                    >
                      {(indexingDocId === selectedDoc.id || selectedDoc.status === 'processing') ? (
                        <>
                          <div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>处理中...</span>
                        </>
                      ) : (
                        <span>开始索引</span>
                      )}
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
                {/* 文档内容区域 */}
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
        </div>
      </main>

      {/* 浮动聊天对话框 */}
      {isChatOpen && (
        <div
          className="fixed bg-white/80 backdrop-blur-xl rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-white/20 w-[400px] h-[600px] max-h-[80vh] flex flex-col z-50 animate-in fade-in slide-in-from-bottom-8 zoom-in-95 duration-300 ease-out"
          style={{
            bottom: '100px',
            right: '32px',
          }}
        >
          {/* 对话框头部 */}
          <div className="px-6 py-4 flex items-center justify-between border-b border-gray-100/50">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <h3 className="text-sm font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">AI 知识助手</h3>
            </div>
            <button
              onClick={() => setIsChatOpen(false)}
              className="p-1.5 hover:bg-gray-100 rounded-full transition-all text-gray-400 hover:text-gray-600 active:scale-90"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
            {chatMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-3 opacity-50">
                <div className="p-4 bg-gray-50 rounded-2xl">
                  <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-500">有什么我可以帮您的？</p>
                <p className="text-xs text-gray-400">基于当前知识库提供精准解答</p>
              </div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                  <div className={`group max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-tr-none'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
                  }`}>
                    <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className={`mt-3 pt-3 border-t flex flex-col gap-2 ${
                        msg.role === 'user' ? 'border-white/10' : 'border-gray-50'
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <svg className={`w-3 h-3 ${msg.role === 'user' ? 'text-white/60' : 'text-blue-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${msg.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>引用来源</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.sources.map((s, sIdx) => (
                            <div key={sIdx} className="group/src relative">
                              <span className={`inline-flex items-center text-[10px] px-2 py-0.5 rounded-md font-medium border transition-colors cursor-help ${
                                msg.role === 'user'
                                  ? 'bg-white/10 border-white/10 text-white/90 hover:bg-white/20'
                                  : 'bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100'
                              }`}>
                                {s.docName || 'PDF'} · P{s.pageStart}
                              </span>
                              <div className="absolute bottom-full left-0 mb-2 hidden group-hover/src:block bg-gray-900/95 backdrop-blur text-white text-[10px] p-2 rounded-lg shadow-xl z-[60] whitespace-nowrap animate-in fade-in zoom-in-95 duration-200">
                                <div className="font-bold border-b border-white/10 pb-1 mb-1">{s.docName || '未知文档'}</div>
                                <div className="text-white/80">第 {s.pageStart}-{s.pageEnd} 页</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex justify-start animate-in fade-in duration-300">
                <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-none px-4 py-4 shadow-sm">
                  <div className="flex space-x-1.5">
                    <div className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-bounce"></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 输入框 */}
          <div className="p-4 bg-white/50 border-t border-gray-100 rounded-b-2xl">
            <div className="relative flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-1.5 transition-all focus-within:ring-2 focus-within:ring-blue-500/10 focus-within:border-blue-500/50">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
                placeholder="在此输入您的问题..."
                className="flex-1 bg-transparent px-3 py-1.5 text-[13px] text-gray-800 placeholder-gray-400 focus:outline-none"
                disabled={chatLoading}
              />
              <button
                onClick={handleSendChat}
                disabled={chatLoading || !chatInput.trim()}
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all disabled:opacity-30 disabled:grayscale active:scale-95 shadow-md shadow-blue-500/20"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 圆形Indicator按钮 */}
      <button
        onClick={() => setIsChatOpen(!isChatOpen)}
        className={`fixed bottom-8 right-8 w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-full shadow-[0_8px_25px_rgba(37,99,235,0.4)] flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-90 z-50 group ${
          isChatOpen ? 'rotate-90' : ''
        }`}
      >
        {isChatOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <div className="relative">
            <svg className="w-6 h-6 transition-transform group-hover:-rotate-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-400 border-2 border-blue-600 rounded-full"></span>
          </div>
        )}
      </button>

      {/* 删除确认对话框 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 animate-in zoom-in-95">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">确认删除</h3>
            </div>
            <p className="text-gray-600 mb-6">
              确定要删除文档 <span className="font-bold text-gray-900">"{deleteConfirm.filename}"</span> 吗？
              <br />
              <span className="text-sm text-red-500">此操作将同时删除文件和所有关联的索引数据，且无法恢复。</span>
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm.docId)}
                disabled={deletingDocId === deleteConfirm.docId}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {deletingDocId === deleteConfirm.docId ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>删除中...</span>
                  </>
                ) : (
                  <span>确认删除</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
