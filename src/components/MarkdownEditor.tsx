'use client';

import { useState, useRef, useEffect } from 'react';

interface MarkdownEditorProps {
  kbId: string;
  onSave: (document: any) => void;
  onCancel: () => void;
}

export default function MarkdownEditor({ kbId, onSave, onCancel }: MarkdownEditorProps) {
  const [filename, setFilename] = useState('未命名文档.md');
  const [content, setContent] = useState('# 新建文档\n\n开始编写你的内容...\n');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 工具栏操作：在光标位置插入 Markdown 语法
  const insertMarkdown = (before: string, after: string = '', placeholder: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end) || placeholder;

    const newContent =
      content.substring(0, start) + before + selectedText + after + content.substring(end);

    setContent(newContent);

    // 恢复焦点和光标位置
    setTimeout(() => {
      textarea.focus();
      const newPosition = start + before.length + selectedText.length;
      textarea.setSelectionRange(newPosition, newPosition);
    }, 0);
  };

  const handleSave = async () => {
    if (!filename.trim()) {
      alert('请输入文件名');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/documents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: filename.endsWith('.md') ? filename : `${filename}.md`,
          content,
          kbId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        onSave(data.document);
      } else {
        const data = await res.json();
        alert(data.error || '保存失败');
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const toolbarButtons = [
    { icon: 'H1', title: '一级标题', action: () => insertMarkdown('# ', '', '标题文本') },
    { icon: 'H2', title: '二级标题', action: () => insertMarkdown('## ', '', '标题文本') },
    { icon: 'H3', title: '三级标题', action: () => insertMarkdown('### ', '', '标题文本') },
    { divider: true },
    { icon: 'B', title: '加粗', action: () => insertMarkdown('**', '**', '加粗文本') },
    { icon: 'I', title: '斜体', action: () => insertMarkdown('*', '*', '斜体文本') },
    { icon: 'S', title: '删除线', action: () => insertMarkdown('~~', '~~', '删除线文本') },
    { divider: true },
    { icon: 'ul', title: '无序列表', action: () => insertMarkdown('\n- ', '', '列表项') },
    { icon: 'ol', title: '有序列表', action: () => insertMarkdown('\n1. ', '', '列表项') },
    { icon: 'todo', title: '任务列表', action: () => insertMarkdown('\n- [ ] ', '', '任务项') },
    { divider: true },
    { icon: 'code', title: '行内代码', action: () => insertMarkdown('`', '`', '代码') },
    { icon: 'pre', title: '代码块', action: () => insertMarkdown('\n```\n', '\n```\n', '代码块') },
    { icon: 'quote', title: '引用', action: () => insertMarkdown('\n> ', '', '引用内容') },
    { divider: true },
    { icon: 'link', title: '链接', action: () => insertMarkdown('[', '](url)', '链接文本') },
    { icon: 'img', title: '图片', action: () => insertMarkdown('![alt](', ')', '图片地址') },
    { icon: 'hr', title: '分隔线', action: () => insertMarkdown('\n---\n', '', '') },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <h3 className="text-lg font-bold text-gray-900">新建 Markdown 文档</h3>
          <button
            onClick={onCancel}
            className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors text-gray-500"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 文件名输入 */}
        <div className="px-6 py-3 border-b border-gray-100">
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="文件名.md"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>

        {/* 工具栏 */}
        <div className="px-6 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-1 flex-wrap">
          {toolbarButtons.map((btn, idx) =>
            btn.divider ? (
              <div key={`divider-${idx}`} className="w-px h-6 bg-gray-300 mx-1" />
            ) : (
              <button
                key={idx}
                onClick={btn.action}
                className={`p-2 hover:bg-gray-200 rounded transition-colors ${
                  btn.icon === 'B' ? 'font-bold' :
                  btn.icon === 'I' ? 'italic' :
                  btn.icon === 'S' ? 'line-through' : ''
                }`}
                title={btn.title}
              >
                {btn.icon === 'ul' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
                {btn.icon === 'ol' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 6h13M7 12h13M7 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                )}
                {btn.icon === 'todo' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                {btn.icon === 'code' && (
                  <code className="text-xs font-mono">&lt;/&gt;</code>
                )}
                {btn.icon === 'pre' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                )}
                {btn.icon === 'quote' && (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z" />
                  </svg>
                )}
                {btn.icon === 'link' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                )}
                {btn.icon === 'img' && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                {btn.icon === 'hr' && (
                  <div className="w-6 border-t-2 border-gray-400" />
                )}
                {typeof btn.icon === 'string' && ['H1', 'H2', 'H3', 'B', 'I', 'S'].includes(btn.icon) && (
                  <span className="text-sm font-medium">{btn.icon}</span>
                )}
              </button>
            )
          )}
        </div>

        {/* 编辑区域 */}
        <div className="flex-1 overflow-hidden">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-full p-6 resize-none focus:outline-none font-mono text-sm leading-relaxed"
            placeholder="开始编写你的 Markdown 内容..."
            spellCheck={false}
          />
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
          <div className="text-xs text-gray-500">
            支持 Markdown 语法 | {content.length} 字符
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>保存文档</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
