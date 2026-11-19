import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyKeepChildren, JsxError, parseJsx, toJsx } from '../src/core/jsx.ts';
import { validateNodeInput } from '../src/core/schema.ts';

test('jsx: 扁平属性归入 layout / box / style / props / proto，文字即 text', () => {
  const [card] = parseJsx(`
    <card id="c1" name="预算卡片" direction="row" gap={12} padding={[12, 16]} radius="{radius.md}"
          background="{color.surface}" border={{width: 1, color: "{color.border}"}} hover={{background: "{color.muted}"}}
          onClick={[{do: 'navigate', frame: 'f2'}]} href="#f2" wrap hidden>
      {/* 注释会被忽略 */}
      <img src="https://example.com/a.png" width={48} height={48} alt="头像" />
      <title textStyle="heading5" fontSize="{size.md}" fontWeight={600}>本月 &lt;预算&gt; {{sec}}</title>
    </card>`);
  assert.deepEqual(card.layout, { direction: 'row', gap: 12, wrap: true });
  assert.deepEqual(card.box, { padding: [12, 16], radius: '{radius.md}', border: { width: 1, color: '{color.border}' } });
  assert.deepEqual(card.style, { background: '{color.surface}' });
  assert.deepEqual(card.states, { hover: { background: '{color.muted}' } });
  assert.deepEqual(card.proto, { onClick: [{ do: 'navigate', frame: 'f2' }] });
  assert.deepEqual(card.props, { href: '#f2' });
  assert.deepEqual(card.meta, { hidden: true });
  assert.equal(card.name, '预算卡片');
  const [img, title] = card.children as typeof card[];
  assert.equal(img.type, 'img');
  assert.deepEqual(img.props, { src: 'https://example.com/a.png', alt: '头像' });
  assert.equal(title.text, '本月 <预算> {{sec}}', '文字原样保留，{{插值}} 不当成 JSX 表达式');
  // 解析结果能通过节点校验
  validateNodeInput(card);
});

test('jsx: 多行文字逐行去首尾空白；整块写法与扁平写法等价', () => {
  const [list] = parseJsx(`<list listStyle="disc">
      第一条
      第二条
    </list>`);
  assert.equal(list.text, '第一条\n第二条');
  const [a] = parseJsx(`<box style={{color: '{color.text}', fontSize: 14}} layout={{gap: 8}} props={{icon: 'star'}} />`);
  const [b] = parseJsx(`<box color="{color.text}" fontSize={14} gap={8} icon="star" />`);
  assert.deepEqual(a, b);
  assert.equal(parseJsx('<a/><b/><c></c>').length, 3);
});

test('jsx: 报错指出位置与原因', () => {
  assert.throws(() => parseJsx('<card><title>x</card>'), /闭合标签/);
  assert.throws(() => parseJsx('<card>文字<b/></card>'), /混写/);
  assert.throws(() => parseJsx('<card gap={16} layout={{gap: 8}} />'), /重复/);
  assert.throws(() => parseJsx('<card foo={{a: 1}} />'), /未知属性/);
  assert.throws(() => parseJsx('<card id="x" stub />'), /keepChildren/);
  assert.throws(() => parseJsx('<card gap={sixteen} />'), JsxError);
  assert.throws(() => parseJsx('<card\n  gap=16 />'), /第 2 行/);
  assert.throws(() => parseJsx('文字'), /顶层/);
});

test('jsx: toJsx 与 parseJsx 往返一致', () => {
  const node = {
    id: 'c1',
    type: 'card',
    name: 'A "quoted" name',
    component: 'Card',
    layout: { direction: 'row', gap: 12, wrap: true },
    box: { padding: [12, 16], border: { width: 1, color: '{color.border}' } },
    style: { background: '{color.surface}', fontSize: 14 },
    states: { hover: { opacity: 0.8 } },
    proto: { show: "tab == 'a'", onClick: [{ do: 'set', var: 'tab', value: 'a' }] },
    props: { href: '#f2', disabled: 'x' },
    overrides: { t1: { text: '改' } },
    hidden: true,
    children: [
      { id: 't1', type: 'title', text: '第一行\n第二行' },
      { id: 't2', type: 'note', text: '  前后有空格  ' },
      { id: 't3', type: '中文类型', text: 'a < b & c' },
      { id: 't4', type: 'has space', text: 'x' },
    ],
  };
  const src = toJsx(node);
  const [back] = parseJsx(src);
  const expected = { ...node, meta: { hidden: true } } as Record<string, unknown>;
  delete expected.hidden;
  assert.deepEqual(back, expected);
  assert.match(src, /<_ type="has space"/);
  assert.match(src, /props=\{\{href: "#f2", disabled: "x"\}\}/, 'props 键与 proto 字段同名时整块写');
});

test('jsx: keepChildren 沿用原有子节点', () => {
  const parsed = parseJsx('<card id="c1" padding={8} keepChildren />');
  const kids = [{ id: 'k1', type: 'text', text: 'hi' }];
  const [n] = applyKeepChildren(parsed, (id) => (id === 'c1' ? kids : undefined));
  assert.deepEqual(n, { type: 'card', id: 'c1', box: { padding: 8 }, children: kids });
  assert.throws(() => applyKeepChildren(parseJsx('<card keepChildren />'), () => []), /需要 id/);
  assert.throws(() => applyKeepChildren(parseJsx('<card id="zz" keepChildren />'), () => undefined), /找不到/);
});
