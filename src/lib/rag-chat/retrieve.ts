import { generateEmbedding, vectorToPostgresFormat } from "@/lib/embedding";
import { generateHeadingAnchor } from "@/lib/heading-anchor";
import { prisma } from "@/lib/prisma";
import type { GroupedChunk, GroupedResult, SourceCitation } from "./types";

interface ChunkRow {
  id: string;
  contentId: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  score: number;
  chunkType: string;
  headingLevel: number | null;
  headingAnchor: string | null;
  headingText: string | null;
  sectionPath: string | null;
  sourceTitle: string | null;
  sourceSlug: string | null;
  sourceCategory: string | null;
  sourceTags: unknown;
}

const DEFAULT_LIMITS: Record<keyof GroupedResult, number> = {
  nav_structure: 2,
  content_meta: 5,
  toc_entry: 5,
  content_body: 8,
};

export async function retrieveGrouped(
  query: string,
  limits: Partial<Record<keyof GroupedResult, number>> = {}
): Promise<GroupedResult> {
  const queryEmbedding = await generateEmbedding(query);
  const embeddingStr = vectorToPostgresFormat(queryEmbedding);
  const mergedLimits = { ...DEFAULT_LIMITS, ...limits };
  const groups = emptyGroupedResult();

  await Promise.all((Object.keys(DEFAULT_LIMITS) as Array<keyof GroupedResult>).map(async (chunkType) => {
    const limit = mergedLimits[chunkType];
    const rows = await prisma.$queryRaw<ChunkRow[]>`
      SELECT
        c.id,
        c."contentId",
        co.title,
        co.slug,
        co.category,
        c.content,
        1 - (c.embedding <=> ${embeddingStr}::vector(256)) AS score,
        c."chunkType",
        c."headingLevel",
        c."headingAnchor",
        c."headingText",
        c."sectionPath",
        c."sourceTitle",
        c."sourceSlug",
        c."sourceCategory",
        c."sourceTags"
      FROM "Chunk" c
      JOIN "Content" co ON c."contentId" = co.id
      WHERE co.status = 'published'
        AND c.embedding IS NOT NULL
        AND c."chunkType" = ${chunkType}
      ORDER BY c.embedding <=> ${embeddingStr}::vector(256) ASC
      LIMIT ${limit}
    `;
    groups[chunkType] = rows.map(formatRow);
  }));

  return groups;
}

export function emptyGroupedResult(): GroupedResult {
  return {
    nav_structure: [],
    content_meta: [],
    toc_entry: [],
    content_body: [],
  };
}

export function buildKnowledgeBaseContext(grouped: GroupedResult): string {
  return `## 网站结构\n${buildNavSection(grouped.nav_structure)}\n\n` +
    `## 相关内容概览\n${buildContentMetaSection(grouped.content_meta)}\n\n` +
    `## 相关目录\n${buildTocSection(grouped.toc_entry)}\n\n` +
    `## 详细内容\n${buildContentBodySection(grouped.content_body)}`;
}

export function extractSources(grouped: GroupedResult): SourceCitation[] {
  const seen = new Map<string, SourceCitation>();

  for (const chunk of grouped.content_body) {
    const headingAnchor = chunk.headingText
      ? generateHeadingAnchor(chunk.headingText)
      : chunk.headingAnchor || null;
    const key = `${chunk.category}/${chunk.slug}#${headingAnchor || ""}`;
    if (!seen.has(key)) {
      seen.set(key, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor,
        headingText: chunk.headingText || null,
        sectionPath: chunk.sectionPath || null,
        contentPreview: preview(chunk.content),
      });
    }
  }

  const bodySlugs = new Set(grouped.content_body.map((c) => c.slug));
  for (const chunk of grouped.content_meta) {
    if (bodySlugs.has(chunk.slug)) continue;
    const key = `${chunk.category}/${chunk.slug}`;
    if (!seen.has(key)) {
      seen.set(key, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: null,
        headingText: null,
        sectionPath: null,
        contentPreview: preview(chunk.content),
      });
    }
  }

  return Array.from(seen.values());
}

export async function searchKnowledgeBase(query: string): Promise<string> {
  const grouped = await retrieveGrouped(query, { content_body: 5, content_meta: 3, toc_entry: 2, nav_structure: 1 });
  const sources = extractSources(grouped);
  return JSON.stringify({
    context: buildKnowledgeBaseContext(grouped),
    sources,
  });
}

function formatRow(row: ChunkRow): GroupedChunk {
  return {
    chunkId: row.id,
    contentId: row.contentId,
    title: row.title,
    slug: row.slug,
    category: row.category,
    content: row.content,
    score: row.score,
    chunkType: row.chunkType,
    headingLevel: row.headingLevel,
    headingAnchor: row.headingAnchor,
    headingText: row.headingText,
    sectionPath: row.sectionPath,
    sourceTitle: row.sourceTitle,
    sourceTags: Array.isArray(row.sourceTags) ? row.sourceTags as string[] : [],
  };
}

function buildNavSection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return "暂无站点结构信息";
  return chunks.map((c) => c.content).join("\n");
}

function buildContentMetaSection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return "暂无相关内容概览";
  return chunks.map((c, i) => {
    const tags = c.sourceTags?.length ? ` - ${c.sourceTags.join(", ")}` : "";
    return `[${i + 1}] 《${c.title}》- ${c.category}${tags} (链接: /${c.category}/${c.slug}) - ${preview(c.content, 150)}`;
  }).join("\n");
}

function buildTocSection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return "暂无相关目录信息";
  return chunks.map((c, i) => `[${i + 1}] 《${c.title}》目录: ${c.sectionPath || c.content}`).join("\n");
}

function buildContentBodySection(chunks: GroupedChunk[]): string {
  if (chunks.length === 0) return "暂无详细内容";
  return chunks.map((c, i) => {
    const anchor = c.headingText ? generateHeadingAnchor(c.headingText) : c.headingAnchor;
    const link = anchor ? `/${c.category}/${c.slug}#${anchor}` : `/${c.category}/${c.slug}`;
    return `[${i + 1}] 《${c.title}》${c.sectionPath ? `- ${c.sectionPath}` : ""} (链接: ${link})\n${c.content}`;
  }).join("\n\n---\n\n");
}

function preview(content: string, max = 100): string {
  return content.length > max ? `${content.slice(0, max)}...` : content;
}
