import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createGLM5 } from "@/lib/langchain/llm";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "@/lib/agent/tools";
import { getOrCreateSession, acquireSessionLock, appendSessionMessage } from "@/lib/agent/session";
import { ADMIN_CHAT_PROMPT } from "@/lib/agent/prompts/admin_chat";
import { getSystemPrompt } from "@/lib/agent/prompts/react_agent";
import { AIMessage, HumanMessage, BaseMessage } from "@langchain/core/messages";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) throw new Error("Unauthorized");
  return session;
}

function makeSystemMessage(prompt: string) {
  return new AIMessage({ content: getSystemPrompt(prompt) });
}

// POST /api/agent/stream - SSE 流式 Agent 对话
export async function POST(req: Request) {
  // 1. 认证
  try {
    await requireAdmin();
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Unauthorized" } }) + "\n\n",
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let body: { message?: string; sessionKey?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Invalid request body" } }) + "\n\n",
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { message, sessionKey } = body;
  if (!message || typeof message !== "string") {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Missing or invalid 'message' field" } }) + "\n\n",
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const key = sessionKey || `agent:admin:stream:${Date.now()}`;

  let session;
  try {
    session = await getOrCreateSession(key, "admin", "admin");
  } catch (err) {
    console.error("[stream] Failed to get/create session:", err);
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Failed to create session" } }) + "\n\n",
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let lock;
  try {
    lock = await acquireSessionLock(session.id, "admin");
  } catch (err) {
    console.error("[stream] Failed to acquire lock:", err);
  }
  if (!lock) {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Agent is busy, please try again later" } }) + "\n\n",
      { status: 409, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // 持久化用户消息
  try {
    await appendSessionMessage(session.id, "user", message, "admin");
  } catch (err) {
    console.error("[stream] Failed to persist user message:", err);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (type: string, data: unknown) => {
        controller.enqueue(
          encoder.encode("data: " + JSON.stringify({ type, data }) + "\n\n")
        );
      };

      try {
        send("init", { sessionId: session!.id, sessionKey: key });

        const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });
        const tools: any[] = [duckduckgoSearch, createContent, listContent, deleteContent];
        const agent = await createReactAgent({
          llm,
          tools,
          prompt: ADMIN_CHAT_PROMPT,
        });

        // 手动 ReAct 循环：agent.invoke() + 工具执行
        const MAX_ITERATIONS = 10;
        const history: BaseMessage[] = [makeSystemMessage("")];
        history.push(new HumanMessage(message));

        for (let i = 0; i < MAX_ITERATIONS; i++) {
          // Agent 决策
          const decision = await (agent.invoke as any)({ messages: history });

          // 提取 AI 回复中的文字内容和工具调用
          const aiMsg = decision.messages?.[decision.messages.length - 1];
          if (!aiMsg) break;

          const content = aiMsg.content;
          const toolCalls = (aiMsg as any).tool_calls || [];

          // 发送文字内容
          if (content && typeof content === "string" && content.trim()) {
            // 分段发送，模拟流式效果
            for (let j = 0; j < content.length; j += 20) {
              const chunk = content.slice(j, j + 20);
              send("delta", { content: chunk });
              await new Promise(r => setTimeout(r, 15));
            }
          }

          // 无工具调用 = 完成
          if (toolCalls.length === 0) {
            // 持久化
            try {
              await appendSessionMessage(session!.id, "assistant", content || "", "admin");
            } catch (err) {
              console.error("[stream] Failed to persist:", err);
            }
            send("done", {});
            break;
          }

          // 执行工具
          for (const tc of toolCalls) {
            const toolName = tc.name;
            const toolArgs = typeof tc.arguments === "string"
              ? JSON.parse(tc.arguments)
              : (tc.arguments || {});

            send("tool_start", {
              toolName,
              arguments: JSON.stringify(toolArgs),
            });

            // 查找并调用工具
            const tool = tools.find(t => (t as any).name === toolName || (t as any).lc_name === toolName);
            if (tool) {
              try {
                const result = await tool.invoke(toolArgs);
                send("tool_end", {
                  toolName,
                  result: typeof result === "string" ? result : JSON.stringify(result),
                  success: true,
                });
                // 将工具结果加入历史
                history.push(new AIMessage(content || ""));
                history.push(new AIMessage({
                  content: "",
                  tool_call_id: tc.id,
                  name: toolName,
                  tool_call_arguments: toolArgs,
                } as any));
                history.push(new AIMessage(result as string));
              } catch (err) {
                send("tool_end", {
                  toolName,
                  result: err instanceof Error ? err.message : String(err),
                  success: false,
                });
                history.push(new AIMessage(content || ""));
                history.push(new AIMessage({
                  content: err instanceof Error ? err.message : String(err),
                  tool_call_id: tc.id,
                  name: toolName,
                  tool_call_arguments: toolArgs,
                  additional_kwargs: { is_error: true },
                } as any));
              }
            } else {
              send("tool_end", {
                toolName,
                result: `Tool not found: ${toolName}`,
                success: false,
              });
            }
          }
        }
      } catch (err) {
        console.error("[stream] Agent error:", err);
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (lock) {
          try { await lock.release(); } catch {}
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
