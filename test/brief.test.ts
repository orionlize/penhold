import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-brief-'));
process.env.DESIGN_MCP_HOME = home;

const { Canvas } = await import('../src/server/canvas/canvas.ts');
const { AUTO, briefRecord, customBriefForm, defaultBriefForm, DIRECTION_Q } = await import('../src/server/design/brief.ts');
const { suggestDirections } = await import('../src/server/design/directions.ts');

const cards = suggestDirections({ brief: '移动端登录页', seed: 4 });

test('默认问卷按页面类型给出内容选项，并带视觉方向卡片', () => {
  const f = defaultBriefForm({ brief: '移动端登录页', cards });
  const ids = f.questions.map((q) => q.id);
  assert.deepEqual(ids, ['product', DIRECTION_Q, 'color', 'tone', 'content', 'reference', 'extra']);
  const dir = f.questions.find((q) => q.id === DIRECTION_Q)!;
  assert.equal(dir.options!.length, 4, '3 张卡片 + 让 AI 决定');
  assert.equal(dir.options![3].value, AUTO);
  assert.equal(dir.options![0].swatch!.length, 4);
  assert.ok(dir.reroll);
  const content = f.questions.find((q) => q.id === 'content')!;
  assert.equal(content.kind, 'multi');
  assert.ok(content.options!.some((o) => /验证码/.test(o.label)));

  const g = defaultBriefForm({ brief: '做个东西', cards: [] });
  assert.ok(g.questions.some((q) => q.id === 'platform'), '没提到设备时询问');
  assert.ok(!g.questions.some((q) => q.id === DIRECTION_Q));
  assert.equal(g.questions.find((q) => q.id === 'content')!.kind, 'text');
});

test('对话里已说清产品与内容时，默认问卷只问视觉偏好', () => {
  const f = defaultBriefForm({ brief: 'penhold-mcp 官网首页', cards, known: 'penhold-mcp 的官网首页：介绍本地 AI 设计画布与安装方式' });
  assert.deepEqual(f.questions.map((q) => q.id), [DIRECTION_Q, 'color', 'tone', 'reference', 'extra']);
  assert.match(f.intro!, /已了解需求/);
});

test('自定义问题：补全 id、字符串选项，附上方向题', () => {
  const f = customBriefForm({ questions: [{ label: '登录方式？', kind: 'multi', options: ['验证码', { label: '密码', hint: '账号 + 密码' }] }, { id: 'direction', label: '备注', kind: 'text' }] }, cards);
  assert.deepEqual(f.questions.map((q) => q.id), ['q1', 'q2', DIRECTION_Q]);
  assert.deepEqual(f.questions[0].options, [{ value: '验证码', label: '验证码' }, { value: '密码', label: '密码', hint: '账号 + 密码' }]);
});

test('整理答案：去掉空值与“不限”，全空视为跳过', () => {
  const f = defaultBriefForm({ brief: '登录页', cards });
  const r = briefRecord(f, { product: '  二手书 App ', color: AUTO, tone: '深色', content: ['注册入口', '指纹登录'], extra: '' });
  assert.deepEqual(r.answers.map((a) => [a.id, a.answer]), [['product', '二手书 App'], ['tone', '深色'], ['content', ['注册入口', '指纹登录']]]);
  assert.ok(!r.skipped);
  assert.ok(briefRecord(f, { color: AUTO }).skipped);
  assert.ok(briefRecord(f, { product: 'x' }, true).skipped);
});

test('画布：提问 → 等待 → 用户提交后记录回答与所选方向', async () => {
  const c = new Canvas('55555555-2222-4333-8444-555555555555', { title: '登录页', cwd: '/x' });
  const sent: Array<{ t: string }> = [];
  c.broadcast = (m) => void sent.push(m);
  const form = defaultBriefForm({ brief: '登录页', cards });
  c.askBrief(form, (f) => ({ ...f, title: '换过一批' }));
  assert.equal(sent.at(-1)!.t, 'brief');
  assert.equal(await c.waitBrief(20), false, '未回答时超时返回 false，问卷保留');
  assert.ok(c.briefForm);

  c.submitBrief('wrong-id', { product: 'x' });
  assert.ok(c.briefForm, 'id 不符的提交被忽略');

  const waiting = c.waitBrief(5000);
  c.submitBrief(form.id, { product: '二手书 App', [DIRECTION_Q]: cards[1].id, content: ['注册入口'] });
  assert.equal(await waiting, true);
  assert.equal(c.briefForm, null);
  assert.equal(c.meta.direction?.id, cards[1].id);
  assert.equal(c.meta.brief!.answers.find((a) => a.id === DIRECTION_Q)!.answer, cards[1].name);
  const saved = JSON.parse(fs.readFileSync(path.join(c.dir, 'session.json'), 'utf8'));
  assert.equal(saved.brief.answers[0].answer, '二手书 App');
  assert.equal(await c.waitBrief(10), true, '没有待答问卷时立即返回');
});

test('画布：跳过问卷、选“让 AI 决定”都不记录方向', () => {
  const c = new Canvas('66666666-2222-4333-8444-555555555555', { title: 't', cwd: '/x' });
  c.broadcast = () => {};
  let f = defaultBriefForm({ brief: '登录页', cards });
  c.askBrief(f);
  c.submitBrief(f.id, {}, true);
  assert.ok(c.meta.brief!.skipped);
  assert.equal(c.meta.direction, undefined);
  f = defaultBriefForm({ brief: '登录页', cards });
  c.askBrief(f);
  c.submitBrief(f.id, { product: 'x', [DIRECTION_Q]: AUTO });
  assert.equal(c.meta.direction, undefined);
  assert.deepEqual(c.meta.brief!.answers.map((a) => a.id), ['product']);
});

test('主色题可多选，回答整理成多套配色', async () => {
  const { colorSchemes, COLOR_Q } = await import('../src/server/design/brief.ts');
  const f = defaultBriefForm({ brief: '登录页', cards });
  const q = f.questions.find((x) => x.id === COLOR_Q)!;
  assert.equal(q.kind, 'multi');
  assert.ok(q.other);
  const r = briefRecord(f, { color: ['蓝色', '绿色', '#ff6a00 和 墨绿'] });
  const a = r.answers.find((x) => x.id === COLOR_Q)!;
  assert.deepEqual(a.answer, ['蓝', '绿', '#ff6a00 和 墨绿']);
  const s = colorSchemes(a.answer);
  assert.deepEqual(s.map((x) => x.id), ['blue', 'green', 'cff6a00']);
  assert.equal(s[2].primary, '#FF6A00');
  assert.deepEqual(colorSchemes('墨绿、紫').map((x) => x.id), ['green', 'purple']);
  assert.deepEqual(colorSchemes(undefined), []);
});
