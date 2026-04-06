"use client";

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface ArticleBodyProps {
  content: string;
}

// 简单的 slugify：将文本转为 URL 安全的 id
// 先去除 HTML 标签（marked 渲染后的 text 可能包含 <code> 等标签）
function slugify(text: string): string {
  const plain = text.replace(/<[^>]*>/g, "");
  return plain
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-");
}

export default function ArticleBody({ content }: ArticleBodyProps) {
  const html = useMemo(() => {
    // 配置 marked renderer 给 h2/h3 自动生成 id
    const renderer = new marked.Renderer();
    renderer.heading = ({ text, depth }) => {
      if (depth >= 2 && depth <= 3) {
        const id = slugify(text);
        return `<h${depth} id="${id}">${text}</h${depth}>`;
      }
      return `<h${depth}>${text}</h${depth}>`;
    };

    const raw = marked(content || "", {
      breaks: true,
      gfm: true,
      renderer,
    }) as string;

    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ["table", "thead", "tbody", "tr", "th", "td"],
      ADD_ATTR: ["id"],
    });
  }, [content]);

  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
