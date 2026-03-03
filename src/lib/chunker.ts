import { PDFPage } from './pdf-parser';

export interface Chunk {
  content: string;
  pageStart: number;
  pageEnd: number;
  contentHash?: string;
}

export interface ChunkingOptions {
  chunkSize: number;      // 每个 chunk 的最大字符数
  chunkOverlap: number;   // chunk 之间的重叠字符数
}

const DEFAULT_OPTIONS: ChunkingOptions = {
  chunkSize: 1000,
  chunkOverlap: 200,
};

/**
 * 将 PDF 页面文本分块
 * 遵循不跨页原则，每个 chunk 都在单一页面内
 */
export function chunkPages(pages: PDFPage[], options: Partial<ChunkingOptions> = {}): Chunk[] {
  const { chunkSize, chunkOverlap } = { ...DEFAULT_OPTIONS, ...options };
  const chunks: Chunk[] = [];

  for (const page of pages) {
    if (!page.text.trim()) continue;

    const pageChunks = splitTextIntoChunks(page.text, page.pageNumber, chunkSize, chunkOverlap);
    chunks.push(...pageChunks);
  }

  return chunks;
}

/**
 * 将单个页面的文本分割成多个 chunk
 */
function splitTextIntoChunks(text: string, pageNumber: number, chunkSize: number, overlap: number): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  let currentChunk = '';

  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();

    // 如果当前 chunk 为空，直接添加段落
    if (!currentChunk) {
      currentChunk = trimmedParagraph;
    }
    // 如果添加段落不超过限制，则添加
    else if (currentChunk.length + trimmedParagraph.length + 2 <= chunkSize) {
      currentChunk += '\n\n' + trimmedParagraph;
    }
    // 否则，保存当前 chunk 并开始新的 chunk
    else {
      if (currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          pageStart: pageNumber,
          pageEnd: pageNumber,
        });
      }

      // 处理重叠：保留上一 chunk 的最后部分
      if (overlap > 0 && currentChunk.length > overlap) {
        const overlapText = currentChunk.slice(-overlap);
        const lastSentenceEnd = Math.max(
          overlapText.lastIndexOf('。'),
          overlapText.lastIndexOf('.'),
          overlapText.lastIndexOf('！'),
          overlapText.lastIndexOf('？'),
          overlapText.lastIndexOf('\n')
        );

        if (lastSentenceEnd > 0) {
          currentChunk = overlapText.slice(lastSentenceEnd + 1).trim() + '\n\n' + trimmedParagraph;
        } else {
          currentChunk = trimmedParagraph;
        }
      } else {
        currentChunk = trimmedParagraph;
      }
    }
  }

  // 保存最后一个 chunk
  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      pageStart: pageNumber,
      pageEnd: pageNumber,
    });
  }

  return chunks;
}

/**
 * 生成内容的简单哈希（用于去重）
 */
export function generateContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * 合并过小的相邻 chunks（可选优化）
 */
export function mergeSmallChunks(chunks: Chunk[], minSize: number = 100): Chunk[] {
  if (chunks.length === 0) return chunks;

  const merged: Chunk[] = [];
  let current = { ...chunks[0] };

  for (let i = 1; i < chunks.length; i++) {
    const next = chunks[i];

    // 只有同一页且当前 chunk 太小时才合并
    if (current.pageEnd === next.pageStart &&
        current.content.length < minSize &&
        current.content.length + next.content.length < 1500) {
      current.content += '\n\n' + next.content;
      current.pageEnd = next.pageEnd;
    } else {
      if (current.content.trim()) {
        merged.push(current);
      }
      current = { ...next };
    }
  }

  if (current.content.trim()) {
    merged.push(current);
  }

  return merged;
}
