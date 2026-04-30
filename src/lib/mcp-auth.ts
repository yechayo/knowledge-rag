/**
 * MCP API Key 认证
 * 校验 MCP 客户端请求的 Authorization: Bearer <key> 头
 */

export class McpAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpAuthError';
  }
}

export function validateMcpRequest(request: Request): void {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    throw new McpAuthError('缺少 Authorization 请求头');
  }

  const expectedKey = process.env.MCP_API_KEY;
  if (!expectedKey) {
    throw new McpAuthError('服务端未配置 MCP_API_KEY');
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (token !== expectedKey) {
    throw new McpAuthError('API Key 无效');
  }
}
