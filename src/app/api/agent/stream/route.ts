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

        // 执行流式推理
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const input: any = { messages: [{ role: "user", content: message }] };

        // executor.stream() 返回 Promise<IterableReadableStream<T>>，需要先 await
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const iterableStream = await (executor.stream(input) as Promise<any>);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const chunk of iterableStream as AsyncGenerator<any, void, unknown>) {
          // chunk 通常是 { messages: [...] } 结构
          // 遍历消息列表
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const messages: any[] = chunk.messages || [];

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const msg of messages) {
            const msgType = (msg as any).lc_name || (msg as any).type || "";
            const msgContent = msg.content || "";

            // 判断消息类型
            if (msgType === "ToolMessage" || msgType === "tool") {
              // 工具执行结果
              const toolCallId = (msg as any).tool_call_id || "";
              const toolContent = typeof msgContent === "string" ? msgContent : JSON.stringify(msgContent);

              if (toolCallId && pendingTools.has(toolCallId)) {
                const pending = pendingTools.get(toolCallId)!;

                // 发送 tool_end 事件
                sendEvent("tool_end", {
                  toolCallId,
                  toolName: pending.name,
                  result: toolContent,
                });

                pendingTools.delete(toolCallId);
              }
            } else if (msgType === "AIMessage" || msgType === "ai") {
              // AI 消息：包含文字内容和/或工具调用
              // 文字内容 -> 发送 delta
              if (msgContent && typeof msgContent === "string" && msgContent.trim()) {
                finalContent += msgContent;
                sendEvent("delta", { content: msgContent });
              }

              // 工具调用请求 -> 发送 tool_start
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
