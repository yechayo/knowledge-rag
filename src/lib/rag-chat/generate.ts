import type { SSESender } from "@/lib/agent/stream/sse";
import type { GroupedResult, SourceCitation } from "./types";
import { buildKnowledgeBaseContext } from "./retrieve";
import { getDeepSeekConfig } from "./deepseek";

interface StreamOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export async function streamDirectAnswer(
  query: string,
  send: SSESender,
  options: StreamOptions = {}
): Promise<string> {
  return streamDeepSeekMessages([
    {
      role: "system",
      content: "你是一个简洁、直接的中文助手。当前问题不需要查询站内知识库。不要输出引用标记。",
    },
    { role: "user", content: query },
  ], send, options);
}

export async function streamRetrievedAnswer(
  query: string,
  grouped: GroupedResult,
  sources: SourceCitation[],
  send: SSESender,
  options: StreamOptions = {}
): Promise<string> {
  if (sources.length === 0) {
    const text = "知识库中暂无相关内容。";
    send("delta", { content: text });
    return text;
  }

  const context = buildKnowledgeBaseContext(grouped);
  return streamDeepSeekMessages([
    {
      role: "system",
      content: `你是一个知识库问答助手，只能基于给定知识库内容回答。

【知识库内容】
${context}

【引用规则】
- 只要回答使用知识库内容，必须使用 [[REF:/category/slug#anchor|短标签]] 标记。
- 链接必须从知识库内容里的“链接:”复制，不要编造 URL、slug 或 anchor。
- 如果知识库内容不足，直接说明“知识库中暂无相关内容”。`,
    },
    { role: "user", content: query },
  ], send, options);
}

async function streamDeepSeekMessages(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  send: SSESender,
  options: StreamOptions
): Promise<string> {
  const config = getDeepSeekConfig();
  const res = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelName,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4000,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API error ${res.status}: ${await res.text()}`);
  }
  if (!res.body) {
    throw new Error("DeepSeek API returned empty stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes("\n")) {
      const lineEnd = buffer.indexOf("\n");
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (!line.startsWith("data:")) continue;

      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || "";
        if (delta) {
          fullText += delta;
          send("delta", { content: delta });
        }
      } catch {
        // Ignore malformed provider chunks; the connection may continue.
      }
    }
  }

  return fullText;
}
