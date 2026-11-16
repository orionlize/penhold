import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archetypeIds, contrast, directionDetail, directionExample, recolor, suggestDirections } from '../src/server/design/directions.ts';
import { catalog } from '../src/server/design/presets.ts';
import { pageGuides, pageGuideText, pageTypeOf, pageTypes } from '../src/server/design/pageGuides.ts';
import { validateNodeInput, validateTokens } from '../src/core/schema.ts';
import { designCheckup } from '../src/core/designLint.ts';
import { emptyDoc } from '../src/core/doc.ts';
import type { Node } from '../src/core/types.ts';
import { setInstalledFontsForTest } from '../src/server/design/localFonts.ts';

// 固定本机字体清单，结果不随运行环境变化
const LOCAL_FONTS = ['Noto Sans CJK SC', 'Noto Serif CJK SC', 'Inter', 'Noto Sans Mono'];
setInstalledFontsForTest(LOCAL_FONTS);

const hue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (!d) return undefined;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('很短的需求也能得到 3 张原型互不相同的方向卡片', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const cards = suggestDirections({ brief: '移动端登录页', seed });
    assert.equal(cards.length, 3, `seed ${seed}`);
    const archetypes = cards.map((c) => c.id.split('/')[0]);
    assert.equal(new Set(archetypes).size, 3, `seed ${seed} 原型重复`);
    assert.ok(!archetypes.includes('data-dense'), '高密度工具风只在后台 / 看板题材出现');
    assert.equal(new Set(cards.map((c) => c.palette.from)).size, 3, `seed ${seed} 色板重复`);
    for (const c of cards) {
      assert.ok(c.signature && c.fonts && c.shape && c.layout);
      assert.doesNotMatch(c.fonts, /Thai|Hebrew|Arabic/);
    }
  }
});

test('同一种子结果可复现，不同种子结果有变化', () => {
  const ids = (seed: number) => suggestDirections({ brief: '登录页', seed }).map((c) => c.id).join('|');
  assert.equal(ids(7), ids(7));
  assert.ok(new Set(Array.from({ length: 20 }, (_, i) => ids(i + 1))).size > 10);
});

test('三张卡片的主色色相大多拉开，且不集中在蓝色系', () => {
  let close = 0;
  let blue = 0;
  let total = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const hues = suggestDirections({ brief: '做一个首页', seed })
      .map((c) => hue(c.palette.primary))
      .filter((h): h is number => h !== undefined);
    for (let i = 0; i < hues.length; i++) {
      total++;
      if (hues[i] >= 200 && hues[i] < 260) blue++;
      for (let j = i + 1; j < hues.length; j++) if (gap(hues[i], hues[j]) < 45) close++;
    }
  }
  assert.ok(close <= 20, `色相相近的组合过多：${close}`);
  assert.ok(blue / total < 0.4, `蓝色系占比过高：${blue}/${total}`);
});

test('题材明确时第一张贴合题材，严肃题材排除不合适的原型', () => {
  const cards = suggestDirections({ brief: '做一个记账 App', seed: 3 });
  assert.match(cards[0].basis, /贴合题材/);
  assert.equal(cards[0].palette.from, 'Personal Finance Tracker');
  for (let seed = 1; seed <= 40; seed++) {
    const a = suggestDirections({ brief: '银行 App 登录页', seed }).map((c) => c.id.split('/')[0]);
    assert.ok(!a.includes('neo-brutal') && !a.includes('playful-clay') && !a.includes('bold-block'), `seed ${seed}: ${a}`);
  }
});

test('避开同项目近期用过的主色与原型', () => {
  const count = (avoid: boolean) => {
    let near = 0;
    let reused = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const cards = suggestDirections({ brief: '登录页', seed, ...(avoid ? { avoidColors: ['#4F46E5', '#0F766E'], avoidArchetypes: ['soft-rounded'] } : {}) });
      for (const c of cards) {
        const h = hue(c.palette.primary);
        if (h !== undefined && (gap(h, 243) < 25 || gap(h, 175) < 25)) near++;
        if (c.id.startsWith('soft-rounded/')) reused++;
      }
    }
    return { near, reused };
  };
  const base = count(false);
  const avoided = count(true);
  assert.ok(avoided.near < base.near / 2, `已用色相附近：${avoided.near}，不避开时 ${base.near}`);
  assert.ok(avoided.reused < base.reused / 2, `已用原型：${avoided.reused}，不避开时 ${base.reused}`);
});

test('卡片 id 可还原为完整方向，令牌可直接用于 tokens_set', () => {
  for (let seed = 1; seed <= 30; seed++)
    for (const c of suggestDirections({ brief: seed % 2 ? '后台数据看板' : '咖啡店小程序首页', seed })) {
      const d = directionDetail(c.id)!;
      assert.ok(d, c.id);
      assert.equal(d.signature, c.signature);
      validateTokens(d.tokens);
      for (const k of ['color.primary', 'color.bg', 'color.fg', 'font.heading', 'font.body', 'radius.sm', 'radius.md', 'radius.lg', 'shadow.md'])
        assert.ok(d.tokens[k], `${c.id} 缺少 ${k}`);
      assert.match(d.tokens['font.heading'], /SC/, '标题字体带中文回退');
      assert.ok(d.avoid.length > 0 && d.styles.length > 0);
    }
  assert.equal(directionDetail('no-such/direction/0/0'), undefined);
  assert.equal(directionDetail('swiss-precise/saas-general/0/99'), undefined);
  assert.ok(archetypeIds().length >= 10);
});

test('按页面名与区块识别页面类型并下发规范片段', () => {
  assert.equal(pageTypeOf({ name: '登录页 / 移动端' }), 'login');
  assert.equal(pageTypeOf({ name: '短信验证码登录' }), 'login');
  assert.equal(pageTypeOf({ name: '首页' }), 'home');
  assert.equal(pageTypeOf({ name: '数据看板' }), 'dashboard');
  assert.equal(pageTypeOf({ name: '商品详情' }), 'detail');
  assert.equal(pageTypeOf({ name: '订单列表' }), 'list');
  assert.equal(pageTypeOf({ name: '编辑资料' }), 'form');
  assert.equal(pageTypeOf({ name: '我的' }), 'profile');
  assert.equal(pageTypeOf({ name: 'Landing page' }), 'landing');
  assert.equal(pageTypeOf({ name: '支付成功' }), 'onboarding');
  assert.equal(pageTypeOf({ name: '页面 A', sections: ['顶部导航', '登录表单'] }), 'login');
  assert.equal(pageTypeOf({ name: '页面 A' }), undefined);
  for (const t of pageTypes()) assert.ok((pageGuideText(t) ?? '').length > 200, `缺少 guides/pages/${t}.md`);

  const g = pageGuides([{ name: '登录页' }, { name: '注册页' }, { name: '首页' }, { name: '其他' }]);
  assert.deepEqual(g.map((x) => x.type), ['login', 'home']);
  assert.deepEqual(g[0].pages, ['登录页', '注册页']);
  assert.match(g[0].guide, /构图/);
});

test('字体令牌只用本机已安装的字体，标题按方向取宋体或黑体', () => {
  const firstFamily = (v: string) => v.split(',')[0].trim();
  try {
    for (let seed = 1; seed <= 40; seed++)
      for (const c of suggestDirections({ brief: '杂志阅读 App 首页', seed })) {
        const d = directionDetail(c.id)!;
        for (const k of ['font.heading', 'font.body']) assert.ok(LOCAL_FONTS.includes(firstFamily(d.tokens[k])), `${c.id} ${k} 首选字体未安装：${d.tokens[k]}`);
        assert.equal(d.tokens['font.mono'], 'Noto Sans Mono, monospace');
        assert.ok(d.typography.length > 10);
        if (d.archetype === 'editorial') {
          assert.match(d.tokens['font.heading'], /Noto Serif CJK SC/);
          assert.match(d.tokens['font.body'], /Noto Sans CJK SC/);
          assert.match(c.fonts, /宋体/);
        }
        // 楷体、圆体本机没有：退到宋体 / 黑体，并说明去掉了什么
        if (d.archetype === 'organic-natural') {
          assert.match(d.tokens['font.heading'], /^Noto Serif CJK SC/);
          assert.match(d.fonts.notes ?? '', /楷体/);
        }
        if (d.archetype === 'soft-rounded') assert.match(d.tokens['font.heading'], /Noto Sans CJK SC/);
      }

    // 检测不到本机字体时保留目录字体并带通用中文回退
    setInstalledFontsForTest(null);
    const [c] = suggestDirections({ brief: '登录页', seed: 5 });
    const d = directionDetail(c.id)!;
    assert.match(d.tokens['font.heading'], /SC/);
    assert.equal(d.tokens['font.mono'], undefined);
  } finally {
    setInstalledFontsForTest(LOCAL_FONTS);
  }
});

test('色板没有匹配到题材时给出说明', () => {
  const [c] = suggestDirections({ brief: '钓鱼佬助手 钓友圈', seed: 2 });
  assert.match(directionDetail(c.id, '钓鱼佬助手 钓友圈')!.palette_note ?? '', /不是按本题材挑的/);
  const [m] = suggestDirections({ brief: '做一个记账 App', seed: 3 });
  assert.equal(directionDetail(m.id, '做一个记账 App')!.palette_note, undefined);
  assert.equal(directionDetail(m.id)!.palette_note, undefined);
});

test('每个方向都有示例稿：通过节点校验，只引用令牌，设计体检没有提醒', () => {
  const scale = { 'size.xs': '12px', 'size.sm': '14px', 'size.md': '16px', 'size.lg': '18px', 'size.xl': '22px', 'size.2xl': '28px', 'size.3xl': '34px' };
  for (const aid of archetypeIds()) {
    const ex = directionExample(`${aid}/x/0/0`);
    assert.ok(ex, `缺少 guides/examples/${aid}.json`);
    assert.ok(ex.subject && ex.shows && ex.width === 390);
    let n = 0;
    const withIds = (x: Node): Node => ({ ...x, id: `n${++n}`, children: x.children?.map(withIds) });
    const root = withIds(validateNodeInput(ex.root) as Node);
    assert.ok(n >= 10, `${aid} 示例过于简单`);
    const json = JSON.stringify(root);
    assert.doesNotMatch(json, /#[0-9a-fA-F]{6}\b/, `${aid} 示例直接写了色值`);
    assert.doesNotMatch(json, /"fontFamily":"(?!\{font\.)/, `${aid} 示例直接写了字体`);
    const doc = emptyDoc('c');
    doc.tokens = { ...scale, 'radius.sm': '4px', 'radius.md': '8px', 'radius.lg': '16px', 'radius.full': '999px' };
    const frame = { id: 'f', name: ex.subject, width: 390, height: 'auto' as const, root };
    doc.frames.push(frame);
    assert.deepEqual(designCheckup(doc, frame).map((x) => x.kind), [], aid);
  }
  assert.equal(directionExample('no-such/x/0/0'), undefined);
});

test('按主色重算色板：主色精确采用，状态色不变，文字对比度达标', () => {
  const targets = ['#2F6B4F', '#C2410C', '#FACC15', '#1D4ED8', '#7C3AED'];
  for (const p of catalog().products) {
    if (!/^#[0-9a-f]{6}$/i.test(p.tokens['color.primary'] ?? '')) continue;
    for (const target of targets) {
      const t = recolor(p.tokens, target);
      validateTokens(t);
      assert.equal(t['color.primary'], target);
      assert.equal(t['color.danger'], p.tokens['color.danger']);
      const pairs: Array<[string, string]> = [['color.on-primary', 'color.primary'], ['color.fg', 'color.bg'], ['color.muted-fg', 'color.bg'], ['color.card-fg', 'color.card']];
      for (const [fg, bg] of pairs) {
        if (!/^#[0-9a-f]{6}$/i.test(t[fg] ?? '') || !/^#[0-9a-f]{6}$/i.test(t[bg] ?? '')) continue;
        assert.ok(contrast(t[fg], t[bg]) >= 4.5, `${p.id} → ${target}：${fg} 对 ${bg} 只有 ${contrast(t[fg], t[bg]).toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(recolor({ 'color.primary': '#112233' }, 'not-a-color'), { 'color.primary': '#112233' });
  const [c] = suggestDirections({ brief: '钓鱼佬助手 钓友圈', seed: 2 });
  const d = directionDetail(c.id, '钓鱼佬助手 钓友圈', '#2F6B4F')!;
  assert.equal(d.tokens['color.primary'], '#2F6B4F');
  assert.match(d.palette_note ?? '', /已按主色 #2F6B4F 重算/);
  assert.match(directionDetail(c.id, '钓鱼佬助手 钓友圈')!.palette_note ?? '', /primary/);
});
