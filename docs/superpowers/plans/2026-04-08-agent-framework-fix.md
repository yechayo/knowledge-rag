# Agent 框架问题修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 框架中的关键问题，使其可用于生产环境

**Architecture:** 修复 6 个关键问题和 5 个重要问题，重点关注 Serverless 兼容性、安全性、可靠性和任务配置流程

**Tech Stack:** Next.js, LangChain, Prisma, Node.js (替代 Python spawn)

---

## 问题清单

### Critical Issues (必须修复)
1. Vercel Serverless 不兼容：Python spawn → Node.js 库
2. 任务配置未使用：需要支持动态任务执行
3. Agent 执行无超时：需要添加超时机制
4. GET /api/agent 无认证：安全问题
5. TOCTOU 竞态条件：Session 锁获取不原子
6. 锁释放无错误处理：需要重试机制

### Important Issues (应该修复)
7. MemorySaver 内存泄漏：需要持久化或限制
8. 无输入验证：需要 Zod schema
9. 模型名称不一致：glm-4-flash vs GLM-5

---

## 文件结构

```
src/
├── lib/
│   ├── agent/
│   │   ├── session.ts              # 修复原子锁释放
│   │   ├── tools/
│   │   │   ├── duckduckgo.ts      # 替换为 Node.js 库
│   │   │   └── content.ts          # 添加重试逻辑
│   │   ├── executor.ts             # 添加超时、动态任务支持
│   │   └── types.ts               # 新增：任务配置类型
│   └── langchain/
│       └── llm.ts                 # 修复模型名称
└── app/
    └── api/
        └── agent/
            ├── route.ts            # 添加认证、Zod 验证
            └── cron/
                └── route.ts        # 修复 Cron 验证
```

---

### Task F1: 替换 Python Spawn 为 Node.js DuckDuckGo 库

**Files:**
- Modify: `src/lib/agent/tools/duckduckgo.ts`
- Add: `src/lib/agent/tools/duckduckgo-node.ts` (可选备用)

**Context:**
Vercel Serverless 不支持 Python child_process.spawn。需要使用 Node.js 的 DuckDuckGo 库替代。

推荐库：`duckduckgo-search-api` 或类似的纯 JS 实现。

- [ ] **Step 1: 安装 Node.js DuckDuckGo 库**

```bash
cd D:/project/KnowledgeRag/knowledge-rag
pnpm add duckduckgo-search-api
```

或使用 `@duckduckgo/api-client` 如果前者不可用。

- [ ] **Step 2: 重写 duckduckgo.ts**

```typescript
// src/lib/agent/tools/duckduckgo.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { DuckDuckGoAPI } from "duckduckgo-search-api";

interface DuckDuckGoResult {
  title: string;
  url: string;
  description: string;
}

export const duckduckgoSearch = tool(
  async ({ query, maxResults = 10 }: { query: string; maxResults?: number }) => {
    try {
      const ddg = new DuckDuckGoAPI();
      const results = await ddg.search(query, { maxResults });

      if (!results || results.length === 0) {
        return "未找到相关结果";
      }

      return results
        .map((r: DuckDuckGoResult, i: number) =>
          `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`
        )
        .join("\n\n");
    } catch (error) {
      return `搜索出错: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  {
    name: "duckduckgo_search",
    description: "使用 DuckDuckGo 搜索互联网信息。输入搜索关键词，返回搜索结果列表。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      maxResults: z.number().optional().describe("最大结果数，默认 10"),
    }),
  }
);
```

- [ ] **Step 3: 测试搜索功能**

```bash
cd D:/project/KnowledgeRag/knowledge-rag
node -e "
const { duckduckgoSearch } = require('./src/lib/agent/tools/duckduckgo');
duckduckgoSearch.invoke({ query: 'OpenAI news today', maxResults: 3 })
  .then(console.log)
  .catch(console.error);
"
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/tools/duckduckgo.ts package.json pnpm-lock.yaml
git commit -m "fix: replace Python spawn with Node.js DuckDuckGo library for serverless"
```

---

### Task F2: 修复 Session 锁的 TOCTOU 竞态条件和释放重试

**Files:**
- Modify: `src/lib/agent/session.ts:39-68`

**Context:**
当前锁获取在检查和更新之间存在时间窗口。锁释放失败会导致 session 永久卡住。

- [ ] **Step 1: 分析当前实现**

读取 `src/lib/agent/session.ts` 中的 `acquireSessionLock` 函数（行 39-68）。

- [ ] **Step 2: 使用数据库原子操作修复 TOCTOU**

```typescript
/**
 * 尝试获取 Session 写锁 (原子操作)
 * 使用一步原子更新，避免 TOCTOU 竞态条件
 */
export async function acquireSessionLock(
  sessionId: string,
  userId: string
): Promise<SessionLock | null> {
  // 使用原生 SQL 原子更新：UPDATE ... WHERE status = 'idle' RETURNING *
  const result = await prisma.$queryRaw<
    Array<{ id: string; status: string; userId: string }>
  >`
    UPDATE "AgentSession"
    SET status = 'running', "updatedAt" = NOW()
    WHERE id = ${sessionId}
      AND status = 'idle'
      AND "userId" = ${userId}
    RETURNING id, status, "userId"
  `;

  if (!result || result.length === 0) {
    return null;
  }

  let released = false;
  return {
    release: async () => {
      if (released) return;
      released = true;

      // 重试机制：最多 3 次，间隔 100ms
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await prisma.agentSession.update({
            where: { id: sessionId },
            data: { status: "idle" },
          });
          return;
        } catch (error) {
          if (attempt === 3) {
            console.error(`Failed to release lock for session ${sessionId} after 3 attempts:`, error);
            // 记录错误但不抛出，让清理任务处理
          }
          await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        }
      }
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/session.ts
git commit -m "fix: atomic session lock with retry mechanism"
```

---

### Task F3: 添加 Agent 执行超时

**Files:**
- Modify: `src/lib/agent/executor.ts`

**Context:**
`executor.invoke()` 可能无限期挂起。需要在 LangChain Agent 上添加超时控制。

- [ ] **Step 1: 添加超时包装器**

```typescript
// src/lib/agent/executor.ts

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 带超时的 Agent 执行
 */
export async function runAgentWithTimeout(
  executor: AgentExecutor,
  input: { messages: Array<{ role: string; content: string }> },
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<any> {
  return Promise.race([
    executor.invoke(input),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Agent execution timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * 执行新闻早报任务
 */
export async function runNewsAgent(timeoutMs?: number) {
  const executor = await createNewsAgentExecutor();

  const result = await runAgentWithTimeout(
    executor,
    { messages: [{ role: "user", content: "请生成今日新闻早报并发布到网站" }] },
    timeoutMs
  );

  return result;
}

/**
 * 执行指定任务
 */
export async function runTask(
  taskConfig: {
    prompt: string;
    tools: string[];
    agentType: string;
  },
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  const executor = await createNewsAgentExecutor();

  const result = await runAgentWithTimeout(
    executor,
    { messages: [{ role: "user", content: taskConfig.prompt }] },
    timeoutMs
  );

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent/executor.ts
git commit -m "fix: add timeout mechanism for agent execution"
```

---

### Task F4: 添加 GET /api/agent 认证和 Zod 验证

**Files:**
- Modify: `src/app/api/agent/route.ts`
- Add: `src/lib/validations.ts` (Zod schemas)

**Context:**
当前 GET /api/agent 无认证，任何人都可查看任务配置。需要添加认证和输入验证。

- [ ] **Step 1: 创建 Zod 验证 schemas**

```typescript
// src/lib/validations.ts
import { z } from "zod";

export const TaskCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  agentType: z.enum(["react"]).default("react"),
  triggerType: z.enum(["manual", "cron"]).default("manual"),
  cronExpr: z.string().optional(),
  tools: z.array(z.string()).default([]),
  prompt: z.string().min(1),
  isActive: z.boolean().default(true),
});

export const TaskUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  agentType: z.enum(["react"]).optional(),
  triggerType: z.enum(["manual", "cron"]).optional(),
  cronExpr: z.string().optional(),
  tools: z.array(z.string()).optional(),
  prompt: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const RunTaskSchema = z.object({
  taskId: z.string().min(1),
});

export type TaskCreateInput = z.infer<typeof TaskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof TaskUpdateSchema>;
```

- [ ] **Step 2: 修改 route.ts 添加认证和验证**

```typescript
// src/app/api/agent/route.ts 修改

// GET /api/agent - 列出所有任务（添加认证）
export async function GET() {
  // 添加管理员认证
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tasks });
}

// POST /api/agent - 触发任务执行（已有认证，添加验证）
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { taskId } = RunTaskSchema.parse(body);

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // ... 后续代码保持不变

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    // ...
  }
}

// PUT /api/agent - 创建任务（添加 Zod 验证）
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const validated = TaskCreateSchema.parse(body);

    const task = await prisma.task.create({
      data: validated,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    // ...
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/validations.ts src/app/api/agent/route.ts
git commit -m "fix: add auth to GET /api/agent and Zod validation"
```

---

### Task F5: 修复任务配置流程，支持动态任务执行

**Files:**
- Modify: `src/app/api/agent/route.ts:39-41`
- Modify: `src/app/api/agent/cron/route.ts`

**Context:**
当前 `runNewsAgent()` 硬编码使用 `NEWS_AGENT_PROMPT`。需要让 API 能传递任务配置。

- [ ] **Step 1: 修改 POST /api/agent 传递任务配置**

```typescript
// src/app/api/agent/route.ts POST handler 修改

try {
  // 根据任务类型执行
  if (task.agentType === "react") {
    // 传递任务配置给执行器
    const result = await runTask({
      prompt: task.prompt,
      tools: task.tools as string[],
      agentType: task.agentType,
    });

    await appendSessionMessage(agentSession.id, "assistant", JSON.stringify(result), "admin");

    return NextResponse.json({
      success: true,
      sessionId: agentSession.id,
      result,
    });
  }
  // ...
}
```

- [ ] **Step 2: 修改 cron/route.ts 传递任务配置**

```typescript
// src/app/api/agent/cron/route.ts 修改

try {
  if (task.agentType === "react") {
    const result = await runTask({
      prompt: task.prompt,
      tools: task.tools as string[],
      agentType: task.agentType,
    });
    results.push({ taskId: task.id, status: "success" });
  }
} catch (error) {
  // ...
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/agent/route.ts src/app/api/agent/cron/route.ts src/lib/agent/executor.ts
git commit -m "fix: pass task config to executor for dynamic task execution"
```

---

### Task F6: 修复 MemorySaver 内存问题

**Files:**
- Modify: `src/lib/agent/executor.ts`

**Context:**
MemorySaver 在内存中累积所有检查点。需要添加限制或使用持久化存储。

- [ ] **Step 1: 使用带限制的 MemorySaver**

```typescript
// src/lib/agent/executor.ts 修改
import { MemorySaver } from "@langchain/langgraph/checkpoint.memory";

// 创建带大小限制的检查点保存器
const checkpointer = new MemorySaver({
  maxSize: 100, // 保留最近 100 个检查点
});

export async function createNewsAgentExecutor() {
  const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });

  const agent = createReactAgent({
    llm,
    tools,
    prompt: getSystemPrompt(NEWS_AGENT_PROMPT),
    checkpointSaver: checkpointer, // 使用带限制的 checkpointer
  });

  return new AgentExecutor({ agent, tools });
}
```

**或者**，对于 Vercel 等无状态环境，直接移除 MemorySaver（Agent 变为无状态的每次调用）：

```typescript
// 如果不需要检查点功能
export async function createNewsAgentExecutor() {
  const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });

  const agent = createReactAgent({
    llm,
    tools,
    prompt: getSystemPrompt(NEWS_AGENT_PROMPT),
    // 移除 checkpointSaver 使其无状态
  });

  return new AgentExecutor({ agent, tools });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent/executor.ts
git commit -m "fix: limit MemorySaver size or remove for serverless"
```

---

### Task F7: 修复模型名称不一致

**Files:**
- Modify: `src/lib/langchain/llm.ts`

**Context:**
注释说 GLM-5，代码用 glm-4-flash。需要统一。

- [ ] **Step 1: 检查智谱 API 支持的模型**

智谱 AI API 支持：
- `glm-4-flash` - 快速模型
- `glm-4` - 标准模型
- `glm-5` - 最新模型（如果可用）

根据实际可用的 API 选择合适的模型名称。

- [ ] **Step 2: 更新代码和注释**

```typescript
// src/lib/langchain/llm.ts
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * 创建 GLM 模型 LangChain 实例
 *
 * 支持的模型:
 * - glm-4-flash: 快速低成本
 * - glm-4: 标准模型
 * - glm-5: 最新模型（如果可用）
 */
export function createGLM5(config?: {
  temperature?: number;
  maxTokens?: number;
  model?: string; // 新增：允许指定模型
}): BaseChatModel {
  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) {
    throw new Error("缺少环境变量 BIGMODEL_API_KEY");
  }

  return new ChatOpenAI({
    model: config?.model ?? "glm-4-flash", // 默认使用快速模型
    apiKey,
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    temperature: config?.temperature ?? 0.7,
    maxTokens: config?.maxTokens ?? 2000,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/langchain/llm.ts
git commit -m "fix: unify model naming and add model config option"
```

---

## 验证步骤

### 验证 1: Python spawn 替换

```bash
# 确保 Python 不再被调用
grep -r "spawn.*python" src/lib/agent/
# 应返回空

# 测试搜索功能
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<task-id>"}'
# 应返回成功结果
```

### 验证 2: Session 锁

```bash
# 并发测试
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/agent \
    -H "Content-Type: application/json" \
    -d '{"taskId":"<task-id>"}' &
done
# 只有 1 个成功，其余返回 409
```

### 验证 3: 超时

```bash
# 模拟慢速任务
# 创建超时任务，观察是否在预期时间内返回
```

### 验证 4: 认证

```bash
# 未认证请求
curl http://localhost:3000/api/agent
# 应返回 401
```

### 验证 5: 任务配置

```bash
# 创建自定义任务
curl -X PUT http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"name":"test","agentType":"react","prompt":"say hello","tools":[]}'

# 执行该任务
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<new-task-id>"}'
# 应执行新任务的 prompt，而非硬编码的新闻早报
```

---

## 实施顺序

1. **F1** - Python spawn 替换（阻塞其他 Serverless 测试）
2. **F2** - Session 锁修复（并发安全）
3. **F3** - 超时机制（可靠性）
4. **F4** - 认证 + 验证（安全性）
5. **F5** - 动态任务执行（核心功能）
6. **F6** - MemorySaver 修复（可选，取决于是否需要检查点）
7. **F7** - 模型名称（文档问题，低优先级）

---

## 风险和依赖

- **F1 风险**: 替代库可能与 ddgs 功能不完全一致
- **F2 风险**: $queryRaw 需要 Prisma 支持原生 SQL
- **F5 风险**: 需要确保 task.prompt 可以安全执行
