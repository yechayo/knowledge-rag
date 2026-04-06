/**
 * 内容分块生成器 - 为 RAG 系统提供带标题上下文的类型化分块
 *
 * 支持 4 种分块类型：
 * - content_body: 正文内容分块（带标题上下文）
 * - content_meta: 单条内容的元信息摘要
 * - toc_entry: 单条内容的目录结构
 * - nav_structure: 整站导航结构（见 siteIndexer.ts）
 */

// ============================================================
// 类型定义
// ============================================================

import { generateHeadingAnchor } from './heading-anchor';

export type ChunkType = 'content_body' | 'content_meta' | 'toc_entry' | 'nav_structure';

export interface GeneratedChunk {
  /** 分块文本内容 */
  content: string;
  /** 分块类型 */
  chunkType: ChunkType;
  /** 最近标题的层级（2 或 3），无标题时为 undefined */
  headingLevel?: number;
  /** 最近标题的锚点 ID */
  headingAnchor?: string;
  /** 最近标题的文本 */
  headingText?: string;
  /** 完整的章节路径，如 "1. Hooks > 1.1 useState" */
  sectionPath?: string;
  /** 来源内容标题 */
  sourceTitle: string;
  /** 来源内容的 slug */
  sourceSlug: string;
  /** 来源内容的分类 */
  sourceCategory: string;
  /** 来源内容的标签 */
  sourceTags: string[];
}

/** generateContentChunks 的输入参数 */
export interface ContentInput {
  id: string;
  title: string;
  slug: string;
  category: string;
  /** JSON 对象，通常包含 tags: string[] */
  metadata: Record<string, unknown>;
}

// ============================================================
// 内部工具函数
// ============================================================

/**
 * 从 Markdown 原文解析标题列表
 * 仅提取 h2 (##) 和 h3 (###)
 */
interface ParsedHeading {
  level: number;      // 2 或 3
  text: string;       // 标题文本
  anchor: string;     // 锚点 ID
  index: string;      // 带序号的标题，如 "1.1 useState"
  sectionPath: string; // 完整路径，如 "1. Hooks > 1.1 useState"
}

const HEADING_REGEX = /^(#{2,3})\s+(.+)$/gm;

function parseHeadings(body: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  let match;

  // 重置正则状态
  const regex = new RegExp(HEADING_REGEX.source, HEADING_REGEX.flags);

  while ((match = regex.exec(body)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const anchor = generateHeadingAnchor(text);
    headings.push({ level, text, anchor, index: '', sectionPath: '' });
  }

  // 构建带序号的标题路径
  let h2Count = 0;
  let h3Count = 0;

  for (const heading of headings) {
    if (heading.level === 2) {
      h2Count++;
      h3Count = 0;
      heading.index = `${h2Count}. ${heading.text}`;
      heading.sectionPath = heading.index;
    } else if (heading.level === 3) {
      h3Count++;
      const h2Heading = [...headings]
        .reverse()
        .find(h => h.level === 2 && headings.indexOf(h) < headings.indexOf(heading));
      const parentPrefix = h2Heading ? `${h2Count}` : '0';
      heading.index = `${parentPrefix}.${h3Count} ${heading.text}`;
      heading.sectionPath = h2Heading
        ? `${h2Heading.index} > ${heading.index}`
        : heading.index;
    }
  }

  return headings;
}

/**
 * 分类值到中文标签的映射
 */
const CATEGORY_LABELS: Record<string, string> = {
  article: '文章',
  project: '项目',
  note: '笔记',
  page: '页面',
};

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category;
}

/**
 * 从 metadata 中提取标签数组
 */
function extractTags(metadata: Record<string, unknown>): string[] {
  const tags = metadata?.tags;
  if (Array.isArray(tags)) {
    return tags.filter((t): t is string => typeof t === 'string');
  }
  return [];
}

/**
 * 生成内容的简单哈希（用于去重）
 */
export function generateContentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// ============================================================
// 分块大小控制
// ============================================================

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 100;

/**
 * 按标题分割后，对每个段落进行 ~chunkSize 的字符切分，支持重叠
 * 返回的每个切分都带有对应的标题上下文信息
 */
function splitSectionIntoChunks(
  sectionText: string,
  heading: ParsedHeading | null,
  baseInfo: Pick<GeneratedChunk, 'sourceTitle' | 'sourceSlug' | 'sourceCategory' | 'sourceTags'>,
  chunkSize: number,
  overlap: number,
): GeneratedChunk[] {
  if (!sectionText.trim()) return [];

  const chunks: GeneratedChunk[] = [];
  let buffer = '';

  const baseChunk: Omit<GeneratedChunk, 'content'> = {
    chunkType: 'content_body',
    headingLevel: heading?.level,
    headingAnchor: heading?.anchor,
    headingText: heading?.text,
    sectionPath: heading?.sectionPath,
    ...baseInfo,
  };

  // 按段落分割，优先在段落边界切分
  const paragraphs = sectionText.split(/\n\s*\n/).filter(p => p.trim());

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();

    if (!buffer) {
      buffer = trimmed;
    } else if (buffer.length + trimmed.length + 2 <= chunkSize) {
      buffer += '\n\n' + trimmed;
    } else {
      // 保存当前 buffer 作为 chunk
      if (buffer.trim()) {
        chunks.push({ ...baseChunk, content: buffer.trim() });
      }

      // 保留重叠部分
      if (overlap > 0 && buffer.length > overlap) {
        const overlapText = buffer.slice(-overlap);
        const lastSentenceEnd = Math.max(
          overlapText.lastIndexOf('。'),
          overlapText.lastIndexOf('.'),
          overlapText.lastIndexOf('!'),
          overlapText.lastIndexOf('?'),
          overlapText.lastIndexOf('\n'),
        );
        if (lastSentenceEnd > 0) {
          buffer = overlapText.slice(lastSentenceEnd + 1).trim() + '\n\n' + trimmed;
        } else {
          buffer = trimmed;
        }
      } else {
        buffer = trimmed;
      }
    }
  }

  // 保存最后的 buffer
  if (buffer.trim()) {
    chunks.push({ ...baseChunk, content: buffer.trim() });
  }

  return chunks;
}

// ============================================================
// 导出：主函数
// ============================================================

/**
 * 为单条内容生成所有类型的分块
 *
 * @param body - Markdown 格式的正文
 * @param content - 内容元数据（id, title, slug, category, metadata）
 * @param chunkSize - 正文分块的最大字符数（默认 500）
 * @param overlap - 正文分块之间的重叠字符数（默认 100）
 * @returns 所有类型的分块列表
 */
export function generateContentChunks(
  body: string,
  content: ContentInput,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP,
): GeneratedChunk[] {
  const result: GeneratedChunk[] = [];

  const tags = extractTags(content.metadata);
  const baseInfo: Pick<GeneratedChunk, 'sourceTitle' | 'sourceSlug' | 'sourceCategory' | 'sourceTags'> = {
    sourceTitle: content.title,
    sourceSlug: content.slug,
    sourceCategory: content.category,
    sourceTags: tags,
  };

  // 1. 解析标题
  const headings = parseHeadings(body);

  // 2. 生成 content_body 分块 - 按标题分割，再按字符数切分
  const sections = body.split(/(?=#{2,3}\s)/).filter(s => s.trim());

  let currentHeading: ParsedHeading | null = null;
  let headingIndex = 0;

  for (const section of sections) {
    // 检查当前段落是否以标题开头
    const headingMatch = section.match(/^(#{2,3})\s+(.+)$/m);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const anchor = generateHeadingAnchor(text);

      // 查找对应的已解析标题（包含序号和路径信息）
      const found = headings.find(h => h.anchor === anchor);
      if (found) {
        currentHeading = found;
      } else {
        currentHeading = {
          level,
          text,
          anchor,
          index: text,
          sectionPath: text,
        };
      }
    }

    // 对段落进行字符级切分
    const sectionChunks = splitSectionIntoChunks(
      section,
      currentHeading,
      baseInfo,
      chunkSize,
      overlap,
    );
    result.push(...sectionChunks);

    headingIndex++;
  }

  // 3. 生成 content_meta 分块
  const categoryLabel = getCategoryLabel(content.category);
  const bodyPreview = body.replace(/#{1,3}\s.+/g, '').trim().slice(0, 200);
  const tagsStr = tags.length > 0 ? tags.join(', ') : '无';

  result.push({
    content: `\u300A${content.title}\u300B| 分类：${categoryLabel} | 标签：${tagsStr} | 简介：${bodyPreview}`,
    chunkType: 'content_meta',
    sourceTitle: content.title,
    sourceSlug: content.slug,
    sourceCategory: content.category,
    sourceTags: tags,
  });

  // 4. 生成 toc_entry 分块
  if (headings.length > 0) {
    const headingPaths = headings.map(h => h.index).join(' | ');
    result.push({
      content: `\u300A${content.title}\u300B目录 - ${headingPaths}`,
      chunkType: 'toc_entry',
      sourceTitle: content.title,
      sourceSlug: content.slug,
      sourceCategory: content.category,
      sourceTags: tags,
    });
  }

  return result;
}
