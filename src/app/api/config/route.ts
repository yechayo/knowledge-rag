import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// 默认分类 key -> label 映射
const DEFAULT_LABELS: Record<string, string> = {
  article: "文章",
  project: "项目",
  note: "笔记",
  page: "页面",
  news: "动态",
  slogan: "格言",
};

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

    // 从 Content 表获取所有实际使用的分类
    const contentCategories = await prisma.content.findMany({
      select: { category: true },
      distinct: ["category"],
    });
    const usedKeys = contentCategories.map((c) => c.category);

    // 解析已配置的分类
    let configured: { key: string; label: string }[] = [];
    if (configMap.siteCategories) {
      try {
        configured = JSON.parse(configMap.siteCategories);
      } catch { /* ignore */ }
    }

    // 构建配置分类的 key -> label 映射
    const configuredMap: Record<string, string> = {};
    for (const c of configured) {
      configuredMap[c.key] = c.label;
    }

    // 合并：保留配置的顺序和标签，补充内容中使用但未配置的分类
    const merged: { key: string; label: string }[] = [];
    const seen = new Set<string>();

    // 先加已配置的
    for (const c of configured) {
      merged.push(c);
      seen.add(c.key);
    }
    // 再补充内容中使用但未配置的
    for (const key of usedKeys) {
      if (!seen.has(key) && key) {
        merged.push({ key, label: configuredMap[key] || DEFAULT_LABELS[key] || key });
        seen.add(key);
      }
    }

    // 如果仍然为空，写入默认值
    if (merged.length === 0) {
      for (const [key, label] of Object.entries(DEFAULT_LABELS)) {
        merged.push({ key, label });
      }
    }

    // 持久化到数据库（仅当有变化时）
    const newValue = JSON.stringify(merged);
    if (configMap.siteCategories !== newValue) {
      await prisma.siteConfig.upsert({
        where: { key: "siteCategories" },
        update: { value: newValue },
        create: { key: "siteCategories", value: newValue },
      });
    }
    configMap.siteCategories = newValue;

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
