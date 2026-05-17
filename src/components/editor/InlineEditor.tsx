"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { useEffect, useRef, useCallback } from "react";

interface InlineEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  editable?: boolean;
}

export default function InlineEditor({ content, onChange, editable = true }: InlineEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Track whether the editor content has been initialized
  const initializedRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        // Disable StarterKit's built-in Link since we don't need custom link config here
        link: {
          openOnClick: false,
          HTMLAttributes: { class: "text-[var(--accent)] underline" },
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Placeholder.configure({
        placeholder: "开始编辑... (支持 Markdown 语法：## 标题、**粗体**、- 列表)",
      }),
      Markdown,
    ],
    content: "",
    editable,
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown();
      onChange(md);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[300px] text-[var(--text-1)]",
      },
    },
  });

  // Parse initial markdown content once editor is ready
  useEffect(() => {
    if (!editor || !content) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manager = (editor.storage as any).markdown?.manager;
    if (!manager) return;
    try {
      const doc = manager.parse(content);
      editor.commands.setContent(doc, { emitUpdate: false });
    } catch {
      editor.commands.setContent(content, { emitUpdate: false });
    }
    initializedRef.current = true;
  // Only run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Sync external content changes (e.g. when switching articles)
  useEffect(() => {
    if (!editor) return;

    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    if (!editor.isFocused) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = (editor.storage as any).markdown?.manager;
      try {
        const doc = manager ? manager.parse(content) : content;
        editor.commands.setContent(doc, { emitUpdate: false });
      } catch {
        editor.commands.setContent(content, { emitUpdate: false });
      }
    }
  }, [content, editor]);

  // Intercept paste to parse plain-text markdown into rich content
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      const html = event.clipboardData?.getData("text/html");
      if (!text || html) return;
      const looksLikeMarkdown = /^#{1,6}\s|^\s*[-*+]\s|\*\*|__|\[.+\]\(.+\)|^>\s|^```/m.test(text);
      if (!looksLikeMarkdown) return;

      event.preventDefault();
      event.stopPropagation();

      // Use @tiptap/markdown's storage manager to parse the markdown text
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manager = (editor.storage as any).markdown?.manager;
      if (!manager) return;

      try {
        const doc = manager.parse(text);
        if (!doc) return;
        const { from, to } = editor.state.selection;
        editor.chain().deleteRange({ from, to }).insertContentAt(from, doc).run();
      } catch {
        // If parsing fails, let TipTap handle it normally
      }
    };

    dom.addEventListener("paste", onPaste, true);
    return () => dom.removeEventListener("paste", onPaste, true);
  }, [editor]);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editor) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error();
      const { url } = await res.json();
      editor.chain().setImage({ src: url }).run();
    } catch {
      // silent
    }
    e.target.value = "";
  }, [editor]);

  const insertLink = useCallback(() => {
    if (!editor) return;
    const url = prompt("输入链接地址:");
    if (url) editor.chain().setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="inline-editor">
      {/* Toolbar */}
      {editable && (
        <div className="sticky top-[52px] z-10 flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 mb-4 shadow-sm">
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleBold().run(); }}
            isActive={editor.isActive("bold")}
            title="粗体 (Ctrl+B)"
          >
            <b>B</b>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleItalic().run(); }}
            isActive={editor.isActive("italic")}
            title="斜体 (Ctrl+I)"
          >
            <i>I</i>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleStrike().run(); }}
            isActive={editor.isActive("strike")}
            title="删除线"
          >
            <s>S</s>
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleHeading({ level: 1 }).run(); }}
            isActive={editor.isActive("heading", { level: 1 })}
            title="标题 1"
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleHeading({ level: 2 }).run(); }}
            isActive={editor.isActive("heading", { level: 2 })}
            title="标题 2"
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleHeading({ level: 3 }).run(); }}
            isActive={editor.isActive("heading", { level: 3 })}
            title="标题 3"
          >
            H3
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleBulletList().run(); }}
            isActive={editor.isActive("bulletList")}
            title="无序列表"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleOrderedList().run(); }}
            isActive={editor.isActive("orderedList")}
            title="有序列表"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleBlockquote().run(); }}
            isActive={editor.isActive("blockquote")}
            title="引用"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 4h13l-1.5 9H10l-1.5 9H5l1.5-9H3" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleCodeBlock().run(); }}
            isActive={editor.isActive("codeBlock")}
            title="代码块"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().toggleCode().run(); }}
            isActive={editor.isActive("code")}
            title="行内代码"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); imageInputRef.current?.click(); }}
            title="插入图片"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </ToolbarButton>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="absolute opacity-0 w-0 h-0 overflow-hidden pointer-events-none"
            tabIndex={-1}
            onChange={handleImageUpload}
          />

          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); insertLink(); }}
            isActive={editor.isActive("link")}
            title="插入链接"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().setHorizontalRule().run(); }}
            title="分割线"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" /></svg>
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().undo().run(); }}
            title="撤销 (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); editor.chain().redo().run(); }}
            title="重做 (Ctrl+Y)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" /></svg>
          </ToolbarButton>
        </div>
      )}

      {/* Editor Content */}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  children,
  onMouseDown,
  isActive,
  title,
}: {
  children: React.ReactNode;
  onMouseDown: (e: React.MouseEvent) => void;
  isActive?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors ${
        isActive
          ? "bg-[var(--accent)] text-white"
          : "text-[var(--text-2)] hover:bg-[var(--card-hover)] hover:text-[var(--text-1)]"
      }`}
    >
      {children}
    </button>
  );
}
