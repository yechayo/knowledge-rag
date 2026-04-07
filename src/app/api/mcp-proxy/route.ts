/**
 * MCP 代理 API 路由
 * 用于在服务器端转发 MCP 请求，解决跨域问题
 *
 * 重要：服务器端的 MCP 服务器要求：
 * 1. 第一个请求是 initialize，返回 sessionId
 * 2. 后续所有请求都必须带上相同的 sessionId
 * 3. initialize 后必须发送 notifications/initialized 通知
 */
import { NextRequest } from 'next/server';

const MCP_URL = process.env.NEXT_PUBLIC_MCP_URL || "http://localhost:3001/mcp";
const AUTH_TOKEN = process.env.NEXT_PUBLIC_MCP_AUTH_TOKEN || "";

// 会话存储 - 简单实现，5分钟过期
const sessions: Record<string, { sessionId: string; createdAt: number }> = {};
const SESSION_TTL = 5 * 60 * 1000; // 5分钟

function cleanExpiredSessions() {
  const now = Date.now();
  for (const key of Object.keys(sessions)) {
    if (now - sessions[key].createdAt > SESSION_TTL) {
      delete sessions[key];
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // 清理过期 session
    cleanExpiredSessions();

    const body = await request.json();

    // 获取客户端传入的 sessionId（如果有）
    const clientSessionId = request.headers.get("Mcp-Session-Id");
    const activeSession = Object.values(sessions)[0];
    const requestSessionId = clientSessionId || activeSession?.sessionId;

    // 构建转发给 MCP 服务器的 headers
    const mcpHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };

    // 添加 Authorization
    if (AUTH_TOKEN) {
      mcpHeaders["Authorization"] = `Bearer ${AUTH_TOKEN}`;
    }

    // 添加 sessionId（如果有）
    if (requestSessionId) {
      mcpHeaders["Mcp-Session-Id"] = requestSessionId;
    }

    // 转发请求到 MCP 服务器
    const mcpResponse = await fetch(MCP_URL, {
      method: "POST",
      headers: mcpHeaders,
      body: JSON.stringify(body),
    });

    // 获取 MCP 服务器返回的 sessionId
    const mcpSessionId = mcpResponse.headers.get("mcp-session-id");

    // 如果是 initialize 请求，保存 sessionId
    if (body.method === "initialize" && mcpSessionId) {
      sessions["default"] = { sessionId: mcpSessionId, createdAt: Date.now() };
    }

    // 读取响应体
    const responseBody = await mcpResponse.text();

    // 构建响应头
    const responseHeaders: Record<string, string> = {
      "Content-Type": mcpResponse.headers.get("Content-Type") || "application/json",
    };

    // 如果 MCP 服务器返回了 sessionId，传递给客户端
    if (mcpSessionId) {
      responseHeaders["Mcp-Session-Id"] = mcpSessionId;
    }

    return new Response(responseBody, {
      status: mcpResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Proxy error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
