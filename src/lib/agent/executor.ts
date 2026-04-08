import { createGLM5 } from "@/lib/langchain/llm";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "./tools";
import { getSystemPrompt, NEWS_AGENT_PROMPT } from "./prompts/react_agent";
import { createAgentExecutor, createReactAgent } from "@langchain/langgraph/prebuilt";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools: any[] = [duckduckgoSearch, createContent, listContent, deleteContent];

/** 默认超时时间: 5 分钟 */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 超时错误类
 */
export class AgentTimeoutError extends Error {
  constructor(message: string = "Agent execution timed out") {
    super(message);
    this.name = "AgentTimeoutError";
  }
}

/**
 * 创建新闻 Agent 执行器
 */
export async function createNewsAgentExecutor() {
  const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });

  const agent = await createReactAgent({
    llm,
    tools,
    prompt: getSystemPrompt(NEWS_AGENT_PROMPT),
  });

  return createAgentExecutor({ agentRunnable: agent, tools });
}

/**
 * 带超时控制的 agent 调用
 * @param executor AgentExecutor 实例
 * @param input 输入参数
 * @param timeoutMs 超时时间（毫秒），默认 5 分钟
 */
async function invokeWithTimeout(
  executor: ReturnType<typeof createAgentExecutor>,
  input: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new AgentTimeoutError(`Agent execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const executionPromise = executor.invoke(input);

  return Promise.race([executionPromise, timeoutPromise]);
}

/**
 * 任务配置接口
 */
export interface TaskConfig {
  /** 任务提示词 */
  prompt: string;
  /** 超时时间（毫秒），默认 5 分钟 */
  timeoutMs?: number;
}

/**
 * 执行动态任务
 * @param config 任务配置
 */
export async function runTask(config: TaskConfig) {
  const executor = await createNewsAgentExecutor();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const result = await invokeWithTimeout(
    executor,
    { messages: [{ role: "user", content: config.prompt }] },
    timeoutMs
  );

  return result;
}

/**
 * 执行新闻早报任务（带超时控制）
 */
export async function runNewsAgent() {
  const executor = await createNewsAgentExecutor();

  const result = await invokeWithTimeout(executor, {
    messages: [{ role: "user", content: "请生成今日新闻早报并发布到网站" }],
  });

  return result;
}
