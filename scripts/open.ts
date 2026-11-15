// 开发辅助：新建一个画布并打印其 URL。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const t = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/cli.ts'],
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
});
const c = new Client({ name: 'open', version: '0' });
await c.connect(t);
const r = (await c.callTool({ name: 'canvas_open', arguments: { new: true, title: process.argv[2] ?? '演示画布' } })) as { content: Array<{ text: string }> };
const info = JSON.parse(r.content[0].text);
console.log(info.canvas_id);
console.log(info.url);
await c.close();
