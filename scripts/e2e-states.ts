// 端到端演示：交互状态检查。画一个带 tab、短信倒计时、弹窗的登录页（故意留几处只在点击后才出现的问题），
// 截图自检，确认报告列出各状态的问题；再用 clicks / vars 查看指定状态。
// 用法：tsx scripts/e2e-states.ts <新画布 canvasId> [截图输出目录]（节点 id 固定，同一画布只能跑一次）
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const canvasId = process.argv[2];
const out = process.argv[3];
const t = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/cli.ts'], env: { ...process.env } as Record<string, string>, stderr: 'inherit' });
const c = new Client({ name: 'e2e-states', version: '0' });
await c.connect(t);
type R = { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean };
let shot = 0;
async function call(name: string, args: Record<string, unknown>) {
  const r = (await c.callTool({ name, arguments: args })) as R;
  console.log(`\n▶ ${name}${r.isError ? ' ✖ ERROR' : ''}`);
  for (const p of r.content) {
    if (p.type === 'text') console.log(p.text);
    else {
      shot++;
      console.log(`[image #${shot} ${Math.round((p.data!.length * 3) / 4 / 1024)} KB]`);
      if (out) fs.writeFileSync(path.join(out, `shot-${shot}.png`), Buffer.from(p.data!, 'base64'));
    }
  }
  if (r.isError) throw new Error(`${name} failed`);
  const text = r.content.find((x) => x.type === 'text')?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

await call('canvas_open', { canvas_id: canvasId });
const tab = (id: string, label: string, value: string) => ({
  type: 'tab',
  id,
  text: label,
  box: { padding: [8, 4] },
  style: { fontSize: 15, color: '#6b7280' },
  proto: {
    onClick: [{ do: 'set', var: 'tab', value }],
    // 选中态加粗 + 加底边框：尺寸变化，切换时会跳动
    styles: [{ when: `tab == '${value}'`, style: { color: '#4f46e5', fontWeight: 700 } }],
  },
});
const f = await call('frame_create', {
  name: '登录（交互）',
  width: 390,
  height: 844,
  root: {
    type: 'page',
    layout: { direction: 'column', gap: 16 },
    box: { padding: [44, 24, 34, 24] },
    style: { background: '#ffffff' },
    proto: { vars: { tab: 'pwd', phone: '', sec: 0, modal: false } },
    children: [
      { type: 'text', text: '欢迎登录', style: { fontSize: 24, fontWeight: 700, color: '#111827' } },
      { type: 'tabs', layout: { direction: 'row', gap: 24 }, children: [tab('t_pwd', '密码登录', 'pwd'), tab('t_sms', '短信登录', 'sms')] },
      {
        type: 'panel',
        id: 'p_pwd',
        proto: { show: "tab == 'pwd'" },
        layout: { direction: 'column', gap: 12 },
        children: [
          { type: 'input', render: 'input', props: { placeholder: '账号' }, box: { height: 44, padding: [0, 12], radius: 8, border: { width: 1, color: '#d1d5db' } } },
          { type: 'input', render: 'input', props: { placeholder: '密码', inputType: 'password' }, box: { height: 44, padding: [0, 12], radius: 8, border: { width: 1, color: '#d1d5db' } } },
        ],
      },
      {
        type: 'panel',
        id: 'p_sms',
        proto: { show: "tab == 'sms'" },
        layout: { direction: 'row', gap: 8 },
        children: [
          { type: 'input', id: 'in_phone', render: 'input', props: { placeholder: '手机号', inputType: 'tel' }, layout: { grow: 1 }, box: { height: 44, padding: [0, 12], radius: 8, border: { width: 1, color: '#d1d5db' } }, proto: { bind: 'phone' } },
          {
            type: 'button',
            id: 'b_code',
            // 倒计时文案比初始文案长，固定宽度下会换行
            text: "{{sec > 0 ? sec + ' 秒后重新获取验证码' : '获取验证码'}}",
            layout: { align: 'center', justify: 'center' },
            box: { width: 104, height: 44, radius: 8 },
            style: { background: '#4f46e5', color: '#ffffff', fontSize: 14 },
            proto: { disabled: 'sec > 0 || len(phone) != 11', onClick: [{ do: 'countdown', var: 'sec', from: 60 }] },
          },
        ],
      },
      { type: 'button', id: 'b_login', text: '登录', layout: { align: 'center', justify: 'center' }, box: { height: 48, radius: 8 }, style: { background: '#4f46e5', color: '#fff', fontSize: 16 }, proto: { onClick: [{ do: 'set', var: 'modal', value: true }] } },
      { type: 'text', id: 'agree', text: '忘记密码？', props: { href: '#forgot' }, style: { fontSize: 13, color: '#6b7280' } },
      { type: 'text', id: 'qr_tip', text: '请使用 App 扫码', proto: { show: "tab == 'qr'" }, style: { fontSize: 13 } },
      {
        type: 'modal',
        id: 'modal',
        proto: { show: 'modal' },
        // 弹窗定位偏右，打开后超出画板
        layout: { position: 'absolute', top: 300, left: 120, direction: 'column', gap: 12 },
        box: { width: 320, padding: 20, radius: 12 },
        style: { background: '#ffffff', shadow: '0 8px 24px rgba(0,0,0,0.18)' },
        children: [
          { type: 'text', text: '登录成功', style: { fontSize: 18, fontWeight: 600 } },
          { type: 'button', id: 'b_ok', text: '好的', layout: { align: 'center', justify: 'center' }, box: { height: 40, radius: 8 }, style: { background: '#4f46e5', color: '#fff' }, proto: { onClick: [{ do: 'set', var: 'modal', value: false }] } },
        ],
      },
    ],
  },
});
const frame = f.frame_id ?? f.id;
console.log('frame', frame, 'proto_warnings', f.proto_warnings);
await call('design_screenshot', { frame_id: frame });
await call('design_screenshot', { frame_id: frame, clicks: ['t_sms'], vars: { phone: '13800000000', sec: 59 } });
await call('design_screenshot', { frame_id: frame, clicks: ['b_code'] }).catch((e) => console.log('expected:', e.message));
await c.close();
