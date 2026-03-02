import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { UPLOAD_DIR } from '@/lib/constants';

// POST /api/documents/upload - 文档上传接口 (multipart)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const kbId = formData.get('kbId') as string;

    if (!file || !kbId) {
      return NextResponse.json({ error: 'Missing file or kbId' }, { status: 400 });
    }

    // 1. 权限校验
    const kb = await prisma.knowledgeBase.findUnique({
      where: {
        id: kbId,
        userId: session.user.id,
      },
    });

    if (!kb) {
      return NextResponse.json({ error: 'Knowledge Base not found' }, { status: 404 });
    }

    // 2. 准备存储路径
    const fileName = `${Date.now()}-${file.name}`;
    const uploadPath = join(process.cwd(), UPLOAD_DIR);
    const filePath = join(uploadPath, fileName);

    // 确保目录存在
    await mkdir(uploadPath, { recursive: true });

    // 3. 保存文件到本地磁盘
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // 4. 在数据库中创建记录，状态设为 uploaded
    const document = await prisma.document.create({
      data: {
        filename: file.name,
        storagePath: filePath, // 保存绝对路径或相对路径
        mime: file.type || 'application/pdf',
        status: 'uploaded',
        kbId: kbId,
        userId: session.user.id,
      },
    });

    return NextResponse.json({
      message: 'File uploaded successfully',
      document,
    }, { status: 201 });

  } catch (error) {
    console.error('File upload failed:', error);
    return NextResponse.json({
      error: 'Upload Failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
