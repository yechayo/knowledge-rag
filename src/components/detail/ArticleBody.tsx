"use client";

import { useMemo, useEffect, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { generateHeadingAnchor } from "@/lib/heading-anchor";

interface ArticleBodyProps {
  content: string;
}

export default function ArticleBody({ content }: ArticleBodyProps) {
  const ref = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const renderer = new marked.Renderer();
    renderer.heading = ({ text, depth }) => {
      if (depth >= 2 && depth <= 3) {
        const id = generateHeadingAnchor(text);
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

  // 兜底：补上缺失的 id
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const headings = el.querySelectorAll("h2, h3");
    headings.forEach((h) => {
      if (h.id) return;
      const text = h.textContent || "";
      const id = generateHeadingAnchor(text);
      if (id) h.id = id;
    });
  }, [html]);

  return (
    <div
      ref={ref}
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
