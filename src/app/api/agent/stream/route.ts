import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAgentModel, type AgentModelConfig } from "@/lib/langchain/llm";
import {
  duckduckgoSearch, createContent, listContent, listCategories, deleteContent
} from "@/lib/agent/tools";
import {
  getOrCreateSession,
  acquireSessionLock,
} from "@/lib/agent/session";
import { createQueryEngine, ChatMessage } from "@/lib/agent/chat";
import { ADMIN_CHAT_PROMPT, ADMIN_CHAT_NEGATIVE_PROMPT } from "@/lib/agent/prompts/admin_chat";
import { HumanMessage } from "@langchain/core/messages";
import { getSkillPrompt } from "@/lib/agent/skills";
import { resolveSkillContext } from "@/lib/agent/skillRouter";
import {
  loadMemories,
  loadTeamMemories,
  formatMemoriesForPrompt,
  loadProjectContext,
} from "@/lib/agent/memory";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  const userId = (session?.user as any)?.id || "admin";
  if (!isAdmin) throw new Error("Unauthorized");
  return userId;
}

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireAdmin();
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Unauthorized" } }) + "\n\n",
      { status: 401, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let body: { message?: string; sessionKey?: string; skill?: string; modelConfig?: AgentModelConfig };
  try { body = await req.json(); } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Invalid request body" } }) + "\n\n",
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { message, sessionKey, skill: explicitSkill, modelConfig } = body;
  if (!message || typeof message !== "string") {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Invalid message" } }) + "\n\n",
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const key = sessionKey || `agent:chat:${Date.now()}`;

  let session;
  try {
    session = await getOrCreateSession(key, "chat", userId);
  } catch {
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Session error" } }) + "\n\n",
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // 创建并初始化 QueryEngine
  const apiKey = modelConfig?.apiKey || process.env.BIGMODEL_API_KEY || "";
  let engine;
  try {
    engine = await createQueryEngine(key, userId, "chat", { apiKey });
  } catch (err) {
    console.error("[stream] createQueryEngine failed:", err);
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Session error" } }) + "\n\n",
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let engineInitialized = false;
  try {
    await engine.initialize();
    engineInitialized = true;
  } catch (err) {
    console.error("[stream] engine.initialize failed:", err);
    return new Response(
      "data: " + JSON.stringify({ type: "error", data: { message: "Session lock error" } }) + "\n\n",
      { status: 409, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // 添加用户消息到持久化历史
  try {
    await engine.addUserMessage(message);
  } catch (err) {
    console.error("[stream] addUserMessage failed:", err);
  }

  // 解析 skill 上下文
  const skillCtx = resolveSkillContext(message, explicitSkill);
  let skillPrompt = ADMIN_CHAT_PROMPT + ADMIN_CHAT_NEGATIVE_PROMPT;
  let cleanMessage = message;

  if (skillCtx.activeSkill) {
    const loaded = await getSkillPrompt(skillCtx.activeSkill);
    if (loaded) {
      skillPrompt = loaded + ADMIN_CHAT_NEGATIVE_PROMPT;
      cleanMessage = skillCtx.cleanMessage || message;
    }
  }

  // 加载项目上下文和记忆（提前加载，不在流内做）
  const [projectContext, memories, teamMemories] = await Promise.all([
    loadProjectContext(),
    loadMemories(userId),
    loadTeamMemories(),
  ]);

  const allMemories = [...memories, ...teamMemories];
  const memorySection = formatMemoriesForPrompt(allMemories);
  const contextSection = projectContext ? `\n\n${projectContext}` : "";

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (type: string, data: unknown) =>
        controller.enqueue(enc.encode("data: " + JSON.stringify({ type, data }) + "\n\n"));

      try {
        send("init", { sessionId: session!.id, sessionKey: key, activeSkill: skillCtx.activeSkill });

        const llm = createAgentModel({ temperature: 0.7, maxTokens: 4000 }, modelConfig);

        // Remember 工具（需要 userId）
        const remember = tool(
          async ({ name, description, content, type }: {
            name: string;
            content: string;
            type?: "user" | "feedback" | "project" | "reference";
            description?: string;
          }) => {
            await prisma.agentMemory.create({
              data: {
                userId,
                name,
                description: description || null,
                content,
                type: type || "project",
                isPrivate: true,
              },
            });
            return `记忆已保存: [${type || "project"}] ${name}`;
          },
          {
            name: "remember",
            description: "保存重要信息到长期记忆。当用户分享了个人偏好、确认了正确的做法、给出了反馈、或者需要记住项目相关信息时使用。",
            schema: z.object({
              name: z.string().describe("记忆名称，简短标识"),
              content: z.string().describe("要保存的具体内容"),
              type: z.enum(["user", "feedback", "project", "reference"]).optional().describe("类型: user=用户偏好, feedback=反馈确认, project=项目信息, reference=参考资料"),
              description: z.string().optional().describe("一句话描述"),
            }),
          }
        );

        // 工具列表 = 基础工具 + remember 工具
        const baseTools = [duckduckgoSearch, createContent, listContent, listCategories, deleteContent] as any[];
        const allTools = [...baseTools, remember] as any[];

        // 构建工具描述（从 LangChain tool 获取 schema）
        const toolDescs = allTools.map((t) => {
          const name = (t as any).name || (t as any).lc_name || "";
          const desc = (t as any).description || "";
          const schema = (t as any).schema;
          let params = "";
          if (schema && schema.shape) {
            const fields = Object.keys(schema.shape || {}).map((k) => {
              const f = schema.shape[k];
              return `  - ${k}: ${f._def?.description || "string"}`;
            }).join("\n");
            params = `\n参数:\n${fields}`;
          }
          return `- ${name}: ${desc}${params}`;
        }).join("\n");

        // queryLoop 机制：持续执行直到模型不再请求工具调用
        const MAX_ITERS = 20;
        let iter = 0;
        let needsFollowUp = true;  // 初始为 true，首次调用模型
        let sessionHistory: ChatMessage[] = [];  // 当前请求内的历史

        while (needsFollowUp) {
          // 安全限制
          if (iter >= MAX_ITERS) {
            console.warn("[stream] 达到最大迭代次数，强制结束");
            send("done", {});
            break;
          }
          iter++;

          // 从数据库获取持久化的历史消息
          let persistentHistory: ChatMessage[] = [];
          try {
            persistentHistory = await engine.getMessages();
          } catch (err) {
            console.error("[stream] getMessages failed:", err);
          }

          // 检查并执行自动压缩（首次迭代时检查）
          if (iter === 1) {
            try {
              const { compacted, budget } = await engine.checkAndCompact(skillPrompt);
              if (compacted) {
                console.log(`[stream] AutoCompact triggered, collapsed ${budget.usedTokens} tokens`);
                // 重新获取压缩后的历史
                persistentHistory = await engine.getMessages();
                send("token_budget", budget);
              }
            } catch (err) {
              console.error("[stream] checkAndCompact failed:", err);
            }
          }

          // 合并：持久化历史 + 当前请求内的新消息
          const allHistory = [...persistentHistory, ...sessionHistory];
          const historyText = allHistory.length > 0
            ? "\n\n【对话历史】\n" + allHistory.map((h) => `${h.role === "user" ? "用户" : "助手"}: ${h.content}`).join("\n\n") + "\n\n"
            : "";

          const fullPrompt = [
            skillPrompt,
            contextSection,
            memorySection,
            historyText,
            `【用户当前输入】${cleanMessage}`,
            "\n\n回答要求：简洁、直接、不重复。",
            iter === 1 ? `\n\n可用工具:\n${toolDescs}\n\n如果需要使用工具，按以下格式回复:\n[TOOL_CALL]tool_name|参数JSON[/TOOL_CALL]\n\n如果不需要工具，直接回答用户问题:` : "\n\n(如果用户只是说 ok、好、是 等确认词，不要再问问题，直接执行上一个建议的操作)",
          ].join("");

          // 调用 LLM（流式处理）
          const isAnthropicStreaming = modelConfig?.baseURL?.includes("anthropic");
          let fullText = "";
          let thinkingBuffer = "";
          let suppressTextOutput = false;  // 工具调用后抑制文本输出

          if (isAnthropicStreaming && modelConfig?.apiKey) {
            // 流式调用（支持 thinking 实时推送）
            const apiKey = modelConfig.apiKey;
            const modelName = modelConfig.modelName;
            const baseURL = modelConfig.baseURL;
            const streamRes = await fetch(`${baseURL}/v1/messages`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true",
              },
              body: JSON.stringify({
                model: modelName,
                messages: [{ role: "user", content: fullPrompt }],
                max_tokens: 4000,
                stream: true,
              }),
            });

            if (!streamRes.ok) {
              const errBody = await streamRes.text();
              throw new Error(`API 错误 ${streamRes.status}: ${errBody}`);
            }

            const reader = streamRes.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              while (buffer.includes("\n")) {
                const lineEnd = buffer.indexOf("\n");
                const line = buffer.slice(0, lineEnd).trim();
                buffer = buffer.slice(lineEnd + 1);
                if (!line || !line.startsWith("data:")) continue;

                try {
                  const chunk = JSON.parse(line.slice(5));
                  if (chunk.type === "content_block_delta") {
                    const delta = chunk.delta as any;
                    if (delta.type === "thinking_delta") {
                      thinkingBuffer += delta.thinking;
                      send("thinking", { content: delta.thinking });
                    } else if (delta.type === "text_delta") {
                      fullText += delta.text;
                      // 如果检测到工具调用完成，抑制后续文本输出
                      if (fullText.includes("[/TOOL_CALL]")) {
                        suppressTextOutput = true;
                      }
                      if (!suppressTextOutput) {
                        send("delta", { content: delta.text });
                      }
                    }
                  }
                } catch {}
              }
            }
          } else {
            // 非流式调用（OpenAI 格式）
            try {
              const genResult = await (llm as any)._generate([new HumanMessage(fullPrompt)]);
              const aiMsg = genResult?.generations?.[0]?.message;
              if (aiMsg?.thinking) {
                thinkingBuffer = aiMsg.thinking;
                send("thinking", { content: thinkingBuffer });
              }
              fullText = aiMsg?.content || "";
              // 检查是否有工具调用
              const hasToolCall = /\[TOOL_CALL\]/.test(fullText);
              if (hasToolCall) {
                // 有工具调用时，只发送工具调用部分之前的内容
                const toolCallStart = fullText.indexOf("[TOOL_CALL]");
                const textBeforeTool = fullText.slice(0, toolCallStart);
                for (let j = 0; j < textBeforeTool.length; j += 15) {
                  send("delta", { content: textBeforeTool.slice(j, j + 15) });
                  await new Promise((r) => setTimeout(r, 12));
                }
                suppressTextOutput = true;
              } else {
                // 无工具调用，发送全部内容
                for (let j = 0; j < fullText.length; j += 15) {
                  send("delta", { content: fullText.slice(j, j + 15) });
                  await new Promise((r) => setTimeout(r, 12));
                }
              }
            } catch (invokeErr: any) {
              console.error("[stream] LLM invoke 失败:", invokeErr);
              const errMsg = invokeErr?.message || String(invokeErr);
              throw new Error(errMsg || "模型调用失败");
            }
          }

          const text = fullText;
          if (!text.trim()) break;

          // 检查工具调用
          const toolMatch = text.match(/\[TOOL_CALL\]([^[]+?)\[\/TOOL_CALL\]/);

          if (!toolMatch) {
            // 无工具调用 = 任务完成，退出循环
            needsFollowUp = false;
            // 保存助手消息到持久化历史
            try {
              await engine.addAssistantMessage(text);
            } catch (err) {
              console.error("[stream] addAssistantMessage failed:", err);
            }
            send("done", {});
            break;
          }

          // 有工具调用时，只提取工具调用部分，忽略回复中的其他文本
          // 让模型在看到工具结果后重新生成回答
          const onlyToolCallText = toolMatch[0];
          const toolCallStr = toolMatch[1];
          const pipeIdx = toolCallStr.indexOf("|");

          // 即使没有 | 也提取工具名（允许无参数工具如 list_categories）
          const toolName = pipeIdx !== -1
            ? toolCallStr.slice(0, pipeIdx).trim()
            : toolCallStr.trim();

          let toolArgs: Record<string, unknown> = {};
          if (pipeIdx !== -1) {
            const argsStr = toolCallStr.slice(pipeIdx + 1).trim();
            if (argsStr) {
              try { toolArgs = JSON.parse(argsStr); } catch {}
            }
          }

          send("tool_start", { toolName, arguments: JSON.stringify(toolArgs) });

          // 执行工具
          const matchedTool = allTools.find(
            (t) => (t as any).name === toolName || (t as any).lc_name === toolName
          );
          let result: string;
          if (matchedTool) {
            try {
              const r = await (matchedTool as any).invoke(toolArgs);
              result = typeof r === "string" ? r : JSON.stringify(r);
            } catch (err) {
              result = err instanceof Error ? err.message : String(err);
            }
          } else {
            result = `Tool not found: ${toolName}`;
          }

          send("tool_end", {
            toolName,
            result,
            success: !result.startsWith("Tool not found") && !result.includes("Error"),
          });
          // 记录工具调用到当前请求内的临时历史
          sessionHistory.push({ role: "assistant", content: onlyToolCallText, timestamp: Date.now() });
          sessionHistory.push({ role: "user", content: `[TOOL_RESULT ${toolName}]: ${result}`, timestamp: Date.now() });

          // 工具执行完毕，发送 done 表示这轮结束
          // 下一轮循环会生成新的 assistant 消息来生成最终回答
          send("done", { toolCompleted: true });

          // 继续循环，让模型基于工具结果决定下一步
          // MAX_ITERS = 20 作为安全保护
        }
      } catch (err) {
        console.error("[stream] error:", err);
        const msg = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
        send("error", { message: msg || "模型调用失败，请检查 API 配置" });
      } finally {
        if (engine && engineInitialized) {
          try { await engine.release(); } catch (err) { console.error("[stream] engine.release failed:", err); }
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
