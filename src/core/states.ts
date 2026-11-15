// 交互状态探索：不依赖 DOM，按 proto 语义模拟点击、输入与计时器，
// 枚举画板从初始状态出发可到达的状态，供截图自检逐个渲染检查；
// 同时给出静态问题（跳转目标不存在、引用了未声明的变量、永远不会显示的元素）。
import { inferRender, mergeOverride } from './doc.js';
import { childAddress } from './render.js';
import { evalExpr, frameVars, hasTemplate, mergeProto, truthy } from './proto.js';
import type { DesignDoc, Frame, Node, Override, Proto, ProtoAction, ProtoValue } from './types.js';

/** 展开组件实例后的画板节点（地址与画布 DOM 的 data-node-id 一致）。 */
export interface FlatNode {
  addr: string;
  /** 父节点在列表中的下标，根为 -1。 */
  parent: number;
  proto?: Proto;
  hidden: boolean;
  href?: string;
  input: boolean;
  /** 含 {{}} 的文本。 */
  template?: string;
  label: string;
}

export function flattenFrame(doc: DesignDoc, frame: Frame): FlatNode[] {
  const out: FlatNode[] = [];
  const stack: Array<{ prefix: string; overrides?: Record<string, Override> }> = [];
  const lookup = (addr: string) => {
    let ov: Override | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i];
      if (!f.overrides || !addr.startsWith(f.prefix + ':')) continue;
      ov = mergeOverride(ov, f.overrides[addr.slice(f.prefix.length + 1)]);
    }
    return ov;
  };
  const visit = (node: Node, addr: string, parent: number, depth: number) => {
    if (depth > 60) return;
    const ov = lookup(addr);
    let eff = node;
    let inst = false;
    if (node.component && doc.components[node.component]) {
      const def = doc.components[node.component];
      eff = {
        ...def.root,
        id: node.id,
        name: node.name ?? def.root.name,
        text: node.text ?? def.root.text,
        props: node.props ? { ...def.root.props, ...node.props } : def.root.props,
        meta: node.meta,
        proto: mergeProto(def.root.proto, node.proto),
      };
      inst = true;
    }
    const text = ov?.text ?? eff.text;
    const props = ov?.props ? { ...eff.props, ...ov.props } : eff.props;
    const label = eff.name || (text && !hasTemplate(text) ? text.slice(0, 12) : '') || eff.component || eff.type;
    const i = out.push({ addr, parent, proto: eff.proto, hidden: !!(ov?.hidden ?? eff.meta?.hidden), href: props?.href, input: inferRender(eff) === 'input', template: hasTemplate(text) ? text : undefined, label }) - 1;
    if (inst) stack.push({ prefix: addr, overrides: node.overrides });
    for (const c of eff.children ?? []) visit(c, childAddress(addr, c.id, inst), i, depth + 1);
    if (inst) stack.pop();
  };
  visit(frame.root, frame.root.id, -1, 0);
  return out;
}

// ---------- 动作模拟 ----------

export interface Timer {
  key: string;
  label: string;
  /** 倒计时：触发时该变量归零。 */
  countdown?: string;
  then: ProtoAction[];
}

export interface SimState {
  vars: Record<string, ProtoValue>;
  timers: Timer[];
}

export type NavOut = { kind: 'navigate'; frame: string } | { kind: 'back' } | { kind: 'open'; url: string };

const cloneState = (s: SimState): SimState => ({ vars: { ...s.vars }, timers: [...s.timers] });

/** 按运行时语义执行动作；遇到跳转立即停止并返回跳转。延时与倒计时登记为计时器（不立即执行）。 */
export function runActions(st: SimState, actions: ProtoAction[], depth = 0): NavOut | undefined {
  if (depth > 8) return;
  for (const a of actions) {
    switch (a.do) {
      case 'set': {
        const v = a.expr !== undefined ? evalSafe(a.expr, st.vars) : a.value;
        if (v !== undefined) st.vars[a.var] = v;
        break;
      }
      case 'toggle':
        st.vars[a.var] = !st.vars[a.var];
        break;
      case 'countdown':
        st.timers = st.timers.filter((t) => t.countdown !== a.var);
        st.vars[a.var] = a.from;
        st.timers.push({ key: `cd:${a.var}`, label: `等待 ${a.var} 倒计时结束`, countdown: a.var, then: a.then ?? [] });
        break;
      case 'stop':
        st.timers = st.timers.filter((t) => t.countdown !== a.var);
        break;
      case 'delay':
        st.timers.push({ key: `delay:${a.ms}:${JSON.stringify(a.then).length}:${st.timers.length}`, label: `等待 ${a.ms}ms`, then: a.then });
        break;
      case 'if': {
        const nav = runActions(st, (truthy(a.when, st.vars) ? a.then : a.else) ?? [], depth + 1);
        if (nav) return nav;
        break;
      }
      case 'navigate':
        return { kind: 'navigate', frame: a.frame };
      case 'back':
        return { kind: 'back' };
      case 'open':
        break; // 新窗口打开，不离开画板
    }
  }
}

const evalSafe = (src: string, vars: Record<string, ProtoValue>) => evalExpr(src, vars);

function fireTimer(st: SimState, t: Timer): NavOut | undefined {
  st.timers = st.timers.filter((x) => x !== t);
  if (t.countdown) st.vars[t.countdown] = 0;
  return runActions(st, t.then);
}

function followHref(href: string): NavOut | undefined {
  if (href === '#back') return { kind: 'back' };
  if (href.startsWith('#')) return { kind: 'navigate', frame: href.slice(1) };
  return undefined;
}

// ---------- 状态探索 ----------

export interface Step {
  kind: 'load' | 'click' | 'input' | 'wait';
  addr?: string;
  value?: string;
  label: string;
}

export interface ExploredState {
  index: number;
  /** 上一状态下标；初始状态为 -1。 */
  parent: number;
  step?: Step;
  path: Step[];
  vars: Record<string, ProtoValue>;
  timers: string[];
}

export interface StateExit {
  from: number;
  step: Step;
  nav: NavOut;
}

export interface Exploration {
  /** 画板是否带交互（有点击、onLoad 或 href）。 */
  interactive: boolean;
  states: ExploredState[];
  exits: StateExit[];
  /** 达到状态数上限，未探索完。 */
  truncated: boolean;
  /** 在所有已探索状态中都不成立的显示 / 条件样式（未截断时才给出）。 */
  unreachable: Array<{ addr: string; what: 'show' | 'styles'; expr: string }>;
  maxDepth: number;
  maxStates: number;
}

/** 默认最多 4 步（如：切 tab → 输入手机号 → 点获取验证码 → 等倒计时结束）、24 个状态。 */
export const EXPLORE_DEPTH = 4;
export const EXPLORE_STATES = 24;

export interface ExploreOptions {
  maxDepth?: number;
  maxStates?: number;
}

const stateKey = (s: SimState) =>
  JSON.stringify(Object.keys(s.vars).sort().map((k) => [k, s.vars[k]])) + '|' + s.timers.map((t) => t.key).sort().join(',');

function visibleSet(nodes: FlatNode[], vars: Record<string, ProtoValue>): boolean[] {
  const vis: boolean[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    vis.push((n.parent < 0 || vis[n.parent]) && !n.hidden && truthy(n.proto?.show, vars));
  }
  return vis;
}

/** 输入框绑定变量的代表性取值：从 len(x) 比较中取长度（如 len(phone) == 11 → 11 位）。 */
function inputSamples(nodes: FlatNode[]): Map<string, string[]> {
  const exprs: string[] = [];
  const acts = (l?: ProtoAction[]) => {
    for (const a of l ?? []) {
      if (a.do === 'set' && a.expr) exprs.push(a.expr);
      if (a.do === 'if') (exprs.push(a.when), acts(a.then), acts(a.else));
      if (a.do === 'delay' || a.do === 'countdown') acts(a.then);
    }
  };
  for (const n of nodes) {
    const p = n.proto;
    if (!p) continue;
    if (p.show) exprs.push(p.show);
    if (p.disabled) exprs.push(p.disabled);
    for (const s of p.styles ?? []) exprs.push(s.when);
    acts(p.onClick);
    acts(p.onLoad);
  }
  const out = new Map<string, Set<number>>();
  const add = (v: string, n: number) => {
    if (n < 1 || n > 64) return;
    if (!out.has(v)) out.set(v, new Set());
    out.get(v)!.add(n);
  };
  for (const e of exprs) {
    for (const m of e.matchAll(/len\(\s*([a-zA-Z_]\w*)\s*\)\s*(==|!=|>=|<=|>|<)\s*(\d+)/g)) add(m[1], Number(m[3]) + (m[2] === '>' ? 1 : 0));
    for (const m of e.matchAll(/(\d+)\s*(==|!=|>=|<=|>|<)\s*len\(\s*([a-zA-Z_]\w*)\s*\)/g)) add(m[3], Number(m[1]) + (m[2] === '<' ? 1 : 0));
  }
  const res = new Map<string, string[]>();
  for (const [v, lens] of out) res.set(v, [...lens].slice(0, 2).map((n) => '1'.repeat(n)));
  return res;
}

export function exploreFrame(doc: DesignDoc, frameId: string, opts: ExploreOptions = {}): Exploration {
  const maxDepth = opts.maxDepth ?? EXPLORE_DEPTH;
  const maxStates = opts.maxStates ?? EXPLORE_STATES;
  const frame = doc.frames.find((f) => f.id === frameId);
  if (!frame) throw new Error(`没有画板 ${frameId}`);
  const nodes = flattenFrame(doc, frame);
  const clickables = nodes.map((n, i) => (n.proto?.onClick?.length || n.href ? i : -1)).filter((i) => i >= 0);
  const loads = nodes.filter((n) => n.proto?.onLoad?.length);
  const samples = inputSamples(nodes);
  const inputs = nodes.map((n, i) => (n.input && n.proto?.bind && samples.has(n.proto.bind) ? i : -1)).filter((i) => i >= 0);
  const interactive = clickables.length > 0 || loads.length > 0 || inputs.length > 0;

  const states: ExploredState[] = [];
  const sims: SimState[] = [];
  const exits: StateExit[] = [];
  const seen = new Map<string, number>();
  const exitSeen = new Set<string>();
  let truncated = false;

  const add = (sim: SimState, parent: number, step: Step | undefined): number | undefined => {
    const key = stateKey(sim);
    if (seen.has(key)) return undefined;
    if (states.length >= maxStates) {
      truncated = true;
      return undefined;
    }
    const index = states.length;
    seen.set(key, index);
    states.push({ index, parent, step, path: step ? [...(states[parent]?.path ?? []), step] : [], vars: { ...sim.vars }, timers: sim.timers.map((t) => t.label) });
    sims.push(sim);
    return index;
  };

  const init: SimState = { vars: frameVars(doc, frame), timers: [] };
  add(init, -1, undefined);
  const queue: Array<[number, number]> = [[0, 0]];
  if (loads.length) {
    const s = cloneState(init);
    let nav: NavOut | undefined;
    for (const n of loads) if (!nav) nav = runActions(s, n.proto!.onLoad!);
    const step: Step = { kind: 'load', label: '进入画板（onLoad）' };
    if (nav) exits.push({ from: 0, step, nav });
    else {
      const i = add(s, 0, step);
      if (i !== undefined) queue.push([i, 0]);
    }
  }

  while (queue.length) {
    const [si, depth] = queue.shift()!;
    if (depth >= maxDepth) continue;
    const cur = sims[si];
    const vis = visibleSet(nodes, cur.vars);
    const tryStep = (step: Step, fn: (s: SimState) => NavOut | undefined) => {
      const s = cloneState(cur);
      const nav = fn(s);
      if (nav) {
        const k = `${JSON.stringify(nav)}`;
        if (!exitSeen.has(k)) (exitSeen.add(k), exits.push({ from: si, step, nav }));
        return;
      }
      const i = add(s, si, step);
      if (i !== undefined) queue.push([i, depth + 1]);
    };
    for (const ci of clickables) {
      const n = nodes[ci];
      if (!vis[ci] || (n.proto?.disabled !== undefined && truthy(n.proto.disabled, cur.vars))) continue;
      tryStep({ kind: 'click', addr: n.addr, label: `点击 ${n.label}（${n.addr}）` }, (s) => {
        const nav = n.proto?.onClick ? runActions(s, n.proto.onClick) : undefined;
        return nav ?? (n.href ? followHref(n.href) : undefined);
      });
    }
    for (const ii of inputs) {
      if (!vis[ii]) continue;
      const n = nodes[ii];
      const v = n.proto!.bind!;
      for (const val of samples.get(v)!) {
        if (cur.vars[v] === val) continue;
        tryStep({ kind: 'input', addr: n.addr, value: val, label: `在 ${n.label}（${n.addr}）输入 ${val.length} 个字符` }, (s) => {
          s.vars[v] = val;
          return undefined;
        });
      }
    }
    for (const t of cur.timers) tryStep({ kind: 'wait', label: t.label }, (s) => fireTimer(s, s.timers.find((x) => x.key === t.key)!));
  }

  const unreachable: Exploration['unreachable'] = [];
  if (!truncated && interactive) {
    for (const n of nodes) {
      const p = n.proto;
      if (!p) continue;
      if (p.show !== undefined && !states.some((s) => truthy(p.show, s.vars))) unreachable.push({ addr: n.addr, what: 'show', expr: p.show });
      for (const c of p.styles ?? []) if (!states.some((s) => truthy(c.when, s.vars))) unreachable.push({ addr: n.addr, what: 'styles', expr: c.when });
    }
  }
  return { interactive, states, exits, truncated, unreachable, maxDepth, maxStates };
}

/** 按步骤（节点地址点击、"wait" 触发最早的计时器、"load" 执行 onLoad）从初始状态推演出一个状态。 */
export function stateAfter(doc: DesignDoc, frameId: string, steps: string[]): { vars: Record<string, ProtoValue>; nav?: NavOut; timers: string[] } {
  const frame = doc.frames.find((f) => f.id === frameId);
  if (!frame) throw new Error(`没有画板 ${frameId}`);
  const nodes = flattenFrame(doc, frame);
  const s: SimState = { vars: frameVars(doc, frame), timers: [] };
  for (const step of steps) {
    let nav: NavOut | undefined;
    if (step === 'load') {
      for (const n of nodes) if (!nav && n.proto?.onLoad) nav = runActions(s, n.proto.onLoad);
    } else if (step === 'wait') {
      if (!s.timers.length) throw new Error('“wait”：当前没有进行中的延时或倒计时');
      nav = fireTimer(s, s.timers[0]);
    } else {
      const i = nodes.findIndex((n) => n.addr === step);
      if (i < 0) throw new Error(`clicks 中的 ${step} 不在画板 ${frameId} 内`);
      const n = nodes[i];
      if (!n.proto?.onClick?.length && !n.href) throw new Error(`${step} 没有 onClick 或 href，点击无效果`);
      if (!visibleSet(nodes, s.vars)[i]) throw new Error(`${step} 在当前状态下不可见，无法点击`);
      if (n.proto?.disabled !== undefined && truthy(n.proto.disabled, s.vars)) throw new Error(`${step} 在当前状态下被禁用（${n.proto.disabled}）`);
      nav = n.proto?.onClick ? runActions(s, n.proto.onClick) : undefined;
      nav ??= n.href ? followHref(n.href) : undefined;
    }
    if (nav) return { vars: s.vars, nav, timers: [] };
  }
  return { vars: s.vars, timers: s.timers.map((t) => t.label) };
}

// ---------- 静态检查 ----------

export interface ProtoWarning {
  frame: string;
  id: string;
  kind: 'dead_link' | 'undeclared_var';
  detail: string;
}

const KEYWORDS = new Set(['true', 'false', 'len', 'pad', 'floor', 'min', 'max']);

function exprVars(src: string): string[] {
  const stripped = src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '');
  return [...stripped.matchAll(/[a-zA-Z_][a-zA-Z0-9_]*/g)].map((m) => m[0]).filter((n) => !KEYWORDS.has(n));
}

/** 写入后即可发现的交互问题：跳转到不存在的画板、引用未在 vars 中声明的变量。 */
export function lintProto(doc: DesignDoc, frameIds?: Iterable<string>): ProtoWarning[] {
  const out: ProtoWarning[] = [];
  const ids = new Set(doc.frames.map((f) => f.id));
  const want = frameIds ? new Set(frameIds) : ids;
  for (const frame of doc.frames) {
    if (!want.has(frame.id)) continue;
    const declared = frameVars(doc, frame);
    const seen = new Set<string>();
    const warn = (w: Omit<ProtoWarning, 'frame'>) => {
      const k = `${w.id}|${w.kind}|${w.detail}`;
      if (!seen.has(k)) (seen.add(k), out.push({ frame: frame.id, ...w }));
    };
    for (const n of flattenFrame(doc, frame)) {
      const p = n.proto;
      const refs: string[] = [];
      const acts = (l?: ProtoAction[]) => {
        for (const a of l ?? []) {
          if ('var' in a) refs.push(a.var);
          if (a.do === 'set' && a.expr) refs.push(...exprVars(a.expr));
          if (a.do === 'if') (refs.push(...exprVars(a.when)), acts(a.then), acts(a.else));
          if (a.do === 'delay' || a.do === 'countdown') acts(a.then);
          if (a.do === 'navigate' && !ids.has(a.frame)) warn({ id: n.addr, kind: 'dead_link', detail: `navigate 指向不存在的画板 “${a.frame}”` });
        }
      };
      if (p) {
        for (const e of [p.show, p.disabled, ...(p.styles ?? []).map((s) => s.when)]) if (e) refs.push(...exprVars(e));
        if (p.bind) refs.push(p.bind);
        acts(p.onClick);
        acts(p.onLoad);
      }
      for (const m of (n.template ?? '').matchAll(/\{\{([\s\S]+?)\}\}/g)) refs.push(...exprVars(m[1]));
      const href = n.href;
      if (href && href.startsWith('#') && href !== '#back' && !ids.has(href.slice(1))) warn({ id: n.addr, kind: 'dead_link', detail: `href 指向不存在的画板 “${href.slice(1)}”` });
      for (const v of refs) if (!(v in declared)) warn({ id: n.addr, kind: 'undeclared_var', detail: `变量 “${v}” 未在画板内任何节点的 proto.vars 中声明初值` });
    }
  }
  return out;
}

// ---------- 页面画板与入口页 ----------

/** “业务流程与说明”这类文档画板（按名称识别）：不是界面页面，不参与原型预览。 */
const DOC_FRAME_RE = /说明|业务流程|流程图|业务规则|需求|readme|notes?\b|spec\b|overview|flow\s*(chart|&|and)/i;
export function isDocFrame(frame: Pick<Frame, 'name'>): boolean {
  return DOC_FRAME_RE.test(frame.name);
}

/** 可预览的页面画板（排除说明 / 流程画板），保持画布顺序。 */
export function pageFrames(doc: DesignDoc): Frame[] {
  return doc.frames.filter((f) => !isDocFrame(f));
}

/**
 * 入口页：页面画板里第一个不被其他页面跳转进入的画板（如启动页、登录页）；
 * 页面互相可达（没有这样的画板）时取第一个页面画板；没有页面画板时为 undefined。
 */
export function entryFrame(doc: DesignDoc): Frame | undefined {
  const pages = pageFrames(doc);
  if (pages.length < 2) return pages[0];
  const ids = new Set(pages.map((f) => f.id));
  const targeted = new Set<string>();
  const acts = (from: string, l?: ProtoAction[]) => {
    for (const a of l ?? []) {
      if (a.do === 'navigate' && a.frame !== from && ids.has(a.frame)) targeted.add(a.frame);
      if (a.do === 'if') (acts(from, a.then), acts(from, a.else));
      if (a.do === 'delay' || a.do === 'countdown') acts(from, a.then);
    }
  };
  for (const f of pages) {
    for (const n of flattenFrame(doc, f)) {
      if (n.proto) (acts(f.id, n.proto.onClick), acts(f.id, n.proto.onLoad));
      const to = n.href && n.href.startsWith('#') && n.href !== '#back' ? n.href.slice(1) : undefined;
      if (to && to !== f.id && ids.has(to)) targeted.add(to);
    }
  }
  return pages.find((f) => !targeted.has(f.id)) ?? pages[0];
}
