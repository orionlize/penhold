// MCP 工具层：工具 schema 体积、写工具的紧凑返回，以及 frame_create / node_replace 的宽松节点参数仍经完整校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DESIGN_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-mcp-'));
process.env.DESIGN_MCP_NO_BROWSER = '1';
const { createMcpServer } = await import('../src/server/mcp.ts');
const { Registry } = await import('../src/server/canvas/registry.ts');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');

type R = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function setup(cwd = process.cwd()) {
  const hub = new Registry();
  const server = createMcpServer(hub, { id: 's1', cwd, ancestors: [] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 't', version: '0' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as R;
    const text = r.content.find((x) => x.type === 'text')?.text ?? '';
    return { r, text, json: r.isError ? undefined : JSON.parse(text) };
  };
  return { hub, client, call };
}

test('工具 schema：Node 结构只在 node_insert 展开一份', async () => {
  const { client } = await setup();
  const { tools } = await client.listTools();
  const size = (n: string) => JSON.stringify(tools.find((t) => t.name === n)!.inputSchema).length;
  assert.ok(size('node_insert') < 10_000, `node_insert schema ${size('node_insert')}`);
  assert.ok(size('frame_create') < 2_000, `frame_create schema ${size('frame_create')}`);
  assert.ok(size('node_replace') < 1_500, `node_replace schema ${size('node_replace')}`);
});

test('写工具返回紧凑 JSON 与 "id type" 形式的 affected；宽松节点参数仍做完整校验', async () => {
  const { hub, call } = await setup();
  const opened = await call('canvas_open', { new: true, title: 'mcp' });
  const canvas = hub.get(opened.json.canvas_id);
  canvas.clients.add({ readyState: 1, send: () => {} } as never);

  const plan = await call('design_plan', { enough_info: '单元测试用例：一个空白页面，内容由用例指定', user_style: '单元测试：令牌与样式由用例写死', pages: [{ name: 'A', width: 390 }] });
  assert.ok(!plan.r.isError, plan.text);
  const frameId = plan.json.pages[0].frame_id;

  const ins = await call('node_insert', {
    parent_id: frameId,
    nodes: [{ type: 'card', id: 'c1', children: [{ type: 'title', text: 'hi' }] }, { type: 'button', component: 'Btn', text: 'Go' }],
  });
  assert.ok(!ins.r.isError, ins.text);
  assert.ok(!ins.text.includes('\n'), '返回不带缩进与换行');
  assert.equal(ins.json.affected[0], 'c1 card');
  assert.match(ins.json.affected[1], /^\S+ title$/);
  assert.match(ins.json.affected[2], /^\S+ button<Btn>$/);

  // frame_create：root 的 children / style 等字段完整透传
  const fc = await call('frame_create', { name: 'B', width: 390, root: { style: { background: '#ffffff' }, children: [{ type: 'title', text: 'B' }] } });
  assert.ok(!fc.r.isError, fc.text);
  const frame = canvas.doc.frames.find((f) => f.id === fc.json.frame_id)!;
  assert.equal(frame.root.type, 'page');
  assert.equal(frame.root.style?.background, '#ffffff');
  assert.equal(frame.root.children?.[0].text, 'B');

  // node_replace：深层字段照常校验，非法字段被拒绝
  const ok = await call('node_replace', { node_id: 'c1', node: { type: 'card', box: { padding: 12 }, children: [{ type: 'desc', text: 'x', states: { hover: { color: '#000000' } } }] } });
  assert.ok(!ok.r.isError, ok.text);
  const bad = await call('node_replace', { node_id: 'c1', node: { type: 'card', children: [{ type: 'desc', style: { bogus: 1 } }] } });
  assert.ok(bad.r.isError);
  assert.match(bad.text, /children\[0\]/);
  const badState = await call('node_insert', { parent_id: frameId, nodes: [{ type: 'a', states: { hover: { bogus: 1 } } }] });
  assert.ok(badState.r.isError, 'states 里的非法字段仍被拒绝');
  canvas.close();
});

test('jsx：node_insert / design_read(format:"jsx") / node_replace(keepChildren) 往返；design_annotate flow；design_lint_fix', async () => {
  const { hub, call } = await setup();
  const opened = await call('canvas_open', { new: true, title: 'jsx' });
  const canvas = hub.get(opened.json.canvas_id);
  canvas.clients.add({ readyState: 1, send: () => {} } as never);
  const plan = await call('design_plan', { enough_info: '单元测试用例：两个页面，内容由用例指定', user_style: '单元测试：令牌与样式由用例写死', pages: [{ name: '登录', width: 390 }, { name: '首页', width: 390 }] });
  const [f1, f2] = plan.json.pages.map((p: { frame_id: string }) => p.frame_id);

  const ins = await call('node_insert', {
    parent_id: f1,
    jsx: `<card id="c1" direction="row" gap={13} padding={16}>
      <title id="t1" textStyle="heading5" fontSize={15}>你好</title>
      <desc id="t2" textStyle="body">说明</desc>
    </card>`,
  });
  assert.ok(!ins.r.isError, ins.text);
  const c1 = canvas.doc.frames[0].root.children![0];
  assert.deepEqual(c1.layout, { direction: 'row', gap: 13 });
  assert.equal(c1.children![0].text, '你好');
  const both = await call('node_insert', { parent_id: f1, nodes: [{ type: 'a' }], jsx: '<a/>' });
  assert.ok(both.r.isError && /二选一/.test(both.text));
  const keepInInsert = await call('node_insert', { parent_id: f1, jsx: '<a id="c1" keepChildren />' });
  assert.ok(keepInInsert.r.isError && /node_replace/.test(keepInInsert.text));

  const rd = await call('design_read', { node_id: 'c1', format: 'jsx', depth: 0 });
  assert.ok(!rd.r.isError, rd.text);
  assert.match(rd.json.jsx, /^<card id="c1" direction="row" gap=\{13\} padding=\{16\}>/);
  assert.match(rd.json.jsx, /<title id="t1" stub \/>/);
  assert.equal(rd.json.node, undefined);
  // 存根直接写回会被拒绝；改成 keepChildren 只改自身字段
  const stub = await call('node_replace', { node_id: 'c1', jsx: rd.json.jsx });
  assert.ok(stub.r.isError && /keepChildren/.test(stub.text));
  const rep = await call('node_replace', { node_id: 'c1', jsx: '<card id="c1" direction="column" gap={8} keepChildren />' });
  assert.ok(!rep.r.isError, rep.text);
  const c1b = canvas.doc.frames[0].root.children![0];
  assert.deepEqual(c1b.layout, { direction: 'column', gap: 8 });
  assert.deepEqual(c1b.children!.map((n) => n.id), ['t1', 't2'], '子节点与 id 保持不变');

  // 自动修复：字号 15 与间距按令牌阶梯修正
  await call('tokens_set', { tokens: { 'size.sm': '14px', 'size.md': '16px', 'size.lg': '20px' } });
  const dry = await call('design_lint_fix', { frame_id: f1, dry_run: true });
  assert.ok(!dry.r.isError, dry.text);
  assert.ok(dry.json.changes.some((s: string) => s.startsWith('t1 style.fontSize 15 → "{size.md}"')), dry.text);
  assert.equal(canvas.doc.frames[0].root.children![0].children![0].style?.fontSize, 15, 'dry_run 不改文档');
  const fix = await call('design_lint_fix', { frame_id: f1 });
  assert.ok(!fix.r.isError, fix.text);
  assert.equal(canvas.doc.frames[0].root.children![0].children![0].style?.fontSize, '{size.md}');

  // Mermaid 流程图：画板之间直接连，其余节点成为说明框
  const flow = await call('design_annotate', { flow: { mermaid: `flowchart LR\n  ${f1} -->|登录成功| ${f2}\n  ${f2} -.-> err{网络异常?}\n  err -->|重试| 首页` } });
  assert.ok(!flow.r.isError, flow.text);
  assert.deepEqual(flow.json.flow.linked_frames.sort(), [f1, f2].sort());
  assert.equal(flow.json.flow.boxes, 1);
  const notes = canvas.notes.filter((n) => n.by === 'ai');
  const between = notes.find((n) => n.kind === 'arrow' && n.pts[0][0] === 390)!;
  assert.ok(between, '相邻画板之间的横向箭头从左画板右边缘出发');
  assert.equal(between.pts[1][0], 510);
  assert.ok(notes.some((n) => n.kind === 'arrow' && n.dash === 'dashed'));
  assert.ok(notes.some((n) => n.kind === 'text' && n.text === '登录成功'));
  assert.ok(notes.some((n) => n.kind === 'rect' && n.text === '网络异常?' && n.color === '#FDF1D6'));
  canvas.close();
});

test('用户没选风格：同批其余方向成为 Tweaks 里的备选风格；选了风格时不附带，明暗按回答只生成一种', async (t) => {
  const { DIRECTION_Q } = await import('../src/server/design/brief.ts');
  const { directionDetail } = await import('../src/server/design/directions.ts');
  // 本机 ~/.claude/skills 里的 skill 会被当成设计规范，那样就不会给方向卡片
  const home = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = process.env.USERPROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-mcp-home-'));
  t.after(() => {
    for (const [k, v] of Object.entries(home)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  {
    const { hub, call } = await setup(fs.mkdtempSync(path.join(os.tmpdir(), 'dm-mcp-style-')));
    const opened = await call('canvas_open', { new: true, title: '记账' });
    const canvas = hub.get(opened.json.canvas_id);
    canvas.clients.add({ readyState: 1, send: () => {} } as never);
    canvas.meta.brief = { at: Date.now(), skipped: true, answers: [] };
    const plan = await call('design_plan', { pages: [{ name: '首页', width: 390 }] });
    assert.ok(!plan.r.isError, plan.text);
    const cards = plan.json.design_directions as Array<{ id: string }>;
    assert.equal(cards.length, 3);
    const pick = await call('design_direction', { pick: cards[1].id, concept: '结余是唯一的大数字', motif: '小票' });
    assert.ok(!pick.r.isError, pick.text);
    assert.equal(pick.json.alternate_styles.length, 2);
    assert.deepEqual(canvas.meta.direction?.alternates, [cards[0].id, cards[2].id]);
    const sys = await call('design_system', { action: 'create', name: '记账' });
    assert.ok(!sys.r.isError, sys.text);
    assert.match(sys.json.tweaks_themes, /风格/);
    assert.doesNotMatch(sys.json.tweaks_themes, /明暗/, '没有回答明暗时不附带亮 / 暗两套');
    const info = canvas.themeInfo()!;
    assert.equal(new Set(info.themes.map((t) => t.style)).size, 3);
    assert.equal(info.themes.length, 3);
    assert.equal(info.theme, info.themes[0].id);
    canvas.close();
  }
  {
    const { hub, call } = await setup(fs.mkdtempSync(path.join(os.tmpdir(), 'dm-mcp-style-')));
    const opened = await call('canvas_open', { new: true, title: '记账' });
    const canvas = hub.get(opened.json.canvas_id);
    canvas.clients.add({ readyState: 1, send: () => {} } as never);
    const [card] = (await call('design_direction', {})).json.design_directions as Array<{ id: string }>;
    const d = directionDetail(card.id)!;
    canvas.meta.brief = { at: Date.now(), answers: [{ id: DIRECTION_Q, question: '方向', answer: d.name }, { id: 'tone', question: '明暗', answer: '深色' }] };
    canvas.meta.direction = { id: d.id, name: d.name, signature: d.signature };
    const pick = await call('design_direction', { pick: card.id, concept: 'c', motif: 'm' });
    assert.ok(!pick.r.isError, pick.text);
    assert.equal(pick.json.alternate_styles, undefined);
    assert.equal(canvas.meta.direction?.alternates, undefined);
    const sys = await call('design_system', { action: 'create', name: '记账' });
    assert.ok(!sys.r.isError, sys.text);
    assert.equal(sys.json.tweaks_themes, undefined);
    assert.deepEqual(canvas.themeInfo()!.themes.map((t) => [t.id, t.mode]), [['dark', 'dark']]);
    // 用户在对话里说两种都要时由 AI 传 modes
    const both = await call('design_system', { action: 'create', name: '记账', modes: ['light', 'dark'] });
    assert.ok(!both.r.isError, both.text);
    assert.match(both.json.tweaks_themes, /明暗/);
    canvas.close();
  }
});
