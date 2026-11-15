# penhold 官网

penhold-mcp 的产品官网，Next.js（App Router）静态页面，独立于画布与守护进程，有自己的依赖与锁文件。

```bash
cd website
npm install
npm run dev      # http://localhost:3000
npm run build
```

- 页面：`app/page.tsx`（文案与区块数据都在文件顶部）
- 文档：`app/docs/`，每页一个 `<slug>/page.tsx`；目录与上一页 / 下一页由 `app/docs/nav.ts` 统一维护，新增页面先在这里登记；样式在 `app/docs/docs.css`
- 样式：`app/globals.css`（`:root` 令牌，暗色跟随系统）
- `next.config.ts` 固定了 `turbopack.root`，避免 Next 把上层仓库当作项目根、误把 `src/proxy.ts` 当成 proxy 中间件。

## 部署到 Vercel

在 Vercel 官网：**Add New → Project → Import** `orionlize/penhold`，然后

| 设置 | 值 |
| --- | --- |
| Root Directory | `website` |
| Framework Preset | Next.js（自动识别） |
| Build / Output / Install | 保持默认 |

建议在 **Settings → Git → Ignored Build Step** 填 `git diff --quiet HEAD^ HEAD -- .`，只有 `website/` 有改动时才重新部署。

命令行部署：在 `website/` 下执行 `vercel login`，然后 `vercel link` 与 `vercel deploy`。
