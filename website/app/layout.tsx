import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'penhold — 本地 AI 设计画布',
  description:
    'AI 通过 MCP 在本地画布上绘制、修改、读取 UI 稿；你在浏览器里微调盒模型与样式，导出单文件 HTML。',
  openGraph: {
    title: 'penhold — 本地 AI 设计画布',
    description: 'AI 执笔起稿，你来定稿。基于 MCP 的本地设计画布。',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f3ec' },
    { media: '(prefers-color-scheme: dark)', color: '#141a17' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
