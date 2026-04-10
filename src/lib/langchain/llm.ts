import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage, ToolMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { retryWithBackoff } from "@/lib/agent/guard/retryWithBackoff";

export interface AgentModelConfig {
  modelName?: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentModelOptions {
  temperature?: number;
  maxTokens?: number;
}

interface OpenAIToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export class CustomChatModel extends BaseChatModel {
  modelName: string;
  apiKey: string;
  baseURL: string;
  temperature: number;
  maxTokens: number;
  private boundTools: OpenAIToolDef[] = [];

  constructor(config: { modelName: string; apiKey: string; baseURL: string; temperature?: number; maxTokens?: number }) {
    super({});
    this.modelName = config.modelName;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4000;
  }

  _llmType(): string { return "custom"; }

  bindTools(tools: any[]): this {
    this.boundTools = tools.map((t: any) => {
      const schema = t.schema;
      let parameters: Record<string, unknown> = { type: "object", properties: {}, required: [] };
      if (schema?.shape) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [key, field] of Object.entries(schema.shape)) {
          const f = field as any;
          properties[key] = { type: "string", description: f._def?.description || "" };
          if (f._def?.typeName !== "ZodOptional") required.push(key);
        }
        parameters = { type: "object", properties, required };
      }
      return { type: "function" as const, function: { name: t.name, description: t.description || "", parameters } };
    });
    return this;
  }

  private extractMessages(prompts: BaseMessage[]): any[] {
    const result: any[] = [];
    for (const msg of prompts) {
      if (msg instanceof HumanMessage) {
        result.push({ role: "user", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      } else if (msg instanceof AIMessage) {
        const entry: any = { role: "assistant", content: typeof msg.content === "string" ? msg.content : "" };
        const tc = (msg as any).tool_calls || msg.additional_kwargs?.tool_calls;
        if (tc?.length > 0) entry.tool_calls = tc;
        result.push(entry);
      } else if (msg instanceof SystemMessage) {
        result.push({ role: "system", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      } else if (msg instanceof ToolMessage) {
        result.push({ role: "tool", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content), tool_call_id: (msg as any).tool_call_id });
      } else {
        const m = msg as any;
        result.push({ role: m.lc_serialized?.metadata?.role || m.role || "user", content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      }
    }
    return result;
  }

  /**
   * 将 OpenAI 格式消息转换为 Anthropic 格式
   * - tool_calls → content 数组中的 tool_use 块
   * ToolMessage(role:tool) → user 消息中的 tool_result 块
   * 系统消息被过滤（在调用方处理）
   */
  private toAnthropicMessages(messages: any[]): any[] {
    const result: any[] = [];
    for (const m of messages) {
      if (m.role === "assistant" && m.tool_calls?.length > 0) {
        const content: any[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.tool_calls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args || tc.function?.arguments ? (typeof tc.args === "string" ? JSON.parse(tc.args) : tc.args) : {} });
        }
        result.push({ role: "assistant", content });
      } else if (m.role === "tool") {
        result.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content || "" }],
        });
      } else {
        result.push(m);
      }
    }
    return result;
  }

  async _generate(prompts: BaseMessage[], options?: any, callbacks?: any): Promise<any> {
    const messages = this.extractMessages(prompts);
    const signal = options?.signal;
    if (this.isAnthropicFormat()) {
      return this.anthropicGenerate(this.toAnthropicMessages(messages), signal);
    }
    return this.openaiGenerate(messages, signal);
  }

  private async openaiGenerate(messages: any[], signal?: AbortSignal): Promise<any> {
    const body: any = { model: this.modelName, messages, temperature: this.temperature, max_tokens: this.maxTokens };
    if (this.boundTools.length > 0) body.tools = this.boundTools;

    const res = await retryWithBackoff(() => fetch(`${this.baseURL}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
      body: JSON.stringify(body), signal,
    }), { maxRetries: 3, signal });

    if (!res.ok) throw new Error(`API 错误 ${res.status}: ${await res.text()}`);

    const data = await res.json() as any;
    const msg = data.choices?.[0]?.message;
    const text = msg?.content || "";
    const rawToolCalls = msg?.tool_calls;

    const aiMsg = new AIMessage({ content: text || "", additional_kwargs: rawToolCalls ? { tool_calls: rawToolCalls } : {} }) as any;
    if (rawToolCalls?.length > 0) {
      aiMsg.tool_calls = rawToolCalls.map((tc: any) => {
        let args: Record<string, unknown> = {};
        if (tc.function?.arguments) {
          try { args = JSON.parse(tc.function.arguments); } catch {
            // JSON 截断修复（同 streaming 逻辑）
            const trimmed = tc.function.arguments.trimEnd();
            const fixed = trimmed.endsWith("}") ? trimmed : trimmed + "}";
            try { args = JSON.parse(fixed); } catch { /* 放弃，保持 {} */ }
          }
        }
        return { id: tc.id || `call_${Date.now()}`, name: tc.function?.name, args };
      });
    }
    return { generations: [{ text, message: aiMsg }], llmOutput: {} };
  }

  private async anthropicGenerate(messages: any[], signal?: AbortSignal): Promise<any> {
    const body: any = { model: this.modelName, messages: messages.filter((m: any) => m.role !== "system"), max_tokens: this.maxTokens, temperature: this.temperature };
    const sys = messages.find((m: any) => m.role === "system");
    if (sys) body.system = sys.content;
    if (this.boundTools.length > 0) body.tools = this.boundTools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));

    const res = await retryWithBackoff(() => fetch(`${this.baseURL}/v1/messages`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify(body), signal,
    }), { maxRetries: 3, signal });

    if (!res.ok) throw new Error(`Anthropic API 错误 ${res.status}: ${await res.text()}`);

    const data = await res.json() as any;
    const content = data.content || [];
    const textBlock = content.find((c: any) => c.type === "text");
    const thinkingBlock = content.find((c: any) => c.type === "thinking");
    const toolUseBlocks = content.filter((c: any) => c.type === "tool_use");
    const text = textBlock?.text || "";
    const thinking = thinkingBlock?.thinking || "";

    const aiMsg = new AIMessage({ content: text, additional_kwargs: thinking ? { thinking } : {} }) as any;
    aiMsg.thinking = thinking;
    if (toolUseBlocks.length > 0) {
      aiMsg.tool_calls = toolUseBlocks.map((tu: any) => ({ id: tu.id, name: tu.name, args: tu.input || {} }));
    }
    return { generations: [{ text, message: aiMsg }], llmOutput: {} };
  }

  async *_streamResponseChunks(messages: BaseMessage[], options?: any, runManager?: any): AsyncGenerator<ChatGenerationChunk> {
    const extracted = this.extractMessages(messages);
    const signal = options?.signal;
    if (this.isAnthropicFormat()) { yield* this.anthropicStream(extracted, signal); } else { yield* this.openaiStream(extracted, signal); }
  }

  private async *openaiStream(messages: any[], signal?: AbortSignal): AsyncGenerator<ChatGenerationChunk> {
    const body: any = { model: this.modelName, messages, temperature: this.temperature, max_tokens: this.maxTokens, stream: true };
    if (this.boundTools.length > 0) body.tools = this.boundTools;

    const res = await retryWithBackoff(() => fetch(`${this.baseURL}/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.apiKey}` },
      body: JSON.stringify(body), signal,
    }), { maxRetries: 3, signal });

    if (!res.ok) throw new Error(`API 错误 ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const acc: Map<number, { id: string; name: string; argsStr: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes("\n")) {
        const le = buffer.indexOf("\n");
        const line = buffer.slice(0, le).trim();
        buffer = buffer.slice(le + 1);
        if (!line?.startsWith("data:")) continue;
        const ds = line.slice(5).trim();
        if (ds === "[DONE]") return;
        try {
          const chunk = JSON.parse(ds);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (delta.content) yield new ChatGenerationChunk({ text: delta.content, message: new AIMessageChunk({ content: delta.content }) });
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!acc.has(idx)) acc.set(idx, { id: tc.id || "", name: "", argsStr: "" });
              const a = acc.get(idx)!;
              if (tc.id) a.id = tc.id;
              if (tc.function?.name) a.name = tc.function.name;
              if (tc.function?.arguments) a.argsStr += tc.function.arguments;
            }
            // 某些模型（如 MiniMax）即使有 tool_calls 也使用 finish_reason: "stop"
            // 当 maxTokens 不足时使用 "length"，此时也必须 yield 累积的 tool_calls
            // 否则 tool call 会被静默丢弃，导致工具不执行
            const finishReason = chunk.choices?.[0]?.finish_reason;
            if (finishReason === "tool_calls" || finishReason === "stop" || finishReason === "length") {
              const hasToolCalls = acc.size > 0;
              if (hasToolCalls) {
                const toolCalls = Array.from(acc.values()).map((a) => {
                  let args: Record<string, unknown> = {};
                  try { args = JSON.parse(a.argsStr || "{}"); } catch {
                    // JSON 被截断（如 maxTokens 不足），尝试修复末尾
                    const trimmed = (a.argsStr || "").trimEnd();
                    const fixed = trimmed.endsWith("}") ? trimmed : trimmed + "}";
                    try { args = JSON.parse(fixed); } catch {
                      // 修复失败，尝试花括号匹配截取
                      let depth = 0, end = -1;
                      for (let i = 0; i < trimmed.length; i++) {
                        if (trimmed[i] === '{') depth++;
                        else if (trimmed[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
                      }
                      if (end > 0) try { args = JSON.parse(trimmed.substring(0, end + 1)); } catch { /* 放弃 */ }
                    }
                  }
                  return { id: a.id || `call_${Date.now()}`, name: a.name, args };
                });
                const aiMsg = new AIMessageChunk({ content: "", additional_kwargs: { tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) } }) as any;
                aiMsg.tool_calls = toolCalls;
                yield new ChatGenerationChunk({ text: "", message: aiMsg });
                acc.clear();
              }
            }
          }
        } catch {}
      }
    }
  }

  private async *anthropicStream(messages: any[], signal?: AbortSignal): AsyncGenerator<ChatGenerationChunk> {
    const anthropicMsgs = this.toAnthropicMessages(messages);
    const body: any = { model: this.modelName, messages: anthropicMsgs.filter((m: any) => m.role !== "system"), max_tokens: this.maxTokens, temperature: this.temperature, stream: true };
    const sys = messages.find((m: any) => m.role === "system");
    if (sys) body.system = sys.content;
    if (this.boundTools.length > 0) body.tools = this.boundTools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));

    const res = await retryWithBackoff(() => fetch(`${this.baseURL}/v1/messages`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify(body), signal,
    }), { maxRetries: 3, signal });

    if (!res.ok) throw new Error(`Anthropic API 错误 ${res.status}: ${await res.text()}`);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let curToolId = "", curToolName = "", curToolArgs = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes("\n")) {
        const le = buffer.indexOf("\n");
        const line = buffer.slice(0, le).trim();
        buffer = buffer.slice(le + 1);
        if (!line?.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5));
          if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            curToolId = event.content_block.id || ""; curToolName = event.content_block.name || ""; curToolArgs = "";
          } else if (event.type === "content_block_delta") {
            const d = event.delta;
            if (d?.type === "thinking_delta") yield new ChatGenerationChunk({ text: "", message: new AIMessageChunk({ content: "", additional_kwargs: { thinking: d.thinking } }) });
            else if (d?.type === "text_delta") yield new ChatGenerationChunk({ text: d.text, message: new AIMessageChunk({ content: d.text }) });
            else if (d?.type === "input_json_delta") curToolArgs += d.partial_json || "";
          } else if (event.type === "content_block_stop" && curToolName) {
            let args = {}; try { args = JSON.parse(curToolArgs || "{}"); } catch {}
            const aiMsg = new AIMessageChunk({ content: "" }) as any;
            aiMsg.tool_calls = [{ id: curToolId, name: curToolName, args }];
            aiMsg.additional_kwargs = { tool_calls: [{ id: curToolId, type: "tool_use", name: curToolName, input: args }] };
            yield new ChatGenerationChunk({ text: "", message: aiMsg });
            curToolName = "";
          }
        } catch {}
      }
    }
  }

  private isAnthropicFormat(): boolean {
    return this.baseURL.includes("/anthropic") || this.baseURL.includes("anthropic");
  }
}

export function createAgentModel(options?: AgentModelOptions, runtimeConfig?: AgentModelConfig): BaseChatModel {
  const modelName = runtimeConfig?.modelName ?? process.env.AGENT_MODEL_NAME;
  if (modelName) {
    const apiKey = runtimeConfig?.apiKey ?? process.env.AGENT_API_KEY;
    if (!apiKey) throw new Error("缺少 API Key（请在模型设置中配置）");
    const baseURL = runtimeConfig?.baseURL ?? process.env.AGENT_BASE_URL;
    if (!baseURL) throw new Error("缺少 API Base URL（请在模型设置中配置）");
    return new CustomChatModel({ modelName, apiKey, baseURL, temperature: options?.temperature ?? runtimeConfig?.temperature ?? parseFloat(process.env.AGENT_TEMPERATURE ?? "0.7"), maxTokens: options?.maxTokens ?? runtimeConfig?.maxTokens ?? parseInt(process.env.AGENT_MAX_TOKENS ?? "4000", 10) });
  }
  // 默认使用 MiniMax
  return createMiniMax({ temperature: options?.temperature ?? 0.7, maxTokens: options?.maxTokens ?? 4000 });
}

/**
 * 创建 MiniMax 模型（默认模型）
 */
export function createMiniMax(config?: { temperature?: number; maxTokens?: number }): BaseChatModel {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 MINIMAX_API_KEY");
  return new CustomChatModel({
    modelName: "MiniMax-M2.7-highspeed",
    apiKey,
    baseURL: "https://api.minimaxi.com/anthropic",
    temperature: config?.temperature ?? 0.7,
    maxTokens: config?.maxTokens ?? 4000,
  });
}

/**
 * 创建 GLM5 模型（备选）
 */
export function createGLM5(config?: { temperature?: number; maxTokens?: number }): BaseChatModel {
  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 BIGMODEL_API_KEY");
  return new ChatOpenAI({ model: "glm-4-flash", apiKey, configuration: { baseURL: "https://open.bigmodel.cn/api/paas/v4" }, temperature: config?.temperature ?? 0.7, maxTokens: config?.maxTokens ?? 2000 });
}
