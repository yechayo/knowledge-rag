# Front Chat Trace And Markdown Design

**Goal**

让首页知识岛助手同时支持两件事：

1. 以用户可读的步骤轨迹展示回答过程，而不是原始模型思考文本。
2. 正确渲染助手回答中的 Markdown，同时保留 `[[REF:...]]` 引用跳转能力。

**Current State**

- `/api/chat` 已经会通过 SSE 发送 `route`、`thinking`、`tool_start`、`tool_end`、`sources`、`delta`、`done` 等事件。
- 前台 [ChatPanel.tsx](D:\project\KnowledgeRag\knowledge-rag\src\components\chat\ChatPanel.tsx) 只消费 `delta`、`sources`、`error`，因此用户看不到轨迹。
- 前台正文只做了轻量字符串分段处理，`##`、`---`、列表等 Markdown 语法会直接泄露到界面。
- 后台 [AgentChat.tsx](D:\project\KnowledgeRag\knowledge-rag\src\components\admin\AgentChat.tsx) 和 [MessageBubble.tsx](D:\project\KnowledgeRag\knowledge-rag\src\components\chat\MessageBubble.tsx) 已经具备 thinking/tool call UI，可复用交互模式，但前台还没接入。

**Recommended Approach**

前台聊天不展示 raw thinking 文本，而是把 SSE 事件归约成“步骤化轨迹”：

- `route` -> `识别问题类型`
- `thinking` -> `分析问题与规划回答`
- `tool_start/tool_end` -> `检索知识库`
- `sources` -> `整理引用来源`
- `delta/done` -> `生成回答`

同时将 Markdown 渲染切换为 `marked + DOMPurify`，并在渲染前把 `[[REF:/path#anchor|label]]` 预处理成安全的锚点 HTML，再通过点击代理保留现有跳转逻辑。

**Architecture**

1. 新增前台聊天状态归约 helper
- 负责把 SSE 事件映射为前台消息状态。
- 产出 `traceSteps`、`toolCalls`、`content`、`sources` 等前端展示字段。
- 设计成纯函数，便于单元测试。

2. 新增前台 Markdown 渲染 helper / 组件
- 负责：
  - 将 `[[REF:...]]` 预处理为可渲染锚点
  - 使用 `marked` 解析常规 Markdown
  - 使用 `DOMPurify` 清洗 HTML
  - 通过容器点击代理拦截引用链接跳转

3. 调整前台聊天 UI
- [ChatPanel.tsx](D:\project\KnowledgeRag\knowledge-rag\src\components\chat\ChatPanel.tsx) 改为使用新状态结构消费 SSE。
- [MessageBubble.tsx](D:\project\KnowledgeRag\knowledge-rag\src\components\chat\MessageBubble.tsx) 扩展支持：
  - 步骤轨迹
  - Markdown 正文
  - 可选来源数据

**Data Shape**

前台助手消息新增：

- `id: string`
- `thinking?: string[]`
- `thinkingComplete?: boolean`
- `toolCalls?: ToolCallBlock[]`
- `traceSteps?: TraceStep[]`
- `sources?: Source[]`
- `isComplete?: boolean`
- `error?: string`

其中 `TraceStep`：

- `id: string`
- `label: string`
- `status: "pending" | "running" | "done" | "error"`
- `detail?: string`

**Error Handling**

- SSE 解析失败时忽略单条坏事件，不中断整个流。
- `tool_end` 返回非 JSON 时，轨迹 detail 退化为通用描述。
- Markdown 解析始终在 sanitize 后输出，避免渲染用户不可控 HTML。
- 无来源时，引用跳转逻辑退化为直接跳转原链接。

**Testing**

新增单元测试覆盖：

- SSE 事件归约逻辑：
  - `route -> thinking -> tool_start -> tool_end -> sources -> delta -> done`
  - 工具结果摘要
  - 完成态与错误态
- Markdown 渲染逻辑：
  - 标题、分隔线、列表、粗体、代码块
  - `[[REF:...]]` 转换为安全锚点
  - jump href 保留 `ref` 查询参数

**Out Of Scope**

- 不修改 `/api/agent/stream` 和后台管理助手。
- 不改 `/api/chat` 的 SSE 协议。
- 不直接展示原始模型思考文本。
