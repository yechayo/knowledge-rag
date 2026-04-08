import { createGLM5 } from "@/lib/langchain/llm";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "./tools";
import { getSystemPrompt, NEWS_AGENT_PROMPT } from "./prompts/react_agent";
import { AgentExecutor, createReactAgent } from "@langchain/langgraph/prebuilt";
import { MemorySaver } from "@langchain/langgraph/checkpoint.memory";

const tools = [duckduckgoSearch, createContent, listContent, deleteContent];

/**
 * 创建新闻 Agent 执行器
 */
export async function createNewsAgentExecutor() {
  const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });

  const agent = createReactAgent({
    llm,
    tools,
    prompt: getSystemPrompt(NEWS_AGENT_PROMPT),
    checkpointSaver: new MemorySaver(),
  });

  return new AgentExecutor({ agent, tools });
}

/**
 * 执行新闻早报任务
 */
export async function runNewsAgent() {
  const executor = await createNewsAgentExecutor();

  const result = await executor.invoke({
    messages: [{ role: "user", content: "请生成今日新闻早报并发布到网站" }],
  });

  return result;
}
