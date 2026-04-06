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
      title: 'KnowledgeRag',
      slug: 'knowledge-rag',
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
