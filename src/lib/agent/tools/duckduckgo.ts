import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { search, SafeSearchType } from "duck-duck-scrape";

interface DuckDuckGoResult {
  title: string;
  href: string;
  body: string;
}

/**
 * 使用 duck-duck-scrape 进行搜索 (Node.js 版本，兼容 Vercel Serverless)
 */
async function searchWithDuckDuckGo(query: string, maxResults: number = 10): Promise<DuckDuckGoResult[]> {
  try {
    const results = await search(query, {
      safeSearch: SafeSearchType.MODERATE,
    });

    if (results.noResults || !results.results || results.results.length === 0) {
      return [];
    }

    return results.results.slice(0, maxResults).map((r) => ({
      title: r.title,
      href: r.url,
      body: r.description || r.rawDescription,
    }));
  } catch (error) {
    throw new Error(`DuckDuckGo search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const duckduckgoSearch = tool(
  async ({ query, maxResults = 10 }: { query: string; maxResults?: number }) => {
    let results: DuckDuckGoResult[];

    try {
      results = await searchWithDuckDuckGo(query, maxResults);
    } catch (e) {
      return `搜索出错: ${e instanceof Error ? e.message : String(e)}`;
    }

    if (results.length === 0) {
      return "未找到相关结果";
    }

    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.href}\n${r.body}`)
      .join("\n\n");
  },
  {
    name: "duckduckgo_search",
    description: "使用 DuckDuckGo 搜索互联网信息。输入搜索关键词，返回搜索结果列表。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      maxResults: z.number().optional().describe("最大结果数，默认 10"),
    }),
  }
);
