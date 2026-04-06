/**
 * 站点索引生成器 - 生成描述整站结构的 nav_structure 类型分块
 *
 * 用于 RAG 检索时提供全局上下文，帮助模型理解网站的整体结构和内容分布。
 */

import type { GeneratedChunk } from './chunkGenerator';

// ============================================================
// 类型定义
// ============================================================

/** generateSiteStructureChunks 的输入参数 */
export interface SiteContentItem {
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
 * 分类值到中文标签的映射
 */
const CATEGORY_LABELS: Record<string, string> = {
  article: '文章',
  project: '项目',
  note: '笔记',
  page: '页面',
};

const CATEGORY_UNITS: Record<string, string> = {
  article: '篇',
  project: '个',
  note: '篇',
  page: '个',
};

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

// ============================================================
// 导出：主函数
// ============================================================

/**
 * 生成描述整站结构的 nav_structure 分块
 *
 * 产出两类分块：
 * 1. 站点概览分块（1 个）- 汇总全站的分类统计、标签和路由信息
 * 2. 分类详情分块（每类有内容时 1 个）- 列出该分类下的所有标题
 *
 * @param allContent - 站点所有已发布内容的列表
 * @returns nav_structure 类型的分块数组
 */
export function generateSiteStructureChunks(
  allContent: SiteContentItem[],
  categoryLabels?: Record<string, string>,
): GeneratedChunk[] {
  const result: GeneratedChunk[] = [];

  if (allContent.length === 0) {
    return result;
  }

  // ---- 按分类聚合 ----
  const categoryMap = new Map<string, SiteContentItem[]>();

  for (const item of allContent) {
    const cat = item.category || 'article';
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat)!.push(item);
  }

  // ---- 收集所有标签 ----
  const tagSet = new Set<string>();
  for (const item of allContent) {
    const tags = extractTags(item.metadata);
    for (const tag of tags) {
      tagSet.add(tag);
    }
  }
  const allTags = [...tagSet];

  // ---- 1. 站点概览分块 ----
  const categoryDescriptions: string[] = [];
  for (const [category, items] of categoryMap) {
    const label = categoryLabels?.[category] || CATEGORY_LABELS[category] || category;
    const unit = CATEGORY_UNITS[category] || '个';
    categoryDescriptions.push(`${label}(${items.length}${unit})`);
  }

  const tagsDescription = allTags.length > 0
    ? `${allTags.slice(0, 10).join(', ')}${allTags.length > 10 ? '等' : ''}`
    : '暂无标签';

  const routes = [...categoryMap.keys()]
    .map(cat => `/${cat}`)
    .join(', ');

  result.push({
    content: `本站是一个知识库网站，包含以下分类：${categoryDescriptions.join('、')}。文章标签有：${tagsDescription}。主要路由：${routes}。`,
    chunkType: 'nav_structure',
    sourceTitle: '站点概览',
    sourceSlug: '',
    sourceCategory: '__site__',
    sourceTags: [],
  });

  // ---- 2. 分类详情分块 ----
  for (const [category, items] of categoryMap) {
    const label = categoryLabels?.[category] || CATEGORY_LABELS[category] || category;
    const unit = CATEGORY_UNITS[category] || '个';

    const titleList = items
      .map((item, idx) => `${idx + 1}. ${item.title}`)
      .join(' ');

    result.push({
      content: `${label}分类下有 ${items.length} ${unit}内容：${titleList}`,
      chunkType: 'nav_structure',
      sourceTitle: `${label}分类`,
      sourceSlug: `/${category}`,
      sourceCategory: category,
      sourceTags: allTags,
    });
  }

  return result;
}
