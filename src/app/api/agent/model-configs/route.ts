import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configs = await prisma.agentModelConfig.findMany({
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });

  return NextResponse.json({ configs: configs.map(serializeConfig) });
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const name = String(body.name || "").trim();
  const modelName = String(body.modelName || "").trim();
  const baseURL = String(body.baseURL || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  const isDefault = Boolean(body.isDefault);

  if (!name || !modelName || !baseURL || !apiKey) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const config = await prisma.agentModelConfig.create({
    data: { name, modelName, baseURL, apiKey, isDefault },
  });

  return NextResponse.json({ config: serializeConfig(config) }, { status: 201 });
}
