import { randomUUID } from "crypto";

import { generateContentChunks, generateContentHash, type GeneratedChunk } from "@/lib/chunkGenerator";
import { generateEmbeddings, vectorToPostgresFormat } from "@/lib/embedding";
import { buildImageDataUrl } from "@/lib/oss";
import { prisma } from "@/lib/prisma";
import { describeImage } from "@/lib/vision";

export interface IndexableContent {
  id: string;
  title: string;
  slug: string;
  body: string;
  category: string;
  metadata: unknown;
}

export interface IndexContentResult {
  totalChunks: number;
  contentBody: number;
  contentMeta: number;
  tocEntry: number;
  imageDescriptions: number;
  warnings?: {
    visionFailedImages: string[];
  };
}

interface ChunkWriteTransaction {
  chunk: {
    deleteMany(args: { where: { contentId: string } }): Promise<unknown>;
  };
  $queryRaw: typeof prisma.$queryRaw;
}

function asMetadataRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

function extractTags(metadata: Record<string, unknown>): string[] {
  const tags = metadata.tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}

async function insertChunks(
  tx: ChunkWriteTransaction,
  chunks: GeneratedChunk[],
  embeddings: number[][],
  contentId: string
) {
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = randomUUID();
    const chunk = chunks[i];

    await tx.$queryRaw`
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

async function buildImageDescriptionChunks(
  content: IndexableContent,
  metadata: Record<string, unknown>
): Promise<{ chunks: GeneratedChunk[]; failedImages: string[] }> {
  const imageUrlRegex = /\/api\/images\/([a-z0-9]+)/g;
  const imageIds = new Set<string>();

  const bodyMatches = content.body.matchAll(imageUrlRegex);
  for (const match of bodyMatches) imageIds.add(match[1]);

  const coverImage = metadata.coverImage;
  if (typeof coverImage === "string") {
    const coverMatches = coverImage.matchAll(imageUrlRegex);
    for (const match of coverMatches) imageIds.add(match[1]);
  }

  const chunks: GeneratedChunk[] = [];
  const failedImages: string[] = [];

  for (const imageId of imageIds) {
    try {
      const image = await prisma.image.findUnique({ where: { id: imageId } });
      if (!image) {
        failedImages.push(imageId);
        continue;
      }

      const dataUrl = await buildImageDataUrl(image);
      if (!dataUrl) {
        failedImages.push(`${imageId}(image file not found)`);
        continue;
      }

      const description = await describeImage(dataUrl);
      chunks.push({
        content: `[图片描述] ${description}`,
        chunkType: "content_body",
        sourceTitle: content.title,
        sourceSlug: content.slug,
        sourceCategory: content.category,
        sourceTags: extractTags(metadata),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failedImages.push(`${imageId}(${msg})`);
    }
  }

  return { chunks, failedImages };
}

export async function indexContent(content: IndexableContent): Promise<IndexContentResult> {
  if (!content.body || content.body.trim().length === 0) {
    throw new Error("Content body is empty");
  }

  const metadata = asMetadataRecord(content.metadata);
  const chunks = generateContentChunks(content.body, {
    id: content.id,
    title: content.title,
    slug: content.slug,
    category: content.category,
    metadata,
  });

  if (chunks.length === 0) {
    throw new Error("No valid chunks generated from body");
  }

  const imageResult = await buildImageDescriptionChunks(content, metadata);
  const allChunks = [...chunks, ...imageResult.chunks];
  const embeddings = await generateEmbeddings(allChunks.map((chunk) => chunk.content));

  await prisma.$transaction(async (tx) => {
    const writer = tx as unknown as ChunkWriteTransaction;
    await writer.chunk.deleteMany({ where: { contentId: content.id } });
    await insertChunks(writer, allChunks, embeddings, content.id);
  }, {
    maxWait: 10000,
    timeout: 120000,
  });

  return {
    totalChunks: allChunks.length,
    contentBody: allChunks.filter((chunk) => chunk.chunkType === "content_body").length,
    contentMeta: allChunks.filter((chunk) => chunk.chunkType === "content_meta").length,
    tocEntry: allChunks.filter((chunk) => chunk.chunkType === "toc_entry").length,
    imageDescriptions: imageResult.chunks.length,
    ...(imageResult.failedImages.length > 0
      ? { warnings: { visionFailedImages: imageResult.failedImages } }
      : {}),
  };
}
