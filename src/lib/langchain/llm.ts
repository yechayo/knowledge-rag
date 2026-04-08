import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

/**
 * 创建 GLM 模型 LangChain 实例
 */
export function createGLM5(config?: {
  temperature?: number;
  maxTokens?: number;
}): BaseChatModel {
  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) {
    throw new Error("缺少环境变量 BIGMODEL_API_KEY");
  }

  return new ChatOpenAI({
    model: "glm-4-flash",
    apiKey,
    configuration: {
      baseURL: "https://open.bigmodel.cn/api/paas/v4",
    },
    temperature: config?.temperature ?? 0.7,
    maxTokens: config?.maxTokens ?? 2000,
  });
}
