// 同一项目多个画布：跨画布链接语法、项目页面索引、只读查看旧画布、写时复制旧页面、跨画布链接校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DESIGN_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-project-'));
process.env.DESIGN_MCP_NO_BROWSER = '1';
const { createMcpServer } = await import('../src/server/mcp.ts');
const { Registry } = await import('../src/server/canvas/registry.ts');
const { hrefFrame, hrefTarget, linkHref, crossLinks, refCards } = await import('../src/core/links.ts');
const { buildExport } = await import('../src/server/export/export.ts');
const { lintProto, stateAfter } = await import('../src/core/states.ts');
const { validateNodeInput } = await import('../src/core/schema.ts');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

type R = { content: Array<{ type: string; text?: string }>; isError?: boolean };
const A = '11111111-2222-4333-8444-555555555555';

async function session(hub: InstanceType<typeof Registry>, id: string, cwd: string) {
  const server = createMcpServer(hub, { id, cwd, ancestors: [] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(b);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as R;
    const text = r.content.find((x) => x.type === 'text')?.text ?? '';
    return { r, text, json: r.isError ? undefined : JSON.parse(text) };
  };
}

test('链接语法：本画布、跨画布与返回', () => {
  assert.deepEqual(hrefTarget('#f_abc'), { frame: 'f_abc' });
  assert.deepEqual(hrefTarget(`#${A}/f_abc`), { canvas: A, frame: 'f_abc' });
  assert.equal(hrefTarget('#back'), undefined);
  assert.equal(hrefTarget('https://x.com'), undefined);
  assert.equal(hrefFrame(`#${A}/f_abc`), undefined, '跨画布链接不是本画布画板');
  assert.equal(hrefFrame('#f_abc'), 'f_abc');
  assert.equal(linkHref({ canvas: A, frame: 'f1' }, A), '#f1');
  assert.equal(linkHref({ canvas: A, frame: 'f1' }), `#${A}/f1`);
  const root = validateNodeInput({ type: 'page', children: [{ type: 'a', props: { href: `#${A}/f9` } }, { type: 'b', proto: { onClick: [{ do: 'navigate', frame: 'f8', canvas: A }] } }] });
  assert.deepEqual(crossLinks([root as never]).map((t) => t.frame).sort(), ['f8', 'f9']);
});

test('lintProto 不把跨画布目标当成死链；交互模拟给出跨画布跳转', () => {
  const doc = {
    schemaVersion: 1,
    canvasId: 'x',
    rev: 1,
    tokens: {},
    components: {},
    assets: {},
    frames: [
      {
        id: 'f1',
        name: '首页',
        width: 390,
        height: 'auto',
        root: { id: 'f1', type: 'page', children: [{ id: 'a', type: 'a', text: '去', props: { href: `#${A}/old` } }, { id: 'b', type: 'button', text: '坏', props: { href: '#nope' } }] },
      },
    ],
  } as never;
  const w = lintProto(doc, ['f1']);
  assert.deepEqual(w.map((x) => x.id), ['b']);
  assert.deepEqual(stateAfter(doc, 'f1', ['a']).nav, { kind: 'navigate', canvas: A, frame: 'old' });
});

test('新画布：canvas_open 返回项目页面索引；只读查看旧画布；frame_create from 写时复制；跨画布链接校验', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-proj-'));
  const hub = new Registry();
  const fake = { readyState: 1, send: () => {} } as never;

  // 第一轮：画布 A，两个页面互相链接，带组件与令牌
  const s1 = await session(hub, 's1', cwd);
  const a = await s1('canvas_open', { new: true, title: '第一轮' });
  const ca = hub.get(a.json.canvas_id);
  ca.clients.add(fake);
  const plan = await s1('design_plan', { enough_info: '单元测试：两个页面的小应用，内容由用例指定', user_style: '单元测试：令牌由用例写死', pages: [{ name: '首页', width: 390 }, { name: '详情', width: 390 }] });
  assert.ok(!plan.r.isError, plan.text);
  const [home, detail] = plan.json.pages.map((p: { frame_id: string }) => p.frame_id);
  assert.ok(!(await s1('tokens_set', { tokens: { 'color.primary': '#2255ff', 'radius.md': '8' } })).r.isError);
  const ins = await s1('node_insert', {
    parent_id: home,
    jsx: `<button component="Btn" style={{background:"{color.primary}"}} props={{href:"#${detail}"}}>看详情</button>`,
  });
  assert.ok(!ins.r.isError, ins.text);
  assert.ok(!(await s1('node_insert', { parent_id: detail, jsx: `<a props={{href:"#back"}}>返回</a>` })).r.isError);

  // 第二轮：另一个会话在同一项目新开画布 B
  const s2 = await session(hub, 's2', cwd);
  const b = await s2('canvas_open', { new: true, title: '第二轮' });
  assert.ok(!b.r.isError, b.text);
  const idx = b.json.project_canvases;
  assert.equal(idx.length, 1);
  assert.equal(idx[0].canvas_id, ca.id);
  assert.deepEqual(idx[0].pages.map((p: { id: string }) => p.id), [home, detail]);
  assert.match(b.json.project_canvases_hint, /frame_create/);
  const cb = hub.get(b.json.canvas_id);
  cb.clients.add(fake);

  // 只读查看旧画布
  const outline = await s2('design_outline', { canvas_id: ca.id, frame_id: home });
  assert.ok(!outline.r.isError, outline.text);
  assert.equal(outline.json.frame.id, home);
  const rd = await s2('design_read', { canvas_id: ca.id, node_id: home, format: 'jsx' });
  assert.ok(!rd.r.isError, rd.text);
  assert.equal(rd.json.canvas_id, ca.id);
  assert.match(rd.json.jsx, /component="Btn"/);
  assert.match(rd.json.components.Btn, /看详情/);

  const plan2 = await s2('design_plan', { enough_info: '单元测试：第二轮新增一个设置页', user_style: '单元测试：沿用第一轮', pages: [{ name: '设置', width: 390 }] });
  assert.ok(!plan2.r.isError, plan2.text);
  const settings = plan2.json.pages[0].frame_id;

  // 新页面链接旧页面：正确的跨画布链接无警告，错的给出提示
  const good = await s2('node_insert', { parent_id: settings, jsx: `<a props={{href:"#${ca.id}/${detail}"}}>旧详情</a>` });
  assert.ok(!good.r.isError, good.text);
  assert.ok(!(good.json.proto_warnings ?? []).some((w: string) => w.includes(detail)), good.text);
  const bad = await s2('node_insert', { parent_id: settings, jsx: `<a props={{href:"#${ca.id}/f_missing"}}>坏链接</a>` });
  assert.ok(bad.json.proto_warnings.some((w: string) => w.includes('f_missing')), bad.text);

  // 写时复制：旧首页复制到 B，旧画布不变
  const beforeRev = ca.doc.rev;
  const cp = await s2('frame_create', { from: { canvas_id: ca.id, frame_id: home }, name: '首页 v2' });
  assert.ok(!cp.r.isError, cp.text);
  const copy = cb.doc.frames.find((f) => f.id === cp.json.frame_id)!;
  assert.equal(copy.name, '首页 v2');
  assert.equal(ca.doc.rev, beforeRev, '旧画布不变');
  assert.ok(cb.doc.components.Btn, '组件一并复制');
  assert.equal(cb.doc.tokens['color.primary'], '#2255ff', '缺少的令牌补上');
  assert.equal(copy.root.children![0].component, 'Btn');
  assert.equal(cb.doc.components.Btn.root.props?.href, `#${ca.id}/${detail}`, '指向旧画布其他页面的链接改成跨画布链接');
  assert.deepEqual(cb.meta.basedOn?.[copy.id], { canvas: ca.id, frame: home, rev: ca.doc.rev });
  assert.equal(cp.json.based_on.canvas_id, ca.id);

  // 引用卡片：B 链接到的旧页面排在 B 所有画板右侧；流程图可以按名称指向它
  const cards = refCards(cb.doc);
  assert.deepEqual(cards.map((x) => `${x.canvas}/${x.frame}`), [`${ca.id}/${detail}`, `${ca.id}/f_missing`]);
  assert.equal(cards[0].x, cb.doc.frames.reduce((n, f) => n + f.width + 120, 0));
  const flow = await s2('design_annotate', { flow: { mermaid: `flowchart LR\n  ${settings} -->|查看| old[详情]` } });
  assert.ok(!flow.r.isError, flow.text);
  const arrow = cb.notes.find((n) => n.by === 'ai' && n.kind === 'arrow')!;
  assert.ok(arrow, '画了箭头');
  const end = arrow.pts[arrow.pts.length - 1];
  assert.ok(end[0] >= cards[0].x - 1 && end[0] <= cards[0].x + cards[0].w + 1, `箭头指向引用卡片 ${JSON.stringify(arrow.pts)}`);
  assert.equal(cb.notes.filter((n) => n.by === 'ai' && n.kind === 'rect').length, 0, '“详情”对应引用卡片，不再生成说明框');

  // 导出：直接链接到的旧页面打包为只读页面，跨画布链接在导出里可跳
  const exp = buildExport(cb.doc, cb.dir, { frameIds: [settings], foreign: (id) => (hub.exists(id) ? { doc: hub.get(id).doc, dir: hub.get(id).dir } : undefined) });
  const html = exp.data.toString('utf8');
  assert.match(html, /dm-ro/);
  assert.match(html, /<label for="dm-f1"[^>]*>详情<\/label>/);
  assert.ok(exp.warnings.some((w) => w.includes('f_missing')), JSON.stringify(exp.warnings));
  // 内嵌的交互脚本能解析（跨画布链接的正则写在模板字符串里，转义容易丢）
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(m[1]), '导出脚本语法正确');
  assert.match(html, /\\\/\(\.\+\)\$\//, '正则里的斜杠保留转义');
  const alone = buildExport(cb.doc, cb.dir, { frameIds: [settings] }).data.toString('utf8');
  assert.doesNotMatch(alone, /dm-ro/, '不提供 foreign 时不打包');

  ca.close();
  cb.close();
});

test('一个会话换画布：当前画布自检完才能换，换完绑定新画布', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-proj-'));
  const hub = new Registry();
  const fake = { readyState: 1, send: () => {} } as never;
  const s = await session(hub, 'sw', cwd);
  const a = await s('canvas_open', { new: true, title: '第一轮' });
  const ca = hub.get(a.json.canvas_id);
  ca.clients.add(fake);
  const plan = await s('design_plan', { enough_info: '单元测试：一个只有问候语的页面', user_style: '单元测试：令牌由用例写死', pages: [{ name: '首页', width: 390 }] });
  assert.ok(!plan.r.isError, plan.text);
  const home = plan.json.pages[0].frame_id;
  assert.ok(!(await s('node_insert', { parent_id: home, jsx: '<text>你好</text>' })).r.isError);

  // 还没自检：拒绝换画布
  const refused = await s('canvas_open', { new: true, title: '第二轮' });
  assert.ok(refused.r.isError);
  assert.match(refused.text, /自检/);

  // 自检完成后可以换；新画布带旧画布的页面索引
  ca.markChecked([home]);
  const b = await s('canvas_open', { new: true, title: '第二轮' });
  assert.ok(!b.r.isError, b.text);
  assert.notEqual(b.json.canvas_id, ca.id);
  assert.equal(b.json.previous_canvas.canvas_id, ca.id);
  assert.equal(b.json.project_canvases[0].canvas_id, ca.id);
  assert.equal(ca.lock, null, '旧画布的锁已释放');
  const st = await s('canvas_status', {});
  assert.equal(st.json.canvas_id ?? b.json.canvas_id, b.json.canvas_id);

  // 切回旧画布
  const back = await s('canvas_open', { canvas_id: ca.id });
  assert.ok(!back.r.isError, back.text);
  assert.equal(back.json.canvas_id, ca.id);
  assert.equal(back.json.previous_canvas.canvas_id, b.json.canvas_id);
  ca.close();
  hub.get(b.json.canvas_id).close();
});
