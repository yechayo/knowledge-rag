import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) return null;
  return session;
}

function maskApiKey(apiKey: string | null | undefined) {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "****";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function serializeConfig(config: any) {
  return {
    id: config.id,
    name: config.name,
    modelName: config.modelName,
    baseURL: config.baseURL,
    isDefault: config.isDefault,
    hasApiKey: !!config.apiKey,
    apiKeyPreview: maskApiKey(config.apiKey),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function PATCH(req: Request, context: RouteContext) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.modelName !== undefined) data.modelName = String(body.modelName).trim();
  if (body.baseURL !== undefined) data.baseURL = String(body.baseURL).trim();
  if (body.isDefault !== undefined) data.isDefault = Boolean(body.isDefault);
  if (typeof body.apiKey === "string" && body.apiKey.trim()) data.apiKey = body.apiKey.trim();

  const config = await prisma.agentModelConfig.update({
    where: { id },
    data,
  });

  return NextResponse.json({ config: serializeConfig(config) });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  await prisma.agentModelConfig.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
