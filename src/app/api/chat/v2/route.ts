/**
 * 长对话 Chat API v2
 * 支持跨请求累积对话历史、自动压缩、Token 预算监控
 * 使用 LangGraph ReAct 架构支持工具调用
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createQueryEngine, ChatV2Request } from "@/lib/agent/chat";
import { createReadOnlyToolRegistry } from "@/lib/agent/tools/registry";
import { runReActChat } from "@/lib/agent/graph";
import { REACT_CHAT_V2_PROMPT, REACT_CHAT_V2_NEGATIVE_PROMPT } from "@/lib/agent/prompts/react_chat_v2";
import { createSSESender, SSE_HEADERS } from "@/lib/agent/stream/sse";
import { LoopGuard, DEFAULT_RESOURCE_LIMITS } from "@/lib/agent/guard";
import { createAgentModel } from "@/lib/langchain/llm";
import { HumanMessage, AIMessage, trimMessages } from "@langchain/core/messages";
import { prisma } from "@/lib/prisma";

/**
 * 自定义 token 计数器（中英文混合估算）
 */
function countTokens(msgs: any[]): number {
  return msgs.reduce((total, msg) => {
    const text = typeof msg.content === "string" ? msg.content : String(msg.content || "");
    const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const en = text.replace(/[\u4e00-\u9fff]/g, " ").split(/\s+/).filter((w: string) => w.length > 0).length;
    return total + Math.ceil(cn * 2 + en * 1.3) + 4;
  }, 0);
}

/**
 * POST /api/chat/v2 - 长对话聊天接口（ReAct 架构）
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id || "anonymous";

  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: "服务配置异常：缺少 API Key" }) + "\n\n",
      { headers: SSE_HEADERS }
    );
  }

  try {
    const body: ChatV2Request = await req.json();
    const { messages, sessionKey: requestSessionKey } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response("Missing messages", { status: 400 });
    }

    const lastUserMessage = messages.filter((m) => m.role === "user").pop();
    if (!lastUserMessage?.content) {
      return new Response("Missing user message", { status: 400 });
    }

    // 生成或使用提供的 sessionKey
    const sessionKey = requestSessionKey || `chat:${userId}:${Date.now()}`;

    // 创建 QueryEngine
    const engine = await createQueryEngine(sessionKey, userId, "chat", {
      apiKey,
      maxTokens: 128000,
      maxHistoryRounds: 20,
      enableAutoCompact: body.enableAutoCompact !== false,
      enableContextCollapse: body.enableContextCollapse !== false,
    });

    let initialized = false;

    try {
      // 初始化，加载历史
      const history = await engine.initialize();
      initialized = true;

      // 添加用户消息
      await engine.addUserMessage(lastUserMessage.content);

      // 获取基础 URL
      const baseUrl = new URL(req.url).origin;

      // 检查并执行自动压缩
      await engine.checkAndCompact(REACT_CHAT_V2_PROMPT);

      // 获取对话历史
      let persistentHistory: any[] = [];
      try {
        persistentHistory = await engine.getMessages();
      } catch {}

      // 构建消息列表（用于 LangGraph）
      const allMessages = persistentHistory.map((h: any) => {
        const content = typeof h.content === "string" ? h.content : String(h.content);
        if (h.role === "assistant") return new AIMessage(content);
        return new HumanMessage(content);
      });
      allMessages.push(new HumanMessage(lastUserMessage.content));

      // 裁剪消息到 token 限制
      const inputMessages = await trimMessages(allMessages, {
        maxTokens: 4000,
        strategy: "last",
        includeSystem: true,
        startOn: "human",
        allowPartial: true,
        tokenCounter: countTokens,
      });

      // 创建 Guard
      const limits = { ...DEFAULT_RESOURCE_LIMITS };
      const guard = new LoopGuard({ maxTurns: limits.maxTurns, tokenBudget: limits.tokenBudget });

      // 创建只读工具注册表
      const { tools, rawTools } = createReadOnlyToolRegistry({ userId, guard, limits });

      // 创建 LLM
      const llm = createAgentModel({ temperature: 0.7, maxTokens: 4000 });

      // 构建系统提示词
      const systemPrompt = REACT_CHAT_V2_PROMPT + REACT_CHAT_V2_NEGATIVE_PROMPT;

      // AbortController + 5 分钟全局超时
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(), 5 * 60 * 1000);
      if (req.signal) {
        req.signal.addEventListener("abort", () => {
          clearTimeout(timeoutId);
          abortCtrl.abort();
        }, { once: true });
      }

      // 流式响应
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const send = createSSESender(controller);
          const startTime = Date.now();

          try {
            // 发送初始信息
            send("init", { sessionKey });

            // 调用 ReAct Chat
            const result = await runReActChat({
              messages: inputMessages,
              systemPrompt,
              llm,
              tools,
              rawTools,
              guard,
              engine,
              signal: abortCtrl.signal,
              send,
              baseUrl,
            });

            // 发送引用来源
            if (result.sources.length > 0) {
              send("sources", result.sources);
            }

            // 记录使用日志
            try {
              await prisma.usageLog.create({
                data: {
                  sessionId: sessionKey,
                  query: lastUserMessage.content.slice(0, 500),
                  answerLength: result.finalText.length,
                  citations: result.sources.length,
                  latencyMs: Date.now() - startTime,
                },
              });
            } catch (logError) {
              console.error("[使用日志] 记录失败:", logError);
            }

            send("done", {});
          } catch (err: any) {
            if (err.name === "AbortError") {
              send("done", { reason: "cancelled" });
            } else {
              console.error("[chat/v2] error:", err);
              send("error", { message: err.message || "模型调用失败" });
            }
          } finally {
            clearTimeout(timeoutId);
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...SSE_HEADERS,
          "X-Session-Key": sessionKey,
        },
      });
    } finally {
      if (initialized) {
        await engine.release();
      }
    }
  } catch (error) {
    console.error("Chat v2 failed:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
