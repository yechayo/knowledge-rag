import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) throw new Error("Unauthorized");
  return (session?.user as any)?.id || "admin";
}

// GET /api/agent/skills/market - 获取市场 skill 列表
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = Math.min(parseInt(searchParams.get("pageSize") || "20", 10), 50);
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const sortBy = searchParams.get("sortBy") || "installCount";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  const where: any = { status: "approved" };
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const orderBy: any = {};
  if (sortBy === "name") orderBy.name = sortOrder;
  else if (sortBy === "createdAt") orderBy.createdAt = sortOrder;
  else if (sortBy === "rating") orderBy.installCount = sortOrder; // 用 installCount 代替
  else orderBy.installCount = "desc";

  const [total, skills] = await Promise.all([
    prisma.skillMarket.count({ where }),
    prisma.skillMarket.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        description: true,
        author: true,
        version: true,
        category: true,
        tags: true,
        installCount: true,
        sourceType: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    skills,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}
