import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createGLM5 } from "@/lib/langchain/llm";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "@/lib/agent/tools";
import { getOrCreateSession, acquireSessionLock, appendSessionMessage } from "@/lib/agent/session";
import { ADMIN_CHAT_PROMPT } from "@/lib/agent/prompts/admin_chat";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) throw new Error("Unauthorized");
}

export async function POST(req: Request) {
  try { await requireAdmin(); } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Unauthorized" } }) + "\n\n",
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let body: { message?: string; sessionKey?: string };
  try { body = await req.json(); } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Invalid request body" } }) + "\n\n",
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { message, sessionKey } = body;
  if (!message || typeof message !== "string") {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Invalid message" } }) + "\n\n",
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const key = sessionKey || `agent:chat:${Date.now()}`;

  let session;
  try {
    session = await getOrCreateSession(key, "chat", "admin");
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Session error" } }) + "\n\n",
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let lock;
  try { lock = await acquireSessionLock(session.id, "admin"); } catch {}
  if (!lock) {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Agent is busy" } }) + "\n\n",
      { status: 409, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  try { await appendSessionMessage(session.id, "user", message, "admin"); } catch {}

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: unknown) =>
        controller.enqueue(enc.encode("data: " + JSON.stringify({ type, data }) + "\n\n"));

      try {
        send("init", { sessionId: session!.id, sessionKey: key });

        const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });
        const tools = [duckduckgoSearch, createContent, listContent, deleteContent] as any[];

        // 构建工具描述
        const toolDescs = tools.map(t => {
          const name = (t as any).name || (t as any).lc_name || "";
          const desc = (t as any).description || "";
          const schema = (t as any).schema;
          let params = "";
          if (schema && schema.shape) {
            const fields = Object.keys(schema.shape || {}).map(k => {
              const f = schema.shape[k];
              return `  - ${k}: ${f._def?.description || "string"}`;
            }).join("\n");
            params = `\n参数:\n${fields}`;
          }
          return `- ${name}: ${desc}${params}`;
        }).join("\n");

        // 对话历史
        const history: Array<{ role: string; content: string }> = [];

        const MAX_ITERS = 10;
        for (let iter = 0; iter < MAX_ITERS; iter++) {
          // 构建当前 prompt
          const historyText = history.length > 0
            ? "\n\n对话历史:\n" + history.map(h => h.role + ": " + h.content).join("\n") + "\n\n"
            : "";

          const prompt = `${ADMIN_CHAT_PROMPT}\n\n${historyText}用户: ${message}\n\n请直接回答用户的问题。如果需要执行操作，调用对应的工具。`;

          const toolPrompt = `\n\n可用工具:\n${toolDescs}\n\n如果需要使用工具，请按以下格式回复:\n[TOOL_CALL]tool_name|参数JSON[/TOOL_CALL]\n例如:\n[TOOL_CALL]duckduckgo_search|{"query":"天气","maxResults":5}[/TOOL_CALL]\n\n如果不需要工具，直接回答:`;

          // 第一次：带工具描述 + 工具提示
          // 后续：只带历史（工具只在第一次提示）
          const fullPrompt = iter === 0 ? prompt + toolPrompt : prompt;

          // 调用 LLM
          const aiMsg = await llm.invoke([
            new HumanMessage(fullPrompt)
          ] as any);

          const text = (aiMsg.content as string) || "";
          if (!text.trim()) break;

          // 检查是否有工具调用
          const toolMatch = text.match(/\[TOOL_CALL\]([^[]+?)\[\/TOOL_CALL\]/);

          if (!toolMatch) {
            // 无工具调用 = 结束
            // 发送文字
            for (let j = 0; j < text.length; j += 15) {
              send("delta", { content: text.slice(j, j + 15) });
              await new Promise(r => setTimeout(r, 12));
            }
            // 保存到历史
            history.push({ role: "assistant", content: text });
            try {
              await appendSessionMessage(session!.id, "assistant", text, "admin");
            } catch {}
            send("done", {});
            break;
          }

          // 解析工具调用
          const toolCallStr = toolMatch[1];
          const pipeIdx = toolCallStr.indexOf("|");
          if (pipeIdx === -1) continue;

          const toolName = toolCallStr.slice(0, pipeIdx).trim();
          let toolArgs: Record<string, unknown> = {};
          const argsStr = toolCallStr.slice(pipeIdx + 1).trim();
          if (argsStr) {
            try { toolArgs = JSON.parse(argsStr); } catch {}
          }

          send("tool_start", { toolName, arguments: JSON.stringify(toolArgs) });

          // 执行工具
          const tool = tools.find(t => (t as any).name === toolName || (t as any).lc_name === toolName);
          let result: string;
          if (tool) {
            try {
              const r = await (tool as any).invoke(toolArgs);
              result = typeof r === "string" ? r : JSON.stringify(r);
            } catch (err) {
              result = err instanceof Error ? err.message : String(err);
            }
          } else {
            result = `Tool not found: ${toolName}`;
          }

          send("tool_end", { toolName, result, success: !result.startsWith("Tool not found") && !result.includes("Error") });
          history.push({ role: "assistant", content: text });
          history.push({ role: "user", content: `[TOOL_RESULT ${toolName}]: ${result}` });
        }
      } catch (err) {
        console.error("[stream] error:", err);
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (lock) try { await lock.release(); } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
