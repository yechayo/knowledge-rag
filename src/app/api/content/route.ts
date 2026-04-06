import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * 将中文标题转为 URL 安全的 slug
 */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, '-')
    // 保留字母、数字、中文
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 确保 slug 唯一，如果重复则追加时间戳后缀
 */
async function ensureUniqueSlug(slug: string): Promise<string> {
  const existing = await prisma.content.findUnique({ where: { slug } });
  if (!existing) return slug;
  return `${slug}-${Date.now()}`;
}

// GET /api/content - 内容列表
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status') || 'published';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '12', 10)));
    const tag = searchParams.get('tag');

    // 非 admin 不允许查看 draft
    const session = await getServerSession(authOptions);
    const isAdmin = !!(session?.user as any)?.isAdmin;
    if (status === 'draft' && !isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // slogan 分类返回随机一条
    if (category === 'slogan') {
      const count = await prisma.content.count({
        where: { category: 'slogan', status: 'published' },
      });

      if (count === 0) {
        return NextResponse.json({ items: [], total: 0, page: 1, totalPages: 0 });
      }

      const randomIndex = Math.floor(Math.random() * count);
      const randomItem = await prisma.content.findFirst({
        where: { category: 'slogan', status: 'published' },
        select: {
          id: true,
          title: true,
          slug: true,
          category: true,
          metadata: true,
          status: true,
          viewCount: true,
          createdAt: true,
          updatedAt: true,
        },
        skip: randomIndex,
      });

      return NextResponse.json({
        items: randomItem ? [randomItem] : [],
        total: 1,
        page: 1,
        totalPages: 1,
      });
    }

    // 构建过滤条件
    const where: any = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (tag) {
      // metadata.tags 是 JSON 数组，使用 Prisma 的 JSON 过滤
      where.metadata = {
        path: ['tags'],
        array_contains: [tag],
      };
    }

    const [items, total] = await Promise.all([
      prisma.content.findMany({
        where,
        select: {
          id: true,
          title: true,
          slug: true,
          category: true,
          metadata: true,
          status: true,
          viewCount: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.content.count({ where }),
    ]);

    return NextResponse.json({
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Failed to fetch content list:', error);
    return NextResponse.json(
      { error: 'Failed to fetch content list', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// POST /api/content - 创建内容（仅管理员）
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { title, slug: inputSlug, body: contentBody, category, metadata, status } = body;

    if (!title || !contentBody || !category) {
      return NextResponse.json({ error: 'Missing required fields: title, body, category' }, { status: 400 });
    }

    // 生成 slug
    let slug = inputSlug || titleToSlug(title);
    slug = await ensureUniqueSlug(slug);

    const content = await prisma.content.create({
      data: {
        title,
        slug,
        body: contentBody,
        category,
        metadata: metadata || {},
        status: status || 'draft',
      },
    });

    return NextResponse.json(content, { status: 201 });
  } catch (error) {
    console.error('Failed to create content:', error);
    return NextResponse.json(
      { error: 'Failed to create content', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
