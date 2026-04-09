import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { join } from "path";
import { rm } from "fs/promises";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  const userId = (session?.user as any)?.id || "admin";
  if (!isAdmin) throw new Error("Unauthorized");
  return userId;
}

// GET /api/agent/skills/installed - 获取用户已安装的 skills
export async function GET(req: Request) {
  let userId: string;
  try {
    userId = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const where: any = { userId };
  if (status) where.status = status;

  const installed = await prisma.installedSkill.findMany({
    where,
    include: {
      market: {
        select: {
          name: true,
          description: true,
          author: true,
          category: true,
        },
      },
    },
    orderBy: { installedAt: "desc" },
  });

  return NextResponse.json({
    skills: installed.map((s) => ({
      id: s.id,
      skillName: s.skillName,
      version: s.version,
      status: s.status,
      marketInfo: s.market
        ? {
            name: s.market.name,
            description: s.market.description,
            author: s.market.author,
            category: s.market.category,
          }
        : null,
      installedAt: s.installedAt,
      approvedAt: s.approvedAt,
    })),
  });
}

// POST /api/agent/skills/installed - 申请安装 skill
export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { skillName, marketId, version, reason } = body;

  if (!skillName || typeof skillName !== "string") {
    return NextResponse.json({ error: "skillName is required" }, { status: 400 });
  }

  // 检查是否已安装
  const existing = await prisma.installedSkill.findUnique({
    where: { userId_skillName: { userId, skillName } },
  });

  if (existing) {
    return NextResponse.json(
      { error: "Skill 已安装", skillId: existing.id, status: existing.status },
      { status: 400 }
    );
  }

  // 查找市场信息（如果提供了 marketId）
  let market = null;
  if (marketId) {
    market = await prisma.skillMarket.findUnique({ where: { id: marketId } });
  } else {
    market = await prisma.skillMarket.findUnique({ where: { name: skillName } });
  }

  // 创建安装申请
  const request = await prisma.skillInstallRequest.create({
    data: {
      userId,
      skillName,
      version: version || "1.0.0",
      reason,
      status: "pending",
      marketId: market?.id,
    },
  });

  // 创建待审批的安装记录
  const installed = await prisma.installedSkill.create({
    data: {
      userId,
      skillName,
      version: version || "1.0.0",
      status: "pending_approval",
      marketId: market?.id,
    },
  });

  return NextResponse.json({
    success: true,
    requestId: request.id,
    installedId: installed.id,
    message: "安装申请已提交，等待审批",
  });
}

// DELETE /api/agent/skills/installed/:name - 卸载 skill
export async function DELETE(req: Request) {
  let userId: string;
  try {
    userId = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const skillName = searchParams.get("name");

  if (!skillName) {
    return NextResponse.json({ error: "skillName is required" }, { status: 400 });
  }

  const installed = await prisma.installedSkill.findUnique({
    where: { userId_skillName: { userId, skillName } },
  });

  if (!installed) {
    return NextResponse.json({ error: "Skill 未安装" }, { status: 404 });
  }

  // 删除本地文件
  if (installed.localPath) {
    try {
      const skillDir = join(installed.localPath, "..");
      await rm(skillDir, { recursive: true, force: true });
    } catch {}
  }

  // 删除数据库记录
  await prisma.installedSkill.delete({
    where: { id: installed.id },
  });

  // 更新市场安装计数
  if (installed.marketId) {
    await prisma.skillMarket.update({
      where: { id: installed.marketId },
      data: { installCount: { decrement: 1 } },
    }).catch(() => {});
  }

  return NextResponse.json({ success: true, message: "Skill 已卸载" });
}
