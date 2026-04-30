# MCP Server 修复设计

**日期：** 2026-04-30
**状态：** 已确认

## 目标

修复对外 MCP Server，使外部 AI 客户端（Claude Desktop、Cursor 等）能够通过标准 MCP Streamable HTTP 协议连接，调用内容管理工具。

## 范围

### 删除

- `src/contexts/McpChatContext.tsx` — 废弃的 MCP 聊天上下文
- `src/components/chat/ChatSidebar.tsx` — 废弃
- `src/components/chat/ChatWindow.tsx` — 废弃
- `src/components/chat/ChatInput.tsx` — 废弃
- `src/app/api/mcp-proxy/route.ts` — 废弃的代理层

以上组件与对外 MCP Server 无关，且 Agent 系统不依赖它们。

### 保留并修复

| 文件 | 改动 |
|------|------|
| `src/app/api/mcp/route.ts` | 升级依赖、修正 createMcpHandler 配置 |
| `src/lib/mcp-tools.ts` | 重写，调用 Agent 工具逻辑，MCP 层仅做格式适配 |
| `src/lib/mcp-auth.ts` | 错误格式改为 JSON-RPC 标准 |

### 不变

- `src/lib/agent/tools/content.ts` — Agent 工具实现不受影响
- `src/lib/agent/tools/registry.ts` — 不受影响
- 其他所有 Agent 系统代码

## MCP 工具清单（7个）

| 工具名 | 功能 | 来源 |
|--------|------|------|
| `list_content` | 列表查询，支持分类/状态/分页筛选 | Agent |
| `get_content` | 按 ID 或 slug 获取单篇完整内容 | MCP 原有 |
| `create_content` | 创建内容，自动生成 slug、发布+索引 | Agent |
| `update_content` | 更新内容，自动重建向量索引 | Agent |
| `delete_content` | 删除内容及关联向量块 | Agent |
| `publish_content` | 手动发布草稿并生成向量索引 | MCP 原有 |
| `search_content` | RAG 语义搜索，返回相关片段+来源 | MCP 原有 |

## 架构

```
外部 MCP 客户端
    │
    ▼
/api/mcp (Next.js Route)
    │
    ├─→ validateMcpRequest()   # Bearer Token 认证
    │
    └─→ createMcpHandler()
         └─→ McpServer
              └─→ registerTools()
                   ├─→ Agent 工具函数 (create/list/update/delete)
                   └─→ MCP 独有函数 (get/publish/search)
                            │
                            ▼
                       Prisma / PostgreSQL
```

## 依赖升级

- `@modelcontextprotocol/sdk`: `^1.29.0` → 最新稳定版
- `mcp-handler`: `^1.1.0` → 最新版

## 风险

- **低风险**：删除的 MCP Chat UI 文件经确认无其他模块依赖
- **低风险**：Agent 工具逻辑已稳定运行，MCP 只做薄封装
- **需验证**：`mcp-handler` 新版本 API 是否有 breaking change
