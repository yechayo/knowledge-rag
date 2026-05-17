import { NextResponse } from "next/server";
import { evaluateCitationQuality, getQualitySummary } from "@/lib/citation-evaluator";
import { createQueryEngine } from "@/lib/agent/chat";
import { createSSESender, SSE_HEADERS } from "@/lib/agent/stream/sse";
import { prisma } from "@/lib/prisma";
import { classifyChatIntent } from "@/lib/rag-chat/intent";
import { retrieveGrouped, extractSources } from "@/lib/rag-chat/retrieve";
import { streamDirectAnswer, streamRetrievedAnswer } from "@/lib/rag-chat/generate";
import { runRagReactAnswer } from "@/lib/rag-chat/react";
import { buildInputMessagesFromHistory } from "@/lib/rag-chat/messages";

function now() {
  return Date.now();
}

export async function POST(req: Request) {
  try {
    const { message, sessionKey } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response("Missing message", { status: 400 });
    }

    const query = message.trim();
    const key = sessionKey || `rag:chat:${Date.now()}`;

    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 5 * 60 * 1000);
    if (req.signal) {
      req.signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        abortCtrl.abort();
      }, { once: true });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const send = createSSESender(controller);
        const totalStart = now();
        let intentLatencyMs = 0;
        let retrieveLatencyMs = 0;
        let modelLatencyMs = 0;
        let answer = "";
        let citations = 0;
        let route = "retrieve_once";
        let intentSource = "fallback";

        try {
          send("init", { sessionKey: key });

          const intentStart = now();
          const intent = await classifyChatIntent(query);
          intentLatencyMs = now() - intentStart;
          route = intent.route;
          intentSource = intent.source;
          send("route", { route: intent.route, source: intent.source, reason: intent.reason });

          const hasLocalReply = intent.route === "direct" && Boolean(intent.localReply);
          if (!process.env.DEEPSEEK_API_KEY && !hasLocalReply) {
            send("error", { message: "服务配置异常：缺少 DEEPSEEK_API_KEY" });
            return;
          }

          const modelStart = now();
          if (intent.route === "direct") {
            if (intent.localReply) {
              answer = intent.localReply;
              send("delta", { content: answer });
            } else {
              answer = await streamDirectAnswer(query, send, { signal: abortCtrl.signal });
            }
          } else if (intent.route === "react_retrieve") {
            const engine = await createQueryEngine(key, "anonymous", "chat", {
              apiKey: process.env.DEEPSEEK_API_KEY!,
              enableAutoCompact: false,
            });
            let initialized = false;
            try {
              await engine.initialize();
              initialized = true;
              await engine.addUserMessage(query);
              const inputMessages = await buildInputMessagesFromHistory(await engine.getMessages(), query, 4000);
              const result = await runRagReactAnswer({
                messages: inputMessages,
                systemPrompt: "你是知识库 ReAct 助手。复杂问题应先调用 search_knowledge_base 检索，再基于结果回答并使用 [[REF:/category/slug#anchor|短标签]] 引用。不要编造链接。",
                engine,
                signal: abortCtrl.signal,
                send,
              });
              answer = result.answer;
              citations = result.sources.length;
              if (result.sources.length > 0) send("sources", result.sources);
            } finally {
              if (initialized) {
                try { await engine.release(); } catch {}
              }
            }
          } else {
            const retrieveStart = now();
            const grouped = await retrieveGrouped(intent.normalizedQuery || query);
            retrieveLatencyMs = now() - retrieveStart;
            const sources = extractSources(grouped);
            citations = sources.length;
            answer = await streamRetrievedAnswer(query, grouped, sources, send, { signal: abortCtrl.signal });
            if (sources.length > 0) send("sources", sources);
            if (answer && sources.length > 0) {
              try {
                const report = evaluateCitationQuality(answer, query, sources);
                console.log("[引用质量评估]", JSON.stringify({ query: query.slice(0, 50), ...report, summary: getQualitySummary(report) }));
              } catch (error) {
                console.error("[引用质量评估] 评估出错:", error);
              }
            }
          }
          modelLatencyMs = now() - modelStart - retrieveLatencyMs;

          const totalLatencyMs = now() - totalStart;
          try {
            await prisma.usageLog.create({
              data: {
                sessionId: key,
                query: query.slice(0, 500),
                answerLength: answer.length,
                citations,
                latencyMs: totalLatencyMs,
                metadata: {
                  route,
                  intentSource,
                  intentLatencyMs,
                  retrieveLatencyMs,
                  modelLatencyMs,
                  totalLatencyMs,
                },
              },
            });
          } catch (error) {
            console.error("[使用日志] 记录失败:", error);
          }

          console.log("[rag-chat]", JSON.stringify({ route, intentSource, intentLatencyMs, retrieveLatencyMs, modelLatencyMs, totalLatencyMs }));
          send("done", {});
        } catch (err: any) {
          if (err.name === "AbortError") send("done", { reason: "cancelled" });
          else {
            console.error("[chat] error:", err);
            send("error", { message: err.message || "模型调用失败" });
          }
        } finally {
          clearTimeout(timeoutId);
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    console.error("Chat failed:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
