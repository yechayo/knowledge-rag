import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/config - 获取站点配置（公开）
export async function GET() {
  try {
    const configs = await prisma.siteConfig.findMany({
      select: { key: true, value: true },
    });

    // 转为 key-value 对象
    const configMap: Record<string, string> = {};
    for (const config of configs) {
      configMap[config.key] = config.value;
    }

    return NextResponse.json(configMap);
  } catch (error) {
    console.error('Failed to fetch config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch config', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// PATCH /api/config - 更新站点配置（仅管理员）
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    let entries: [string, string][];

    // 支持两种格式: { key, value } 或 { configs: { k1: v1, k2: v2 } }
    if (body.configs && typeof body.configs === 'object') {
      entries = Object.entries(body.configs) as [string, string][];
    } else if (body.key && body.value !== undefined) {
      entries = [[body.key, String(body.value)]];
    } else {
      return NextResponse.json(
        { error: 'Invalid request body. Provide { key, value } or { configs: { ... } }' },
        { status: 400 }
      );
    }

    // 逐条 upsert
    const results: Record<string, string> = {};
    for (const [key, value] of entries) {
      await prisma.siteConfig.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
      results[key] = value;
    }

    return NextResponse.json({
      message: 'Config updated successfully',
      configs: results,
    });
  } catch (error) {
    console.error('Failed to update config:', error);
    return NextResponse.json(
      { error: 'Failed to update config', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
