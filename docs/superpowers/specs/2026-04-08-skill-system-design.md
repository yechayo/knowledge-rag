# Skill 系统设计文档

> **日期**: 2026-04-08
> **目标**: 在 KnowledgeRag Agent 上实现 Skill 加载机制，参照 Claude Code Skill 系统
> **首个 Skill**: Brainstorming

---

## 1. 概述

### 1.1 什么是 Skill

Skill 是一套**结构化的提示词系统**——将特定能力的 prompt、配置和资源打包为独立单元，使 Agent 能动态加载和切换不同的专业能力模式。

类比：Skill 就像给 Agent 换上不同的工作"角色"。Admin Agent 默认是"管理员助手"；加载 Brainstorming Skill 后，Agent 切换为"设计引导师"。

### 1.2 核心设计目标

- **Skill 定义**: Markdown + YAML Frontmatter，直观可读
- **Skill 存储**: 项目内 `src/lib/agent/skills/` 目录
- **两种调用方式**:
  1. **动态加载**: 用户发送 `/brainstorming` 或 AI 识别到需求时，加载 skill prompt 替换当前上下文
  2. **Tool 调用**: `skill_tool({ skill: 'brainstorming' })` 作为触发器，加载后进入 skill 模式
- **首个 Skill**: Brainstorming（想法 → 设计方案）

### 1.3 架构概览

```
src/lib/agent/
├── skills/
│   ├── index.ts                    # Skill 注册表 + 导出
│   ├── skillLoader.ts              # 核心加载器：解析 frontmatter + 正文
│   └── brainstorming/
│       └── SKILL.md                # Brainstorming skill 定义文件
├── skillRouter.ts                  # Skill 路由：根据激活 skill 选择 prompt
└── prompts/
    └── react_agent.ts              # 重写：支持 skill 模式切换
```

---

## 2. Skill 文件格式

### 2.1 SKILL.md 结构

```markdown
---
name: brainstorming
description: "在实现任何创意工作之前——创建功能、构建组件、添加功能或修改行为——必须使用此 skill 进行探索性对话，引导用户将想法转化为完整的设计方案。"
user-invocable: true
---

# Brainstorming Ideas Into Designs

> Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

[详细的行为定义和流程说明...]

## Key Principles

- **One question at a time** - Don't overwhelm with multiple questions
...
```

### 2.2 Frontmatter 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Skill 标识名（英文） |
| `description` | string | 是 | Skill 描述，供 AI 识别何时使用 |
| `user-invocable` | boolean | 否 | 是否允许用户通过 `/name` 触发 |
| `disable-model-invocation` | boolean | 否 | 是否禁止 AI 自主调用此 skill |

### 2.3 Skill 正文

Skill 正文是该能力的**完整 prompt 定义**，包含：
- 角色定位（你是谁）
- 行为规则（何时做什么）
- 流程步骤（如何执行）
- 输出格式（生成什么）
- 拒绝条件（HARD-GATE 等）

---

## 3. 核心模块设计

### 3.1 skillLoader.ts — Skill 加载器

**职责**: 解析 SKILL.md 文件，提取 frontmatter 和正文，构建 Skill 对象。

```typescript
// src/lib/agent/skills/skillLoader.ts

export interface SkillDefinition {
  name: string;           // Skill 标识
  description: string;    // 描述
  content: string;        // Markdown 正文（不含 frontmatter）
  userInvocable: boolean; // 是否 /name 可触发
  disableModelInvoke: boolean; // 是否禁止 AI 调用
  filePath: string;       // 文件路径
}

/**
 * 解析 YAML frontmatter
 * 使用简单的正则解析，支持基本类型
 */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string }

/**
 * 加载单个 skill 文件
 */
export async function loadSkill(skillPath: string): Promise<SkillDefinition>

/**
 * 扫描 skills 目录，加载所有 skill
 */
export async function loadAllSkills(baseDir: string): Promise<SkillDefinition[]>
```

**实现要点**:
- Frontmatter 解析使用简单的正则匹配 YAML key-value 对
- 支持 string 和 boolean 类型
- 正文保留完整 Markdown（不含 frontmatter）
- 文件读取使用 Node.js `fs`（仅服务端）

### 3.2 skills/index.ts — Skill 注册表

**职责**: 管理所有已加载的 skill，提供查询和调用接口。

```typescript
// src/lib/agent/skills/index.ts

import { loadAllSkills } from "./skillLoader";

let skillsCache: SkillDefinition[] | null = null;

/**
 * 获取所有已注册 skill（带缓存）
 */
export async function getAllSkills(): Promise<SkillDefinition[]>

/**
 * 根据 name 获取单个 skill
 */
export async function getSkill(name: string): Promise<SkillDefinition | null>

/**
 * 获取 skill 对应的系统 prompt
 * 返回 prompt 文本，供 Agent 执行时使用
 */
export async function getSkillPrompt(name: string): Promise<string | null>
```

**缓存策略**:
- 首次加载后缓存到内存
- 开发环境可传入 `forceReload: true` 强制刷新

### 3.3 skillRouter.ts — Skill 路由

**职责**: 在 `stream/route.ts` 中，根据当前激活的 skill 选择对应的 prompt 模板。

```typescript
// src/lib/agent/skillRouter.ts

export interface SkillContext {
  activeSkill: string | null; // 当前激活的 skill name，null 表示默认 Admin 模式
  skillPrompt: string | null; // 当前 skill 的 prompt
}

/**
 * 解析请求中的 skill 参数
 * 支持两种方式:
 * 1. body.skill === 'brainstorming' 显式指定
 * 2. 从用户消息中提取 /brainstorming 命令
 */
export function resolveSkillContext(
  message: string,
  explicitSkill?: string | null
): SkillContext

/**
 * 根据 skill context 选择最终 prompt
 */
export function buildSystemPrompt(
  skillContext: SkillContext,
  defaultPrompt: string
): string
```

### 3.4 stream/route.ts — 改造

**改造点**:

1. 解析 skill 上下文
2. 如果激活了 skill，构建 skill prompt 替代默认 `ADMIN_CHAT_PROMPT`
3. Skill prompt 中的 `{{USER_MESSAGE}}` 占位符替换为用户输入
4. 保留原有的工具调用机制

**关键逻辑**:

```typescript
// 检测 /skill-name 命令
function extractSkillCommand(message: string): { skill: string; cleanMessage: string } | null

// 在 stream/route.ts 的 POST handler 中:
const { activeSkill, skillPrompt } = resolveSkillContext(message, body.skill);
const basePrompt = activeSkill && skillPrompt
  ? skillPrompt  // Skill 模式
  : ADMIN_CHAT_PROMPT;  // 默认 Admin 模式
```

---

## 4. 前端集成

### 4.1 Skill 切换按钮

在 `/admin/chat` 页面顶部 Tab 栏增加 Skill 切换区：

```
[对话] [任务] [Brainstorming ▼]
```

- 点击切换当前 Agent 的 skill 模式
- 切换后清空会话，开启新对话
- Skill 激活时显示高亮标识

### 4.2 斜杠命令支持

在 `AgentChat.tsx` 的输入框中：
- 监听 `/brainstorming` 斜杠命令
- 输入 `/` 后弹出 Skill 选择下拉
- 选择后替换输入框内容为 `/brainstorming `

### 4.3 Skill 列表 API

```typescript
// GET /api/agent/skills
// 返回: { skills: Array<{ name: string; description: string; userInvocable: boolean }> }
```

前端加载 Skill 列表，渲染切换按钮。

---

## 5. Brainstorming Skill 实现

### 5.1 SKILL.md 内容

将 `C:\Users\HP\.claude\skills\brainstorming\SKILL.md` 的内容适配到项目上下文中：

- 移除 Claude Code 特定工具引用（如 `spawn_agent`、`update_plan`）
- 将文件路径适配为项目路径
- 保留完整的引导流程：探索上下文 → 逐一提问 → 提出方案 → 呈现设计 → 写文档 → 评审

### 5.2 与 Admin Chat 的差异

| 方面 | Admin Chat | Brainstorming |
|------|-----------|---------------|
| 目标 | 执行任务（搜索、创建内容） | 将想法转化为设计方案 |
| 工具 | duckduckgo_search, create_content 等 | 无（对话引导为主） |
| 流程 | 用户指令 → 执行 → 反馈 | 提问 → 澄清 → 设计 → 文档 |
| 输出 | 操作结果（创建的内容等） | 设计文档（写入 Content 表） |
| 结束条件 | 任务完成 | 设计文档获批后 |

### 5.3 设计文档存储

Brainstorming 流程结束后，生成的设计文档通过 `create_content` 工具存储到数据库：

- `category`: "design-doc"
- `title`: 用户确定的设计名称
- `body`: 完整的设计文档 Markdown
- `status`: "draft"（后续可修改/发布）

---

## 6. 文件变更清单

### 新建文件

| 文件 | 说明 |
|------|------|
| `src/lib/agent/skills/skillLoader.ts` | Skill 加载器 |
| `src/lib/agent/skills/index.ts` | Skill 注册表 |
| `src/lib/agent/skills/brainstorming/SKILL.md` | Brainstorming Skill 定义 |
| `src/lib/agent/skillRouter.ts` | Skill 路由逻辑 |
| `src/app/api/agent/skills/route.ts` | Skill 列表 API |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/app/api/agent/stream/route.ts` | 集成 skill 上下文解析和 prompt 路由 |
| `src/components/admin/AgentChat.tsx` | 添加 Skill 切换 UI + 斜杠命令支持 |
| `src/components/admin/ChatPage.tsx` | 添加 Skill Tab |

---

## 7. 实现顺序

1. **skillLoader.ts** — 最底层，依赖最少
2. **skills/index.ts** — 注册表，依赖 loader
3. **skillRouter.ts** — 路由逻辑
4. **brainstorming/SKILL.md** — 首个 skill 内容
5. **stream/route.ts** — 集成 skill 到对话流
6. **Skill 列表 API** — 前端加载 skill 列表
7. **AgentChat UI** — Skill 切换 + 斜杠命令
8. **测试调试** — 端到端验证

---

## 8. 错误处理

| 场景 | 处理方式 |
|------|---------|
| Skill 文件不存在 | 返回 null，前端显示提示 |
| Frontmatter 解析失败 | 使用默认值，log 警告 |
| Skill prompt 加载失败 | fallback 到默认 Admin prompt |
| 前端 skill 列表为空 | 显示 "无可用 Skill" |
