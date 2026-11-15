import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

// 官网嵌在 penhold-mcp 仓库内：固定根目录为 website/，
// 否则 Next 会按上层 package-lock.json 把仓库根当作项目根，并误把 src/proxy.ts 当作 proxy 中间件。
const root = fileURLToPath(new URL('.', import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
