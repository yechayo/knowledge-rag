import { NextRequest } from "next/server";
import { createGLM5 } from "@/lib/langchain/llm";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { duckduckgoSearch } from "@/lib/agent/tools/duckduckgo";
import { getSystemPrompt } from "@/lib/agent/prompts/react_agent";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message } = body;

  try {
    const llm = createGLM5({ temperature: 0.7, maxTokens: 500 });
    const tools: any[] = [duckduckgoSearch];

    // 使用和 stream 端点相同的 prompt
    const prompt = getSystemPrompt("测试任务");
    console.log("[debug] Creating agent with prompt length:", prompt.length);

    const agent = await createReactAgent({
      llm,
      tools,
      prompt,
    });
    console.log("[debug] Agent created, calling invoke...");

    const result = await (agent.invoke as any)({
      messages: [{ role: "user", content: message || "你好" }],
    });
    console.log("[debug] Result:", result?.messages?.length, "messages");

    return new Response(JSON.stringify({
      messages: result?.messages?.length,
      last: result?.messages?.[result.messages.length - 1]?.content?.substring(0, 100),
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[debug] Error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500 });
  }
}
