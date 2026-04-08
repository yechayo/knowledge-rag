import { NextRequest } from "next/server";
import { createGLM5 } from "@/lib/langchain/llm";

// 临时：跳过认证测试 LLM
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { message } = body;

  try {
    const llm = createGLM5({ temperature: 0.7, maxTokens: 500 });
    const result = await llm.invoke([
      {
        role: "user",
        content: message || "你好",
      },
    ] as any);

    return new Response(JSON.stringify({ result: result.content, type: typeof result.content }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[test-llm] error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      details: (err as any).response?.data || (err as any).cause,
    }), { status: 500 });
  }
}
