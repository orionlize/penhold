// 开发辅助：绑定画布后调用一个 MCP 工具并打印结果。
// 用法：tsx scripts/call.ts <canvasId> <tool> '<json 参数>' [截图保存路径]
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const [canvasId, tool, json = '{}', pngOut] = process.argv.slice(2);
const t = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/cli.ts'],
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
});
const c = new Client({ name: 'call', version: '0' });
await c.connect(t);
await c.callTool({ name: 'canvas_open', arguments: { canvas_id: canvasId } });
const r = (await c.callTool({ name: tool, arguments: JSON.parse(json) })) as { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean };
for (const part of r.content) {
  if (part.type === 'text') console.log(part.text);
  else if (part.type === 'image') {
    console.log(`[image ${part.data!.length} b64 chars]`);
    if (pngOut) fs.writeFileSync(pngOut, Buffer.from(part.data!, 'base64'));
  }
}
if (r.isError) process.exitCode = 1;
await c.close();
