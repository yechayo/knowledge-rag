# Agent 交互界面设计文档

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 admin chat 页面从纯任务管理界面升级为 OpenClaw 风格的交互式 Agent 对话界面，支持流式输出、Agent 自主创建/管理任务、实时任务同步。

**架构：** 端到端 SSE 流式架构。新的 `/api/agent/stream` 端点直接流式输出 Agent 的思考过程、工具调用和回答。前端通过 Fetch + ReadableStream 消费 SSE，实时渲染消息气泡，工具调用以内联展开块形式呈现在消息内。当 Agent 执行工具修改任务时，通过 SSE `task_update` 事件实时同步任务列表。

**技术栈：** Next.js 16 App Router, TypeScript, Tailwind CSS, Prisma, SSE (Server-Sent Events), LangGraph ReAct Agent

---

## 1. 整体布局

```
┌──────────────────────────────────────────────────────────┐
│  Admin Agent                            [+ 新会话] [⚙]   │
│  ┌─────┬──────────────────────────────────────────────┐ │
│  │ 💬  │                                              │ │
│  │ 对话 │     消息流区域（流式输出）                    │ │
│  ├─────┤                                              │ │
│  │ 📋  │  [用户消息气泡]                              │ │
│  │ 任务 │                                              │ │
│  └─────┤  [Agent 回复气泡]                            │ │
│        │    └─ 内联工具调用展开块                      │ │
│        │                                              │ │
│        │  [用户消息气泡]                              │ │
│        │                                              │ │
│        │                              ┌─────────────┐ │ │
│        │                              │ 输入框  ➤  │ │ │
│        │                              └─────────────┘ │ │
│        └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 页面路由
- `src/app/admin/chat/page.tsx` 改造为 Tab 容器，包含对话和任务两个视图

### 左侧 Tab 栏
- 两个 Tab：**对话** (💬) 和 **任务** (📋)
- Tab 栏位于左侧垂直排列，宽度约 60px
- 切换 Tab 时保持对话上下文
- 顶部显示 "Admin Agent" 标题
- 右上角「新会话」按钮清空当前对话
- 右上角「设置」图标（预留，暂不实现）

---

## 2. 流式 API 设计

### 端点: `POST /api/agent/stream`

**请求头：** `Content-Type: application/json`

**请求体：**
```typescript
{
  message: string;        // 用户输入的消息
  sessionKey?: string;    // 可选，指定会话 key，不传则创建新会话
}
```

**响应：** `text/event-stream` (SSE)

### SSE 事件格式

所有事件均为 JSON 格式，通过 `data:` 行发送：

#### 2.1 `init` 事件 — 初始化
```json
{"type":"init","sessionKey":"sess_xxx","sessionId":"cuid_xxx"}
```
初始化时发送一次，包含 sessionKey 和 sessionId。前端用 sessionKey 标识当前会话。

#### 2.2 `delta` 事件 — 消息增量（流式文字）
```json
{"type":"delta","content":"正在搜索..."}
{"type":"delta","content":"已找到 5 条新闻"}
```
Agent 的文字回复增量输出。前端累加到当前消息的 content 中。

#### 2.3 `tool_start` 事件 — 工具开始调用
```json
{"type":"tool_start","name":"duckduckgoSearch","input":{"query":"今日新闻","maxResults":5}}
```
前端在消息气泡内渲染一个展开的工具调用块。

#### 2.4 `tool_end` 事件 — 工具调用完成
```json
{"type":"tool_end","name":"duckduckgoSearch","result":"搜索到 5 条结果...","success":true}
```
更新对应工具调用块的状态（显示结果）。

#### 2.5 `task_update` 事件 — 任务数据变更
```json
{"type":"task_update","action":"created","task":{"id":"xxx","name":"新闻早报","isActive":true,...}}
{"type":"task_update","action":"updated","task":{"id":"xxx","isActive":false}}
{"type":"task_update","action":"deleted","taskId":"xxx"}
```
Agent 执行 `createTask`/`updateTask`/`deleteTask` 时推送（Phase 2 后可用）。前端更新任务列表（即使当前在对话 Tab 也实时更新）。

#### 2.6 `done` 事件 — 完成
```json
{"type":"done","sessionKey":"sess_xxx"}
```
所有流式输出结束，前端标记当前消息为完成状态。

#### 2.7 `error` 事件 — 错误
```json
{"type":"error","message":"Agent 执行超时"}
```
发生错误时发送，前端在消息区域显示错误提示。

### 实现要点
- **AgentExecutor 流式模式：** 不使用 `invoke()`（阻塞返回完整结果），改用 `stream()` 方法获取增量输出。LangGraph `createAgentExecutor` 返回的 Runnable 支持 `.stream()` 调用，按 chunk 逐个产出：
  - `content` chunk：对应 `delta` 事件
  - `tool` chunk：对应 `tool_start` / `tool_end` 事件
- 使用 `ReadableStream` 构造 SSE 响应
- 每个事件发送后立即 flush 到客户端
- Session 锁管理：进入时获取锁，done/error 时释放

> **LangGraph 流式机制说明：** `createAgentExecutor` 返回的 executor 是一个 Runnable。调用 `.stream(input)` 时，它返回一个 AsyncGenerator，逐个 yield 每个中间步骤的输出（LLM token、工具调用、最终结果）。通过遍历这个 AsyncGenerator，可以拦截每个 chunk 并即时发送 SSE 事件。工具调用的 `tool_start` 对应 LLM 决定调用工具的步骤，`tool_end` 对应工具执行完成后的步骤。

---

## 3. 前端组件设计

### 3.1 `AgentChatPage` (改造 `src/app/admin/chat/page.tsx`)

页面根组件，管理 Tab 状态。

```typescript
"use client";
// 状态
const [activeTab, setActiveTab] = useState<"chat" | "tasks">("chat");

// 布局: 左侧 Tab 栏 + 右侧内容区
// Tab 栏: 对话图标 / 任务图标, 底部垂直排列
// 内容区: activeTab === "chat" ? <AgentChat /> : <TaskPanel />
```

### 3.2 `AgentChat` (新建 `src/components/admin/AgentChat.tsx`)

对话主组件，管理消息状态和 SSE 连接。

```typescript
"use client";
interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls: ToolCallBlock[];  // 内联工具调用
  isComplete: boolean;
  error?: string;
}

interface ToolCallBlock {
  id: string;
  name: string;
  status: "pending" | "running" | "done" | "error";
  input: Record<string, any>;
  result?: string;
}

// 消息列表 + 输入框 + SSE 连接管理
// useEffect: 初始化时创建默认 sessionKey
// sendMessage: fetch POST /api/agent/stream, 消费 SSE
```

**SSE 消费逻辑：**
```typescript
const handleSend = async (message: string) => {
  // 1. 添加用户消息
  // 2. 创建空的 assistant 消息占位
  // 3. fetch /api/agent/stream
  // 4. 消费 ReadableStream:
  //    - init: 记录 sessionKey
  //    - delta: 累加到 assistant 消息 content
  //    - tool_start: 在 assistant 消息中添加 toolCallBlock
  //    - tool_end: 更新 toolCallBlock 状态和 result
  //    - task_update: 更新外部任务列表状态（通过 callback）
  //    - done: 标记 assistant 消息 isComplete
  //    - error: 标记 assistant 消息 error
};
```

**新会话逻辑：**
```typescript
const startNewSession = () => {
  // 清空消息列表
  // 生成新的 sessionKey (uuid)
  // 不调用 API，只重置前端状态
};
```

### 3.3 `StreamingMessage` (改造 `src/components/chat/MessageBubble.tsx`)

改造现有 `MessageBubble` 组件以支持流式输出和内联工具调用。

```typescript
interface StreamingMessageProps {
  message: AgentMessage;  // 包含 toolCalls
  isStreaming?: boolean;  // 流式进行中
}

// 用户消息: 保持现有样式，右侧蓝色气泡
// Agent 消息:
//   - 顶部: 机器人图标 + "Agent"
//   - 主体: 渐出的文字内容
//   - 工具调用: 内联展开块在文字内容下方
//   - 流式进行中: 末尾显示闪烁光标
```

### 3.4 `ToolCallBlock` (新建内联组件)

工具调用的内联展示块。

```typescript
interface ToolCallBlockProps {
  block: ToolCallBlock;
}

// 样式: 左侧竖线 + 工具图标 + 工具名称
// 展开内容:
//   - pending/running: 显示参数 (params 折叠块)
//   - done: 显示参数 + 结果 (结果以代码块形式)
// 动画: 展开时平滑过渡
```

### 3.5 `TaskPanel` (改造 `src/components/admin/TaskPanel.tsx`)

**改造点：**
- `fetchTasks` 从 `useEffect` 自动调用改为接收外部刷新回调
- 添加 `refreshKey` prop：变化时重新 fetch（用于 SSE task_update 触发刷新）
- 或者暴露 `refreshTasks()` 函数供父组件调用

---

## 4. 工具集与任务同步

### 4.1 现有工具（内容管理）
| 工具 | 功能 |
|------|------|
| `duckduckgoSearch` | 网页搜索 |
| `createContent` | 创建内容条目 |
| `listContent` | 列出内容 |
| `deleteContent` | 删除内容 |

这些工具在 `src/lib/agent/tools/` 中已存在，直接复用。

### 4.2 新建工具（任务管理）
当前代码库中没有任务 CRUD 工具。Agent 要自主管理任务（创建/修改/删除定时任务），需要新增以下工具：

| 工具 | 功能 |
|------|------|
| `createTask` | 创建新任务（写入 Task 表） |
| `updateTask` | 更新任务配置（激活/禁用/Cron 表达式等） |
| `deleteTask` | 删除任务 |

工具函数签名参考现有的 `content.ts` 风格，参数使用 Zod schema 验证。

### 4.3 任务同步机制

Agent 执行 `createTask`/`updateTask`/`deleteTask` 后，工具函数返回结果，流式端点在收到工具结果 chunk 后主动查询最新任务列表并推送 `task_update` 事件。

**推荐方案（实现最简）：** 工具函数正常返回结果，流式端点在工具 chunk 阶段检测工具名称（如 `createTask`），执行后立即查询 Prisma Task 表推送 `task_update`。不需要改造现有工具函数签名，也不需要引入回调/事件系统。

| 工具 | task_update action | 说明 |
|------|--------------------|------|
| `createTask` | `created` | Agent 创建新任务 |
| `updateTask` | `updated` | Agent 修改任务配置 |
| `deleteTask` | `deleted` | Agent 删除任务 |

> 注：如果 `createContent`/`deleteContent` 也需要同步到任务列表的「最近操作」区域，可在对应的工具 chunk 阶段检测并推送，但 Phase 1 暂不实现。

---

## 5. Session 管理

复用现有的 `AgentSession` 模型，但行为调整：

- **新会话**：前端生成 `sessionKey`（uuid），POST 到 `/api/agent/stream` 时传递
- **持久化**：后端在 `init` 事件时 `getOrCreateSession`，结束后 `appendSessionMessage` 持久化对话
- **历史记录**：暂不支持会话列表切换，每次「新会话」清空本地 UI，后续可扩展
- **锁机制**：复用现有的 `acquireSessionLock` / `releaseSessionLock`

---

## 6. 错误处理

| 场景 | 处理方式 |
|------|----------|
| Agent 超时 | SSE 发送 `error` 事件，消息显示超时提示，锁自动释放 |
| 工具执行失败 | `tool_end` 事件的 `success: false`，工具块显示错误状态 |
| SSE 连接断开 | 前端捕获 AbortError，显示「连接中断」提示 |
| Session 获取锁失败 | API 返回 409，直接显示「会话正被占用」 |
| API 认证失败 | 401/403，前端跳转登录页 |

---

## 7. 文件变更清单

### 新建
- `src/app/api/agent/stream/route.ts` — SSE 流式端点
- `src/components/admin/AgentChat.tsx` — 对话主组件
- `src/lib/agent/prompts/admin_chat.ts` — Admin Agent 对话 prompt
- `src/lib/agent/tools/task.ts` — 任务管理工具

### 改造
- `src/app/admin/chat/page.tsx` — 改为 Tab 容器（左侧 Tab 栏 + 对话/任务视图）
- `src/components/chat/MessageBubble.tsx` — 支持流式输出和工具调用内联
- `src/components/admin/TaskPanel.tsx` — 暴露 `refreshTasks()` 供外部调用
- `src/lib/agent/executor.ts` — 抽取 executor 创建逻辑，支持动态 prompt

### 依赖
- **改造 `src/lib/agent/executor.ts`**：抽取 executor 创建逻辑，支持动态 prompt 参数。现有 `createNewsAgentExecutor()` 继续存在（复用），新增 `createAdminAgentExecutor(prompt: string)` 用于通用对话。
- 复用现有 `src/lib/agent/session.ts`（Session 管理）
- 复用现有 `src/lib/agent/tools/`（内容工具集 `duckduckgoSearch`, `createContent`, `listContent`, `deleteContent`）
- 新建 `src/lib/agent/tools/task.ts`（任务管理工具 `createTask`, `updateTask`, `deleteTask`）
- 复用现有 `src/lib/langchain/llm.ts`（LLM 实例）
- 新建 `src/lib/agent/prompts/admin_chat.ts`（Admin Agent 对话专用 system prompt）

---

## 8. 实现优先级

**Phase 1 — 核心流式对话（MVP）**
1. 改造 `executor.ts`：抽取 executor 创建逻辑，支持动态 prompt
2. 新建 `admin_chat.ts` prompt 文件（通用 Admin Agent 对话 prompt）
3. 实现 `/api/agent/stream` SSE 端点（使用 `stream()` 模式，tool_start/tool_end 事件）
4. 实现 `AgentChat` 组件（消息列表 + 输入框 + SSE 消费）
5. 改造 `MessageBubble` 支持流式输出（光标闪烁、增量渲染）
6. 实现 `ToolCallBlock` 内联组件
7. 改造 `chat/page.tsx` 为 Tab 容器（对话 + 任务）
8. 端到端流式对话可用（Phase 1 工具集：搜索 + 内容管理）

**Phase 2 — 任务管理集成**
9. 新建 `src/lib/agent/tools/task.ts`（`createTask`, `updateTask`, `deleteTask` 工具）
10. 将任务工具注册到 agent tools 列表
11. 实现 `task_update` 事件推送（检测工具名称，执行后查询 Task 表）
12. TaskPanel 实时刷新机制（暴露 `refreshTasks()` 供父组件调用）

**Phase 3 — 优化**
13. 新会话功能（清空对话 + 生成新 sessionKey）
14. 错误边界和重试
15. Session 历史持久化（会话列表切换）
