"use client";

import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface ArticleBodyProps {
  content: string;
}

export default function ArticleBody({ content }: ArticleBodyProps) {
  const html = useMemo(() => {
    const raw = marked(content || "", { breaks: true, gfm: true }) as string;
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ["table", "thead", "tbody", "tr", "th", "td"],
    });
  }, [content]);

  return (
    <div
      className="markdown-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
