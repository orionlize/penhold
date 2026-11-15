import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, emptyDoc, getIndex, resolveAddress } from '../src/core/doc.ts';
import { insertOps, updateOps, checkUserOps } from '../src/core/edit.ts';
import { validateAnnotation, validateNodeInput } from '../src/core/schema.ts';
import { newSerializeState, renderFrame, serialize, styleCss } from '../src/core/render.ts';
import type { DesignDoc } from '../src/core/types.ts';

function setup(): DesignDoc {
  const doc = emptyDoc('c1');
  applyOps(doc, [{ op: 'frame_create', index: 0, frame: { id: 'f1', name: 'Login', width: 400, height: 'auto', root: { id: 'f1', type: 'page' } } }]);
  return doc;
}

const login = validateNodeInput({
  type: 'box',
  component: 'LoginForm',
  layout: { direction: 'column', gap: 16 },
  box: { width: 360, padding: 32 },
  children: [
    { type: 'text', text: '登录', style: { fontFamily: 'Inter', fontSize: 24, fontWeight: 600, color: '{color.text}' } },
    { type: 'input', component: 'TextField', props: { placeholder: '邮箱' }, box: { height: 44, padding: [0, 12], radius: 8 } },
    { type: 'button', component: 'PrimaryButton', text: '继续', box: { height: 44, radius: 8 }, style: { background: '{color.primary}', color: '#fff' } },
  ],
});

test('insert registers components bottom-up and renders', () => {
  const doc = setup();
  const p = insertOps(doc, 'f1', undefined, [login]);
  const inv = applyOps(doc, p.ops);
  assert.deepEqual(Object.keys(doc.components).sort(), ['LoginForm', 'PrimaryButton', 'TextField']);
  assert.equal(p.affected.length, 4);
  const inst = doc.frames[0].root.children![0];
  assert.equal(inst.component, 'LoginForm');
  assert.equal(inst.children, undefined);
  const html = serialize(renderFrame(doc, doc.frames[0], { mode: 'canvas', asset: () => undefined }), newSerializeState('inline'));
  assert.match(html, /登录/);
  assert.match(html, /var\(--color-primary\)/);
  assert.match(html, new RegExp(`data-node-id="${inst.id}:`));
  // 撤销
  applyOps(doc, inv);
  assert.equal(doc.frames[0].root.children, undefined);
  assert.deepEqual(doc.components, {});
});

test('instance text override vs definition style', () => {
  const doc = setup();
  applyOps(doc, insertOps(doc, 'f1', undefined, [login]).ops);
  const inst = doc.frames[0].root.children![0];
  const def = doc.components.LoginForm.root;
  const title = def.children![0];
  // 第二个实例：同形子树被接受
  const again = insertOps(doc, 'f1', undefined, [{ ...login, id: undefined }]);
  applyOps(doc, again.ops);
  assert.equal(Object.keys(doc.components).length, 3);
  // 实例内部改文本 → overrides
  const u1 = updateOps(doc, `${inst.id}:${title.id}`, { text: '注册', style: { color: '#f00' } }, 'user');
  checkUserOps(u1.ops);
  applyOps(doc, u1.ops);
  assert.equal(inst.overrides![title.id].text, '注册');
  assert.equal(def.children![0].style!.color, '#f00');
  assert.equal(def.children![0].text, '登录');
  // 用户不能改布局
  assert.throws(() => updateOps(doc, inst.id, { layout: { zIndex: 1 } }, 'user'));
  // 但可以改 position
  const u2 = updateOps(doc, inst.id, { layout: { position: 'sticky' } }, 'user');
  checkUserOps(u2.ops, doc);
  applyOps(doc, u2.ops);
  assert.equal(inst.layout!.position, 'sticky');
  assert.throws(() => checkUserOps([{ op: 'set', id: inst.id, field: 'layout', value: { position: 'fixed', zIndex: 1 } }], doc), /layout\.position/);
  const u3 = updateOps(doc, inst.id, { layout: { position: null } }, 'user');
  checkUserOps(u3.ops, doc);
  applyOps(doc, u3.ops);
  assert.equal(inst.layout?.position, undefined);
  const u4 = updateOps(doc, inst.id, { layout: { grow: 1 } }, 'user');
  checkUserOps(u4.ops, doc);
  applyOps(doc, u4.ops);
  assert.equal(inst.layout!.grow, 1);
  const u5 = updateOps(doc, inst.id, { layout: { display: 'grid', rows: 2, columns: 3, gap: 8, justify: 'center' } }, 'user');
  checkUserOps(u5.ops, doc);
  applyOps(doc, u5.ops);
  assert.equal(inst.layout!.columns, 3);
  assert.throws(() => updateOps(doc, inst.id, { layout: { zIndex: 1 } }, 'user'));
  // 不同子树被拒绝
  assert.throws(() => insertOps(doc, 'f1', undefined, [validateNodeInput({ type: 'box', component: 'LoginForm', children: [{ type: 'text', text: 'x' }] })]));
  // 嵌套实例地址可解析
  const btnInst = def.children![2];
  const r = resolveAddress(doc, `${inst.id}:${btnInst.id}`);
  assert.equal(r.target.node.component, 'PrimaryButton');
  assert.ok(getIndex(doc).get('cmp_PrimaryButton'));
});

test('schema rejects css injection', () => {
  assert.throws(() => validateNodeInput({ type: 'x', style: { color: 'red;background:url(x)' } }));
  assert.throws(() => validateNodeInput({ type: 'x', style: { foo: 1 } }));
  assert.throws(() => validateNodeInput({ type: 'x', props: { href: 'javascript:alert(1)' } }));
});

test('same-structure subtree with different text becomes overrides', () => {
  const doc = setup();
  const field = (label: string, ph: string) =>
    validateNodeInput({ type: 'field', component: 'Field', children: [{ type: 'label', text: label }, { type: 'input', render: 'input', props: { placeholder: ph } }] });
  const p = insertOps(doc, 'f1', undefined, [field('邮箱', 'a@b.c'), field('密码', '至少 8 位')]);
  applyOps(doc, p.ops);
  const [, second] = doc.frames[0].root.children!;
  const [labelDef, inputDef] = doc.components.Field.root.children!;
  assert.equal(labelDef.text, '邮箱');
  assert.deepEqual(second.overrides, { [labelDef.id]: { text: '密码' }, [inputDef.id]: { props: { placeholder: '至少 8 位' } } });
  // 样式不同仍拒绝
  assert.throws(() => insertOps(doc, 'f1', undefined, [validateNodeInput({ type: 'field', component: 'Field', children: [{ type: 'label', text: 'x', style: { color: '#f00' } }, { type: 'input', render: 'input' }] })]));
});

test('用户只能插入单个文字节点与空画板', async () => {
  const { checkUserOps } = await import('../src/core/edit.ts');
  assert.doesNotThrow(() => checkUserOps([{ op: 'insert', parent: 'x', index: 0, node: { id: 'n_a', type: 'text', text: '文字' } }]));
  assert.throws(() => checkUserOps([{ op: 'insert', parent: 'x', index: 0, node: { id: 'n_a', type: 'box', children: [{ id: 'n_b', type: 'text' }] } }]));
  assert.doesNotThrow(() => checkUserOps([{ op: 'frame_create', index: 0, frame: { id: 'f_a', name: '移动 1', width: 390, height: 844, root: { id: 'f_a', type: 'page' } } }]));
  assert.throws(() => checkUserOps([{ op: 'frame_create', index: 0, frame: { id: 'f_a', name: 'x', width: 390, height: 844, root: { id: 'f_a', type: 'page', children: [{ id: 'n_c', type: 'text' }] } } }]));
  assert.throws(() => checkUserOps([{ op: 'remove', id: 'n_a' }]));
});

test('prototype links: canvas ignores href, link hook renders, export switches frames', async () => {
  const { buildExport } = await import('../src/server/export.ts');
  const doc = setup();
  applyOps(doc, [
    { op: 'frame_create', index: 1, frame: { id: 'f2', name: 'Home', width: 400, height: 600, root: { id: 'f2', type: 'page' } } },
    { op: 'insert', parent: 'f1', index: 0, node: { id: 'go', type: 'button', text: '进入', props: { href: '#f2' } } },
    { op: 'insert', parent: 'f2', index: 0, node: { id: 'bk', type: 'button', text: '返回', props: { href: '#back' } } },
    { op: 'insert', parent: 'f2', index: 1, node: { id: 'ext', type: 'link', text: '官网', props: { href: 'https://example.com' } } },
  ]);
  const canvas = serialize(renderFrame(doc, doc.frames[0], { mode: 'canvas', asset: () => undefined }), newSerializeState('inline'));
  assert.doesNotMatch(canvas, /href/);
  const play = serialize(
    renderFrame(doc, doc.frames[0], { mode: 'export', asset: () => undefined, link: (href) => ({ tag: 'div', attrs: { 'data-dm-href': href } }) }),
    newSerializeState('inline'),
  );
  assert.match(play, /<div data-dm-href="#f2"[^>]*cursor:pointer/);
  const html = buildExport(doc, '/nonexistent', { frameIds: ['f1', 'f2'] }).data.toString();
  assert.match(html, /<label for="dm-f1"[^>]*>进入<\/label>/);
  assert.match(html, /<a href="https:\/\/example.com"/);
  assert.match(html, /<div data-dm-href="#back"/);
  assert.match(html, /<script>[\s\S]*createProtoEngine/);
  const stat = buildExport(doc, '/nonexistent', { frameIds: ['f1', 'f2'], interactive: false }).data.toString();
  assert.doesNotMatch(stat, /<script|#back/);
  // 单画板导出时目标不在文件中，不渲染为链接
  const one = buildExport(doc, '/nonexistent', { frameIds: ['f1'] }).data.toString();
  assert.doesNotMatch(one, /dm-f1|href="#f2"/);
});

test('proto: expressions, templates, validation', async () => {
  const { evalExpr, renderTemplate, protoErrors } = await import('../src/core/proto.ts');
  const v = { tab: 'sms', sec: 0, phone: '13800000000', on: false };
  assert.equal(evalExpr("tab == 'sms' && !on", v), true);
  assert.equal(evalExpr('sec > 0 || len(phone) != 11', v), false);
  assert.equal(evalExpr("pad(5, 2) + ':' + 3", v), '05:3');
  assert.equal(renderTemplate("{{sec > 0 ? sec + 's 后重新获取' : '获取验证码'}}", { sec: 42 }), '42s 后重新获取');
  assert.equal(evalExpr('1 +', v), undefined);
  assert.deepEqual(protoErrors({ show: "tab == 'a'", onClick: [{ do: 'countdown', var: 'sec', from: 60 }] }), []);
  assert.ok(protoErrors({ show: 'tab ==' }).length);
  assert.ok(protoErrors({ onClick: [{ do: 'open', url: 'javascript:x' }] }).length);
  assert.throws(() => validateNodeInput({ type: 'x', proto: { show: '(a' } }), /表达式/);
  assert.throws(() => validateNodeInput({ type: 'x', proto: { onClick: [{ do: 'explode' }] } }));
  assert.throws(() => validateNodeInput({ type: 'x', text: '{{ sec + }}' }), /表达式/);
  validateNodeInput({ type: 'x', text: '{{sec}}s', proto: { vars: { sec: 0 }, disabled: 'sec > 0', onClick: [{ do: 'if', when: 'sec == 0', then: [{ do: 'countdown', var: 'sec', from: 60 }] }] } });
});

test('proto: static render uses initial state; runtime hook collects entries', () => {
  const doc = setup();
  const p = insertOps(doc, 'f1', undefined, [
    validateNodeInput({
      type: 'tabs',
      proto: { vars: { tab: 'pwd', sec: 0 } },
      children: [
        { type: 'tab', component: 'Tab', text: '密码', proto: { onClick: [{ do: 'set', var: 'tab', value: 'pwd' }], styles: [{ when: "tab == 'pwd'", style: { color: '#f00' } }] } },
        { type: 'tab', component: 'Tab', text: '短信', proto: { onClick: [{ do: 'set', var: 'tab', value: 'sms' }], styles: [{ when: "tab == 'pwd'", style: { color: '#f00' } }] } },
        { type: 'panel', text: 'PWD', proto: { show: "tab == 'pwd'" } },
        { type: 'panel', text: 'SMS', proto: { show: "tab == 'sms'" } },
        { type: 'btn', text: "{{sec > 0 ? sec + 's' : '获取验证码'}}" },
      ],
    }),
  ]);
  applyOps(doc, p.ops);
  // 第二个 Tab 实例根上的 proto 与定义不同，保留在实例上
  const tabs = doc.frames[0].root.children![0].children!;
  assert.equal(tabs[1].proto?.onClick?.[0].do, 'set');
  const html = serialize(renderFrame(doc, doc.frames[0], { mode: 'export', asset: () => undefined }), newSerializeState('inline'));
  assert.match(html, /获取验证码/);
  assert.match(html, /PWD/);
  assert.doesNotMatch(html, /SMS/); // 导出初始状态：隐藏的不输出
  const canvas = serialize(renderFrame(doc, doc.frames[0], { mode: 'canvas', asset: () => undefined }), newSerializeState('inline'));
  assert.match(canvas, /display:none[^>]*>SMS/);
  const entries: Array<{ addr: string; template?: string }> = [];
  const rt = serialize(renderFrame(doc, doc.frames[0], { mode: 'export', asset: () => undefined, proto: (e) => String(entries.push(e) - 1) }), newSerializeState('inline'));
  assert.equal(entries.length, 6);
  assert.match(rt, /data-dm-p="5"[^>]*>获取验证码/);
  assert.ok(entries.some((e) => e.template?.includes('sec')));
  assert.match(rt, /SMS/); // 运行时模式全部输出，由运行时控制显隐
});

test('export: interactive proto runs from embedded engine source', async () => {
  const { buildExport } = await import('../src/server/export.ts');
  const doc = setup();
  applyOps(doc, [
    { op: 'set', id: 'f1', field: 'proto', value: { vars: { tab: 'a', sec: 0 } } },
    { op: 'insert', parent: 'f1', index: 0, node: { id: 'pa', type: 'panel', text: 'A', proto: { show: "tab == 'a'" } } },
    { op: 'insert', parent: 'f1', index: 1, node: { id: 'pb', type: 'panel', text: 'B</script>', proto: { show: "tab == 'b'" } } },
    { op: 'insert', parent: 'f1', index: 2, node: { id: 'bt', type: 'btn', text: '{{sec}}', proto: { onClick: [{ do: 'countdown', var: 'sec', from: 3 }] } } },
  ]);
  const html = buildExport(doc, '/nonexistent', {}).data.toString();
  assert.match(html, /data-dm-p="0-2"[^>]*>B&lt;\/script/); // 运行时模式全部输出
  assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
  // 内嵌的引擎源码可以独立求值（与 tsx/esbuild 的 __name 辅助函数兼容）
  const src = /var createProtoEngine = ([\s\S]*?);\nvar D = /.exec(html)![1];
  const engine = new Function('__name', `return (${src})()`)((f: unknown) => f);
  assert.equal(engine.renderTemplate('{{n > 1 ? n + "s" : "ok"}}', { n: 5 }), '5s');
  const data = JSON.parse(/var D = (.*);\n/.exec(html)![1]);
  assert.deepEqual(data.frames[0].vars, { tab: 'a', sec: 0 });
  assert.equal(data.frames[0].entries.length, 4);
  // 静态导出：只输出初始状态
  const stat = buildExport(doc, '/nonexistent', { interactive: false }).data.toString();
  assert.doesNotMatch(stat, /<script|>B&lt;/);
});

test('钢笔路径批注：ctrl 与 pts 等长，可闭合', () => {
  const ok = validateAnnotation({ id: 'a_path01', kind: 'path', pts: [[0, 0], [40, 0], [40, 30]], ctrl: [[0, 0], [10, 5], [0, 0]], closed: true, width: 2.5, ts: 1 });
  assert.equal(ok.kind, 'path');
  assert.equal(ok.closed, true);
  assert.throws(() => validateAnnotation({ id: 'a_path02', kind: 'path', pts: [[0, 0], [40, 0]], ctrl: [[0, 0]], ts: 1 }));
});

test('评论可关联到笔迹 / 形状批注（anchorNote）', () => {
  const ok = validateAnnotation({ id: 'a_cmt001', kind: 'comment', anchorNote: 'a_rect01', rel: [4, -2], pts: [[10, 10]], text: '这里', ts: 1 });
  assert.equal(ok.anchorNote, 'a_rect01');
  assert.throws(() => validateAnnotation({ id: 'a_cmt002', kind: 'comment', anchorNote: 'n_1', pts: [[0, 0]], ts: 1 }));
});

test('效果样式：内阴影、文字阴影、背景模糊与变换', () => {
  const css = styleCss({ shadow: '0px 4px 12px rgba(0,0,0,0.12)', innerShadow: '0px 2px 4px rgba(0,0,0,0.15), 0px 0px 1px #000', textShadow: '0px 1px 2px #000', backdropBlur: 8, transform: 'rotate(8deg)' }, {} as never);
  assert.ok(css.includes('box-shadow:0px 4px 12px rgba(0,0,0,0.12), inset 0px 2px 4px rgba(0,0,0,0.15), inset 0px 0px 1px #000'));
  assert.ok(css.includes('text-shadow:0px 1px 2px #000'));
  assert.ok(css.includes('backdrop-filter:blur(8px)'));
  assert.ok(css.includes('transform:rotate(8deg)'));
  assert.deepEqual(styleCss({ innerShadow: '0px 2px 4px #000' }, {} as never), ['box-shadow:inset 0px 2px 4px #000']);
});

test('listStyle renders each text line as a list item', () => {
  const doc = setup();
  applyOps(doc, [{ op: 'insert', parent: 'f1', index: 0, node: { id: 'ls', type: 'text', text: 'a\n\nb', style: { listStyle: 'decimal' } } }]);
  const html = serialize(renderFrame(doc, doc.frames[0], { mode: 'canvas', asset: () => undefined }), newSerializeState('inline'));
  assert.match(html, /list-style-type:decimal/);
  assert.equal((html.match(/display:list-item/g) ?? []).length, 3);
  assert.equal(validateNodeInput({ type: 'text', text: 'x', style: { listStyle: 'disc' } }).ok ?? true, true);
});

test('border width can be set per side', () => {
  const doc = setup();
  const box = (id: string, border: object) => ({ op: 'insert' as const, parent: 'f1', index: 0, node: validateNodeInput({ id, type: 'box', box: { border } }) as never });
  applyOps(doc, [box('b1', { width: 2, color: '#000' }), box('b2', { width: [1, 2, 3, 4], style: 'dashed', color: '#000' }), box('b3', { width: [1, 2], sides: ['top', 'left'] })]);
  const html = serialize(renderFrame(doc, doc.frames[0], { mode: 'canvas', asset: () => undefined }), newSerializeState('inline'));
  assert.match(html, /border:2px solid #000/);
  assert.match(html, /border-style:dashed;border-color:#000;border-width:1px 2px 3px 4px/);
  assert.match(html, /border-width:1px 0 0 2px/);
});

test('自定义 CSS：渲染补充属性，拒绝与已有字段重复的属性', async () => {
  const { managedField } = await import('../src/core/customCss.ts');
  const n = validateNodeInput({ type: 'x', style: { opacity: 0.5, css: { 'mix-blend-mode': 'multiply', 'aspect-ratio': '16 / 9', 'outline-color': '{color.primary}' } } });
  const css = styleCss(n.style, {} as never);
  assert.ok(css.includes('opacity:0.5'));
  assert.ok(css.includes('mix-blend-mode:multiply'));
  assert.ok(css.includes('aspect-ratio:16 / 9'));
  assert.ok(css.includes('outline-color:var(--color-primary)'));
  // 与结构化字段重复（含简写 / 各边 / 浏览器前缀写法）
  for (const k of ['width', 'margin-top', 'padding-inline', 'border-left-color', 'border-top-left-radius', 'background-color', 'font-size', 'opacity', 'display', 'flex', 'gap', '-webkit-backdrop-filter', 'flex', 'flex-flow', '--color-primary', 'all'])
    assert.throws(() => validateNodeInput({ type: 'x', style: { css: { [k]: '1px' } } }), undefined, k);
  assert.equal(managedField('border-radius'), 'box.radius');
  assert.equal(managedField('outline'), undefined);
  assert.equal(managedField('scroll-margin-top'), undefined);
  // 注入与优先级
  for (const v of ['red;color:blue', 'url(x)', 'red !important', '"x"', '}'])
    assert.throws(() => validateNodeInput({ type: 'x', style: { css: { outline: v } } }), undefined, v);
  // 渲染端兜底：绕过校验混进来的重复属性也不输出
  assert.deepEqual(styleCss({ css: { width: '10px', outline: '0' } }, {} as never), ['outline:0']);
  // cursor：没有专门的面板字段，可写在 css 里；但不能与 style.cursor 同时设置
  assert.equal(managedField('cursor'), undefined);
  assert.ok(styleCss(validateNodeInput({ type: 'x', style: { css: { cursor: 'not-allowed' } } }).style, {} as never).includes('cursor:not-allowed'));
  assert.throws(() => validateNodeInput({ type: 'x', style: { cursor: 'pointer', css: { cursor: 'grab' } } }), /cursor/);
});

test('自定义 CSS 可用于交互状态并按 patch 整体替换', () => {
  const doc = setup();
  applyOps(doc, [{ op: 'insert', parent: 'f1', index: 0, node: { id: 'b', type: 'box', style: { css: { outline: '0' } }, states: { hover: { css: { outline: '2px solid red' } } } } }]);
  const r = updateOps(doc, 'b', { style: { css: { 'mix-blend-mode': 'multiply' } } }, 'user');
  applyOps(doc, r.ops);
  assert.deepEqual(resolveAddress(doc, 'b').target.node.style?.css, { 'mix-blend-mode': 'multiply' });
  assert.throws(() => updateOps(doc, 'b', { style: { css: { height: '1px' } } }, 'user'));
});

test('只有 AI 能写的布局字段：可写进自定义 CSS，但与 layout 只能设一处；用户可把它迁到 css', () => {
  // 面板里不能编辑的布局属性不再算“已占用”
  const n = validateNodeInput({ type: 'x', style: { css: { 'z-index': '3', overflow: 'hidden', top: '4px' } } });
  assert.ok(styleCss(n.style, {} as never).includes('z-index:3'));
  // 同一节点两处都设：插入与更新都拒绝
  assert.throws(() => validateNodeInput({ type: 'x', layout: { zIndex: 2 }, style: { css: { 'z-index': '3' } } }), /layout\.zIndex/);
  assert.throws(() => validateNodeInput({ type: 'x', layout: { top: 0 }, style: { css: { inset: '0' } } }), /layout\.top/);
  const doc = setup();
  applyOps(doc, [{ op: 'insert', parent: 'f1', index: 0, node: { id: 'b', type: 'box', layout: { zIndex: 2, overflow: 'scroll', gap: 8 } } }]);
  assert.throws(() => updateOps(doc, 'b', { style: { css: { 'z-index': '5' } } }, 'user'), /layout\.zIndex/);
  // 用户不能改写这些布局字段，但可以删除（迁到 css）
  assert.throws(() => updateOps(doc, 'b', { layout: { zIndex: 3 } }, 'user'), /用户不能修改/);
  const r = updateOps(doc, 'b', { layout: { zIndex: null, overflow: null }, style: { css: { 'z-index': '5', overflow: 'auto' } } }, 'user');
  checkUserOps(r.ops, doc);
  applyOps(doc, r.ops);
  const node = resolveAddress(doc, 'b').target.node;
  assert.deepEqual(node.layout, { gap: 8 });
  assert.deepEqual(node.style?.css, { 'z-index': '5', overflow: 'auto' });
  // 渲染兜底：两处都有时布局字段优先，css 里的重复项不输出
  assert.deepEqual(styleCss({ css: { 'z-index': '9', outline: '0' } }, {} as never, { zIndex: 1 }), ['outline:0']);
});

test('export: button nodes render as <button type>, never nested', () => {
  const doc = setup();
  const p = insertOps(doc, 'f1', undefined, [
    validateNodeInput({
      type: 'button-group',
      layout: { direction: 'row' },
      children: [
        { type: 'submit-btn', text: '登录', props: { buttonType: 'submit' } },
        { type: 'PrimaryButton', children: [{ type: 'icon-button', text: 'x' }] },
        { type: 'link-button', text: '去注册', props: { href: 'https://example.com' } },
      ],
    }),
  ]);
  applyOps(doc, p.ops);
  const html = serialize(renderFrame(doc, doc.frames[0], { mode: 'export', asset: () => undefined }), newSerializeState('inline'));
  assert.match(html, /<button type="submit"[^>]*>登录<\/button>/);
  assert.equal((html.match(/<button/g) ?? []).length, 2); // 组容器、嵌套按钮、链接按钮都不是 <button>
  assert.match(html, /<a href="https:\/\/example.com"[^>]*>去注册/);
  const canvas = serialize(renderFrame(doc, doc.frames[0], { mode: 'canvas', asset: () => undefined }), newSerializeState('inline'));
  assert.doesNotMatch(canvas, /<button/);
  assert.throws(() => validateNodeInput({ type: 'button', props: { buttonType: 'x' } }), /buttonType/);
});

test('style.textStyle: accepts the listed styles only and emits no CSS', () => {
  const n = validateNodeInput({ type: 'title', text: 'Hi', style: { textStyle: 'heading1', fontSize: 48 } });
  assert.equal(n.style?.textStyle, 'heading1');
  assert.deepEqual(styleCss({ textStyle: 'caption' }, { mode: 'export', asset: () => undefined }), []);
  assert.throws(() => validateNodeInput({ type: 'title', text: 'Hi', style: { textStyle: 'h1' } }), /textStyle/);
});

test('字体令牌与嵌入渐变 / 阴影的颜色令牌都渲染为 var()', async () => {
  const { styleCss, tokensCss } = await import('../src/core/render.ts');
  const { StyleSchema } = await import('../src/core/schema.ts');
  const opts = { mode: 'export' as const, asset: () => undefined };
  const style = { fontFamily: '{font.heading}', background: 'linear-gradient(90deg, {color.primary}, {color.accent})', shadow: '0 0 16px {color.primary}', color: '{color.fg}' };
  assert.ok(StyleSchema.safeParse(style).success);
  const css = styleCss(style, opts);
  assert.ok(css.includes('font-family:var(--font-heading)'), css.join(';'));
  assert.ok(css.includes('background:linear-gradient(90deg, var(--color-primary), var(--color-accent))'));
  assert.ok(css.includes('box-shadow:0 0 16px var(--color-primary)'));
  assert.ok(css.includes('color:var(--color-fg)'));
  assert.equal(styleCss({ fontFamily: 'Inter, PingFang SC' }, opts)[0], "font-family:'Inter', 'PingFang SC', sans-serif");
  assert.match(tokensCss({ 'font.heading': 'Noto Serif CJK SC, serif', 'color.primary': '#112233' }), /--font-heading:'Noto Serif CJK SC', serif;--color-primary:#112233/);
  for (const bad of ['red; position:fixed', 'linear-gradient({color.primary}; x)', '{color.primary', 'url(x)']) assert.ok(!StyleSchema.safeParse({ background: bad }).success, bad);
  assert.ok(!StyleSchema.safeParse({ transform: 'rotate({x.y})' }).success, '只有颜色、渐变、阴影可以嵌入令牌');
});

import { validateTweaks } from '../src/core/schema.ts';
import { buildExport } from '../src/server/export.ts';

test('tweaks: set_tweaks 可撤销，校验令牌存在，导出带调节面板', () => {
  const doc = emptyDoc('tw');
  doc.tokens = { 'color.primary': '#4f46e5', 'radius.md': '8px' };
  doc.frames.push({ id: 'f', name: 'F', width: 300, height: 'auto', root: { id: 'r', type: 'page', children: [] } });
  assert.throws(() => validateTweaks([{ id: 'a', label: 'A', token: 'nope', kind: 'color' }], doc.tokens));
  assert.throws(() => validateTweaks([{ id: 'a', label: 'A', token: 'radius.md', kind: 'range' }], doc.tokens));
  const tweaks = validateTweaks(
    [
      { id: 'c', label: '主色', token: 'color.primary', kind: 'color' },
      { id: 'r', label: '圆角', token: 'radius.md', kind: 'range', min: 0, max: 24, unit: 'px' },
    ],
    doc.tokens,
  );
  const inv = applyOps(doc, [{ op: 'set_tweaks', tweaks }]);
  assert.equal(doc.tweaks?.length, 2);
  const html = buildExport(doc, '/tmp', {}).data.toString('utf8');
  assert.match(html, /id="dm-tw"/);
  assert.match(buildExport(doc, '/tmp', { interactive: false }).data.toString('utf8'), /^(?![\s\S]*dm-tw)/);
  applyOps(doc, inv);
  assert.equal(doc.tweaks, undefined);
});
