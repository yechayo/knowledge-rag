/**
 * SSE (Server-Sent Events) 工具函数
 * 从 route.ts 提取，负责 SSE 响应构建和工具结果内容提取
 */

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

export type SSESender = (type: string, data: unknown) => void;

/**
 * 创建 SSE 事件发送器
 */
export function createSSESender(controller: ReadableStreamDefaultController): SSESender {
  const encoder = new TextEncoder();
  return (type: string, data: unknown) => {
    controller.enqueue(encoder.encode("data: " + JSON.stringify({ type, data }) + "\n\n"));
  };
}

/**
 * 从 LangGraph stream 的 ToolMessage.content 中提取实际的工具结果字符串
 * LangGraph 可能返回 LangChain 序列化格式 {"lc":1,...,"kwargs":{"content":"..."}}
 */
export function extractToolContent(content: unknown): string {
  if (typeof content === "object" && content !== null) {
    const obj = content as Record<string, unknown>;
    if (obj.kwargs && typeof obj.kwargs === "object") {
      const kwargs = obj.kwargs as Record<string, unknown>;
      if (kwargs.content != null) {
        return typeof kwargs.content === "string" ? kwargs.content : JSON.stringify(kwargs.content);
      }
    }
    return JSON.stringify(content);
  }
  if (typeof content !== "string") return String(content || "");

  // 非 LangChain 序列化格式，直接返回
  if (!content.startsWith('{"lc":') && !content.startsWith('{"type":"constructor"')) {
    return content;
  }

  // 尝试 JSON 解析
  try {
    const parsed = JSON.parse(content);
    if (parsed.kwargs?.content != null) {
      return typeof parsed.kwargs.content === "string" ? parsed.kwargs.content : JSON.stringify(parsed.kwargs.content);
    }
  } catch {
    // JSON.parse 失败（内容含未转义字符），尝试手动提取
  }

  // 手动提取："content":" 后面到匹配的未转义 " 之间的内容
  const marker = '"content":';
  const markerIdx = content.indexOf(marker);
  if (markerIdx === -1) return content;

  // 跳过冒号后的空白和开引号
  let quoteStart = markerIdx + marker.length;
  while (quoteStart < content.length && content[quoteStart] !== '"') quoteStart++;
  if (quoteStart >= content.length) return content;
  quoteStart++; // 跳过开引号

  // 从前往后找 closing quote
  let pos = quoteStart;
  while (pos < content.length) {
    const ch = content[pos];
    if (ch === '\\' && pos + 1 < content.length) {
      pos += 2; // 跳过转义序列
      continue;
    }
    if (ch === '"') {
      // 找到闭合引号
      const raw = content.substring(quoteStart, pos);
      return raw
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
        .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    pos++;
  }

  return content.substring(quoteStart);
}
