import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/app/providers";
import ChatWrapper from "@/components/chat/ChatWrapper";

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
          {children}
          <ChatWrapper />
        </Providers>
      </body>
    </html>
  );
}
