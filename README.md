# Knowledge RAG

基于 Next.js 的全栈知识库问答系统，集成 RAG（Retrieval-Augmented Generation）架构与 AI Agent 框架。支持上传文档构建知识库，通过向量检索与大语言模型进行精准问答，并支持点击引用直接跳转到原文出处。

## 系统架构

```
┌──────────────────┐     ┌─────────────────────┐     ┌───────────────────────┐
│   Client (浏览器)  │     │   Next.js Server     │     │     External Services  │
├──────────────────┤     ├─────────────────────┤     ├───────────────────────┤
│                  │     │                     │     │                       │
│ 1. 用户认证       │────>│  NextAuth (Auth)    │────>│  PostgreSQL           │
│ 2. 文档上传       │────>│  Upload API         │────>│  Local / Aliyun OSS   │
│ 3. 知识库管理     │────>│  Prisma (ORM)       │────>│  智谱 AI (Embedding-3)│
│ 4. 索引构建       │────>│  Indexing Worker    │     │  智谱 AI (GLM-5)     │
│ 5. RAG 问答      │────>│  Chat API + Retrieve │     │  pgvector             │
│ 6. 引用溯源       │     │  Citation Evaluator │     │  Tavily Search        │
│ 7. Agent 对话     │────>│  Agent Framework    │     │                       │
│ 8. 内容管理       │────>│  Content CRUD       │     │                       │
└──────────────────┘     └─────────────────────┘     └───────────────────────┘
```

## 功能概览

### RAG 知识库问答

- **文档管理**：支持上传 PDF，自动按页解析和智能分块
- **向量化索引**：使用智谱 Embedding-3（256 维）进行文本向量化，存储至 pgvector
- **手动索引控制**：上传后手动触发索引，避免意外 Token 消耗，支持失败重试
- **智能检索**：多查询检索 + RRF（Reciprocal Rank Fusion）重排序
- **流式问答**：基于 SSE 的实时流式回答，支持多轮对话与上下文压缩
- **精准引用溯源**：回答附带引用标记，点击可跳转至原文对应位置（支持 PDF 页码和文章锚点）
- **引用质量评估**：自动评估引用的准确性和相关性

### AI Agent 系统

- **ReAct Agent 框架**：基于 LangGraph 的推理-行动循环，支持工具调用
- **多模型支持**：支持 GLM、OpenAI、DeepSeek 等 OpenAI-compatible 模型切换
- **可扩展工具集**：内置工具注册表，支持 DuckDuckGo 搜索、Tavily 搜索、内容管理、URL 抓取等
- **技能系统**：动态技能加载与管理，内置 brainstorming 技能，支持技能市场
- **定时任务**：Cron 调度器，支持周期性和一次性定时执行
- **会话持久化**：Agent 对话历史持久存储，支持长对话 Token 预算管理；历史对话注入 system prompt 上下文而非消息流，避免模型续写历史输出
- **记忆系统**：Agent 上下文记忆，跨会话信息保持
- **防死循环机制**：循环检测守卫、资源限制、重试退避策略

### 内容管理系统

- **文章/页面管理**：支持分类、草稿/发布状态、Markdown/富文本编辑（TipTap）
- **图片管理**：图片上传，支持阿里云 OSS 存储
- **站点配置**：动态站点配置项管理
- **使用统计**：API 调用次数、Token 用量、响应延迟等数据看板

### 用户认证

- **邮箱密码登录**：基于 NextAuth.js Credentials Provider
- **会话管理**：JWT 策略，安全可靠
- **单管理员模式**：通过 `ADMIN_EMAIL` 环境变量指定管理员

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端框架** | Next.js 16.1.6 (App Router), React 19, TypeScript |
| **样式** | Tailwind CSS v4, Motion (动画) |
| **后端** | Next.js API Routes / Route Handlers |
| **数据库** | PostgreSQL + pgvector |
| **ORM** | Prisma 7.4.2 |
| **认证** | NextAuth.js v4 |
| **AI 框架** | LangChain + LangGraph |
| **大语言模型** | 智谱 AI GLM-5（可切换 OpenAI-compatible 模型） |
| **向量模型** | 智谱 Embedding-3（256 维） |
| **搜索** | Tavily, DuckDuckGo |
| **富文本** | TipTap |
| **图表** | ECharts |
| **存储** | 本地 / 阿里云 OSS |
| **测试** | Vitest |
| **部署** | Vercel / Docker Compose |

## 项目结构

```
knowledge-rag/
├── prisma/
│   ├── schema.prisma          # 数据模型定义
│   └── config.ts              # Prisma 配置
├── src/
│   ├── app/
│   │   ├── (auth)/login/      # 登录页
│   │   ├── [category]/        # 内容分类页 & 文章详情页
│   │   ├── admin/
│   │   │   ├── chat/          # Agent 聊天管理
│   │   │   └── stats/         # 使用统计看板
│   │   └── api/
│   │       ├── auth/          # 认证接口
│   │       ├── chat/          # RAG 对话接口（v1/v2）
│   │       ├── content/       # 内容 CRUD 接口
│   │       ├── agent/
│   │       │   ├── stream/    # Agent SSE 流式接口
│   │       │   ├── cron/      # 定时任务接口
│   │       │   ├── schedule/  # 任务调度接口
│   │       │   ├── skills/    # 技能市场接口
│   │       │   └── [taskId]/  # 任务管理接口
│   │       ├── retrieve/      # 向量检索接口
│   │       ├── upload/        # 文件上传接口
│   │       ├── stats/         # 统计数据接口
│   │       └── mcp/           # MCP 协议接口
│   ├── components/
│   │   ├── chat/              # 聊天相关组件
│   │   ├── admin/             # 管理后台组件
│   │   └── home/              # 首页展示组件
│   └── lib/
│       ├── agent/             # Agent 框架核心
│       │   ├── executor.ts    # 任务执行引擎
│       │   ├── memory.ts      # 记忆系统
│       │   ├── skillRouter.ts # 技能路由
│       │   ├── tools/         # 工具集（搜索、内容、URL 等）
│       │   ├── guard/         # 安全守卫（防死循环、资源限制）
│       │   ├── skills/        # 技能系统
│       │   ├── cron/          # 定时任务调度
│       │   ├── stream/        # SSE 流式处理
│       │   └── prompts/       # Agent 提示词模板
│       ├── langchain/         # LangChain 集成（LLM 配置等）
│       ├── agent-chat/        # Agent 对话管理
│       ├── glm.ts             # 智谱 AI GLM API 封装
│       ├── embedding.ts       # 向量化 API 封装
│       ├── citation-evaluator.ts  # 引用质量评估
│       └── oss.ts             # 阿里云 OSS 封装
├── docker-compose.yml
├── .env.example
└── vercel.json
```

## 快速开始

### 环境要求

- Node.js 18+
- pnpm
- PostgreSQL（带 pgvector 扩展）或 Docker Desktop

### 安装与运行

```bash
# 1. 克隆项目
git clone https://github.com/yechayo/knowledge-rag.git
cd knowledge-rag

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 DATABASE_URL、BIGMODEL_API_KEY 等

# 4. 启动数据库（Docker）
docker-compose up -d db

# 5. 数据库迁移
npx prisma migrate dev --name init

# 6. 启动开发服务器
npm run dev
```

访问 http://localhost:3000 即可使用。

### 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接字符串 |
| `NEXTAUTH_SECRET` | 是 | NextAuth 密钥（`openssl rand -base64 32`） |
| `NEXTAUTH_URL` | 是 | 站点 URL |
| `BIGMODEL_API_KEY` | 是 | 智谱 AI API Key |
| `EMBEDDING_DIMENSIONS` | 否 | 向量维度，默认 256 |
| `ADMIN_EMAIL` | 是 | 管理员邮箱 |
| `TAVILY_API_KEY` | 否 | Tavily 搜索 API Key |
| `MCP_API_KEY` | 否 | MCP 协议密钥 |
| `AGENT_MODEL_NAME` | 否 | Agent 专用模型名称 |
| `AGENT_API_KEY` | 否 | Agent 专用 API Key |
| `AGENT_BASE_URL` | 否 | Agent 模型 API 地址 |
| `ALIYUN_OSS_*` | 否 | 阿里云 OSS 配置（启用后使用 OSS 存储） |

## 数据模型

| 模型 | 说明 |
|------|------|
| `Admin` | 管理员账户 |
| `Content` | 文章/页面（标题、正文、分类、状态） |
| `Chunk` | 文档分块（含 pgvector 向量、标题锚点、分类标签） |
| `Image` | 图片资源 |
| `SiteConfig` | 站点配置项 |
| `UsageLog` | API 使用日志（Token 用量、延迟等） |
| `AgentSession` | Agent 会话（消息历史、Token 统计） |
| `Task` | Agent 任务（手动/定时，Cron 表达式） |
| `AgentMemory` | Agent 记忆（上下文保持） |
| `SkillMarket` | 技能市场条目 |
| `InstalledSkill` | 已安装技能 |
| `SkillInstallRequest` | 技能安装申请 |

## API 接口

### 认证
- `POST /api/auth/[...nextauth]` — 登录/登出

### RAG 对话
- `POST /api/chat` — RAG 流式问答（多查询检索 + RRF 重排序）
- `POST /api/chat/v2` — V2 对话（支持 Thinking 模式）
- `POST /api/retrieve` — 向量相似度检索

### Agent
- `GET /api/agent` — 获取任务列表
- `POST /api/agent` — 执行任务
- `POST /api/agent/stream` — Agent 流式执行
- `GET /api/agent/[taskId]` — 获取任务详情
- `POST /api/agent/cron` — 定时任务管理
- `POST /api/agent/schedule` — 任务调度

### 技能系统
- `GET /api/agent/skills` — 技能列表
- `GET /api/agent/skills/market` — 技能市场
- `GET /api/agent/skills/installed` — 已安装技能
- `POST /api/agent/skills/requests` — 安装申请

### 内容管理
- `GET/POST /api/content` — 内容列表/创建
- `PATCH/DELETE /api/content/[id]` — 更新/删除
- `POST /api/content/[id]/publish` — 发布
- `POST /api/upload` — 文件上传

### 其他
- `GET /api/stats` — 使用统计
- `GET /api/config` — 站点配置
- `POST /api/reindex` — 重建索引
- `POST /api/mcp` — MCP 协议代理

## 部署

### Vercel（推荐）

项目已配置 `vercel.json`，直接连接 GitHub 仓库即可自动部署。需要在 Vercel 环境变量中配置所有必要的环境变量。

### Docker Compose

```bash
# 启动数据库
docker-compose up -d db

# 本地运行应用
npm run build && npm start
```

## 设计决策

### 为什么用 256 维 Embedding？

智谱 Embedding-3 支持维度裁剪。256 维在保留大部分语义精度的同时，减少约 75% 的存储空间和索引大小，显著提高检索速度，非常适合中小型知识库场景。

### 为什么采用手动索引？

上传文件不等于立即需要索引。手动触发让用户明确意图，避免上传错误文件时意外消耗 API Token，同时支持对失败任务进行针对性重试。

### 为什么用 pgvector 而非独立向量数据库？

一体化架构降低维护成本。pgvector 支持关系 + 向量混合查询，可以用 SQL 的 `WHERE` 做权限过滤后再做向量搜索，数据一致性更有保障。

### 为什么 Agent 支持多模型切换？

不同场景适合不同模型——GLM 系列性价比高适合日常任务，GPT-4o 等模型在复杂推理场景表现更好。通过环境变量即可切换，无需修改代码。

## License

MIT
