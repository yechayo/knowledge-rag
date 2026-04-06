/**
 * 统一的标题锚点生成逻辑：索引和渲染必须共用，避免跳转锚点不一致。
 */
export function generateHeadingAnchor(raw: string): string {
  if (!raw) return "";

  // 先移除 HTML 标签
  let text = raw.replace(/<[^>]*>/g, " ");

  // 移除 Markdown 图片语法 ![alt](url)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // 将 Markdown 链接语法 [text](url) 还原为 text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // 移除常见 Markdown 行内标记符
  text = text
    .replace(/[`*_~]/g, "")
    .replace(/[\[\]{}()<>]/g, " ")
    .trim();

  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
