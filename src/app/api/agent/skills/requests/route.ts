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

// GET /api/agent/skills/requests - 获取待审批列表
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "pending";
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "20", 10), 50);

  const where: any = {};
  if (status !== "all") where.status = status;

  const [total, requests] = await Promise.all([
    prisma.skillInstallRequest.count({ where }),
    prisma.skillInstallRequest.findMany({
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
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    requests: requests.map((r) => ({
      id: r.id,
      userId: r.userId,
      skillName: r.skillName,
      version: r.version,
      reason: r.reason,
      status: r.status,
      marketInfo: r.market
        ? {
            name: r.market.name,
            description: r.market.description,
            author: r.market.author,
            category: r.market.category,
          }
        : null,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      reviewedBy: r.reviewedBy,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}
