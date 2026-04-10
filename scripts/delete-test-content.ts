import { Pool } from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString = process.env.DATABASE_URL!

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)

const prisma = new PrismaClient({ adapter })

async function main() {
  // 先查找所有包含"测试内容"的文章
  const testContents = await prisma.content.findMany({
    where: {
      body: {
        contains: '测试内容',
      },
    },
    select: {
      id: true,
      title: true,
      body: true,
    },
  })

  console.log(`找到 ${testContents.length} 条包含"测试内容"的记录:\n`)

  for (const content of testContents) {
    console.log(`- [${content.id}] ${content.title}`)
    console.log(`  预览: ${content.body.substring(0, 100)}...`)
  }

  if (testContents.length > 0) {
    console.log('\n开始删除...')

    // 删除所有包含"测试内容"的记录
    const result = await prisma.content.deleteMany({
      where: {
        body: {
          contains: '测试内容',
        },
      },
    })

    console.log(`\n✅ 已删除 ${result.count} 条记录`)
  } else {
    console.log('\n没有找到包含"测试内容"的记录')
  }
}

main()
  .catch((e) => {
    console.error('删除失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
