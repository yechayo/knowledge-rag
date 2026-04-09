# Agent 防死循环纵深防御设计

**日期**: 2026-04-09
**状态**: Draft (v2 — 修复 review 问题)

## 问题

Agent 在执行长任务时会反复调用同一工具（如 `tavily_search`、`list_content`），无法自行终止。当前仅有 `MAX_ITERS = 20` 的硬上限，缺少重复检测、资源限制、用户中断等机制。

## 目标

参考 Claude Code 的 7 层纵深防御模型，基于 LangGraph `createReactAgent` 重构 agent 流式执行循环，建立多层防死循环体系。

## 分阶段实施

### Phase 1：升级 CustomChatModel（前提条件）
让 `CustomChatModel` 支持标准 tool calling 和流式输出，为迁移到 LangGraph 铺路。

### Phase 2：迁移到 LangGraph + 添加守卫模块
替换自定义 while 循环，嵌入 7 层防护。

---

## Phase 1：升级 CustomChatModel

**文件**: `src/lib/langchain/llm.ts`

### 1.1 支持结构化 Tool Calling

当前 `CustomChatModel._generate()` 只返回 `AIMessage({ content: text })`，不包含 `tool_calls` 字段。`createReactAgent` 需要模型返回结构化的 `tool_calls` 才能驱动工具调用循环。

**改造方案**：在 `_generate()` 中检测模型输出是否包含工具调用，并转换为标准格式。

```typescript
// OpenAI 格式的 tool_calls 返回
interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

// 在 _generate 返回中：
const aiMsg = new AIMessage({
  content: text,
  additional_kwargs: {
    tool_calls: parsedToolCalls,  // 结构化工具调用
  },
});
// 并设置 aiMsg.tool_calls = [...]（LangChain 标准字段）
```

**实现细节**：
- OpenAI 兼容模型（大多数）：API 原生支持 `tools` 参数和 `tool_calls` 响应。在请求体中传入 `tools` schema，直接从响应中提取 `tool_calls`。
- 非 tool calling 兼容的模型：fallback 到文本解析，从输出中提取 `[TOOL_CALL]` 标记并转换为结构化 `tool_calls`。
- 需要新增 `bindTools(tools: Tool[])` 方法，将 LangChain tools 转换为 API 的 `tools` 参数格式。

### 1.2 支持流式输出 `_stream()`

`CustomChatModel` 当前没有实现 `_stream()` 方法，LangGraph 的 `.stream()` 无法工作。

**新增方法**：

```typescript
async *_stream(messages: any, options?: any, runManager?: any): AsyncGenerator<ChatGenerationChunk> {
  // OpenAI 兼容格式：使用 SSE stream
  // Anthropic 格式：使用 Anthropic SSE stream
  // 每个 chunk yield ChatGenerationChunk
}
```

**流式 tool calling 处理**：
- OpenAI 格式：累积 `tool_calls` delta，完整后 yield `AIMessageChunk` with `tool_calls`
- Anthropic 格式：处理 `content_block_start`（type: "tool_use"）和 `input_json_delta`
- 文本内容：直接 yield `AIMessageChunk({ content: delta })`

### 1.3 Anthropic Thinking 支持

在流式输出中，`thinking_delta` 内容需要通过 LangChain 的机制传递。方案：
- 将 thinking 内容存入 `AIMessageChunk.additional_kwargs.thinking`
- 在 route.ts 的 stream 事件处理中提取并作为 SSE `thinking` 事件发送

### 1.4 内置重试逻辑

将 `retryWithBackoff` 直接集成到 `CustomChatModel` 的 HTTP 调用中，替代当前无重试的 `fetch` 调用。

```typescript
// _generate 和 _stream 内部
const response = await retryWithBackoff(
  () => fetch(url, opts),
  { maxRetries: 3, baseDelayMs: 500, signal: options?.signal }
);
```

重试规则：
- 5xx / 429 / 网络错误：指数退避重试，最多 3 次
- 4xx（非 429）：不重试
- 每次重试前检查 `signal.aborted`

---

## Phase 2：迁移到 LangGraph + 守卫模块

### 架构概览

```
用户输入
  ↓
┌─ AbortController 中断链 ──── 第1道防线：用户随时取消
│   ↓
├─ Token 预算追踪 ────────── 第2道防线：资源耗尽前收尾
│   ↓
├─ LoopGuard 重复检测 ─────── 第3道防线：相同调用识别
│   ↓
├─ 单工具调用限制 ─────────── 第4道防线：次数/大小上限
│   ↓
├─ LangGraph recursionLimit ─ 第5道防线：步数上限
│   ↓
├─ API 重试 + 指数退避 ────── 第6道防线：网络层防死循环（Phase 1 已内置）
│   ↓
└─ Agent 级超时 ──────────── 第7道防线：全局时间兜底
```

### 新增文件

```
src/lib/agent/guard/
  loopGuard.ts        — 循环守卫（重复检测、次数限制）
  resourceLimit.ts    — 资源限制（结果截断）
  retryWithBackoff.ts — API 重试（指数退避 + 抖动）
  index.ts            — 统一导出
```

**修改文件**：
- `src/lib/langchain/llm.ts` — Phase 1 升级
- `src/app/api/agent/stream/route.ts` — Phase 2 重构

---

## 守卫模块详细设计

### 2.1 LoopGuard（循环守卫）

**文件**: `src/lib/agent/guard/loopGuard.ts`

**职责**：检测和阻止重复/过度的工具调用。

```typescript
interface LoopGuardConfig {
  maxConsecutiveSame: number;  // 默认 2
  maxPerTool: number;          // 默认 5
  maxTotalCalls: number;       // 默认 12
}

class LoopGuard {
  private callCounts: Map<string, number>;
  private lastCallKey: string | null;
  private consecutiveSameCount: number;
  private totalCalls: number;

  constructor(config?: Partial<LoopGuardConfig>);

  /** 检查是否允许调用，不允许时抛出 LoopGuardError */
  check(toolName: string, args: Record<string, unknown>): void;

  /** 重置状态（新请求时调用） */
  reset(): void;
}
```

**检查规则**：

| 规则 | 阈值 | 动作 |
|------|------|------|
| 连续相同调用 | ≥ 2 次 `(name, args)` 完全一致 | 抛出 `LoopDetectedError` |
| 单工具累计上限 | > 5 次同一工具 | 抛出 `ToolCallLimitError` |
| 总工具调用上限 | > 12 次 | 抛出 `TotalToolLimitError` |

**错误类型**：
```typescript
class LoopGuardError extends Error { /* 基类 */ }
class LoopDetectedError extends LoopGuardError { /* 连续重复 */ }
class ToolCallLimitError extends LoopGuardError { /* 单工具超限 */ }
class TotalToolLimitError extends LoopGuardError { /* 总量超限 */ }
```

**集成方式 — LangGraph ToolNode 自定义包装**：

不使用包装 `invoke` 的方式（LangChain Tool 的 `invoke` 不易拦截），而是自定义 `ToolNode`：

```typescript
import { ToolNode } from "@langchain/langgraph/prebuilt";

function createGuardedToolNode(tools: Tool[], guard: LoopGuard, limits: ResourceLimits) {
  // 创建自定义 ToolNode，在工具执行前后插入守卫逻辑
  return new ToolNode(tools, {
    // 使用 LangGraph 的工具执行 hook
  });
}
```

具体实现：继承或包装 `ToolNode`，重写工具执行逻辑：
1. 执行前：`guard.check(toolName, args)` + 检查 `signal.aborted`
2. 执行后：`truncateToolResult(result)` + 更新 token 预算

### 2.2 ResourceLimit（资源限制）

**文件**: `src/lib/agent/guard/resourceLimit.ts`

**工具结果截断**：

| 限制项 | 值 |
|--------|-----|
| 单个工具结果最大字符数 | 10,000 |
| 截断后追加提示 | `"[结果已截断，原始长度 N 字符]"` |

```typescript
interface ResourceLimits {
  maxResultChars: number;  // 默认 10_000
}

function truncateToolResult(result: string, maxChars = 10_000): string {
  if (result.length <= maxChars) return result;
  return result.slice(0, maxChars) +
    `\n\n[结果已截断，原始长度 ${result.length} 字符]`;
}
```

**Token 预算 — 复用已有模块**：

不新建 `TokenBudget` 类，复用已有的 `src/lib/agent/chat/tokenBudget.ts` 中的 `checkTokenBudget()` 和 `estimateTokenCount()` 函数。在 route.ts 的 stream 事件处理中调用，追踪累计消耗。

当 token 预算达到 80% 时，通过 LangGraph 的 state update 注入"请总结收尾"消息；达到 100% 时终止 stream。

### 2.3 RetryWithBackoff（指数退避重试）

**文件**: `src/lib/agent/guard/retryWithBackoff.ts`

```typescript
interface RetryOptions {
  maxRetries: number;      // 默认 3
  baseDelayMs: number;     // 默认 500
  maxDelayMs: number;      // 默认 32_000
  jitterFactor: number;    // 默认 0.25
  signal?: AbortSignal;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T>
```

**退避策略**：
- 延迟公式：`min(baseDelay * 2^attempt, maxDelay) * (1 + random * jitterFactor)`
- 529（服务过载）最多重试 2 次
- 4xx 错误不重试（除了 429）
- 每次重试前检查 `signal.aborted`

**集成**：直接在 `CustomChatModel` 的 `_generate()` 和 `_stream()` 中使用（Phase 1.4）。

### 2.4 AbortController（用户中断）

不需要独立文件。链路：

```
前端 fetch(request, { signal: userAbortSignal })
  → route.ts: req.signal
    → new AbortController()
    → agent.stream(input, { signal: controller.signal })
      → LLM 调用携带 signal（Phase 1 的 retryWithBackoff 使用）
      → ToolNode 检查 signal
```

LangGraph `.stream()` 原生支持 `signal` 参数，AbortSignal 自动传播。

---

## route.ts 重构设计

### 目标结构

```typescript
export async function POST(req: Request) {
  // 1. 认证、参数解析（保持不变）
  // 2. 解析 skill 上下文、加载记忆（保持不变）

  // 3. 创建守卫
  const guard = new LoopGuard();
  const limits: ResourceLimits = { maxResultChars: 10_000 };

  // 4. 准备工具（含动态创建的 remember 工具）
  const remember = createRememberTool(userId);
  const allTools = [...baseTools, remember, ...skillMarketTools];

  // 5. 创建带守卫的 ToolNode
  const guardedToolNode = createGuardedToolNode(allTools, guard, limits);

  // 6. 创建 LangGraph ReAct Agent
  const llm = createAgentModel({ temperature: 0.7, maxTokens: 4000 }, modelConfig);
  const agent = await createReactAgent({
    llm,
    tools: allTools,  // tools 列表用于 schema 生成
    toolNode: guardedToolNode,  // 自定义 ToolNode 处理执行
    prompt: buildSystemPrompt(skillPrompt, contextSection, memorySection),
    recursionLimit: 15,
  });

  // 7. 流式执行
  const abortCtrl = new AbortController();
  req.signal.addEventListener("abort", () => abortCtrl.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const send = createSSESender(controller);
      send("init", { sessionId: session.id, sessionKey: key, activeSkill: skillCtx.activeSkill });

      try {
        // 注入历史消息
        const history = await engine.getMessages();
        const messages = [
          ...history.map(toLangChainMessage),
          new HumanMessage(cleanMessage),
        ];

        for await (const event of agent.stream(
          { messages },
          { signal: abortCtrl.signal }
        )) {
          handleStreamEvent(event, send);
        }

        // 持久化最终回答
        // （从 stream 事件中收集最终 assistant 消息）
        await engine.addAssistantMessage(finalAssistantMessage);
        send("done", {});
      } catch (err) {
        if (err.name === "AbortError") {
          send("done", { reason: "cancelled" });
        } else {
          send("error", { message: err.message });
        }
      } finally {
        try { await engine.release(); } catch {}
        controller.close();
      }
    }
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
```

### SSE 事件映射

LangGraph stream 产生的事件映射到前端兼容的 SSE 格式：

| LangGraph stream 事件 | SSE 事件 | 数据 |
|----------------------|----------|------|
| `on_chain_start` (agent) | `init` | `{ sessionId, sessionKey, activeSkill }` |
| `on_llm_stream` (text delta) | `delta` | `{ content: string }` |
| `on_llm_stream` (thinking) | `thinking` | `{ content: string }` |
| `on_tool_start` | `tool_start` | `{ toolName, arguments }` |
| `on_tool_end` | `tool_end` | `{ toolName, result, success }` |
| `on_tool_end` (guard拦截) | `tool_end` | `{ toolName, result: error message, success: false }` |
| stream 正常结束 | `done` | `{}` |
| stream 被中断 | `done` | `{ reason: "cancelled" }` |
| stream 出错 | `error` | `{ message: string }` |

**前端兼容性处理**：

当前前端 `AgentChat.tsx` 依赖 `done + toolCompleted` 来区分"工具完成继续等待"和"流结束"。迁移后：
- 移除 `toolCompleted` 模式，改为连续事件流
- 前端在收到 `tool_end` 后不清空缓冲区，直接追加后续 `delta`
- 仅收到 `done` 事件时标记流结束

需要同步修改 `AgentChat.tsx` 的事件处理逻辑。

### 对话持久化策略

LangGraph 的消息历史与 QueryEngine 的持久化对接：

1. **流开始前**：从 `engine.getMessages()` 加载历史，转换为 LangChain `BaseMessage[]`
2. **流进行中**：不持久化中间工具调用（避免存储大量工具结果）
3. **流结束后**：
   - 保存最终 assistant 回答：`engine.addAssistantMessage(finalText)`
   - 工具调用历史不持久化（下一轮对话时模型通过压缩后的摘要了解上下文）
4. **压缩**：继续使用 `engine.checkAndCompact()` 在每次请求开始时执行

### 动态工具处理

`remember` 工具依赖请求上下文（`userId`），每次请求动态创建：

```typescript
function createRememberTool(userId: string): Tool {
  return tool(
    async ({ name, content, type, description }) => {
      await prisma.agentMemory.create({ data: { userId, name, ... } });
      return `记忆已保存: [${type}] ${name}`;
    },
    { name: "remember", description: "...", schema: rememberSchema }
  );
}
```

在每次请求中调用 `createRememberTool(userId)` 创建实例，传入工具列表。

---

## 集成点

### executor.ts 保持不变

`executor.ts` 用于 Cron 任务等非流式场景，已使用 LangGraph AgentExecutor。Phase 1 的 `CustomChatModel` 升级也会让 `executor.ts` 受益（tool calling 支持更可靠）。

### 清理调试日志

重构时移除 `route.ts` 中所有 API Key 相关的日志输出（如第 281 行 `apiKey.substring(0, 10)`）。

---

## 测试策略

### Phase 1 测试
1. **Tool calling 格式测试**：验证 OpenAI/Anthropic 格式的 tool_calls 正确解析
2. **流式输出测试**：验证 `_stream()` 的 chunk 产出和 tool_calls delta 累积
3. **重试测试**：模拟 5xx/429 响应，验证退避重试行为
4. **回归测试**：验证现有的 `_generate()` 非流式调用不受影响

### Phase 2 测试
1. **LoopGuard 单元测试**：重复检测、次数限制的各阈值场景
2. **ResourceLimit 单元测试**：截断逻辑的边界值
3. **集成测试**：构造会触发重复调用的 prompt，验证守卫拦截
4. **前端兼容性测试**：验证 SSE 事件流与前端正确交互
5. **手动测试**：
   - 多步搜索任务（验证不再死循环）
   - 中途取消（AbortController）
   - 超长任务（token 预算收尾）

## 不在范围内

- 前端 UI 新功能（如取消按钮样式）
- Cron 任务防堆积（已有独立机制）
- Rate limit 配额系统（API 层面管控）
