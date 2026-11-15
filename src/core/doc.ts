// 文档操作：索引、寻址、应用操作并返回逆操作。前后端共用同一份实现。
import type { ComponentDef, DesignDoc, Frame, Node, Op, Override, RenderKind } from './types.js';

export const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

/** 画布上画板横向排布的间距（px）；画板顶端都在 y=0。 */
export const FRAME_GAP = 120;

/** 画板上方留给画板标题（名称 + 宽度）与画板工具栏（播放 / 导出）的画布高度（px，100% 缩放时）：AI 说明不能伸进这一带。 */
export const HEADER_CLEARANCE = 40;
/** 画板标题与工具栏在屏幕上的高度（px，不随缩放变化）；缩小画布时画板上方的 AI 说明据此整体上移。 */
export const HEADER_SCREEN_PX = 32;

/** 画板左上角在画布世界坐标中的 x（画板按顺序横排，间距 FRAME_GAP）。 */
export function frameX(doc: Pick<DesignDoc, 'frames'>, frameId: string): number | undefined {
  let x = 0;
  for (const f of doc.frames) {
    if (f.id === frameId) return x;
    x += f.width + FRAME_GAP;
  }
  return undefined;
}

export function newId(prefix = 'n'): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const buf = new Uint8Array(8);
  globalThis.crypto.getRandomValues(buf);
  for (const b of buf) s += a[b % a.length];
  return `${prefix}_${s}`;
}

export function emptyDoc(canvasId: string): DesignDoc {
  return { schemaVersion: 1, canvasId, rev: 0, tokens: {}, components: {}, frames: [], assets: {} };
}

export const componentRootId = (name: string) => `cmp_${name}`;

export interface Loc {
  node: Node;
  parent: Node | null;
  frame?: Frame;
  component?: string; // 节点位于该组件定义内
  depth: number;
}

const indexCache = new WeakMap<DesignDoc, Map<string, Loc>>();

export function invalidateIndex(doc: DesignDoc) {
  indexCache.delete(doc);
}

export function getIndex(doc: DesignDoc): Map<string, Loc> {
  let idx = indexCache.get(doc);
  if (idx) return idx;
  idx = new Map();
  const walk = (node: Node, parent: Node | null, depth: number, frame?: Frame, component?: string) => {
    idx!.set(node.id, { node, parent, frame, component, depth });
    for (const c of node.children ?? []) walk(c, node, depth + 1, frame, component);
  };
  for (const f of doc.frames) walk(f.root, null, 0, f);
  for (const d of Object.values(doc.components)) walk(d.root, null, 0, undefined, d.name);
  indexCache.set(doc, idx);
  return idx;
}

export function walkTree(node: Node, fn: (n: Node, parent: Node | null) => void, parent: Node | null = null) {
  fn(node, parent);
  for (const c of node.children ?? []) walkTree(c, fn, node);
}

export function inferRender(n: Node): RenderKind {
  if (n.render) return n.render;
  if (n.text !== undefined) return 'text';
  if (n.props?.src) return 'image';
  return 'container';
}

/** 按钮类节点：写了 props.buttonType，或 type 名以 button / btn 结尾（如 "button" "primary-button" "PrimaryBtn"，不含 "button-group"）。 */
export function isButton(n: Node): boolean {
  return n.props?.buttonType !== undefined || /(button|btn)$/i.test(n.type ?? '');
}

export class DocError extends Error {
  constructor(message: string, public code = 'invalid') {
    super(message);
  }
}

/** 解析出的寻址结果。地址形如 "n_a1" 或实例内部 "n_inst:n_btn"。 */
export interface Resolved {
  addr: string;
  /** 实际存储字段的节点（画板节点或组件定义中的节点）。 */
  target: Loc;
  /** 若地址穿过实例：最外层实例节点与组件内路径。 */
  instance?: { node: Node; path: string };
}

export function resolveAddress(doc: DesignDoc, addr: string): Resolved {
  const idx = getIndex(doc);
  const segs = addr.split(':');
  const first = idx.get(segs[0]);
  if (!first) throw new DocError(`节点 ${segs[0]} 不存在`, 'not_found');
  if (segs.length === 1) return { addr, target: first };
  let cur = first;
  for (let i = 1; i < segs.length; i++) {
    const comp = cur.node.component;
    if (!comp) throw new DocError(`${segs.slice(0, i).join(':')} 不是组件实例`, 'not_found');
    const def = doc.components[comp];
    if (!def) throw new DocError(`组件 ${comp} 不存在`, 'not_found');
    const next = idx.get(segs[i]);
    if (!next || next.component !== comp) throw new DocError(`组件 ${comp} 中没有节点 ${segs[i]}`, 'not_found');
    cur = next;
  }
  return { addr, target: cur, instance: { node: first.node, path: segs.slice(1).join(':') } };
}

/** 节点所在画板 id；组件定义内的节点返回使用该组件的所有画板。 */
export function framesOf(doc: DesignDoc, loc: Loc): string[] {
  if (loc.frame) return [loc.frame.id];
  if (!loc.component) return [];
  const users = componentUsers(doc, loc.component);
  return [...new Set(users.filter((l) => l.frame).map((l) => l.frame!.id))];
}

/** 直接或间接使用某组件的画板节点（实例）。 */
export function componentUsers(doc: DesignDoc, name: string): Loc[] {
  const idx = getIndex(doc);
  const names = new Set([name]);
  // 找出所有（传递地）包含该组件的组件
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of Object.values(doc.components)) {
      if (names.has(d.name)) continue;
      let uses = false;
      walkTree(d.root, (n) => {
        if (n.component && names.has(n.component)) uses = true;
      });
      if (uses) {
        names.add(d.name);
        changed = true;
      }
    }
  }
  const out: Loc[] = [];
  for (const loc of idx.values()) if (loc.frame && loc.node.component && names.has(loc.node.component)) out.push(loc);
  return out;
}

/** 某组件的直接实例（画板中及其他组件定义中）。 */
export function directInstances(doc: DesignDoc, name: string): Loc[] {
  const out: Loc[] = [];
  for (const loc of getIndex(doc).values()) if (loc.node.component === name) out.push(loc);
  return out;
}

/** 组件 a 是否（传递地）依赖组件 b。 */
export function componentDependsOn(doc: DesignDoc, a: string, b: string, seen = new Set<string>()): boolean {
  if (a === b) return true;
  if (seen.has(a)) return false;
  seen.add(a);
  const def = doc.components[a];
  if (!def) return false;
  let found = false;
  walkTree(def.root, (n) => {
    if (!found && n.component && n.component !== a && componentDependsOn(doc, n.component, b, seen)) found = true;
  });
  return found;
}

function childIndex(parent: Node, id: string) {
  return (parent.children ?? []).findIndex((c) => c.id === id);
}

function setOrDelete(obj: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

/** 应用单个操作，返回其逆操作。失败时抛出 DocError，文档保持不变。 */
export function applyOp(doc: DesignDoc, op: Op): Op {
  const idx = getIndex(doc);
  switch (op.op) {
    case 'insert': {
      const p = idx.get(op.parent);
      if (!p) throw new DocError(`父节点 ${op.parent} 不存在`, 'not_found');
      const ids: string[] = [];
      walkTree(op.node, (n) => ids.push(n.id));
      for (const id of ids) if (idx.has(id)) throw new DocError(`节点 id ${id} 已存在`, 'conflict');
      const kids = (p.node.children ??= []);
      const at = Math.max(0, Math.min(op.index, kids.length));
      kids.splice(at, 0, clone(op.node));
      invalidateIndex(doc);
      return { op: 'remove', id: op.node.id };
    }
    case 'remove': {
      const l = idx.get(op.id);
      if (!l) throw new DocError(`节点 ${op.id} 不存在`, 'not_found');
      if (!l.parent) throw new DocError(`不能删除画板或组件的根节点 ${op.id}`);
      const i = childIndex(l.parent, op.id);
      l.parent.children!.splice(i, 1);
      if (l.parent.children!.length === 0) delete l.parent.children;
      invalidateIndex(doc);
      return { op: 'insert', parent: l.parent.id, index: i, node: l.node };
    }
    case 'move': {
      const l = idx.get(op.id);
      const p = idx.get(op.parent);
      if (!l) throw new DocError(`节点 ${op.id} 不存在`, 'not_found');
      if (!p) throw new DocError(`父节点 ${op.parent} 不存在`, 'not_found');
      if (!l.parent) throw new DocError(`不能移动根节点 ${op.id}`);
      if (p.component !== l.component) throw new DocError('不能在组件定义与画板之间移动节点');
      let anc: Node | null = p.node;
      while (anc) {
        if (anc.id === op.id) throw new DocError('不能把节点移动到自己的后代中');
        anc = idx.get(anc.id)?.parent ?? null;
      }
      const oldParent = l.parent.id;
      const oldIndex = childIndex(l.parent, op.id);
      l.parent.children!.splice(oldIndex, 1);
      if (l.parent.children!.length === 0) delete l.parent.children;
      const kids = (p.node.children ??= []);
      kids.splice(Math.max(0, Math.min(op.index, kids.length)), 0, l.node);
      invalidateIndex(doc);
      return { op: 'move', id: op.id, parent: oldParent, index: oldIndex };
    }
    case 'set': {
      const l = idx.get(op.id);
      if (!l) throw new DocError(`节点 ${op.id} 不存在`, 'not_found');
      const prev = clone((l.node as unknown as Record<string, unknown>)[op.field]);
      if (op.field === 'type' && op.value === undefined) throw new DocError('type 不能清除');
      setOrDelete(l.node as unknown as Record<string, unknown>, op.field, clone(op.value));
      return { op: 'set', id: op.id, field: op.field, value: prev };
    }
    case 'set_override': {
      const l = idx.get(op.id);
      if (!l) throw new DocError(`节点 ${op.id} 不存在`, 'not_found');
      if (!l.node.component) throw new DocError(`${op.id} 不是组件实例`);
      const ov = (l.node.overrides ??= {});
      const prev = clone(ov[op.path]);
      setOrDelete(ov, op.path, op.value && Object.keys(op.value).length ? clone(op.value) : undefined);
      if (Object.keys(ov).length === 0) delete l.node.overrides;
      return { op: 'set_override', id: op.id, path: op.path, value: prev };
    }
    case 'set_tokens': {
      const prev: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(op.tokens)) {
        prev[k] = doc.tokens[k] ?? null;
        if (v === null) delete doc.tokens[k];
        else doc.tokens[k] = v;
      }
      return { op: 'set_tokens', tokens: prev };
    }
    case 'set_tweaks': {
      const prev = doc.tweaks ? clone(doc.tweaks) : [];
      if (op.tweaks.length) doc.tweaks = clone(op.tweaks);
      else delete doc.tweaks;
      return { op: 'set_tweaks', tweaks: prev };
    }
    case 'component_define': {
      const prev = doc.components[op.def.name];
      if (!prev) {
        const ids: string[] = [];
        walkTree(op.def.root, (n) => ids.push(n.id));
        for (const id of ids) if (idx.has(id)) throw new DocError(`节点 id ${id} 已存在`, 'conflict');
      }
      doc.components[op.def.name] = clone(op.def);
      invalidateIndex(doc);
      return prev ? { op: 'component_define', def: prev } : { op: 'component_remove', name: op.def.name };
    }
    case 'component_remove': {
      const prev = doc.components[op.name];
      if (!prev) throw new DocError(`组件 ${op.name} 不存在`, 'not_found');
      delete doc.components[op.name];
      invalidateIndex(doc);
      return { op: 'component_define', def: prev };
    }
    case 'frame_create': {
      if (idx.has(op.frame.id)) throw new DocError(`id ${op.frame.id} 已存在`, 'conflict');
      const ids: string[] = [];
      walkTree(op.frame.root, (n) => ids.push(n.id));
      for (const id of ids) if (idx.has(id)) throw new DocError(`节点 id ${id} 已存在`, 'conflict');
      doc.frames.splice(Math.max(0, Math.min(op.index, doc.frames.length)), 0, clone(op.frame));
      invalidateIndex(doc);
      return { op: 'frame_remove', id: op.frame.id };
    }
    case 'frame_update': {
      const f = doc.frames.find((x) => x.id === op.id);
      if (!f) throw new DocError(`画板 ${op.id} 不存在`, 'not_found');
      const inv: Op = { op: 'frame_update', id: op.id };
      if (op.name !== undefined) ((inv.name = f.name), (f.name = op.name));
      if (op.width !== undefined) ((inv.width = f.width), (f.width = op.width));
      if (op.height !== undefined) ((inv.height = f.height), (f.height = op.height));
      return inv;
    }
    case 'frame_remove': {
      const i = doc.frames.findIndex((x) => x.id === op.id);
      if (i < 0) throw new DocError(`画板 ${op.id} 不存在`, 'not_found');
      const [f] = doc.frames.splice(i, 1);
      invalidateIndex(doc);
      return { op: 'frame_create', frame: f, index: i };
    }
    case 'asset_add': {
      const prev = doc.assets[op.asset.hash];
      doc.assets[op.asset.hash] = clone(op.asset);
      return prev ? { op: 'asset_add', asset: prev } : { op: 'asset_add', asset: op.asset };
    }
    case 'doc_replace': {
      const { rev: _rev, ...prev } = clone(doc);
      const next = clone(op.doc);
      doc.tokens = next.tokens;
      if (next.tweaks) doc.tweaks = next.tweaks;
      else delete doc.tweaks;
      doc.components = next.components;
      doc.frames = next.frames;
      doc.assets = next.assets;
      invalidateIndex(doc);
      return { op: 'doc_replace', doc: prev };
    }
  }
}

/** 原子地应用一组操作：任一失败则回滚已应用的部分并抛出。返回逆操作（已逆序）。 */
export function applyOps(doc: DesignDoc, ops: Op[]): Op[] {
  const inverse: Op[] = [];
  try {
    for (const op of ops) inverse.unshift(applyOp(doc, op));
  } catch (e) {
    for (const inv of inverse) applyOp(doc, inv);
    throw e;
  }
  return inverse;
}

/** 实例渲染时合并的覆盖项：外层实例的覆盖优先于组件定义内嵌实例的覆盖。 */
export function mergeOverride(a: Override | undefined, b: Override | undefined): Override | undefined {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b, props: a.props || b.props ? { ...a.props, ...b.props } : undefined };
}

/** 统计每个组件的实例数（画板中的直接与嵌套使用）。 */
export function instanceCount(doc: DesignDoc, name: string): number {
  return directInstances(doc, name).length;
}

export function findFrameOfAddr(doc: DesignDoc, addr: string): string | undefined {
  try {
    const r = resolveAddress(doc, addr);
    if (r.instance) {
      const l = getIndex(doc).get(r.instance.node.id);
      return l ? framesOf(doc, l)[0] : undefined;
    }
    return framesOf(doc, r.target)[0];
  } catch {
    return undefined;
  }
}

export function listTypes(doc: DesignDoc): string[] {
  const s = new Set<string>();
  for (const l of getIndex(doc).values()) s.add(l.node.type);
  return [...s].sort();
}

export type { ComponentDef };
