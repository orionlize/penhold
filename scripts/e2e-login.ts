// 端到端演示：仅用 MCP 工具从空画布画出登录页（桌面端 + 移动端），自检、读取并导出。
// 用法：tsx scripts/e2e-login.ts <canvasId> [输出目录]
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const canvasId = process.argv[2];
const out = process.argv[3] ?? '.';
const t = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/cli.ts'],
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
});
const c = new Client({ name: 'e2e', version: '0' });
await c.connect(t);

type R = { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean };
async function call(name: string, args: Record<string, unknown>) {
  const r = (await c.callTool({ name, arguments: args })) as R;
  const text = r.content.find((x) => x.type === 'text')?.text ?? '';
  const img = r.content.find((x) => x.type === 'image');
  console.log(`\n▶ ${name}${r.isError ? ' ✖ ERROR' : ''}\n${text.length > 1500 ? text.slice(0, 1500) + '…' : text}`);
  if (r.isError) throw new Error(`${name} failed`);
  return { json: (() => { try { return JSON.parse(text); } catch { return text; } })(), img: img?.data };
}

await call('canvas_open', { canvas_id: canvasId });
await call('tokens_set', {
  tokens: {
    'color.primary': '#4f46e5',
    'color.text': '#111827',
    'color.muted': '#6b7280',
    'color.border': '#d1d5db',
    'color.bg': '#f9fafb',
    'radius.md': '8px',
  },
});

const field = (label: string, placeholder: string) => ({
  type: 'form-field',
  component: 'FormField',
  layout: { gap: 6 },
  children: [
    { type: 'label', text: label, style: { fontSize: 13, fontWeight: 500, color: '{color.text}' } },
    {
      type: 'input',
      render: 'input',
      props: { placeholder },
      box: { height: 44, padding: [0, 12], border: { width: 1, color: '{color.border}' }, radius: '{radius.md}' },
      style: { fontSize: 14, background: '#fff' },
    },
  ],
});

const loginForm = {
  type: 'card',
  component: 'LoginForm',
  layout: { gap: 20 },
  box: { width: 400, padding: 40, radius: 16 },
  style: { background: '#fff', shadow: '0 10px 30px rgba(17,24,39,0.08)' },
  children: [
    {
      type: 'heading-group',
      layout: { gap: 6 },
      children: [
        { type: 'title', text: '欢迎回来', style: { fontFamily: 'Inter', fontSize: 26, fontWeight: 700, color: '{color.text}' } },
        { type: 'subtitle', text: '登录你的账号以继续', style: { fontSize: 14, color: '{color.muted}' } },
      ],
    },
    { ...field('邮箱', 'you@example.com') },
    field('密码', '至少 8 位'),
    {
      type: 'row',
      layout: { direction: 'row', justify: 'between', align: 'center' },
      children: [
        { type: 'checkbox-label', text: '记住我', style: { fontSize: 13, color: '{color.muted}' } },
        { type: 'link', text: '忘记密码？', props: { href: '#' }, style: { fontSize: 13, color: '{color.primary}', fontWeight: 500 } },
      ],
    },
    {
      type: 'button',
      component: 'PrimaryButton',
      text: '登录',
      layout: { justify: 'center', align: 'center' },
      box: { height: 46, radius: '{radius.md}' },
      style: { background: '{color.primary}', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
      states: { hover: { background: '#4338ca' } },
    },
    {
      type: 'footer-note',
      text: '还没有账号？立即注册',
      style: { fontSize: 13, color: '{color.muted}', textAlign: 'center' },
    },
  ],
};

const desk = await call('frame_create', {
  name: '登录页 / 桌面端',
  width: 1440,
  height: 900,
  root: { type: 'page', layout: { direction: 'row' }, style: { background: '{color.bg}' } },
});
const deskId = desk.json.frame_id as string;
await call('node_insert', {
  parent_id: deskId,
  nodes: [
    {
      type: 'brand-panel',
      name: '品牌区',
      layout: { justify: 'between' },
      box: { width: 'fill', height: 900, padding: 64 },
      style: { background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', color: '#fff' },
      children: [
        { type: 'logo', text: '◆ Acme', style: { fontSize: 22, fontWeight: 700 } },
        {
          type: 'hero',
          layout: { gap: 16 },
          box: { maxWidth: 520 },
          children: [
            { type: 'hero-title', text: '更快地把想法变成产品', style: { fontSize: 44, fontWeight: 700, lineHeight: 1.2 } },
            { type: 'hero-text', text: '一个工作区管理设计、开发与发布，团队协作从未如此顺畅。', style: { fontSize: 18, lineHeight: 1.6, opacity: 0.85 } },
          ],
        },
        { type: 'copyright', text: '© 2026 Acme Inc.', style: { fontSize: 13, opacity: 0.7 } },
      ],
    },
    {
      type: 'form-panel',
      name: '表单区',
      layout: { justify: 'center', align: 'center' },
      box: { width: 'fill', height: 900 },
      children: [loginForm],
    },
  ],
});
const shot1 = await call('design_screenshot', { frame_id: deskId });
if (shot1.img) fs.writeFileSync(path.join(out, 'login-desktop.png'), Buffer.from(shot1.img, 'base64'));

// 移动端画板：复用组件
const mob = await call('frame_create', {
  name: '登录页 / 移动端',
  width: 390,
  height: 844,
  root: { type: 'page', layout: { align: 'center', justify: 'center' }, box: { padding: 16 }, style: { background: '{color.bg}' } },
});
const mobId = mob.json.frame_id as string;
const ins = await call('node_insert', { parent_id: mobId, nodes: [{ type: 'card', component: 'LoginForm', layout: { alignSelf: 'stretch' } }] });
console.log('instances created:', JSON.stringify(ins.json.affected));

// 修改组件定义：两个画板同步
const read = await call('design_read', { component: 'LoginForm', depth: 1 });
await call('node_update', { updates: [{ node_id: 'cmp_LoginForm', box: { width: 'fill', maxWidth: 400 } }] });
const status = await call('canvas_status', {});
for (const f of status.json.pending_check as string[]) {
  const s = await call('design_screenshot', { frame_id: f });
  if (s.img) fs.writeFileSync(path.join(out, `shot-${f}.png`), Buffer.from(s.img, 'base64'));
}
await call('canvas_status', {});
await call('design_outline', { frame_id: deskId, depth: 2 });
await call('design_read', { component: 'PrimaryButton' });
await call('design_changes', { since_rev: 0, origin: 'user' });
await call('design_export', { frame_ids: [deskId, mobId], out_path: path.resolve(out, 'login.html') });
void read;
await c.close();
