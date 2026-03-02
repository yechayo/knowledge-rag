import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // 可以在这里添加自定义逻辑
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token, // 只有存在 token (已登录) 时才授权访问
    },
    pages: {
      signIn: "/login", // 未登录时自动跳转的页面
    },
  }
);

// 定义哪些路径需要被该中间件保护
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/kb/:path*",
    "/api/chat/:path*",
    "/kb/:path*",
  ],
};
