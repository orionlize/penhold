// 高层编辑 → 原子操作。AI 工具与画布属性面板共用。
import {
  clone,
  componentDependsOn,
  componentRootId,
  DocError,
  getIndex,
  newId,
  resolveAddress,
  walkTree,
} from './doc.js';
import { LAYOUT_CSS_KEYS, layoutConflictMessage, layoutConflicts } from './customCss.js';
import { validateField, validateNodeInput, type NodeInput } from './schema.js';
import type { DesignDoc, FieldGroup, Node, Op, Origin, Override } from './types.js';

export interface Affected {
  id: string;
  type: string;
  component?: string;
}

/** 用户（画布）可写的字段组；layout 与结构仅 AI 可写。 */
export const USER_FIELDS: FieldGroup[] = ['box', 'style', 'text', 'props', 'name', 'meta'];
/** layout 中用户可写的键（其余仅 AI 可写）。 */
export const USER_LAYOUT_KEYS = ['display', 'direction', 'justify', 'align', 'gap', 'rows', 'columns', 'position', 'grow', 'wrap'];
/** 用户能改的布局键：USER_LAYOUT_KEYS 任意改；只有 AI 能写的键（LAYOUT_CSS）只能删除——面板把它们迁到自定义 CSS 时用。 */
const userLayoutPatch = (patch: Record<string, unknown>) => Object.entries(patch).every(([k, v]) => USER_LAYOUT_KEYS.includes(k) || ((LAYOUT_CSS_KEYS as string[]).includes(k) && v === null));
export const OBJECT_FIELDS = new Set(['layout', 'box', 'style', 'props', 'meta', 'states']);

/** 校验用户提交的原子操作是否越权。 */
export function checkUserOps(ops: Op[], doc?: DesignDoc): void {
  const idx = doc && getIndex(doc);
  for (const op of ops) {
    switch (op.op) {
      case 'remove': {
        // 画布删除：只能删画板内的普通节点（不含画板根、组件定义内部节点）
        if (!idx) throw new DocError('删除节点需要校验文档', 'forbidden');
        const loc = idx.get(op.id);
        if (!loc) throw new DocError(`节点 ${op.id} 不存在`, 'not_found');
        if (!loc.parent) throw new DocError('不能直接删除画板根节点，请删除画板', 'forbidden');
        if (!loc.frame || loc.component) throw new DocError('不能在画布上删除组件定义内部的节点', 'forbidden');
        break;
      }
      case 'frame_remove':
        if (!idx) throw new DocError('删除画板需要校验文档', 'forbidden');
        if (!doc!.frames.some((f) => f.id === op.id)) throw new DocError(`画板 ${op.id} 不存在`, 'not_found');
        break;
      case 'set':
        if (op.field === 'layout') {
          // 只允许改 USER_LAYOUT_KEYS：与当前 layout 对比，其他键必须不变
          const cur = (idx?.get(op.id)?.node.layout ?? {}) as Record<string, unknown>;
          const next = (op.value ?? {}) as Record<string, unknown>;
          const changed = [...new Set([...Object.keys(cur), ...Object.keys(next)])].filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(next[k]));
          if (!idx?.get(op.id) || !userLayoutPatch(Object.fromEntries(changed.map((k) => [k, next[k] === undefined ? null : next[k]])))) throw new DocError(`用户只能修改 ${USER_LAYOUT_KEYS.map((k) => `layout.${k}`).join('、')}（其余布局仅 AI 可写）`, 'forbidden');
          validateField(op.field, op.value);
          break;
        }
        if (!USER_FIELDS.includes(op.field)) throw new DocError(`用户不能修改 ${op.field}（位置、布局与结构仅 AI 可写）`, 'forbidden');
        validateField(op.field, op.value);
        break;
      case 'set_override':
        if (op.value) validateOverride(op.value);
        break;
      case 'set_tokens':
      case 'asset_add':
        break;
      case 'insert': {
        // 画布文字工具：只允许插入不含子节点、非组件的单个节点
        const n = validateNodeInput(op.node) as Node;
        if (n.children?.length || n.component || n.overrides) throw new DocError('画布上只能添加单个文字节点', 'forbidden');
        break;
      }
      case 'frame_create':
        // 画板工具：只允许新建空画板
        if (op.frame.id !== op.frame.root.id || typeof op.frame.name !== 'string' || op.frame.name.length > 100) throw new DocError('画板数据无效', 'invalid');
        if (op.frame.root.children?.length || op.frame.root.component) throw new DocError('画布上只能新建空画板', 'forbidden');
        if (!(op.frame.width >= 40 && op.frame.width <= 8000)) throw new DocError('画板宽度需在 40–8000 之间', 'invalid');
        validateNodeInput({ ...op.frame.root, children: undefined });
        break;
      default:
        throw new DocError(`用户不能提交 ${op.op} 操作`, 'forbidden');
    }
  }
}

function validateOverride(v: Override) {
  if (v.text !== undefined) validateField('text', v.text);
  if (v.props !== undefined) validateField('props', v.props);
}

/** 对象字段按键合并；值为 null 表示删除该键。 */
export function mergeObject(prev: unknown, patch: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (patch === null) return undefined;
  const out: Record<string, unknown> = { ...((prev as Record<string, unknown>) ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface NodePatch {
  layout?: Record<string, unknown> | null;
  box?: Record<string, unknown> | null;
  style?: Record<string, unknown> | null;
  props?: Record<string, string | null> | null;
  states?: Record<string, unknown> | null;
  /** 原型交互，整体替换；null 清除。 */
  proto?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  text?: string | null;
  name?: string | null;
  type?: string;
  render?: Node['render'] | null;
  component?: string | null;
}

export interface UpdateResult {
  ops: Op[];
  /** 实际写入的字段键，形如 "style.color"、"text"，用于变更追踪。 */
  touched: Array<{ id: string; key: string }>;
  /** 修改的是组件定义时的组件名。 */
  component?: string;
}

/**
 * 把对某个地址的字段修改翻译为原子操作。
 * - 实例根：layout（摆放）、text、props、meta 属于实例；box/style/states 写入组件定义。
 * - 实例内部节点：text/props/hidden 写为实例 overrides；其余写入组件定义。
 * - 组件定义中的节点（裸 id）：直接修改定义。
 */
/**
 * 某地址的某字段组实际写在哪个存储节点上（与 updateOps 的路由一致）：
 * 实例内部的样式类字段写组件定义节点，实例根的 box/style/states 写定义根；
 * 实例内部的 text / props / meta 走 overrides，返回 null。
 */
export function storeTarget(doc: DesignDoc, addr: string, field: string): string | null {
  const r = resolveAddress(doc, addr);
  const target = r.target.node;
  if (r.instance) return field === 'text' || field === 'props' || field === 'meta' ? null : target.id;
  if (target.component) {
    const def = doc.components[target.component];
    if (def && ['box', 'style', 'states', 'render', 'type'].includes(field)) return def.root.id;
  }
  return target.id;
}

/** 一次 set 的字段级差异：对象字段按子键拆开（键为 "style.color"），其余字段整体比较（键为 "text"）。 */
export function fieldDiff(field: string, before: unknown, after: unknown): Array<[key: string, before: unknown, after: unknown]> {
  if (!OBJECT_FIELDS.has(field)) return JSON.stringify(before) === JSON.stringify(after) ? [] : [[field, before, after]];
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const out: Array<[string, unknown, unknown]> = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push([`${field}.${k}`, b[k], a[k]]);
  return out;
}

export function updateOps(doc: DesignDoc, addr: string, patch: NodePatch, origin: Origin, skipKeys?: Set<string>): UpdateResult {
  const r = resolveAddress(doc, addr);
  const ops: Op[] = [];
  const touched: UpdateResult['touched'] = [];
  let component: string | undefined;
  const target = r.target.node;
  const isInstanceRoot = !r.instance && !!target.component;

  if (origin === 'user') {
    for (const k of Object.keys(patch) as (keyof NodePatch)[]) {
      if (k === 'layout' && patch.layout && userLayoutPatch(patch.layout)) continue;
      if (patch[k] !== undefined && !(USER_FIELDS as string[]).includes(k))
        throw new DocError(`用户不能修改 ${k}（位置、布局与结构仅 AI 可写）`, 'forbidden');
    }
  }

  // 实例内部：内容类字段写 overrides
  if (r.instance) {
    const inst = r.instance;
    const ovPatch: Override = {};
    let hasOv = false;
    if (patch.text !== undefined) {
      if (patch.text !== null) ovPatch.text = patch.text;
      hasOv = true;
    }
    if (patch.props !== undefined) {
      const cur = inst.node.overrides?.[inst.path]?.props;
      const merged = mergeObject(cur, patch.props as Record<string, unknown> | null) as Record<string, string> | undefined;
      if (merged) ovPatch.props = merged;
      hasOv = true;
    }
    if (patch.meta && 'hidden' in patch.meta) {
      if (patch.meta.hidden !== null) ovPatch.hidden = !!patch.meta.hidden;
      hasOv = true;
    }
    if (hasOv) {
      const prev = inst.node.overrides?.[inst.path] ?? {};
      const next: Override = { ...prev };
      if (patch.text !== undefined) (patch.text === null ? delete next.text : (next.text = ovPatch.text));
      if (patch.props !== undefined) (ovPatch.props ? (next.props = ovPatch.props) : delete next.props);
      if (patch.meta && 'hidden' in patch.meta) (ovPatch.hidden === undefined ? delete next.hidden : (next.hidden = ovPatch.hidden));
      validateOverride(next);
      ops.push({ op: 'set_override', id: inst.node.id, path: inst.path, value: next });
      touched.push({ id: addr, key: 'overrides' });
    }
    const rest: NodePatch = { ...patch, text: undefined, props: undefined };
    if (rest.meta) {
      const { hidden: _h, ...m } = rest.meta;
      rest.meta = Object.keys(m).length ? m : undefined;
    }
    component = r.target.component;
    const sub = fieldOps(target, rest, origin, skipKeys, r.target.node.id);
    ops.push(...sub.ops);
    touched.push(...sub.touched);
    return { ops, touched, component };
  }

  if (isInstanceRoot) {
    const def = doc.components[target.component!];
    if (!def) throw new DocError(`组件 ${target.component} 不存在`);
    // 组件挂接/解除
    if (patch.component !== undefined) {
      if (patch.component === null) return detachInstance(doc, target);
      if (patch.component !== target.component) throw new DocError('要换成另一个组件，请用 node_replace 插入新组件实例');
    }
    const own: NodePatch = { layout: patch.layout, text: patch.text, props: patch.props, meta: patch.meta, name: patch.name, proto: patch.proto };
    const defPatch: NodePatch = { box: patch.box, style: patch.style, states: patch.states, render: patch.render, type: patch.type };
    const a = fieldOps(target, own, origin, skipKeys, target.id);
    const b = fieldOps(def.root, defPatch, origin, skipKeys, def.root.id);
    if (b.ops.length) component = def.name;
    return { ops: [...a.ops, ...b.ops], touched: [...a.touched, ...b.touched], component };
  }

  // 普通节点或组件定义中的节点
  if (patch.component !== undefined && patch.component !== null) {
    if (origin !== 'ai') throw new DocError('只有 AI 可以创建组件', 'forbidden');
    if (r.target.component) throw new DocError('组件定义内部不能再注册新组件，请在画板中操作');
    if (doc.components[patch.component]) throw new DocError(`组件名 ${patch.component} 已存在；要复用它请用 node_replace 插入 {component: "${patch.component}"}`);
    const pre = fieldOps(target, { ...patch, component: undefined }, origin, skipKeys, target.id);
    const tmp = clone(target);
    // 预演字段修改后再注册
    for (const op of pre.ops) if (op.op === 'set') (tmp as unknown as Record<string, unknown>)[op.field] = op.value;
    const reg = registerComponent(tmp, patch.component);
    return {
      ops: [...pre.ops, { op: 'component_define', def: reg.def }, ...instanceRewriteOps(target, reg.instance)],
      touched: [...pre.touched, { id: target.id, key: 'component' }],
      component: patch.component,
    };
  }
  if (r.target.component) component = r.target.component;
  const res = fieldOps(target, { ...patch, component: undefined }, origin, skipKeys, target.id);
  return { ...res, component };
}

function fieldOps(node: Node, patch: NodePatch, _origin: Origin, skipKeys: Set<string> | undefined, id: string) {
  const ops: Op[] = [];
  const touched: UpdateResult['touched'] = [];
  for (const [field, value] of Object.entries(patch) as [FieldGroup | 'component', unknown][]) {
    if (value === undefined || field === 'component') continue;
    const cur = (node as unknown as Record<string, unknown>)[field];
    let next: unknown;
    if (OBJECT_FIELDS.has(field)) {
      let p = value as Record<string, unknown> | null;
      if (p && skipKeys) {
        p = Object.fromEntries(Object.entries(p).filter(([k]) => !skipKeys.has(`${id}.${field}.${k}`)));
        if (!Object.keys(p).length) continue;
      }
      next = mergeObject(cur, p);
      for (const k of p ? Object.keys(p) : Object.keys((cur as object) ?? {})) touched.push({ id, key: `${field}.${k}` });
    } else {
      if (skipKeys?.has(`${id}.${field}`)) continue;
      next = value === null ? undefined : value;
      touched.push({ id, key: field });
    }
    if (field === 'type' && next === undefined) continue;
    next = validateField(field, next, `${id}.${field}`);
    if (JSON.stringify(next) === JSON.stringify(cur)) continue;
    ops.push({ op: 'set', id: node.id, field: field as FieldGroup, value: next });
  }
  // 自定义 CSS 与只有 AI 能写的布局字段只能设一处
  if (ops.some((o) => o.op === 'set' && (o.field === 'style' || o.field === 'layout'))) {
    const after = <F extends 'style' | 'layout'>(f: F): Node[F] => {
      const o = ops.find((x) => x.op === 'set' && x.field === f);
      return (o ? (o as { value: unknown }).value : node[f]) as Node[F];
    };
    const bad = layoutConflicts(after('style')?.css, after('layout'));
    if (bad.length) throw new DocError(bad.map(([n, k]) => layoutConflictMessage(n, k)).join('；'));
  }
  return { ops, touched };
}

/** 把普通子树登记为组件：返回定义（根 id 为 cmp_<name>）与实例节点。 */
function registerComponent(node: Node, name: string): { def: { name: string; root: Node }; instance: Node } {
  const root = clone(node);
  root.id = componentRootId(name);
  delete root.component;
  delete root.overrides;
  delete root.meta;
  const instance: Node = { id: node.id, type: node.type, component: name };
  if (node.name) instance.name = node.name;
  if (node.meta) instance.meta = clone(node.meta);
  // 摆放属性留在实例上
  const placement = pickPlacement(node.layout);
  if (placement) {
    instance.layout = placement;
    const rest = { ...root.layout };
    for (const k of Object.keys(placement)) delete (rest as Record<string, unknown>)[k];
    root.layout = Object.keys(rest).length ? rest : undefined;
    if (!root.layout) delete root.layout;
  }
  return { def: { name, root }, instance };
}

const PLACEMENT_KEYS = ['grow', 'shrink', 'basis', 'alignSelf', 'position', 'top', 'right', 'bottom', 'left', 'zIndex'];
function pickPlacement(l: Node['layout']) {
  if (!l) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of PLACEMENT_KEYS) if ((l as Record<string, unknown>)[k] !== undefined) out[k] = (l as Record<string, unknown>)[k];
  return Object.keys(out).length ? (out as Node['layout']) : undefined;
}

/** 结构指纹：忽略 id、图层名与实例级字段，用于判断“同名组件给出的子树是否与定义相同”。 */
function shapeKey(n: NodeInput | Node, isRoot: boolean, ignoreContent = false): string {
  const strip = (x: NodeInput | Node, root: boolean): unknown => {
    if (!root && x.component) return { component: x.component };
    const { id: _i, name: _n, children, component: _c, overrides: _o, meta: _m, ...rest } = x as Node;
    const r: Record<string, unknown> = { ...rest };
    if (root) {
      delete r.text;
      delete r.props;
      delete r.proto; // 实例根的交互可逐实例不同
      if (r.layout) {
        const l = { ...(r.layout as Record<string, unknown>) };
        for (const k of PLACEMENT_KEYS) delete l[k];
        r.layout = Object.keys(l).length ? l : undefined;
      }
    }
    if (ignoreContent) {
      delete r.text;
      delete r.props;
    }
    if (children?.length) r.children = (children as Node[]).map((c) => strip(c, false));
    return JSON.parse(JSON.stringify(r));
  };
  return stableStringify(strip(n, isRoot));
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/**
 * 与定义同结构、同样式的子树：把内部节点的 text/props 差异转成实例 overrides。
 * 嵌套组件实例的内部差异以 "嵌套实例id:内部id" 为路径。
 */
function contentOverrides(
  input: NodeInput,
  def: Node,
  lookup: (name: string) => Node | undefined,
  prefix: string,
  out: Record<string, Override>,
) {
  const inKids = input.children ?? [];
  const defKids = def.children ?? [];
  inKids.forEach((ic, i) => {
    const dc = defKids[i];
    if (!dc) return;
    const path = prefix ? `${prefix}:${dc.id}` : dc.id;
    const ov: Override = {};
    if (ic.text !== undefined && ic.text !== dc.text) ov.text = ic.text;
    if (ic.props) {
      const diff: Record<string, string> = {};
      for (const [k, v] of Object.entries(ic.props)) if (dc.props?.[k] !== v) diff[k] = v;
      if (Object.keys(diff).length) ov.props = diff;
    }
    if (ic.meta?.hidden !== undefined && ic.meta.hidden !== !!dc.meta?.hidden) ov.hidden = ic.meta.hidden;
    if (Object.keys(ov).length) out[path] = ov;
    if (dc.component) {
      const nested = lookup(dc.component);
      if (nested && ic.children?.length) contentOverrides(ic, nested, lookup, path, out);
    } else contentOverrides(ic, dc, lookup, prefix, out);
  });
}

/** 把节点原地换成实例：删掉子树、重写字段。 */
function instanceRewriteOps(target: Node, inst: Node): Op[] {
  const ops: Op[] = [];
  const fields: FieldGroup[] = ['render', 'layout', 'box', 'style', 'props', 'text', 'states', 'proto', 'meta', 'name'];
  for (const c of [...(target.children ?? [])].reverse()) ops.push({ op: 'remove', id: c.id });
  for (const f of fields) {
    const v = (inst as unknown as Record<string, unknown>)[f];
    if (JSON.stringify(v) !== JSON.stringify((target as unknown as Record<string, unknown>)[f])) ops.push({ op: 'set', id: target.id, field: f, value: v });
  }
  ops.push({ op: 'set', id: target.id, field: 'component' as FieldGroup, value: inst.component });
  return ops;
}

/** 解除实例：用组件定义的副本（新 id）替换实例，并把 overrides 落到副本上。 */
function detachInstance(doc: DesignDoc, inst: Node): UpdateResult {
  const idx = getIndex(doc);
  const loc = idx.get(inst.id)!;
  if (!loc.parent) throw new DocError('不能解除画板根节点');
  const def = doc.components[inst.component!];
  const copy = clone(def.root);
  const idMap = new Map<string, string>();
  walkTree(copy, (n) => {
    const nid = n === copy ? inst.id : newId();
    idMap.set(n.id, nid);
    n.id = nid;
  });
  // 应用 overrides（只处理直接子路径）
  for (const [path, ov] of Object.entries(inst.overrides ?? {})) {
    if (path.includes(':')) continue;
    walkTree(copy, (n) => {
      if (n.id === idMap.get(path)) {
        if (ov.text !== undefined) n.text = ov.text;
        if (ov.props) n.props = { ...n.props, ...ov.props };
        if (ov.hidden !== undefined) n.meta = { ...n.meta, hidden: ov.hidden };
      }
    });
  }
  copy.layout = inst.layout ? { ...copy.layout, ...inst.layout } : copy.layout;
  if (inst.text !== undefined) copy.text = inst.text;
  if (inst.props) copy.props = { ...copy.props, ...inst.props };
  if (inst.name) copy.name = inst.name;
  if (inst.meta) copy.meta = inst.meta;
  const i = loc.parent.children!.findIndex((c) => c.id === inst.id);
  return {
    ops: [
      { op: 'remove', id: inst.id },
      { op: 'insert', parent: loc.parent.id, index: i, node: copy },
    ],
    touched: [{ id: inst.id, key: 'component' }],
  };
}

export interface PreparedInsert {
  ops: Op[];
  affected: Affected[];
  nodes: Node[];
  newComponents: string[];
}

/**
 * 准备插入：分配 id、自底向上登记新组件、把已有组件名的节点变为实例。
 * 返回的 ops 先定义组件，再插入画板节点。
 */
export function prepareNodes(doc: DesignDoc, inputs: NodeInput[], hostComponent: string | undefined): PreparedInsert {
  const idx = getIndex(doc);
  const usedIds = new Set<string>();
  const ops: Op[] = [];
  const affected: Affected[] = [];
  const newDefs = new Map<string, Node>();
  const newComponents: string[] = [];

  const claimId = (want: string | undefined): string => {
    if (want) {
      if (idx.has(want) || usedIds.has(want)) throw new DocError(`节点 id ${want} 已存在`, 'conflict');
      usedIds.add(want);
      return want;
    }
    let id = newId();
    while (idx.has(id) || usedIds.has(id)) id = newId();
    usedIds.add(id);
    return id;
  };

  const build = (input: NodeInput, path: string): Node => {
    const { children, ...rest } = input;
    const node: Node = { ...(clone(rest) as Node), id: claimId(input.id) };
    const name = input.component;
    if (name) {
      if (hostComponent && componentDependsOn(doc, name, hostComponent))
        throw new DocError(`${path}: 组件 ${name} 不能插入到它自身（或依赖它的组件）中`);
      const existing = doc.components[name] ?? (newDefs.has(name) ? { root: newDefs.get(name)! } : undefined);
      if (existing) {
        const structural = (children && children.length) || input.box || input.style || input.states || input.render;
        if (structural && shapeKey(input, true, true) !== shapeKey(existing.root, true, true))
          throw new DocError(
            `${path}: 组件 ${name} 已存在，且给出的子树结构或样式与定义不同。实例只需 {type, component, text?, props?, overrides?, layout(摆放)?}，或给出与定义同结构同样式、仅文本/props 不同的子树（差异会自动转为 overrides）。要修改组件请对组件内节点用 node_update，或换一个组件名`,
          );
        affected.push({ id: node.id, type: node.type, component: name });
        // 与定义同形的子树视为实例：只保留实例级字段
        const inst: Node = { id: node.id, type: node.type, component: name };
        if (input.name) inst.name = input.name;
        if (input.text !== undefined) inst.text = input.text;
        if (input.props) inst.props = clone(input.props);
        if (input.proto && JSON.stringify(input.proto) !== JSON.stringify(existing.root.proto)) inst.proto = clone(input.proto);
        const autoOv: Record<string, Override> = {};
        if (structural)
          contentOverrides(input, existing.root, (n) => doc.components[n]?.root ?? newDefs.get(n), '', autoOv);
        const ovs = { ...autoOv, ...clone(input.overrides ?? {}) };
        if (Object.keys(ovs).length) inst.overrides = ovs;
        if (input.meta) inst.meta = clone(input.meta);
        const placement = pickPlacement(input.layout);
        if (placement || (input.layout && !structural)) inst.layout = structural ? placement : clone(input.layout);
        return inst;
      }
      // 新组件：先递归构建子树，再登记定义
      affected.push({ id: node.id, type: node.type, component: name });
      const kids = (children ?? []).map((c, i) => build(c, `${path}.children[${i}]`));
      const full: Node = { ...node, children: kids.length ? kids : undefined };
      if (!full.children) delete full.children;
      const reg = registerComponent(full, name);
      if (idx.has(reg.def.root.id)) throw new DocError(`${path}: 组件根 id 冲突 ${reg.def.root.id}`);
      newDefs.set(name, reg.def.root);
      newComponents.push(name);
      ops.push({ op: 'component_define', def: reg.def });
      return reg.instance;
    }
    affected.push({ id: node.id, type: node.type });
    const kids = (children ?? []).map((c, i) => build(c, `${path}.children[${i}]`));
    if (kids.length) node.children = kids;
    else delete node.children;
    return node;
  };

  const nodes = inputs.map((n, i) => build(n, `nodes[${i}]`));
  return { ops, affected, nodes, newComponents };
}

/** 插入到地址 parentAddr（实例内部地址会落到组件定义上）。 */
export function insertOps(doc: DesignDoc, parentAddr: string, index: number | undefined, inputs: NodeInput[]): PreparedInsert & { parentId: string; component?: string } {
  const r = resolveAddress(doc, parentAddr);
  const parent = r.target.node;
  if (parent.component && !r.instance)
    throw new DocError(`${parentAddr} 是组件 ${parent.component} 的实例，不能直接插入子节点；请插入到组件定义内的节点（实例地址 ${parentAddr}:<内部id>）或其根 ${componentRootId(parent.component)}`);
  if (parent.component) throw new DocError(`${parentAddr} 是嵌套组件实例，不能插入子节点`);
  const host = r.target.component;
  const prep = prepareNodes(doc, inputs, host);
  if (host) {
    for (const op of prep.ops) if (op.op === 'component_define') throw new DocError('组件定义内部不能注册新组件，请先在画板中创建该组件');
  }
  const at = index ?? (parent.children?.length ?? 0);
  prep.nodes.forEach((n, i) => prep.ops.push({ op: 'insert', parent: parent.id, index: at + i, node: n }));
  return { ...prep, parentId: parent.id, component: host };
}
