import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { UPLOAD_DIR } from '@/lib/constants';

// POST /api/documents/create - 新建文档接口
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { filename, content, kbId } = await req.json();

    if (!filename || !kbId) {
      return NextResponse.json({ error: 'Missing filename or kbId' }, { status: 400 });
    }

    // 1. 权限校验
    const kb = await prisma.knowledgeBase.findFirst({
      where: {
        id: kbId,
        userId: session.user.id,
      },
    });

    if (!kb) {
      return NextResponse.json({ error: 'Knowledge Base not found' }, { status: 404 });
    }

    // 2. 准备存储路径
    const fileName = `${Date.now()}-${filename}`;
    const uploadPath = join(process.cwd(), UPLOAD_DIR);
    const filePath = join(uploadPath, fileName);

    // 确保目录存在
    await mkdir(uploadPath, { recursive: true });

    // 3. 保存文件到本地磁盘
    await writeFile(filePath, content, 'utf-8');

    // 4. 在数据库中创建记录
    const document = await prisma.document.create({
      data: {
        filename: filename,
        storagePath: filePath,
        mime: 'text/markdown',
        status: 'uploaded',
        kbId: kbId,
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      message: 'Document created successfully',
      document,
    }, { status: 201 });

  } catch (error) {
    console.error('Document creation failed:', error);
    return NextResponse.json({
      error: 'Creation Failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
