import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { connect, layoutFlow, parseFlow } from '../src/core/mermaid.ts';
import { planLintFixes } from '../src/core/lintFix.ts';
import { designCheckup } from '../src/core/designLint.ts';
import { applyOps, emptyDoc } from '../src/core/doc.ts';
import { updateOps } from '../src/core/edit.ts';
import { decodePng, diffBitmaps } from '../src/server/pixelDiff.ts';
import type { DesignDoc, Frame, Node } from '../src/core/types.ts';

test('mermaid: 方向、节点形状、连线类型、标签与链式写法', () => {
  const g = parseFlow(`flowchart LR
    %% 注释
    start([打开 App]) --> login[登录<br/>手机号]
    login -->|成功| home & profile
    login -. 忘记密码 .-> reset{找回?}
    reset -- 是 --> login
    home --- profile
    classDef x fill:#f00
    subgraph s
    end`);
  assert.equal(g.dir, 'LR');
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(byId.start.shape, 'terminal');
  assert.equal(byId.login.text, '登录\n手机号');
  assert.equal(byId.reset.shape, 'decision');
  assert.equal(byId.home.text, 'home');
  const e = (a: string, b: string) => g.edges.find((x) => x.from === a && x.to === b)!;
  assert.equal(e('login', 'home').label, '成功');
  assert.equal(e('login', 'profile').label, '成功');
  assert.deepEqual([e('login', 'reset').dashed, e('login', 'reset').label], [true, '忘记密码']);
  assert.equal(e('reset', 'login').label, '是');
  assert.equal(e('home', 'profile').arrow, false);
  assert.throws(() => parseFlow('graph TD\n  a --> '), /第 1 行/);
});

test('mermaid: 分层布局按依赖分层、回边不影响层次、层内不重叠', () => {
  const g = parseFlow('graph TD\n a --> b\n a --> c\n b --> d\n c --> d\n d --> a');
  const placed = layoutFlow(g, () => ({ w: 100, h: 40 }));
  const p = Object.fromEntries(placed.map((x) => [x.id, x]));
  assert.equal(p.a.y, 0);
  assert.ok(p.b.y > p.a.y && p.b.y === p.c.y && p.d.y > p.b.y, '回边 d→a 不改变层次');
  assert.ok(Math.abs(p.b.x - p.c.x) >= 100, '同层节点不重叠');
  const [from, to] = connect({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 200, w: 100, h: 40 });
  assert.deepEqual([from, to], [[50, 40], [50, 200]]);
});

function docWith(root: Node): { doc: DesignDoc; frame: Frame } {
  const doc = emptyDoc('c1');
  doc.tokens = {
    'size.sm': '14px',
    'size.md': '16px',
    'size.xl': '24px',
    'space.1': '4px',
    'space.2': '8px',
    'space.3': '12px',
    'space.4': '16px',
    'radius.sm': '6px',
    'radius.lg': '16px',
    'color.text': '#1A1A1A',
    'color.surface': '#FFFFFF',
    'color.on-primary': '#ffffff',
    'color.border': '#E5E5E5',
  };
  const frame: Frame = { id: 'f1', name: '首页', width: 375, height: 'auto', root };
  doc.frames.push(frame);
  return { doc, frame };
}

test('lint fix: 阶梯外数值换成最近的令牌，同值色按用途挑令牌，造型与展示级数值不动', () => {
  const { doc, frame } = docWith({
    id: 'f1',
    type: 'page',
    box: { padding: [10, 18] },
    layout: { gap: 15 },
    children: [
      { id: 't1', type: 'text', text: '标题', style: { fontSize: 15, color: '#1a1a1a' } },
      { id: 't2', type: 'text', text: '大数字', style: { fontSize: 72 } },
      { id: 't3', type: 'text', text: '白字', style: { color: '#FFF' } },
      { id: 'b1', type: 'card', box: { radius: 7, border: { width: 1, color: '#e5e5e5' } }, style: { background: '#ffffff' }, children: [] },
      { id: 'b2', type: 'leaf', box: { radius: [20, 2, 20, 2] }, children: [] },
      { id: 'b3', type: 'box', box: { padding: 40 }, children: [] },
    ],
  });
  const plan = planLintFixes(doc, [frame]);
  const ch = Object.fromEntries(plan.changes.map((c) => [`${c.id} ${c.field}`, c.to]));
  assert.equal(ch['t1 style.fontSize'], '{size.md}', '15 与 14 / 16 等距时取较大的一档');
  assert.equal(ch['t1 style.color'], '{color.text}');
  assert.equal(ch['t3 style.color'], '{color.on-primary}', '白色按“文字”用途挑 on-primary');
  assert.equal(ch['b1 style.background'], '{color.surface}', '白色按“背景”用途挑 surface');
  assert.equal(ch['b1 box.border.color'], '{color.border}');
  assert.equal(ch['b1 box.radius'], '{radius.sm}');
  assert.deepEqual(ch['f1 box.padding'], ['{space.3}', '{space.4}']);
  assert.equal(ch['f1 layout.gap'], '{space.4}');
  assert.equal(ch['t2 style.fontSize'], undefined, '比阶梯最大一档还大的展示级字号不动');
  assert.equal(ch['b2 box.radius'], undefined, '四角不同的造型圆角不动');
  assert.ok(plan.skipped.some((s) => s.id === 'b3' && s.field === 'box.padding'), '相差过大的间距留给 AI 判断');
  // 应用后体检里对应的提醒消失
  let d = doc;
  for (const { id, patch } of plan.patches) applyOps(d, updateOps(d, id, patch, 'ai').ops);
  d = { ...d };
  const kinds = designCheckup(d, d.frames[0]).map((n) => n.kind);
  assert.ok(!kinds.includes('off_scale'));
  assert.ok(!kinds.includes('off_radius'));
  // kinds 过滤
  assert.ok(planLintFixes(doc, [doc.frames[0]], new Set(['off_scale'])).changes.every((c) => c.kind === 'off_scale'));
});

/** 测试用：最简 RGBA PNG 编码。 */
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number]): string {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = y % 2 ? 2 : 1; // 交替用 Up / Sub 过滤器，覆盖解码分支
    const line = Buffer.alloc(w * 4);
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      line.set([r, g, b, 255], x * 4);
    }
    const prev = Buffer.alloc(w * 4);
    if (y > 0) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y - 1); prev.set([r, g, b, 255], x * 4); }
    for (let i = 0; i < w * 4; i++) {
      const v = y % 2 ? line[i] - prev[i] : line[i] - (i >= 4 ? line[i - 4] : 0);
      raw[y * (w * 4 + 1) + 1 + i] = v & 0xff;
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

test('pixel diff: 解码 PNG，变化区域聚合成块，未变化时为空', () => {
  const base = (x: number, y: number): [number, number, number] => [(x * 3) & 255, (y * 5) & 255, 128];
  const a = decodePng(png(120, 80, base))!;
  assert.equal(a.width, 120);
  assert.deepEqual([...a.data.slice((10 * 120 + 7) * 4, (10 * 120 + 7) * 4 + 4)], [21, 50, 128, 255]);
  const b = decodePng(png(120, 80, (x, y) => (x >= 20 && x < 40 && y >= 10 && y < 30 ? [255, 0, 0] : base(x, y))))!;
  const d = diffBitmaps(a, b);
  assert.equal(d.regions.length, 1);
  const r = d.regions[0];
  assert.ok(r.x <= 20 && r.y <= 10 && r.x + r.width >= 40 && r.y + r.height >= 30);
  assert.ok(d.ratio > 0.03 && d.ratio < 0.05);
  assert.deepEqual(diffBitmaps(a, a).regions, []);
  const c = decodePng(png(120, 100, base))!;
  assert.deepEqual(diffBitmaps(a, c).resized, { from: [120, 80], to: [120, 100] });
  assert.equal(decodePng('bm90IGEgcG5n'), null);
});
