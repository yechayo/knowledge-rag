/**
 * 智谱 AI 视觉理解模块 - 使用 GLM-4V-Flash 为图片生成文字描述
 */

function getApiKey(): string {
  const apiKey = process.env.BIGMODEL_API_KEY;
  if (!apiKey) {
    throw new Error('缺少环境变量 BIGMODEL_API_KEY');
  }
  return apiKey;
}

/**
 * 调用 GLM-4V-Flash 描述图片内容
 * @param imageUrl 图片 URL（支持公网地址和 base64）
 * @returns 中文图片描述
 */
export async function describeImage(imageUrl: string): Promise<string> {
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: 'glm-4v-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
            {
              type: 'text',
              text: '请用中文简短描述这张图片的内容，用于语义检索，50字以内。',
            },
          ],
        },
      ],
      max_tokens: 100,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Vision API 请求失败: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  const description = result.choices?.[0]?.message?.content;
  if (!description) {
    throw new Error('Vision API 返回格式异常');
  }

  return description.trim();
}
