// 画布前端状态：本地文档副本只渲染引擎广播的结果，不直接修改文档。
import { create } from 'zustand';
import { applyOps, getIndex, resolveAddress } from '../../src/core/doc';
import { updateOps, type NodePatch } from '../../src/core/edit';
import { chooseTheme, currentTheme, onThemeChange, type Theme } from './theme';
export type { Theme };
import type { Annotation, BriefForm, StrokeDash, ClientMsg, DesignDoc, LockInfo, Node, Op, PlanPage, ProbeRequest, ServerMsg, ThemeInfo, UiState } from '../../src/core/types';
import { t } from './i18n';

/** 铅笔可选的 4 档线宽（px）。 */
export const PEN_WIDTHS = [1.5, 2.5, 4, 6];

export type PenMode = 'pencil' | 'path';
export interface PenOpts {
  mode: PenMode;
  width: number;
  dash: StrokeDash;
  /** #RRGGBB；缺省为批注红。 */
  color?: string;
}

export type Tool = 'select' | 'hand' | 'text' | 'board' | 'note' | 'pen' | 'shape' | 'comment';
/** 形状工具可绘制的批注类型。 */
export type ShapeKind = 'rect' | 'round' | 'oval' | 'diamond' | 'line' | 'arrow';

/** 正在撰写、尚未发送的评论。 */
export interface DraftComment {
  frame?: string;
  anchor?: string;
  anchorNote?: string;
  rel?: [number, number];
  pts: Array<[number, number]>;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

interface State {
  canvasId: string;
  doc: DesignDoc | null;
  version: number; // 每次文档变化 +1，驱动重新渲染
  lastOps: { ops: Op[]; pre: Map<string, string | null>; origin: 'ai' | 'user' } | null;
  /** 回放中 AI 光标所在的节点；null 时光标落在 lock.cursor.addr。 */
  aiTarget: { frame: string; addr: string } | null;
  connected: boolean;
  lock: LockInfo | null;
  /** AI 的编辑锁因空闲释放后仍保留的规划页面（继续显示骨架屏）。 */
  parkedPages: PlanPage[];
  title: string;
  selection: string[];
  hover: string | null;
  /** 悬停高亮的批注（评论模式、图层行、评论图钉）。 */
  hoverNote: string | null;
  zoom: number;
  panX: number;
  panY: number;
  userUndo: number;
  userRedo: number;
  aiRound: boolean;
  /** 用户改动前的基线值（`${存储节点id}.${字段键}`），用于属性“重置”。 */
  userBase: Record<string, unknown>;
  editingText: string | null;
  /** 进入文本编辑时的光标位置；null 表示全选。 */
  editCaret: number | null;
  toasts: Toast[];
  fonts: string[];
  /** 画板实际渲染高度（auto 高度由内容撑开）。 */
  frameHeights: Record<string, number>;
  tool: Tool;
  /** 形状工具当前绘制的形状。 */
  shape: ShapeKind;
  /** 铅笔笔触：模式（pencil 手绘 / path 钢笔）、线宽（px）与线型。 */
  pen: PenOpts;
  /** 工具栏展开的子菜单。 */
  fly: 'shape' | 'board' | 'pen' | null;
  notes: Annotation[];
  /** AI 发来的需求问卷（design_ask），等待用户回答。 */
  brief: BriefForm | null;
  /** 画布装的设计系统与当前主题。 */
  themeInfo: ThemeInfo | null;
  /** 刚被删除、正在播放退场动画的批注（仅用于渲染）。 */
  ghosts: Annotation[];
  /** 选中的批注 id。 */
  selNote: string | null;
  /** 正在编辑文字的批注 id。 */
  editNote: string | null;
  /** 展开气泡的评论 id；'draft' 表示新评论。 */
  openComment: string | null;
  draft: DraftComment | null;
  /** 新插入后待进入编辑的文字节点 id。 */
  pendingEdit: string | null;
  /** 正在绘制、尚未提交的批注。 */
  live: Annotation | null;
  theme: Theme;
  /** 播放（原型预览）中的画板浏览历史，末尾为当前画板；null 表示未在播放。 */
  play: string[] | null;
}

/** 选择器兜底用的稳定空值：selector 每次返回新的 [] / {} 会让 useSyncExternalStore 无限重渲染（React #185）。 */
export const EMPTY_TOKENS: Record<string, string> = Object.freeze({}) as Record<string, string>;
export const EMPTY_TWEAKS: never[] = Object.freeze([]) as unknown as never[];

export const useStore = create<State>(() => ({
  canvasId: '',
  doc: null,
  version: 0,
  lastOps: null,
  aiTarget: null,
  connected: false,
  lock: null,
  parkedPages: [],
  title: '',
  selection: [],
  hover: null,
  hoverNote: null,
  zoom: 1,
  panX: 40,
  panY: 60,
  userUndo: 0,
  userRedo: 0,
  aiRound: false,
  userBase: {},
  editingText: null,
  editCaret: null,
  toasts: [],
  fonts: [],
  frameHeights: {},
  tool: 'select',
  shape: 'rect',
  pen: { mode: 'pencil', width: PEN_WIDTHS[1], dash: 'solid' },
  fly: null,
  notes: [],
  brief: null,
  themeInfo: null,
  ghosts: [],
  selNote: null,
  editNote: null,
  openComment: null,
  draft: null,
  pendingEdit: null,
  live: null,
  theme: currentTheme(),
  play: null,
}));

export function setTheme(theme: Theme) {
  chooseTheme(theme);
}
onThemeChange((theme) => useStore.setState({ theme }));

export function setTool(tool: Tool) {
  useStore.setState({ tool, fly: null, editingText: null, ...(tool !== 'comment' ? { draft: null, openComment: null } : {}) });
}

export function putNote(note: Annotation) {
  useStore.setState((s) => ({ notes: s.notes.some((n) => n.id === note.id) ? s.notes.map((n) => (n.id === note.id ? note : n)) : [...s.notes, note] }));
  send({ t: 'note_put', note });
}

export function delNote(id: string) {
  addGhosts(useStore.getState().notes.filter((n) => n.id === id));
  useStore.setState((s) => ({ notes: s.notes.filter((n) => n.id !== id), selNote: s.selNote === id ? null : s.selNote, openComment: s.openComment === id ? null : s.openComment }));
  send({ t: 'note_del', id });
}

/** 退场动画时长（与 styles.css 中 note-out 一致）。 */
const LEAVE_MS = 200;

/** 被删除的批注留作“幽灵”播放退场动画，结束后移除。 */
function addGhosts(gone: Annotation[]) {
  if (!gone.length) return;
  const ids = new Set(gone.map((n) => n.id));
  useStore.setState((s) => ({ ghosts: [...s.ghosts.filter((g) => !ids.has(g.id)), ...gone] }));
  setTimeout(() => useStore.setState((s) => ({ ghosts: s.ghosts.filter((g) => !ids.has(g.id) || !gone.includes(g)) })), LEAVE_MS);
}

export function noteId() {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return `a_${[...buf].map((b) => a[b % a.length]).join('')}`;
}

let ws: WebSocket | null = null;
let toastSeq = 0;
let uiTimer: ReturnType<typeof setTimeout> | undefined;
/** 守护进程发来的截图 / 测量请求由画布视图处理。 */
export const listeners = {
  shot: null as null | ((reqId: string, target: string, scale: number) => void),
  measure: null as null | ((reqId: string, ids: string[]) => void),
  probe: null as null | ((reqId: string, req: ProbeRequest) => void),
};

export function toast(text: string, kind: Toast['kind'] = 'error') {
  const id = ++toastSeq;
  useStore.setState((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 3000);
}

export function send(msg: ClientMsg) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
  else toast(t('store.disconnected'));
}

/** 移除/移动前记下节点的父节点，供增量渲染定位。 */
function preParents(doc: DesignDoc, ops: Op[]): Map<string, string | null> {
  const idx = getIndex(doc);
  const m = new Map<string, string | null>();
  for (const op of ops) if (op.op === 'remove' || op.op === 'move') m.set(op.id, idx.get(op.id)?.parent?.id ?? null);
  return m;
}

function handle(msg: ServerMsg) {
  const s = useStore.getState();
  switch (msg.t) {
    case 'init':
      useStore.setState({
        doc: msg.doc,
        version: s.version + 1,
        lastOps: null,
        lock: msg.lock,
        parkedPages: msg.pages ?? [],
        title: msg.title,
        zoom: msg.ui.zoom ?? 1,
        panX: msg.ui.panX ?? 40,
        panY: msg.ui.panY ?? 60,
        selection: (msg.ui.selection ?? []).filter((a) => validAddr(msg.doc, a)),
        userUndo: msg.userUndo,
        userRedo: msg.userRedo,
        aiRound: msg.aiRound,
        userBase: msg.userBase ?? {},
        notes: msg.notes ?? [],
        brief: msg.brief ?? null,
        themeInfo: msg.themeInfo ?? null,
      });
      break;
    case 'brief':
      useStore.setState({ brief: msg.form });
      break;
    case 'notes': {
      // 远端（如 AI）删除的批注同样播放退场动画
      const keep = new Set(msg.notes.map((n) => n.id));
      addGhosts(s.notes.filter((n) => !keep.has(n.id)));
      useStore.setState((st) => ({ notes: msg.notes, selNote: msg.notes.some((n) => n.id === st.selNote) ? st.selNote : null }));
      break;
    }
    case 'tx': {
      if (!s.doc) return;
      const info = { userUndo: msg.userUndo, userRedo: msg.userRedo, aiRound: msg.aiRound, userBase: msg.userBase ?? {} };
      if (!msg.ops.length) return useStore.setState(info);
      const pre = preParents(s.doc, msg.ops);
      try {
        applyOps(s.doc, msg.ops);
        s.doc.rev = msg.rev;
      } catch (e) {
        console.error('本地应用操作失败，重新同步', e);
        ws?.close();
        return;
      }
      useStore.setState({
        version: s.version + 1,
        lastOps: { ops: msg.ops, pre, origin: msg.origin },
        ...(msg.origin === 'ai' ? { aiTarget: null } : {}),
        selection: s.selection.filter((a) => validAddr(s.doc!, a)),
        ...info,
      });
      break;
    }
    case 'lock':
      useStore.setState({ lock: msg.lock, parkedPages: msg.lock ? [] : (msg.pages ?? []), ...(msg.lock ? {} : { aiTarget: null }) });
      if (msg.lock) useStore.setState({ editingText: null });
      break;
    case 'flush': {
      // 用户正在输入的值先提交，再让 AI 加锁
      const el = document.activeElement as HTMLElement | null;
      if (el && el !== document.body) el.blur();
      setTimeout(() => send({ t: 'flushed', reqId: msg.reqId }), 0);
      break;
    }
    case 'shot':
      listeners.shot?.(msg.reqId, msg.target, msg.scale);
      break;
    case 'measure':
      listeners.measure?.(msg.reqId, msg.ids);
      break;
    case 'probe':
      listeners.probe?.(msg.reqId, msg.req);
      break;
    case 'error':
      toast(msg.message);
      break;
    case 'themeInfo':
      useStore.setState({ themeInfo: msg.info });
      break;
    case 'title':
      useStore.setState({ title: msg.title });
      document.title = `${msg.title} · penhold-mcp`;
      break;
  }
}

function validAddr(doc: DesignDoc, a: string) {
  try {
    resolveAddress(doc, a);
    return true;
  } catch {
    return false;
  }
}

/** 当前页面加载的入口脚本与服务端 index.html 引用的不同（前端已重新构建）时刷新页面。 */
function reloadIfStale() {
  const mine = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src');
  if (!mine) return; // 开发服务器（vite）下不处理
  fetch(location.pathname, { cache: 'no-store' })
    .then((r) => (r.ok ? r.text() : ''))
    .then((html) => {
      const latest = /<script[^>]*type="module"[^>]*src="([^"]+)"/.exec(html)?.[1];
      if (latest && latest !== mine) location.reload();
    })
    .catch(() => {});
}

export function connect(canvasId: string) {
  useStore.setState({ canvasId });
  let retry = 0;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?canvas=${canvasId}`);
    ws.onopen = () => {
      // 断线重连（通常是守护进程重启）后，前端可能已重新构建：页面仍在运行旧脚本时自动刷新
      if (retry > 0) reloadIfStale();
      retry = 0;
      useStore.setState({ connected: true });
    };
    ws.onmessage = (ev) => handle(JSON.parse(ev.data));
    ws.onclose = (ev) => {
      useStore.setState({ connected: false });
      if (ev.code === 4004 || ev.code === 4000) return toast(ev.reason || t('store.unavailable'));
      setTimeout(open, Math.min(5000, 300 * 2 ** retry++));
    };
  };
  open();
  fetch('/api/fonts')
    .then((r) => r.json())
    .then((fonts: string[]) => useStore.setState({ fonts }))
    .catch(() => {});
}

export function setUi(patch: Partial<UiState>) {
  clearTimeout(uiTimer);
  if (patch.selection) send({ t: 'ui', ui: { selection: patch.selection } });
  uiTimer = setTimeout(() => {
    const s = useStore.getState();
    send({ t: 'ui', ui: { zoom: s.zoom, panX: s.panX, panY: s.panY } });
  }, 400);
}

export function select(addrs: string[]) {
  useStore.setState({ selection: addrs, editingText: null });
  setUi({ selection: addrs });
}

/** 用户改字段：对每个选中地址生成操作，合成一个事务提交。 */
export function commitPatch(addrs: string[], patch: NodePatch | ((addr: string) => NodePatch)) {
  const s = useStore.getState();
  if (!s.doc) return;
  if (s.lock) return toast(t('common.readonly'));
  const ops: Op[] = [];
  const seen = new Set<string>();
  try {
    for (const a of addrs) {
      const p = typeof patch === 'function' ? patch(a) : patch;
      const r = updateOps(s.doc, a, p, 'user');
      for (const op of r.ops) {
        const key = JSON.stringify(op.op === 'set' ? [op.id, op.field] : op);
        if (op.op === 'set' && seen.has(key)) continue; // 多个实例指向同一组件定义
        seen.add(key);
        ops.push(op);
      }
    }
  } catch (e) {
    return toast((e as Error).message);
  }
  if (ops.length) send({ t: 'tx', ops });
}

/** 删除选中的元素：画板根删整个画板；跳过已被选中祖先覆盖的子孙；实例内部节点不能删。 */
export function deleteSelection() {
  const s = useStore.getState();
  if (!s.doc || !s.selection.length) return;
  if (s.lock) return toast(t('common.readonly'));
  const doc = s.doc;
  const idx = getIndex(doc);
  const picked = new Set<string>();
  const ops: Op[] = [];
  let blocked = false;
  for (const a of s.selection) {
    let r;
    try {
      r = resolveAddress(doc, a);
    } catch {
      continue;
    }
    if (r.instance) {
      blocked = true;
      continue;
    }
    picked.add(r.target.node.id);
  }
  for (const id of picked) {
    // 祖先已在删除列表中则跳过
    let p = idx.get(id)?.parent;
    let covered = false;
    while (p) {
      if (picked.has(p.id)) covered = true;
      p = idx.get(p.id)?.parent ?? null;
    }
    if (covered) continue;
    const loc = idx.get(id)!;
    if (!loc.parent) ops.push({ op: 'frame_remove', id });
    else ops.push({ op: 'remove', id });
  }
  if (blocked) toast(ops.length ? t('store.instSkipped') : t('store.instBlocked'));
  if (!ops.length) return;
  select([]);
  send({ t: 'tx', ops });
}

export function commitOps(ops: Op[]) {
  if (useStore.getState().lock) return toast(t('common.readonly'));
  if (ops.length) send({ t: 'tx', ops });
}

/** 节点在面板中显示的有效字段（实例根取组件定义的盒模型与样式；实例内部应用 overrides）。 */
export function effective(doc: DesignDoc, addr: string): { node: Node; storage: Node; component?: string; instanceOf?: string; inInstance: boolean } | null {
  try {
    const r = resolveAddress(doc, addr);
    const n = r.target.node;
    if (r.instance) {
      const ov = r.instance.node.overrides?.[r.instance.path];
      const node: Node = { ...n, text: ov?.text ?? n.text, props: ov?.props ? { ...n.props, ...ov.props } : n.props, meta: { ...n.meta, hidden: ov?.hidden ?? n.meta?.hidden } };
      if (n.component && doc.components[n.component]) {
        const m = mergeInstance(doc, n);
        Object.assign(node, m, { text: ov?.text ?? n.text ?? doc.components[n.component].root.text, props: ov?.props ? { ...m.props, ...ov.props } : m.props, meta: node.meta });
      }
      return { node, storage: n, component: n.component ?? r.target.component, instanceOf: r.target.component, inInstance: true };
    }
    if (n.component && doc.components[n.component]) return { node: mergeInstance(doc, n), storage: n, component: n.component, inInstance: false };
    return { node: n, storage: n, component: r.target.component, inInstance: false };
  } catch {
    return null;
  }
}

function mergeInstance(doc: DesignDoc, inst: Node): Node {
  const def = doc.components[inst.component!].root;
  return {
    ...def,
    id: inst.id,
    name: inst.name ?? def.name,
    component: inst.component,
    layout: inst.layout ? { ...def.layout, ...inst.layout } : def.layout,
    text: inst.text ?? def.text,
    props: inst.props ? { ...def.props, ...inst.props } : def.props,
    meta: inst.meta,
    overrides: inst.overrides,
  };
}
