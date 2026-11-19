// 画布批注层：评论图钉、便签、文字、手绘、形状与线条；以及绘制工具的交互层。
// 批注不属于设计稿：不进入导出与撤销，AI 通过 canvas_status 读取。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HEADER_CLEARANCE, HEADER_SCREEN_PX, newId } from '../../../src/core/doc';
import type { Annotation, Frame, Op, StrokeDash } from '../../../src/core/types';
import { frameAt, noteOrigin, placements, toWorld } from '../lib/geom';
import { Icon } from '../lib/icons';
import { commitOps, delNote, effective, noteId, putNote, select, setTool, toast, useStore } from '../store';
import { views } from './Viewport';
import { t } from '../i18n';
import { ColorControls, dashArray, StrokeControls, type StrokeStyle } from '../inspector/Stroke';
import { isLayerNote, noteIcon, noteName } from '../lib/shapes';

const DRAG_KINDS = new Set(['pen', 'rect', 'oval', 'round', 'diamond', 'line', 'arrow']);

/** 不播放入场动画的批注（例如由草稿图钉转成的正式评论，图钉已在原处）。 */
const quiet = new Set<string>();
/** 刚创建（本地或 AI）的批注播放入场动画；加载时已有的批注不播放。 */
function useEnter(note: Annotation, still?: boolean) {
  const [on] = useState(() => !still && !quiet.has(note.id) && Date.now() - note.ts < 1500);
  return on ? 'enter' : '';
}

/** 点所在画板与最深的节点（作为批注指向的对象）。 */
function locate(wx: number, wy: number): { frame?: string; anchor?: string; origin: [number, number] } {
  const doc = useStore.getState().doc;
  const p = frameAt(doc, wx, wy);
  if (!p) return { origin: [0, 0] };
  const chain = views.get(p.f.id)?.hitChain(wx - p.x, wy) ?? [];
  return { frame: p.f.id, anchor: chain[chain.length - 1] ?? p.f.id, origin: [p.x, 0] };
}

function bbox(pts: Array<[number, number]>) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Ramer–Douglas–Peucker 折线简化：去掉抖动产生的冗余点。 */
function simplify(pts: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > best) (best = d), (idx = i);
    }
    if (idx > 0 && best > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 用二次贝塞尔经过相邻点中点连接，得到平滑曲线（消除折线拐角的锯齿感）。 */
function smoothPath(pts: Array<[number, number]>, ox: number, oy: number) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const P = (i: number) => `${f(pts[i][0] - ox)},${f(pts[i][1] - oy)}`;
  if (pts.length < 3) return `M${P(0)}${pts.length > 1 ? ` L${P(1)}` : ''}`;
  let d = `M${P(0)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2 - ox;
    const my = (pts[i][1] + pts[i + 1][1]) / 2 - oy;
    d += ` Q${P(i)} ${f(mx)},${f(my)}`;
  }
  return `${d} L${P(pts.length - 1)}`;
}

/** 钢笔路径：由锚点与对称控制柄生成的三次贝塞尔路径（控制柄为 [0,0] 的线段退化为直线）。 */
function bezierPath(pts: Array<[number, number]>, ctrl: Array<[number, number]> | undefined, closed: boolean | undefined, ox: number, oy: number) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const c = (i: number) => ctrl?.[i] ?? [0, 0];
  const P = (x: number, y: number) => `${f(x - ox)},${f(y - oy)}`;
  const seg = (i: number, j: number) => {
    const [a, b, ca, cb] = [pts[i], pts[j], c(i), c(j)];
    if (!ca[0] && !ca[1] && !cb[0] && !cb[1]) return ` L${P(b[0], b[1])}`;
    return ` C${P(a[0] + ca[0], a[1] + ca[1])} ${P(b[0] - cb[0], b[1] - cb[1])} ${P(b[0], b[1])}`;
  };
  let d = `M${P(pts[0][0], pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += seg(i - 1, i);
  if (closed && pts.length > 2) d += `${seg(pts.length - 1, 0)} Z`;
  return d;
}

/** 钢笔路径的包围点：锚点 + 两侧控制柄（贝塞尔曲线落在控制点凸包内）。 */
function pathHull(note: Pick<Annotation, 'pts' | 'ctrl'>): Array<[number, number]> {
  if (!note.ctrl) return note.pts;
  return note.pts.flatMap(([x, y], i) => {
    const [cx, cy] = note.ctrl![i] ?? [0, 0];
    return cx || cy ? ([[x, y], [x + cx, y + cy], [x - cx, y - cy]] as Array<[number, number]>) : [[x, y] as [number, number]];
  });
}

/** 批注的包围盒（钢笔路径含控制柄）。 */
function noteBox(note: Pick<Annotation, 'kind' | 'pts' | 'ctrl'>) {
  return bbox(note.kind === 'path' ? pathHull(note) : note.pts);
}

/** 批注轮廓的折线近似（用于命中测试），坐标与 pts 相同。 */
function outline(n: Annotation): Array<[number, number]> {
  const b = noteBox(n);
  const [x0, y0, x1, y1] = [b.x, b.y, b.x + b.w, b.y + b.h];
  switch (n.kind) {
    case 'rect':
    case 'round':
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    case 'diamond':
      return [[(x0 + x1) / 2, y0], [x1, (y0 + y1) / 2], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [(x0 + x1) / 2, y0]];
    case 'oval':
      return Array.from({ length: 49 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2;
        return [x0 + (b.w / 2) * (1 + Math.cos(a)), y0 + (b.h / 2) * (1 + Math.sin(a))] as [number, number];
      });
    case 'path': {
      const c = (i: number) => n.ctrl?.[i] ?? [0, 0];
      const out: Array<[number, number]> = [n.pts[0]];
      const seg = (i: number, j: number) => {
        const [p0, p3] = [n.pts[i], n.pts[j]];
        const p1 = [p0[0] + c(i)[0], p0[1] + c(i)[1]];
        const p2 = [p3[0] - c(j)[0], p3[1] - c(j)[1]];
        for (let k = 1; k <= 16; k++) {
          const t = k / 16;
          const u = 1 - t;
          out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
        }
      };
      for (let i = 1; i < n.pts.length; i++) seg(i - 1, i);
      if (n.closed && n.pts.length > 2) seg(n.pts.length - 1, 0);
      return out;
    }
    default:
      return n.pts;
  }
}

function distToPolyline(p: [number, number], pts: Array<[number, number]>) {
  if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/** 射线法：点是否落在闭合折线内。 */
function insidePolygon(p: [number, number], poly: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const CLOSED_KINDS = new Set(['rect', 'round', 'oval', 'diamond']);

/**
 * 世界坐标处的笔迹 / 形状（评论关联用）。优先命中描边（最上层，容差随缩放保持屏幕像素不变）；
 * 其次命中闭合形状内部、铅笔 / 开放钢笔路径的包围盒内部（取面积最小者，嵌套时选中更具体的那个）。
 * 直线与箭头只命中描边。
 */
function noteAt(wx: number, wy: number): Annotation | null {
  const s = useStore.getState();
  let inner: Annotation | null = null;
  let innerArea = Infinity;
  for (let i = s.notes.length - 1; i >= 0; i--) {
    const n = s.notes[i];
    if (!isLayerNote(n)) continue;
    const [ox, oy] = noteOrigin(s.doc, n);
    const tol = Math.max(7, (n.width ?? 2.5) / 2 + 4) / s.zoom;
    const b = noteBox(n);
    const p: [number, number] = [wx - ox, wy - oy];
    if (p[0] < b.x - tol || p[0] > b.x + b.w + tol || p[1] < b.y - tol || p[1] > b.y + b.h + tol) continue;
    const line = outline(n);
    if (distToPolyline(p, line) <= tol) return n;
    const area = b.w * b.h;
    if (area >= innerArea) continue;
    const closed = CLOSED_KINDS.has(n.kind) || (n.kind === 'path' && n.closed && n.pts.length > 2);
    const inBox = p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
    const hit = closed ? insidePolygon(p, line) : (n.kind === 'pen' || n.kind === 'path') && inBox;
    if (hit) (inner = n), (innerArea = area);
  }
  return inner;
}

/** 正在绘制的钢笔路径（跨多次点击保留）。 */
interface PathDraft {
  base: Annotation;
  origin: [number, number];
  pts: Array<[number, number]>;
  ctrl: Array<[number, number]>;
}
let pathDraft: PathDraft | null = null;
/** 绘制中的批注附带已放下的锚点数（其后是跟随指针的预览点）。 */
type LiveNote = Annotation & { anchors?: number };

function showPath(cursor?: [number, number]) {
  const d = pathDraft;
  if (!d) return;
  const live: LiveNote = { ...d.base, pts: cursor ? [...d.pts, cursor] : [...d.pts], ctrl: cursor ? [...d.ctrl, [0, 0]] : [...d.ctrl], anchors: d.pts.length };
  useStore.setState({ live });
}

/** 结束钢笔路径：不足 2 个锚点时丢弃。 */
function finishPath(closed: boolean) {
  const d = pathDraft;
  pathDraft = null;
  if (useStore.getState().live) useStore.setState({ live: null });
  if (!d || d.pts.length < 2) return;
  const b = bbox(pathHull(d));
  if (b.w < 3 && b.h < 3) return;
  const curved = d.ctrl.some(([x, y]) => x || y);
  const target = locate(b.x + b.w / 2 + d.origin[0], b.y + b.h / 2 + d.origin[1]);
  putNote({
    ...d.base,
    pts: d.pts,
    ...(curved ? { ctrl: d.ctrl } : {}),
    ...(closed && d.pts.length > 2 ? { closed: true } : {}),
    ...(target.frame === d.base.frame && target.anchor ? { anchor: target.anchor } : {}),
  });
  useStore.setState({ selNote: null });
}

/** 笔触样式写入批注：默认值（实线、批注红）不落盘。 */
function penStyle(st: StrokeStyle): Pick<Annotation, 'width' | 'dash' | 'color'> {
  return { width: st.width, ...(st.dash !== 'solid' ? { dash: st.dash } : {}), ...(st.color ? { color: st.color } : {}) };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 按住 Shift 时把新点约束到相对上一点的 45° 方向。 */
function snap45(from: [number, number], p: [number, number]): [number, number] {
  const dx = p[0] - from[0];
  const dy = p[1] - from[1];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return [r1(from[0] + len * Math.cos(a)), r1(from[1] + len * Math.sin(a))];
}

/** 钢笔：点击放尖角锚点，按住拖动拉出对称控制柄；点起点闭合，点末点结束。 */
function pathDown(e: React.PointerEvent, wx: number, wy: number) {
  const s0 = useStore.getState();
  const zoom = s0.zoom;
  if (!pathDraft) {
    const loc = locate(wx, wy);
    pathDraft = {
      base: { id: noteId(), kind: 'path', frame: loc.frame, pts: [], ts: Date.now(), ...penStyle(s0.pen) },
      origin: loc.origin,
      pts: [],
      ctrl: [],
    };
  }
  const d = pathDraft;
  const toLocal = (x: number, y: number): [number, number] => [r1(x - d.origin[0]), r1(y - d.origin[1])];
  let p = toLocal(wx, wy);
  const last = d.pts[d.pts.length - 1];
  if (last && e.shiftKey) p = snap45(last, p);
  const near = (q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) * zoom <= 6;
  if (d.pts.length > 2 && near(d.pts[0])) return finishPath(true);
  if (last && near(last)) return finishPath(false);
  d.pts.push(p);
  d.ctrl.push([0, 0]);
  const i = d.pts.length - 1;
  showPath();
  const sx = e.clientX;
  const sy = e.clientY;
  const move = (ev: PointerEvent) => {
    if (pathDraft !== d) return;
    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3 && !d.ctrl[i][0] && !d.ctrl[i][1]) return;
    const [x, y] = toWorld(ev.clientX, ev.clientY);
    const q = toLocal(x, y);
    d.ctrl[i] = [r1(q[0] - p[0]), r1(q[1] - p[1])];
    showPath();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (pathDraft === d && d.pts.length >= 4000) finishPath(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ---------------------------------------------------------------------------
// 工具交互层：非选择工具时覆盖整个画布，接管指针事件。

export function ToolLayer() {
  const tool = useStore((s) => s.tool);
  const shapeKind = useStore((s) => s.shape);
  const pathOn = useStore((s) => s.tool === 'pen' && s.pen.mode === 'path');
  // 钢笔：Enter / Esc 结束路径，Backspace 撤回上一个锚点；离开钢笔时提交未完成的路径
  useEffect(() => {
    if (!pathOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (!pathDraft) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finishPath(false);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopImmediatePropagation();
        pathDraft.pts.pop();
        pathDraft.ctrl.pop();
        if (pathDraft.pts.length) showPath();
        else finishPath(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      finishPath(false);
    };
  }, [pathOn]);
  if (tool === 'select' || tool === 'board') return null;
  const kind = tool === 'shape' ? shapeKind : tool;

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const s0 = useStore.getState();
    if (tool === 'hand') {
      const sx = e.clientX;
      const sy = e.clientY;
      const el = e.currentTarget as HTMLElement;
      el.classList.add('grabbing');
      const move = (ev: PointerEvent) => useStore.setState({ panX: s0.panX + ev.clientX - sx, panY: s0.panY + ev.clientY - sy });
      const up = () => {
        el.classList.remove('grabbing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const loc = locate(wx, wy);
    const rel = (x: number, y: number): [number, number] => [Math.round(x - loc.origin[0]), Math.round(y - loc.origin[1])];

    if (tool === 'comment') {
      // 点在笔迹 / 形状上：评论关联到该批注，记下相对其包围盒左上角的偏移，批注移动时图钉跟随
      const hit = noteAt(wx, wy);
      if (hit) {
        const o = noteOrigin(s0.doc, hit);
        const b = noteBox(hit);
        const pt: [number, number] = [Math.round(wx - o[0]), Math.round(wy - o[1])];
        const draft = { frame: hit.frame, anchorNote: hit.id, pts: [pt], rel: [Math.round(pt[0] - b.x), Math.round(pt[1] - b.y)] as [number, number] };
        useStore.setState({ tool: 'select', fly: null, draft, openComment: 'draft', hover: null, hoverNote: hit.id, selNote: null });
        return;
      }
      // 评论关联到点击处的节点：记下相对节点左上角的偏移，节点移动时图钉跟随
      const r = loc.frame && loc.anchor ? views.get(loc.frame)?.rect(loc.anchor) : null;
      const pt = rel(wx, wy);
      const draft = { frame: loc.frame, anchor: loc.anchor, pts: [pt], ...(r ? { rel: [Math.round(pt[0] - r.left), Math.round(pt[1] - r.top)] as [number, number] } : {}) };
      // 放下图钉后退出评论模式，恢复为选择光标
      useStore.setState({ tool: 'select', fly: null, draft, openComment: 'draft', hover: loc.anchor ?? null, selNote: null });
      return;
    }
    if (tool === 'text' && loc.frame) return insertText(loc.frame, wx - loc.origin[0], wy);
    if (tool === 'text') {
      const note: Annotation = { id: noteId(), kind: tool, frame: loc.frame, anchor: loc.anchor, pts: [rel(wx, wy)], text: '', ts: Date.now() };
      setTool('select');
      useStore.setState({ notes: [...s0.notes, note], selNote: note.id, editNote: note.id });
      return;
    }
    if (tool === 'note') return noteDown(wx, wy, loc, rel);
    if (pathOn) return pathDown(e, wx, wy);
    if (!DRAG_KINDS.has(kind)) return;
    const isPen = kind === 'pen';
    // 铅笔保留亚像素精度（取整会让放大后的笔迹出现台阶状锯齿）
    const relPen = (x: number, y: number): [number, number] => [Math.round((x - loc.origin[0]) * 10) / 10, Math.round((y - loc.origin[1]) * 10) / 10];
    let pts: Array<[number, number]> = [isPen ? relPen(wx, wy) : rel(wx, wy)];
    const zoom = s0.zoom;
    const minStep = 1.5 / zoom; // 相邻采样点至少间隔 1.5 屏幕像素，过密的点只会放大手抖
    const base = { id: noteId(), kind: kind as Annotation['kind'], frame: loc.frame, ts: Date.now(), ...(isPen ? penStyle(s0.pen) : {}) };
    const move = (ev: PointerEvent) => {
      if (isPen) {
        // 合并事件：高刷新率指针在一帧内的全部采样，曲线更顺滑
        const evs = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
        for (const ce of evs.length ? evs : [ev]) {
          const [x, y] = toWorld(ce.clientX, ce.clientY);
          const p = relPen(x, y);
          const last = pts[pts.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minStep) pts = [...pts, p];
        }
      } else {
        const [x, y] = toWorld(ev.clientX, ev.clientY);
        pts = [pts[0], rel(x, y)];
      }
      useStore.setState({ live: { ...base, pts } });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      useStore.setState({ live: null });
      if (isPen) {
        // 去掉冗余点，并保证不超过服务端 4000 点上限
        let eps = 0.35 / zoom;
        let out = simplify(pts, eps);
        while (out.length > 4000) out = simplify(pts, (eps *= 2));
        pts = out;
      }
      const b = bbox(pts);
      if (pts.length < 2 || (b.w < 3 && b.h < 3)) return;
      // 指向：形状取中心，箭头取终点，手绘取包围盒中心
      const end = kind === 'arrow' || kind === 'line' ? pts[pts.length - 1] : [b.x + b.w / 2, b.y + b.h / 2];
      const target = locate(end[0] + loc.origin[0], end[1] + loc.origin[1]);
      putNote({ ...base, pts, ...(target.frame === loc.frame && target.anchor ? { anchor: target.anchor } : {}) });
      if (tool !== 'pen') setTool('select');
      useStore.setState({ selNote: tool === 'pen' ? null : base.id });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 评论模式：悬停时高亮将要关联的节点
  const onMove = (e: React.PointerEvent) => {
    if (pathOn && pathDraft && !e.buttons) {
      // 钢笔：从上一个锚点到指针的预览线
      const [wx, wy] = toWorld(e.clientX, e.clientY);
      const last = pathDraft.pts[pathDraft.pts.length - 1];
      let p: [number, number] = [r1(wx - pathDraft.origin[0]), r1(wy - pathDraft.origin[1])];
      if (last && e.shiftKey) p = snap45(last, p);
      return showPath(p);
    }
    if (tool !== 'comment') return;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const hn = noteAt(wx, wy)?.id ?? null;
    const h = hn ? null : (locate(wx, wy).anchor ?? null);
    const s = useStore.getState();
    if (s.hover !== h || s.hoverNote !== hn) useStore.setState({ hover: h, hoverNote: hn });
  };
  const onLeave = () => {
    if (pathDraft) showPath();
    useStore.setState({ hover: null, hoverNote: null });
  };
  return <div className={`tool-layer t-${tool}`} onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={onLeave} onDoubleClick={() => pathOn && finishPath(false)} />;
}

/** 便签默认尺寸（单击放置时）与拖拽 / 缩放的最小尺寸。 */
const NOTE_W = 160;
const NOTE_H = 120;
const NOTE_MIN = 40;

/** 便签工具：与矩形相同，拖出便签的大小；单击则放置默认尺寸的便签。松手后进入编辑。 */
function noteDown(wx: number, wy: number, loc: ReturnType<typeof locate>, rel: (x: number, y: number) => [number, number]) {
  const start = rel(wx, wy);
  const base: Annotation = { id: noteId(), kind: 'note', frame: loc.frame, anchor: loc.anchor, pts: [start, [start[0] + NOTE_W, start[1] + NOTE_H]], text: '', ts: Date.now() };
  const zoom = useStore.getState().zoom;
  let end: [number, number] | null = null;
  const move = (ev: PointerEvent) => {
    const [x, y] = toWorld(ev.clientX, ev.clientY);
    const p = rel(x, y);
    // 拖动距离很小视为单击
    if (!end && Math.hypot(p[0] - start[0], p[1] - start[1]) * zoom < 4) return;
    end = p;
    useStore.setState({ live: { ...base, pts: [start, p] } });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    useStore.setState({ live: null });
    let pts = base.pts;
    if (end) {
      // 规范化为左上 → 右下，并保证最小尺寸（从起点朝拖动方向延伸）
      const e = end as [number, number];
      const w = Math.max(NOTE_MIN, Math.abs(e[0] - start[0]));
      const h = Math.max(NOTE_MIN, Math.abs(e[1] - start[1]));
      const x0 = e[0] < start[0] ? start[0] - w : start[0];
      const y0 = e[1] < start[1] ? start[1] - h : start[1];
      pts = [[x0, y0], [x0 + w, y0 + h]];
    }
    const note: Annotation = { ...base, pts };
    setTool('select');
    useStore.setState((s) => ({ notes: [...s.notes, note], selNote: note.id, editNote: note.id }));
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const DIRS: Dir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 选中便签的缩放手柄：拖动边或角调整大小（旧的单点便签首次缩放时转为两点矩形）。 */
function ResizeHandles({ note, zoom, box }: { note: Annotation; zoom: number; box: () => { x: number; y: number; w: number; h: number } }) {
  const size = 8 / zoom;
  const onDown = (dir: Dir) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const b0 = box();
    const sx = e.clientX;
    const sy = e.clientY;
    let next: Annotation | null = null;
    dragging = true;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const dy = (ev.clientY - sy) / zoom;
      let { x, y, w, h } = b0;
      if (dir.includes('e')) w = Math.max(NOTE_MIN, b0.w + dx);
      if (dir.includes('s')) h = Math.max(NOTE_MIN, b0.h + dy);
      if (dir.includes('w')) (w = Math.max(NOTE_MIN, b0.w - dx)), (x = b0.x + b0.w - w);
      if (dir.includes('n')) (h = Math.max(NOTE_MIN, b0.h - dy)), (y = b0.y + b0.h - h);
      const { w: _w, ...rest } = note;
      const r = (n: number) => Math.round(n);
      const n: Annotation = { ...rest, pts: [[r(x), r(y)], [r(x + w), r(y + h)]] };
      next = n;
      useStore.setState((s) => ({ notes: s.notes.map((q) => (q.id === note.id ? n : q)) }));
    };
    const up = () => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (next) putNote(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <>
      {DIRS.map((d) => (
        <div key={d} className={`note-handle h-${d}`} style={{ width: size, height: size, margin: -size / 2, borderWidth: 1.5 / zoom }} onPointerDown={onDown(d)} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// AI 说明与画板避让：说明框不能盖住画板内容。

/** 说明框与其上方画板底边的最小间距（px）。 */
const BELOW_GAP = 20;
/** 文字与右侧相邻画板的最小间距（px）。 */
const SIDE_GAP = 8;
const isWide = (ch: string) => /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch);

/** AI 文字的最大宽度：从文字左端到右侧最近画板的左边，避免伸进相邻画板（位于画板上方的标题区以上时不限）。 */
function gapWidth(note: Pick<Annotation, 'pts'>, wx: number, wy: number): number | undefined {
  if (wy < -HEADER_CLEARANCE) return undefined;
  const right = placements(useStore.getState().doc).filter((p) => p.x > wx + 1).map((p) => p.x);
  if (!right.length) return undefined;
  return Math.max(40, Math.min(...right) - wx - SIDE_GAP);
}

/** AI 说明的估算占位（相对所在画板）；只处理承载文字的说明框与文字。 */
function aiBox(n: Annotation, ox: number): { x: number; y: number; w: number; h: number } | undefined {
  if (n.kind === 'text' && n.text) {
    const [x, y] = n.pts[0];
    const lines = n.text.split('\n');
    const natural = Math.max(...lines.map((l) => [...l].reduce((w, ch) => w + (isWide(ch) ? 16 : 8.8), 0))) + 8;
    const w = Math.min(n.w ?? 960, natural, gapWidth(n, ox + x, y) ?? Infinity);
    const rows = lines.reduce((k, l) => k + Math.max(1, Math.ceil(([...l].reduce((a, ch) => a + (isWide(ch) ? 16 : 8.8), 0) + 8) / w)), 0);
    return { x, y, w, h: rows * 21 + 4 };
  }
  if ((CLOSED_KINDS.has(n.kind) || n.kind === 'note') && n.pts.length > 1) return noteBox(n);
  return undefined;
}

/**
 * 画板高度变化（auto 高度的画板渲染后变高、内容增加）后，原先放在画板下方的 AI 说明会被画板盖住。
 * 找出与画板重叠的 AI 说明：同一画板下方的说明作为一组整体下移（保持彼此的相对位置），直到不再与任何画板重叠。
 * 返回需要写回的批注。
 */
function clearOfFrames(): Annotation[] {
  const s = useStore.getState();
  if (!s.doc) return [];
  const known = (f: Frame) => s.frameHeights[f.id] ?? (typeof f.height === 'number' ? f.height : undefined);
  const frames = placements(s.doc).flatMap((p) => {
    const h = known(p.f);
    return h === undefined ? [] : [{ id: p.f.id, x: p.x, w: p.f.width, h }];
  });
  const groups = new Map<string, Array<{ n: Annotation; b: { x: number; y: number; w: number; h: number } }>>();
  for (const n of s.notes) {
    if (n.by !== 'ai' || !n.frame) continue;
    const own = frames.find((f) => f.id === n.frame);
    if (!own) continue;
    const b = aiBox(n, own.x);
    // 只处理位于自身画板正下方（顶边在画板顶端以下、横向与画板重叠）的说明；画板之间、上方的说明保持原位
    if (!b || b.y < 0 || b.x >= own.w || b.x + b.w <= 0) continue;
    const g = groups.get(n.frame) ?? [];
    g.push({ n, b: { ...b, x: b.x + own.x } });
    groups.set(n.frame, g);
  }
  const out: Annotation[] = [];
  for (const g of groups.values()) {
    let delta = 0;
    for (let round = 0; round < 8; round++) {
      let need = 0;
      for (const { b } of g)
        for (const f of frames)
          if (b.x < f.x + f.w && f.x < b.x + b.w && b.y + delta < f.h + BELOW_GAP && b.y + delta + b.h > 0) need = Math.max(need, f.h + BELOW_GAP - (b.y + delta));
      if (!need) break;
      delta += Math.ceil(need);
    }
    if (delta) for (const { n } of g) out.push({ ...n, pts: n.pts.map(([x, y]) => [x, y + delta] as [number, number]) });
  }
  return out;
}

/** 有 AI 说明被画板盖住时，等画板高度稳定后把它们移出画板并写回（AI 下次读取时拿到的是新位置）。 */
function useClearOfFrames() {
  const notes = useStore((s) => s.notes);
  const heights = useStore((s) => s.frameHeights);
  const doc = useStore((s) => s.doc);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (dragging || useStore.getState().live) return;
      for (const n of clearOfFrames()) putNote(n);
    }, 400);
    return () => clearTimeout(timer);
  }, [notes, heights, doc]);
}

/** 文字工具点在画板内：插入到命中的最深容器末尾，然后原地编辑。 */
function insertText(frameId: string, lx: number, ly: number) {
  const s = useStore.getState();
  if (!s.doc) return;
  if (s.lock) return toast(t('common.readonly'));
  const chain = views.get(frameId)?.hitChain(lx, ly) ?? [frameId];
  let parent = frameId;
  for (const a of chain) {
    if (a.includes(':')) break; // 实例内部不可插入
    const n = findNode(s.doc.frames, a);
    if (!n) break;
    if (n.component) break;
    if (n.text === undefined && !n.props?.src && n.render !== 'input' && n.render !== 'image' && n.render !== 'text') parent = a;
  }
  const p = findNode(s.doc.frames, parent);
  // 按点击位置决定插入次序：排在中线位于点击点之前的子节点之后
  const view = views.get(frameId);
  const row = p?.layout?.direction === 'row';
  let index = 0;
  for (const c of p?.children ?? []) {
    const r = view?.rect(c.id);
    if (!r || !r.width) {
      index++;
      continue;
    }
    if (row ? r.left + r.width / 2 < lx : r.top + r.height / 2 < ly) index++;
    else break;
  }
  const id = newId('n');
  const op: Op = { op: 'insert', parent, index, node: { id, type: 'text', text: t('tool.text'), box: { width: 'fit' } } }; // 宽度随内容
  commitOps([op]);
  setTool('select');
  useStore.setState({ pendingEdit: id });
}

function findNode(frames: Frame[], id: string) {
  let found: Frame['root'] | undefined;
  const walk = (n: Frame['root']) => {
    if (found) return;
    if (n.id === id) found = n;
    else n.children?.forEach(walk);
  };
  frames.forEach((f) => walk(f.root));
  return found;
}

/** 新建空画板（工具栏“画板”子菜单）。 */
export function createBoard(width: number, height: number, label: string) {
  const s = useStore.getState();
  if (!s.doc) return;
  if (s.lock) return toast(t('common.readonly'));
  const id = newId('f');
  const n = s.doc.frames.length + 1;
  commitOps([{ op: 'frame_create', index: s.doc.frames.length, frame: { id, name: `${label} ${n}`, width, height, root: { id, type: 'page', style: { background: '#FFFFFF' } } } }]);
  setTool('select');
  useStore.setState({ pendingEdit: id });
}

// ---------------------------------------------------------------------------
// 批注渲染层：位于 .world 内，随缩放平移。

export function AnnotationLayer() {
  useClearOfFrames();
  const doc = useStore((s) => s.doc);
  useStore((s) => s.frameHeights);
  const notes = useStore((s) => s.notes);
  const live = useStore((s) => s.live);
  const draft = useStore((s) => s.draft);
  const zoom = useStore((s) => s.zoom);
  const tool = useStore((s) => s.tool);
  useStore((s) => s.version); // 节点变化后重新定位评论图钉
  const ghosts = useStore((s) => s.ghosts);
  const all = live ? [...notes, live] : notes;
  return (
    <div className={`notes ${tool === 'select' ? '' : 'passive'}`}>
      {all.map((n) => {
        const o = noteOrigin(doc, n);
        // 正在绘制的批注随指针出现，不再播放入场动画
        return n.kind === 'comment' ? <Pin key={n.id} note={n} origin={o} zoom={zoom} /> : <Mark key={n.id} note={n} origin={o} zoom={zoom} still={n === live} />;
      })}
      <div className="notes-ghosts">
        {ghosts.map((n) => {
          const o = noteOrigin(doc, n);
          return n.kind === 'comment' ? <Pin key={n.id} note={n} origin={o} zoom={zoom} fx="leave" /> : <Mark key={n.id} note={n} origin={o} zoom={zoom} fx="leave" />;
        })}
      </div>
      {draft && <Pin note={{ id: 'draft', kind: 'comment', pts: draft.pts, frame: draft.frame, anchor: draft.anchor, anchorNote: draft.anchorNote, rel: draft.rel, ts: 0 }} origin={noteOrigin(doc, draft)} zoom={zoom} />}
    </div>
  );
}

/** 正在拖动批注时不做画板避让，松手后再处理。 */
let dragging = false;

/** 选择工具下拖动批注。 */
function useDrag(note: Annotation) {
  return (e: React.PointerEvent) => {
    if (e.button !== 0 || useStore.getState().tool !== 'select') return;
    e.stopPropagation();
    useStore.setState({ selNote: note.id, selection: [] });
    const zoom = useStore.getState().zoom;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved: Annotation | null = null;
    dragging = true;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const dy = (ev.clientY - sy) / zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = { ...note, pts: note.pts.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)] as [number, number]) };
      const m = moved;
      useStore.setState((s) => ({ notes: s.notes.map((n) => (n.id === note.id ? m : n)) }));
    };
    const up = () => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) putNote(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

function Mark({ note, origin, zoom, still, fx }: { note: Annotation; origin: [number, number]; zoom: number; still?: boolean; fx?: 'leave' }) {
  const ghost = fx === 'leave';
  const sel = useStore((s) => !ghost && s.selNote === note.id);
  const editing = useStore((s) => !ghost && s.editNote === note.id);
  const hovered = useStore((s) => !ghost && s.hoverNote === note.id);
  const enter = useEnter(note, still);
  const anim = fx ?? enter;
  const onDown = useDrag(note);
  const el = useRef<HTMLDivElement>(null);
  const [ox, oy0] = origin;
  // 画板标题与工具栏不随缩放变化：缩小画布时，画板上方的 AI 说明整体上移让出它们
  const oy = note.by === 'ai' && note.frame && Math.max(...note.pts.map((p) => p[1])) < 0 ? oy0 - Math.max(0, HEADER_SCREEN_PX / zoom - HEADER_CLEARANCE) : oy0;
  const boxed = CLOSED_KINDS.has(note.kind) && !!note.text;
  const onDouble = () => (note.kind === 'note' || note.kind === 'text' || boxed) && useStore.setState({ editNote: note.id, selNote: note.id });

  if (boxed) {
    // 承载文字的矩形（AI 的说明框）：高度至少为形状高度，文字多时撑高；画板上方的说明框向上长，不伸进画板标题与工具栏
    const b = noteBox(note);
    const up = !!note.frame && b.y + b.h <= 0;
    const box = (
      <div
        className={`mark-box ${note.kind} ${note.by === 'ai' ? 'by-ai' : ''} ${sel ? 'on' : ''} ${hovered && !sel ? 'hover' : ''} ${editing ? 'editing' : ''} ${anim}`}
        style={{ ...(up ? { left: 0, bottom: 0 } : { left: ox + b.x, top: oy + b.y }), width: b.w, minHeight: b.h, ...(note.color ? { background: note.color } : {}), ...(sel || hovered ? { outlineWidth: 1.5 / zoom } : {}) }}
        title={note.by === 'ai' ? t('note.byAi') : undefined}
        onPointerDown={editing ? undefined : onDown}
        onDoubleClick={onDouble}
      >
        {editing ? <NoteEditor note={note} /> : note.text}
      </div>
    );
    return up ? <div className="mark-box-anchor" style={{ left: ox + b.x, top: oy + b.y + b.h }}>{box}</div> : box;
  }

  if (note.kind === 'note' || note.kind === 'text') {
    // 便签为两点矩形（左上、右下），文字多时撑高；旧数据只有一个点，宽度取 w
    const sized = note.kind === 'note' && note.pts.length > 1;
    const b = noteBox(note);
    const size: React.CSSProperties = sized ? { width: b.w, minHeight: b.h, boxSizing: 'border-box' } : note.w ? { width: note.w } : {};
    const maxW = note.kind === 'text' && note.by === 'ai' ? gapWidth(note, ox + b.x, oy + b.y) : undefined;
    return (
      <div
        ref={el}
        className={`mark-${note.kind} ${note.by === 'ai' ? 'by-ai' : ''} ${sel ? 'on' : ''} ${hovered && !sel ? 'hover' : ''} ${editing ? 'editing' : ''} ${anim}`}
        style={{ left: ox + b.x, top: oy + b.y, ...size, ...(maxW !== undefined ? { maxWidth: maxW } : {}), ...(sel || hovered ? { outlineWidth: 1.5 / zoom } : {}) }}
        title={note.by === 'ai' ? t('note.byAi') : undefined}
        onPointerDown={editing ? undefined : onDown}
        onDoubleClick={onDouble}
      >
        {editing ? <NoteEditor note={note} /> : note.text || <span className="ph">{note.kind === 'note' ? t('tool.note') : t('tool.text')}</span>}
        {sel && !still && note.kind === 'note' && note.by !== 'ai' && (
          <ResizeHandles note={note} zoom={zoom} box={() => ({ x: b.x, y: b.y, w: el.current?.offsetWidth ?? b.w, h: el.current?.offsetHeight ?? b.h })} />
        )}
      </div>
    );
  }

  const b = noteBox(note);
  const pad = 8 / zoom;
  const pts = note.pts.map(([x, y]) => `${x - b.x},${y - b.y}`).join(' ');
  let head = '';
  if (note.kind === 'arrow') {
    // 折线箭头按最后一段定方向
    const [a, c] = [note.pts[Math.max(0, note.pts.length - 2)], note.pts[note.pts.length - 1]];
    const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
    const len = 14 / Math.max(zoom, 0.25);
    const tip = (d: number) => `${c[0] - b.x - len * Math.cos(ang + d)},${c[1] - b.y - len * Math.sin(ang + d)}`;
    head = `${tip(0.45)} ${c[0] - b.x},${c[1] - b.y} ${tip(-0.45)}`;
  }
  const penW = note.width ?? 2.5;
  const shape = (cls: string) => {
    const p: { className: string; vectorEffect: 'non-scaling-stroke'; style?: React.CSSProperties } = { className: cls, vectorEffect: 'non-scaling-stroke' };
    if (note.kind === 'pen' || note.kind === 'path') {
      const style = cls === 'ink' ? { strokeWidth: penW, strokeDasharray: dashArray(note.dash, penW), ...(note.color ? { stroke: note.color } : {}) } : { strokeWidth: Math.max(14, penW + 10) };
      const d = note.kind === 'path' ? bezierPath(note.pts, note.ctrl, note.closed, b.x, b.y) : smoothPath(note.pts, b.x, b.y);
      return <path {...p} d={d} style={style} />;
    }
    if ((note.kind === 'line' || note.kind === 'arrow') && cls === 'ink' && (note.color || note.dash)) p.style = { strokeDasharray: dashArray(note.dash, 2.5), ...(note.color ? { stroke: note.color } : {}) };
    if (CLOSED_KINDS.has(note.kind)) {
      // 闭合形状为纯色面积图：只填充、无边框；命中区域为整个形状
      p.className = `${cls} solid`;
      if (cls === 'ink' && note.color) Object.assign(p, { style: { fill: note.color } });
    }
    switch (note.kind) {
      case 'rect':
        return <rect {...p} x={0} y={0} width={b.w} height={b.h} />;
      case 'round':
        return <rect {...p} x={0} y={0} width={b.w} height={b.h} rx={Math.min(16, b.w / 2, b.h / 2)} />;
      case 'oval':
        return <ellipse {...p} cx={b.w / 2} cy={b.h / 2} rx={b.w / 2} ry={b.h / 2} />;
      case 'diamond':
        return <polygon {...p} points={`${b.w / 2},0 ${b.w},${b.h / 2} ${b.w / 2},${b.h} 0,${b.h / 2}`} />;
      default:
        return (
          <>
            <polyline {...p} points={pts} />
            {head && <polyline {...p} points={head} />}
          </>
        );
    }
  };
  return (
    <>
      <svg className={`mark-svg ${note.by === 'ai' ? 'by-ai' : ''} ${anim}`} shapeRendering="geometricPrecision" style={{ left: ox + b.x, top: oy + b.y }} width={Math.max(1, b.w)} height={Math.max(1, b.h)} onPointerDown={onDown}>
        {shape('hit')}
        {shape('ink')}
        {still && note.kind === 'path' && <PathHandles note={note} b={b} zoom={zoom} />}
      </svg>
      {hovered && !sel && <div className="mark-sel hover" style={{ left: ox + b.x - pad, top: oy + b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, borderWidth: 1.5 / zoom }} />}
      {sel && <div className="mark-sel" style={{ left: ox + b.x - pad, top: oy + b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, borderWidth: 1.5 / zoom }} />}
      {sel && (note.kind === 'pen' || note.kind === 'path' || CLOSED_KINDS.has(note.kind)) && <StyleBar note={note} x={ox + b.x + b.w / 2} top={oy + b.y - pad} bottom={oy + b.y + b.h + pad} zoom={zoom} />}
    </>
  );
}

/** 选中的铅笔 / 钢笔笔迹：浮在上方的样式面板（放不下时翻到下方），修改即时生效。 */
function StyleBar({ note, x, top, bottom, zoom }: { note: Annotation; x: number; top: number; bottom: number; zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    const vp = el?.closest('.viewport')?.getBoundingClientRect();
    if (!el || !vp) return;
    // 上方空间不足（会被顶部遮住）时放到笔迹下方
    const selTop = vp.top + useStore.getState().panY + top * zoom;
    const want = selTop - el.getBoundingClientRect().height - 12 < vp.top;
    if (want !== below) setBelow(want);
  });
  const value: StrokeStyle = { width: note.width ?? 2.5, dash: note.dash ?? 'solid', color: note.color };
  const change = (p: Partial<StrokeStyle>) => {
    const next = { ...value, ...p };
    const { width: _w, dash: _d, color: _c, ...rest } = note;
    putNote({ ...rest, ...penStyle(next) });
  };
  return (
    <div
      ref={ref}
      className={`fly mark-style ${below ? 'below' : ''}`}
      role="dialog"
      aria-label={t(CLOSED_KINDS.has(note.kind) ? 'pen.fillBar' : 'pen.styleBar')}
      style={{ left: x, top: below ? bottom : top, transform: `translate(-50%, ${below ? '0' : '-100%'}) scale(${1 / zoom})` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {CLOSED_KINDS.has(note.kind) ? (
        <ColorControls
          color={note.color}
          onChange={(c) => {
            const { color: _c, ...rest } = note;
            putNote({ ...rest, ...(c ? { color: c } : {}) });
          }}
        />
      ) : (
        <StrokeControls value={value} onChange={change} />
      )}
    </div>
  );
}

/** 绘制中的钢笔路径：锚点与控制柄。 */
function PathHandles({ note, b, zoom }: { note: LiveNote; b: { x: number; y: number }; zoom: number }) {
  const n = note.anchors ?? note.pts.length;
  const r = 3.5 / zoom;
  return (
    <g>
      {note.pts.slice(0, n).map(([x, y], i) => {
        const [cx, cy] = note.ctrl?.[i] ?? [0, 0];
        const [ax, ay] = [x - b.x, y - b.y];
        return (
          <g key={i}>
            {(cx !== 0 || cy !== 0) && (
              <>
                <line className="path-arm" vectorEffect="non-scaling-stroke" x1={ax - cx} y1={ay - cy} x2={ax + cx} y2={ay + cy} />
                <circle className="path-knob" vectorEffect="non-scaling-stroke" cx={ax + cx} cy={ay + cy} r={r * 0.75} />
                <circle className="path-knob" vectorEffect="non-scaling-stroke" cx={ax - cx} cy={ay - cy} r={r * 0.75} />
              </>
            )}
            <rect className={`path-anchor ${i === 0 && n > 2 ? 'first' : ''}`} vectorEffect="non-scaling-stroke" x={ax - r} y={ay - r} width={r * 2} height={r * 2} />
          </g>
        );
      })}
    </g>
  );
}

function NoteEditor({ note }: { note: Annotation }) {
  const [text, setText] = useState(note.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  const done = () => {
    useStore.setState({ editNote: null });
    const t = text.trim();
    if (!t) return delNote(note.id);
    putNote({ ...note, text: t });
  };
  return (
    <textarea
      ref={ref}
      className="note-edit"
      value={text}
      placeholder={note.kind === 'note' ? t('note.placeholder') : t('tool.text')}
      onChange={(e) => setText(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// 评论图钉与气泡（不随缩放变大变小）。

/** 图钉位置：优先按关联节点的当前位置 + 偏移，节点不存在时退回创建时的坐标。 */
function pinPos(note: Annotation, origin: [number, number]): [number, number] {
  if (note.anchorNote && note.rel) {
    const s = useStore.getState();
    const target = s.notes.find((n) => n.id === note.anchorNote);
    if (target) {
      const o = noteOrigin(s.doc, target);
      const b = noteBox(target);
      return [o[0] + b.x + note.rel[0], o[1] + b.y + note.rel[1]];
    }
  }
  if (note.frame && note.anchor && note.rel) {
    const r = views.get(note.frame)?.rect(note.anchor);
    if (r && (r.width || r.height)) return [origin[0] + r.left + note.rel[0], origin[1] + r.top + note.rel[1]];
  }
  return [origin[0] + note.pts[0][0], origin[1] + note.pts[0][1]];
}

/** 关联对象的显示名：批注（笔迹 / 形状）或节点。 */
function anchorLabel(anchor: string | undefined, anchorNote?: string): { label: string; missing: boolean } | null {
  if (anchorNote) {
    const n = useStore.getState().notes.find((x) => x.id === anchorNote);
    return n ? { label: noteName(n), missing: false } : { label: t('anchor.deleted'), missing: true };
  }
  const doc = useStore.getState().doc;
  if (!anchor || !doc) return null;
  const frame = doc.frames.find((f) => f.id === anchor);
  if (frame) return { label: t('anchor.board', { name: frame.name }), missing: false };
  const eff = effective(doc, anchor);
  if (!eff) return { label: t('anchor.deleted'), missing: true };
  return { label: eff.node.name ? `${eff.node.name} · ${eff.node.type}` : eff.node.type, missing: false };
}

function Pin({ note, origin, zoom, fx }: { note: Annotation; origin: [number, number]; zoom: number; fx?: 'leave' }) {
  const ghost = fx === 'leave';
  const open = useStore((s) => !ghost && s.openComment === note.id);
  const picked = useStore((s) => !ghost && s.selNote === note.id);
  const isDraft = note.id === 'draft';
  // 草稿图钉总是“落下”；正式评论仅在新建时
  const enter = useEnter(isDraft ? { ...note, ts: Date.now() } : note);
  const anim = fx ?? enter;
  const [x, y] = pinPos(note, origin);
  const hl = (on: boolean) => (note.anchorNote ? useStore.setState({ hoverNote: on ? note.anchorNote : null }) : note.anchor && useStore.setState({ hover: on ? note.anchor : null }));
  // 气泡放不下时翻到左侧 / 下方，避免被侧栏或顶栏遮住
  const wrap = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState('');
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const vp = wrap.current.closest('.viewport')?.getBoundingClientRect();
    const r = wrap.current.getBoundingClientRect();
    if (!vp) return;
    const f = `${r.left + 360 > vp.right ? 'flip-x' : ''} ${r.top - 220 < vp.top ? 'flip-y' : ''}`.trim();
    if (f !== flip) setFlip(f);
  });
  return (
    <div ref={wrap} className={`pin-wrap ${open ? 'open' : ''} ${flip} ${anim}`} style={{ left: x, top: y, transform: `scale(${1 / zoom})` }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button
        className={`pin ${open || picked ? 'on' : ''} ${isDraft ? 'draft' : ''}`}
        aria-label={isDraft ? t('comment.new') : t('comment.label', { n: note.n })}
        aria-expanded={open}
        onMouseEnter={() => hl(true)}
        onMouseLeave={() => hl(false)}
        onClick={() =>
          useStore.setState({
            openComment: open ? null : note.id,
            draft: isDraft && open ? null : useStore.getState().draft,
            // 选中评论：按 Delete 删除
            selNote: isDraft || open ? null : note.id,
            selection: isDraft ? useStore.getState().selection : [],
          })
        }
      >
        {isDraft ? nextCommentNo() : note.n}
      </button>
      {open && (isDraft ? <DraftBubble /> : <CommentBubble note={note} />)}
    </div>
  );
}

/** 新评论将获得的编号（与服务端分配规则一致：现有最大编号 + 1）。 */
function nextCommentNo() {
  return Math.max(0, ...useStore.getState().notes.map((n) => n.n ?? 0)) + 1;
}

function AnchorChip({ anchor, anchorNote }: { anchor?: string; anchorNote?: string }) {
  const a = anchorLabel(anchor, anchorNote);
  if (!a) return null;
  const target = anchorNote ? useStore.getState().notes.find((x) => x.id === anchorNote) : undefined;
  const hl = (on: boolean) => useStore.setState(anchorNote ? { hoverNote: on ? anchorNote : null } : { hover: on ? anchor! : null });
  return (
    <button
      className={`anchor-chip ${a.missing ? 'missing' : ''}`}
      disabled={a.missing}
      title={a.missing ? (anchorNote ?? anchor) : t('comment.selectAnchor', { anchor: anchorNote ? a.label : anchor })}
      onMouseEnter={() => hl(true)}
      onMouseLeave={() => hl(false)}
      onClick={() => {
        if (a.missing) return;
        if (!anchorNote) return select([anchor!]);
        select([]);
        useStore.setState({ selNote: anchorNote, hoverNote: null });
      }}
    >
      <Icon name={target ? noteIcon(target) : 'select'} size={12} />
      <span className="ellipsis">{a.label}</span>
    </button>
  );
}

function DraftBubble() {
  const [text, setText] = useState('');
  const draft = useStore((s) => s.draft);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const grow = () => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(200, t.scrollHeight)}px`;
  };
  const sendIt = () => {
    const d = useStore.getState().draft;
    if (!d || !text.trim()) return;
    const note: Annotation = { id: noteId(), kind: 'comment', frame: d.frame, ...(d.anchorNote ? { anchorNote: d.anchorNote } : { anchor: d.anchor }), ...(d.rel ? { rel: d.rel } : {}), pts: d.pts, text: text.trim(), ts: Date.now() };
    quiet.add(note.id);
    putNote(note);
    useStore.setState({ draft: null, openComment: null, hover: null, hoverNote: null });
  };
  const cancel = () => useStore.setState({ draft: null, openComment: null, hover: null, hoverNote: null });
  return (
    <div className="bubble" data-bubble>
      <div className="bubble-head">
        <span className="bubble-title">{t('comment.newNo', { n: nextCommentNo() })}</span>
        <AnchorChip anchor={draft?.anchor} anchorNote={draft?.anchorNote} />
      </div>
      <textarea
        ref={ref}
        className="bubble-input"
        aria-label={t('comment.content')}
        placeholder={t('comment.placeholder')}
        rows={3}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          grow();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendIt();
          }
          if (e.key === 'Escape') cancel();
        }}
      />
      <div className="bubble-acts">
        <span className="bubble-hint">{t('comment.hint')}</span>
        <button className="ghost sm" onClick={cancel}>
          {t('common.cancel')}
        </button>
        <button className="primary sm" disabled={!text.trim()} onClick={sendIt}>
          {t('comment.send')}
        </button>
      </div>
    </div>
  );
}

function CommentBubble({ note }: { note: Annotation }) {
  return (
    <div className="bubble" data-bubble>
      <div className="bubble-head">
        <span className="avatar">{t('comment.me')}</span>
        <span className="bubble-title">{t('comment.no', { n: note.n })}</span>
        <span className="bubble-time">{timeAgo(note.ts)}</span>
        <AnchorChip anchor={note.anchor} anchorNote={note.anchorNote} />
      </div>
      <div className="bubble-text">{note.text}</div>
      <div className="bubble-acts">
        <span className="bubble-hint">{t('comment.deleteHint')}</span>
        <button className="ghost sm" onClick={() => delNote(note.id)}>
          {t('common.delete')}
        </button>
        <button className="secondary sm" onClick={() => delNote(note.id)}>
          {t('comment.resolve')}
        </button>
      </div>
    </div>
  );
}

function timeAgo(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('time.now');
  if (s < 3600) return t('time.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('time.hour', { n: Math.floor(s / 3600) });
  return new Date(ts).toLocaleDateString();
}
