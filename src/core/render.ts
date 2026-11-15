// 节点树 → HTML/CSS 渲染器。画布与导出共用（PRD 第 5、7 节）。
import { cssNameError, cssValueError, layoutConflicts } from './customCss.js';
import { findFrameOfAddr, getIndex, inferRender, isButton, mergeOverride } from './doc.js';
import { frameVars, hasTemplate, mergeProto, renderTemplate, truthy } from './proto.js';
import type { RuntimeEntry } from './protoEngine.js';
import type { Box, DesignDoc, Frame, Layout, Len, Node, Override, Proto, ProtoValue, Spacing, Style } from './types.js';

/** 播放时需要运行时驱动的节点。 */
export interface ProtoEntry extends RuntimeEntry {
  addr: string;
  kind: string;
}

export interface HNode {
  tag: string;
  attrs: Record<string, string>;
  css: string[];
  states?: { hover?: string[]; focus?: string[]; active?: string[] };
  children: Array<HNode | string>;
  void?: boolean;
}

export interface RenderOptions {
  mode: 'canvas' | 'export';
  /** asset:<hash> → URL；返回 undefined 表示资源缺失。 */
  asset: (hash: string) => string | undefined;
  /** 导出时收集缺失资源。 */
  missingAssets?: Set<string>;
  /**
   * 交互链接（props.href）的渲染方式：返回元素标签与属性；返回 null 表示不渲染为链接。
   * 缺省时导出模式渲染为 <a href>，画布模式不渲染。
   */
  link?: (href: string) => { tag: string; attrs: Record<string, string> } | null;
  /**
   * 交互运行时：提供后，带 proto 或文本模板的节点交给运行时驱动（返回写入 data-dm-p 的编号），
   * 不再按初始状态静态求值显隐与条件样式。
   */
  proto?: (entry: ProtoEntry) => string;
  /** 状态变量；缺省为画板初值。 */
  vars?: Record<string, ProtoValue>;
}

/** 链接到画板："#<画板id>"；返回上一页："#back"。 */
export const BACK_HREF = '#back';
export function hrefFrame(href: string | undefined): string | undefined {
  return href && href.startsWith('#') && href !== BACK_HREF ? href.slice(1) : undefined;
}

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace']);

export const tokenVar = (name: string) => `--${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

/** 值转换：数字→px，{token}→var(--token)。 */
export function cssLen(v: Len | undefined, unitless = false): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return unitless ? String(v) : `${v}px`;
  const m = /^\{([a-zA-Z0-9_.-]+)\}$/.exec(v);
  if (m) return `var(${tokenVar(m[1])})`;
  return v;
}

/** 颜色、渐变、阴影等值：整个值或其中的 "{令牌}" 都转为 var()，如 linear-gradient(90deg, {color.primary}, {color.accent})。 */
const cssVal = (v: string | undefined) => (v === undefined ? undefined : v.replace(/\{([a-zA-Z][a-zA-Z0-9_.-]*)\}/g, (_, name: string) => `var(${tokenVar(name)})`));

function spacing(v: Spacing | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => cssLen(x)).join(' ');
  return cssLen(v);
}

const JUSTIFY: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
  around: 'space-around',
  evenly: 'space-evenly',
};
const ALIGN: Record<string, string> = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline', auto: 'auto' };

export function fontFamilyCss(f: string): string {
  // 整个值是令牌引用（"{font.heading}"）：令牌值在 tokensCss 里已按字体族列表输出
  const ref = /^\{([a-zA-Z0-9_.-]+)\}$/.exec(f.trim());
  if (ref) return `var(${tokenVar(ref[1])})`;
  const parts = f
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  const out = parts.map((p) => (GENERIC.has(p) ? p : `'${p.replace(/'/g, '')}'`));
  if (!parts.some((p) => GENERIC.has(p))) out.push('sans-serif');
  return out.join(', ');
}

function push(css: string[], prop: string, v: string | undefined) {
  if (v !== undefined && v !== '') css.push(`${prop}:${v}`);
}

function lenSize(css: string[], prop: 'width' | 'height', v: Len | undefined, parentDir: 'row' | 'column' | null) {
  if (v === undefined) return;
  if (v === 'fill') {
    const main = (prop === 'width' && parentDir === 'row') || (prop === 'height' && parentDir === 'column');
    if (main) {
      css.push('flex:1 1 0', `min-${prop}:0`);
    } else if (parentDir) css.push('align-self:stretch');
    else css.push(`${prop}:100%`);
    return;
  }
  if (v === 'fit') return void css.push(`${prop}:fit-content`);
  push(css, prop, cssLen(v));
}

/** 按顶层逗号拆分（忽略括号内的逗号，如 rgba(0,0,0,.2)）。 */
function splitTop(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((p) => p.replace(/^inset\s+/i, ''));
}

/** layout：节点的布局字段；自定义 CSS 中与之重复的属性跳过（布局字段优先）。 */
export function styleCss(s: Style | undefined, opts: RenderOptions, layout?: Layout): string[] {
  const css: string[] = [];
  if (!s) return css;
  if (s.fontFamily) push(css, 'font-family', fontFamilyCss(s.fontFamily));
  push(css, 'font-size', cssLen(s.fontSize));
  push(css, 'font-weight', s.fontWeight === undefined ? undefined : cssLen(s.fontWeight as Len, true));
  push(css, 'font-style', s.fontStyle);
  if (s.lineHeight !== undefined) push(css, 'line-height', typeof s.lineHeight === 'number' && s.lineHeight <= 4 ? String(s.lineHeight) : cssLen(s.lineHeight));
  push(css, 'letter-spacing', cssLen(s.letterSpacing));
  push(css, 'text-align', s.textAlign);
  push(css, 'text-decoration', s.textDecoration);
  push(css, 'text-transform', s.textTransform);
  push(css, 'white-space', s.whiteSpace);
  if (s.listStyle && s.listStyle !== 'none') push(css, 'list-style-type', s.listStyle);
  push(css, 'color', cssVal(s.color));
  push(css, 'background', cssVal(s.background));
  if (s.backgroundImage) {
    const url = assetUrl(s.backgroundImage, opts);
    if (url) css.push(`background-image:url("${url}")`, `background-size:${s.backgroundSize ?? 'cover'}`, 'background-position:center', 'background-repeat:no-repeat');
  }
  push(css, 'object-fit', s.objectFit);
  const inner = cssVal(s.innerShadow);
  push(css, 'box-shadow', [cssVal(s.shadow), inner && splitTop(inner).map((p) => `inset ${p}`).join(', ')].filter(Boolean).join(', '));
  push(css, 'text-shadow', cssVal(s.textShadow));
  if (s.opacity !== undefined) push(css, 'opacity', String(s.opacity));
  if (s.blur !== undefined) push(css, 'filter', `blur(${cssLen(s.blur)})`);
  if (s.backdropBlur !== undefined) {
    const b = `blur(${cssLen(s.backdropBlur)})`;
    css.push(`-webkit-backdrop-filter:${b}`, `backdrop-filter:${b}`);
  }
  push(css, 'transform', s.transform);
  push(css, 'cursor', s.cursor);
  // 自定义 CSS 排在最后；已管理的属性即使混进来也跳过，不和结构化字段打架
  if (s.css) {
    const dup = new Set(layoutConflicts(s.css, layout).map(([k]) => k));
    for (const [k, v] of Object.entries(s.css)) if (!dup.has(k) && !cssNameError(k) && !cssValueError(v)) push(css, k, cssVal(v));
  }
  return css;
}

function assetUrl(ref: string, opts: RenderOptions): string | undefined {
  if (!ref) return undefined;
  const m = /^asset:([a-f0-9]+)$/.exec(ref);
  if (!m) return undefined; // 只允许已入库的资源，不引用外部 URL
  const url = opts.asset(m[1]);
  if (!url) opts.missingAssets?.add(m[1]);
  return url;
}

function boxCss(b: Box | undefined, css: string[], parentDir: 'row' | 'column' | null) {
  if (!b) return;
  lenSize(css, 'width', b.width, parentDir);
  lenSize(css, 'height', b.height, parentDir);
  push(css, 'min-width', cssLen(b.minWidth));
  push(css, 'max-width', cssLen(b.maxWidth));
  push(css, 'min-height', cssLen(b.minHeight));
  push(css, 'max-height', cssLen(b.maxHeight));
  push(css, 'margin', spacing(b.margin));
  push(css, 'padding', spacing(b.padding));
  if (b.border) {
    const st = b.border.style ?? 'solid';
    const c = cssVal(b.border.color) ?? 'currentColor';
    const wv = b.border.width ?? 1;
    // [上, 右, 下, 左]；sides 限定只画哪几条边，其余边宽度为 0
    const ws = (Array.isArray(wv) ? (wv.length === 2 ? [wv[0], wv[1], wv[0], wv[1]] : wv) : [wv, wv, wv, wv]).map((x) => cssLen(x)!);
    const only = b.border.sides?.length ? b.border.sides : null;
    const SIDE = ['top', 'right', 'bottom', 'left'] as const;
    const eff = SIDE.map((s, i) => (only && !only.includes(s) ? '0' : ws[i]));
    if (!only && eff.every((x) => x === eff[0])) css.push(`border:${eff[0]} ${st} ${c}`);
    else css.push(`border-style:${st}`, `border-color:${c}`, `border-width:${eff.join(' ')}`);
  }
  if (b.radius !== undefined) push(css, 'border-radius', Array.isArray(b.radius) ? b.radius.map((x) => cssLen(x)).join(' ') : cssLen(b.radius));
}

function layoutCss(l: Layout | undefined, css: string[], kind: string, isContainer: boolean) {
  const display = l?.display ?? (isContainer ? 'flex' : undefined);
  const hasFlexy = l && (l.justify || l.align || l.gap !== undefined || l.direction);
  if (display === 'grid') {
    css.push('display:grid');
    if (l?.columns !== undefined) css.push(`grid-template-columns:${typeof l.columns === 'number' ? `repeat(${l.columns}, minmax(0, 1fr))` : l.columns}`);
    if (l?.rows !== undefined) css.push(`grid-template-rows:${typeof l.rows === 'number' ? `repeat(${l.rows}, auto)` : l.rows}`);
    if (l?.justify) push(css, 'justify-content', JUSTIFY[l.justify]);
    if (l?.align) push(css, 'align-items', ALIGN[l.align]);
  } else if (display === 'flex' || (kind === 'text' && hasFlexy)) {
    css.push('display:flex', `flex-direction:${l?.direction ?? 'column'}`);
    if (l?.wrap) css.push('flex-wrap:wrap');
    if (l?.justify) push(css, 'justify-content', JUSTIFY[l.justify]);
    if (l?.align) push(css, 'align-items', ALIGN[l.align]);
  } else if (display === 'block') css.push('display:block');
  if (l?.gap !== undefined) push(css, l.rowGap !== undefined ? 'column-gap' : 'gap', cssLen(l.gap));
  if (l?.rowGap !== undefined) push(css, 'row-gap', cssLen(l.rowGap));
  if (l?.grow !== undefined) push(css, 'flex-grow', String(l.grow));
  if (l?.shrink !== undefined) push(css, 'flex-shrink', String(l.shrink));
  if (l?.basis !== undefined) push(css, 'flex-basis', cssLen(l.basis));
  if (l?.alignSelf) push(css, 'align-self', ALIGN[l.alignSelf]);
  if (l?.position && l.position !== 'flow' && l.position !== 'relative') css.push(`position:${l.position}`);
  else if (isContainer || l?.position === 'relative') css.push('position:relative');
  for (const k of ['top', 'right', 'bottom', 'left'] as const) push(css, k, cssLen(l?.[k]));
  if (l?.zIndex !== undefined) push(css, 'z-index', String(l.zIndex));
  if (l?.overflow) push(css, 'overflow', l.overflow === 'scroll' ? 'auto' : l.overflow);
}

interface OvFrame {
  prefix: string; // 实例地址
  overrides: Record<string, Override> | undefined;
}

interface Ctx {
  doc: DesignDoc;
  opts: RenderOptions;
  stack: OvFrame[];
  depth: number;
  vars: Record<string, ProtoValue>;
  /** 导出时已在某个 <button> 内（按钮不能嵌套）。 */
  inButton?: boolean;
}

function lookupOverride(ctx: Ctx, addr: string): Override | undefined {
  let out: Override | undefined;
  // 内层先合并，外层后合并以获得优先权
  for (let i = ctx.stack.length - 1; i >= 0; i--) {
    const f = ctx.stack[i];
    if (!f.overrides || !addr.startsWith(f.prefix + ':')) continue;
    const rel = addr.slice(f.prefix.length + 1);
    out = mergeOverride(out, f.overrides[rel]);
  }
  return out;
}

/** 渲染单个节点（含组件实例展开）。addr 为该节点在画布 DOM 中的地址。 */
function renderNode(node: Node, addr: string, parentLayout: Layout | undefined, ctx: Ctx): HNode | null {
  if (ctx.depth > 60) return { tag: 'div', attrs: {}, css: [], children: ['[组件嵌套过深]'] };
  const ov = lookupOverride(ctx, addr);

  let eff = node;
  let instanceFrame: OvFrame | null = null;
  if (node.component) {
    const def = ctx.doc.components[node.component];
    if (def) {
      eff = {
        ...def.root,
        id: node.id,
        name: node.name ?? def.root.name,
        component: node.component,
        layout: node.layout ? { ...def.root.layout, ...node.layout } : def.root.layout,
        text: node.text ?? def.root.text,
        props: node.props ? { ...def.root.props, ...node.props } : def.root.props,
        meta: node.meta,
        proto: mergeProto(def.root.proto, node.proto),
      };
      instanceFrame = { prefix: addr, overrides: node.overrides };
    }
  }
  const hidden = ov?.hidden ?? eff.meta?.hidden;
  if (hidden && ctx.opts.mode === 'export') return null;

  const kind = inferRender(eff);
  const rawText = ov?.text ?? eff.text;
  const proto = eff.proto;
  const runtime = !!ctx.opts.proto && (!!proto || hasTemplate(rawText));
  const text = rawText !== undefined && hasTemplate(rawText) ? renderTemplate(rawText, ctx.vars) : rawText;
  const props = ov?.props ? { ...eff.props, ...ov.props } : eff.props;
  const parentDir: 'row' | 'column' | null =
    parentLayout?.display === 'grid' || parentLayout?.display === 'block' ? null : (parentLayout?.direction ?? 'column');

  const css: string[] = [];
  layoutCss(eff.layout, css, kind, kind === 'container');
  boxCss(eff.box, css, parentDir);
  css.push(...styleCss(eff.style, ctx.opts, eff.layout));
  if (proto && !runtime) {
    // 静态渲染（画布、截图、导出）：按初始状态求值
    for (const c of proto.styles ?? []) if (truthy(c.when, ctx.vars)) css.push(...styleCss(c.style, ctx.opts));
    if (!truthy(proto.show, ctx.vars)) {
      if (ctx.opts.mode === 'export') return null;
      css.push('display:none');
    }
  }
  if (hidden) css.push('display:none');

  const attrs: Record<string, string> = {};
  if (ctx.opts.mode === 'canvas') {
    attrs['data-node-id'] = addr;
  }
  if (runtime)
    attrs['data-dm-p'] = ctx.opts.proto!({
      addr,
      proto: proto ?? {},
      template: hasTemplate(rawText) ? rawText : undefined,
      kind,
      styles: (proto?.styles ?? []).map((c) => ({ when: c.when, css: styleCss(c.style, ctx.opts) })),
    });
  const h: HNode = { tag: 'div', attrs, css, children: [] };
  if (eff.states && ctx.opts.mode === 'export') {
    h.states = {};
    for (const k of ['hover', 'focus', 'active'] as const) if (eff.states[k]) h.states[k] = styleCss(eff.states[k], ctx.opts);
  }

  if (kind === 'image') {
    h.tag = 'img';
    h.void = true;
    const url = props?.src ? assetUrl(props.src, ctx.opts) : undefined;
    if (url) attrs.src = url;
    attrs.alt = props?.alt ?? '';
    if (!eff.style?.objectFit) css.push('object-fit:cover');
    if (!url) css.push('background:#e5e7eb');
  } else if (kind === 'input') {
    const multiline = props?.multiline === 'true';
    h.tag = multiline ? 'textarea' : 'input';
    h.void = !multiline;
    if (props?.placeholder) attrs.placeholder = props.placeholder;
    if (!multiline) attrs.type = props?.inputType && /^[a-z]+$/.test(props.inputType) ? props.inputType : 'text';
    const bound = proto?.bind !== undefined ? ctx.vars[proto.bind] : undefined;
    const value = bound !== undefined && bound !== '' ? String(bound) : (text ?? props?.value);
    if (value) {
      if (multiline) h.children.push(value);
      else attrs.value = value;
    }
    if (ctx.opts.mode === 'canvas') {
      attrs.readonly = '';
      attrs.tabindex = '-1';
    }
  } else {
    let linked = false;
    if (props?.href) {
      const l = ctx.opts.link ? ctx.opts.link(props.href) : ctx.opts.mode === 'export' ? { tag: 'a', attrs: { href: props.href } } : null;
      if (l) {
        linked = true;
        h.tag = l.tag;
        Object.assign(attrs, l.attrs);
        css.push('color:inherit', 'text-decoration:inherit');
        if (!eff.style?.cursor && !eff.style?.css?.cursor) css.push('cursor:pointer');
      }
    }
    if (ctx.opts.mode === 'export' && !linked && !ctx.inButton && isButton(eff)) {
      // 导出为真实按钮；UA 默认样式由 RESET_CSS 清掉
      h.tag = 'button';
      attrs.type = props?.buttonType ?? 'button';
    }
    if (text !== undefined && kind === 'text') {
      if (!eff.style?.whiteSpace) css.push('white-space:pre-wrap');
      const ls = eff.style?.listStyle;
      if (ls && ls !== 'none') {
        // 每行一个列表项（标记悬挂在左侧）；空行用零宽空格撑开高度
        for (const line of text.split('\n')) h.children.push({ tag: 'div', attrs: {}, css: ['display:list-item', 'margin-left:1.4em'], children: [line || '\u200b'] });
      } else h.children.push(text);
    }
  }

  // 子节点
  const kids = eff.children ?? [];
  if (kids.length && !h.void) {
    if (instanceFrame) ctx.stack.push(instanceFrame);
    ctx.depth++;
    const wasInButton = ctx.inButton;
    if (h.tag === 'button') ctx.inButton = true;
    for (const c of kids) {
      const ch = renderNode(c, childAddress(addr, c.id, !!instanceFrame), eff.layout, ctx);
      if (ch) h.children.push(ch);
    }
    ctx.inButton = wasInButton;
    ctx.depth--;
    if (instanceFrame) ctx.stack.pop();
  }
  return h;
}

/**
 * 子节点在画布中的地址：实例的子节点为 "实例地址:子id"；
 * 实例内部普通节点的子节点沿用同一实例前缀；画板中的普通节点直接用子 id。
 */
export function childAddress(addr: string, childId: string, isInstance: boolean): string {
  if (isInstance) return `${addr}:${childId}`;
  const i = addr.lastIndexOf(':');
  return i < 0 ? childId : `${addr.slice(0, i)}:${childId}`;
}

/** 对外：按地址渲染画布中的任一节点（含实例内部节点）。 */
export function renderAddress(doc: DesignDoc, addr: string, opts: RenderOptions): HNode | null {
  const idx = getIndex(doc);
  const segs = addr.split(':');
  const first = idx.get(segs[0]);
  if (!first) return null;
  const fid = findFrameOfAddr(doc, segs[0]);
  const fr = fid ? doc.frames.find((f) => f.id === fid) : undefined;
  const ctx: Ctx = { doc, opts, stack: [], depth: 0, vars: opts.vars ?? (fr ? frameVars(doc, fr) : {}) };
  if (segs.length === 1) {
    if (!first.frame) return null;
    if (!first.parent) return renderFrameRoot(first.frame, ctx);
    return renderNode(first.node, addr, effectiveLayout(doc, first.parent), ctx);
  }
  // 重建实例栈
  let cur = first.node;
  let parentLayout: Layout | undefined;
  let curAddr = segs[0];
  for (let i = 1; i < segs.length; i++) {
    const def = cur.component ? doc.components[cur.component] : undefined;
    if (!def) return null;
    ctx.stack.push({ prefix: curAddr, overrides: cur.overrides });
    const loc = idx.get(segs[i]);
    if (!loc || loc.component !== def.name) return null;
    parentLayout = loc.parent ? effectiveLayout(doc, loc.parent) : undefined;
    cur = loc.node;
    curAddr = `${curAddr}:${segs[i]}`;
  }
  return renderNode(cur, addr, parentLayout, ctx);
}

/** 节点作为父容器时的有效布局（实例取组件定义根的布局）。 */
function effectiveLayout(doc: DesignDoc, n: Node): Layout | undefined {
  if (n.component && doc.components[n.component]) return { ...doc.components[n.component].root.layout, ...n.layout };
  return n.layout;
}

function renderFrameRoot(frame: Frame, ctx: Ctx): HNode {
  const h = renderNode(frame.root, frame.root.id, undefined, ctx) ?? { tag: 'div', attrs: {}, css: [], children: [] };
  h.css = h.css.filter((d) => !/^(width|height|min-height|flex|align-self):/.test(d));
  h.css.push(`width:${frame.width}px`);
  if (frame.height !== 'auto') h.css.push(`min-height:${frame.height}px`);
  return h;
}

export function renderFrame(doc: DesignDoc, frame: Frame, opts: RenderOptions): HNode {
  return renderFrameRoot(frame, { doc, opts, stack: [], depth: 0, vars: opts.vars ?? frameVars(doc, frame) });
}

// ---------- 序列化 ----------

export function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function escAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export interface SerializeState {
  mode: 'inline' | 'class';
  classes: Map<string, string>; // css → class 名
  rules: string[];
  n: number;
}

export function newSerializeState(mode: 'inline' | 'class'): SerializeState {
  return { mode, classes: new Map(), rules: [], n: 0 };
}

export function serialize(h: HNode | string, st: SerializeState, indent = ''): string {
  if (typeof h === 'string') return escHtml(h);
  const attrs: Record<string, string> = { ...h.attrs };
  const classes: string[] = [];
  const decl = h.css.join(';');
  if (decl) {
    if (st.mode === 'inline') attrs.style = decl;
    else {
      let c = st.classes.get(decl);
      if (!c) {
        c = `s${++st.n}`;
        st.classes.set(decl, c);
        st.rules.push(`.${c}{${decl}}`);
      }
      classes.push(c);
    }
  }
  if (h.states && Object.keys(h.states).length) {
    const c = `st${++st.n}`;
    classes.push(c);
    for (const [k, v] of Object.entries(h.states)) if (v?.length) st.rules.push(`.${c}:${k}{${v.join(';')}}`);
  }
  if (classes.length) attrs.class = classes.join(' ');
  const a = Object.entries(attrs)
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escAttr(v)}"`))
    .join('');
  if (h.void) return `<${h.tag}${a}>`;
  const kids = h.children.map((c) => serialize(c, st, indent));
  return `<${h.tag}${a}>${kids.join('')}</${h.tag}>`;
}

export const RESET_CSS = `*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{margin:0}
body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.4;color:#111;-webkit-font-smoothing:antialiased}
img{display:block;max-width:none}
input,textarea{font:inherit;color:inherit;border:0;outline:0;background:transparent;resize:none}
button{appearance:none;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;text-align:inherit;border:0;background:transparent;cursor:pointer}
a{color:inherit}`;

export function tokensCss(tokens: Record<string, string>): string {
  // 字体令牌按字体族列表输出（族名加引号、补通用回退），节点里用 fontFamily:"{font.heading}" 引用
  const decls = Object.entries(tokens).map(([k, v]) => `${tokenVar(k)}:${k.startsWith('font.') && !/^\{.*\}$|^var\(/.test(v.trim()) ? fontFamilyCss(v) : (cssLen(v) ?? v)}`);
  return decls.length ? `:root{${decls.join(';')}}` : '';
}

/** 收集子树用到的令牌名。 */
export function collectTokenRefs(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const m = /^\{([a-zA-Z0-9_.-]+)\}$/.exec(value);
    if (m) out.add(m[1]);
    const v = /var\(--([a-zA-Z0-9_-]+)\)/g;
    let mm;
    while ((mm = v.exec(value))) out.add(mm[1]);
  } else if (Array.isArray(value)) value.forEach((x) => collectTokenRefs(x, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((x) => collectTokenRefs(x, out));
  return out;
}

/** 收集字体族与字重。 */
export function collectFonts(doc: DesignDoc, nodes: Node[]): Array<{ family: string; weights: number[] }> {
  const map = new Map<string, Set<number>>();
  const seenComp = new Set<string>();
  const visit = (n: Node) => {
    const all = [n.style, n.states?.hover, n.states?.focus, n.states?.active];
    for (const s of all) {
      if (s?.fontFamily) {
        const ref = /^\{([a-zA-Z0-9_.-]+)\}$/.exec(s.fontFamily.trim());
        const value = ref ? (doc.tokens[ref[1]] ?? '') : s.fontFamily;
        for (const fam of value.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, ''))) {
          if (!fam || GENERIC.has(fam)) continue;
          const set = map.get(fam) ?? new Set();
          set.add(typeof s.fontWeight === 'number' ? s.fontWeight : Number(s.fontWeight) || 400);
          map.set(fam, set);
        }
      }
    }
    if (n.component && !seenComp.has(n.component) && doc.components[n.component]) {
      seenComp.add(n.component);
      visit(doc.components[n.component].root);
    }
    n.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return [...map.entries()].map(([family, w]) => ({ family, weights: [...w].sort((a, b) => a - b) }));
}
