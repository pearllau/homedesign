import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "间筑 · AI 空间设计",
  description: "对话式 AI 户型设计与装修方案助手",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div id="app-load-notice" role="alert" hidden style={{ position: "fixed", inset: "auto 16px 16px", zIndex: 100, padding: 16, border: "1px solid #e3dccf", borderRadius: 12, background: "#fffdf9", color: "#2f3437", fontSize: 14 }}>
          页面资源加载较慢。请尝试刷新，或用系统浏览器打开这个网址。
          <form action="/" method="get" style={{ display: "inline", marginLeft: 12 }}>
          <button type="submit" style={{ color: "#346538", textDecoration: "underline" }}>重新加载</button>
          </form>
        </div>
        <script async src="/app-startup.js" />
        {children}
        <noscript style={{ position: "fixed", inset: "auto 16px 16px", zIndex: 100, padding: 16, borderRadius: 12, background: "#fffdf9", color: "#2f3437" }}>请开启浏览器的 JavaScript 后使用 AI 装修设计和 3D 功能。</noscript>
      </body>
    </html>
  );
}
