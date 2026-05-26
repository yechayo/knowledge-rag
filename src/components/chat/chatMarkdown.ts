import type { ChatSource } from "./chatState";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

export function renderChatMarkdownToHtml(content: string): string {
  const rawHtml = marked.parse(replaceInlineRefs(content), {
    breaks: true,
    gfm: true,
  }) as string;

  return DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ["class", "data-ref-href", "data-ref-label"],
  });
}

export function buildChatJumpHref(
  href: string,
  label: string,
  sources?: ChatSource[]
): string {
  try {
    const url = new URL(href, "http://localhost");
    const candidateRef = resolveRefText(href, label, sources)
      .trim()
      .replace(/\.{2,}|…/g, "");

    if (candidateRef && !url.searchParams.has("ref")) {
      url.searchParams.set("ref", candidateRef.slice(0, 140));
    }

    return `${url.pathname}${url.search.replace(/\+/g, "%20")}${url.hash}`;
  } catch {
    return href;
  }
}

function replaceInlineRefs(content: string): string {
  return content.replace(/\[\[REF:([^|\]]+?)(?:\|([^\]]+))?\]\]/g, (_match, href: string, rawLabel?: string) => {
    const fallback = href.includes("#") ? href.split("#").pop() : href.split("/").pop();
    const label = (rawLabel || fallback || href).trim();
    const safeHref = escapeHtmlAttribute(href);
    const safeLabel = escapeHtml(label);

    return `<a href="${safeHref}" data-ref-href="${safeHref}" data-ref-label="${safeLabel}" class="chat-ref">${safeLabel}</a>`;
  });
}

function resolveRefText(href: string, label: string, sources?: ChatSource[]): string {
  if (!sources || sources.length === 0) {
    return label;
  }

  try {
    const url = new URL(href, "http://localhost");
    const pathname = normalizePathname(url.pathname);
    const hashAnchor = decodeURIComponent(url.hash.replace(/^#/, ""));

    const matched = sources.find((source) => {
      const sourcePath = normalizePathname(`/${source.category}/${source.slug}`);
      if (sourcePath !== pathname) return false;
      if (!hashAnchor) return true;
      return (source.headingAnchor || "").trim() === hashAnchor;
    });

    if (matched?.contentPreview) return matched.contentPreview;
    if (matched?.headingText) return matched.headingText;
    if (matched?.sectionPath) return matched.sectionPath;

    const loose = sources.find((source) => pathname.includes(`/${source.slug}`));
    if (loose?.contentPreview) return loose.contentPreview;
  } catch {
    return label;
  }

  return label;
}

function normalizePathname(pathname: string): string {
  return decodeURIComponent(pathname).replace(/\/+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}
