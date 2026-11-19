import type { Metadata, Viewport } from 'next';
import { Ticker } from './components/ticker';
import './globals.css';

export const metadata: Metadata = {
  title: 'Penhold — 给 Agent 用的本地设计画布',
  description:
    '跑在本机，用你已有的模型，不用注册账号。Agent 通过 MCP 在画布上绘制 UI 稿，你拖过的每一处边距 AI 都读得到、不覆盖；画完导出单文件 HTML。',
  openGraph: {
    title: 'Penhold — 你的 Agent，现在会画设计稿',
    description: '给 Agent 用的本地设计画布，MIT 开源。一行配置接入任何 MCP 客户端。',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0A0A0A',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-t / data-h / data-c 由 <Ticker> 在客户端轮换，驱动全站的循环动效
    <html lang="zh-CN" data-t="1" data-h="0" data-c="0" suppressHydrationWarning>
      <body>
        <Ticker />
        {children}
      </body>
    </html>
  );
}
