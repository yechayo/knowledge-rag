import { PDFParse } from 'pdf-parse';
import { readFile } from 'fs/promises';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

export interface PDFPage {
  pageNumber: number;
  text: string;
}

export interface PDFParseResult {
  pages: PDFPage[];
  totalPages: number;
  fullText: string;
}

let workerConfigured = false;

function ensurePdfWorkerConfigured() {
  if (workerConfigured) {
    return;
  }

  const cwd = process.cwd();
  const baseDirs = [
    cwd,
    join(cwd, '..'),
    join(cwd, '..', '..'),
  ];

  const workerCandidates: string[] = [];

  for (const baseDir of baseDirs) {
    workerCandidates.push(
      join(baseDir, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs')
    );

    const pnpmDir = join(baseDir, 'node_modules', '.pnpm');
    if (existsSync(pnpmDir)) {
      try {
        const entries = readdirSync(pnpmDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || !entry.name.startsWith('pdfjs-dist@')) {
            continue;
          }
          workerCandidates.push(
            join(
              pnpmDir,
              entry.name,
              'node_modules',
              'pdfjs-dist',
              'legacy',
              'build',
              'pdf.worker.mjs'
            )
          );
        }
      } catch {
        // ignore directory read errors and continue with fallback candidates
      }
    }
  }

  for (const workerPath of workerCandidates) {
    if (existsSync(workerPath)) {
      PDFParse.setWorker(pathToFileURL(workerPath).href);
      workerConfigured = true;
      return;
    }
  }
}

/**
 * 解析 PDF 文件，按页提取文本内容
 */
export async function parsePDF(filePath: string): Promise<PDFParseResult> {
  ensurePdfWorkerConfigured();
  const dataBuffer = await readFile(filePath);
  const parser = new PDFParse({ data: dataBuffer });

  try {
    const textResult = await parser.getText();
    const pages: PDFPage[] = textResult.pages.map((page) => ({
      pageNumber: page.num,
      text: page.text,
    }));

    const fullText = textResult.text?.trim() || '';

    return {
      pages,
      totalPages: textResult.total,
      fullText,
    };
  } finally {
    await parser.destroy();
  }
}

/**
 * 获取 PDF 指定页面的文本
 */
export async function getPDFPageText(filePath: string, pageNumber: number): Promise<string> {
  const result = await parsePDF(filePath);
  const page = result.pages.find(p => p.pageNumber === pageNumber);
  return page?.text || '';
}
