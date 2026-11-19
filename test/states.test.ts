import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, emptyDoc } from '../src/core/doc.ts';
import { insertOps } from '../src/core/edit.ts';
import { validateNodeInput } from '../src/core/schema.ts';
import { entryFrame, exploreFrame, isDocFrame, lintProto, pageFrames, stateAfter } from '../src/core/states.ts';
import type { DesignDoc } from '../src/core/types.ts';

function loginDoc(): DesignDoc {
  const doc = emptyDoc('c1');
  applyOps(doc, [
    { op: 'frame_create', index: 0, frame: { id: 'f1', name: 'Login', width: 390, height: 844, root: { id: 'f1', type: 'page', proto: { vars: { tab: 'pwd', phone: '', sec: 0 } } } } },
    { op: 'frame_create', index: 1, frame: { id: 'home', name: 'Home', width: 390, height: 844, root: { id: 'home', type: 'page' } } },
  ]);
  const tree = validateNodeInput({
    type: 'box',
    children: [
      { type: 'tab', id: 't_pwd', text: '密码登录', proto: { onClick: [{ do: 'set', var: 'tab', value: 'pwd' }] } },
      { type: 'tab', id: 't_sms', text: '短信登录', proto: { onClick: [{ do: 'set', var: 'tab', value: 'sms' }] } },
      {
        type: 'panel',
        id: 'p_sms',
        proto: { show: "tab == 'sms'" },
        children: [
          { type: 'input', id: 'in_phone', render: 'input', proto: { bind: 'phone' } },
          { type: 'button', id: 'b_code', text: "{{sec > 0 ? sec + 's' : '获取验证码'}}", proto: { disabled: 'sec > 0 || len(phone) != 11', onClick: [{ do: 'countdown', var: 'sec', from: 60 }] } },
        ],
      },
      { type: 'button', id: 'b_go', text: '登录', proto: { onClick: [{ do: 'navigate', frame: 'home' }] } },
      { type: 'text', id: 'never', text: 'x', proto: { show: 'tab == "qr"' } },
    ],
  });
  applyOps(doc, insertOps(doc, 'f1', undefined, [tree]).ops);
  return doc;
}

test('exploreFrame enumerates click / input / timer states and exits', () => {
  const doc = loginDoc();
  const ex = exploreFrame(doc, 'f1');
  assert.ok(ex.interactive);
  const tabs = ex.states.map((s) => s.vars.tab);
  assert.ok(tabs.includes('sms'));
  // 输入 11 位手机号后能点获取验证码，进入倒计时，再等待结束
  const counting = ex.states.find((s) => s.vars.sec === 60);
  assert.ok(counting, 'countdown state reached');
  assert.deepEqual(counting!.timers, ['等待 sec 倒计时结束']);
  assert.deepEqual(counting!.path.map((p) => p.kind), ['click', 'input', 'click']);
  assert.ok(ex.exits.some((e) => e.nav.kind === 'navigate' && e.nav.frame === 'home'));
  assert.deepEqual(ex.unreachable.map((u) => u.addr), ['never']);
  // 深度 2 内到不了倒计时
  assert.ok(!exploreFrame(doc, 'f1', { maxDepth: 2 }).states.some((s) => s.vars.sec === 60));
});

test('exploreFrame 输入取比较两侧的长度：超长报错态与合法可提交态都能到达', () => {
  const doc = emptyDoc('c1');
  applyOps(doc, [{ op: 'frame_create', index: 0, frame: { id: 'f1', name: 'Publish', width: 390, height: 844, root: { id: 'f1', type: 'page', proto: { vars: { title: '', done: false } } } } }]);
  const tree = validateNodeInput({
    type: 'form',
    children: [
      { type: 'input', id: 'in_title', render: 'input', proto: { bind: 'title' } },
      { type: 'text', id: 'err', text: '标题最多 20 个字', proto: { show: 'len(title) > 20' } },
      { type: 'button', id: 'b_submit', text: '发布', proto: { disabled: 'len(title) == 0 || len(title) > 20', onClick: [{ do: 'set', var: 'done', value: true }] } },
      { type: 'text', id: 'toast', text: '发布成功', proto: { show: 'done' } },
    ],
  });
  applyOps(doc, insertOps(doc, 'f1', undefined, [tree]).ops);
  const ex = exploreFrame(doc, 'f1');
  const lens = new Set(ex.states.map((s) => String(s.vars.title).length));
  assert.ok(lens.has(21) && lens.has(20), `试过 20 与 21 个字：${[...lens]}`);
  assert.ok(ex.states.some((s) => s.vars.done === true), '合法标题下能点发布');
  assert.deepEqual(ex.unreachable, []);
});

test('stateAfter follows clicks and rejects hidden / disabled targets', () => {
  const doc = loginDoc();
  assert.equal(stateAfter(doc, 'f1', ['t_sms']).vars.tab, 'sms');
  assert.throws(() => stateAfter(doc, 'f1', ['b_code']), /不可见/);
  assert.throws(() => stateAfter(doc, 'f1', ['t_sms', 'b_code']), /禁用/);
  assert.deepEqual(stateAfter(doc, 'f1', ['b_go']).nav, { kind: 'navigate', frame: 'home' });
});

test('lintProto reports dead links and undeclared vars', () => {
  const doc = loginDoc();
  assert.deepEqual(lintProto(doc), []);
  applyOps(doc, insertOps(doc, 'f1', undefined, [validateNodeInput({ type: 'button', id: 'b_bad', text: '{{count}}', props: { href: '#nope' }, proto: { onClick: [{ do: 'toggle', var: 'open' }] } })]).ops);
  const w = lintProto(doc).map((x) => `${x.id}:${x.kind}`).sort();
  assert.deepEqual(w, ['b_bad:dead_link', 'b_bad:undeclared_var', 'b_bad:undeclared_var']);
});

test('预览：说明画板不是页面，入口页取不被其他页面跳入的第一个页面', () => {
  const doc = emptyDoc('c2');
  const page = (id: string, name: string, children: any[] = []) => ({ op: 'frame_create' as const, index: doc.frames.length, frame: { id, name, width: 390, height: 844 as const, root: { id, type: 'page', children } } });
  applyOps(doc, [page('flow', '业务流程与说明', [{ id: 'c1', type: 'card', props: { href: '#login' } }, { id: 'c2', type: 'card', props: { href: '#home' } }])]);
  applyOps(doc, [page('home', 'Home', [{ id: 'out', type: 'button', proto: { onClick: [{ do: 'navigate', frame: 'login' }] } }])]);
  applyOps(doc, [page('detail', 'Detail', [{ id: 'bk', type: 'button', props: { href: '#home' } }])]);
  applyOps(doc, [page('login', 'Login', [{ id: 'go', type: 'button', props: { href: '#home' } }])]);
  assert.equal(isDocFrame(doc.frames[0]), true);
  assert.deepEqual(pageFrames(doc).map((f) => f.id), ['home', 'detail', 'login']);
  // home、login 都被跳入；detail 没有入口链接 → 第一个不被跳入的页面
  assert.equal(entryFrame(doc)?.id, 'detail');
  // 页面互相可达时退回第一个页面画板（跳过说明画板）
  applyOps(doc, [{ op: 'frame_remove', id: 'detail' }]);
  assert.equal(entryFrame(doc)?.id, 'home');
  applyOps(doc, [{ op: 'frame_remove', id: 'home' }, { op: 'frame_remove', id: 'login' }]);
  assert.equal(entryFrame(doc), undefined);
});
