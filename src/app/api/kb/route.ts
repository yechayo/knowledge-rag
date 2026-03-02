import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/kb - 获取当前用户的所有知识库
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const kbs = await prisma.knowledgeBase.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json(kbs);
  } catch (error) {
    console.error('Failed to fetch kbs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST /api/kb - 创建新知识库
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { name, description } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const kb = await prisma.knowledgeBase.create({
      data: {
        name,
        description,
        userId: session.user.id,
      },
    });

    return NextResponse.json(kb);
  } catch (error) {
    console.error('Failed to create kb:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
