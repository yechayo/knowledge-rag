import 'dotenv/config'
import { Pool } from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL!;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = 'tf221221';

  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      name: 'Admin',
    },
  });

  console.log(`Admin created: ${admin.email}`);

  // 默认分类配置
  const defaultCategories = [
    { key: 'article', label: '文章' },
    { key: 'project', label: '项目' },
    { key: 'note', label: '笔记' },
    { key: 'page', label: '页面' },
  ];
  await prisma.siteConfig.upsert({
    where: { key: 'siteCategories' },
    update: {},
    create: { key: 'siteCategories', value: JSON.stringify(defaultCategories) },
  });
  console.log('Default categories seeded');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
