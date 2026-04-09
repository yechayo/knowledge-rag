import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { tavily } from "@tavily/core";

/**
 * 使用 Tavily Extract 抓取网页全文内容
 */
export const fetchUrl = tool(
  async ({ url }: { url: string }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return JSON.stringify({ error: "TAVILY_API_KEY 未配置" });
    }

    if (!url) {
      return JSON.stringify({ error: "请提供 URL" });
    }

    const client = tavily({ apiKey });
    try {
      const response = await client.extract([url]);
      const result = response.results?.[0];

      if (!result) {
        return "无法提取该网页内容";
      }

      // rawContent 包含完整页面文本，截取到合理长度
      const content = result.rawContent || "";
      const maxLen = 6000;
      const trimmed = content.length > maxLen
        ? content.substring(0, maxLen) + "\n...(内容过长，已截断)"
        : content;

      return `标题：${result.title || "未知"}\n来源：${url}\n\n${trimmed}`;
    } catch (e) {
      return `提取失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
  {
    name: "fetch_url",
    description: "提取网页全文内容。当搜索结果中的摘要不够详细时，使用此工具打开链接获取完整文章内容。",
    schema: z.object({
      url: z.string().describe("要提取内容的网页 URL"),
    }),
  }
);
