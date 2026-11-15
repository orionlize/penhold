// 自定义 CSS（style.css）：补充属性面板里没有的属性。
// 面板里能添加 / 编辑的字段（宽高、边距、背景、字体…）不允许在这里重复写，避免两处配置互相覆盖。
// 只有 AI 能写的布局字段（zIndex、overflow、top… 见 LAYOUT_CSS）在面板里统一并入自定义 CSS 编辑：
// 两边都能写，但同一个节点上只能设一处（见 layoutConflicts）。
import type { Layout } from './types.js';

/** 单条自定义属性数量上限。 */
export const CUSTOM_CSS_MAX = 30;

const NAME_RE = /^-?[a-z][a-z0-9-]{0,47}$/;

/** 精确匹配：CSS 属性 → 管理它的结构化字段（只列面板里可编辑的字段）。 */
const EXACT: Record<string, string> = {
  // layout
  display: 'layout.display',
  'flex-direction': 'layout.direction',
  'flex-flow': 'layout.direction',
  'flex-wrap': 'layout.wrap',
  'justify-content': 'layout.justify',
  'align-items': 'layout.align',
  'place-content': 'layout.justify',
  'place-items': 'layout.align',
  gap: 'layout.gap',
  'column-gap': 'layout.gap',
  'grid-gap': 'layout.gap',
  'grid-column-gap': 'layout.gap',
  'grid-template-columns': 'layout.columns',
  'grid-template-rows': 'layout.rows',
  'grid-template': 'layout.columns',
  grid: 'layout.columns',
  flex: 'layout.grow',
  'flex-grow': 'layout.grow',
  position: 'layout.position',
  // box
  width: 'box.width',
  height: 'box.height',
  'min-width': 'box.minWidth',
  'max-width': 'box.maxWidth',
  'min-height': 'box.minHeight',
  'max-height': 'box.maxHeight',
  'inline-size': 'box.width',
  'block-size': 'box.height',
  // style
  font: 'style.fontFamily',
  'font-family': 'style.fontFamily',
  'font-size': 'style.fontSize',
  'font-weight': 'style.fontWeight',
  'font-style': 'style.fontStyle',
  'line-height': 'style.lineHeight',
  'letter-spacing': 'style.letterSpacing',
  'text-align': 'style.textAlign',
  'text-decoration': 'style.textDecoration',
  'text-decoration-line': 'style.textDecoration',
  'text-transform': 'style.textTransform',
  'white-space': 'style.whiteSpace',
  'list-style': 'style.listStyle',
  'list-style-type': 'style.listStyle',
  color: 'style.color',
  'object-fit': 'style.objectFit',
  'box-shadow': 'style.shadow',
  'text-shadow': 'style.textShadow',
  opacity: 'style.opacity',
  filter: 'style.blur',
  'backdrop-filter': 'style.backdropBlur',
  transform: 'style.transform',
  translate: 'style.transform',
  rotate: 'style.transform',
  scale: 'style.transform',
  // 会整体重置其它属性，统一禁止
  all: 'all',
};

/** 前缀匹配：整族属性（含各边 / 各角 / 逻辑属性写法）。 */
const PREFIX: Array<[string, string]> = [
  ['margin', 'box.margin'],
  ['padding', 'box.padding'],
  ['border-radius', 'box.radius'],
  ['border-top-left-radius', 'box.radius'],
  ['border-top-right-radius', 'box.radius'],
  ['border-bottom-left-radius', 'box.radius'],
  ['border-bottom-right-radius', 'box.radius'],
  ['border-start-', 'box.radius'],
  ['border-end-', 'box.radius'],
  ['border', 'box.border'],
  ['background', 'style.background'],
];

/** 去掉浏览器前缀（-webkit- 等），按标准名判断是否已被管理。 */
function unprefixed(name: string): string {
  return name.replace(/^-(webkit|moz|ms|o)-/, '');
}

/**
 * 该 CSS 属性是否已由结构化字段管理；是则返回字段路径（如 "box.width"），否则 undefined。
 * 自定义属性（--x）也拒绝，避免覆盖设计令牌变量。
 */
export function managedField(name: string): string | undefined {
  const n = unprefixed(name.trim().toLowerCase());
  if (n.startsWith('--')) return 'tokens';
  if (EXACT[n]) return EXACT[n];
  for (const [p, f] of PREFIX) if (n === p || n.startsWith(p.endsWith('-') ? p : `${p}-`)) return f;
  return undefined;
}

/** 值不能夹带 CSS 注入、外部资源或提高优先级。 */
export function cssValueError(v: string): string | undefined {
  if (!v.trim()) return '值不能为空';
  if (v.length > 500) return '值过长（最多 500 字符）';
  if (/[;<>"\\{}]/.test(v) && !/^\{[a-zA-Z0-9_.-]+\}$/.test(v)) return '包含不允许的字符（; < > " \\ { }）；令牌请写成 {token.name}';
  if (/url\s*\(|expression\s*\(|@import|!\s*important/i.test(v)) return '不允许 url()、expression()、@import 或 !important';
  return undefined;
}

/** 属性名错误；managed 时返回对应结构化字段，供提示“请改用 xxx”。 */
export function cssNameError(name: string): { message: string; field?: string } | undefined {
  if (name.startsWith('--')) return { message: `不支持 CSS 自定义属性 "${name}"；请用设计令牌`, field: 'tokens' };
  if (!NAME_RE.test(name)) return { message: `属性名 "${name}" 无效：请用小写连字符写法，如 mix-blend-mode` };
  const f = managedField(name);
  if (f === 'all') return { message: '不允许使用 all', field: f };
  if (f) return { message: `"${name}" 已由 ${f} 字段管理，请直接设置该字段`, field: f };
  return undefined;
}

// ---------------------------------------------------------------------------
// 只有 AI 能写的布局字段 ↔ CSS 属性

/** 布局字段 → 对应的 CSS 属性。面板不单独显示这些字段，而是并入自定义 CSS。 */
export const LAYOUT_CSS = {
  rowGap: 'row-gap',
  shrink: 'flex-shrink',
  basis: 'flex-basis',
  alignSelf: 'align-self',
  top: 'top',
  right: 'right',
  bottom: 'bottom',
  left: 'left',
  zIndex: 'z-index',
  overflow: 'overflow',
} as const satisfies Partial<Record<keyof Layout, string>>;
export type LayoutCssKey = keyof typeof LAYOUT_CSS;
export const LAYOUT_CSS_KEYS = Object.keys(LAYOUT_CSS) as LayoutCssKey[];

/** 与布局字段冲突的 CSS 属性（含简写 / 轴向写法）。 */
const CONFLICT: Record<LayoutCssKey, string[]> = {
  rowGap: ['row-gap', 'grid-row-gap'],
  shrink: ['flex-shrink'],
  basis: ['flex-basis'],
  alignSelf: ['align-self', 'place-self'],
  top: ['top', 'inset', 'inset-block', 'inset-block-start'],
  right: ['right', 'inset', 'inset-inline', 'inset-inline-end'],
  bottom: ['bottom', 'inset', 'inset-block', 'inset-block-end'],
  left: ['left', 'inset', 'inset-inline', 'inset-inline-start'],
  zIndex: ['z-index'],
  overflow: ['overflow', 'overflow-x', 'overflow-y'],
};

const SELF: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', auto: 'auto' };

/** 布局字段值 → CSS 值（与渲染一致）；令牌保留 {name} 写法。 */
export function layoutCssValue(key: LayoutCssKey, v: unknown): string {
  if (key === 'overflow') return v === 'scroll' ? 'auto' : String(v);
  if (key === 'alignSelf') return SELF[String(v)] ?? String(v);
  if (typeof v === 'number') return key === 'zIndex' || key === 'shrink' ? String(v) : `${v}px`;
  return String(v);
}

/** 节点上自定义 CSS 与布局字段重复设置的属性：[CSS 属性, 布局字段]。 */
export function layoutConflicts(css: Record<string, string> | undefined, layout: Layout | undefined): Array<[string, LayoutCssKey]> {
  if (!css || !layout) return [];
  const out: Array<[string, LayoutCssKey]> = [];
  for (const k of LAYOUT_CSS_KEYS) {
    if (layout[k] === undefined) continue;
    for (const name of Object.keys(css)) if (CONFLICT[k].includes(unprefixed(name))) out.push([name, k]);
  }
  return out;
}

export function layoutConflictMessage(name: string, key: LayoutCssKey): string {
  return `"${name}" 与 layout.${key} 重复：同一节点只能设置一处`;
}
