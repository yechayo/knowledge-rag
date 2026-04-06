"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useMemo, useRef, useCallback } from "react";
import { marked } from "marked";

interface InlineEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  editable?: boolean;
}

// Markdown → HTML (for loading into TipTap)
function markdownToHtml(md: string): string {
  return marked(md || "", { breaks: true, gfm: true }) as string;
}

// HTML → Markdown (for saving back)
function htmlToBasicMarkdown(html: string): string {
  let md = html;
  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  // Bold & Italic (use $2 for content, not $1 which is the tag name)
  md = md.replace(/<(strong|b)>(.*?)<\/(?:strong|b)>/gi, "**$2**");
  md = md.replace(/<(em|i)>(.*?)<\/(?:em|i)>/gi, "*$2*");
  // Links
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  // Images
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");
  // Code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "```\n$1\n```\n\n");
  // Inline code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  // Blockquote
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "> $1\n\n");
  // Lists
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
  md = md.replace(/<\/?[ou]l[^>]*>/gi, "\n");
  // Paragraphs
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  // Line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");
  // Remaining tags
  md = md.replace(/<[^>]+>/g, "");
  // Decode HTML entities
  md = md.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // Clean up
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}

export default function InlineEditor({ content, onChange, editable = true }: InlineEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Convert markdown to HTML for TipTap
  const htmlContent = useMemo(() => markdownToHtml(content), [content]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-[var(--accent)] underline" },
      }),
      Placeholder.configure({
        placeholder: "开始编辑...",
      }),
    ],
    content: htmlContent,
    editable,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(htmlToBasicMarkdown(html));
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[300px] text-[var(--text-1)]",
      },
    },
  });

  // Sync external content changes
  useEffect(() => {
    if (editor && !editor.isFocused) {
      const currentText = editor.getText().trim();
      const newText = content.replace(/<[^>]+>/g, "").replace(/[#*_`>\[\]()!\-]/g, "").trim();
      if (currentText !== newText) {
        editor.commands.setContent(htmlContent);
      }
    }
  }, [content, htmlContent, editor]);

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
      editor.chain().focus().setImage({ src: url }).run();
    } catch {
      // 静默处理
    }
    e.target.value = "";
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="inline-editor">
      {/* Toolbar */}
      {editable && (
        <div className="sticky top-[52px] z-10 flex flex-wrap items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 mb-4 shadow-sm">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            title="粗体"
          >
            <b>B</b>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            title="斜体"
          >
            <i>I</i>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive("strike")}
            title="删除线"
          >
            <s>S</s>
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor.isActive("heading", { level: 2 })}
            title="标题 2"
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor.isActive("heading", { level: 3 })}
            title="标题 3"
          >
            H3
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
            title="无序列表"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
            title="有序列表"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive("blockquote")}
            title="引用"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 4h13l-1.5 9H10l-1.5 9H5l1.5-9H3" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive("codeBlock")}
            title="代码块"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>
          </ToolbarButton>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onClick={() => imageInputRef.current?.click()}
            title="插入图片"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </ToolbarButton>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageUpload}
          />

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <ToolbarButton
            onClick={() => {
              const url = prompt("输入链接地址:");
              if (url) editor.chain().focus().setLink({ href: url }).run();
            }}
            isActive={editor.isActive("link")}
            title="插入链接"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="分割线"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" /></svg>
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
  onClick,
  isActive,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  isActive?: boolean;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
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
