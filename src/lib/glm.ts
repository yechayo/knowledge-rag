/**
 * 智谱 AI GLM 聊天服务模块
 */

/**
 * 获取 API Key，运行时检查
 */
function getApiKey(): string {
  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) {
    throw new Error('缺少环境变量 BIGMODEL_API_KEY，请在 .env 中配置智谱 AI API Key');
  }
  return apiKey;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 调用智谱 AI Chat API
 * @param messages 对话消息数组
 * @param model 模型名称（默认 glm-4-flash）
 * @returns 助手回复内容
 */
export async function chat(messages: Message[], model: string = 'glm-4-flash'): Promise<string> {
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GLM API 请求失败: ${response.status} ${errorText}`);
  }

  const result: ChatResponse = await response.json();

  if (!result.choices?.[0]?.message?.content) {
    throw new Error('GLM API 返回格式异常');
  }

  return result.choices[0].message.content;
}

/**
 * 构建带有检索上下文的 RAG 提示词
 */
export function buildRAGPrompt(query: string, contexts: Array<{ content: string; pageStart: number; pageEnd: number; docName?: string }>): Message[] {
  const contextText = contexts
    .map((c, idx) => `[文档片段 ${idx + 1}，来源: ${c.docName || '未知文档'}，页码 ${c.pageStart}-${c.pageEnd}]\n${c.content}`)
    .join('\n\n---\n\n');

  return [
    {
      role: 'system',
      content: `你是一个专业的知识库助手。请基于以下检索到的文档片段回答用户问题。

回答要求：
1. 优先使用提供的文档片段内容
2. 如果文档中没有相关信息，请明确告知
3. 回答时请注明引用的文件名和页码
4. 保持简洁准确

检索到的文档片段：
${contextText}`,
    },
    {
      role: 'user',
      content: query,
    },
  ];
}
