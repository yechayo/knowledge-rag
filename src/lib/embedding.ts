/**
 * Embedding 服务模块
 * 使用智谱 AI Embedding API 生成向量
 */

const EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS || '256', 10);

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

export interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
    object: string;
  }>;
  model: string;
  object: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * 调用智谱 AI Embedding API
 * @param text 输入文本
 * @returns 256维向量数组
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new Error('输入文本不能为空');
  }

  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: 'embedding-3',
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
      encoding_format: 'float',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API 请求失败: ${response.status} ${errorText}`);
  }

  const result: EmbeddingResponse = await response.json();

  if (!result.data?.[0]?.embedding) {
    throw new Error('Embedding API 返回格式异常');
  }

  const embedding = result.data[0].embedding;

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding 维度不匹配: 期望 ${EMBEDDING_DIMENSIONS}, 实际 ${embedding.length}`);
  }

  return embedding;
}

/**
 * 批量生成 embedding（用于索引场景）
 * @param texts 文本数组
 * @returns 二维向量数组
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // 智谱 API 支持批量请求，最多 8 个
  const BATCH_SIZE = 8;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await Promise.all(
      batch.map(text => generateEmbedding(text))
    );
    results.push(...batchEmbeddings);
  }

  return results;
}

/**
 * 将向量数组转为 PostgreSQL 格式字符串
 * 例如: [0.1, 0.2, 0.3] -> "[0.1,0.2,0.3]"
 */
export function vectorToPostgresFormat(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * 从 PostgreSQL 格式解析向量数组
 */
export function vectorFromPostgresFormat(str: string): number[] {
  return str
    .slice(1, -1) // 去掉方括号
    .split(',')
    .map(Number);
}
