'use client';

interface MarkdownToolbarProps {
  onInsert: (before: string, after: string, placeholder: string) => void;
}

export default function MarkdownToolbar({ onInsert }: MarkdownToolbarProps) {
  const toolbarButtons = [
    { icon: 'H1', title: '一级标题', before: '# ', after: '', placeholder: '标题文本' },
    { icon: 'H2', title: '二级标题', before: '## ', after: '', placeholder: '标题文本' },
    { icon: 'H3', title: '三级标题', before: '### ', after: '', placeholder: '标题文本' },
    { divider: true },
    { icon: 'B', title: '加粗', before: '**', after: '**', placeholder: '加粗文本' },
    { icon: 'I', title: '斜体', before: '*', after: '*', placeholder: '斜体文本' },
    { icon: 'S', title: '删除线', before: '~~', after: '~~', placeholder: '删除线文本' },
    { divider: true },
    { icon: 'ul', title: '无序列表', before: '\n- ', after: '', placeholder: '列表项' },
    { icon: 'ol', title: '有序列表', before: '\n1. ', after: '', placeholder: '列表项' },
    { divider: true },
    { icon: 'code', title: '行内代码', before: '`', after: '`', placeholder: '代码' },
    { icon: 'pre', title: '代码块', before: '\n```\n', after: '\n```\n', placeholder: '代码块' },
    { icon: 'quote', title: '引用', before: '\n> ', after: '', placeholder: '引用内容' },
    { divider: true },
    { icon: 'link', title: '链接', before: '[', after: '](url)', placeholder: '链接文本' },
    { icon: 'hr', title: '分隔线', before: '\n---\n', after: '', placeholder: '' },
  ];

  return (
    <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-1 flex-wrap">
      {toolbarButtons.map((btn, idx) =>
        btn.divider ? (
          <div key={`divider-${idx}`} className="w-px h-6 bg-gray-300 mx-1" />
        ) : (
          <button
            key={idx}
            onClick={() => onInsert(btn.before!, btn.after!, btn.placeholder!)}
            className="p-2 hover:bg-gray-200 rounded transition-colors text-sm"
            title={btn.title}
          >
            {btn.icon}
          </button>
        )
      )}
    </div>
  );
}
