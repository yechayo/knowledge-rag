/**
 * 长对话 Chat API v2
 * 支持跨请求累积对话历史、自动压缩、Token 预算监控
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createQueryEngine, ChatV2Request } from "@/lib/agent/chat";
import { prisma } from "@/lib/prisma";

/**
 * 无内容时的固定回复
 */
const NO_CONTENT_REPLY = `你是知识库问答助手。当前知识库中没有找到与用户问题相关的内容。

你必须原话回复："知识库中暂未收录此内容，建议浏览网站寻找相关文章。"

严禁使用你自身的任何知识来回答问题。`;

/**
 * POST /api/chat/v2 - 长对话聊天接口
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id || "anonymous";

  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: "服务配置异常：缺少 API Key" }) + "\n\n",
      { headers: { "Content-Type": "text/event-stream" } }
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

      // 获取检索结果
      const baseUrl = new URL(req.url).origin;
      const grouped = await retrieveKnowledge(lastUserMessage.content, baseUrl);

      // 构建系统提示词
      const hasContent =
        grouped.nav_structure.length > 0 ||
        grouped.content_meta.length > 0 ||
        grouped.toc_entry.length > 0 ||
        grouped.content_body.length > 0;

      const systemPrompt = hasContent
        ? buildSystemPrompt(grouped)
        : NO_CONTENT_REPLY;

      // 检查并执行自动压缩
      const { messages: processedMessages, budget } = await engine.checkAndCompact(systemPrompt);

      // 构建对话上下文
      const historyForLLM = processedMessages
        .slice(0, -1) // 去掉刚添加的用户消息
        .map((m) => ({ role: m.role, content: m.content }));

      const chatMessages = [
        { role: "system" as const, content: systemPrompt },
        ...historyForLLM,
        { role: "user" as const, content: lastUserMessage.content },
      ];

      // 如果需要，注入 nudge message
      if (budget.nudgeMessage) {
        chatMessages.push({
          role: "system",
          content: `[系统]: ${budget.nudgeMessage}`,
        });
      }

      // 提取去重后的引用来源
      const sources = extractSources(grouped);

      // 流式响应
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const startTime = Date.now();

          try {
            // 发送初始信息
            controller.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify({
                    type: "init",
                    data: { sessionKey, compacted: processedMessages.length < messages.length },
                  }) +
                  "\n\n"
              )
            );

            // 发送 token 预算信息
            controller.enqueue(
              encoder.encode(
                "data: " + JSON.stringify({ type: "token_budget", data: budget }) + "\n\n"
              )
            );

            // 调用 LLM
            const response = await fetch(
              "https://open.bigmodel.cn/api/paas/v4/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: "Bearer " + apiKey,
                },
                body: JSON.stringify({
                  model: "GLM-4.5-AirX",
                  messages: chatMessages,
                  temperature: 0.5,
                  max_tokens: 4000,
                  stream: true,
                  do_sample: true,
                  thinking: {
                    enable: true,
                    budget_tokens: 2000,
                  },
                }),
              }
            );

            if (!response.ok) {
              const errorText = await response.text();
              controller.enqueue(
                encoder.encode(
                  "data: " + JSON.stringify({ type: "error", data: errorText }) + "\n\n"
                )
              );
              controller.close();
              return;
            }

            const reader = response.body?.getReader();
            if (!reader) {
              controller.enqueue(
                encoder.encode(
                  "data: " + JSON.stringify({ type: "error", data: "No response body" }) + "\n\n"
                )
              );
              controller.close();
              return;
            }

            const decoder = new TextDecoder();
            let buffer = "";
            let fullAnswer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;
                const data = trimmed.slice(5).trim();
                if (data === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(data);
                  const choice = parsed.choices?.[0];
                  const content = choice?.delta?.content;

                  if (content) {
                    fullAnswer += content;
                    controller.enqueue(
                      encoder.encode(
                        "data: " + JSON.stringify({ type: "answer", data: content }) + "\n\n"
                      )
                    );
                  }
                } catch {
                  // 忽略解析错误
                }
              }
            }

            // 保存助手消息
            if (fullAnswer) {
              await engine.addAssistantMessage(fullAnswer);
            }

            // 发送引用来源
            if (sources.length > 0) {
              controller.enqueue(
                encoder.encode(
                  "data: " +
                    JSON.stringify({ type: "sources", data: sources }) +
                    "\n\n"
                )
              );
            }

            // 记录使用日志
            try {
              await prisma.usageLog.create({
                data: {
                  sessionId: sessionKey,
                  query: lastUserMessage.content.slice(0, 500),
                  answerLength: fullAnswer.length,
                  citations: sources.length,
                  latencyMs: Date.now() - startTime,
                },
              });
            } catch (logError) {
              console.error("[使用日志] 记录失败:", logError);
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (error) {
            controller.enqueue(
              encoder.encode(
                "data: " +
                  JSON.stringify({ type: "error", data: String(error) }) +
                  "\n\n"
              )
            );
            controller.close();
          }
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
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

/**
 * 简单的 RAG 检索（复用现有逻辑）
 */
async function retrieveKnowledge(
  query: string,
  baseUrl: string
): Promise<{
  nav_structure: any[];
  content_meta: any[];
  toc_entry: any[];
  content_body: any[];
}> {
  try {
    const retrieveUrl = `${baseUrl}/api/retrieve`;
    const response = await fetch(retrieveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, grouped: true, topK: 10 }),
    });

    if (!response.ok) {
      return {
        nav_structure: [],
        content_meta: [],
        toc_entry: [],
        content_body: [],
      };
    }

    const data = await response.json();
    return data.grouped || {
      nav_structure: [],
      content_meta: [],
      toc_entry: [],
      content_body: [],
    };
  } catch (error) {
    console.error("Retrieve failed:", error);
    return {
      nav_structure: [],
      content_meta: [],
      toc_entry: [],
      content_body: [],
    };
  }
}

/**
 * 构建系统提示词（复用现有逻辑）
 */
function buildSystemPrompt(grouped: {
  nav_structure: any[];
  content_meta: any[];
  toc_entry: any[];
  content_body: any[];
}): string {
  function buildNavSection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无站点结构信息";
    return chunks.map((c) => c.content).join("\n");
  }

  function buildContentMetaSection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无相关内容概览";
    return chunks
      .map((c, i) => {
        const tags = c.sourceTags?.length ? " - " + c.sourceTags.join(", ") : "";
        const preview =
          c.content.length > 150 ? c.content.slice(0, 150) + "..." : c.content;
        return (
          "[" +
          (i + 1) +
          "] 《" +
          c.title +
          "》- " +
          c.category +
          tags +
          " (链接: /" +
          c.category +
          "/" +
          c.slug +
          ") - " +
          preview
        );
      })
      .join("\n");
  }

  function buildTocSection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无相关目录信息";
    return chunks
      .map((c, i) => {
        return (
          "[" +
          (i + 1) +
          "] 《" +
          c.title +
          "》目录: " +
          (c.sectionPath || c.content)
        );
      })
      .join("\n");
  }

  function buildContentBodySection(chunks: any[]): string {
    if (chunks.length === 0) return "暂无详细内容";
    return chunks
      .map((c, i) => {
        const normalizedAnchor = c.headingText
          ? generateHeadingAnchor(c.headingText)
          : c.headingAnchor || "";
        const link = normalizedAnchor
          ? "/" + c.category + "/" + c.slug + "#" + normalizedAnchor
          : "/" + c.category + "/" + c.slug;
        return (
          "[" +
          (i + 1) +
          "] 《" +
          c.title +
          "》" +
          (c.sectionPath ? "- " + c.sectionPath : "") +
          " (链接: " +
          link +
          ")\n" +
          c.content
        );
      })
      .join("\n\n---\n\n");
  }

  const prompt = `[角色设定]
你是一个知识库问答助手。你的全部知识来源于下方提供的知识库内容。

[核心原则]
- 你的知识来源只有下方"知识库内容"，严禁使用自身的预训练知识来回答
- 但你可以对知识库中已有的信息进行对比、归纳、总结、推理
- 例如：用户要求对比 React 和 Vue，即使知识库中没有直接写"React和Vue的对比"，只要知识库中有 React 相关内容和 Vue 相关内容，你就应该分别提取这两部分信息进行对比回答

[知识库内容]
## 网站结构
${buildNavSection(grouped.nav_structure)}

## 相关内容概览
${buildContentMetaSection(grouped.content_meta)}

## 相关目录
${buildTocSection(grouped.toc_entry)}

## 详细内容
${buildContentBodySection(grouped.content_body)}

[引用标记规则 - 必须遵守]
你的回答中使用内联省略内容标记来引用知识库，格式为 [[REF:完整链接|缩写内容]]。
- 完整链接直接使用详细内容中给出的"链接"值，例如：[[REF:/article/react-hooks#usestate基础用法|最基础的 Hook]]
- 标记由两部分组成：完整链接（含 /category/slug#anchor）和 |后的缩写内容
- 链接不带引号，直接从"详细内容"的"链接:"后面复制
- 缩写内容用简短几个字概括被引用内容的核心含义，显示在回答中
- 同一来源多次引用使用相同标记（链接相同）
- 禁止在回答末尾额外列出引用来源
- 绝对不使用自身的预训练知识回答问题
- 如果知识库中没有相关内容，原话回复："知识库中暂未收录此内容，建议浏览网站寻找相关文章。"（不包含任何引用标记）

[回答前自省 - 你必须按以下步骤思考后再输出最终回答]

在输出正式回答之前，请严格完成以下自省检查：

1. 检查语料引用是否正确：
   - 我的每一个 [[REF:...|...]] 标记中的链接是否与"详细内容"中给出的"链接"完全一致？
   - 链接格式是否正确：以 / 开头，包含 /category/slug，如需要锚点则加 #锚点
   - 我有没有捏造 slug 或 headingAnchor？

2. 检查是否使用了预训练知识：
   - 我的回答中有没有任何信息是来自"知识库内容"之外的？
   - 如果有，请删除那些未经证实的陈述

3. 确认引用覆盖度：
   - 用户问题涉及的所有关键信息是否都已被引用标记覆盖？
   - 是否有遗漏的重要知识点没有引用？

完成自省后，直接输出最终回答（不要在回答中提及"自省"或任何反思过程）。如果自省发现问题，请先修正后再输出。`;

  return prompt;
}

/**
 * 生成标题锚点
 */
function generateHeadingAnchor(headingText: string): string {
  return headingText
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 提取引用来源
 */
function extractSources(grouped: {
  nav_structure: any[];
  content_meta: any[];
  toc_entry: any[];
  content_body: any[];
}): any[] {
  const seen = new Map<string, any>();

  for (const chunk of grouped.content_body) {
    const key = chunk.slug + "::" + (chunk.headingAnchor || "");
    if (!seen.has(key)) {
      seen.set(key, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: chunk.headingText
          ? generateHeadingAnchor(chunk.headingText)
          : chunk.headingAnchor,
        headingText: chunk.headingText,
        sectionPath: chunk.sectionPath,
        contentPreview:
          chunk.content.length > 100
            ? chunk.content.slice(0, 100) + "..."
            : chunk.content,
      });
    }
  }

  const existingSlugs = new Set(grouped.content_body.map((c) => c.slug));
  for (const chunk of grouped.content_meta) {
    if (!existingSlugs.has(chunk.slug)) {
      seen.set(chunk.slug, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: null,
        headingText: null,
        sectionPath: null,
        contentPreview:
          chunk.content.length > 100
            ? chunk.content.slice(0, 100) + "..."
            : chunk.content,
      });
    }
  }

  return Array.from(seen.values());
}
