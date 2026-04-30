/**
 * MCP Streamable HTTP 路由
 * 使用 @modelcontextprotocol/sdk 原生 transport，无中间封装
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerTools } from '@/lib/mcp-tools';
import { validateMcpRequest, McpAuthError } from '@/lib/mcp-auth';

export const runtime = 'nodejs';

/**
 * 为每个请求创建独立的 transport + server（stateless 模式）
 */
async function handleMcpRequest(request: Request): Promise<Response> {
  // Bearer Token 认证（GET SSE 请求可跳过，实际由 transport 决定）
  if (request.method !== 'GET') {
    try {
      validateMcpRequest(request);
    } catch (err) {
      if (err instanceof McpAuthError) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32001, message: err.message },
            id: null,
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      throw err;
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless 模式
    enableJsonResponse: true,     // 直接返回 JSON，不使用 SSE 流
  });

  const server = new McpServer(
    { name: 'yechayo', version: '1.0.0' },
  );

  registerTools(server);
  await server.connect(transport);

  const response = await transport.handleRequest(request);
  await transport.close();

  return response;
}

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function GET(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}
