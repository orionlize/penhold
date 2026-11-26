// 同一项目（工作目录）下的多个画布：页面索引、跨画布链接校验、从旧画布复制页面（写时复制）。
// 每轮迭代的新页面画在新画布上，旧页面只读引用，单个画布不会越画越大。
import fs from 'node:fs';
import path from 'node:path';
import { clone, getIndex, newId, walkTree } from '../../core/doc.js';
import { collectTokenRefs } from '../../core/render.js';
import { crossLinks, eachLink, type LinkTarget } from '../../core/links.js';
import { isDocFrame } from '../../core/states.js';
import type { DesignDoc, Frame, Node, Op } from '../../core/types.js';
import { CanvasError, type Canvas } from './canvas.js';
import type { Registry } from './registry.js';

export interface ProjectCanvas {
  canvas_id: string;
  title: string;
  updated_at: string;
  pages: Array<{ id: string; name: string; width: number }>;
}

const MAX_CANVASES = 8;
const MAX_PAGES = 40;

/** 同一工作目录下其他画布的页面清单（只有 id、名称、宽度，供跨画布链接与复制）。 */
export function projectIndex(hub: Registry, cwd: string, exclude?: string): ProjectCanvas[] {
  const out: ProjectCanvas[] = [];
  for (const r of hub.recent(cwd, MAX_CANVASES + 1)) {
    if (r.canvas_id === exclude) continue;
    let doc: DesignDoc;
    try {
      doc = hub.get(r.canvas_id).doc;
    } catch {
      continue;
    }
    const pages = doc.frames.filter((f) => !isDocFrame(f)).slice(0, MAX_PAGES).map((f) => ({ id: f.id, name: f.name, width: f.width }));
    out.push({ ...r, pages });
    if (out.length >= MAX_CANVASES) break;
  }
  return out;
}

/** 找到另一个画布的画板；画布或画板不存在时抛错。 */
export function foreignFrame(hub: Registry, canvasId: string, frameId: string): { canvas: Canvas; frame: Frame } {
  if (!hub.exists(canvasId)) throw new CanvasError(`画布 ${canvasId} 不存在`, 'not_found');
  const canvas = hub.get(canvasId);
  const frame = canvas.doc.frames.find((f) => f.id === frameId);
  if (!frame) throw new CanvasError(`画布 ${canvasId}（${canvas.meta.title}）里没有画板 ${frameId}`, 'not_found');
  return { canvas, frame };
}

/** 检查画板里指向别的画布的链接：目标画布或画板不存在时给出提示。 */
export function crossLinkWarnings(hub: Registry, doc: DesignDoc, frameIds: Iterable<string>): string[] {
  const roots: Array<{ id: string; root: Node }> = [];
  for (const id of frameIds) {
    const f = doc.frames.find((x) => x.id === id);
    if (f) roots.push({ id, root: f.root });
  }
  const out: string[] = [];
  for (const { id, root } of roots)
    for (const t of crossLinks([root])) {
      if (t.canvas === doc.canvasId) out.push(`${id}：跨画布链接指向的就是本画布，直接写 "#${t.frame}"`);
      else if (!hub.exists(t.canvas!)) out.push(`${id}：链接指向不存在的画布 ${t.canvas}`);
      else if (!hub.get(t.canvas!).doc.frames.some((f) => f.id === t.frame)) out.push(`${id}：链接指向画布 ${t.canvas} 里不存在的画板 ${t.frame}`);
    }
  return out;
}

export interface CopyResult {
  ops: Op[];
  frameId: string;
  /** 复制时的取舍说明（同名组件沿用本画布的、令牌值不同等）。 */
  notes: string[];
}

/**
 * 把另一个画布的画板复制到本画布（写时复制：旧画布不动）。
 * 一并复制用到的组件定义、图片资源与缺少的令牌；副本里指向旧画布其他页面的链接改写成跨画布链接。
 */
export function copyFrameOps(src: Canvas, frameId: string, dest: Canvas, opts: { name?: string; index?: number } = {}): CopyResult {
  const frame = src.doc.frames.find((f) => f.id === frameId);
  if (!frame) throw new CanvasError(`画布 ${src.id} 里没有画板 ${frameId}`, 'not_found');
  const notes: string[] = [];
  const ops: Op[] = [];
  const destIdx = getIndex(dest.doc);
  const taken = new Set<string>(destIdx.keys());
  const id = dest.doc.frames.some((f) => f.id === frame.id) || taken.has(frame.id) ? newId('f') : frame.id;
  taken.add(id);

  const root = clone(frame.root);
  root.id = id;
  // 节点 id 与本画布冲突时换新
  walkTree(root, (n) => {
    if (n === root) return;
    if (taken.has(n.id)) {
      let nid = newId();
      while (taken.has(nid)) nid = newId();
      n.id = nid;
    }
    taken.add(n.id);
  });

  // 用到的组件（含组件内部再引用的组件）
  const used = new Set<string>();
  const queue: Node[] = [root];
  while (queue.length) {
    walkTree(queue.shift()!, (n) => {
      if (n.component && !used.has(n.component) && src.doc.components[n.component]) {
        used.add(n.component);
        queue.push(src.doc.components[n.component].root);
      }
    });
  }
  const defs: Node[] = [];
  for (const name of used) {
    if (dest.doc.components[name]) {
      if (JSON.stringify(dest.doc.components[name].root) !== JSON.stringify(src.doc.components[name].root))
        notes.push(`组件 ${name} 本画布已有同名定义，副本沿用本画布的定义`);
      continue;
    }
    const def = { name, root: clone(src.doc.components[name].root) };
    defs.push(def.root);
    ops.push({ op: 'component_define', def });
  }

  // 链接：旧画布里的本地链接改成跨画布链接；指回本画布的跨画布链接改回短形式
  const relink = (t: LinkTarget): LinkTarget | void => {
    if (!t.canvas) return t.frame === frame.id ? { frame: id } : { canvas: src.id, frame: t.frame };
    if (t.canvas === dest.id) return { frame: t.frame };
  };
  for (const r of [root, ...defs]) eachLink(r, relink);

  // 图片资源
  const assetRefs = new Set<string>();
  for (const r of [root, ...defs])
    walkTree(r, (n) => {
      for (const v of [n.props?.src, n.style?.backgroundImage, ...Object.values(n.overrides ?? {}).map((o) => o.props?.src)]) {
        const m = v && /^asset:([a-f0-9]+)$/.exec(v);
        if (m) assetRefs.add(m[1]);
      }
    });
  for (const hash of assetRefs) {
    const a = src.doc.assets[hash];
    if (!a || dest.doc.assets[hash]) continue;
    const from = path.join(src.dir, 'assets', 'images', a.file);
    const to = path.join(dest.dir, 'assets', 'images', a.file);
    try {
      if (!fs.existsSync(to)) fs.copyFileSync(from, to);
      ops.push({ op: 'asset_add', asset: clone(a) });
    } catch {
      notes.push(`图片 ${a.file} 复制失败`);
    }
  }

  // 令牌：本画布缺的补上；值不同的沿用本画布（同一项目一般共用设计系统）
  const refs = new Set<string>();
  for (const r of [root, ...defs]) collectTokenRefs(r, refs);
  const missing: Record<string, string> = {};
  let differ = 0;
  for (const t of refs) {
    const v = src.doc.tokens[t];
    if (v === undefined) continue;
    if (dest.doc.tokens[t] === undefined) missing[t] = v;
    else if (dest.doc.tokens[t] !== v) differ++;
  }
  if (Object.keys(missing).length) ops.unshift({ op: 'set_tokens', tokens: missing });
  if (differ) notes.push(`${differ} 个令牌在两个画布里取值不同，副本按本画布的令牌显示`);

  ops.push({
    op: 'frame_create',
    index: opts.index ?? dest.doc.frames.length,
    frame: { id, name: opts.name ?? frame.name, width: frame.width, height: frame.height, root },
  });
  return { ops, frameId: id, notes };
}
