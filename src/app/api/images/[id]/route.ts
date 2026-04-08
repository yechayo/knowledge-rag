import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { downloadImageFromOss } from '@/lib/oss';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const image = await prisma.image.findUnique({ where: { id } });
    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    const ossBuffer = await downloadImageFromOss(image.id, image.mimeType);
    if (ossBuffer && ossBuffer.length > 0) {
      return new NextResponse(new Uint8Array(ossBuffer), {
        headers: {
          'Content-Type': image.mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    const dbBuffer = Buffer.from(image.data);
    if (dbBuffer.length === 0) {
      return NextResponse.json({ error: 'Image file not found' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(dbBuffer), {
      headers: {
        'Content-Type': image.mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Failed to fetch image:', error);
    return NextResponse.json({ error: 'Failed to fetch image' }, { status: 500 });
  }
}
