import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAgentExecutorCore } from "@/lib/agent/executor";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "@/lib/agent/tools";
import { getOrCreateSession, acquireSessionLock, appendSessionMessage } from "@/lib/agent/session";
import { ADMIN_CHAT_PROMPT } from "@/lib/agent/prompts/admin_chat";

// 管理员认证辅助函数
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    throw new Error("Unauthorized");
  }
  return session;
}

// POST /api/agent/stream - SSE 流式 Agent 对话 (需要管理员认证)
export async function POST(req: Request) {
  // 1. 管理员认证
  try {
    await requireAdmin();
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Unauthorized" } }) + "\n\n",
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // 2. 解析请求体
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

  // 如果没有提供 sessionKey，生成一个
  const key = sessionKey || `agent:admin:stream:${Date.now()}`;

  // 3. 获取或创建 Session
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

  // 4. 尝试获取锁
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

  // 5. 持久化用户消息
  try {
    await appendSessionMessage(session.id, "user", message, "admin");
  } catch (err) {
    console.error("[stream] Failed to persist user message:", err);
  }

  // 6. 构建 SSE 流
  // 方案 A: executor.stream() — 当前报 "messages 参数非法" GLM API 错误
  // 方案 B: executor.invoke() — 工作正常，但非真正的 token 级别流式
  // 采用方案 B 保证功能正常，后续可优化为真正的流式
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (type: string, data: unknown) => {
        controller.enqueue(
          encoder.encode("data: " + JSON.stringify({ type, data }) + "\n\n")
        );
      };

      try {
        // 发送初始事件
        sendEvent("init", { sessionId: session!.id, sessionKey: key });

        // 创建 Agent 执行器
        const tools = [duckduckgoSearch, createContent, listContent, deleteContent];
        const executor = await createAgentExecutorCore(tools, ADMIN_CHAT_PROMPT);

        // 用于追踪工具调用状态
        const pendingTools = new Map<string, { name: string; args: string }>();

        // 用于累积助手最终回复内容
        let finalContent = "";

        // 执行推理（使用 invoke，因为 stream() 的 chunk 格式不稳定）
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const input: any = { messages: [{ role: "user", content: message }] };

        // invoke() 返回完整结果，我们可以遍历 messages 提取内容
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any = await (executor.invoke(input) as Promise<any>);

        // 遍历结果中的消息，提取文字内容和工具调用
        const resultMessages = result.messages || [];
        for (const msg of resultMessages) {
          const msgType = msg.constructor?.name || "";
          const msgContent = msg.content || "";

          if (msgType === "ToolMessage" || (msg as any).type === "tool") {
            const toolCallId = (msg as any).tool_call_id || "";
            const toolName = (msg as any).name || "tool";
            const toolContent = typeof msgContent === "string" ? msgContent : JSON.stringify(msgContent);

            sendEvent("tool_end", {
              toolCallId,
              toolName,
              result: toolContent,
            });
          } else if (msgType === "AIMessage" || (msg as any).type === "ai") {
            // 文字内容 -> delta
            if (msgContent && typeof msgContent === "string" && msgContent.trim()) {
              // 分段发送 delta（每 20 个字符为一段，模拟流式效果）
              for (let i = 0; i < msgContent.length; i += 20) {
                const chunk = msgContent.slice(i, i + 20);
                finalContent += chunk;
                sendEvent("delta", { content: chunk });

                // 小延迟模拟打字效果（每 20 字符 30ms）
                await new Promise(resolve => setTimeout(resolve, 30));
              }
            }

            // 工具调用请求 -> tool_start
            const toolCalls: any[] = (msg as any).tool_calls || [];
            for (const tc of toolCalls) {
              const toolCallId = tc.id || tc.tool_call_id || "";
              const toolName = tc.name || tc.function?.name || "";
              const toolArgs = typeof tc.arguments === "string"
                ? tc.arguments
                : JSON.stringify(tc.arguments || {});

              if (toolCallId && toolName) {
                pendingTools.set(toolCallId, { name: toolName, args: toolArgs });
                sendEvent("tool_start", {
                  toolCallId,
                  toolName,
                  arguments: toolArgs,
                });
              }
            }
          }
        }

        // 发送完成事件并持久化助手回复
        sendEvent("done", {});
        if (finalContent) {
          try {
            await appendSessionMessage(session.id, "assistant", finalContent, "admin");
          } catch (err) {
            console.error("[stream] Failed to persist assistant message:", err);
          }
        }
      } catch (err) {
        console.error("[stream] Agent execution error:", err);
        sendEvent("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        // 释放锁
        try {
          if (lock) { await lock.release(); }
        } catch (releaseErr) {
          console.error("[stream] Failed to release lock:", releaseErr);
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
