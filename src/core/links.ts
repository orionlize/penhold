import { FRAME_GAP } from './doc.js';
import type { DesignDoc, Node, ProtoAction } from './types.js';
// 跳转目标的写法：本画布 "#<画板id>"，跨画布 "#<画布id>/<画板id>"（画布 id 是 UUID），返回 "#back"。
// 同一项目里每轮迭代可以单独开一个画布，新页面用跨画布链接跳到旧画布里的页面。前后端与导出脚本共用，不依赖 DOM / Node。

export const BACK_HREF = '#back';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const CANVAS_ID_RE = new RegExp(`^${UUID}$`);
const CROSS_RE = new RegExp(`^#(${UUID})/([A-Za-z0-9_:-]{1,64})$`);

export interface LinkTarget {
  frame: string;
  /** 跨画布时目标画板所在的画布。 */
  canvas?: string;
}

/** 解析 href 的跳转目标；外部链接与 "#back" 返回 undefined。 */
export function hrefTarget(href: string | undefined): LinkTarget | undefined {
  if (!href || !href.startsWith('#') || href === BACK_HREF) return undefined;
  const m = CROSS_RE.exec(href);
  return m ? { canvas: m[1], frame: m[2] } : { frame: href.slice(1) };
}

/** 本画布内的目标画板 id；跨画布、外部链接与 "#back" 返回 undefined。 */
export function hrefFrame(href: string | undefined): string | undefined {
  const t = hrefTarget(href);
  return t && !t.canvas ? t.frame : undefined;
}

/** 生成跳转 href：目标与当前画布相同时写成本画布的短形式。 */
export function linkHref(target: LinkTarget, current?: string): string {
  return target.canvas && target.canvas !== current ? `#${target.canvas}/${target.frame}` : `#${target.frame}`;
}

/**
 * 逐个访问节点子树里的跳转目标（props.href、实例 overrides 里的 href、proto 的 navigate），
 * fn 返回新目标时原地改写。调用方需要保留原树时先 clone。
 */
export function eachLink(root: Node, fn: (t: LinkTarget) => LinkTarget | void) {
  const href = (props: Record<string, string> | undefined) => {
    const t = props && hrefTarget(props.href);
    if (!t) return;
    const r = fn(t);
    if (r) props!.href = linkHref(r);
  };
  const acts = (list: ProtoAction[] | undefined) => {
    for (const a of list ?? []) {
      if (a.do === 'navigate') {
        const r = fn(a.canvas ? { frame: a.frame, canvas: a.canvas } : { frame: a.frame });
        if (r) {
          a.frame = r.frame;
          if (r.canvas) a.canvas = r.canvas;
          else delete a.canvas;
        }
      }
      if (a.do === 'if') (acts(a.then), acts(a.else));
      if (a.do === 'delay' || a.do === 'countdown') acts(a.then);
    }
  };
  const walk = (n: Node) => {
    href(n.props);
    for (const o of Object.values(n.overrides ?? {})) href(o.props);
    if (n.proto) (acts(n.proto.onClick), acts(n.proto.onLoad));
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
}

/** 子树里指向别的画布的跳转目标（去重）。 */
export function crossLinks(roots: Node[]): LinkTarget[] {
  const seen = new Map<string, LinkTarget>();
  for (const r of roots)
    eachLink(r, (t) => {
      if (t.canvas) seen.set(`${t.canvas}/${t.frame}`, t);
    });
  return [...seen.values()];
}

/** 引用卡片：本画布链接到的旧画布页面，在画布上以只读卡片显示（不进入设计稿与导出）。 */
export interface RefCard extends Required<LinkTarget> {
  /** 卡片在画布世界坐标中的位置与尺寸：排在所有画板右侧一列。 */
  x: number;
  y: number;
  w: number;
  h: number;
}
export const REF_CARD_W = 240;
export const REF_CARD_H = 132;
const REF_CARD_GAP = 32;

/** 本画布各画板里跨画布链接的目标，按画板顺序首次出现排列，位置固定可推算（画布显示与流程图排版共用）。 */
export function refCards(doc: Pick<DesignDoc, 'frames' | 'components' | 'canvasId'>): RefCard[] {
  let x0 = 0;
  for (const f of doc.frames) x0 += f.width + FRAME_GAP;
  const seen = new Set<string>();
  const out: RefCard[] = [];
  const add = (t: LinkTarget) => {
    if (!t.canvas || t.canvas === doc.canvasId) return;
    const k = `${t.canvas}/${t.frame}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ canvas: t.canvas, frame: t.frame, x: x0, y: out.length * (REF_CARD_H + REF_CARD_GAP), w: REF_CARD_W, h: REF_CARD_H });
  };
  // 组件里的链接也算：先看画板（按使用位置排序），再看组件定义
  for (const f of doc.frames) for (const t of crossLinks([f.root])) add(t);
  for (const d of Object.values(doc.components)) for (const t of crossLinks([d.root])) add(t);
  return out;
}
