# Knowledge RAG - 基于 Next.js 的全栈个人知识库问答系统

> 🎓 **大学生项目经历展示作品**
> 一个基于 RAG (Retrieval-Augmented Generation) 架构的文档问答系统。支持上传 PDF 构建知识库，通过向量检索与大模型（GLM-5）进行精准问答，并支持点击引用直接跳转到 PDF 原文页码。

---

## 🏗️ 系统架构

```ascii
+------------------+       +-------------------+       +-------------------------+
|   Client (Browser)|       |   Next.js Server  |       |      External Services  |
+------------------+       +-------------------+       +-------------------------+
|                  |       |                   |       |                         |
| 1. User Auth     +------->  NextAuth (Auth)  +------->  Postgres (User/Session)|
| (Login/Register) |       |                   |       |                         |
|                  |       |                   |       |                         |
| 2. Upload PDF    +------->  API: Upload      +------->  Local Storage / S3     |
|                  |       |                   |       |                         |
| 3. Managing KBs  +------->  Prisma (ORM)     +------->  Postgres (Meta Data)   |
|                  |       |                   |       |                         |
| 4. Indexing      +------->  Indexing Worker  +------>  Zhipu AI (Embedding-3) |
| (Click trigger)  |       |  (PDF Parser)     |   +--->  Postgres (pgvector)    |
|                  |       |                   |   |   |                         |
| 5. Chat & RAG    +------->  Chat API         +---+   |  Zhipu AI (GLM-5)       |
| (View Citations) |       |  (Retrieval)      |       |                         |
|                  |       |                   |       |                         |
+------------------+       +-------------------+       +-------------------------+
```

## 🚀 功能列表

### MVP 核心功能
*   **用户认证**：邮箱+密码注册登录（Credentials），基于数据库 Session，数据按用户隔离。
*   **知识库管理**：创建/删除知识库，上传 PDF 文件。
*   **手动索引**：上传文件后，需手动点击“开始索引”，支持失败重试。
*   **智能切片**：PDF 按页解析，Chunk 策略优化（不跨页，保留页码元数据）。
*   **RAG 对话**：
    *   Query 向量化（Embedding-3, 256维）。
    *   向量检索（pgvector top-k）。
    *   AI 回答（GLM-5）。
*   **溯源引用**：对话结果展示引用来源，点击引用 **自动跳转至 PDF 对应页码**。

### 技术栈
*   **Frontend**: Next.js 14+ (App Router), TypeScript, Tailwind CSS, pdf.js
*   **Backend**: Next.js API Routes (Server Actions/Route Handlers)
*   **Database**: PostgreSQL + **pgvector**
*   **ORM**: Prisma
*   **Auth**: NextAuth.js (v5 beta or v4)
*   **AI**: Zhipu AI SDK (GLM-5, Embedding-3)
*   **Deploy**: Docker Compose (Tencent Cloud)

---

## 🛠️ 本地运行

1. **环境准备**
   *   Node.js 18+
   *   Docker Desktop (用于运行 Postgres)

2. **安装依赖**
   ```bash
   pnpm install
   ```

3. **配置环境变量**
   复制 `.env.example` 为 `.env` 并填入真实值：
   ```bash
   cp .env.example .env
   ```

4. **启动数据库**
   ```bash
   # 使用 docker-compose 启动带 pgvector 的 postgres
   docker-compose up -d db
   ```

5. **数据库迁移**
   ```bash
   npx prisma migrate dev --name init
   ```

6. **启动开发服务器**
   ```bash
   npm run dev
   ```

---

## 📅 4 周开发里程碑

### Week 1: 地基搭建 (Phase A)
*   [ ] 初始化 Next.js + TS + Tailwind 项目。
*   [ ] 配置 Docker Compose (Postgres + pgvector)。
*   [ ] 集成 Prisma 并完成 Schema 设计（User, Session, Account）。
*   [ ] 集成 NextAuth.js 实现 Credentials 注册/登录/登出。
*   [ ] **验收**：通过数据库 Session 验证登录状态，未登录用户无法访问受保路由。

### Week 2: 核心业务与索引 (Phase B & C & D)
*   [ ] 定义知识库（KB）与文档（Document）数据表。
*   [ ] 实现文件上传 API（保存到本地 uploads 目录）。
*   [ ] 实现 PDF 解析与 Chunk 切分逻辑（关联 Page Number）。
*   [ ] 对接智谱 Embedding API 与 pgvector 入库。
*   [ ] **验收**：上传 PDF -> 点击索引 -> 数据库 chunk 表中生成向量数据。

### Week 3: RAG 闭环与前端交互 (Phase E & F)
*   [ ] 实现 Chat 界面与 API。
*   [ ] 实现向量检索逻辑（Cosine Similarity）。
*   [ ] 编写 Prompt Template 注入上下文。
*   [ ] 前端实现 PDF 预览器与页码跳转功能。
*   [ ] **验收**：提问能得到基于文档的回答，点击引用能跳转 PDF。

### Week 4: 部署与优化 (Phase G)
*   [ ] 编写 Dockerfile (Next.js Standalone)。
*   [ ] 腾讯云服务器环境配置。
*   [ ] 生产环境部署 (API Key 配置, SSL 证书)。
*   [ ] UI 细节打磨与 Bug 修复。

---

## 🧠 技术选型说明 (面试要点)

### 1. 为什么选择 Postgres + pgvector？
*   **一体化架构**：不需要引入额外的向量数据库（如 Milvus/Pinecone），降低维护成本，非常适合中小型项目。
*   **关系+向量混合查询**：可以利用 SQL 强大的能力做权限过滤（`WHERE user_id = ...`）再做向量搜索，数据一致性更有保障。

### 2. 为什么选择 256 维 Embeddings？
*   **成本与性能平衡**：智谱 embedding-3 支持维度裁剪。对于普通文本检索，256 维在保留大部分语义精度的同时，极大地减少了存储空间（索引大小减少 75%）和内存占用，提高了检索速度。

### 3. 为什么选择 Manual Indexing（手动索引）？
*   **用户控制权**：上传文件并不意味着立即想要索引（可能传错了）。
*   **容错与成本**：索引过程消耗 Token 且耗时。手动触发让用户明确“我准备好了”，并且失败时可以针对性重试，而不是在上传接口中通过长时间的 Loading 阻塞用户。

### 4. 为什么 NextAuth + Prisma (Database Session)？
*   **全栈一致性**：Next.js 生态中最成熟的方案。
*   **Database Session**：虽然 JWT 无状态更轻量，但为了实现更严格的安全控制（如服务端强制注销用户、后期管理用户会话），以及应对未来可能复杂的鉴权需求，数据库会话是更稳妥的选择。

---

## 🎤 2 分钟演示脚本

**场景：面试官面前展示项目**

1.  **开场 (0:00-0:20)**: "您好，这是我独立开发的 RAG 知识库系统。它解决了传统文档检索难的问题。我使用了 Next.js 全栈开发，底层数据库是 Postgres 配合 pgvector 实现向量检索。"
2.  **登录与上传 (0:20-0:50)**: (操作演示) "首先，系统支持完整的身份认证。登录后，我们可以创建一个新的知识库，比如'React 官方文档'。接着上传一份 PDF。注意，此时文件仅作为草稿保存。"
3.  **核心亮点：索引 (0:50-1:10)**: "这是我设计的'手动索引'机制。点击开始后，后台会将 PDF 按页切片并计算向量。这一步我特意保留了页码元数据，为了后续的溯源功能。"
4.  **问答与跳转 (1:10-1:40)**: "索引完成后，我们来提问：'React Server Components 是什么？'。您看，AI 输出了答案，并标注了[引用 1]。最关键的是这个功能——**点击引用**，右侧 PDF 阅读器直接跳转到了第 12 页的高亮位置，实现了精准溯源。"
5.  **结尾 (1:40-2:00)**: "整个项目已容器化部署在我的腾讯云服务器上。它虽然小巧，但完整实现了从 RAG 数据处理到前端交互的闭环。谢谢。"
