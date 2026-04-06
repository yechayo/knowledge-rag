/**
 * MCP Server 路由
 * 基于 Streamable HTTP 传输协议，暴露 KnowledgeRag 的内容管理工具
 */
import { createMcpHandler } from 'mcp-handler';
import { registerTools } from '@/lib/mcp-tools';
import { validateMcpRequest, McpAuthError } from '@/lib/mcp-auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

const mcpHandler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {
    serverInfo: {
      name: 'knowledge-rag',
      version: '1.0.0',
    },
  },
  {
    maxDuration: 120,
    basePath: '/api',
  },
);

async function handleRequest(request: Request): Promise<Response> {
  // 校验 API Key
  try {
    validateMcpRequest(request);
  } catch (err) {
    if (err instanceof McpAuthError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw err;
  }

  return mcpHandler(request);
}

export async function POST(request: Request) {
  return handleRequest(request);
}

export async function GET(request: Request) {
  return handleRequest(request);
}

export async function DELETE(request: Request) {
  return handleRequest(request);
}
