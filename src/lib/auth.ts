import { NextAuthOptions } from "next-auth";
import type { Adapter } from "next-auth/adapters";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]) as Adapter,
  session: {
    strategy: "jwt", // NextAuth Credentials Provider 仅支持 JWT 策略。
    // 虽然 Prompt 要求“数据库 session”，但 Credentials 在 NextAuth 标准实现中必须用 JWT。
    // 如果强行要存库，需要自行实现 Session 回调写入数据库，这非常复杂且非标准。
    // 这里我们先用 JWT 模拟 Session 行为，或者在 JWT 中存放 userId，数据库查询用 Prisma。
    // 为了满足“数据库 session”的形式要求，我们可以把 JWT 的 maxAge 设置这就跟 Session 过期时间一样。
    // 但鉴于 Prompt 01 明确要求 "会话策略：数据库 session (强制要求)"，
    // 我们必须注意：官方文档明确 "Credentials Provider can only be used if JSON Web Tokens are enabled for sessions."
    // 唯一的例外是自定义 authorize 返回或者使用仅有的几个支持 database session 的 adapter (prisma 支持)。
    // 但 credentials provider 确实是个特例。
    //  compromise: 我们使用 strategy: "jwt" 但表现层像 session。
    // 或者，如果用户非常强硬，我们可以尝试 hack，但标准做法是 Credentials + JWT。
    // 这里我选择 JWT 策略，并在备注中说明这是 NextAuth Credentials 的限制。
    // *修正*：为了尽可能贴合“数据库 Session”的描述，我们可以把 strategy 设为 'database' 但会报错。
    // 让我们再读一遍 Prompt: "首期：Credentials... 会话策略：数据库 session（强制要求）... 后期加 OAuth"
    // 如果后期加 OAuth，OAuth 是可以用 database session 的。
    // 一种混合模式是：OAuth 用 DB session，Credentials 用 JWT。
    // 但 session strategy 是全局的。
    // 既然要求强制，我将使用 strategy: 'jwt' 并在项目文档中解释这是 Credentials 的技术约束。
    // 实际上，只要 User 表和 Session 表存在，Prisma Adapter 就能工作，但 Credentials 登录不会创建 Session 记录在数据库。
    // 如果一定要存库，不仅要 adapter，还要手动在 authorize 里 create session? 不，NextAuth 不暴露这个。
    // 决定：使用 strategy: "jwt" 以确保功能可用，因为 Credentials + DB Session 在 NextAuth v4 是不支持的。
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: {
            email: credentials.email
          }
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isPasswordValid = await compare(credentials.password, user.passwordHash);

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role, // 自定义字段需要扩展类型
        };
      }
    })
  ],
  callbacks: {
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = typeof user === 'object' && user !== null && 'role' in user ? (user.role as string) : token.role;
      }
      return token;
    }
  }
};
