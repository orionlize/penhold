// 端到端演示：design_plan 声明 3 个页面 → 骨架屏 → 逐页绘制（回放 + AI 光标）→ 自检释放锁。
// 每一步之间留出停顿，便于在浏览器里观察骨架屏、光标与状态变化。
// 用法：tsx scripts/e2e-plan.ts [停顿毫秒，默认 3000]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pause = Number(process.argv[2] ?? 3000);
const t = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/cli.ts'],
  env: { ...process.env } as Record<string, string>,
  stderr: 'inherit',
});
const c = new Client({ name: 'e2e-plan', version: '0' });
await c.connect(t);

type R = { content: Array<{ type: string; text?: string }>; isError?: boolean };
async function call(name: string, args: Record<string, unknown>) {
  const r = (await c.callTool({ name, arguments: args })) as R;
  const text = r.content.find((x) => x.type === 'text')?.text ?? '';
  console.log(`\n▶ ${name}${r.isError ? ' ✖ ERROR' : ''}\n${text.length > 800 ? text.slice(0, 800) + '…' : text}`);
  if (r.isError) throw new Error(`${name} failed`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const wait = (ms = pause) => new Promise((r) => setTimeout(r, ms));
const step = (label: string) => console.log(`\n=== ${label} ===`);

const opened = await call('canvas_open', { new: true, title: '规划演示' });
console.log(`URL: ${opened.url}`);
await wait(4000); // 等浏览器连上

step('规划 3 个页面');
const plan = await call('design_plan', {
  enough_info: '端到端演示脚本：电商 App 的三个页面，风格与内容由脚本指定',
  user_style: '演示脚本指定：令牌与样式由脚本写死',
  pages: [
    { name: '登录', width: 390, sections: ['顶部导航', 'Logo 与标语', '登录表单', '第三方登录'] },
    { name: '首页', width: 390, sections: ['搜索栏', 'Banner', '分类入口', '商品列表', '底部 tab'] },
    { name: '我的', width: 390 },
  ],
});
const [login, home, me] = plan.pages.map((p: { frame_id: string }) => p.frame_id);
await wait();

const card = (title: string, sub: string) => ({
  type: 'card',
  layout: { gap: 6 },
  box: { padding: 16, radius: 12 },
  style: { background: '#f3f4f6' },
  children: [
    { type: 'title', text: title, style: { fontSize: 16, fontWeight: 600 } },
    { type: 'desc', text: sub, style: { fontSize: 13, color: '#6b7280' } },
  ],
});
const page = (id: string) => ({ node_id: id, layout: { gap: 16 }, box: { padding: [44, 20, 34, 20] }, style: { background: '#ffffff' } });

step('第 1 页');
await call('node_update', { updates: [page(login)], note: '页面背景与安全区' });
await wait(1200);
await call('node_insert', {
  parent_id: login,
  note: '登录表单',
  nodes: [
    { type: 'heading', text: '欢迎回来', style: { fontSize: 28, fontWeight: 700 } },
    { type: 'desc', text: '登录后同步你的收藏与订单', style: { color: '#6b7280' } },
    ...['手机号', '密码'].map((p) => ({ type: 'input', render: 'input', props: { placeholder: p }, box: { height: 48, padding: [0, 14], radius: 10, border: { width: 1, style: 'solid', color: '#d1d5db' } } })),
    { type: 'button', text: '登录', layout: { justify: 'center', align: 'center' }, box: { height: 48, radius: 10 }, style: { background: '#4f46e5', color: '#fff', fontWeight: 600 } },
    card('微信登录', '一键授权，无需密码'),
  ],
});
await wait();
await call('design_screenshot', { frame_id: login });
await wait();

step('第 2 页（插入后停顿较久，应显示“思考中”）');
await call('node_update', { updates: [page(home)], note: '页面背景' });
await call('node_insert', {
  parent_id: home,
  note: '商品列表',
  nodes: [
    { type: 'search', text: '搜索商品', box: { height: 40, padding: [0, 14], radius: 20 }, style: { background: '#f3f4f6', color: '#9ca3af' }, layout: { justify: 'center' } },
    { type: 'banner', box: { height: 150, radius: 14 }, style: { background: 'linear-gradient(135deg,#6366f1,#ec4899)' } },
    ...[1, 2, 3, 4].map((i) => card(`商品 ${i}`, `¥${i * 39}.00 · 包邮`)),
  ],
});
await wait(pause * 2);
await call('design_screenshot', { frame_id: home });
await wait();

step('第 3 页');
await call('node_update', { updates: [page(me)] });
await call('node_insert', { parent_id: me, note: '个人信息', nodes: [card('小明', '会员 · 积分 1280'), card('我的订单', '3 笔待收货'), card('设置', '账号与隐私')] });
await wait();
await call('design_screenshot', { frame_id: me });
const status = await call('canvas_status', {});
console.log(`\nlock after all checked: ${status.lock}`);
await c.close();
