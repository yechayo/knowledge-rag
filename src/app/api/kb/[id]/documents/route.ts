import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/kb/[id]/documents - 获取特定知识库下的文档
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const kbId = params.id;

  try {
    // 首先校验该知识库是否属于当前用户，越权则 404
    const kb = await prisma.knowledgeBase.findUnique({
      where: {
        id: kbId,
        userId: session.user.id,
      },
      include: {
        _count: {
          select: { documents: true }
        }
      }
    });

    if (!kb) {
      return NextResponse.json({ error: 'Knowledge Base not found' }, { status: 404 });
    }

    const documents = await prisma.document.findMany({
      where: {
        kbId: kbId,
        userId: session.user.id,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      kbName: kb.name,
      documents
    });
  } catch (error) {
    console.error('Failed to fetch documents:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
