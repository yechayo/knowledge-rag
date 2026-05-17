import { CustomChatModel } from "@/lib/langchain/llm";

export interface DeepSeekOptions {
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
}

export function getDeepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("缺少环境变量 DEEPSEEK_API_KEY");
  }

  return {
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    modelName: process.env.RAG_MODEL_NAME || "deepseek-v4-flash",
    classifierModelName: process.env.RAG_CLASSIFIER_MODEL_NAME || process.env.RAG_MODEL_NAME || "deepseek-v4-flash",
  };
}

export function createDeepSeekChatModel(options: DeepSeekOptions = {}) {
  const config = getDeepSeekConfig();
  return new CustomChatModel({
    modelName: options.modelName || config.modelName,
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    temperature: options.temperature ?? 0.3,
    maxTokens: options.maxTokens ?? 4096,
  });
}

export async function completeDeepSeekJSON<T>(
  prompt: string,
  options: DeepSeekOptions & { signal?: AbortSignal } = {}
): Promise<T> {
  const config = getDeepSeekConfig();
  const res = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: options.modelName || config.classifierModelName,
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature ?? 0,
      max_tokens: options.maxTokens ?? 200,
      stream: false,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content || "";
  const cleaned = content.replace(/```json\n?|```\n?/g, "").trim();
  return JSON.parse(cleaned) as T;
}
