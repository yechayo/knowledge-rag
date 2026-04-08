import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isOssEnabled, uploadImageToOss } from '@/lib/oss';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type}` }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 5MB limit' }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const contentId = formData.get('contentId') as string | null;

    if (isOssEnabled()) {
      const image = await prisma.image.create({
        data: {
          data: Buffer.alloc(0),
          mimeType: file.type,
          ...(contentId ? { contentId } : {}),
        },
      });

      try {
        await uploadImageToOss(image.id, file.type, bytes);
      } catch (error) {
        await prisma.image.delete({ where: { id: image.id } }).catch(() => null);
        throw error;
      }

      return NextResponse.json({
        url: `/api/images/${image.id}`,
        id: image.id,
        storage: 'oss',
      });
    }

    const image = await prisma.image.create({
      data: {
        data: bytes,
        mimeType: file.type,
        ...(contentId ? { contentId } : {}),
      },
    });

    return NextResponse.json({
      url: `/api/images/${image.id}`,
      id: image.id,
      storage: 'database',
    });
  } catch (error) {
    console.error('Failed to upload file:', error);
    return NextResponse.json(
      { error: 'Failed to upload file', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
