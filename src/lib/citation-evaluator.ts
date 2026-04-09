/**
 * 引用召回率评估模块
 * 用于评估 RAG 回答中引用的质量
 */

export interface Citation {
  href: string;      // 完整链接
  label: string;     // 缩写内容
}

export interface Source {
  title: string;
  slug: string;
  category: string;
  headingAnchor?: string | null;
  headingText?: string | null;
  sectionPath?: string | null;
  contentPreview: string;
}

export interface CitationDetail {
  citation: string;
  label: string;
  matchedTerms: string[];       // 匹配的关键词
  missingTerms: string[];       // 缺失的关键词
  hasKeyTerms: boolean;
  relevanceScore: number;       // 0-1 相关性分数
}

export interface CitationQualityReport {
  totalCitations: number;        // 总引用数
  relevantCitations: number;      // 相关引用数（hasKeyTerms=true）
  recallRate: number;            // 召回率 0-1
  avgRelevanceScore: number;     // 平均相关性分数
  details: CitationDetail[];
  evaluationTimestamp: string;    // 评估时间
}

/**
 * 停用词列表（中文）
 */
const CHINESE_STOP_WORDS = new Set([
  '的', '了', '是', '在', '和', '有', '我', '你', '他', '她', '它',
  '这', '那', '个', '与', '或', '但', '为', '以', '及', '等', '把',
  '被', '从', '到', '对', '于', '而', '上', '下', '中', '内', '外',
  '不', '没', '没有', '什么', '怎么', '如何', '为什么', '吗', '呢',
  '吧', '啊', '哦', '嗯', '呀', '啦', '嘛', '嘿', '喂',
  '请', '您', '我们', '你们', '他们', '她们', '它们',
  '可以', '能', '会', '应该', '必须', '需要', '想要',
  '一个', '一些', '什么', '哪个', '哪些', '多少', '几',
]);

/**
 * 停用词列表（英文）
 */
const ENGLISH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
]);

/**
 * 从文本中提取关键术语
 * @param text 输入文本
 * @returns 关键术语数组
 */
export function extractKeyTerms(text: string): string[] {
  // 清理文本
  const cleaned = text
    .replace(/[[\]]/g, '')  // 移除 [[ ]]
    .replace(/[[REF:|]]/g, '') // 移除 REF 标记
    .trim();

  // 分词（交替处理中英文）
  const words: string[] = [];

  // 用正则交替提取中文和英文片段
  // 例如: "reacthooks规则是什么" -> ["reacthooks", "规则", "是什么"]
  const mixedPattern = /([a-zA-Z]+)|([\u4e00-\u9fa5]{2,})/g;
  let match;

  while ((match = mixedPattern.exec(cleaned)) !== null) {
    if (match[1]) {
      // 英文字母片段
      const english = match[1];
      // 分割驼峰
      const camelSplit = english.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
      words.push(...camelSplit.filter(w => w.length >= 2));
    } else if (match[2]) {
      // 中文字符片段
      words.push(match[2]);
    }
  }

  // 过滤停用词和短词
  const terms: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (
      word.length >= 2 &&
      !CHINESE_STOP_WORDS.has(word) &&
      !CHINESE_STOP_WORDS.has(lower) &&
      !ENGLISH_STOP_WORDS.has(lower)
    ) {
      terms.push(word);
    }
  }

  // 去重
  return [...new Set(terms)];
}

/**
 * 从回答内容中提取所有引用
 * @param content 回答内容
 * @returns 引用数组
 */
export function extractCitations(content: string): Citation[] {
  const citations: Citation[] = [];
  const pattern = /\[\[REF:([^|\]]+)\|([^\]]+)\]\]/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    citations.push({
      href: match[1],
      label: match[2],
    });
  }

  return citations;
}

/**
 * 将驼峰命名拆分
 * 例如: "reactHooks" -> ["react", "hooks"]
 */
function splitCamelCase(str: string): string[] {
  return str.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/);
}

/**
 * 将连写的英文拆分
 * 例如: "reacthooks" -> ["react", "hooks"]
 */
function splitConcatenatedEnglish(str: string): string[] {
  // 使用常见单词词典来辅助拆分（简化版）
  const commonWords = [
    'react', 'hooks', 'hook', 'use', 'state', 'effect', 'context',
    'callback', 'memo', 'ref', 'reducer', 'dispatch', 'action',
    'component', 'props', 'state', 'effect', 'life', 'cycle',
    'function', 'class', 'async', 'await', 'promise', 'fetch',
    'api', 'http', 'url', 'path', 'route', 'router', 'link',
    'style', 'css', 'class', 'id', 'tag', 'element', 'node',
    'data', 'array', 'object', 'string', 'number', 'boolean',
    'null', 'undefined', 'type', 'interface', 'enum', 'const', 'let',
    'var', 'function', 'return', 'if', 'else', 'for', 'while',
  ];

  const lower = str.toLowerCase();
  const result: string[] = [];

  // 简单贪心匹配
  let remaining = lower;
  while (remaining.length > 0) {
    let matched = false;
    // 从最长的常见单词开始匹配
    for (const word of commonWords.sort((a, b) => b.length - a.length)) {
      if (remaining.startsWith(word)) {
        result.push(word);
        remaining = remaining.slice(word.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      // 没找到匹配，取前2个字符作为单词
      if (remaining.length >= 2) {
        result.push(remaining.slice(0, 2));
        remaining = remaining.slice(2);
      } else {
        result.push(remaining);
        break;
      }
    }
  }

  return result.filter(w => w.length > 1);
}

/**
 * 检查术语是否出现在文本中（智能匹配）
 * @param term 术语
 * @param text 文本
 * @returns 是否出现
 */
function termMatchesContent(term: string, text: string): boolean {
  const lowerText = text.toLowerCase();

  // 1. 完全匹配
  const lowerTerm = term.toLowerCase();
  if (lowerText.includes(lowerTerm)) {
    return true;
  }

  // 2. 中文字符串包含检查
  if (/[\u4e00-\u9fa5]/.test(term)) {
    for (const char of term) {
      if (!lowerText.includes(char)) {
        return false;
      }
    }
    return true;
  }

  // 3. 英文术语拆分匹配
  // 将连写的英文拆分成单词，检查是否都出现在文本中
  const splitTerm = splitCamelCase(term).flatMap(splitConcatenatedEnglish);

  if (splitTerm.length > 1) {
    // 所有拆分出的单词都必须在文本中出现
    const allWordsMatch = splitTerm.every(word => lowerText.includes(word));
    if (allWordsMatch) {
      return true;
    }
  }

  // 4. 部分匹配（至少 70% 的字符出现在文本中）
  const termChars = lowerTerm.replace(/[^a-z]/g, '').split('');
  if (termChars.length >= 3) {
    const matchedChars = termChars.filter(char => lowerText.includes(char));
    if (matchedChars.length / termChars.length >= 0.7) {
      return true;
    }
  }

  return false;
}

/**
 * 评估单个引用与关键术语的相关性
 */
function evaluateCitation(
  citation: Citation,
  keyTerms: string[],
  sourceContent: string
): CitationDetail {
  const matchedTerms: string[] = [];
  const missingTerms: string[] = [];

  for (const term of keyTerms) {
    if (termMatchesContent(term, sourceContent)) {
      matchedTerms.push(term);
    } else {
      missingTerms.push(term);
    }
  }

  // 计算相关性分数：匹配的术语数 / 总术语数
  const relevanceScore = keyTerms.length > 0
    ? matchedTerms.length / keyTerms.length
    : 0;

  return {
    citation: citation.href,
    label: citation.label,
    matchedTerms,
    missingTerms,
    hasKeyTerms: matchedTerms.length > 0,
    relevanceScore,
  };
}

/**
 * 评估回答的引用召回率
 * @param answerContent 回答内容
 * @param userQuery 用户问题
 * @param sources 引用来源列表
 * @returns 引用质量报告
 */
export function evaluateCitationQuality(
  answerContent: string,
  userQuery: string,
  sources: Source[]
): CitationQualityReport {
  // 1. 提取回答中的引用
  const citations = extractCitations(answerContent);

  // 2. 从用户问题提取关键术语
  const keyTerms = extractKeyTerms(userQuery);

  // 3. 评估每个引用
  const details: CitationDetail[] = [];

  for (const citation of citations) {
    // 从 href 中解析 category 和 slug
    // href 格式: /category/slug#anchor
    const hrefParts = citation.href.replace(/^#/, '').split('#');
    const pathParts = hrefParts[0].replace(/^\//, '').split('/');
    const category = pathParts[0] || '';
    const slug = pathParts[1] || '';
    const anchor = hrefParts[1] || '';

    // 在 sources 中查找匹配的内容
    const matchedSource = sources.find(s =>
      s.category === category && s.slug === slug
    );

    const sourceContent = matchedSource
      ? matchedSource.contentPreview || ''
      : '';

    const detail = evaluateCitation(citation, keyTerms, sourceContent);
    details.push(detail);
  }

  // 4. 计算统计指标
  const relevantCitations = details.filter(d => d.hasKeyTerms).length;
  const totalCitations = details.length;
  const recallRate = totalCitations > 0
    ? relevantCitations / totalCitations
    : 0;
  const avgRelevanceScore = totalCitations > 0
    ? details.reduce((sum, d) => sum + d.relevanceScore, 0) / totalCitations
    : 0;

  return {
    totalCitations,
    relevantCitations,
    recallRate: Math.round(recallRate * 100) / 100,
    avgRelevanceScore: Math.round(avgRelevanceScore * 100) / 100,
    details,
    evaluationTimestamp: new Date().toISOString(),
  };
}

/**
 * 获取评估报告的摘要描述
 */
export function getQualitySummary(report: CitationQualityReport): string {
  if (report.totalCitations === 0) {
    return '无引用';
  }

  const qualityLevel = report.recallRate >= 0.8
    ? '优秀'
    : report.recallRate >= 0.6
      ? '良好'
      : report.recallRate >= 0.4
        ? '一般'
        : '较差';

  return `引用召回率: ${(report.recallRate * 100).toFixed(0)}% (${report.relevantCitations}/${report.totalCitations}) - ${qualityLevel}`;
}
