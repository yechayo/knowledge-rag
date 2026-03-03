import { readFile } from 'fs/promises';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

export interface MarkdownSection {
  level: number;        // 标题层级 (1-6)
  title: string;        // 标题文本
  content: string;      // 章节内容（Markdown 格式）
  htmlContent: string;  // 渲染后的 HTML
  lineNumber: number;   // 起始行号
}

export interface MarkdownParseResult {
  sections: MarkdownSection[];
  fullText: string;
  fullHtml: string;
  metadata: {
    title?: string;
    headings: string[];
    codeBlocks: number;
    totalLines: number;
  };
}

export async function parseMarkdown(filePath: string): Promise<MarkdownParseResult> {
  // 1. 读取文件内容
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  // 2. 按标题分节
  const sections: MarkdownSection[] = [];
  let currentSection: Partial<MarkdownSection> | null = null;
  let currentContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      // 保存上一个章节
      if (currentSection) {
        sections.push({
          level: currentSection.level!,
          title: currentSection.title!,
          content: currentContent.join('\n').trim(),
          htmlContent: DOMPurify.sanitize(marked.parse(currentContent.join('\n').trim()) as string),
          lineNumber: currentSection.lineNumber!,
        });
      }

      // 开始新章节
      currentSection = {
        level: headingMatch[1].length,
        title: headingMatch[2],
        lineNumber: i + 1,
      };
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  // 保存最后一个章节
  if (currentSection) {
    sections.push({
      level: currentSection.level!,
      title: currentSection.title!,
      content: currentContent.join('\n').trim(),
      htmlContent: DOMPurify.sanitize(marked.parse(currentContent.join('\n').trim()) as string),
      lineNumber: currentSection.lineNumber!,
    });
  }

  // 3. 提取元数据
  const headings = sections.map(s => s.title);
  const codeBlocks = (content.match(/```/g) || []).length / 2;

  return {
    sections,
    fullText: content,
    fullHtml: DOMPurify.sanitize(marked.parse(content) as string),
    metadata: {
      headings,
      codeBlocks,
      totalLines: lines.length,
    },
  };
}
