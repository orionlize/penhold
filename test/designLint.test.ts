import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designCheckup, formatDesignNotes } from '../src/core/designLint.ts';
import { emptyDoc } from '../src/core/doc.ts';
import type { DesignDoc, Frame, Node } from '../src/core/types.ts';

let seq = 0;
const text = (t: string, style: Node['style'] = {}): Node => ({ id: `t${++seq}`, type: 'text', text: t, style });
const box = (children: Node[], extra: Partial<Node> = {}): Node => ({ id: `b${++seq}`, type: 'box', children, ...extra });

function docWith(root: Node): { doc: DesignDoc; frame: Frame } {
  const doc = emptyDoc('c1');
  doc.tokens = {
    'color.card': '#FFFFFF',
    'size.sm': '14px',
    'size.md': '16px',
    'size.xl': '22px',
    'size.3xl': '34px',
    'radius.sm': '6px',
    'radius.lg': '16px',
    'radius.full': '999px',
  };
  const frame: Frame = { id: 'f1', name: '首页', width: 375, height: 'auto', root };
  doc.frames.push(frame);
  return { doc, frame };
}
const kinds = (doc: DesignDoc, frame: Frame) => designCheckup(doc, frame).map((n) => n.kind);

test('克制的页面没有提醒', () => {
  const { doc, frame } = docWith(
    box([
      text('本月结余', { fontSize: '{size.sm}' }),
      text('3,280', { fontSize: 72, fontWeight: 700 }),
      ...Array.from({ length: 8 }, (_, i) => text(`第 ${i + 1} 笔支出`, { fontSize: '{size.md}' })),
      box([text('记一笔', { fontSize: '{size.md}', fontWeight: 600 })], { box: { radius: '{radius.full}' }, style: { background: '{color.card}' } }),
    ]),
  );
  assert.deepEqual(designCheckup(doc, frame), []);
  assert.equal(formatDesignNotes([]), '');
});

test('阶梯外字号、没有焦点、处处加粗', () => {
  const { doc, frame } = docWith(
    box([
      text('标题', { fontSize: 18, fontWeight: 700 }),
      ...Array.from({ length: 6 }, (_, i) => text(`条目 ${i}`, { fontSize: 13, fontWeight: 600 })),
      ...Array.from({ length: 3 }, (_, i) => text(`说明 ${i}`, { fontSize: '{size.sm}' })),
    ]),
  );
  const notes = designCheckup(doc, frame);
  const k = notes.map((n) => n.kind);
  assert.ok(k.includes('off_scale') && k.includes('flat_hierarchy') && k.includes('bold_everywhere'), k.join());
  assert.match(notes.find((n) => n.kind === 'off_scale')!.detail, /13px × 6/);
  assert.match(formatDesignNotes(notes), /设计体检：\d 项提醒/);
  assert.match(formatDesignNotes(notes, true), /处理方式同前/);
});

test('字号继承自父节点，展示级大字号不算阶梯外', () => {
  const { doc, frame } = docWith(
    box([text('82', { fontSize: 88 }), box(Array.from({ length: 9 }, (_, i) => text(`行 ${i}`)), { style: { fontSize: '{size.sm}', fontWeight: 700 } })]),
  );
  const k = kinds(doc, frame);
  assert.ok(!k.includes('off_scale') && !k.includes('flat_hierarchy'));
  assert.ok(k.includes('bold_everywhere'), '粗体继承自父节点');
});

test('满屏胶囊与卡片套卡片', () => {
  const pill = (t: string) => box([text(t, { fontSize: '{size.sm}' })], { box: { radius: '{radius.full}' } });
  const card = (children: Node[]) => box(children, { box: { radius: '{radius.lg}' }, style: { background: '{color.card}' } });
  const { doc, frame } = docWith(box([card([card([card([text('最里层', { fontSize: '{size.md}' })])])]), ...Array.from({ length: 10 }, (_, i) => pill(`标签 ${i}`))]));
  const k = kinds(doc, frame);
  assert.ok(k.includes('pill_everywhere') && k.includes('nested_cards'), k.join());
});

test('组件实例按定义展开并应用文本覆盖；同一张照片重复使用', () => {
  const { doc, frame } = docWith(box([]));
  doc.assets = {
    abc123: { hash: 'abc123', file: 'abc123.jpg', mime: 'image/jpeg', width: 220, height: 148 },
    def456: { hash: 'def456', file: 'def456.svg', mime: 'image/svg+xml' },
  };
  doc.components.Row = {
    name: 'Row',
    root: { id: 'cmp_Row', type: 'row', children: [{ id: 'r_meta', type: 'text', text: '占位', style: { fontSize: '{size.sm}' } }] },
  };
  frame.root.children = [
    ...['滨江公园 · 商品饵 · 台钓', '青龙水库 · 翻板钩 · 路亚', '钓点保密 · 玉米 · 海竿'].map(
      (t, i): Node => ({ id: `row${i}`, type: 'row', component: 'Row', overrides: { r_meta: { text: t } } }),
    ),
    { id: 'img1', type: 'image', props: { src: 'asset:abc123' } },
    { id: 'img2', type: 'image', props: { src: 'asset:abc123' } },
    { id: 'ic1', type: 'image', props: { src: 'asset:def456' } },
    { id: 'ic2', type: 'image', props: { src: 'asset:def456' } },
    { id: 'hid', type: 'text', text: '隐藏 · 不算 · 的', meta: { hidden: true } },
  ];
  const notes = designCheckup(doc, frame);
  const dot = notes.find((n) => n.kind === 'dot_meta');
  assert.match(dot?.detail ?? '', /^3 处/);
  const img = notes.filter((n) => n.kind === 'image_reuse');
  assert.equal(img.length, 1, '图标重复使用不算');
  assert.match(img[0].detail, /img1、img2/);
});

test('间距、圆角阶梯外数字，字重与字体过多，emoji，左色条卡片，多个主按钮', () => {
  const { doc, frame } = docWith(
    box(
      [
        ...[13, 13, 18].map((p) => box([text('一项', { fontSize: '{size.md}' })], { box: { padding: p } })),
        ...[7, 7, 9].map((r) => box([text('卡片', { fontSize: '{size.md}' })], { box: { radius: r }, style: { background: '{color.card}' } })),
        box([text('叶片', { fontSize: '{size.md}' })], { box: { radius: [28, 8, 28, 8] }, style: { background: '{color.card}' } }),
        ...[300, 400, 500, 700].map((w) => text('字重', { fontSize: '{size.md}', fontWeight: w })),
        ...['Inter', 'Georgia', 'Courier'].map((f) => text('字体', { fontSize: '{size.md}', fontFamily: f })),
        text('🔥 热门', { fontSize: '{size.md}' }),
        box([text('提示', { fontSize: '{size.md}' })], { box: { border: { width: 4, color: '{color.card}', sides: ['left'] } }, style: { background: '{color.card}' } }),
        ...[1, 2, 3].map(() => ({ ...box([text('购买', { fontSize: '{size.md}' })]), type: 'button', style: { background: '{color.primary}' } })),
      ],
      { layout: { gap: '{space.4}' } },
    ),
  );
  doc.tokens = { ...doc.tokens, 'space.1': '4px', 'space.2': '8px', 'space.3': '12px', 'space.4': '16px', 'radius.md': '10px' };
  const k = kinds(doc, frame);
  for (const want of ['off_space', 'off_radius', 'too_many_weights', 'too_many_fonts', 'emoji_icon', 'accent_border', 'many_primary']) assert.ok(k.includes(want as never), `${want}：${k.join(',')}`);
});
