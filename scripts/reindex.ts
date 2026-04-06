/**
 * 一次性全量索引脚本
 * 用法: npx tsx scripts/reindex.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { generateContentChunks, generateContentHash } from '../src/lib/chunkGenerator';
import { generateSiteStructureChunks } from '../src/lib/siteIndexer';
import { generateEmbeddings, vectorToPostgresFormat } from '../src/lib/embedding';
import { randomUUID } from 'crypto';

// 初始化 Prisma
const connectionString = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function insertChunks(
  chunks: ReturnType<typeof generateContentChunks>,
  embeddings: number[][],
  contentId: string,
) {
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = randomUUID();
    const chunk = chunks[i];
    await prisma.$queryRaw`
      INSERT INTO "Chunk" (
        id, content, "contentHash", embedding, "contentId", "createdAt",
        "chunkType", "headingLevel", "headingAnchor", "headingText",
        "sourceTitle", "sourceSlug", "sourceCategory", "sourceTags", "sectionPath"
      ) VALUES (
        ${chunkId},
        ${chunk.content},
        ${generateContentHash(chunk.content)},
        ${vectorToPostgresFormat(embeddings[i])}::vector(256),
        ${contentId},
        DEFAULT,
        ${chunk.chunkType},
        ${chunk.headingLevel ?? null},
        ${chunk.headingAnchor ?? null},
        ${chunk.headingText ?? null},
        ${chunk.sourceTitle ?? null},
        ${chunk.sourceSlug ?? null},
        ${chunk.sourceCategory ?? null},
        ${JSON.stringify(chunk.sourceTags ?? [])}::jsonb,
        ${chunk.sectionPath ?? null}
      )
    `;
  }
}

async function main() {
  console.log('🔍 正在获取所有已发布内容...');

  const allContent = await prisma.content.findMany({
    where: { status: 'published' },
  });

  if (allContent.length === 0) {
    console.log('❌ 没有已发布的内容，无需索引');
    return;
  }

  console.log(`📋 找到 ${allContent.length} 篇已发布内容`);

  // 清空现有 chunks
  console.log('🗑️  清空现有索引...');
  await prisma.chunk.deleteMany({});

  let totalChunks = 0;
  let processed = 0;

  for (const content of allContent) {
    if (!content.body || content.body.trim().length === 0) {
      console.log(`   ⏭️  跳过 (正文为空): ${content.title}`);
      continue;
    }

    processed++;
    console.log(`   📝 [${processed}/${allContent.length}] ${content.title}...`);

    const chunks = generateContentChunks(content.body, {
      id: content.id,
      title: content.title,
      slug: content.slug,
      category: content.category,
      metadata: (content.metadata as Record<string, unknown>) || {},
    });

    if (chunks.length === 0) continue;

    // 分批生成 embedding（每批 8 个）
    const embeddings = await generateEmbeddings(chunks.map(c => c.content));
    await insertChunks(chunks, embeddings, content.id);

    totalChunks += chunks.length;
    console.log(`      ✅ 生成 ${chunks.length} 个分块 (body:${chunks.filter(c => c.chunkType === 'content_body').length}, meta:${chunks.filter(c => c.chunkType === 'content_meta').length}, toc:${chunks.filter(c => c.chunkType === 'toc_entry').length})`);

    // 避免 API 限速
    await sleep(200);
  }

  // 生成 nav_structure 分块
  console.log('   🏗️  生成网站结构索引...');
  const siteItems = allContent.map(c => ({
    title: c.title,
    slug: c.slug,
    category: c.category,
    metadata: (c.metadata as Record<string, unknown>) || {},
  }));

  const navChunks = generateSiteStructureChunks(siteItems);
  if (navChunks.length > 0) {
    const fallbackContentId = allContent[0].id;
    const navEmbeddings = await generateEmbeddings(navChunks.map(c => c.content));
    await insertChunks(navChunks, navEmbeddings, fallbackContentId);
    totalChunks += navChunks.length;
    console.log(`      ✅ 生成 ${navChunks.length} 个导航结构分块`);
  }

  console.log('');
  console.log('=========================================');
  console.log(`🎉 索引重建完成！`);
  console.log(`   处理内容: ${processed} 篇`);
  console.log(`   总分块数: ${totalChunks}`);
  console.log(`   导航结构: ${navChunks.length} 个`);
  console.log('=========================================');

  await pool.end();
}

main().catch(async (error) => {
  console.error('❌ 索引失败:', error);
  await pool.end();
  process.exit(1);
});
