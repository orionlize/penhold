import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-ds-'));
process.env.DESIGN_MCP_HOME = home;
const { contrast, ensureContrast, fromOklch, toOklch } = await import('../src/core/color.ts');
const ds_ = await import('../src/core/designSystem.ts');
const { auditContrast, applyPatch, flattenSystem, importCss, importTokensJson, lintSystem, renderReadme, systemCss, systemFromFlat, systemFromImport, textRecipe } = ds_;
const { suggestDirections, systemFromDirection, archetypeIds } = await import('../src/server/design/directions.ts');
const { catalog } = await import('../src/server/design/presets.ts');
const { defaultSystem, exportSystem, loadSystem, newSystemId, saveSystem, setDefaultSystem, claudeTokens } = await import('../src/server/design/systems.ts');
const { systemPage } = await import('../src/server/design/systemPage.ts');
const { validateTokens } = await import('../src/core/schema.ts');

test('OKLCH 往返换算与只调明度的对比度修正', () => {
  for (const hex of ['#2563EB', '#F97316', '#FACC15', '#0F172A', '#FFFFFF', '#7C3AED']) {
    assert.equal(fromOklch(toOklch(hex)), hex);
  }
  const fixed = ensureContrast('#9CA3AF', '#FFFFFF', 4.5);
  assert.ok(contrast(fixed, '#FFFFFF') >= 4.5);
  assert.ok(Math.abs(toOklch(fixed)[2] - toOklch('#9CA3AF')[2]) < 20, '色相基本不变');
  assert.equal(ensureContrast('#111111', '#FFFFFF', 4.5), '#111111');
});

test('每个方向生成的系统：两套主题、对比度全部达标、结构完整', () => {
  const seen = new Set<string>();
  for (let seed = 1; seed < 60; seed++)
    for (const c of suggestDirections({ seed, count: 3, brief: seed % 5 ? '' : '后台 dashboard' })) {
      seen.add(c.id.split('/')[0]);
      const ds = systemFromDirection(c.id, { id: 'x', name: 'X', device: seed % 2 ? 'mobile' : 'desktop' })!;
      assert.equal(ds.color.themes.length, 2);
      assert.deepEqual(auditContrast(ds), [], c.id);
      assert.deepEqual(lintSystem(ds), [], c.id);
      for (const th of ds.color.themes) validateTokens(flattenSystem(ds, th.id));
      const display = ds.type.styles.find((s) => s.name === 'display')!;
      assert.ok(typeof display.size === 'number' && display.size > Math.max(...Object.values(ds.type.scale)));
    }
  assert.equal(seen.size, archetypeIds().length);
});

test('展开令牌、文字样式写法、README 与 CSS', () => {
  const [c] = suggestDirections({ seed: 7 });
  const ds = systemFromDirection(c.id, { id: 'x', name: '记账本', device: 'mobile', concept: '结余是首屏唯一的大数字', motif: '小票' })!;
  const flat = flattenSystem(ds);
  for (const k of ['color.primary', 'color.on-primary', 'color.bg', 'color.fg', 'color.muted-fg', 'color.border', 'font.heading', 'font.body', 'size.md', 'space.4', 'radius.md', 'shadow.md']) assert.ok(k in flat, k);
  const dark = ds.color.themes.find((t) => t.id !== ds.color.themes[0].id)!.id;
  assert.notEqual(flattenSystem(ds, dark)['color.bg'], flat['color.bg']);
  const body = ds.type.styles.find((s) => s.name === 'body')!;
  assert.match(String(textRecipe(body).fontSize), /^\{size\.(sm|md)\}$/);
  const md = renderReadme(ds);
  assert.match(md, /# 记账本/);
  assert.match(md, /结余是首屏唯一的大数字/);
  assert.match(md, /`color\.muted-fg`/);
  assert.match(md, /## 文字/);
  const css = systemCss(ds);
  assert.match(css, /:root\{/);
  assert.match(css, /\[data-theme="/);
});

test('从 CSS 变量导入：shadcn 的 HSL 三元组、.dark 块与 Tailwind v4 @theme', () => {
  const css = `
  @theme { --color-brand: oklch(0.62 0.19 260); --font-sans: "Inter", sans-serif; --text-sm: 0.875rem; --text-base: 1rem; --text-lg: 1.125rem; --text-xl: 1.25rem; --spacing: 0.25rem; --radius-lg: 12px; }
  :root { --background: 0 0% 100%; --foreground: 222 47% 11%; --primary: 221 83% 53%; --primary-foreground: 210 40% 98%; --muted-foreground: 215 16% 47%; --border: 214 32% 91%; --radius: 0.5rem; --mystery: 12; }
  .dark { --background: 222 47% 11%; --foreground: 210 40% 98%; }
  /* --ignored: #fff; */`;
  const imp = importCss(css);
  assert.ok(imp.themes.light && imp.themes.dark);
  assert.equal(imp.themes.light['color.bg'], '#FFFFFF');
  assert.match(imp.themes.light['color.on-primary'], /^#[0-9A-F]{6}$/);
  assert.match(imp.themes.light['color.brand'], /^#[0-9A-F]{6}$/);
  assert.equal(imp.themes.light['font.body'], '"Inter", sans-serif');
  assert.equal(imp.themes.light['size.md'], '16px');
  assert.equal(imp.themes.light['space.4'], '16px');
  assert.equal(imp.themes.light['radius.md'], '8px');
  assert.equal(imp.themes.light['radius.lg'], '12px');
  assert.ok(imp.skipped.includes('--mystery'));
  assert.ok(!('color.ignored' in imp.themes.light));
  const ds = systemFromImport(imp, { id: 'imp-1', name: 'Acme' });
  assert.deepEqual(ds.color.themes.map((t) => t.id), ['light', 'dark']);
  const bg = ds.color.tokens.find((t) => t.name === 'bg')!;
  assert.notEqual(bg.value.dark, bg.value.light);
  // 只有亮色的值沿用到暗色
  assert.equal(flattenSystem(ds, 'dark')['color.primary'], flattenSystem(ds, 'light')['color.primary']);
});

test('读入 Claude Design 的 tokens.json，导出后能再读回', () => {
  const [c] = suggestDirections({ seed: 3 });
  const ds = systemFromDirection(c.id, { id: 'cd-1', name: 'CD', device: 'mobile' })!;
  const back = importTokensJson(claudeTokens(ds))!;
  assert.ok(back);
  assert.equal(back.themes[ds.color.themes[0].id]['color.primary'], flattenSystem(ds)['color.primary']);
  assert.equal(importTokensJson({ color: { brand: { $value: '#f00' } } }), undefined);
});

test('按名字合并修改：新增、改某个主题、删除、文字样式', () => {
  const ds = systemFromFlat({ 'color.primary': '#2563EB', 'color.bg': '#FFFFFF', 'color.fg': '#111827' }, { id: 'p-1', name: 'P' });
  const next = applyPatch(ds, {
    themes: [{ id: 'dark', name: '暗色' }],
    colors: [
      { name: 'bg', value: { dark: '#0B1220' } },
      { name: 'success', value: '#15803D' },
      { name: 'fg', value: null },
    ],
    scale: { '4xl': 64 },
    styles: [{ name: 'body', weight: 500 }, { name: 'display', remove: true }],
    spacing: [{ name: '9', value: '96px', usage: '超大留白' }],
  });
  assert.equal(next.color.tokens.find((t) => t.name === 'bg')!.value.dark, '#0B1220');
  assert.ok(next.color.tokens.some((t) => t.name === 'success'));
  assert.ok(!next.color.tokens.some((t) => t.name === 'fg'));
  assert.equal(next.type.scale['4xl'], 64);
  assert.equal(next.type.styles.find((s) => s.name === 'body')!.weight, 500);
  assert.ok(!next.type.styles.some((s) => s.name === 'display'));
  assert.equal(flattenSystem(next)['space.9'], '96px');
  assert.ok(lintSystem(next).some((w) => /fg/.test(w)));
  assert.equal(ds.color.tokens.find((t) => t.name === 'fg')?.value.light, '#111827', '原对象不变');
});

test('存储：保存加版本、项目默认、导出到项目后自动发现', () => {
  const [c] = suggestDirections({ seed: 11 });
  const id = newSystemId('Fishing Buddy');
  assert.match(id, /^fishing-buddy-[a-z0-9]{4}$/);
  const ds = systemFromDirection(c.id, { id, name: '钓友', device: 'mobile' })!;
  const v1 = saveSystem(ds);
  const v2 = saveSystem(v1);
  assert.equal(v2.version, v1.version + 1);
  assert.ok(fs.existsSync(path.join(home, 'systems', id, 'README.md')));
  assert.ok(fs.existsSync(path.join(home, 'systems', id, 'tokens.css')));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-proj-'));
  fs.mkdirSync(path.join(proj, '.git'));
  fs.mkdirSync(path.join(proj, 'app'));
  assert.equal(defaultSystem(proj), undefined);
  setDefaultSystem(proj, id);
  assert.equal(defaultSystem(path.join(proj, 'app'))?.id, id, '子目录沿用项目根的默认系统');
  setDefaultSystem(proj, null);
  // 另一台机器：只有项目里导出的文件
  const other = { ...v2, id: 'shared-abcd', version: 5 };
  exportSystem(other, path.join(proj, 'design-system'));
  assert.equal(defaultSystem(proj)?.id, 'shared-abcd');
  assert.equal(loadSystem('shared-abcd')?.version, 5);
  assert.equal(loadSystem('../etc'), undefined);
});

test('浏览页：每个主题一组色板，组件有预览', () => {
  const [c] = suggestDirections({ seed: 5 });
  const ds = systemFromDirection(c.id, { id: 'pg-1', name: '<浏览>', device: 'mobile' })!;
  ds.components.PrimaryButton = {
    name: 'PrimaryButton',
    usage: '一屏一个',
    root: { id: 'b', type: 'button', box: { height: 48, padding: [0, 16], radius: '{radius.md}' }, style: { background: '{color.primary}' }, children: [{ id: 't', type: 'text', text: '开始', style: { color: '{color.on-primary}' } }] },
  };
  const html = systemPage(ds);
  assert.match(html, /&lt;浏览&gt;/);
  assert.equal((html.match(/<div class="grid" data-theme-grid=/g) ?? []).length, 2);
  assert.equal((html.match(/<iframe /g) ?? []).length, 2);
  assert.ok(!html.includes('<浏览>'));
});

test('内置预设色板加载时修正对比度：主色对背景 ≥ 3:1，文字 ≥ 4.5:1', () => {
  for (const p of catalog().products) {
    const t = p.tokens;
    assert.ok(contrast(t['color.primary'], t['color.bg']) >= 3, `${p.id} primary`);
    assert.ok(contrast(t['color.fg'], t['color.bg']) >= 4.5, `${p.id} fg`);
    assert.ok(contrast(t['color.muted-fg'], t['color.bg']) >= 4.5, `${p.id} muted-fg/bg`);
    assert.ok(contrast(t['color.on-primary'], t['color.primary']) >= 4.5, `${p.id} on-primary`);
  }
});

test('多套配色：每套各有亮 / 暗主题，对比度达标', () => {
  const [c] = suggestDirections({ seed: 11 });
  const ds = systemFromDirection(c.id, {
    id: 'x',
    name: 'X',
    device: 'mobile',
    primary: '#2563EB',
    schemeName: '蓝',
    schemes: [
      { id: 'green', name: '绿', primary: '#059669' },
      { id: 'orange', name: '橙', primary: '#F59E0B' },
      { id: 'dup', name: '重复', primary: '#2563eb' },
    ],
  })!;
  const ids = ds.color.themes.map((t) => t.id);
  assert.equal(ids.length, 6);
  for (const id of ['green-light', 'green-dark', 'orange-light', 'orange-dark']) assert.ok(ids.includes(id), id);
  assert.deepEqual([...new Set(ds.color.themes.map((t) => t.scheme))], ['蓝', '绿', '橙']);
  for (const th of ds.color.themes) {
    assert.ok(th.mode === 'light' || th.mode === 'dark');
    assert.match(th.swatch!, /^#[0-9A-F]{6}$/);
    validateTokens(flattenSystem(ds, th.id));
  }
  assert.deepEqual(auditContrast(ds), []);
  assert.notEqual(flattenSystem(ds, 'green-light')['color.primary'], flattenSystem(ds)['color.primary']);
  // 没有额外配色时与原来一样只有两套、不带配色名
  const plain = systemFromDirection(c.id, { id: 'y', name: 'Y', device: 'mobile' })!;
  assert.equal(plain.color.themes.length, 2);
  assert.ok(plain.color.themes.every((t) => !t.scheme));
});
