import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('开始插入种子数据...');

  // ============================================================
  // 1. SiteConfig
  // ============================================================
  const siteConfigs = [
    { key: 'site_name', value: 'MySpace' },
    { key: 'bio', value: '热爱技术的开发者，分享文章与项目经验' },
    { key: 'github_url', value: 'https://github.com' },
    { key: 'twitter_url', value: 'https://twitter.com' },
    { key: 'email_url', value: 'mailto:hello@example.com' },
  ];

  for (const config of siteConfigs) {
    await prisma.siteConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }
  console.log(`已插入 ${siteConfigs.length} 条 SiteConfig`);

  // ============================================================
  // 2. Articles
  // ============================================================
  const articles = [
    {
      title: 'Next.js 16 App Router 完全指南',
      slug: 'nextjs-16-app-router-guide',
      category: 'article',
      status: 'published',
      body: `## 什么是 App Router

App Router 是 Next.js 13 引入的全新路由系统，基于 React Server Components 构建。到了 Next.js 16，App Router 已经成为默认且推荐的路由方案，带来了诸多改进和性能提升。

### App Router 的核心优势

App Router 相比传统的 Pages Router 有以下显著优势：

- **服务端组件优先**：默认所有组件都是服务端组件，减少了客户端 JavaScript 体积
- **嵌套布局**：支持嵌套的 Layout 组件，避免页面切换时的重新渲染
- **加载状态**：内置的 loading.tsx 文件自动处理 Suspense 边界
- **错误处理**：error.tsx 和 global-error.tsx 提供细粒度的错误恢复
- **流式渲染**：支持 Suspense 和流式 HTML，提升首屏加载速度

## 文件系统路由

### 基本路由结构

在 App Router 中，路由是通过文件系统来定义的。app 目录下的文件夹结构直接映射为 URL 路径结构。例如：

- \`app/page.tsx\` 对应根路径 \"/\"
- \`app/blog/page.tsx\` 对应 \"/blog\"
- \`app/blog/[slug]/page.tsx\` 对应动态路由 \"/blog/:slug\"

### 动态路由

动态路由使用方括号语法来定义。支持以下几种模式：

**单个动态段**：\`[slug]\` 匹配单个路径段
**捕获所有段**：\`[...slug]\` 匹配多个路径段
**可选捕获**：\`[[...slug]]\` 匹配零个或多个路径段

### 路由组

使用圆括号 \`()\` 创建路由组，可以在不影响 URL 路径的情况下组织代码。例如 \`app/(marketing)/about/page.tsx\` 仍然对应 \"/about\"，但可以有自己的布局文件。

## 数据获取模式

### 服务端数据获取

在 App Router 中，服务端组件可以直接访问数据库和文件系统，无需额外的 API 路由。这使得数据获取更加直观和高效。

### 客户端数据获取

对于需要客户端交互的数据获取场景，可以使用 React 的 \`use()\` hook 配合 Suspense，或者使用 SWR / React Query 等库。

### 并行与顺序数据获取

App Router 支持在布局和页面中同时发起多个数据请求（并行获取），也可以在需要时进行顺序获取。通过 \`Suspense\` 边界，可以控制数据的加载顺序和页面的展示时机。

## Server Actions

### 什么是 Server Actions

Server Actions 是 Next.js 14 引入的功能，允许在服务端直接执行 mutations（增删改操作），无需手动创建 API 路由。在 Next.js 16 中，Server Actions 更加成熟稳定。

### 使用方式

定义 Server Action 非常简单，只需在函数前添加 \`'use server'\` 指令。Server Action 可以直接在服务端组件中内联定义，也可以在单独的文件中定义然后导入使用。

### 表单处理

Server Actions 与 HTML \`<form>\` 元素深度集成，提供了 Progressive Enhancement 支持。即使 JavaScript 未加载，表单依然可以正常工作。

## 缓存策略

### 请求记忆化

Next.js 16 提供了多种缓存策略，包括请求记忆化（Request Memoization）、数据缓存（Data Cache）和完整路由缓存（Full Route Cache）。理解这些缓存机制对于优化应用性能至关重要。

### 重新验证

通过 \`revalidatePath\` 和 \`revalidateTag\` 可以按需清除缓存。支持基于时间的自动重新验证（ISR）和按需重新验证两种模式。

## 中间件

Next.js 的中间件运行在 Edge Runtime 上，可以在请求到达页面之前拦截和处理请求。中间件常用于身份验证、国际化、A/B 测试等场景。

## 最佳实践

### 性能优化建议

1. 尽量使用服务端组件，只在需要交互时使用客户端组件
2. 合理使用 \`loading.tsx\` 和 \`Suspense\` 提升用户体验
3. 利用 \`next/image\` 优化图片加载
4. 使用 \`next/font\` 优化字体加载
5. 合理配置缓存策略，平衡数据新鲜度和性能

### 项目结构建议

建议将共享组件放在 \`components\` 目录，将数据获取逻辑放在服务端组件中，将交互逻辑封装为客户端组件。保持清晰的关注点分离，有助于项目的长期维护。

## 总结

Next.js 16 的 App Router 代表了 React 全栈应用的未来方向。通过服务端组件、Server Actions、流式渲染等特性，开发者可以构建出更快、更简洁、更易维护的 Web 应用。无论你是从 Pages Router 迁移还是从零开始，App Router 都值得深入学习和使用。`,
    },
    {
      title: 'PostgreSQL + pgvector 实现 RAG 检索',
      slug: 'postgresql-pgvector-rag',
      category: 'article',
      status: 'published',
      body: `## 什么是 RAG

RAG（Retrieval-Augmented Generation，检索增强生成）是一种将信息检索与大语言模型结合的技术架构。通过先从知识库中检索相关文档片段，再将其作为上下文输入给 LLM，可以显著提升回答的准确性和时效性。

### 为什么需要 RAG

纯大语言模型存在以下局限性：

- **知识截止日期**：模型的训练数据有截止时间，无法获取最新信息
- **幻觉问题**：模型可能生成看似合理但实际错误的内容
- **领域知识不足**：在特定专业领域，通用模型的知识可能不够深入

RAG 通过引入外部知识库来解决这些问题，让模型基于真实文档来生成回答。

## pgvector 简介

### 什么是 pgvector

pgvector 是 PostgreSQL 的一个扩展，为数据库添加了向量存储和相似度搜索的能力。它支持：

- 向量数据类型的存储
- 多种距离度量方式（余弦相似度、L2 距离、内积）
- 精确搜索和近似最近邻（ANN）搜索
- IVFFlat 和 HNSW 索引

### 安装与配置

在 PostgreSQL 中启用 pgvector 扩展非常简单，只需执行 \`CREATE EXTENSION vector;\`。安装完成后，就可以创建包含向量列的表了。

## 文档处理流程

### 文档分块策略

将长文档切分成适当大小的文本块是 RAG 系统的关键步骤。常用的分块策略包括：

- **固定长度分块**：按固定字符数切分，简单但可能破坏语义完整性
- **按段落分块**：以段落为单位，保持语义完整
- **按页分块**：适用于 PDF 等格式化文档，便于引用溯源

分块大小通常建议在 256-1024 个 token 之间，需要根据具体场景调整。

### 文本向量化

将文本块转换为向量表示是检索的基础。常用的 Embedding 模型包括：

- OpenAI text-embedding-3 系列
- 智谱 Embedding-3
- BGE 系列
- Cohere Embed

选择模型时需要考虑维度、成本、多语言支持等因素。

## 向量检索

### 相似度搜索

pgvector 支持多种相似度计算方式。对于文本检索，余弦相似度是最常用的度量方式。通过 SQL 查询可以轻松实现 KNN（K 近邻）搜索。

### 索引优化

对于大规模向量数据，使用索引可以大幅提升检索速度：

- **IVFFlat 索引**：通过聚类实现近似搜索，适合数据量适中的场景
- **HNSW 索引**：基于层次导航小世界图，召回率更高

## 系统集成

### 与 LLM 结合

检索到相关文档片段后，将其与用户问题一起构造 Prompt，输入给大语言模型生成回答。关键在于 Prompt 的设计，需要明确指示模型基于提供的上下文来回答。

### 引用溯源

一个好的 RAG 系统应该支持引用溯源，即告诉用户回答的依据来自哪个文档的哪个部分。这需要在文档分块时保留足够的元数据（如来源文档、页码、段落位置等）。

## 性能优化建议

1. 合理设置向量维度，平衡精度和存储成本
2. 为向量列创建合适的索引
3. 使用连接池管理数据库连接
4. 实现异步处理，避免阻塞主线程
5. 考虑使用缓存减少重复计算

## 总结

PostgreSQL + pgvector 提供了一个强大的 RAG 基础设施方案。借助 PostgreSQL 的成熟生态和 pgvector 的向量能力，可以构建出高效、可靠的 RAG 系统。`,
    },
    {
      title: 'Tailwind CSS v4 新特性速览',
      slug: 'tailwind-css-v4-new-features',
      category: 'article',
      status: 'published',
      body: `## Tailwind CSS v4 概述

Tailwind CSS v4 是该 CSS 框架的一次重大更新，带来了全新的引擎和一系列令人兴奋的新特性。

## 核心变化

### 基于 Rust 的新引擎

v4 使用 Oxide 引擎重写，构建速度提升了约 10 倍，开发体验更加流畅。

### CSS-first 配置

不再需要 \`tailwind.config.js\`，所有配置都可以直接在 CSS 文件中通过 \`@theme\` 指令完成，配置更加直观。

### 自动内容检测

无需手动配置 \`content\` 路径，新引擎会自动扫描项目文件，检测使用了哪些 Tailwind 类。

## 新增功能

- **原生 CSS 变量**：更好的主题定制能力
- **容器查询支持**：内置 \`@container\` 变体
- **3D 变换**：新增 \`rotate-x\`、\`rotate-y\`、\`perspective\` 等工具类
- **改进的颜色系统**：支持 OKLCH 色彩空间
- **更灵活的间距**：支持任意值作为默认行为

## 迁移建议

从 v3 迁移到 v4 需要注意配置方式的变更和部分类名的调整。建议在新项目中直接使用 v4，现有项目可以逐步迁移。

## 总结

Tailwind CSS v4 是一次值得升级的重大更新，更快的构建速度和更简洁的配置方式让开发体验更上一层楼。`,
    },
    {
      title: '深入理解 React Server Components',
      slug: 'react-server-components-deep-dive',
      category: 'article',
      status: 'published',
      body: `## React Server Components 简介

React Server Components（RSC）是 React 18 引入的一项重大特性，它允许组件在服务端渲染，从而带来更好的性能和用户体验。

### 核心概念

Server Components 是一种特殊的组件类型，它们：
- 在服务端渲染，不发送到客户端
- 可以直接访问数据库、文件系统等服务端资源
- 不需要包含在客户端 bundle 中
- 可以使用 async/await 进行数据获取

### 与客户端组件的区别

| 特性 | Server Components | Client Components |
|------|------------------|-------------------|
| 运行位置 | 服务端 | 客户端浏览器 |
| bundle 大小 | 不增加客户端 bundle | 增加客户端 bundle |
| 交互能力 | 无（纯展示） | 支持（useState、useEffect等） |
| 数据获取 | 直接获取 | 需要通过 API |

### 使用场景

**适合 Server Components：**
- 数据密集型组件（列表、表格）
- 静态内容组件
- 需要访问敏感资源的组件
- 大型依赖库（如 Markdown 渲染器）

**适合 Client Components：**
- 需要用户交互的组件（按钮、表单）
- 需要使用浏览器 API 的组件
- 需要状态管理的组件

### 最佳实践

1. 默认使用 Server Components，只在必要时使用 Client Components
2. 将交互逻辑封装到小的 Client Components 中
3. 使用 Server Components 进行数据获取，通过 props 传递给 Client Components
4. 合理使用 Suspense 处理加载状态

## 实际应用示例

以下是一个典型的 Server Component 使用场景：

\`\`\`typescript
// app/posts/page.tsx (Server Component)
async function PostsList() {
  const posts = await db.posts.findMany();

  return (
    <div>
      {posts.map(post => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}
\`\`\`

## 总结

React Server Components 代表了 React 应用架构的未来方向。通过合理使用 Server 和 Client Components，我们可以构建出性能更好、用户体验更佳的应用。`,
      metadata: {
        tags: ['React', 'Server Components', '前端开发'],
      },
    },
    {
      title: 'TypeScript 高级类型技巧',
      slug: 'typescript-advanced-type-techniques',
      category: 'article',
      status: 'published',
      body: `## 前言

TypeScript 的类型系统非常强大，掌握一些高级类型技巧可以让代码更加类型安全且易于维护。

## 条件类型

条件类型允许根据类型关系来选择类型：

\`\`\`typescript
type IsArray<T> = T extends any[] ? true : false;

type Test1 = IsArray<string[]>; // true
type Test2 = IsArray<string>; // false
\`\`\`

## 映射类型

映射类型可以基于旧类型创建新类型：

\`\`\`typescript
type Readonly<T> = {
  readonly [P in keyof T]: T[P];
};

type Partial<T> = {
  [P in keyof T]?: T[P];
};
\`\`\`

## 模板字面量类型

TypeScript 4.1 引入了模板字面量类型：

\`\`\`typescript
type EventName<T extends string> = \`on\${Capitalize<T>}\`;

type ClickEvent = EventName<'click'>; // 'onClick'
\`\`\`

## 递归类型

递归类型可以定义嵌套结构：

\`\`\`typescript
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
\`\`\`

## 类型推断

使用 \`infer\` 关键字进行类型推断：

\`\`\`typescript
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
\`\`\`

## 品牌类型

品牌类型用于区分语义上不同但结构相同的类型：

\`\`\`typescript
type USD = number & { readonly __brand: 'USD' };
type EUR = number & { readonly __brand: 'EUR' };

function usd(amount: number): USD {
  return amount as USD;
}
\`\`\`

## 总结

掌握这些高级类型技巧，可以让你的 TypeScript 代码更加健壮和可维护。`,
      metadata: {
        tags: ['TypeScript', '类型系统', '前端开发'],
      },
    },
    {
      title: 'PostgreSQL 性能优化实战',
      slug: 'postgresql-performance-optimization',
      category: 'article',
      status: 'published',
      body: `## 查询优化

### 使用 EXPLAIN ANALYZE

分析查询执行计划是优化的第一步：

\`\`\`sql
EXPLAIN ANALYZE SELECT * FROM users WHERE email = 'test@example.com';
\`\`\`

关注以下指标：
- 执行时间
- 扫描行数
- 是否使用了索引

### 索引策略

**何时创建索引：**
- 频繁用于 WHERE、JOIN、ORDER BY 的列
- 高选择性（唯一值多）的列
- 避免在小表上创建索引

**复合索引顺序：**
将选择性高的列放在前面：

\`\`\`sql
CREATE INDEX idx_user_status_date ON users(status, created_at);
\`\`\`

## 连接池配置

合理配置连接池可以提高并发性能：

\`\`\`
pool_min = 5
pool_max = 20
\`\`\`

## 查询重写

### 避免 SELECT *

\`\`\`sql
-- 不推荐
SELECT * FROM users;

-- 推荐
SELECT id, name, email FROM users;
\`\`\`

### 使用 CTE 优化复杂查询

\`\`\`sql
WITH user_stats AS (
  SELECT user_id, COUNT(*) as post_count
  FROM posts
  GROUP BY user_id
)
SELECT u.name, us.post_count
FROM users u
JOIN user_stats us ON u.id = us.user_id;
\`\`\`

## 表分区

对大表进行分区可以显著提高查询性能：

\`\`\`sql
CREATE TABLE posts (
  id SERIAL,
  created_at TIMESTAMP
) PARTITION BY RANGE (created_at);

CREATE TABLE posts_2024 PARTITION OF posts
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
\`\`\`

## 总结

PostgreSQL 性能优化需要综合考虑查询设计、索引策略、配置参数等多个方面。持续监控和分析是优化的关键。`,
      metadata: {
        tags: ['PostgreSQL', '数据库', '性能优化'],
      },
    },
    {
      title: 'Docker 容器化最佳实践',
      slug: 'docker-containerization-best-practices',
      category: 'article',
      status: 'published',
      body: `## 为什么选择 Docker

Docker 通过容器化技术解决了"在我的机器上能运行"的问题，确保应用在任何环境中都能一致运行。

### Docker 的核心优势

- **环境一致性**：开发、测试、生产环境完全一致
- **资源隔离**：进程、网络、文件系统隔离
- **快速部署**：秒级启动，快速扩缩容
- **版本管理**：镜像版本化管理，支持回滚

## Dockerfile 最佳实践

### 使用多阶段构建

\`\`\`dockerfile
# 构建阶段
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY package*.json ./
RUN npm ci --production
CMD ["node", "dist/index.js"]
\`\`\`

### 优化镜像大小

- 使用 alpine 基础镜像
- 合并 RUN 指令减少层数
- 清理不必要的文件
- 使用 .dockerignore

### 安全最佳实践

- 不要以 root 用户运行应用
- 使用特定版本标签而非 latest
- 定期扫描镜像漏洞
- 最小化安装依赖

## Docker Compose 使用

Docker Compose 适合定义和运行多容器应用：

\`\`\`yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=secret

volumes:
  postgres_data:
\`\`\`

## 生产环境部署

生产环境需要注意：
- 配置资源限制
- 使用健康检查
- 配置日志驱动
- 设置重启策略

## 总结

Docker 容器化已成为现代应用部署的标准实践。遵循最佳实践可以构建更安全、高效的容器化应用。`,
      metadata: {
        tags: ['Docker', '容器化', 'DevOps'],
      },
    },
    {
      title: 'Git 工作流与团队协作',
      slug: 'git-workflow-team-collaboration',
      category: 'article',
      status: 'published',
      body: `## Git 工作流概述

选择合适的 Git 工作流对团队协作效率至关重要。

### 常见工作流模式

#### 1. Git Flow

适合有明确发布周期的项目：

- \`main\`：生产环境分支
- \`develop\`：开发集成分支
- \`feature/*\`：功能分支
- \`release/*\`：发布分支
- \`hotfix/*\`：紧急修复分支

#### 2. GitHub Flow

简化版工作流，适合持续部署：

- \`main\` 始终可部署
- 从 main 创建分支
- 通过 Pull Request 合并
- 合并后立即部署

#### 3. GitLab Flow

结合了 Git Flow 和 GitHub Flow 的优点：

- 上游分支追踪下游分支
- 支持环境和分支的对应关系
- 更加灵活的分支策略

## 分支管理最佳实践

### 分支命名规范

\`\`\`
feature/add-user-authentication
bugfix/login-error-handling
hotfix/security-patch-2024
release/v1.2.0
\`\`\`

### 提交信息规范

使用 Conventional Commits 规范：

\`\`\`
feat: 添加用户登录功能
fix: 修复支付页面验证错误
docs: 更新 API 文档
refactor: 重构数据访问层
test: 添加用户服务测试
\`\`\`

## 代码审查流程

### Pull Request 模板

\`\`\`markdown
## 变更说明
简要描述本次变更的内容

## 变更类型
- [ ] 新功能
- [ ] Bug 修复
- [ ] 重构
- [ ] 文档更新

## 测试情况
描述已完成的测试

## 截图（如适用）
添加相关截图
\`\`\`

### 审查要点

- 代码质量和风格一致性
- 逻辑正确性和边界情况
- 测试覆盖是否充分
- 文档是否同步更新

## 冲突解决

### 预防冲突

- 保持分支短小精悍
- 频繁同步上游分支
- 及时沟通开发计划

### 解决冲突步骤

1. 更新本地分支
2. 识别冲突文件
3. 逐个解决冲突
4. 测试验证
5. 提交并推送

## 总结

良好的 Git 工作流和团队协作规范是项目成功的关键。选择适合团队规模和项目特点的工作流，并严格执行相关规范。`,
      metadata: {
        tags: ['Git', '团队协作', '工作流'],
      },
    },
  ];

  for (const article of articles) {
    await prisma.content.upsert({
      where: { slug: article.slug },
      update: {
        title: article.title,
        body: article.body,
        category: article.category,
        status: article.status,
      },
      create: article,
    });
  }
  console.log(`已插入 ${articles.length} 篇文章`);

  // ============================================================
  // 3. Projects
  // ============================================================
  const projects = [
    {
      title: 'yechayo',
      slug: 'yechayo',
      category: 'project',
      status: 'published',
      body: '',
      metadata: {
        url: '#',
        icon: 'database',
        description: '基于 RAG 的个人知识库问答系统',
      },
    },
    {
      title: 'DevTools',
      slug: 'dev-tools',
      category: 'project',
      status: 'published',
      body: '',
      metadata: {
        url: '#',
        icon: 'code',
        description: '开发工具集合',
      },
    },
  ];

  for (const project of projects) {
    await prisma.content.upsert({
      where: { slug: project.slug },
      update: {
        title: project.title,
        category: project.category,
        status: project.status,
        metadata: project.metadata,
      },
      create: project,
    });
  }
  console.log(`已插入 ${projects.length} 个项目`);

  // ============================================================
  // 4. Slogans
  // ============================================================
  const slogans = [
    {
      title: '代码是写给人看的，顺便能在机器上运行',
      slug: 'code-for-humans',
      category: 'slogan',
      status: 'published',
      body: '',
      metadata: {
        author: 'Harold Abelson',
      },
    },
    {
      title: 'Stay hungry, stay foolish',
      slug: 'stay-hungry-foolish',
      category: 'slogan',
      status: 'published',
      body: '',
      metadata: {
        author: 'Steve Jobs',
      },
    },
  ];

  for (const slogan of slogans) {
    await prisma.content.upsert({
      where: { slug: slogan.slug },
      update: {
        title: slogan.title,
        category: slogan.category,
        status: slogan.status,
        metadata: slogan.metadata,
      },
      create: slogan,
    });
  }
  console.log(`已插入 ${slogans.length} 条签名`);

  // ============================================================
  // 5. Pages
  // ============================================================
  const pages = [
    {
      title: '关于我',
      slug: 'about',
      category: 'page',
      status: 'published',
      body: '这是一个关于我的页面。这里可以介绍个人背景、技能、经历等信息。',
      metadata: {
        order: 1,
      },
    },
  ];

  for (const page of pages) {
    await prisma.content.upsert({
      where: { slug: page.slug },
      update: {
        title: page.title,
        body: page.body,
        category: page.category,
        status: page.status,
        metadata: page.metadata,
      },
      create: page,
    });
  }
  console.log(`已插入 ${pages.length} 个页面`);

  console.log('种子数据插入完成!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
