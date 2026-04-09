# Agent 框架实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个轻量级的 LangChain Agent 框架，支持 Session 隔离模型，可配置多种任务（新闻早报等）

**Architecture:** 基于 LangGraph 实现 ReAct Agent，Session 数据存储在 PostgreSQL，工具层包括 ddgs 搜索和 Prisma 操作，触发方式支持手动和 Cron

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, LangGraph, GLM-5, ddgs (DuckDuckGo)

---

## 一、文件结构

```
src/
├── app/
│   └── api/
│       └── agent/
│           ├── route.ts              # Agent 触发 API
│           └── [taskId]/
│               └── route.ts          # 任务执行 API
├── lib/
│   ├── agent/
│   │   ├── schema.prisma            # Agent Session + Task 表
│   │   ├── session.ts               # Session 管理（创建/锁/状态）
│   │   ├── tools/
│   │   │   ├── duckduckgo.ts        # 搜索工具
│   │   │   └── content.ts           # 内容管理工具
│   │   ├── prompts/
│   │   │   └── react_agent.ts       # ReAct Agent 提示词
│   │   ├── state.ts                 # LangGraph 状态定义
│   │   └── executor.ts              # Agent 执行器
│   └── langchain/
│       └── llm.ts                   # GLM-5 LangChain 集成
└── components/
    └── admin/
        └── TaskPanel.tsx            # 任务面板组件
```

---

## 二、数据库扩展

### Task 2.1: 扩展 Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma:1-129`

- [ ] **Step 1: 添加 AgentSession 和 Task 模型到 schema**

```prisma
model AgentSession {
  id          String   @id @default(cuid())
  sessionKey  String   @unique
  agentId     String
  status      String   @default("idle")
  messages    Json     @default("[]")
  metadata    Json     @default("{}")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([agentId])
  @@index([status])
}

model Task {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  agentType   String   @default("react")
  triggerType String   @default("manual")
  cronExpr    String?
  tools       Json     @default("[]")
  prompt      String
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([triggerType])
  @@index([isActive])
}
```

- [ ] **Step 2: 运行 Prisma migrate**

Run: `cd /d/project/KnowledgeRag/knowledge-rag && npx prisma migrate dev --name add_agent_session_task`
Expected: Migration created successfully

- [ ] **Step 3: 验证生成 Prisma Client**

Run: `npx prisma generate`
Expected: Generated PrismaClient

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add AgentSession and Task models for agent framework"
```

---

### Task 2.2: 创建 Session 管理模块

**Files:**
- Create: `src/lib/agent/session.ts`

- [ ] **Step 1: 创建 Session 管理模块**

```typescript
import { prisma } from "@/lib/prisma";

export interface SessionLock {
  release: () => Promise<void>;
}

const LOCK_TIMEOUT = 10000; // 10秒

/**
 * 获取或创建 Session
 */
export async function getOrCreateSession(sessionKey: string, agentId: string) {
  const existing = await prisma.agentSession.findUnique({
    where: { sessionKey },
  });

  if (existing) {
    return existing;
  }

  return prisma.agentSession.create({
    data: {
      sessionKey,
      agentId,
      status: "idle",
      messages: [],
      metadata: {},
    },
  });
}

/**
 * 尝试获取 Session 写锁
 */
export async function acquireSessionLock(sessionId: string): Promise<SessionLock | null> {
  const session = await prisma.agentSession.update({
    where: { id: sessionId },
    data: { status: "running" },
  });

  if (!session) return null;

  return {
    release: async () => {
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: { status: "idle" },
      });
    },
  };
}

/**
 * 更新 Session 消息
 */
export async function appendSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string
) {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) return;

  const messages = (session.messages as any[]) || [];
  messages.push({ role, content, timestamp: Date.now() });

  await prisma.agentSession.update({
    where: { id: sessionId },
    data: { messages },
  });
}

/**
 * 清理过期 Session（超过 1 小时的 running 状态）
 */
export async function cleanupStaleSessions() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  await prisma.agentSession.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: oneHourAgo },
    },
    data: { status: "idle" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent/session.ts
git commit -m "feat: add session management module"
```

---

### Task 2.3: 创建 GLM-5 LangChain 集成

**Files:**
- Create: `src/lib/langchain/llm.ts`

- [ ] **Step 1: 创建 GLM-5 LangChain 集成**

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * 创建 GLM-5 LangChain 实例
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
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    temperature: config?.temperature ?? 0.7,
    maxTokens: config?.maxTokens ?? 2000,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/langchain/llm.ts
git commit -m "feat: add GLM-5 LangChain integration"
```

---

### Task 2.4: 创建 LangChain Tools

**Files:**
- Create: `src/lib/agent/tools/duckduckgo.ts`
- Create: `src/lib/agent/tools/content.ts`

- [ ] **Step 1: 创建 DuckDuckGo 搜索工具**

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

interface DuckDuckGoResult {
  title: string;
  href: string;
  body: string;
}

/**
 * 使用 Python ddgs 进行搜索
 */
async function searchWithDDGS(query: string, maxResults: number = 10): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process");
    const python = spawn("python", [
      "-c",
      `
import sys
import warnings
warnings.filterwarnings('ignore')
try:
    from duckduckgo_search import DDGS
    import json
    with DDGS() as ddgs:
        results = list(ddgs.text('${query.replace(/'/g, "\\'")}', max_results=${maxResults}))
        print(json.dumps(results, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
`,
    ]);

    let output = "";
    python.stdout.on("data", (data: Buffer) => (output += data.toString()));
    python.on("close", (code: number) => {
      if (code !== 0) {
        reject(new Error(`DDGS search failed with code ${code}`));
      } else {
        resolve(output);
      }
    });
    python.on("error", reject);
  });
}

export const duckduckgoSearch = tool(
  async ({ query, freshness, maxResults = 10 }: { query: string; freshness?: string; maxResults?: number }) => {
    const results: DuckDuckGoResult[] = JSON.parse(await searchWithDDGS(query, maxResults));

    if (Array.isArray(results) && results.length === 0) {
      return "未找到相关结果";
    }

    if (results.error) {
      return `搜索出错: ${results.error}`;
    }

    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.href}\n${r.body}`)
      .join("\n\n");
  },
  {
    name: "duckduckgo_search",
    description: "使用 DuckDuckGo 搜索互联网信息。输入搜索关键词，返回搜索结果列表。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      freshness: z.string().optional().describe("时间过滤: day, week, month"),
      maxResults: z.number().optional().describe("最大结果数，默认 10"),
    }),
  }
);
```

- [ ] **Step 2: 创建内容管理工具**

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const createContent = tool(
  async ({
    title,
    body,
    category,
    slug,
    status = "published",
  }: {
    title: string;
    body: string;
    category: string;
    slug?: string;
    status?: string;
  }) => {
    // 生成 slug
    let finalSlug = slug || title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");

    // 检查唯一性
    const existing = await prisma.content.findUnique({ where: { slug: finalSlug } });
    if (existing) {
      finalSlug = `${finalSlug}-${Date.now()}`;
    }

    const content = await prisma.content.create({
      data: {
        title,
        body,
        category,
        slug: finalSlug,
        status,
      },
    });

    return content;
  },
  {
    name: "create_content",
    description: "创建新内容并发布到网站",
    schema: z.object({
      title: z.string().describe("内容标题"),
      body: z.string().describe("内容正文（Markdown 格式）"),
      category: z.string().describe("分类：news, article, note, page 等"),
      slug: z.string().optional().describe("URL slug，可选"),
      status: z.string().optional().describe("状态：draft 或 published"),
    }),
  }
);

export const listContent = tool(
  async ({
    category,
    status,
    limit = 100,
  }: {
    category: string;
    status?: string;
    limit?: number;
  }) => {
    const contents = await prisma.content.findMany({
      where: {
        category,
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return JSON.stringify(contents);
  },
  {
    name: "list_content",
    description: "查询内容列表",
    schema: z.object({
      category: z.string().describe("内容分类"),
      status: z.string().optional().describe("状态过滤"),
      limit: z.number().optional().describe("返回数量，默认 100"),
    }),
  }
);

export const deleteContent = tool(
  async ({ id }: { id: string }) => {
    // 先删除关联的 chunks
    await prisma.chunk.deleteMany({ where: { contentId: id } });

    const result = await prisma.content.delete({ where: { id } });
    return result;
  },
  {
    name: "delete_content",
    description: "删除内容及其关联向量块",
    schema: z.object({
      id: z.string().describe("内容 ID"),
    }),
  }
);
```

- [ ] **Step 3: 创建工具导出文件**

```typescript
// src/lib/agent/tools/index.ts
export { duckduckgoSearch } from "./duckduckgo";
export { createContent, listContent, deleteContent } from "./content";
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/tools/
git commit -m "feat: add LangChain tools (duckduckgo, content management)"
```

---

### Task 2.5: 创建 ReAct Agent 提示词和状态

**Files:**
- Create: `src/lib/agent/prompts/react_agent.ts`
- Create: `src/lib/agent/state.ts`

- [ ] **Step 1: 创建 ReAct Agent 提示词**

```typescript
export const NEWS_AGENT_PROMPT = `你是一个新闻助手，负责为用户整理有价值的早间资讯。

核心原则：
- 只保留真正有价值的新闻，宁缺毋滥
- 每条新闻要有深度：背景、原因、影响、意义都要有
- 只收集【今日】发布的新闻，禁止使用过时的新闻

重点领域（按优先级排序）：
1. AI领域：OpenClaw生态最新动态、新插件、新技巧
2. AI行业：重大技术突破、融资动态、重要发布
3. 科技：芯片、算法、应用层面的重大进展
4. 全球政治：影响重大的国际事件

工作流程：
1. 使用 duckduckgo_search 搜索今日各领域新闻
2. 筛选高质量、有价值的新闻（至少3条，最多10条）
3. 整理成格式化早报
4. 调用 create_content 发布
5. 调用 list_content 查看现有新闻
6. 删除 createdAt 超过7天的旧新闻
7. 输出执行报告

输出格式：
标题：【每日新闻早报】YYYY年MM月DD日

---
## 【领域】新闻标题
发布时间：xxxx年xx月xx日

**背景/要点/影响：**
深度解读

来源：https://...
---
`;

export const getSystemPrompt = (taskPrompt: string) => `
你是一个 AI 助手，负责执行任务。

当前任务说明：
${taskPrompt}

可用工具：
- duckduckgo_search: 搜索互联网新闻
- create_content: 创建网站内容
- list_content: 查询网站内容列表
- delete_content: 删除网站内容

请根据任务要求，调用合适的工具来完成任务。
`;
```

- [ ] **Step 2: 创建 LangGraph 状态定义**

```typescript
import { BaseMessage } from "@langchain/core/messages";

export interface NewsAgentState {
  messages: BaseMessage[];
  newsResults: string[];
  draftedReport: string | null;
  publishedContentId: string | null;
  cleanedUpIds: string[];
  finalReport: string | null;
  error: string | null;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/prompts/ src/lib/agent/state.ts
git commit -m "feat: add agent prompts and state definitions"
```

---

### Task 2.6: 创建 Agent 执行器

**Files:**
- Create: `src/lib/agent/executor.ts`

- [ ] **Step 1: 创建 Agent 执行器**

```typescript
import { createGLM5 } from "@/lib/langchain/llm";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "./tools";
import { getSystemPrompt, NEWS_AGENT_PROMPT } from "./prompts/react_agent";
import { AgentExecutor, createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph/checkpoint.memory";

const tools = [duckduckgoSearch, createContent, listContent, deleteContent];

/**
 * 创建新闻 Agent 执行器
 */
export async function createNewsAgentExecutor() {
  const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });

  const agent = createReactAgent({
    llm,
    tools,
    prompt: getSystemPrompt(NEWS_AGENT_PROMPT),
    checkpointSaver: new MemorySaver(),
  });

  return new AgentExecutor({ agent, tools });
}

/**
 * 执行新闻早报任务
 */
export async function runNewsAgent() {
  const executor = await createNewsAgentExecutor();

  const result = await executor.invoke({
    messages: [{ role: "user", content: "请生成今日新闻早报并发布到网站" }],
  });

  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agent/executor.ts
git commit -m "feat: add agent executor"
```

---

### Task 2.7: 创建 Agent API 路由

**Files:**
- Create: `src/app/api/agent/route.ts`
- Create: `src/app/api/agent/[taskId]/route.ts`

- [ ] **Step 1: 创建 Agent 触发 API**

```typescript
// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runNewsAgent } from "@/lib/agent/executor";
import { getOrCreateSession, acquireSessionLock, appendSessionMessage } from "@/lib/agent/session";

export async function POST(req: Request) {
  // 管理员验证
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taskId } = await req.json();

    // 获取任务配置
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // 创建或获取 Session
    const agentSession = await getOrCreateSession(
      `agent:main:manual:${taskId}`,
      task.agentType
    );

    // 尝试获取锁
    const lock = await acquireSessionLock(agentSession.id);
    if (!lock) {
      return NextResponse.json({ error: "Agent is busy" }, { status: 409 });
    }

    try {
      // 根据任务类型执行
      if (task.agentType === "react") {
        const result = await runNewsAgent();

        await appendSessionMessage(agentSession.id, "assistant", JSON.stringify(result));

        return NextResponse.json({
          success: true,
          sessionId: agentSession.id,
          result,
        });
      }

      return NextResponse.json({ error: "Unsupported agent type" }, { status: 400 });
    } finally {
      await lock.release();
    }
  } catch (error) {
    console.error("Agent execution failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent execution failed" },
      { status: 500 }
    );
  }
}

// GET /api/agent - 列出所有任务
export async function GET() {
  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tasks });
}
```

- [ ] **Step 2: 创建任务管理 API**

```typescript
// src/app/api/agent/[taskId]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

// GET /api/agent/[taskId] - 获取任务详情
export async function GET(req: Request, { params }: RouteParams) {
  const { taskId } = await params;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}

// PUT /api/agent/[taskId] - 更新任务
export async function PUT(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = await req.json();

  const task = await prisma.task.update({
    where: { id: taskId },
    data: body,
  });

  return NextResponse.json({ task });
}

// DELETE /api/agent/[taskId] - 删除任务
export async function DELETE(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  await prisma.task.delete({ where: { id: taskId } });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: 创建任务创建 API**

```typescript
// src/app/api/agent/route.ts 添加 POST /tasks 端点
// 在现有的 POST handler 之后添加

// POST /api/agent/tasks - 创建新任务
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const task = await prisma.task.create({
    data: {
      name: body.name,
      description: body.description,
      agentType: body.agentType || "react",
      triggerType: body.triggerType || "manual",
      cronExpr: body.cronExpr,
      tools: body.tools || [],
      prompt: body.prompt,
      isActive: body.isActive ?? true,
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/
git commit -m "feat: add agent API routes"
```

---

### Task 2.8: 创建 Cron 触发 API

**Files:**
- Create: `src/app/api/agent/cron/route.ts`

- [ ] **Step 1: 创建 Cron 触发 API**

```typescript
// src/app/api/agent/cron/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runNewsAgent } from "@/lib/agent/executor";
import { getOrCreateSession, acquireSessionLock } from "@/lib/agent/session";

// Vercel Cron 触发此端点
export async function GET(req: Request) {
  // 验证 Cron secret（可选）
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 获取所有 active 的 cron 任务
    const cronTasks = await prisma.task.findMany({
      where: {
        triggerType: "cron",
        isActive: true,
        cronExpr: { not: null },
      },
    });

    const results = [];

    for (const task of cronTasks) {
      // 创建 isolated session
      const sessionKey = `agent:main:cron:${task.name}-${Date.now()}`;
      const agentSession = await getOrCreateSession(sessionKey, task.agentType);

      // 尝试获取锁
      const lock = await acquireSessionLock(agentSession.id);
      if (!lock) {
        results.push({ taskId: task.id, status: "skipped", reason: "Agent is busy" });
        continue;
      }

      try {
        if (task.agentType === "react") {
          await runNewsAgent();
          results.push({ taskId: task.id, status: "success" });
        }
      } catch (error) {
        results.push({
          taskId: task.id,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        await lock.release();
      }
    }

    return NextResponse.json({
      executed: results.length,
      results,
    });
  } catch (error) {
    console.error("Cron execution failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron execution failed" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: 添加 Cron 配置到 vercel.json**

```bash
# 检查 vercel.json 是否存在
cat /d/project/KnowledgeRag/knowledge-rag/vercel.json 2>/dev/null || echo "NOT_FOUND"
```

- [ ] **Step 3: 如果 vercel.json 不存在则创建**

```json
{
  "crons": [
    {
      "path": "/api/agent/cron",
      "schedule": "0 8 * * *"
    }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/agent/cron/route.ts
# 如果 vercel.json 不存在则添加
git commit -m "feat: add cron trigger API for agent tasks"
```

---

### Task 2.9: 创建任务面板组件

**Files:**
- Create: `src/components/admin/TaskPanel.tsx`

- [ ] **Step 1: 创建任务面板组件**

```typescript
"use client";

import { useState, useEffect } from "react";

interface Task {
  id: string;
  name: string;
  description: string | null;
  agentType: string;
  triggerType: string;
  cronExpr: string | null;
  isActive: boolean;
  createdAt: string;
}

interface TaskPanelProps {
  onTaskSelect?: (taskId: string) => void;
}

export default function TaskPanel({ onTaskSelect }: TaskPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningTasks, setRunningTasks] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // 获取任务列表
  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/agent");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setError("Failed to fetch tasks");
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // 触发任务执行
  const runTask = async (taskId: string) => {
    setLoading(true);
    setRunningTasks((prev) => new Set(prev).add(taskId));
    setError(null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to run task");
      }

      const result = await res.json();
      alert(`任务执行完成: ${JSON.stringify(result.result, null, 2)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Task execution failed");
    } finally {
      setLoading(false);
      setRunningTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  // 切换任务激活状态
  const toggleTask = async (taskId: string, isActive: boolean) => {
    try {
      await fetch(`/api/agent/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      fetchTasks();
    } catch (err) {
      setError("Failed to update task");
    }
  };

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">任务面板</h3>
        <button
          onClick={fetchTasks}
          className="text-sm text-[var(--text-2)] hover:text-[var(--text-1)]"
        >
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-500 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {tasks.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-2)]">
            <p>暂无任务</p>
            <p className="text-sm mt-1">数据库中将自动创建一个示例新闻早报任务</p>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className="bg-[var(--bg)] rounded-lg p-4 border border-[var(--border)]"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{task.name}</h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        task.isActive
                          ? "bg-green-500/20 text-green-500"
                          : "bg-gray-500/20 text-gray-500"
                      }`}
                    >
                      {task.isActive ? "激活" : "禁用"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-500">
                      {task.triggerType}
                    </span>
                  </div>
                  {task.description && (
                    <p className="text-sm text-[var(--text-2)] mt-1">
                      {task.description}
                    </p>
                  )}
                  {task.cronExpr && (
                    <p className="text-xs text-[var(--text-2)] mt-1">
                      Cron: {task.cronExpr}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleTask(task.id, !task.isActive)}
                    className="text-xs px-3 py-1 rounded border border-[var(--border)] hover:bg-[var(--hover)]"
                  >
                    {task.isActive ? "禁用" : "激活"}
                  </button>
                  <button
                    onClick={() => runTask(task.id)}
                    disabled={loading || runningTasks.has(task.id)}
                    className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
                  >
                    {runningTasks.has(task.id) ? "运行中..." : "执行"}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 快速创建示例任务 */}
      {tasks.length === 0 && (
        <button
          onClick={async () => {
            try {
              await fetch("/api/agent", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: "daily-news",
                  description: "每日新闻早报",
                  agentType: "react",
                  triggerType: "manual",
                  prompt:
                    "你是一个新闻助手，请搜索今日新闻并整理成早报发布到网站",
                  tools: ["duckduckgo_search", "create_content", "list_content", "delete_content"],
                }),
              });
              fetchTasks();
            } catch (err) {
              setError("Failed to create task");
            }
          }}
          className="mt-4 w-full py-2 rounded bg-blue-500 text-white hover:bg-blue-600"
        >
          创建示例新闻任务
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/admin/TaskPanel.tsx
git commit -m "feat: add TaskPanel component for admin interface"
```

---

### Task 2.10: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 LangChain 依赖**

Run: `cd /d/project/KnowledgeRag/knowledge-rag && pnpm add @langchain/langgraph @langchain/langgraph-checkpoint @langchain/langchain-prebuilt`
Expected: Packages installed successfully

- [ ] **Step 2: 安装 zod（如果未安装）**

Run: `cd /d/project/KnowledgeRag/knowledge-rag && pnpm add zod`
Expected: Already satisfied or installed

- [ ] **Step 3: 验证 Python ddgs 可用**

Run: `python -c "from duckduckgo_search import DDGS; print('ddgs OK')"`
Expected: ddgs OK

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add langchain dependencies"
```

---

## 三、验证步骤

### 验证 1: 数据库迁移

Run: `cd /d/project/KnowledgeRag/knowledge-rag && npx prisma migrate dev --name add_agent_session_task`
Expected: Migration created and applied

### 验证 2: 启动开发服务器

Run: `cd /d/project/KnowledgeRag/knowledge-rag && npm run dev`
Expected: Server starts without errors

### 验证 3: 测试 API

```bash
# 创建示例任务
curl -X PUT http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"name":"test-task","description":"测试任务","agentType":"react","prompt":"测试","tools":[]}'

# 列出任务
curl http://localhost:3000/api/agent

# 执行任务
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"taskId":"<task-id>"}'
```

---

## 四、后续扩展

1. **父子 Agent 支持** — 主 Session 创建子 Session，通过 sessionKey 关联
2. **任务队列** — 将任务加入队列，后台执行
3. **执行日志** — 记录每次任务的详细执行过程
4. **Webhooks** — 支持外部触发任务
