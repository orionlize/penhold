import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-test-'));
process.env.DESIGN_MCP_HOME = home;
process.env.DESIGN_MCP_LOCK_IDLE_MS = '200';
process.env.DESIGN_MCP_PLAN_IDLE_MS = '400';
const { Canvas } = await import('../src/server/canvas.ts');
const { insertOps, updateOps } = await import('../src/core/edit.ts');
const { validateNodeInput } = await import('../src/core/schema.ts');
const { buildExport } = await import('../src/server/export.ts');

const ID = '11111111-2222-4333-8444-555555555555';

test('log replay recovers transactions not yet in design.json', async () => {
  const c = new Canvas(ID, { title: 't', cwd: '/x' });
  await c.acquireLock('s1');
  c.commit('ai', [{ op: 'frame_create', index: 0, frame: { id: 'f1', name: 'F', width: 400, height: 'auto', root: { id: 'f1', type: 'page' } } }], { session: 's1' });
  const prep = insertOps(c.doc, 'f1', undefined, [validateNodeInput({ type: 'button', component: 'Btn', text: 'Go', box: { height: 40 } })]);
  c.commit('ai', prep.ops, { session: 's1' });
  assert.deepEqual([...c.pendingCheck], ['f1']);
  c.markChecked(['f1']);
  assert.equal(c.lock, null, '自检完成后释放编辑锁');
  // 用户改动
  const u = updateOps(c.doc, prep.nodes[0].id, { style: { color: '#f00' } }, 'user');
  c.commit('user', u.ops);
  const rev = c.doc.rev;
  // 模拟崩溃：不调用 flush/close，design.json 尚未写入
  c.releaseDirLock();
  const c2 = new Canvas(ID);
  assert.equal(c2.doc.rev, rev);
  assert.equal(c2.doc.components.Btn.root.style?.color, '#f00');
  assert.deepEqual(c2.changesSince(rev - 1, 'user')[0].fields, ['style.color']);
  // 撤销栈随日志恢复
  c2.undo();
  assert.equal(c2.doc.components.Btn.root.style?.color, undefined);
  c2.close();
});

test('user writes are rejected while AI holds the lock; lock times out', async () => {
  const c = new Canvas(ID);
  await c.acquireLock('s2');
  const u = updateOps(c.doc, 'cmp_Btn', { text: 'x' }, 'user');
  assert.throws(() => c.commit('user', u.ops), /AI 正在修改/);
  await assert.rejects(c.acquireLock('other'), /另一会话/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(c.lock, null);
  c.commit('user', u.ops);
  // 用户不能改布局
  assert.throws(() => c.commit('user', [{ op: 'set', id: 'cmp_Btn', field: 'layout', value: { zIndex: 1 } }]), /仅 AI 可写/);
  c.close();
});

test('export: single file, no scripts, fonts listed, tokens as CSS vars', () => {
  const c = new Canvas(ID);
  const r = buildExport(c.doc, c.dir, {});
  const html = r.data.toString();
  assert.match(html, /<!DOCTYPE html>/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /data-node-id/);
  assert.match(html, />x</);
  c.close();
});

test('user can delete frame nodes and frames; undo restores', () => {
  const c = new Canvas('22222222-2222-4333-8444-555555555555', { title: 'del', cwd: '/x' });
  c.commit('user', [{ op: 'frame_create', index: 0, frame: { id: 'fd', name: 'F', width: 400, height: 300, root: { id: 'fd', type: 'page' } } }]);
  c.commit('user', [{ op: 'insert', parent: 'fd', index: 0, node: { id: 'n_t', type: 'text', text: 'hi' } }]);
  assert.throws(() => c.commit('user', [{ op: 'remove', id: 'fd' }]), /画板根节点/);
  assert.throws(() => c.commit('user', [{ op: 'remove', id: 'n_missing' }]), /不存在/);
  c.commit('user', [{ op: 'remove', id: 'n_t' }]);
  assert.equal(c.doc.frames[0].root.children?.length ?? 0, 0);
  c.undo();
  assert.equal(c.doc.frames[0].root.children?.[0].id, 'n_t');
  c.commit('user', [{ op: 'frame_remove', id: 'fd' }]);
  assert.equal(c.doc.frames.length, 0);
  c.close();
});

test('design plan: skeleton pages, statuses, cursor, lock held until all planned pages are drawn', async () => {
  const c = new Canvas('33333333-2222-4333-8444-555555555555', { title: 'plan', cwd: '/x' });
  await c.acquireLock('s');
  const pages = c.applyPlan('s', [
    { name: '登录', width: 390, sections: ['导航', '表单'] },
    { name: '首页', width: 390 },
    { name: '我的', width: 390 },
  ]);
  assert.equal(c.doc.frames.length, 3);
  assert.deepEqual(pages.map((p) => p.status), ['pending', 'pending', 'pending']);
  assert.ok(pages.every((p) => p.empty));
  assert.deepEqual(pages[0].sections, ['导航', '表单']);
  assert.equal(c.pendingCheck.size, 0, '建空画板不要求自检');
  const [a, b, d] = pages.map((p) => p.frame);

  // 画第一页：状态与光标
  const prep = insertOps(c.doc, a, undefined, [validateNodeInput({ type: 'nav', text: 'hi' })]);
  c.commit('ai', prep.ops, { session: 's', note: '顶部导航' });
  let info = c.lockInfo()!;
  assert.deepEqual(info.pages!.map((p) => p.status), ['drawing', 'pending', 'pending']);
  assert.equal(info.cursor?.frame, a);
  assert.equal(info.cursor?.addr, prep.nodes[0].id);
  assert.equal(info.cursor?.note, '顶部导航');

  // 第一页自检后锁不释放（还有规划页未开始）
  c.markChecked([a]);
  assert.ok(c.lock, '规划页未画完时不释放锁');
  assert.equal(c.lockInfo()!.pages![0].status, 'done');

  // 重新规划：去掉“我的”（空画板被删除），保留首页
  c.applyPlan('s', [{ frame_id: a, name: '登录' }, { frame_id: b, name: '首页 v2' }]);
  assert.ok(!c.doc.frames.some((f) => f.id === d));
  assert.equal(c.doc.frames.find((f) => f.id === b)?.name, '首页 v2');

  // 画第二页后第一页状态不受影响
  const p2 = insertOps(c.doc, b, undefined, [validateNodeInput({ type: 'card', text: 'x' })]);
  c.commit('ai', p2.ops, { session: 's' });
  info = c.lockInfo()!;
  assert.deepEqual(info.pages!.map((p) => p.status), ['done', 'drawing']);
  assert.equal(info.cursor?.note, undefined);
  c.markChecked([b]);
  assert.equal(c.lock, null, '全部画完并自检后释放锁');
  c.close();
});

test('design plan: unfinished empty planned pages are removed when the lock ends', async () => {
  const c = new Canvas('44444444-2222-4333-8444-555555555555', { title: 'plan2', cwd: '/x' });
  await c.acquireLock('s');
  const [p1, p2] = c.applyPlan('s', [
    { name: 'A', width: 390 },
    { name: 'B', width: 390 },
  ]);
  const prep = insertOps(c.doc, p1.frame, undefined, [validateNodeInput({ type: 't', text: 'a' })]);
  c.commit('ai', prep.ops, { session: 's' });
  c.releaseLock('user');
  assert.deepEqual(c.doc.frames.map((f) => f.id), [p1.frame], '空的规划画板被删除，画过的保留');
  assert.ok(!c.doc.frames.some((f) => f.id === p2.frame));
  c.close();
});

test('design plan: a started-but-empty planned page survives a slow retry after a failed insert', async () => {
  const c = new Canvas('55555555-2222-4333-8444-555555555555', { title: 'plan3', cwd: '/x' });
  await c.acquireLock('s');
  const [p] = c.applyPlan('s', [{ name: '登录', width: 390 }]);
  // 先设根节点背景：页面算“已开始”，但仍没有子节点
  const u = updateOps(c.doc, p.frame, { style: { background: '#fff' } }, 'ai');
  c.commit('ai', u.ops, { session: 's' });
  // 插入报错后 AI 重新生成内容：超过普通空闲超时（200ms）也不应释放锁
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(c.lock, '规划页仍为空时使用较长的空闲超时');
  // 即使最终超时，已开始绘制的画板也保留
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(c.lock, null);
  assert.ok(c.doc.frames.some((f) => f.id === p.frame), '超时不回收已开始绘制的规划画板');
  c.close();
});

test('design plan: idle timeout keeps untouched planned pages; the plan resumes on the next write and is cleaned up when the session ends', async () => {
  const c = new Canvas('88888888-2222-4333-8444-555555555555', { title: 'plan4', cwd: '/x' });
  await c.acquireLock('s');
  const [p1, p2] = c.applyPlan('s', [
    { name: 'A', width: 390, sections: ['头部'] },
    { name: 'B', width: 390 },
  ]);
  // AI 读规范 / 生成首屏内容超过规划空闲超时（400ms）：锁释放，但空画板不回收
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(c.lock, null);
  assert.deepEqual(c.doc.frames.map((f) => f.id), [p1.frame, p2.frame], '超时不回收尚未开始的规划画板');
  // 同一会话再次写入：规划恢复
  await c.acquireLock('s');
  assert.deepEqual(c.planPages().map((p) => [p.frame, p.status]), [[p1.frame, 'pending'], [p2.frame, 'pending']]);
  assert.deepEqual(c.planPages()[0].sections, ['头部']);
  const prep = insertOps(c.doc, p1.frame, undefined, [validateNodeInput({ type: 't', text: 'a' })]);
  c.commit('ai', prep.ops, { session: 's' });
  // 再次超时后会话结束：仍为空的规划画板被清理，画过的保留
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(c.lock, null);
  assert.ok(c.doc.frames.some((f) => f.id === p2.frame));
  c.dropSuspended('s');
  assert.deepEqual(c.doc.frames.map((f) => f.id), [p1.frame]);
  assert.equal(c.lock, null);
  c.close();
});

test('design plan: another session taking over drops the suspended empty pages', async () => {
  const c = new Canvas('77777777-2222-4333-8444-555555555555', { title: 'plan5', cwd: '/x' });
  await c.acquireLock('s');
  const [p] = c.applyPlan('s', [{ name: 'A', width: 390 }]);
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(c.doc.frames.some((f) => f.id === p.frame));
  await c.acquireLock('other');
  assert.ok(!c.doc.frames.some((f) => f.id === p.frame));
  assert.equal(c.lock?.session, 'other');
  c.releaseLock('user');
  c.close();
});

test('design plan: after an idle timeout the plan stays visible, and re-planning reuses the empty frames instead of recreating them', async () => {
  const c = new Canvas('99999999-2222-4333-8444-555555555555', { title: 'plan6', cwd: '/x' });
  const sent: Array<{ t: string; lock?: unknown; pages?: Array<{ frame: string; status: string; empty: boolean }> }> = [];
  c.clients.add({ readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) } as never);
  await c.acquireLock('s');
  const [p1, p2] = c.applyPlan('s', [
    { name: 'A', width: 390 },
    { name: 'B', width: 390 },
  ]);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(c.lock, null);
  // 画布仍收到规划页面：骨架屏不消失
  const last = sent.filter((m) => m.t === 'lock').at(-1)!;
  assert.equal(last.lock, null);
  assert.deepEqual(last.pages?.map((p) => [p.frame, p.status, p.empty]), [[p1.frame, 'pending', true], [p2.frame, 'pending', true]]);
  // AI 查状态时仍能看到自己的规划
  assert.equal(c.planOwner(), 's');
  assert.deepEqual(c.planPages().map((p) => p.frame), [p1.frame, p2.frame]);
  // AI 以为画板没了而重新规划：同名空画板沿用原 id，不删不建；不在新规划里的才删除
  await c.acquireLock('s');
  const rev = c.doc.rev;
  const again = c.applyPlan('s', [{ name: 'A', width: 390 }, { name: 'C', width: 390 }]);
  assert.equal(again[0].frame, p1.frame, '同名空画板沿用原 frame_id');
  assert.ok(!c.doc.frames.some((f) => f.id === p2.frame));
  assert.equal(c.doc.frames.length, 2);
  // 完全相同的规划不产生任何改动
  c.applyPlan('s', [{ name: 'A', width: 390 }, { name: 'C', width: 390 }]);
  assert.equal(c.doc.rev, rev + 1);
  c.releaseLock('user');
  assert.equal(sent.filter((m) => m.t === 'lock').at(-1)!.pages, undefined);
  c.close();
});

test('design plan: self-checking a page whose root is styled but still empty does not end the round and delete it', async () => {
  const c = new Canvas('aaaaaaaa-2222-4333-8444-555555555555', { title: 'plan7', cwd: '/x' });
  await c.acquireLock('s');
  const [p] = c.applyPlan('s', [{ name: '登录', width: 390 }]);
  c.commit('ai', updateOps(c.doc, p.frame, { style: { background: '#fff' } }, 'ai').ops, { session: 's' });
  c.markChecked([p.frame]);
  assert.ok(c.lock, '规划页还没有内容时不释放锁');
  assert.ok(c.doc.frames.some((f) => f.id === p.frame));
  assert.deepEqual(c.planOutstanding(), [p.frame]);
  c.commit('ai', insertOps(c.doc, p.frame, undefined, [validateNodeInput({ type: 't', text: 'a' })]).ops, { session: 's' });
  c.markChecked([p.frame]);
  assert.equal(c.lock, null);
  c.close();
});

test('missingNotesHint: reminds about UI frames without AI interaction notes', async () => {
  const { missingNotesHint } = await import('../src/server/mcp.ts');
  const c = new Canvas('66666666-2222-4333-8444-555555555555', { title: 'n', cwd: '/x' });
  await c.acquireLock('s');
  c.commit('ai', [
    { op: 'frame_create', index: 0, frame: { id: 'fa', name: '登录', width: 390, height: 'auto', root: { id: 'fa', type: 'page' } } },
    { op: 'frame_create', index: 1, frame: { id: 'fb', name: '注册', width: 390, height: 'auto', root: { id: 'fb', type: 'page' } } },
  ], { session: 's' });
  assert.match(missingNotesHint(c), /登录（fa）、注册（fb）/);
  c.putNote({ id: 'a_note1', kind: 'rect', by: 'ai', frame: 'fa', pts: [[0, -200], [390, -60]], text: '登录说明', ts: 1 });
  c.putNote({ id: 'a_oldnote', kind: 'rect', by: 'ai', frame: 'f_gone', pts: [[0, -200], [390, -60]], text: '旧', ts: 1 });
  const h = missingNotesHint(c);
  assert.ok(!h.includes('（fa）') && h.includes('（fb）'));
  assert.match(h, /1 条旧说明/);
  // 只有箭头不算说明
  c.putNote({ id: 'a_arrow1', kind: 'arrow', by: 'ai', frame: 'fb', pts: [[390, 300], [510, 300]], ts: 1 });
  assert.ok(missingNotesHint(c).includes('（fb）'));
  c.putNote({ id: 'a_note2', kind: 'rect', by: 'ai', frame: 'fb', pts: [[0, -200], [390, -60]], text: '注册说明', ts: 1 });
  assert.equal(missingNotesHint(c), '');
  c.close();
});

test('design_annotate: AI notes are tagged, cross-frame arrows convert coordinates, user notes are protected', async () => {
  const { applyAnnotations } = await import('../src/server/annotate.ts');
  const c = new Canvas('22222222-2222-4333-8444-555555555555', { title: 'a', cwd: '/x' });
  await c.acquireLock('s1');
  c.commit('ai', [
    { op: 'frame_create', index: 0, frame: { id: 'f1', name: 'A', width: 390, height: 'auto', root: { id: 'f1', type: 'page' } } },
    { op: 'frame_create', index: 1, frame: { id: 'f2', name: 'B', width: 390, height: 'auto', root: { id: 'f2', type: 'page' } } },
  ], { session: 's1' });
  c.putNote({ id: 'a_user1', kind: 'note', frame: 'f1', pts: [[0, 0]], text: 'user', ts: 1 });
  const r = applyAnnotations(c, {
    add: [
      { kind: 'rect', frame: 'f1', at: [0, -60], width: 390, text: '登录页：手机号 + 验证码' },
      { kind: 'arrow', frame: 'f1', from: [390, 300], to: { frame: 'f2', x: 0, y: 300 }, dash: 'dashed' },
    ],
  });
  assert.equal(r.written.length, 2);
  assert.deepEqual(r.frame_layout.map((f) => f.x), [0, 510]);
  const box = c.notes.find((n) => n.id === r.written[0].id)!;
  assert.equal(box.kind, 'rect');
  assert.ok(box.pts[1][1] <= -40, '说明框底边让出画板标题与工具栏');
  assert.ok(r.written[0].warnings?.[0].includes('上移'));
  const inside = applyAnnotations(c, { add: [{ kind: 'note', frame: 'f2', at: [10, 100], text: '盖住界面' }] });
  assert.equal(c.notes.find((n) => n.id === inside.written[0].id)!.kind, 'rect', 'note 为 rect 的别名');
  assert.ok(inside.written[0].warnings?.some((w) => w.includes('遮挡')));
  applyAnnotations(c, { remove: [inside.written[0].id] });
  const arrow = c.notes.find((n) => n.id === r.written[1].id)!;
  assert.equal(arrow.by, 'ai');
  assert.deepEqual(arrow.pts, [[390, 300], [510, 300]], '跨画板终点换算到起点画板的坐标');
  // 更新自己的批注
  applyAnnotations(c, { add: [{ id: r.written[0].id, kind: 'rect', frame: 'f1', at: [0, -160], text: '改' }] });
  assert.equal(c.notes.find((n) => n.id === r.written[0].id)!.text, '改');
  // 不能改删用户批注
  assert.throws(() => applyAnnotations(c, { remove: ['a_user1'] }), /用户/);
  assert.throws(() => applyAnnotations(c, { add: [{ id: 'a_user1', kind: 'note', at: [0, 0], text: 'x' }] }), /用户/);
  assert.throws(() => applyAnnotations(c, { add: [{ kind: 'note', frame: 'nope', at: [0, 0], text: 'x' }] }), /不存在/);
  // clear 只清 AI 批注
  const cl = applyAnnotations(c, { clear: true });
  assert.equal(cl.removed?.length, 2);
  assert.deepEqual(c.notes.map((n) => n.id), ['a_user1']);
  c.close();
});

test('design_annotate resolve: closes user comments only after the frame is self-checked', async () => {
  const { applyAnnotations } = await import('../src/server/annotate.ts');
  const c = new Canvas('22222222-2222-4333-8444-666666666666', { title: 'r', cwd: '/x' });
  await c.acquireLock('s1');
  c.commit('ai', [{ op: 'frame_create', index: 0, frame: { id: 'f1', name: 'A', width: 390, height: 'auto', root: { id: 'f1', type: 'page' } } }], { session: 's1' });
  c.putNote({ id: 'a_cmt1', kind: 'comment', frame: 'f1', pts: [[10, 10]], text: '按钮换成主色', ts: 1 });
  c.putNote({ id: 'a_cmt2', kind: 'comment', frame: 'f1', pts: [[20, 20]], text: '标题加大', ts: 1 });
  const [n1, n2] = c.notes.map((n) => n.n!);
  // 画板还没自检：拒绝关闭
  assert.throws(() => applyAnnotations(c, { resolve: [n1] }), /自检/);
  c.markChecked(['f1']);
  const r = applyAnnotations(c, { resolve: [n1] });
  assert.deepEqual(r.resolved_comments, [n1]);
  assert.deepEqual(c.notes.map((n) => n.id), ['a_cmt2']);
  assert.throws(() => applyAnnotations(c, { resolve: [99] }), new RegExp(`#${n2}`));
  c.close();
});

test('user baseline: first user edit records the prior value; reverting, undo and AI writes clear it; survives reload', async () => {
  const id = '11111111-2222-4333-8444-666666666666';
  const c = new Canvas(id, { title: 'b', cwd: '/x' });
  await c.acquireLock('s1');
  c.commit('ai', [{ op: 'frame_create', index: 0, frame: { id: 'fb', name: 'F', width: 400, height: 'auto', root: { id: 'fb', type: 'page' } } }], { session: 's1' });
  const ins = insertOps(c.doc, 'fb', undefined, [validateNodeInput({ type: 'card', style: { color: '#111' }, box: { border: { width: 1, color: '#ccc' } } })]);
  c.commit('ai', ins.ops, { session: 's1' });
  c.markChecked(['fb']);
  const nid = ins.nodes[0].id;
  const base = () => c.undoInfo().userBase;
  const edit = (p: Parameters<typeof updateOps>[2]) => c.commit('user', updateOps(c.doc, nid, p, 'user').ops);

  edit({ style: { color: '#222', background: '#fff' } });
  assert.deepEqual(base(), { [`${nid}.style.color`]: '#111', [`${nid}.style.background`]: null });
  edit({ style: { color: '#333' } });
  assert.equal(base()[`${nid}.style.color`], '#111', '基线保留首次修改前的值');
  edit({ style: { color: '#111' } });
  assert.equal(`${nid}.style.color` in base(), false, '改回基线即不算修改');
  c.undo();
  assert.equal(base()[`${nid}.style.color`], '#111', '撤销回到被改状态，基线仍在');
  // 重新打开：基线从 user_base.json + 日志恢复
  c.flush();
  c.close();
  const c2 = new Canvas(id);
  assert.deepEqual(c2.undoInfo().userBase, { [`${nid}.style.color`]: '#111', [`${nid}.style.background`]: null });
  // AI 写入后，以 AI 的值为新基线
  await c2.acquireLock('s2');
  c2.commit('ai', updateOps(c2.doc, nid, { style: { color: '#999' } }, 'ai').ops, { session: 's2' });
  assert.deepEqual(c2.undoInfo().userBase, { [`${nid}.style.background`]: null });
  c2.close();
});

test('set_theme 把系统的主题颜色写进画布并可撤销', async () => {
  const { saveSystem } = await import('../src/server/systems.ts');
  const { systemFromFlat, deriveTheme, flattenSystem } = await import('../src/core/designSystem.ts');
  const ds = systemFromFlat({ 'color.bg': '#ffffff', 'color.fg': '#111111', 'color.primary': '#4f46e5' }, { id: 'th-sys', name: 'Th', device: 'mobile' });
  deriveTheme(ds, 'light', { id: 'dark', name: '暗色' }, 'dark');
  saveSystem(ds);
  const c = new Canvas('99999999-2222-4333-8444-555555555555', { title: 't', cwd: '/x' });
  c.doc.tokens = flattenSystem(ds, 'light');
  c.meta.system = { id: 'th-sys', version: 1, theme: 'light', installedAt: 0 };
  assert.equal(c.themeInfo()?.themes.length, 2);
  c.setSystemTheme('dark');
  assert.equal(c.doc.tokens['color.bg'], flattenSystem(ds, 'dark')['color.bg']);
  assert.equal(c.meta.system.theme, 'dark');
  assert.throws(() => c.setSystemTheme('nope'));
  c.undo();
  assert.equal(c.doc.tokens['color.bg'], '#ffffff');
  c.close();
});
