# 每日新闻早报 Agent 设计方案

## 一、架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                     触发层                                   │
│  ┌─────────────────┐      ┌─────────────────────────────┐  │
│  │   管理员聊天界面   │      │      Vercel Cron            │  │
│  │   (手动触发)      │      │   (每日早间自动触发)        │  │
│  └────────┬────────┘      └────────────┬──────────────┘  │
│           │                              │                 │
│           └──────────┬───────────────────┘                 │
│                      ↓                                    │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              LangChain ReAct Agent (LangGraph)        │  │
│  │                                                         │  │
│  │   State: { messages[], news_results[], final_report } │  │
│  │                                                         │  │
│  │   Nodes:                                               │  │
│  │   - search_news (调用 DuckDuckGo 搜索)                 │  │
│  │   - draft_report (整理新闻为早报)                      │  │
│  │   - publish_content (发布到数据库)                     │  │
│  │   - cleanup_old (删除7天前旧闻)                        │  │
│  │   - done (输出报告)                                    │  │
│  └─────────────────────┬────────────────────────────────┘  │
│                        ↓                                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              LangChain Tools                           │ │
│  │  - duckduckgo_search (via ddgs)                       │ │
│  │  - create_content (直接 Prisma 调用)                   │ │
│  │  - list_content (直接 Prisma 调用)                    │ │
│  │  - delete_content (直接 Prisma 调用)                  │ │
│  └────────────────────────────────────────────────────────┘ │
│                        ↓                                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              执行层 (Next.js + Prisma)                  │ │
│  │  - Prisma → PostgreSQL                                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| Agent 运行时 | LangGraph | ReAct 推理循环 |
| LLM | GLM-5 | 现有智谱 AI 集成 |
| 搜索工具 | ddgs (duckduckgo-search) | Python 包，Node 通过子进程调用 |
| 数据库 | Prisma + PostgreSQL | 直接操作，无需 MCP |
| 定时任务 | Vercel Cron | 每日自动触发 |
| 前端 | 现有 Admin 界面 | 扩展任务面板 |

---

## 三、LangChain Tools 定义

### 3.1 duckduckgo_search

```typescript
import { DynamicTool } from "@langchain/core/tools";
import { z } from "zod";

// Python 子进程调用 ddgs
async function duckduckgoSearch(query: string, freshness: string = "day") {
  const result = await new Promise<string>((resolve, reject) => {
    const { spawn } = require("child_process");
    const python = spawn("python", [
      "-c",
      `
from duckduckgo_search import DDGS
import warnings
warnings.filterwarnings('ignore')
import json
with DDGS() as ddgs:
    results = list(ddgs.text('${query}', max_results=10))
    print(json.dumps(results))
`;
    ]);
    let output = "";
    python.stdout.on("data", (data) => (output += data));
    python.on("close", (code) => resolve(output));
    python.on("error", reject);
  });
  return JSON.parse(result);
}
```

### 3.2 create_content

```typescript
import { tool } from "@langchain/core/tools";
import { prisma } from "@/lib/prisma";

export const createContent = tool(
  async ({ title, body, category, slug, status }) => {
    const content = await prisma.content.create({
      data: { title, body, category, slug, status },
    });
    return content;
  },
  {
    name: "create_content",
    description: "创建新内容并发布到网站",
    schema: z.object({
      title: z.string(),
      body: z.string(),
      category: z.string(),
      slug: z.string().optional(),
      status: z.string(),
    }),
  }
);
```

### 3.3 list_content

```typescript
export const listContent = tool(
  async ({ category, status, limit }) => {
    const contents = await prisma.content.findMany({
      where: { category, status },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    return contents;
  },
  {
    name: "list_content",
    description: "查询内容列表",
    schema: z.object({
      category: z.string(),
      status: z.string(),
      limit: z.number().default(100),
    }),
  }
);
```

### 3.4 delete_content

```typescript
export const deleteContent = tool(
  async ({ id }) => {
    await prisma.chunk.deleteMany({ where: { contentId: id } });
    const result = await prisma.content.delete({ where: { id } });
    return result;
  },
  {
    name: "delete_content",
    description: "删除内容及其关联向量块",
    schema: z.object({ id: z.string() }),
  }
);
```

---

## 四、ReAct Agent 提示词

```markdown
你是一个新闻助手，负责为用户整理有价值的早间资讯。

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
1. 使用 duckduckgo_search 搜索今日各领域新闻（freshness=day）
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
```

---

## 五、工作流程

```
触发 (手动/Cron)
    ↓
┌─ 搜索阶段 ─────────────────────────────────────────┐
│ duckduckgo_search("OpenClaw news today")           │
│ duckduckgo_search("AI breakthrough today")          │
│ duckduckgo_search("AI funding today")               │
│ duckduckgo_search("AI chip news today")             │
│ duckduckgo_search("tech news today")                │
│ duckduckgo_search("major world news today")         │
└────────────────────────────────────────────────────┘
    ↓
┌─ 整理阶段 ─────────────────────────────────────────┐
│ 分析搜索结果，筛选高质量新闻                        │
│ 按格式整理成一篇早报                                │
└────────────────────────────────────────────────────┘
    ↓
┌─ 发布阶段 ─────────────────────────────────────────┐
│ create_content({                                   │
│   title: "【每日新闻早报】YYYY年MM月DD日",        │
│   body: "...",                                     │
│   category: "news",                               │
│   slug: "daily-news-YYYY-MM-DD",                 │
│   status: "published"                             │
│ })                                                 │
└────────────────────────────────────────────────────┘
    ↓
┌─ 清理阶段 ─────────────────────────────────────────┐
│ list_content(category="news", limit=100)           │
│ 计算 createdAt，删除超过7天的记录                    │
│ delete_content(id="xxx")                           │
└────────────────────────────────────────────────────┘
    ↓
输出报告
```

---

## 六、文件结构

```
src/
├── app/
│   ├── admin/
│   │   └── chat/
│   │       └── page.tsx          # 管理员聊天界面 + 任务面板
│   └── api/
│       └── agent/
│           └── news/
│               └── route.ts      # Agent 触发 API
├── lib/
│   ├── agent/
│   │   ├── tools/
│   │   │   ├── duckduckgo.ts    # DuckDuckGo 搜索工具
│   │   │   └── content.ts       # 内容管理工具
│   │   ├── prompts/
│   │   │   └── news_agent.ts    # Agent 提示词
│   │   ├── state.ts             # LangGraph 状态定义
│   │   └── news_agent.ts        # Agent 主逻辑
│   └── langchain/
│       └── init.ts               # LangChain 初始化
└── components/
    └── admin/
        └── TaskPanel.tsx        # 任务面板组件
```

---

## 七、定时任务配置

**vercel.json:**
```json
{
  "crons": [
    {
      "path": "/api/agent/news",
      "schedule": "0 8 * * *"
    }
  ]
}
```

---

## 八、依赖安装

```bash
# Python 包（用于 DuckDuckGo 搜索）
pip install ddgs

# Node.js 包
pnpm add @langchain/langgraph @langchain/langchain-community
```

---

## 九、实施步骤

1. 安装依赖（ddgs + langchain 包）
2. 创建 LangChain Tools（duckduckgo, create_content, list_content, delete_content）
3. 实现 LangGraph ReAct Agent 状态机和节点
4. 设计 Agent 提示词
5. 创建 `/api/agent/news` API 路由
6. 实现管理员界面任务面板
7. 配置 Vercel Cron
8. 测试完整流程
