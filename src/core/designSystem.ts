// 设计系统：一份独立于画布、可复用的设计依据（参照 Claude Design 的 Design System）。
// 颜色按主题（亮 / 暗）各存一个值，每个令牌都写用途；文字是“字号 + 行高 + 字重 + 字体”的组合样式；
// 另有间距、圆角、阴影、组件与品牌说明。画布“安装”系统时，把选定主题展开成扁平令牌
// （color.* font.* size.* space.* radius.* shadow.*），节点照旧用 {color.primary} 引用。
import { composite, contrast, ensureContrast, fromOklch, HEX6, hex, onColor, parseColor, toOklch } from './color.js';
import type { ComponentDef } from './types.js';

export interface DsTheme {
  id: string;
  name: string;
  /** 配色方案名（如“蓝”“绿”）：系统有多套配色时，同一配色的亮 / 暗主题共用一个名字。 */
  scheme?: string;
  /** 明暗。 */
  mode?: 'light' | 'dark';
  /** 该主题的主色（#RRGGBB），用于主题切换按钮上的色块。 */
  swatch?: string;
  /** 风格名（如“瑞士网格”）：系统带几种可切换的风格时，同一风格的主题共用一个名字。 */
  style?: string;
  /** 该主题覆盖的非颜色令牌（font.* radius.* shadow.*）：切换风格时随颜色一起写进画布。 */
  tokens?: Record<string, string>;
}

/** 主题可以覆盖的非颜色令牌。 */
export const THEME_TOKEN = /^(font|radius|shadow)\.[a-z0-9][a-z0-9-]{0,23}$/;

export interface DsColor {
  /** 不带前缀的名字：primary、on-primary、bg、fg… 展开为 color.<name>。 */
  name: string;
  /** 各主题的值（#RRGGBB；也接受 rgba() 等，但不参与对比度修正）。缺某主题时沿用第一个主题的值。 */
  value: Record<string, string>;
  usage?: string;
  /** 这个颜色作为文字 / 图标时，会放在哪些背景色上（用于对比度检查）。 */
  on?: string[];
  /** 非文字的界面元素（焦点环、控件边框、图标）：只要求 3:1。 */
  ui?: boolean;
}

export interface DsTextStyle {
  name: string;
  /** 字号：type.scale 的档名，或比最大一档还大的展示级字号（px）。 */
  size: string | number;
  lineHeight: number;
  weight: number;
  /** type.families 的键：heading、body、mono。 */
  family: string;
  letterSpacing?: number;
  usage?: string;
}

export interface DsLength {
  name: string;
  value: string;
  usage?: string;
}

export interface DesignSystem {
  v: 1;
  id: string;
  name: string;
  version: number;
  updatedAt: number;
  /** 由来：方向卡片、内置预设、从代码导入、从画布令牌整理。 */
  source?: { kind: 'direction' | 'preset' | 'import' | 'canvas' | 'manual'; ref?: string };
  /** 用于哪类设备：决定字阶与间距的默认值。 */
  device: 'mobile' | 'desktop';
  /** 品牌说明（Markdown 段落）：设计概念、题材母题、记忆点、形状与版式、不要做的事。 */
  brand: { concept?: string; motif?: string; signature?: string; mood?: string; shape?: string; layout?: string; typography?: string; avoid?: string[]; notes?: string };
  color: { themes: DsTheme[]; tokens: DsColor[] };
  type: { families: Record<string, string>; scale: Record<string, number>; styles: DsTextStyle[] };
  spacing: DsLength[];
  radius: DsLength[];
  shadow: DsLength[];
  components: Record<string, ComponentDef & { usage?: string }>;
}

// ---------- 默认值 ----------

export type Density = 'compact' | 'regular' | 'airy';

/** 字阶（px），键名与内置规范一致。 */
export const SCALES: Record<'mobile' | 'desktop', Record<Density, Record<string, number>>> = {
  mobile: {
    compact: { xs: 10, sm: 12, md: 14, lg: 16, xl: 18, '2xl': 22, '3xl': 28 },
    regular: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 34 },
    airy: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, '2xl': 32, '3xl': 40 },
  },
  desktop: {
    compact: { xs: 10, sm: 12, md: 14, lg: 16, xl: 20, '2xl': 24, '3xl': 32 },
    regular: { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, '2xl': 32, '3xl': 48 },
    airy: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, '2xl': 40, '3xl': 56 },
  },
};

export const SPACINGS: Record<Density, number[]> = {
  compact: [4, 6, 8, 12, 16, 20, 24, 32],
  regular: [4, 8, 12, 16, 24, 32, 48, 64],
  airy: [4, 8, 16, 24, 32, 48, 64, 96],
};

const SPACE_USAGE = ['图标与文字之间', '同一组内的紧密元素', '列表项内部', '卡片内边距、页边距', '组与组之间', '区块之间', '大区块之间', '首屏与页面顶部留白'];

export interface Weights {
  body: number;
  medium: number;
  heading: number;
  display: number;
}

/** 由字阶与字重生成组合文字样式。 */
export function textStyles(scale: Record<string, number>, w: Weights, density: Density, displayPx: number): DsTextStyle[] {
  const body = density === 'compact' ? 'sm' : 'md';
  return [
    { name: 'display', size: displayPx, lineHeight: 1.1, weight: w.display, family: 'heading', letterSpacing: displayPx >= 40 ? -1 : -0.5, usage: '一页最多一处的展示级大字：首屏大标题或关键数字' },
    { name: 'title', size: '3xl', lineHeight: 1.2, weight: w.heading, family: 'heading', usage: '页面主标题' },
    { name: 'heading', size: '2xl', lineHeight: 1.25, weight: w.heading, family: 'heading', usage: '区块标题' },
    { name: 'subheading', size: 'xl', lineHeight: 1.3, weight: w.heading, family: 'heading', usage: '卡片标题、弹窗标题' },
    { name: 'lead', size: 'lg', lineHeight: 1.6, weight: w.body, family: 'body', usage: '导语、价值主张' },
    { name: 'body', size: body, lineHeight: 1.6, weight: w.body, family: 'body', usage: '正文与列表主文字' },
    { name: 'body-strong', size: body, lineHeight: 1.6, weight: w.medium, family: 'body', usage: '正文中需要强调的词、列表项标题' },
    { name: 'label', size: 'sm', lineHeight: 1.4, weight: w.medium, family: 'body', usage: '表单标签、tab、标签' },
    { name: 'button', size: body, lineHeight: 1.2, weight: w.medium > w.body ? w.medium : w.heading, family: 'body', usage: '按钮文字' },
    { name: 'caption', size: 'xs', lineHeight: 1.5, weight: w.body, family: 'body', usage: '辅助说明、时间、协议文字' },
  ];
}

// ---------- 颜色约定 ----------

/** 颜色的默认用途与对比度检查对象（令牌自己没写时使用）。 */
const COLOR_ROLES: Record<string, { usage: string; on?: string[]; ui?: boolean }> = {
  bg: { usage: '页面背景' },
  fg: { usage: '正文与标题文字', on: ['bg'] },
  card: { usage: '卡片、输入框、浮层的底色' },
  'card-fg': { usage: '卡片上的文字', on: ['card'] },
  muted: { usage: '弱化背景：次级按钮、分组底色、骨架屏' },
  'muted-fg': { usage: '次要文字：说明、时间、占位', on: ['bg', 'card', 'muted'] },
  border: { usage: '分隔线与卡片描边（装饰性，不要求对比度）' },
  input: { usage: '输入框描边（控件边界，要求 3:1）', on: ['bg', 'card'], ui: true },
  ring: { usage: '焦点环', on: ['bg', 'card'], ui: true },
  primary: { usage: '主行动：主按钮、选中态、图标（对背景 ≥ 3:1）；用作小字链接时要 ≥ 4.5:1，不够就用 color.fg 加下划线', on: ['bg', 'card'], ui: true },
  secondary: { usage: '次要强调：次级按钮、标签底色' },
  accent: { usage: '点缀：记忆点、徽标、关键数字' },
  danger: { usage: '错误与删除', on: ['bg', 'card'] },
  success: { usage: '成功状态（配合图标或文字，不只靠颜色）', on: ['bg', 'card'], ui: true },
  warning: { usage: '警告状态（配合图标或文字，不只靠颜色）', on: ['bg', 'card'], ui: true },
  info: { usage: '提示信息', on: ['bg', 'card'], ui: true },
};

export function colorRole(name: string): { usage: string; on?: string[]; ui?: boolean } | undefined {
  const r = COLOR_ROLES[name];
  if (r) return r;
  const base = /^on-(.+)$/.exec(name)?.[1];
  if (base) return { usage: `${base} 色块上的文字与图标`, on: [base] };
  return undefined;
}

const valueIn = (t: DsColor, theme: string, first: string) => t.value[theme] ?? t.value[first];

// ---------- 对比度 ----------

export interface ContrastResult {
  theme: string;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
}

/** 每个主题里，每个文字色对它所在背景的对比度；返回未达标的。 */
export function auditContrast(ds: DesignSystem, all = false): ContrastResult[] {
  const out: ContrastResult[] = [];
  const first = ds.color.themes[0]?.id ?? 'light';
  const byName = new Map(ds.color.tokens.map((t) => [t.name, t]));
  for (const th of ds.color.themes) {
    for (const t of ds.color.tokens) {
      const role = colorRole(t.name);
      const on = t.on ?? role?.on ?? [];
      const min = (t.ui ?? role?.ui) ? 3 : 4.5;
      for (const b of on) {
        const bt = byName.get(b);
        if (!bt) continue;
        const fgv = parseColor(valueIn(t, th.id, first) ?? '');
        const bgv = parseColor(valueIn(bt, th.id, first) ?? '');
        if (!fgv || !bgv || bgv.alpha < 1) continue;
        const ratio = contrast(fgv.alpha < 1 ? composite(fgv.rgb, fgv.alpha, bgv.rgb) : fgv.rgb, bgv.rgb);
        if (all || ratio < min) out.push({ theme: th.id, fg: t.name, bg: b, ratio: Math.round(ratio * 100) / 100, min });
      }
    }
  }
  return out;
}

/** 修正未达标的颜色：色块上的文字取黑白，其余只调明度。返回改动说明。 */
export function fixContrast(ds: DesignSystem): string[] {
  const changes: string[] = [];
  const first = ds.color.themes[0]?.id ?? 'light';
  const byName = new Map(ds.color.tokens.map((t) => [t.name, t]));
  for (let pass = 0; pass < 3; pass++) {
    const bad = auditContrast(ds);
    if (!bad.length) break;
    for (const r of bad) {
      const t = byName.get(r.fg)!;
      const bg = valueIn(byName.get(r.bg)!, r.theme, first);
      const cur = valueIn(t, r.theme, first);
      if (!bg || !cur || !HEX6.test(bg) || !HEX6.test(cur)) continue;
      const next = r.fg.startsWith('on-') && contrast(onColor(bg), bg) >= r.min ? onColor(bg) : ensureContrast(cur, bg, r.min);
      if (next !== cur) {
        t.value[r.theme] = next;
        changes.push(`${r.theme}：${r.fg} ${cur} → ${next}（对 ${r.bg} 原为 ${r.ratio}:1，要求 ${r.min}:1）`);
      }
    }
  }
  return changes;
}

// ---------- 主题推导 ----------

/** 由一个主题推导另一个（亮 ↔ 暗）：中性色按角色重设明度，彩色保持色相与彩度、调明度，最后修正对比度。 */
export function deriveTheme(ds: DesignSystem, from: string, to: DsTheme, tone: 'light' | 'dark'): void {
  if (ds.color.themes.some((t) => t.id === to.id)) return;
  const first = ds.color.themes[0].id;
  const get = (n: string) => ds.color.tokens.find((t) => t.name === n);
  const pv = get('primary') ? valueIn(get('primary')!, from, first) : undefined;
  const ph = pv && HEX6.test(pv) ? toOklch(pv)[2] : 250;
  const neutral: Record<string, number> =
    tone === 'dark'
      ? { bg: 0.17, card: 0.215, muted: 0.255, border: 0.33, input: 0.5, fg: 0.95, 'card-fg': 0.95, 'muted-fg': 0.76 }
      : { bg: 0.985, card: 1, muted: 0.955, border: 0.9, input: 0.62, fg: 0.24, 'card-fg': 0.24, 'muted-fg': 0.48 };
  for (const t of ds.color.tokens) {
    const v = valueIn(t, from, first);
    if (!v || !HEX6.test(v)) {
      if (v) t.value[to.id] = v;
      continue;
    }
    const [l, c, h] = toOklch(v);
    let next: string;
    if (t.name in neutral) next = fromOklch([neutral[t.name], Math.min(c, 0.02), c > 0.01 ? h : ph]);
    else if (t.name.startsWith('on-')) next = v; // 色块定了再取
    else if (c > 0.04) next = fromOklch([tone === 'dark' ? Math.min(0.82, Math.max(0.66, l)) : Math.min(0.58, Math.max(0.42, l)), c, h]);
    else next = fromOklch([Math.min(0.97, Math.max(0.12, 1.1 - l)), c, h]);
    t.value[to.id] = next;
  }
  for (const t of ds.color.tokens) {
    const base = /^on-(.+)$/.exec(t.name)?.[1];
    const bg = base ? get(base)?.value[to.id] : undefined;
    if (bg && HEX6.test(bg)) t.value[to.id] = onColor(bg);
  }
  ds.color.themes.push(to);
}

// ---------- 展开为画布令牌 ----------

const px = (n: number) => `${n}px`;

/** 选定主题展开为扁平令牌。 */
export function flattenSystem(ds: DesignSystem, theme?: string): Record<string, string> {
  const first = ds.color.themes[0]?.id ?? 'light';
  const th = theme && ds.color.themes.some((t) => t.id === theme) ? theme : first;
  const out: Record<string, string> = {};
  for (const t of ds.color.tokens) {
    const v = valueIn(t, th, first);
    if (v) out[`color.${t.name}`] = v;
  }
  for (const [k, v] of Object.entries(ds.type.families)) out[`font.${k}`] = v;
  for (const [k, v] of Object.entries(ds.type.scale)) out[`size.${k}`] = px(v);
  for (const s of ds.spacing) out[`space.${s.name}`] = s.value;
  for (const s of ds.radius) out[`radius.${s.name}`] = s.value;
  for (const s of ds.shadow) out[`shadow.${s.name}`] = s.value;
  const over = ds.color.themes.find((t) => t.id === th)?.tokens;
  if (over) for (const [k, v] of Object.entries(over)) if (THEME_TOKEN.test(k)) out[k] = v;
  return out;
}

/** 切换主题时要写进画布的令牌名：全部颜色，加上任一主题覆盖过的字体、圆角、阴影。 */
export function themeKeys(ds: DesignSystem): (key: string) => boolean {
  const styled = new Set(ds.color.themes.flatMap((t) => Object.keys(t.tokens ?? {})));
  return (k) => k.startsWith('color.') || styled.has(k);
}

/** 文字样式落到节点 style 上的写法。 */
export function textRecipe(s: DsTextStyle): Record<string, string | number> {
  return {
    fontSize: typeof s.size === 'number' ? s.size : `{size.${s.size}}`,
    lineHeight: s.lineHeight,
    fontWeight: s.weight,
    fontFamily: `{font.${s.family}}`,
    ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : {}),
  };
}

/** 从扁平令牌整理出系统（画布已有令牌、内置预设、导入的 CSS 变量）。缺的部分按 device 与 density 补默认值。 */
export function systemFromFlat(
  tokens: Record<string, string>,
  init: { id: string; name: string; device?: 'mobile' | 'desktop'; density?: Density; weights?: Weights; theme?: DsTheme; source?: DesignSystem['source'] },
): DesignSystem {
  const device = init.device ?? 'mobile';
  const density = init.density ?? 'regular';
  const theme = init.theme ?? { id: 'light', name: '亮色' };
  const pick = (prefix: string) =>
    Object.entries(tokens)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), v] as const);
  const colors: DsColor[] = pick('color.').map(([name, v]) => {
    const role = colorRole(name);
    return { name, value: { [theme.id]: v }, ...(role ? { usage: role.usage } : {}) };
  });
  // 没有分隔线颜色时由背景朝文字色推一档
  const bgC = colors.find((c) => c.name === 'bg')?.value[theme.id];
  const fgC = colors.find((c) => c.name === 'fg')?.value[theme.id];
  if (!colors.some((c) => c.name === 'border') && bgC && fgC && HEX6.test(bgC) && HEX6.test(fgC)) {
    const [l, c, h] = toOklch(bgC);
    colors.push({ name: 'border', value: { [theme.id]: fromOklch([l + (toOklch(fgC)[0] > l ? 0.1 : -0.1), Math.min(c, 0.03), h]) }, usage: COLOR_ROLES.border.usage });
  }
  const scale: Record<string, number> = {};
  for (const [k, v] of pick('size.')) {
    const n = parseFloat(v);
    if (Number.isFinite(n)) scale[k] = /rem$/.test(v.trim()) ? n * 16 : n;
  }
  const finalScale = Object.keys(scale).length >= 4 ? scale : SCALES[device][density];
  const spaces = pick('space.');
  const spacing: DsLength[] = spaces.length
    ? spaces.map(([name, value], i) => ({ name, value, ...(SPACE_USAGE[i] ? { usage: SPACE_USAGE[i] } : {}) }))
    : SPACINGS[density].map((v, i) => ({ name: String(i + 1), value: px(v), usage: SPACE_USAGE[i] }));
  const radiusUsage: Record<string, string> = { sm: '标签、复选框等小控件', md: '按钮、输入框', lg: '卡片、弹窗', full: '只给一类元素：主按钮或筛选项二选一，以及头像' };
  const radii = pick('radius.');
  const radius: DsLength[] = (radii.length ? radii : [['sm', '6px'], ['md', '10px'], ['lg', '16px'], ['full', '999px']] as const).map(([name, value]) => ({
    name,
    value,
    ...(radiusUsage[name] ? { usage: radiusUsage[name] } : {}),
  }));
  const shadowUsage: Record<string, string> = { sm: '轻微浮起：悬停的卡片、下拉框', md: '浮层：弹窗、浮动按钮、抽屉' };
  const shadow: DsLength[] = pick('shadow.').map(([name, value]) => ({ name, value, ...(shadowUsage[name] ? { usage: shadowUsage[name] } : {}) }));
  const families: Record<string, string> = Object.fromEntries(pick('font.'));
  if (!families.body) families.body = 'PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif';
  if (!families.heading) families.heading = families.body;
  const w = init.weights ?? { body: 400, medium: 500, heading: 700, display: 700 };
  const top = Math.max(...Object.values(finalScale));
  return {
    v: 1,
    id: init.id,
    name: init.name,
    version: 1,
    updatedAt: Date.now(),
    ...(init.source ? { source: init.source } : {}),
    device,
    brand: {},
    color: { themes: [theme], tokens: colors },
    type: { families, scale: finalScale, styles: textStyles(finalScale, w, density, Math.round(top * 1.5)) },
    spacing,
    radius,
    shadow,
    components: {},
  };
}

// ---------- 合并修改 ----------

export interface SystemPatch {
  name?: string;
  brand?: Partial<DesignSystem['brand']>;
  /** 按名字合并；value 只写要改的主题；value 为 null 删除该令牌。 */
  colors?: Array<{ name: string; value?: Record<string, string> | string | null; usage?: string; on?: string[]; ui?: boolean }>;
  themes?: DsTheme[];
  families?: Record<string, string | null>;
  scale?: Record<string, number | null>;
  styles?: Array<Partial<DsTextStyle> & { name: string; remove?: boolean }>;
  spacing?: Array<{ name: string; value?: string | null; usage?: string }>;
  radius?: Array<{ name: string; value?: string | null; usage?: string }>;
  shadow?: Array<{ name: string; value?: string | null; usage?: string }>;
}

function mergeLengths(list: DsLength[], patch: Array<{ name: string; value?: string | null; usage?: string }> | undefined): DsLength[] {
  if (!patch) return list;
  const out = [...list];
  for (const p of patch) {
    const i = out.findIndex((x) => x.name === p.name);
    if (p.value === null) {
      if (i >= 0) out.splice(i, 1);
      continue;
    }
    if (i >= 0) out[i] = { ...out[i], ...(p.value !== undefined ? { value: p.value } : {}), ...(p.usage !== undefined ? { usage: p.usage } : {}) };
    else if (p.value) out.push({ name: p.name, value: p.value, ...(p.usage ? { usage: p.usage } : {}) });
  }
  return out;
}

export function applyPatch(ds: DesignSystem, p: SystemPatch): DesignSystem {
  const next: DesignSystem = structuredClone(ds);
  if (p.name) next.name = p.name;
  if (p.brand) next.brand = { ...next.brand, ...p.brand };
  for (const t of p.themes ?? []) if (!next.color.themes.some((x) => x.id === t.id)) next.color.themes.push(t);
  const first = next.color.themes[0].id;
  for (const c of p.colors ?? []) {
    const i = next.color.tokens.findIndex((x) => x.name === c.name);
    if (c.value === null) {
      if (i >= 0) next.color.tokens.splice(i, 1);
      continue;
    }
    const value = typeof c.value === 'string' ? { [first]: c.value } : (c.value ?? {});
    if (i >= 0) {
      const t = next.color.tokens[i];
      t.value = { ...t.value, ...value };
      if (c.usage !== undefined) t.usage = c.usage;
      if (c.on !== undefined) t.on = c.on;
      if (c.ui !== undefined) t.ui = c.ui;
    } else {
      const role = colorRole(c.name);
      next.color.tokens.push({ name: c.name, value, ...(c.usage ?? role?.usage ? { usage: c.usage ?? role?.usage } : {}), ...(c.on ? { on: c.on } : {}), ...(c.ui !== undefined ? { ui: c.ui } : {}) });
    }
  }
  for (const [k, v] of Object.entries(p.families ?? {})) {
    if (v === null) delete next.type.families[k];
    else next.type.families[k] = v;
  }
  for (const [k, v] of Object.entries(p.scale ?? {})) {
    if (v === null) delete next.type.scale[k];
    else next.type.scale[k] = v;
  }
  for (const s of p.styles ?? []) {
    const i = next.type.styles.findIndex((x) => x.name === s.name);
    if (s.remove) {
      if (i >= 0) next.type.styles.splice(i, 1);
      continue;
    }
    const { remove: _r, ...rest } = s;
    if (i >= 0) next.type.styles[i] = { ...next.type.styles[i], ...rest };
    else if (s.size !== undefined && s.weight !== undefined) next.type.styles.push({ lineHeight: 1.5, family: 'body', ...rest } as DsTextStyle);
  }
  next.spacing = mergeLengths(next.spacing, p.spacing);
  next.radius = mergeLengths(next.radius, p.radius);
  next.shadow = mergeLengths(next.shadow, p.shadow);
  return next;
}

/** 结构与取值的问题（不阻止保存，作为提醒返回）。 */
export function lintSystem(ds: DesignSystem): string[] {
  const out: string[] = [];
  const names = new Set(ds.color.tokens.map((t) => t.name));
  for (const need of ['bg', 'fg', 'primary', 'on-primary', 'muted-fg', 'border']) if (!names.has(need)) out.push(`缺少颜色 ${need}`);
  for (const t of ds.color.tokens) {
    const role = colorRole(t.name);
    for (const b of t.on ?? role?.on ?? []) if (!names.has(b) && (t.on ?? []).includes(b)) out.push(`${t.name}.on 指向不存在的颜色 ${b}`);
    if (!t.usage && !role) out.push(`颜色 ${t.name} 没有写用途（usage）`);
  }
  const sizes = Object.values(ds.type.scale).sort((a, b) => a - b);
  for (let i = 1; i < sizes.length; i++) if (sizes[i] - sizes[i - 1] < 2) out.push(`字阶中 ${sizes[i - 1]} 与 ${sizes[i]} 相差不到 2px，看不出层级`);
  for (const s of ds.type.styles) {
    if (typeof s.size === 'string' && !(s.size in ds.type.scale)) out.push(`文字样式 ${s.name} 引用了不存在的字阶 ${s.size}`);
    if (!(s.family in ds.type.families)) out.push(`文字样式 ${s.name} 引用了不存在的字体 ${s.family}`);
  }
  const weights = new Set(ds.type.styles.map((s) => s.weight));
  if (weights.size > 3) out.push(`文字样式用了 ${weights.size} 档字重（${[...weights].sort().join(' / ')}），收敛到两三档`);
  return out;
}

// ---------- 品牌手册 ----------

const swatch = (v: string | undefined) => (v ? `\`${v}\`` : '—');

/** 生成 README（品牌手册）：AI 读它来使用这个系统。 */
export function renderReadme(ds: DesignSystem): string {
  const b = ds.brand;
  const themes = ds.color.themes;
  const first = themes[0]?.id ?? 'light';
  const pairs = auditContrast(ds, true);
  const ratio = (fg: string, theme: string) =>
    pairs
      .filter((p) => p.fg === fg && p.theme === theme)
      .map((p) => `${p.bg} ${p.ratio}${p.ratio < p.min ? ' ⚠' : ''}`)
      .join('，');
  const lines: string[] = [
    `# ${ds.name}`,
    '',
    `设计系统 v${ds.version}（${ds.device === 'desktop' ? '桌面端' : '移动端'}字阶）。画布安装后，节点一律用令牌引用：颜色 \`{color.<名字>}\`、字体 \`{font.<名字>}\`、字号 \`{size.<档>}\`、间距 \`{space.<档>}\`、圆角 \`{radius.<档>}\`、阴影 \`{shadow.<档>}\`。不要直接写色值或阶梯外的数字；确实缺一档时用 design_system({action:"update"}) 加进系统，而不是只在一个画布里加。`,
    '',
  ];
  const brand: Array<[string, string | undefined]> = [
    ['设计概念', b.concept],
    ['题材母题', b.motif],
    ['记忆点', b.signature],
    ['气质', b.mood],
    ['字体与字重', b.typography],
    ['形状与层次', b.shape],
    ['版式', b.layout],
  ];
  if (brand.some(([, v]) => v) || b.avoid?.length || b.notes) {
    lines.push('## 视觉基础', '');
    for (const [k, v] of brand) if (v) lines.push(`- **${k}**：${v}`);
    if (b.avoid?.length) lines.push(`- **不要做**：${b.avoid.join('；')}`);
    if (b.notes) lines.push('', b.notes);
    lines.push('');
  }
  lines.push('## 颜色', '', `主题：${themes.map((t) => `${t.name}（${t.id}）`).join('、')}。第一个主题是默认主题。对比度：正文 ≥ 4.5:1，大字、图标、控件边框与焦点环 ≥ 3:1，⚠ 表示未达标。`, '');
  lines.push(`| 令牌 | ${themes.map((t) => t.name).join(' | ')} | 用途 | 对比度（${themes[0]?.name ?? ''}） |`, `|---|${themes.map(() => '---|').join('')}---|---|`);
  for (const t of ds.color.tokens)
    lines.push(`| \`color.${t.name}\` | ${themes.map((th) => swatch(valueIn(t, th.id, first))).join(' | ')} | ${t.usage ?? colorRole(t.name)?.usage ?? ''} | ${ratio(t.name, first)} |`);
  const styles = [...new Set(themes.map((t) => t.style).filter((x): x is string => !!x))];
  if (styles.length > 1) {
    lines.push(
      '',
      '## 风格',
      '',
      '用户可以在画布的 Tweaks 面板里切换以下风格。第一种是默认风格，“视觉基础”写的就是它；其余风格替换颜色、字体、圆角与阴影令牌，所以颜色、字体、圆角、阴影一律引用令牌，切换才会生效。',
      '',
      '| 风格 | 主题 | 字体（标题 / 正文） | 圆角（sm / md / lg） | 阴影（md） |',
      '|---|---|---|---|---|',
    );
    for (const st of styles) {
      const list = themes.filter((t) => t.style === st);
      const f = flattenSystem(ds, list[0].id);
      lines.push(`| ${st} | ${list.map((t) => `\`${t.id}\``).join(' ')} | ${f['font.heading'] ?? '—'} / ${f['font.body'] ?? '—'} | ${['sm', 'md', 'lg'].map((k) => f[`radius.${k}`] ?? '—').join(' / ')} | ${f['shadow.md'] ?? '—'} |`);
    }
  }
  lines.push('', '## 文字', '');
  lines.push(`字体：${Object.entries(ds.type.families).map(([k, v]) => `\`font.${k}\` = ${v}`).join('；')}`, '');
  lines.push(`字阶：${Object.entries(ds.type.scale).map(([k, v]) => `\`size.${k}\` ${v}`).join(' · ')}`, '');
  lines.push('文字样式是一组固定搭配：文本节点从中选一个，把右列的字段原样写进 style（textStyle 另按语义层级标）。', '');
  lines.push('| 样式 | 字号 | 行高 | 字重 | 字体 | 用途 | style 写法 |', '|---|---|---|---|---|---|---|');
  for (const s of ds.type.styles) {
    const size = typeof s.size === 'number' ? `${s.size}px（展示级）` : `size.${s.size}（${ds.type.scale[s.size] ?? '?'}px）`;
    lines.push(`| ${s.name} | ${size} | ${s.lineHeight} | ${s.weight} | ${s.family} | ${s.usage ?? ''} | \`${JSON.stringify(textRecipe(s))}\` |`);
  }
  const lengths = (title: string, prefix: string, list: DsLength[]) => {
    if (!list.length) return;
    lines.push('', `## ${title}`, '', '| 令牌 | 值 | 用途 |', '|---|---|---|');
    for (const s of list) lines.push(`| \`${prefix}.${s.name}\` | ${s.value} | ${s.usage ?? ''} |`);
  };
  lengths('间距', 'space', ds.spacing);
  lengths('圆角', 'radius', ds.radius);
  lengths('阴影', 'shadow', ds.shadow);
  const comps = Object.values(ds.components);
  lines.push('', '## 组件', '');
  if (comps.length) {
    lines.push('安装时组件定义随令牌一起复制到画布：节点写 `{type, component:"<名字>", text?, overrides?}` 即是实例，不要另画仿制品。', '');
    for (const c of comps) lines.push(`- \`${c.name}\`${c.usage ? `：${c.usage}` : ''}`);
  } else lines.push('还没有组件。画好按钮、输入框、列表项等可复用块后，用 design_system({action:"save_components", names:[…]}) 存进系统，后续画布直接实例化。');
  lines.push(
    '',
    '## 图标',
    '',
    '图标用线性描边风格，同一稿统一线宽（1.5–2px）与尺寸（16 / 20 / 24），颜色跟随文字色（`{color.fg}` 或 `{color.muted-fg}`）。不要用 emoji 代替图标，不要用文字符号（→ › ★）冒充图标。',
  );
  return `${lines.join('\n')}\n`;
}

// ---------- CSS ----------

/** 系统的 CSS 变量：第一个主题写在 :root，其余写在 [data-theme=<id>]，暗色主题再随系统偏好生效。 */
export function systemCss(ds: DesignSystem): string {
  const varName = (k: string) => `--${k.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const block = (sel: string, tokens: Record<string, string>) => `${sel}{\n${Object.entries(tokens).map(([k, v]) => `  ${varName(k)}: ${v};`).join('\n')}\n}`;
  // 名字可能含 */ 或 </style>，写进注释前去掉
  const out = [`/* ${ds.name.replace(/[<>*/\\]/g, '')} v${ds.version} — 由 penhold-mcp 设计系统生成 */`, block(':root', flattenSystem(ds))];
  const first = ds.color.themes[0]?.id;
  const switched = themeKeys(ds);
  for (const th of ds.color.themes.slice(1)) {
    const colors = Object.fromEntries(Object.entries(flattenSystem(ds, th.id)).filter(([k]) => switched(k)));
    out.push(block(`[data-theme="${th.id}"]`, colors));
    if (th.id === 'dark' && first !== 'dark') out.push(`@media (prefers-color-scheme: dark){\n${block(':root:not([data-theme="light"])', colors)}\n}`);
  }
  return `${out.join('\n\n')}\n`;
}

// ---------- 从 CSS 变量导入 ----------

/** shadcn / Tailwind 等常见命名 → 本系统的颜色名。 */
const COLOR_ALIASES: Record<string, string> = {
  background: 'bg',
  foreground: 'fg',
  'card-foreground': 'card-fg',
  'muted-foreground': 'muted-fg',
  destructive: 'danger',
  'destructive-foreground': 'on-danger',
  error: 'danger',
  'popover-foreground': 'on-popover',
  surface: 'card',
  'on-surface': 'card-fg',
  'on-background': 'fg',
  text: 'fg',
  'text-muted': 'muted-fg',
};

function colorName(raw: string): string {
  const n = raw.toLowerCase();
  if (COLOR_ALIASES[n]) return COLOR_ALIASES[n];
  const m = /^(.+)-foreground$/.exec(n);
  if (m) return `on-${COLOR_ALIASES[m[1]] ?? m[1]}`;
  return n;
}

/** 把 CSS 颜色值转成 #RRGGBB（hsl()、shadcn 的 "H S% L%"、oklch()）；不认识时原样返回。 */
export function normalizeColor(v: string): string {
  const s = v.trim();
  const p = parseColor(s);
  if (p) return p.alpha < 1 ? s : hex(p.rgb);
  const hslM = /^(?:hsla?\()?\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*(?:[/,]\s*[\d.]+%?\s*)?\)?$/i.exec(s);
  if (hslM) {
    const h = Number(hslM[1]);
    const sat = Number(hslM[2]) / 100;
    const l = Number(hslM[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    return hex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.]+%?\s*)?\)$/i.exec(s);
  if (ok) return fromOklch([Number(ok[1]) / (ok[2] ? 100 : 1), Number(ok[3]), Number(ok[4])]);
  return s;
}

const isColorish = (v: string) => /^(#|rgb|hsl|oklch|oklab|color\()/i.test(v.trim()) || /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%/.test(v.trim());
const toPx = (v: string): number | undefined => {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return undefined;
  return m[2] === 'rem' || m[2] === 'em' ? Number(m[1]) * 16 : Number(m[1]);
};

export interface CssImport {
  /** 主题 id → 扁平令牌。 */
  themes: Record<string, Record<string, string>>;
  /** 认不出的变量。 */
  skipped: string[];
}

/** 解析 CSS 中的自定义属性：:root / @theme 为亮色，.dark / [data-theme=dark] / prefers-color-scheme: dark 为暗色。 */
export function importCss(css: string): CssImport {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const raw: Record<string, Record<string, string>> = { light: {}, dark: {} };
  const stack: string[] = [];
  let buf = '';
  for (const ch of src) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      flush(buf);
      buf = '';
      stack.pop();
    } else if (ch === ';') {
      flush(buf);
      buf = '';
    } else buf += ch;
  }
  function flush(decl: string) {
    const m = /^\s*--([a-zA-Z0-9_-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (!m) return;
    const dark = stack.some((s) => /\.dark\b|\[data-theme=["']?dark|\[data-mode=["']?dark|prefers-color-scheme:\s*dark/i.test(s));
    raw[dark ? 'dark' : 'light'][m[1]] = m[2].replace(/\s*!important$/, '');
  }
  const resolveVar = (v: string, theme: string, depth = 0): string =>
    depth > 5 ? v : v.replace(/var\(--([a-zA-Z0-9_-]+)(?:,\s*([^)]+))?\)/g, (_, n: string, fb?: string) => resolveVar(raw[theme][n] ?? raw.light[n] ?? fb ?? '', theme, depth + 1));
  const skipped: string[] = [];
  const themes: Record<string, Record<string, string>> = {};
  for (const theme of ['light', 'dark']) {
    const out: Record<string, string> = {};
    let spacingBase: number | undefined;
    for (const [name, v0] of Object.entries(raw[theme])) {
      const v = resolveVar(v0, theme).trim();
      if (!v) continue;
      let m: RegExpExecArray | null;
      if ((m = /^(?:font-family|font)-(.+)$/.exec(name)) && !/^(size|weight)/.test(m[1]) && !toPx(v)) {
        const k = m[1] === 'sans' ? 'body' : /^(serif|display|heading|title)$/.test(m[1]) ? 'heading' : m[1];
        out[`font.${k}`] = v.replace(/var\([^)]*\)\s*,?\s*/g, '').replace(/^,\s*/, '');
      } else if ((m = /^(?:text|font-size|size|fs)-([a-z0-9]+)$/.exec(name)) && toPx(v) !== undefined) {
        out[`size.${m[1].replace(/^base$/, 'md')}`] = `${toPx(v)}px`;
      } else if (name === 'spacing' && toPx(v) !== undefined) {
        spacingBase = toPx(v);
      } else if ((m = /^(?:spacing|space)-([a-z0-9]+)$/.exec(name)) && toPx(v) !== undefined) {
        out[`space.${m[1]}`] = `${toPx(v)}px`;
      } else if (name === 'radius' && toPx(v) !== undefined) {
        const r = toPx(v)!;
        out['radius.sm'] ??= `${Math.max(0, r - 4)}px`;
        out['radius.md'] ??= `${r}px`;
        out['radius.lg'] ??= `${r + 4}px`;
      } else if ((m = /^(?:radius|rounded)-([a-z0-9]+)$/.exec(name))) {
        out[`radius.${m[1]}`] = toPx(v) !== undefined ? `${toPx(v)}px` : v;
      } else if ((m = /^shadow-([a-z0-9]+)$/.exec(name))) {
        out[`shadow.${m[1]}`] = v;
      } else if (isColorish(v)) {
        out[`color.${colorName(name.replace(/^color-/, ''))}`] = normalizeColor(v);
      } else if (theme === 'light') skipped.push(`--${name}`);
    }
    if (spacingBase && !Object.keys(out).some((k) => k.startsWith('space.')))
      [1, 2, 3, 4, 6, 8, 12, 16].forEach((n, i) => (out[`space.${i + 1}`] = `${spacingBase! * n}px`));
    if (Object.keys(out).length) themes[theme] = out;
  }
  return { themes, skipped };
}

/** 读入 Claude Design 的 tokens.json（color.themes + color.tokens 列表）。 */
export function importTokensJson(json: unknown): CssImport | undefined {
  const j = json as {
    color?: { themes?: Array<{ id: string }>; tokens?: Array<{ name: string; value: string | Record<string, string> }> };
    type?: { families?: Record<string, string>; groups?: Array<{ styles?: Array<{ name: string; fontSize?: string }> }> };
    spacing?: { tokens?: DsLength[] };
    radius?: { tokens?: DsLength[] };
    shadow?: { tokens?: DsLength[] };
  };
  if (!j || typeof j !== 'object' || !j.color?.tokens) return undefined;
  const ids = j.color.themes?.map((t) => t.id) ?? ['light'];
  const themes: Record<string, Record<string, string>> = {};
  for (const id of ids) {
    const out: Record<string, string> = {};
    for (const t of j.color.tokens) {
      const v = typeof t.value === 'string' ? t.value : (t.value[id] ?? t.value[ids[0]]);
      if (v) out[`color.${colorName(t.name)}`] = normalizeColor(v);
    }
    if (id === ids[0]) {
      for (const [k, v] of Object.entries(j.type?.families ?? {})) out[`font.${k === 'sans' ? 'body' : k === 'serif' || k === 'display' ? 'heading' : k}`] = v;
      for (const s of j.spacing?.tokens ?? []) out[`space.${s.name.replace(/^space(ing)?-/, '')}`] = s.value;
      for (const s of j.radius?.tokens ?? []) out[`radius.${s.name.replace(/^radius-/, '')}`] = s.value;
      for (const s of j.shadow?.tokens ?? []) out[`shadow.${s.name.replace(/^shadow-/, '')}`] = s.value;
    }
    themes[id] = out;
  }
  return { themes, skipped: [] };
}

/** 由导入结果建系统：第一个主题为亮色（没有亮色时为暗色），另一个主题的颜色并入。 */
export function systemFromImport(imp: CssImport, init: { id: string; name: string; device?: 'mobile' | 'desktop'; ref?: string }): DesignSystem {
  const ids = Object.keys(imp.themes);
  const firstId = ids.includes('light') ? 'light' : ids[0];
  const themeName = (id: string) => (id === 'light' ? '亮色' : id === 'dark' ? '暗色' : id);
  const ds = systemFromFlat(imp.themes[firstId] ?? {}, { ...init, theme: { id: firstId, name: themeName(firstId) }, source: { kind: 'import', ...(init.ref ? { ref: init.ref } : {}) } });
  for (const id of ids.filter((x) => x !== firstId)) {
    const colors = Object.entries(imp.themes[id]).filter(([k]) => k.startsWith('color.'));
    if (!colors.length) continue;
    ds.color.themes.push({ id, name: themeName(id) });
    for (const [k, v] of colors) {
      const name = k.slice(6);
      const t = ds.color.tokens.find((x) => x.name === name);
      if (t) t.value[id] = v;
      else ds.color.tokens.push({ name, value: { [firstId]: v, [id]: v } });
    }
  }
  return ds;
}
