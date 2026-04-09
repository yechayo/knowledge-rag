import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";

interface SearchResult {
  title: string;
  url: string;
  body: string;
}

/**
 * 使用 Tavily Search API 进行搜索
 * 需要设置 TAVILY_API_KEY 环境变量
 */
async function searchWithTavily(query: string, maxResults: number = 10): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error("TAVILY_API_KEY 环境变量未设置，请在 .env 文件中配置 Tavily API Key");
  }

  const client = tavily({ apiKey });

  const response = await client.search(query, {
    searchDepth: "basic",
    maxResults,
    includeAnswer: false,
    includeImages: false,
  });

  if (!response.results || response.results.length === 0) {
    return [];
  }

  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    body: r.content,
  }));
}

export const duckduckgoSearch = tool(
  async ({ query, maxResults = 10 }: { query: string; maxResults?: number }) => {
    let results: SearchResult[];

    try {
      results = await searchWithTavily(query, maxResults);
    } catch (e) {
      return `搜索出错: ${e instanceof Error ? e.message : String(e)}`;
    }

    if (results.length === 0) {
      return "未找到相关结果";
    }

    return results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.body}`)
      .join("\n\n");
  },
  {
    name: "tavily_search",
    description: "使用 Tavily Search 搜索互联网信息。输入搜索关键词，返回搜索结果列表。",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
      maxResults: z.coerce.number().optional().describe("最大结果数，默认 10"),
    }),
  }
);
