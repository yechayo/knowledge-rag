import { tool } from "@langchain/core/tools";
import { z } from "zod";

interface DuckDuckGoResult {
  title: string;
  href: string;
  body: string;
}

/**
 * 使用 Python ddgs 进行搜索
 */
async function searchWithDDGS(query: string, maxResults: number = 10): Promise<string> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process");
    const python = spawn("python", [
      "-c",
      `
import sys
import os
import warnings
warnings.filterwarnings('ignore')
try:
    from duckduckgo_search import DDGS
    import json
    query = os.environ.get('DDGS_QUERY', '')
    max_results = int(os.environ.get('DDGS_MAX_RESULTS', '10'))
    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=max_results))
        print(json.dumps(results, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
`,
    ], {
      env: { ...process.env, DDGS_QUERY: query, DDGS_MAX_RESULTS: String(maxResults) },
    });

    let output = "";
    python.stdout.on("data", (data: Buffer) => (output += data.toString()));
    python.on("close", (code: number) => {
      if (code !== 0) {
        reject(new Error(`DDGS search failed with code ${code}`));
      } else {
        resolve(output);
      }
    });
    python.on("error", reject);
  });
}

export const duckduckgoSearch = tool(
  async ({ query, maxResults = 10 }: { query: string; maxResults?: number }) => {
    let results: DuckDuckGoResult[] | { error: string };
    try {
      results = JSON.parse(await searchWithDDGS(query, maxResults));
    } catch (e) {
      return `搜索出错: ${e instanceof Error ? e.message : String(e)}`;
    }

    if (Array.isArray(results) && results.length === 0) {
      return "未找到相关结果";
    }

    if (results.error) {
      return `搜索出错: ${results.error}`;
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
