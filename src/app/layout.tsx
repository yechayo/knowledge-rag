import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import ChatWrapper from "@/components/chat/ChatWrapper";
import CustomCursor from "@/components/layout/CustomCursor";

export const metadata: Metadata = {
  title: "Personal Site",
  description: "个人网站 - RAG 知识库",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <CustomCursor />
          {children}
          <ChatWrapper />
        </Providers>
      </body>
    </html>
  );
}
