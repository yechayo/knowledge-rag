import { createGLM5 } from "@/lib/langchain/llm";
import { duckduckgoSearch, createContent, listContent, deleteContent } from "./tools";
import { getSystemPrompt, NEWS_AGENT_PROMPT } from "./prompts/react_agent";
import { createAgentExecutor, createReactAgent } from "@langchain/langgraph/prebuilt";

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
 * 创建 Agent 执行器核心逻辑
 * @param tools 工具列表
 * @param systemPrompt 系统提示词
 */
async function createAgentExecutorCore(
  tools: any[],
  systemPrompt: string
) {
  const llm = createGLM5({ temperature: 0.7, maxTokens: 4000 });
  const agent = await createReactAgent({
    llm,
    tools,
    prompt: getSystemPrompt(systemPrompt),
  });
  return createAgentExecutor({ agentRunnable: agent, tools });
}

/**
 * 创建新闻 Agent 执行器
 */
export async function createNewsAgentExecutor() {
  const tools: any[] = [duckduckgoSearch, createContent, listContent, deleteContent];
  return createAgentExecutorCore(tools, NEWS_AGENT_PROMPT);
}

export { createAgentExecutorCore };

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
