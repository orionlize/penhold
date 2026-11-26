// AI 说明批注（design_annotate）：便签、文字、箭头、连线，写在画布上但不进入设计稿、导出与撤销栈。
import { FRAME_GAP, frameX, HEADER_CLEARANCE, newId, resolveAddress } from '../../core/doc.js';
import { connect, FlowError, layoutFlow, parseFlow } from '../../core/mermaid.js';
import type { RefCard } from '../../core/links.js';
import type { Annotation, StrokeDash } from '../../core/types.js';
import type { Canvas } from './canvas.js';
import { CanvasError } from './canvas.js';

export type AiNoteKind = 'rect' | 'note' | 'text' | 'arrow' | 'line';
/** 点：[x, y] 相对批注所在画板（无画板时为画布世界坐标）；{frame, x, y} 相对另一个画板，用于跨画板的箭头。 */
export type PointInput = [number, number] | { frame?: string; x: number; y: number };

export interface AiNoteInput {
  id?: string;
  kind: AiNoteKind;
  frame?: string;
  node?: string;
  at?: PointInput;
  from?: PointInput;
  to?: PointInput;
  /** arrow / line 的中间折点。 */
  via?: PointInput[];
  text?: string;
  width?: number;
  height?: number;
  color?: string;
  dash?: StrokeDash;
}

export interface AnnotateArgs {
  add?: AiNoteInput[];
  remove?: string[];
  clear?: boolean | string;
  /** 按意见改完并自检后要关闭的用户评论编号。 */
  resolve?: number[];
  /** Mermaid 流程图：服务端排版成说明框与箭头。 */
  flow?: FlowInput;
}

export interface FlowInput {
  mermaid: string;
  /** 流程图左上角；缺省放在所有画板下方。 */
  at?: [number, number];
  /** at 相对的画板。 */
  frame?: string;
  /** 说明框宽度，缺省 200。 */
  width?: number;
}

/** 引用卡片及其页面名称（流程图里按名称对应旧画布的页面）。 */
export type NamedRef = RefCard & { name: string };

const FLOW_COLORS = { decision: '#FDF1D6', terminal: '#E3F4E8' } as const;

/**
 * 把 Mermaid 流程图转成批注：普通节点排版成说明框，id 或文字与画板 id / 名称相同的节点直接指向该画板。
 * 画板之间相邻的跳转画成画板间的横向箭头，不相邻的从画板上方绕行，避免穿过中间的画板。
 * frameHeights 给出各画板的实际高度（auto 高度的画板由调用方实测）。
 */
export function flowToNotes(c: Canvas, flow: FlowInput, frameHeights: Map<string, number>, refs: NamedRef[] = []): { notes: AiNoteInput[]; frames: string[]; boxes: number } {
  const doc = c.doc;
  let g;
  try {
    g = parseFlow(flow.mermaid);
  } catch (e) {
    if (e instanceof FlowError) throw new CanvasError(`flow：${e.message}`, 'bad_args');
    throw e;
  }
  const frameOf = new Map<string, string>();
  const refOf = new Map<string, NamedRef>();
  for (const n of g.nodes) {
    const f = doc.frames.find((q) => q.id === n.id || q.name === n.id || (n.text !== n.id && q.name === n.text));
    if (f) frameOf.set(n.id, f.id);
    else {
      // 旧画布里被链接的页面（画布上的引用卡片）：按页面 id 或名称对应
      const r = refs.find((q) => q.frame === n.id || q.name === n.id || (n.text !== n.id && q.name === n.text));
      if (r) refOf.set(n.id, r);
    }
  }
  const frameRect = (id: string) => {
    const f = doc.frames.find((q) => q.id === id)!;
    return { x: frameX(doc, id)!, y: 0, w: f.width, h: frameHeights.get(id) ?? (f.height === 'auto' ? 900 : f.height) };
  };
  const bw = Math.round(flow.width ?? 200);
  const textOf = new Map(g.nodes.map((n) => [n.id, n.text]));
  const size = (id: string) => ({ w: bw, h: lineCount(textOf.get(id) ?? id, bw - BOX_PAD * 2, BOX_FONT) * BOX_LINE + BOX_PAD * 2 });
  const placed = layoutFlow(g, size, new Set([...frameOf.keys(), ...refOf.keys()]));
  let ox: number;
  let oy: number;
  if (flow.at) {
    const fx = flow.frame === undefined ? 0 : frameX(doc, flow.frame);
    if (fx === undefined) throw new CanvasError(`flow.frame：画板 ${flow.frame} 不存在`, 'not_found');
    [ox, oy] = [fx + flow.at[0], flow.at[1]];
  } else {
    ox = 0;
    oy = Math.max(0, ...doc.frames.map((f) => frameRect(f.id).h)) + 160;
  }
  const rect = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const p of placed) rect.set(p.id, { x: p.x + ox, y: p.y + oy, w: p.w, h: p.h });
  for (const [id, f] of frameOf) rect.set(id, frameRect(f));
  for (const [id, r] of refOf) rect.set(id, { x: r.x, y: r.y, w: r.w, h: r.h });

  const notes: AiNoteInput[] = [];
  for (const n of g.nodes) {
    if (frameOf.has(n.id) || refOf.has(n.id)) continue;
    const r = rect.get(n.id)!;
    notes.push({ kind: 'rect', at: [r.x, r.y], width: r.w, height: r.h, text: n.text, ...(n.shape !== 'box' ? { color: FLOW_COLORS[n.shape] } : {}) });
  }
  const order = doc.frames.map((f) => f.id);
  const pairLane = new Map<string, number>();
  let above = 0;
  for (const e of g.edges) {
    if (e.from === e.to) continue;
    const a = rect.get(e.from)!;
    const b = rect.get(e.to)!;
    const fa = frameOf.get(e.from);
    const fb = frameOf.get(e.to);
    let pts: Array<[number, number]>;
    if (fa && fb && fa !== fb) {
      const ia = order.indexOf(fa);
      const ib = order.indexOf(fb);
      const key = [fa, fb].sort().join('|');
      const lane = pairLane.get(key) ?? 0;
      pairLane.set(key, lane + 1);
      if (Math.abs(ia - ib) === 1) {
        // 相邻画板：画板间空白里的横向箭头，往返两条错开
        const y = Math.round(Math.min(a.h, b.h, 640) / 2) + lane * 36;
        pts = ia < ib ? [[a.x + a.w, y], [b.x, y]] : [[a.x, y], [b.x + b.w, y]];
      } else {
        // 不相邻：从画板标题上方绕行
        const top = -HEADER_CLEARANCE - 8;
        const laneY = top - 28 - above * 22;
        above++;
        const shift = ((above % 3) - 1) * 24;
        const sx = Math.round(a.x + a.w / 2 + shift);
        const tx = Math.round(b.x + b.w / 2 - shift);
        pts = [[sx, top], [sx, laneY], [tx, laneY], [tx, top]];
      }
    } else pts = connect(a, b);
    notes.push({
      kind: e.arrow ? 'arrow' : 'line',
      from: pts[0],
      to: pts[pts.length - 1],
      ...(pts.length > 2 ? { via: pts.slice(1, -1) } : {}),
      ...(e.dashed ? { dash: 'dashed' as const } : {}),
    });
    if (e.label) {
      // 标签放在中间那一段的中点上方
      const mid = Math.floor((pts.length - 1) / 2);
      const [p, q] = [pts[mid], pts[mid + 1]];
      const vertical = p[0] === q[0];
      const tw = textWidth(e.label, 160);
      const mx = Math.round((p[0] + q[0]) / 2);
      const my = Math.round((p[1] + q[1]) / 2);
      notes.push({ kind: 'text', text: e.label, width: tw, at: vertical ? [mx + 8, my - 10] : [mx - Math.round(tw / 2), my - 26] });
    }
  }
  return { notes, frames: [...new Set(frameOf.values())], boxes: placed.length };
}

const MAX_AI_NOTES = 300;
const BOX_FONT = 14;
const BOX_LINE = 21;
const BOX_PAD = 12;
const TEXT_FONT = 16;
const TEXT_LINE = 21;

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (q: Box, x: number, y: number, w: number, h: number) => x < q.x + q.w && q.x < x + w && y < q.y + q.h && q.y < y + h;
/** 估算单行最宽的文字宽度（px），不超过 max。 */
function textWidth(text: string, max: number) {
  const widest = Math.max(...text.split('\n').map((l) => [...l].reduce((w, ch) => w + (/[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : 0.55), 0)));
  return Math.min(max || 960, Math.ceil(widest * TEXT_FONT) + 8);
}
/** 已有 AI 说明框 / 文字的估算占位。 */
function boxOf(n: Annotation): Box | undefined {
  if (n.kind === 'rect' && n.pts.length > 1) return { x: n.pts[0][0], y: n.pts[0][1], w: n.pts[1][0] - n.pts[0][0], h: n.pts[1][1] - n.pts[0][1] };
  if (n.kind === 'text' && n.text) {
    const w = textWidth(n.text, n.w ?? 0);
    return { x: n.pts[0][0], y: n.pts[0][1], w, h: lineCount(n.text, w, TEXT_FONT) * TEXT_LINE + 4 };
  }
  return undefined;
}

/** 估算文字在给定宽度内的行数（中日韩字符按 1 个字宽，其余按 0.55 个字宽）。 */
function lineCount(text: string, width: number, font: number) {
  const perLine = Math.max(1, width / font);
  return text.split('\n').reduce((n, l) => {
    let w = 0;
    for (const ch of l) w += /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : 0.55;
    return n + Math.max(1, Math.ceil(w / perLine));
  }, 0);
}

/** 批注 id 须为 a_ + 4~24 位字母数字（newId 生成 8 位）。 */
const aiId = () => newId('a');

/** 应用 AI 批注的增删改，返回结果摘要。只能修改 / 删除 AI 自己写的批注。 */
export function applyAnnotations(c: Canvas, args: AnnotateArgs, frameHeights: Map<string, number> = new Map(), refs: NamedRef[] = []) {
  const doc = c.doc;
  const ensureFrame = (id: string | undefined, what: string) => {
    if (id === undefined) return undefined;
    const x = frameX(doc, id);
    if (x === undefined) throw new CanvasError(`${what}：画板 ${id} 不存在`, 'not_found');
    return x;
  };
  const removed: string[] = [];
  const clearTarget = args.clear === true ? '*' : typeof args.clear === 'string' ? args.clear : undefined;
  if (clearTarget) {
    if (clearTarget !== '*') ensureFrame(clearTarget, 'clear');
    for (const n of [...c.notes]) if (n.by === 'ai' && (clearTarget === '*' || n.frame === clearTarget)) (c.deleteNote(n.id), removed.push(n.id));
  }
  for (const id of args.remove ?? []) {
    const n = c.notes.find((x) => x.id === id);
    if (!n) continue;
    if (n.by !== 'ai') throw new CanvasError(`批注 ${id} 是用户写的，AI 不能删除`, 'not_ai_note');
    c.deleteNote(id);
    removed.push(id);
  }
  // 关闭用户评论：只有评论所在画板的改动都已截图自检（AI 确认改好了）才允许关闭
  const resolved: number[] = [];
  for (const no of args.resolve ?? []) {
    const cm = c.notes.find((x) => x.kind === 'comment' && x.by !== 'ai' && x.n === no);
    if (!cm) {
      const open = c.notes.filter((x) => x.kind === 'comment' && x.by !== 'ai').map((x) => `#${x.n}`);
      throw new CanvasError(`评论 #${no} 不存在${open.length ? `（未关闭的评论：${open.join('、')}）` : '（没有未关闭的评论）'}`, 'not_found');
    }
    const frame = cm.frame ?? (cm.anchorNote ? c.notes.find((x) => x.id === cm.anchorNote)?.frame : undefined);
    if (frame && c.pendingCheck.has(frame))
      throw new CanvasError(`评论 #${no} 所在画板 ${frame} 有改动尚未自检：先 design_screenshot 确认已按评论改好，再关闭评论`, 'needs_check');
    c.deleteNote(cm.id);
    resolved.push(no);
  }

  const written: Array<{ id: string; kind: string; frame?: string; box_xywh?: number[]; updated?: boolean; warnings?: string[] }> = [];
  const flow = args.flow ? flowToNotes(c, args.flow, frameHeights, refs) : undefined;
  const adds = [...(args.add ?? []), ...(flow?.notes ?? [])];
  const nAdd = args.add?.length ?? 0;
  if (flow && c.notes.filter((x) => x.by === 'ai').length + flow.notes.length > MAX_AI_NOTES)
    throw new CanvasError(`AI 批注过多（流程图要新增 ${flow.notes.length} 条，上限 ${MAX_AI_NOTES}），先用 remove / clear 清理旧的`);
  for (const [i, a] of adds.entries()) {
    const where = i < nAdd ? `add[${i}]` : 'flow';
    const ox = ensureFrame(a.frame, where) ?? 0;
    const local = (p: PointInput | undefined, name: string): [number, number] => {
      if (!p) throw new CanvasError(`${where}：${a.kind} 需要 ${name}`, 'bad_args');
      if (Array.isArray(p)) return [Math.round(p[0]), Math.round(p[1])];
      if (p.frame?.includes('/')) {
        // "<画布id>/<画板id>"：相对画布上的引用卡片（旧画布里被链接的页面）
        const r = refs.find((q) => `${q.canvas}/${q.frame}` === p.frame);
        if (!r) throw new CanvasError(`${where}.${name}：本画布没有链接到 ${p.frame}，没有对应的引用卡片`, 'not_found');
        return [Math.round(r.x + p.x - ox), Math.round(r.y + p.y)];
      }
      const px = p.frame === undefined ? (a.frame === undefined ? 0 : ox) : ensureFrame(p.frame, `${where}.${name}`)!;
      return [Math.round(px + p.x - ox), Math.round(p.y)];
    };
    const kind = a.kind === 'note' ? 'rect' : a.kind;
    const warnings: string[] = [];
    let pts: Array<[number, number]>;
    if (kind === 'rect' || kind === 'text') {
      if (!a.text?.trim()) throw new CanvasError(`${where}：${a.kind} 需要 text`, 'bad_args');
      let [x, y] = local(a.at, 'at');
      const w = Math.round(a.width ?? (kind === 'rect' ? 320 : 0));
      const est = kind === 'rect' ? lineCount(a.text, w - BOX_PAD * 2, BOX_FONT) * BOX_LINE + BOX_PAD * 2 : lineCount(a.text, w || 960, TEXT_FONT) * TEXT_LINE + 4;
      const h = Math.max(Math.round(a.height ?? 0), est);
      const f = a.frame ? doc.frames.find((q) => q.id === a.frame) : undefined;
      if (f && y < 0 && y + h > -HEADER_CLEARANCE) {
        // 画板上方的说明整体上移，让出画板标题与工具栏；再避开同一画板上已有的说明，依次往上叠
        y = -HEADER_CLEARANCE - h;
        const bw = kind === 'rect' ? w : textWidth(a.text, w);
        const others = c.notes.filter((n) => n.by === 'ai' && n.frame === a.frame && n.id !== a.id).map(boxOf).filter((q): q is Box => !!q);
        for (let hit = others.find((q) => overlaps(q, x, y, bw, h)); hit; hit = others.find((q) => overlaps(q, x, y, bw, h))) y = hit.y - 8 - h;
        warnings.push(`已上移到 y=${y}，避开画板标题与工具栏${y < -HEADER_CLEARANCE - h ? '及其他说明' : ''}`);
      }
      if (f && y >= 0 && x < f.width && x + Math.max(w, 1) > 0 && (f.height === 'auto' || y < f.height))
        warnings.push('位于画板内部，会遮挡界面内容；说明应放在画板上方（y 为负）、下方或画板之间的空白区');
      // 伸进相邻画板：画板之间只有 FRAME_GAP 宽的空白，说明框过宽会盖住旁边的画板
      if (y >= 0) {
        const bw = kind === 'rect' ? w : textWidth(a.text, w);
        let fx = 0;
        for (const q of doc.frames) {
          const left = fx - ox;
          fx += q.width + FRAME_GAP;
          if (q.id === a.frame) continue;
          const qh = q.height === 'auto' ? Infinity : q.height;
          if (x < left + q.width && left < x + bw && y < qh)
            warnings.push(`伸进相邻画板「${q.name}」（${q.id}），会遮挡其界面内容；缩小宽度（画板间空白只有 ${FRAME_GAP}px）或改放到画板上方 / 下方`);
        }
      }
      pts = kind === 'rect' ? [[x, y], [x + w, y + h]] : [[x, y]];
    } else pts = [local(a.from, 'from'), ...(a.via ?? []).map((p, j) => local(p, `via[${j}]`)), local(a.to, 'to')];
    if (a.node) {
      try {
        resolveAddress(doc, a.node);
      } catch {
        throw new CanvasError(`${where}：节点 ${a.node} 不存在`, 'not_found');
      }
    }
    const prev = a.id ? c.notes.find((x) => x.id === a.id) : undefined;
    if (prev && prev.by !== 'ai') throw new CanvasError(`${where}：批注 ${a.id} 是用户写的，AI 不能修改`, 'not_ai_note');
    if (!prev && c.notes.filter((x) => x.by === 'ai').length >= MAX_AI_NOTES) throw new CanvasError(`AI 批注过多（上限 ${MAX_AI_NOTES}），先用 remove / clear 清理旧的`);
    const note: Annotation = {
      id: prev?.id ?? (a.id && /^a_[a-zA-Z0-9]{4,24}$/.test(a.id) ? a.id : aiId()),
      kind,
      ...(a.frame ? { frame: a.frame } : {}),
      ...(a.node ? { anchor: a.node } : {}),
      pts,
      ...(a.text ? { text: a.text } : {}),
      ...(a.width && kind === 'text' ? { w: Math.round(a.width) } : {}),
      ...(a.color ? { color: a.color } : {}),
      ...(a.dash && a.dash !== 'solid' ? { dash: a.dash } : {}),
      by: 'ai',
      ts: Date.now(),
    };
    c.putNote(note);
    written.push({ id: note.id, kind, ...(note.frame ? { frame: note.frame } : {}), ...(kind === 'rect' ? { box_xywh: [pts[0][0], pts[0][1], pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]] } : {}), ...(prev ? { updated: true } : {}), ...(warnings.length ? { warnings } : {}) });
  }

  let x = 0;
  const layout = doc.frames.map((f) => {
    const p = { frame: f.id, name: f.name, x, width: f.width };
    x += f.width + FRAME_GAP;
    return p;
  });
  return {
    written,
    ...(removed.length ? { removed } : {}),
    ...(resolved.length ? { resolved_comments: resolved } : {}),
    ...(flow ? { flow: { boxes: flow.boxes, linked_frames: flow.frames, ids: written.slice(nAdd).map((w) => w.id) } } : {}),
    ai_annotations: c.notes.filter((n) => n.by === 'ai').length,
    frame_layout: layout,
    hint: `画板在画布上从左到右横排，顶端都在 y=0，相邻画板间距 ${FRAME_GAP}px。画板正上方 ${HEADER_CLEARANCE}px 是画板标题与工具栏，说明框底边要在 y=-${HEADER_CLEARANCE} 以上（服务端会自动上移；画板上方的说明框内容变多时向上长），或放在画板下方（y 大于画板高度；auto 高度的画板变高后，画布会把正下方的说明整体下移让出画板）。画板之间的文字会在相邻画板前自动换行，说明框不要宽过画板间空白。`,
  };
}
