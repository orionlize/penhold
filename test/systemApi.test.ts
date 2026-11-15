import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-sysapi-'));
process.env.DESIGN_MCP_HOME = home;
const { auditContrast, flattenSystem, lintSystem } = await import('../src/core/designSystem.ts');
const { blankSystem, createSystem, deleteSystem, detailForUi, listForUi, sanitizeSystem, setProjectDefault, starterCards, updateSystem } = await import('../src/server/systemApi.ts');
const { defaultSystem, loadSystem, saveSystem, systemDir } = await import('../src/server/systems.ts');
const { Registry } = await import('../src/server/registry.ts');

test('空白系统：亮暗两套主题，对比度与结构检查都通过', () => {
  for (const primary of [undefined, '#FACC15', '#111827', '#DB2777']) {
    const ds = blankSystem({ id: 'x', name: 'X', ...(primary ? { primary } : {}) });
    assert.deepEqual(ds.color.themes.map((t) => t.id), ['light', 'dark']);
    assert.deepEqual(auditContrast(ds), [], primary);
    assert.deepEqual(lintSystem(ds), [], primary);
    if (primary) assert.equal(ds.color.tokens.find((t) => t.name === 'primary')!.value.light.toUpperCase().length, 7);
  }
});

test('新建：空白、风格方向、粘贴 CSS、复制', () => {
  const blank = createSystem({ name: '我的系统', primary: '#7C3AED' });
  assert.equal(loadSystem(blank.id)!.name, '我的系统');
  assert.equal(blank.version, 1);
  assert.ok(fs.existsSync(path.join(systemDir(blank.id), 'README.md')));

  const cards = starterCards(7);
  assert.equal(cards.length, 5);
  const dir = createSystem({ from: 'direction', ref: cards[1].id, name: 'Dir', device: 'desktop' });
  assert.equal(dir.device, 'desktop');
  assert.equal(dir.color.themes.length, 2);
  assert.throws(() => createSystem({ from: 'direction', ref: 'nope/1' }), /失效/);

  const css = createSystem({ from: 'css', name: 'Shadcn', text: ':root{--background:0 0% 100%;--foreground:240 10% 4%;--primary:221 83% 53%;--radius:8px}.dark{--background:240 10% 4%;--foreground:0 0% 98%}' });
  assert.equal(flattenSystem(css)['color.bg'], '#FFFFFF');
  assert.deepEqual(css.color.themes.map((t) => t.id), ['light', 'dark']);
  assert.throws(() => createSystem({ from: 'css', text: 'body{color:red}' }), /CSS 变量/);
  assert.throws(() => createSystem({ from: 'json', text: '{' }), /JSON/);

  const copy = createSystem({ from: 'copy', ref: blank.id });
  assert.notEqual(copy.id, blank.id);
  assert.equal(copy.name, '我的系统 副本');
  assert.deepEqual(copy.color, blank.color);
});

test('保存校验：拒绝非法取值，组件结构只取自原系统', () => {
  const prev = saveSystem({ ...blankSystem({ id: 'val-1', name: 'V' }), components: { Btn: { name: 'Btn', root: { id: 'b', type: 'button', text: 'Go' }, usage: '主按钮' } } }, false);
  const input = structuredClone(prev) as any;
  input.id = 'other-id';
  input.name = '  新名字 ';
  input.color.tokens[0].value.ghost = '#000000';
  input.components = { Btn: { usage: '改过的用途', root: { id: 'evil', type: 'page' } }, Fake: { usage: 'x', root: {} } };
  input.brand = { concept: ' 概念 ', avoid: ['', ' 渐变 '], mood: '' };
  const out = sanitizeSystem(input, prev);
  assert.equal(out.id, 'val-1');
  assert.equal(out.name, '新名字');
  assert.equal(out.color.tokens[0].value.ghost, undefined);
  assert.deepEqual(Object.keys(out.components), ['Btn']);
  assert.equal(out.components.Btn.usage, '改过的用途');
  assert.equal(out.components.Btn.root.id, 'b');
  assert.deepEqual(out.brand, { concept: '概念', avoid: ['渐变'] });

  const bad = (fn: (d: any) => void, re: RegExp) => {
    const d = structuredClone(prev) as any;
    fn(d);
    assert.throws(() => sanitizeSystem(d, prev), re);
  };
  bad((d) => (d.name = ''), /名称/);
  bad((d) => d.color.tokens.push({ ...d.color.tokens[0] }), /重复/);
  bad((d) => (d.color.tokens[0].name = 'a b'), /名字/);
  bad((d) => (d.color.tokens[1].value = { dark: '#000000' }), /默认主题/);
  bad((d) => (d.type.styles[0].weight = 450.5), /weight/);
  bad((d) => (d.color.themes[1].id = 'Dark Mode'), /主题 id/);
  // 取值里的危险内容由保存时的令牌校验拦下
  const evil = structuredClone(prev) as any;
  evil.shadow[0].value = 'url(javascript:alert(1))';
  assert.throws(() => saveSystem(sanitizeSystem(evil, prev)));
});

test('保存后同步到已安装的画布，AI 持锁的画布跳过', async () => {
  const hub = new Registry();
  const ds = createSystem({ name: 'Sync' });
  const mk = (theme: string) => {
    const c = hub.create({ title: theme, cwd: '/proj/a' });
    c.meta.system = { id: ds.id, version: ds.version, theme, installedAt: 1 };
    c.saveMeta();
    return c;
  };
  const light = mk('light');
  const dark = mk('dark');
  const locked = mk('light');
  await locked.acquireLock('ai-1');
  const other = hub.create({ title: 'other', cwd: '/proj/b' });

  const next = structuredClone(ds);
  const primary = next.color.tokens.find((t) => t.name === 'primary')!;
  primary.value = { light: '#B91C1C', dark: '#FCA5A5' };
  next.spacing[0].value = '5px';
  const r = updateSystem(hub, ds.id, next);
  assert.equal(r.system.version, 2);
  assert.deepEqual([r.synced, r.skipped], [2, 1]);
  assert.equal(light.doc.tokens['color.primary'], '#B91C1C');
  assert.equal(dark.doc.tokens['color.primary'], '#FCA5A5');
  assert.equal(light.doc.tokens[`space.${next.spacing[0].name}`], '5px');
  assert.equal(light.meta.system!.version, 2);
  assert.equal(locked.doc.tokens['color.primary'], undefined);
  assert.equal(locked.meta.system!.version, 1);
  assert.equal(other.doc.tokens['color.primary'], undefined);
  // 画布里可以撤销这次同步
  light.undo();
  assert.notEqual(light.doc.tokens['color.primary'], '#B91C1C');

  // 删掉画布正在用的主题：回到默认主题
  const one = structuredClone(r.system);
  one.color.themes = one.color.themes.filter((t) => t.id !== 'dark');
  updateSystem(hub, ds.id, one);
  assert.equal(dark.meta.system!.theme, 'light');
  assert.equal(dark.doc.tokens['color.primary'], '#B91C1C');

  assert.equal(listForUi(hub).find((s) => s.id === ds.id)!.canvases, 3);
  assert.equal(detailForUi(hub, loadSystem(ds.id)!).canvases.length, 3);
  hub.closeAll();
});

test('设为项目默认、删除', () => {
  const hub = new Registry();
  const ds = createSystem({ name: 'Def' });
  const cwd = path.join(home, 'proj');
  fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
  setProjectDefault(ds.id, cwd, true);
  assert.equal(defaultSystem(path.join(cwd))!.id, ds.id);
  assert.deepEqual(listForUi(hub).find((s) => s.id === ds.id)!.projects, [cwd]);
  assert.equal(detailForUi(hub, ds).projects.find((p) => p.cwd === cwd)!.system, ds.id);
  assert.throws(() => setProjectDefault(ds.id, 'relative/path', true), /绝对路径/);
  setProjectDefault(ds.id, cwd, false);
  assert.equal(defaultSystem(cwd), undefined);
  setProjectDefault(ds.id, cwd, true);
  deleteSystem(ds.id);
  assert.equal(loadSystem(ds.id), undefined);
  assert.equal(defaultSystem(cwd), undefined);
  assert.ok(fs.readdirSync(path.join(home, 'trash')).some((f) => f.startsWith(`system-${ds.id}-`)));
  assert.throws(() => deleteSystem(ds.id), /不存在/);
  hub.closeAll();
});
