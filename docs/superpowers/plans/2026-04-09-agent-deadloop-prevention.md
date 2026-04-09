# Agent 防死循环纵深防御实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 agent 添加 7 层纵深防御机制，防止工具调用死循环，同时将自定义循环迁移到 LangGraph ReAct Agent。

**Architecture:** 两阶段实施。Phase 1 升级 `CustomChatModel` 支持标准 tool calling + 流式输出 + 重试；Phase 2 创建守卫模块（LoopGuard / ResourceLimit）并用 LangGraph `createReactAgent` 重构 route.ts 的主循环。

**Tech Stack:** @langchain/core ^1.1.39, @langchain/langgraph ^1.2.8, @langchain/openai ^1.4.3, zod ^4.3.6, Next.js 16

**Spec:** `docs/superpowers/specs/2026-04-09-agent-deadloop-prevention-design.md`

---

## File Structure

### 新建文件
| 文件 | 职责 |
|------|------|
| `src/lib/agent/guard/retryWithBackoff.ts` | 指数退避重试函数 |
| `src/lib/agent/guard/loopGuard.ts` | 循环守卫：重复检测 + 次数限制 |
| `src/lib/agent/guard/resourceLimit.ts` | 工具结果截断 |
| `src/lib/agent/guard/index.ts` | 统一导出 |

### 修改文件
| 文件 | 改动范围 | 阶段 |
|------|----------|------|
| `src/lib/langchain/llm.ts` | CustomChatModel 增加 tool calling + `_streamResponseChunks()` + bindTools + 重试 | Phase 1 |
| `src/app/api/agent/stream/route.ts` | 主循环替换为 LangGraph stream | Phase 2 |
| `src/components/admin/AgentChat.tsx` | 移除 `toolCompleted` 模式，适配连续事件流 | Phase 2 |

---

## Phase 1：升级 CustomChatModel

### Task 1: 创建 retryWithBackoff 工具函数

**Files:**
- Create: `src/lib/agent/guard/retryWithBackoff.ts`

- [ ] **Step 1: 创建 retryWithBackoff.ts**

```typescript
// src/lib/agent/guard/retryWithBackoff.ts

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  signal?: AbortSignal;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 32_000,
  jitterFactor: 0.25,
};

/**
 * 指数退避重试函数
 * - 5xx / 429 / 网络错误：重试
 * - 4xx（非 429）：不重试
 * - 每次重试前检查 signal.aborted
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    // 检查是否已中止
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      return await fn();
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // 不重试的情况：非网络错误 && 非 5xx && 非 429
      if (isNonRetryableError(err)) {
        throw lastError;
      }

      // 最后一次尝试不再等待
      if (attempt === opts.maxRetries) {
        throw lastError;
      }

      // 计算退避延迟
      const delay = calculateDelay(attempt, opts);
      await sleep(delay, opts.signal);
    }
  }

  throw lastError;
}

function isNonRetryableError(err: any): boolean {
  // 如果是 Response 对象（fetch 返回的错误状态）
  if (err?.status) {
    const status = err.status;
    // 4xx 但非 429 不重试
    return status >= 400 && status < 500 && status !== 429;
  }
  // TypeError（网络错误）可重试
  if (err instanceof TypeError) return false;
  // 其他错误不重试
  return true;
}

function calculateDelay(attempt: number, opts: RetryOptions): number {
  const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, opts.maxDelayMs);
  const jitter = cappedDelay * opts.jitterFactor * Math.random();
  return Math.floor(cappedDelay + jitter);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}
```

- [ ] **Step 2: 验证文件编译**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npx tsc --noEmit src/lib/agent/guard/retryWithBackoff.ts 2>&1 | head -20`
Expected: 无错误或仅有路径别名相关警告

---

### Task 2: 升级 CustomChatModel — 支持 tool calling

**Files:**
- Modify: `src/lib/langchain/llm.ts`

这是 Phase 1 的核心。需要让 `CustomChatModel` 能：
1. 通过 `bindTools()` 接受工具 schema
2. 在 `_generate()` 中将 `tools` 参数传给 API，解析 `tool_calls` 响应
3. 对于不支持 function calling 的模型，fallback 到 `[TOOL_CALL]` 文本解析

- [ ] **Step 1: 重写 `src/lib/langchain/llm.ts`**

完整替换文件内容为：

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { ChatGenerationChunk } from "@langchain/core/outputs";
import { Tool as LangChainTool } from "@langchain/core/tools";
import { retryWithBackoff } from "@/lib/agent/guard/retryWithBackoff";

/**
 * Agent 运行时模型配置（优先级高于环境变量）
 */
export interface AgentModelConfig {
  modelName?: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Agent 可切换模型选项
 */
export interface AgentModelOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * OpenAI 格式的 tool 定义
 */
interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * 自定义聊天模型（支持任意 OpenAI-compatible 或 Anthropic-compatible 格式）
 * 支持：标准 tool calling、流式输出、指数退避重试
 */
export class CustomChatModel extends BaseChatModel {
  modelName: string;
  apiKey: string;
  baseURL: string;
  temperature: number;
  maxTokens: number;
  /** 绑定的工具 schema（由 bindTools 设置） */
  private boundTools: OpenAIToolDef[] = [];

  constructor(config: {
    modelName: string;
    apiKey: string;
    baseURL: string;
    temperature?: number;
    maxTokens?: number;
  }) {
    super({});
    this.modelName = config.modelName;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 4000;
  }

  _llmType(): string {
    return "custom";
  }

  /**
   * 绑定工具 schema — LangGraph createReactAgent 会调用此方法
   */
  bindTools(tools: LangChainTool[]): this {
    this.boundTools = tools.map((t: any) => {
      const schema = t.schema;
      let parameters: Record<string, unknown> = { type: "object", properties: {}, required: [] };

      if (schema?.shape) {
        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        for (const [key, field] of Object.entries(schema.shape)) {
          const f = field as any;
          const desc = f._def?.description || "";
          const isOptional = f._def?.typeName === "ZodOptional";
          properties[key] = {
            type: "string",
            description: desc,
          };
          if (!isOptional) required.push(key);
        }
        parameters = { type: "object", properties, required };
      }

      return {
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description || "",
          parameters,
        },
      };
    });

    return this;
  }

  /**
   * 从 LangChain messages 提取 API 格式的 messages
   */
  private extractMessages(prompts: BaseMessage[]): Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> {
    const result: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string }> = [];

    for (const msg of prompts) {
      if (msg instanceof HumanMessage) {
        result.push({ role: "user", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      } else if (msg instanceof AIMessage) {
        const aiMsg: any = { role: "assistant", content: typeof msg.content === "string" ? msg.content : "" };
        // 如果有 tool_calls，附加
        const rawToolCalls = (msg as any).tool_calls || (msg.additional_kwargs?.tool_calls);
        if (rawToolCalls && rawToolCalls.length > 0) {
          aiMsg.tool_calls = rawToolCalls;
        }
        result.push(aiMsg);
      } else if (msg instanceof SystemMessage) {
        result.push({ role: "system", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
      } else if (msg instanceof ToolMessage) {
        result.push({ role: "tool", content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content), tool_call_id: (msg as any).tool_call_id });
      } else {
        // fallback：尝试从 lc_serialized 提取
        const m = msg as any;
        const role = m.lc_serialized?.metadata?.role || m.role || "user";
        result.push({ role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
      }
    }

    return result;
  }

  /**
   * 非流式调用
   */
  async _generate(prompts: BaseMessage[], options?: any, callbacks?: any): Promise<any> {
    const messages = this.extractMessages(prompts);
    const signal = options?.signal;

    if (this.isAnthropicFormat()) {
      return this.anthropicGenerate(messages, signal);
    } else {
      return this.openaiGenerate(messages, signal);
    }
  }

  /**
   * OpenAI 兼容格式的非流式调用
   */
  private async openaiGenerate(messages: any[], signal?: AbortSignal): Promise<any> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };

    // 如果绑定了工具，加入 tools 参数
    if (this.boundTools.length > 0) {
      body.tools = this.boundTools;
    }

    const res = await retryWithBackoff(
      () => fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }),
      { maxRetries: 3, signal }
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`API 错误 ${res.status}: ${errBody}`);
    }

    const data = await res.json() as any;
    const choice = data.choices?.[0];
    const message = choice?.message;
    const text = message?.content || "";
    const rawToolCalls = message?.tool_calls;

    // 构建 AIMessage
    const aiMsg = new AIMessage({
      content: text || "",
      additional_kwargs: rawToolCalls ? { tool_calls: rawToolCalls } : {},
    }) as any;

    // 设置 LangChain 标准的 tool_calls 字段
    if (rawToolCalls && rawToolCalls.length > 0) {
      aiMsg.tool_calls = rawToolCalls.map((tc: any) => ({
        id: tc.id || `call_${Date.now()}`,
        name: tc.function?.name,
        args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
      }));
    }

    return {
      generations: [{ text, message: aiMsg }],
      llmOutput: {},
    };
  }

  /**
   * Anthropic 格式的非流式调用
   */
  private async anthropicGenerate(messages: any[], signal?: AbortSignal): Promise<any> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: messages.filter((m) => m.role !== "system"),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
    };

    // system 消息单独传
    const systemMsg = messages.find((m) => m.role === "system");
    if (systemMsg) {
      body.system = systemMsg.content;
    }

    // 如果绑定了工具，加入 tools 参数（Anthropic 格式）
    if (this.boundTools.length > 0) {
      body.tools = this.boundTools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const res = await retryWithBackoff(
      () => fetch(`${this.baseURL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal,
      }),
      { maxRetries: 3, signal }
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API 错误 ${res.status}: ${errBody}`);
    }

    const data = await res.json() as any;
    const content = data.content || [];

    const textBlock = content.find((c: any) => c.type === "text");
    const thinkingBlock = content.find((c: any) => c.type === "thinking");
    const toolUseBlocks = content.filter((c: any) => c.type === "tool_use");

    const text = textBlock?.text || "";
    const thinking = thinkingBlock?.thinking || "";

    const aiMsg = new AIMessage({
      content: text,
      additional_kwargs: thinking ? { thinking } : {},
    }) as any;

    aiMsg.thinking = thinking;

    // 转换 Anthropic tool_use 为 LangChain tool_calls
    if (toolUseBlocks.length > 0) {
      aiMsg.tool_calls = toolUseBlocks.map((tu: any) => ({
        id: tu.id,
        name: tu.name,
        args: tu.input || {},
      }));
      aiMsg.additional_kwargs.tool_calls = toolUseBlocks.map((tu: any) => ({
        id: tu.id,
        type: "tool_use",
        name: tu.name,
        input: tu.input,
      }));
    }

    return {
      generations: [{ text, message: aiMsg }],
      llmOutput: {},
    };
  }

  /**
   * 流式调用 — BaseChatModel 要求实现此方法名
   */
  async *_streamResponseChunks(
    messages: BaseMessage[],
    options?: any,
    runManager?: any
  ): AsyncGenerator<ChatGenerationChunk> {
    const extractedMessages = this.extractMessages(messages);
    const signal = options?.signal;

    if (this.isAnthropicFormat()) {
      yield* this.anthropicStream(extractedMessages, signal);
    } else {
      yield* this.openaiStream(extractedMessages, signal);
    }
  }

  /**
   * OpenAI 兼容格式的流式调用
   */
  private async *openaiStream(
    messages: any[],
    signal?: AbortSignal
  ): AsyncGenerator<ChatGenerationChunk> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    };

    if (this.boundTools.length > 0) {
      body.tools = this.boundTools;
    }

    const res = await retryWithBackoff(
      () => fetch(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }),
      { maxRetries: 3, signal }
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`API 错误 ${res.status}: ${errBody}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // tool_calls 累积器
    const toolCallAccumulators: Map<number, { id: string; name: string; argsStr: string }> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n")) {
        const lineEnd = buffer.indexOf("\n");
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line || !line.startsWith("data:")) continue;
        const dataStr = line.slice(5).trim();
        if (dataStr === "[DONE]") return;

        try {
          const chunk = JSON.parse(dataStr);
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // 文本内容
          if (delta.content) {
            yield new ChatGenerationChunk({
              text: delta.content,
              message: new AIMessageChunk({ content: delta.content }),
            });
          }

          // tool_calls delta（OpenAI 格式）
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallAccumulators.has(idx)) {
                toolCallAccumulators.set(idx, {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  argsStr: "",
                });
              }
              const acc = toolCallAccumulators.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.argsStr += tc.function.arguments;
            }

            // 在 stream 结束时才 yield 完整的 tool_calls
            // finish_reason 表示这个 delta 结束
            if (chunk.choices?.[0]?.finish_reason === "tool_calls") {
              const toolCalls = Array.from(toolCallAccumulators.values()).map((acc) => ({
                id: acc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                name: acc.name,
                args: (() => { try { return JSON.parse(acc.argsStr || "{}"); } catch { return {}; } })(),
              }));

              const aiMsg = new AIMessageChunk({
                content: "",
                additional_kwargs: {
                  tool_calls: toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function",
                    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                  })),
                },
              }) as any;
              aiMsg.tool_calls = toolCalls;

              yield new ChatGenerationChunk({
                text: "",
                message: aiMsg,
              });
            }
          }
        } catch {}
      }
    }
  }

  /**
   * Anthropic 格式的流式调用
   */
  private async *anthropicStream(
    messages: any[],
    signal?: AbortSignal
  ): AsyncGenerator<ChatGenerationChunk> {
    const body: Record<string, unknown> = {
      model: this.modelName,
      messages: messages.filter((m) => m.role !== "system"),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: true,
    };

    const systemMsg = messages.find((m) => m.role === "system");
    if (systemMsg) body.system = systemMsg.content;

    if (this.boundTools.length > 0) {
      body.tools = this.boundTools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const res = await retryWithBackoff(
      () => fetch(`${this.baseURL}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal,
      }),
      { maxRetries: 3, signal }
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic API 错误 ${res.status}: ${errBody}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // tool_use 累积器
    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n")) {
        const lineEnd = buffer.indexOf("\n");
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line.startsWith("data:")) continue;
        try {
          const event = JSON.parse(line.slice(5));

          if (event.type === "content_block_start") {
            const block = event.content_block;
            if (block?.type === "tool_use") {
              currentToolId = block.id || "";
              currentToolName = block.name || "";
              currentToolArgs = "";
            }
          } else if (event.type === "content_block_delta") {
            const delta = event.delta;
            if (delta?.type === "thinking_delta") {
              yield new ChatGenerationChunk({
                text: "",
                message: new AIMessageChunk({
                  content: "",
                  additional_kwargs: { thinking: delta.thinking },
                }),
              });
            } else if (delta?.type === "text_delta") {
              yield new ChatGenerationChunk({
                text: delta.text,
                message: new AIMessageChunk({ content: delta.text }),
              });
            } else if (delta?.type === "input_json_delta") {
              currentToolArgs += delta.partial_json || "";
            }
          } else if (event.type === "content_block_stop") {
            // tool_use block 结束，yield 完整的 tool_call
            if (currentToolName) {
              let args = {};
              try { args = JSON.parse(currentToolArgs || "{}"); } catch {}
              const toolCall = {
                id: currentToolId,
                name: currentToolName,
                args,
              };
              const aiMsg = new AIMessageChunk({
                content: "",
                additional_kwargs: {
                  tool_calls: [{
                    id: toolCall.id,
                    type: "tool_use",
                    name: toolCall.name,
                    input: toolCall.args,
                  }],
                },
              }) as any;
              aiMsg.tool_calls = [toolCall];

              yield new ChatGenerationChunk({
                text: "",
                message: aiMsg,
              });

              currentToolName = "";
              currentToolArgs = "";
            }
          }
        } catch {}
      }
    }
  }

  private isAnthropicFormat(): boolean {
    return this.baseURL.includes("/anthropic") || this.baseURL.includes("anthropic");
  }
}

/**
 * 创建 Agent 模型实例
 * 优先级：运行时参数 > 环境变量 > 默认值
 */
export function createAgentModel(
  options?: AgentModelOptions,
  runtimeConfig?: AgentModelConfig
): BaseChatModel {
  const modelName = runtimeConfig?.modelName ?? process.env.AGENT_MODEL_NAME;

  if (modelName) {
    const apiKey = runtimeConfig?.apiKey ?? process.env.AGENT_API_KEY;
    if (!apiKey) {
      throw new Error("缺少 API Key（请在模型设置中配置）");
    }

    const baseURL = runtimeConfig?.baseURL ?? process.env.AGENT_BASE_URL;
    if (!baseURL) {
      throw new Error("缺少 API Base URL（请在模型设置中配置）");
    }

    return new CustomChatModel({
      modelName,
      apiKey,
      baseURL,
      temperature: options?.temperature ?? runtimeConfig?.temperature ?? parseFloat(process.env.AGENT_TEMPERATURE ?? "0.7"),
      maxTokens: options?.maxTokens ?? runtimeConfig?.maxTokens ?? parseInt(process.env.AGENT_MAX_TOKENS ?? "4000", 10),
    });
  }

  // Fallback: 使用默认 GLM
  return createGLM5({
    temperature: options?.temperature ?? 0.7,
    maxTokens: options?.maxTokens ?? 4000,
  });
}

/**
 * 创建 GLM 模型 LangChain 实例
 */
export function createGLM5(config?: {
  temperature?: number;
  maxTokens?: number;
}): BaseChatModel {
  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) {
    throw new Error("缺少环境变量 BIGMODEL_API_KEY");
  }

  return new ChatOpenAI({
    model: "glm-4-flash",
    apiKey,
    configuration: {
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
    },
    temperature: config?.temperature ?? 0.7,
    maxTokens: config?.maxTokens ?? 2000,
  });
}
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`
Expected: 无错误（或仅有无关的现有警告）

- [ ] **Step 3: 手动验证 — 启动开发服务器确认现有功能不受影响**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npm run dev`
Expected: 编译成功，浏览器打开无白屏

- [ ] **Step 4: Commit**

```bash
git add src/lib/langchain/llm.ts src/lib/agent/guard/retryWithBackoff.ts
git commit -m "feat: 升级 CustomChatModel 支持 tool calling + 流式输出 + 重试"
```

---

## Phase 2：守卫模块 + LangGraph 迁移

### Task 3: 创建 LoopGuard 循环守卫

**Files:**
- Create: `src/lib/agent/guard/loopGuard.ts`

- [ ] **Step 1: 创建 loopGuard.ts**

```typescript
// src/lib/agent/guard/loopGuard.ts

/**
 * 循环守卫配置
 */
export interface LoopGuardConfig {
  /** 连续相同调用阈值（默认 2） */
  maxConsecutiveSame: number;
  /** 单个工具最大调用次数（默认 5） */
  maxPerTool: number;
  /** 所有工具最大总调用次数（默认 12） */
  maxTotalCalls: number;
}

const DEFAULT_CONFIG: LoopGuardConfig = {
  maxConsecutiveSame: 2,
  maxPerTool: 5,
  maxTotalCalls: 12,
};

/**
 * 循环守卫错误基类
 */
export class LoopGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopGuardError";
  }
}

/** 连续重复调用同一工具 */
export class LoopDetectedError extends LoopGuardError {
  public readonly toolName: string;
  constructor(toolName: string) {
    super(`工具 ${toolName} 连续重复调用，请基于已有结果直接回答用户问题`);
    this.name = "LoopDetectedError";
    this.toolName = toolName;
  }
}

/** 单工具调用次数超限 */
export class ToolCallLimitError extends LoopGuardError {
  public readonly toolName: string;
  public readonly count: number;
  constructor(toolName: string, count: number) {
    super(`工具 ${toolName} 已调用 ${count} 次，达到上限。请基于已有信息生成最终回答。`);
    this.name = "ToolCallLimitError";
    this.toolName = toolName;
    this.count = count;
  }
}

/** 总工具调用次数超限 */
export class TotalToolLimitError extends LoopGuardError {
  public readonly count: number;
  constructor(count: number) {
    super(`已调用 ${count} 次工具，达到总上限。请立即总结已有结果回答用户。`);
    this.name = "TotalToolLimitError";
    this.count = count;
  }
}

/**
 * 生成参数的简单 hash（用于比较两次调用是否相同）
 */
function hashArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

/**
 * 循环守卫 — 检测并阻止重复/过度的工具调用
 */
export class LoopGuard {
  private config: LoopGuardConfig;
  /** toolName → 累计调用次数 */
  private callCounts: Map<string, number> = new Map();
  /** 上一次调用的 key */
  private lastCallKey: string | null = null;
  /** 连续相同调用计数 */
  private consecutiveSameCount: number = 0;
  /** 总调用次数 */
  private totalCalls: number = 0;

  constructor(config?: Partial<LoopGuardConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 检查是否允许调用。不允许时抛出对应的 LoopGuardError。
   * 调用方捕获错误后，将错误消息作为工具结果返回给模型。
   */
  check(toolName: string, args: Record<string, unknown>): void {
    this.totalCalls++;
    const argsHash = hashArgs(args);
    const callKey = `${toolName}:${argsHash}`;

    // 检查 1：总调用上限
    if (this.totalCalls > this.config.maxTotalCalls) {
      throw new TotalToolLimitError(this.totalCalls);
    }

    // 检查 2：单工具累计上限
    const toolCount = (this.callCounts.get(toolName) || 0) + 1;
    if (toolCount > this.config.maxPerTool) {
      throw new ToolCallLimitError(toolName, toolCount);
    }
    this.callCounts.set(toolName, toolCount);

    // 检查 3：连续相同调用
    if (callKey === this.lastCallKey) {
      this.consecutiveSameCount++;
      if (this.consecutiveSameCount >= this.config.maxConsecutiveSame) {
        throw new LoopDetectedError(toolName);
      }
    } else {
      this.consecutiveSameCount = 0;
    }

    this.lastCallKey = callKey;
  }

  /** 重置状态（新请求时调用） */
  reset(): void {
    this.callCounts.clear();
    this.lastCallKey = null;
    this.consecutiveSameCount = 0;
    this.totalCalls = 0;
  }

  /** 获取当前状态（用于调试） */
  getStatus(): { totalCalls: number; perTool: Record<string, number>; lastCallKey: string | null } {
    return {
      totalCalls: this.totalCalls,
      perTool: Object.fromEntries(this.callCounts),
      lastCallKey: this.lastCallKey,
    };
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

---

### Task 4: 创建 ResourceLimit 工具结果截断

**Files:**
- Create: `src/lib/agent/guard/resourceLimit.ts`

- [ ] **Step 1: 创建 resourceLimit.ts**

```typescript
// src/lib/agent/guard/resourceLimit.ts

/**
 * 资源限制配置
 */
export interface ResourceLimits {
  /** 单个工具结果最大字符数（默认 10,000） */
  maxResultChars: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxResultChars: 10_000,
};

/**
 * 截断过长的工具结果
 */
export function truncateToolResult(
  result: string,
  maxChars: number = DEFAULT_RESOURCE_LIMITS.maxResultChars
): string {
  if (typeof result !== "string") {
    result = JSON.stringify(result);
  }
  if (result.length <= maxChars) return result;
  return (
    result.slice(0, maxChars) +
    `\n\n[结果已截断，原始长度 ${result.length} 字符。请基于已显示的内容回答。]`
  );
}
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

---

### Task 5: 创建 guard/index.ts 统一导出

**Files:**
- Create: `src/lib/agent/guard/index.ts`

- [ ] **Step 1: 创建 index.ts**

```typescript
// src/lib/agent/guard/index.ts

export { retryWithBackoff, type RetryOptions } from "./retryWithBackoff";
export {
  LoopGuard,
  LoopGuardError,
  LoopDetectedError,
  ToolCallLimitError,
  TotalToolLimitError,
  type LoopGuardConfig,
} from "./loopGuard";
export {
  truncateToolResult,
  DEFAULT_RESOURCE_LIMITS,
  type ResourceLimits,
} from "./resourceLimit";
```

- [ ] **Step 2: Commit 所有守卫模块**

```bash
git add src/lib/agent/guard/
git commit -m "feat: 添加循环守卫模块 — LoopGuard + ResourceLimit + RetryWithBackoff"
```

---

### Task 6: 重构 route.ts — 迁移到 LangGraph ReAct Agent

**Files:**
- Modify: `src/app/api/agent/stream/route.ts`

这是最大的改动。将自定义 while 循环替换为 LangGraph `createReactAgent` 的 stream，同时集成守卫模块。

- [ ] **Step 1: 重写 route.ts**

完整替换文件内容为：

```typescript
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAgentModel, type AgentModelConfig } from "@/lib/langchain/llm";
import {
  duckduckgoSearch, createContent, listContent, listCategories, deleteContent,
  searchSkill, requestInstallSkill, listInstalledSkills, uninstallSkill, checkSkillStatus,
} from "@/lib/agent/tools";
import { getOrCreateSession } from "@/lib/agent/session";
import { createQueryEngine } from "@/lib/agent/chat";
import { ADMIN_CHAT_PROMPT, ADMIN_CHAT_NEGATIVE_PROMPT } from "@/lib/agent/prompts/admin_chat";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { getSkillPromptWithUserInstalled } from "@/lib/agent/skills";
import { resolveSkillContext } from "@/lib/agent/skillRouter";
import {
  loadMemories, loadTeamMemories, formatMemoriesForPrompt, loadProjectContext,
} from "@/lib/agent/memory";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { LoopGuard, LoopGuardError, truncateToolResult, DEFAULT_RESOURCE_LIMITS } from "@/lib/agent/guard";
import type { ResourceLimits } from "@/lib/agent/guard";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  const userId = (session?.user as any)?.id || "admin";
  if (!isAdmin) throw new Error("Unauthorized");
  return userId;
}

/** SSE 发送辅助函数 */
function createSSESender(controller: ReadableStreamDefaultController) {
  const encoder = new TextEncoder();
  return (type: string, data: unknown) => {
    const str = "data: " + JSON.stringify({ type, data }) + "\n\n";
    controller.enqueue(encoder.encode(str));
  };
}

/** 创建 remember 工具（依赖 userId 闭包） */
function createRememberTool(userId: string) {
  return tool(
    async ({ name, description, content, type }: {
      name: string;
      content: string;
      type?: "user" | "feedback" | "project" | "reference";
      description?: string;
    }) => {
      await prisma.agentMemory.create({
        data: {
          userId,
          name,
          description: description || null,
          content,
          type: type || "project",
          isPrivate: true,
        },
      });
      return `记忆已保存: [${type || "project"}] ${name}`;
    },
    {
      name: "remember",
      description: "保存重要信息到长期记忆。当用户分享了个人偏好、确认了正确的做法、给出了反馈、或者需要记住项目相关信息时使用。",
      schema: z.object({
        name: z.string().describe("记忆名称，简短标识"),
        content: z.string().describe("要保存的具体内容"),
        type: z.enum(["user", "feedback", "project", "reference"]).optional().describe("类型: user=用户偏好, feedback=反馈确认, project=项目信息, reference=参考资料"),
        description: z.string().optional().describe("一句话描述"),
      }),
    }
  );
}

/**
 * 将守卫逻辑包装到工具执行中
 * 返回一组新的工具，拦截 invoke 调用
 */
function wrapToolsWithGuard(
  tools: any[],
  guard: LoopGuard,
  limits: ResourceLimits
): any[] {
  return tools.map((originalTool) => {
    const originalInvoke = originalTool.invoke.bind(originalTool);

    const guardedInvoke = async (input: any, options?: any) => {
      const toolName = originalTool.name || originalTool.lc_name || "unknown";
      // ToolNode 可能传入 ToolCall 格式 { name, args, id, type: "tool_call" } 或直接传入 args
      let args: Record<string, unknown>;
      if (input && typeof input === "object" && input.type === "tool_call") {
        args = input.args || {};
      } else if (typeof input === "string") {
        try { args = JSON.parse(input); } catch { args = { input }; }
      } else {
        args = input;
      }

      // 守卫检查
      try {
        guard.check(toolName, args);
      } catch (err) {
        if (err instanceof LoopGuardError) {
          // 返回错误信息作为工具结果，不中断 agent
          return err.message;
        }
        throw err;
      }

      // 执行工具
      let result: any;
      try {
        result = await originalInvoke(input, options);
      } catch (err) {
        result = err instanceof Error ? err.message : String(err);
      }

      // 截断结果
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      return truncateToolResult(resultStr, limits.maxResultChars);
    };

    // 克隆工具对象，替换 invoke
    return Object.create(Object.getPrototypeOf(originalTool), {
      ...Object.getOwnPropertyDescriptors(originalTool),
      invoke: { value: guardedInvoke, writable: true, configurable: true },
    });
  });
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireAdmin();
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Unauthorized" } }) + "\n\n",
      { status: 401, headers: SSE_HEADERS }
    );
  }

  let body: { message?: string; sessionKey?: string; skill?: string; modelConfig?: AgentModelConfig };
  try { body = await req.json(); } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Invalid request body" } }) + "\n\n",
      { status: 400, headers: SSE_HEADERS }
    );
  }

  const { message, sessionKey, skill: explicitSkill, modelConfig } = body;
  if (!message || typeof message !== "string") {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Invalid message" } }) + "\n\n",
      { status: 400, headers: SSE_HEADERS }
    );
  }

  const key = sessionKey || `agent:chat:${Date.now()}`;

  let session;
  try {
    session = await getOrCreateSession(key, "chat", userId);
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Session error" } }) + "\n\n",
      { status: 500, headers: SSE_HEADERS }
    );
  }

  const apiKey = modelConfig?.apiKey || process.env.BIGMODEL_API_KEY || "";
  let engine;
  try {
    engine = await createQueryEngine(key, userId, "chat", { apiKey });
  } catch (err) {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Session error" } }) + "\n\n",
      { status: 500, headers: SSE_HEADERS }
    );
  }

  let engineInitialized = false;
  try {
    await engine.initialize();
    engineInitialized = true;
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Session lock error" } }) + "\n\n",
      { status: 409, headers: SSE_HEADERS }
    );
  }

  try {
    await engine.addUserMessage(message);
  } catch {}

  // 解析 skill 上下文
  const skillCtx = resolveSkillContext(message, explicitSkill);
  let skillPrompt = ADMIN_CHAT_PROMPT + ADMIN_CHAT_NEGATIVE_PROMPT;
  let cleanMessage = message;

  if (skillCtx.activeSkill) {
    const loaded = await getSkillPromptWithUserInstalled(skillCtx.activeSkill, userId);
    if (loaded) {
      skillPrompt = loaded + ADMIN_CHAT_NEGATIVE_PROMPT;
      cleanMessage = skillCtx.cleanMessage || message;
    }
  }

  // 加载项目上下文和记忆
  const [projectContext, memories, teamMemories] = await Promise.all([
    loadProjectContext(),
    loadMemories(userId),
    loadTeamMemories(),
  ]);

  const allMemories = [...memories, ...teamMemories];
  const memorySection = formatMemoriesForPrompt(allMemories);
  const contextSection = projectContext ? `\n\n${projectContext}` : "";

  // 构建系统提示词
  const systemPrompt = [
    skillPrompt,
    contextSection,
    memorySection,
    "\n\n回答要求：简洁、直接、不重复。",
  ].join("");

  // 准备工具
  const remember = createRememberTool(userId);
  const baseTools = [duckduckgoSearch, createContent, listContent, listCategories, deleteContent] as any[];
  const skillMarketTools = [searchSkill, requestInstallSkill, listInstalledSkills, uninstallSkill, checkSkillStatus] as any[];
  const allTools = [...baseTools, remember, ...skillMarketTools];

  // 创建守卫
  const guard = new LoopGuard();
  const limits = { ...DEFAULT_RESOURCE_LIMITS };

  // 包装工具
  const guardedTools = wrapToolsWithGuard(allTools, guard, limits);

  // 创建 LLM
  const llm = createAgentModel({ temperature: 0.7, maxTokens: 4000 }, modelConfig);

  // 创建 LangGraph ReAct Agent（createReactAgent 是同步的，不需要 await）
  const agent = createReactAgent({
    llm: llm as any,
    tools: guardedTools as any,
    prompt: systemPrompt,
  });

  // AbortController + Agent 级超时（第7道防线：5分钟兜底）
  const abortCtrl = new AbortController();
  const timeoutId = setTimeout(() => abortCtrl.abort(), 5 * 60 * 1000);
  if (req.signal) {
    req.signal.addEventListener("abort", () => { clearTimeout(timeoutId); abortCtrl.abort(); }, { once: true });
  }

  // 检查并压缩（流开始前）
  try {
    const { compacted } = await engine.checkAndCompact(skillPrompt);
    if (compacted) {
      // 压缩成功，继续
    }
  } catch {}

  // 加载历史
  let persistentHistory: any[] = [];
  try {
    persistentHistory = await engine.getMessages();
  } catch {}

  // 构建消息列表
  const historyMessages = persistentHistory.map((h: any) => {
    if (h.role === "user") return new HumanMessage(h.content);
    if (h.role === "assistant") return new AIMessage(h.content);
    return new HumanMessage(h.content);
  });

  const inputMessages = [...historyMessages, new HumanMessage(cleanMessage)];

  const stream = new ReadableStream({
    async start(controller) {
      const send = createSSESender(controller);

      try {
        send("init", { sessionId: session!.id, sessionKey: key, activeSkill: skillCtx.activeSkill });

        let finalAssistantText = "";

        for await (const event of await agent.stream(
          { messages: inputMessages },
          { signal: abortCtrl.signal, streamMode: "values", recursionLimit: 15 }
        )) {
          // LangGraph streamMode="values" 返回 state snapshots
          // event 包含 messages 数组
          if (!event?.messages) continue;

          const messages = event.messages;
          const lastMsg = messages[messages.length - 1];
          if (!lastMsg) continue;

          if (lastMsg._getType() === "ai") {
            const aiMsg = lastMsg as any;

            // 发送 thinking 内容
            if (aiMsg.additional_kwargs?.thinking) {
              send("thinking", { content: aiMsg.additional_kwargs.thinking });
            }

            // 有 tool_calls：发送 tool_start 事件
            if (aiMsg.tool_calls && aiMsg.tool_calls.length > 0) {
              for (const tc of aiMsg.tool_calls) {
                send("tool_start", { toolName: tc.name, arguments: JSON.stringify(tc.args) });
              }
            }

            // 纯文本内容（非 tool_calls）
            if (aiMsg.content && typeof aiMsg.content === "string" && (!aiMsg.tool_calls || aiMsg.tool_calls.length === 0)) {
              const newText = aiMsg.content;
              if (newText.length > finalAssistantText.length) {
                const delta = newText.slice(finalAssistantText.length);
                send("delta", { content: delta });
                finalAssistantText = newText;
              }
            }
          } else if (lastMsg._getType() === "tool") {
            const toolMsg = lastMsg as any;
            const toolCallId = toolMsg.tool_call_id || "";
            // 查找对应的工具名
            const prevAiMsg = messages[messages.length - 2];
            const matchedCall = prevAiMsg?.tool_calls?.find((tc: any) => tc.id === toolCallId);

            send("tool_end", {
              toolName: matchedCall?.name || "unknown",
              result: typeof toolMsg.content === "string" ? toolMsg.content : JSON.stringify(toolMsg.content),
              success: !toolMsg.content?.includes?.("LoopGuardError") && !toolMsg.content?.includes?.("Tool not found"),
            });
          }
        }

        // 持久化最终回答
        if (finalAssistantText) {
          try {
            await engine.addAssistantMessage(finalAssistantText);
          } catch {}
        }

        send("done", {});
      } catch (err: any) {
        if (err.name === "AbortError") {
          send("done", { reason: "cancelled" });
        } else {
          console.error("[stream] error:", err);
          send("error", { message: err.message || "模型调用失败" });
        }
      } finally {
        clearTimeout(timeoutId);
        if (engine && engineInitialized) {
          try { await engine.release(); } catch {}
        }
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npx tsc --noEmit --skipLibCheck 2>&1 | head -30`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/stream/route.ts
git commit -m "feat: 迁移 agent stream 到 LangGraph ReAct Agent + 7层防死循环守卫"
```

---

### Task 7: 更新前端 AgentChat.tsx — 移除 toolCompleted 模式

**Files:**
- Modify: `src/components/admin/AgentChat.tsx`

当前前端在收到 `done + toolCompleted` 时会重置 content buffer（第 318-331 行）。迁移后不再有 `toolCompleted` 模式，工具执行和文本输出在同一个连续流中。

- [ ] **Step 1: 修改 `done` 事件处理逻辑**

找到 `AgentChat.tsx` 第 317 行附近的 `done` 事件处理代码。替换 `} else if (data.type === "done") {` 块：

旧代码（第 317-349 行）：
```typescript
} else if (data.type === "done") {
  if (data.data?.toolCompleted) {
    // 工具执行完毕，停止思考打字机，但不结束消息
    if (thinkingTimerRef.current[assistantId]) {
      clearTimeout(thinkingTimerRef.current[assistantId]!);
      thinkingTimerRef.current[assistantId] = null;
    }
    // 重置 content buffer，准备接收最终回答
    contentBufferRef.current[assistantId] = "";
    contentTypingRef.current[assistantId] = 0;
    if (contentTimerRef.current[assistantId]) {
      clearTimeout(contentTimerRef.current[assistantId]!);
      contentTimerRef.current[assistantId] = null;
    }
  } else {
    // 真正结束：停止所有打字机，立即显示完整内容
    ...
  }
}
```

替换为：
```typescript
} else if (data.type === "done") {
  // 流结束（不再区分 toolCompleted，LangGraph stream 是连续的）
  // 停止所有打字机，立即显示完整内容
  if (thinkingTimerRef.current[assistantId]) {
    clearTimeout(thinkingTimerRef.current[assistantId]!);
    thinkingTimerRef.current[assistantId] = null;
  }
  if (contentTimerRef.current[assistantId]) {
    clearTimeout(contentTimerRef.current[assistantId]!);
    contentTimerRef.current[assistantId] = null;
  }
  const fullThinking = thinkingBufferRef.current[assistantId] || "";
  const fullContent = contentBufferRef.current[assistantId] || "";
  setMessages((prev) =>
    prev.map((m) => m.id === assistantId
      ? { ...m, thinking: fullThinking, thinkingComplete: true, content: fullContent, isComplete: true }
      : m)
  );
}
```

- [ ] **Step 2: 验证编译**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npx tsc --noEmit --skipLibCheck 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/AgentChat.tsx
git commit -m "fix: 移除前端 toolCompleted 模式，适配 LangGraph 连续事件流"
```

---

### Task 8: 端到端手动测试

- [ ] **Step 1: 启动开发服务器**

Run: `cd D:/project/KnowledgeRag/knowledge-rag && npm run dev`

- [ ] **Step 2: 测试基本对话**

在 Agent Chat 中发送 "你好"，验证：
- 收到 init 事件
- 收到 delta 文本流
- 收到 done 事件
- 无死循环

- [ ] **Step 3: 测试工具调用**

发送 "列出所有内容"，验证：
- 收到 tool_start（list_content）
- 收到 tool_end（结果）
- 收到 delta（最终回答）
- 收到 done

- [ ] **Step 4: 测试防死循环**

发送一个复杂任务如 "帮我搜索最新的 AI 新闻，然后写一篇文章发布"，验证：
- 搜索工具最多调用 5 次
- 总工具调用不超过 12 次
- 最终能正常完成并返回结果

- [ ] **Step 5: 测试中途取消**

发送一个任务，在执行过程中点击"新建会话"，验证：
- 请求被中断
- 前端显示"请求已取消"
- 无后续错误

---

## 执行顺序依赖

```
Task 1 (retryWithBackoff)  ← 无依赖
  ↓
Task 2 (升级 CustomChatModel)  ← 依赖 Task 1
  ↓
Task 3 (LoopGuard)       ← 无依赖，可与 Task 2 并行
Task 4 (ResourceLimit)   ← 无依赖，可与 Task 2 并行
Task 5 (guard/index.ts)  ← 依赖 Task 1, 3, 4
  ↓
Task 6 (重构 route.ts)   ← 依赖 Task 2, 5
  ↓
Task 7 (前端适配)        ← 依赖 Task 6
  ↓
Task 8 (手动测试)        ← 依赖 Task 7
```

建议并行执行：Task 1 → Task 2 + (Task 3 + Task 4 并行) → Task 5 → Task 6 → Task 7 → Task 8
