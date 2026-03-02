import { Pool } from 'pg'
import { PrismaClient } from '../../node_modules/@prisma/client/.prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const connectionString =
  "postgresql://postgres.fwnmohcptedgefzsumyc:bdQ5y84yDOwjzrqO@aws-1-ap-south-1.pooler.supabase.com:5432/postgres";

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)

const prismaClientSingleton = () => {
  return new PrismaClient({
    adapter,
  })
}

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prisma ?? prismaClientSingleton()

export { prisma }

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
