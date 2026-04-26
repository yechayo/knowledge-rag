import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAgentModel, type AgentModelConfig } from "@/lib/langchain/llm";
import { getOrCreateSession } from "@/lib/agent/session";
import { createQueryEngine } from "@/lib/agent/chat";
import { ADMIN_CHAT_PROMPT, ADMIN_CHAT_NEGATIVE_PROMPT } from "@/lib/agent/prompts/admin_chat";
import { HumanMessage, trimMessages, BaseMessage } from "@langchain/core/messages";
import { getSkillPromptWithUserInstalled } from "@/lib/agent/skills";
import { resolveSkillContext } from "@/lib/agent/skillRouter";
import {
  loadMemories, loadTeamMemories, formatMemoriesForPrompt, loadProjectContext,
} from "@/lib/agent/memory";
import { LoopGuard, DEFAULT_RESOURCE_LIMITS } from "@/lib/agent/guard";
import { SSE_HEADERS, createSSESender } from "@/lib/agent/stream/sse";
import { createToolRegistry } from "@/lib/agent/tools/registry";
import { runAgentStream, type ToolResultEntry } from "@/lib/agent/stream/agentRunner";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  const userId = (session?.user as any)?.id || "admin";
  if (!isAdmin) throw new Error("Unauthorized");
  return userId;
}

/** 从 session metadata 读取上轮工具结果（工作上下文） */
async function loadWorkingContext(sessionId: string): Promise<string> {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });
  if (!session?.metadata) return "";
  const meta = session.metadata as Record<string, unknown>;
  const results = meta.toolResults as ToolResultEntry[] | undefined;
  if (!results?.length) return "";

  const lines = results.map((r) => `[${r.toolName}]\n${r.result}`);
  return `\n\n【上轮工具结果（工作上下文）】\n${lines.join("\n\n---\n\n")}\n`;
}

/** 将本轮工具结果持久化到 session metadata */
async function saveWorkingContext(sessionId: string, toolResults: ToolResultEntry[]): Promise<void> {
  if (!toolResults.length) return;
  await prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.findUnique({ where: { id: sessionId } });
    if (!session) return;
    const meta = (session.metadata as Record<string, unknown>) || {};
    meta.toolResults = toolResults;
    await tx.agentSession.update({
      where: { id: sessionId },
      data: { metadata: meta as unknown as Prisma.InputJsonValue },
    });
  });
}

/** 自定义 token 计数器（中英文混合估算） */
function countTokens(msgs: BaseMessage[]): number {
  return msgs.reduce((total, msg) => {
    const text = typeof msg.content === "string" ? msg.content : "";
    const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const en = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter((w: string) => w.length > 0).length;
    return total + Math.ceil(cn * 2 + en * 1.3) + 4;
  }, 0);
}

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireAdmin(); }
  catch { return new Response("data: " + JSON.stringify({ type: "error", data: { message: "Unauthorized" } }) + "\n\n", { status: 401, headers: SSE_HEADERS }); }

  let body: { message?: string; sessionKey?: string; skill?: string; modelConfig?: AgentModelConfig };
  try { body = await req.json(); } catch { return new Response("data: " + JSON.stringify({ type: "error", data: { message: "Invalid request body" } }) + "\n\n", { status: 400, headers: SSE_HEADERS }); }

  const { message, sessionKey, skill: explicitSkill, modelConfig } = body;
  if (!message || typeof message !== "string") {
    return new Response("data: " + JSON.stringify({ type: "error", data: { message: "Invalid message" } }) + "\n\n", { status: 400, headers: SSE_HEADERS });
  }

  // 会话初始化
  const key = sessionKey || `agent:chat:${Date.now()}`;
  let session;
  try { session = await getOrCreateSession(key, "chat", userId); } catch {
    return new Response("data: " + JSON.stringify({ type: "error", data: { message: "Session error" } }) + "\n\n", { status: 500, headers: SSE_HEADERS });
  }

  const apiKey = modelConfig?.apiKey || process.env.BIGMODEL_API_KEY || "";
  let engine;
  try { engine = await createQueryEngine(key, userId, "chat", { apiKey }); } catch {
    return new Response("data: " + JSON.stringify({ type: "error", data: { message: "Session error" } }) + "\n\n", { status: 500, headers: SSE_HEADERS });
  }

  let engineInitialized = false;
  try { await engine.initialize(); engineInitialized = true; } catch {
    return new Response("data: " + JSON.stringify({ type: "error", data: { message: "Session lock error" } }) + "\n\n", { status: 409, headers: SSE_HEADERS });
  }

  try { await engine.addUserMessage(message); } catch {}

  // 提示词组装
  const skillCtx = resolveSkillContext(message, explicitSkill);
  let skillPrompt = ADMIN_CHAT_PROMPT + ADMIN_CHAT_NEGATIVE_PROMPT;
  let cleanMessage = message;
  if (skillCtx.activeSkill) {
    const loaded = await getSkillPromptWithUserInstalled(skillCtx.activeSkill, userId);
    if (loaded) { skillPrompt = loaded + ADMIN_CHAT_NEGATIVE_PROMPT; cleanMessage = skillCtx.cleanMessage || message; }
  }

  // 加载工作上下文（上轮工具结果，持久化的）
  const workingContext = await loadWorkingContext(session.id);

  const [projectContext, memories, teamMemories] = await Promise.all([loadProjectContext(), loadMemories(userId), loadTeamMemories()]);
  const memorySection = formatMemoriesForPrompt([...memories, ...teamMemories]);
  const contextSection = projectContext ? `\n\n${projectContext}` : "";

  // 工具注册（带 Guard 包装）
  const limits = { ...DEFAULT_RESOURCE_LIMITS };
  const guard = new LoopGuard({ maxTurns: limits.maxTurns, tokenBudget: limits.tokenBudget });
  const { tools, rawTools } = createToolRegistry({ userId, guard, limits });

  // LLM
  const llm = createAgentModel({ temperature: 0.7, maxTokens: 8000 }, modelConfig);

  // 加载历史 + trimMessages 裁剪（只裁对话历史，工作上下文在 system prompt 中）
  try { await engine.checkAndCompact(skillPrompt); } catch {}
  let persistentHistory: any[] = [];
  try { persistentHistory = await engine.getMessages(); } catch {}

  // 历史对话作为上下文注入 system prompt（不是作为消息流的一部分）
  // 这样模型知道之前说了什么，但不会"续写"之前的 assistant 消息
  let historyForContext = persistentHistory;
  if (historyForContext.length > 0 && historyForContext[historyForContext.length - 1].role === "user") {
    historyForContext = historyForContext.slice(0, -1);
  }
  const historyContext = historyForContext.length > 0
    ? "\n\n【历史对话（仅供参考，不要重复其中内容，只回答用户最新消息）】\n"
      + historyForContext.map((h: any) => {
          const role = h.role === "user" ? "用户" : "助手";
          const content = typeof h.content === "string" ? h.content : String(h.content);
          return `${role}: ${content}`;
        }).join("\n")
    : "";

  const systemPrompt = [
    skillPrompt, contextSection, memorySection, workingContext, historyContext,
    `\n\n当前时间：${new Date().toISOString()}`,
    "\n\n回答要求：简洁、直接、不重复。只回答用户最新消息。",
  ].join("");

  // 消息流只发送当前用户消息（历史已在 system prompt 中）
  const allMessages = [new HumanMessage(cleanMessage)];

  const inputMessages = await trimMessages(allMessages, {
    maxTokens: 4000,
    strategy: "last",
    includeSystem: true,
    startOn: "human",
    allowPartial: true,
    tokenCounter: countTokens,
  });

  // AbortController + 5 分钟全局超时
  const abortCtrl = new AbortController();
  const timeoutId = setTimeout(() => abortCtrl.abort(), 5 * 60 * 1000);
  if (req.signal) req.signal.addEventListener("abort", () => { clearTimeout(timeoutId); abortCtrl.abort(); }, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = createSSESender(controller);
      try {
        send("init", { sessionId: session!.id, sessionKey: key, activeSkill: skillCtx.activeSkill });

        const result = await runAgentStream({
          inputMessages,
          guardedTools: tools,
          rawTools,
          systemPrompt,
          llm,
          engine,
          guard,
          signal: abortCtrl.signal,
          send,
        });

        // 持久化本轮工具结果作为下轮工作上下文
        if (result.toolResults.length > 0) {
          try { await saveWorkingContext(session!.id, result.toolResults); } catch {}
        }

        send("done", {});
      } catch (err: any) {
        if (err.name === "AbortError") send("done", { reason: "cancelled" });
        else { console.error("[stream] error:", err); send("error", { message: err.message || "模型调用失败" }); }
      } finally {
        clearTimeout(timeoutId);
        if (engine && engineInitialized) { try { await engine.release(); } catch {} }
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
