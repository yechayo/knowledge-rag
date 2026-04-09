import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  const userId = (session?.user as any)?.id || "admin";
  if (!isAdmin) throw new Error("Unauthorized");
  return userId;
}

// 辅助函数：处理审批/拒绝
async function handleReview(
  id: string,
  adminId: string,
  approved: boolean,
  _note?: string
) {
  const request = await prisma.skillInstallRequest.findUnique({
    where: { id },
    include: { market: true },
  });

  if (!request) {
    return { error: "申请不存在", status: 404 };
  }

  if (request.status !== "pending") {
    return { error: "该申请已处理", status: 400 };
  }

  if (approved) {
    // 批准：更新安装记录状态
    const installed = await prisma.installedSkill.findFirst({
      where: { userId: request.userId, skillName: request.skillName },
    });

    if (installed) {
      await prisma.installedSkill.update({
        where: { id: installed.id },
        data: { status: "active", approvedAt: new Date() },
      });
    }

    // 更新市场安装计数
    if (request.marketId) {
      await prisma.skillMarket.update({
        where: { id: request.marketId },
        data: { installCount: { increment: 1 } },
      }).catch(() => {});
    }
  } else {
    // 拒绝：更新安装记录状态
    await prisma.installedSkill.updateMany({
      where: { userId: request.userId, skillName: request.skillName },
      data: { status: "disabled" },
    }).catch(() => {});
  }

  // 更新申请状态
  await prisma.skillInstallRequest.update({
    where: { id },
    data: {
      status: approved ? "approved" : "rejected",
      reviewedAt: new Date(),
      reviewedBy: adminId,
    },
  });

  return {
    success: true,
    message: approved ? "已批准安装申请" : "已拒绝安装申请",
  };
}

// POST /api/agent/skills/requests/:id - 处理审批请求
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { action, approved, note } = body;

  // action 为 "approve" 或 "reject"
  if (action === "approve" || approved === true) {
    const result = await handleReview(id, adminId, true, note);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } else if (action === "reject" || approved === false) {
    const result = await handleReview(id, adminId, false, note);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "无效的 action" }, { status: 400 });
}
