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

async function setup() {
  const hub = new Registry();
  const server = createMcpServer(hub, { id: 's1', cwd: process.cwd(), ancestors: [] });
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
