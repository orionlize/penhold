// 中间画布：缩放平移、画板 iframe、选中覆盖层与盒模型高亮、原地文本编辑。
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { getIndex, inferRender } from '../../../src/core/doc';
import { isDocFrame } from '../../../src/core/states';
import { commitPatch, effective, listeners, select, send, setUi, toast, useStore } from '../store';
import { dirtyByFrame, FrameView, insertedByFrame, probeStates } from '../lib/frames';
import type { PageStatus, PlanPage } from '../../../src/core/types';
import { AiCursor } from './AiCursor';
import { AnnotationLayer, ToolLayer } from './Annotations';
import { placements } from '../lib/geom';
import { Toolbar, ZoomControl } from './Toolbar';
import { t } from '../i18n';
import { Icon } from '../lib/icons';
import { TweaksPanel } from './Tweaks';
import { startPlay } from './Player';
import { exportFrame, type FrameExportKind } from '../lib/frameExport';
import { refCards, type RefCard } from '../../../src/core/links';
import { getForeign, loadForeign, useForeignVersion } from '../lib/foreign';

export const views = new Map<string, FrameView>();

// ---------- 按需挂载画板 ----------
// 每个画板是一个常驻 iframe，画板多时加载慢、占内存。画板第一次进入可视区域附近、或被截图 / 测量 / 选中 /
// AI 光标用到时才挂载 iframe，挂载后一直保留（截图、测量、自动高度与批注定位都依赖已渲染的 iframe）。
const live = new Set<string>();
let liveChanged: (() => void) | null = null;

/** 让这些画板挂载 iframe（节点地址会换成所在画板）。 */
export function ensureLive(addrs: string[]) {
  const doc = useStore.getState().doc;
  if (!doc) return;
  let changed = false;
  for (const a of addrs) {
    const id = doc.frames.some((f) => f.id === a) ? a : getIndex(doc).get(a.split(':')[0])?.frame?.id;
    if (id && !live.has(id)) {
      live.add(id);
      changed = true;
    }
  }
  if (changed) liveChanged?.();
}

const HEIGHTS_KEY = (canvasId: string) => `dm-frame-heights:${canvasId}`;
/** 上次看到的自动高度：未挂载的画板按它占位，避免布局跳动。 */
function cachedHeights(canvasId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HEIGHTS_KEY(canvasId)) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export function viewOf(addr: string): FrameView | undefined {
  const doc = useStore.getState().doc;
  if (!doc) return;
  for (const v of views.values()) if (v.element(addr)) return v;
  return undefined;
}

// 守护进程请求截图 / 测量
/** 等待目标所在画板的 iframe 就绪（新建画板时 iframe 仍在加载）。 */
async function waitView(target: string, timeout = 5000): Promise<FrameView | undefined> {
  const start = Date.now();
  for (;;) {
    const v = views.get(target) ?? viewOf(target);
    if (v?.ready && v.element(target)) {
      // 后台标签页不触发 requestAnimationFrame，这里用定时器让布局稳定
      await new Promise((r) => setTimeout(r, 30));
      return v;
    }
    if (Date.now() - start > timeout) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * 把节点（或画板）移进可视区域：已完整可见时不动；否则平移使其居中，放不下时缩小到能放下
 * （最小 25%，仍放不下的高页面贴顶显示）。用于图层树点击定位。
 */
export async function revealNode(addr: string) {
  ensureLive([addr]);
  const v = await waitView(addr);
  const s = useStore.getState();
  const el = document.querySelector('.viewport');
  const p = placements(s.doc).find((q) => q.f.id === v?.frameId);
  const r = v?.rect(addr);
  if (!v || !el || !p || !r || (!r.width && !r.height)) return; // 隐藏节点没有尺寸，不移动
  const vw = el.clientWidth;
  const vh = el.clientHeight;
  const M = 60; // 四周留白（避开顶部工具栏与底部缩放条）
  const wx = p.x + r.left;
  const wy = r.top;
  const sx = s.panX + wx * s.zoom;
  const sy = s.panY + wy * s.zoom;
  if (sx >= M && sy >= M && sx + r.width * s.zoom <= vw - M && sy + r.height * s.zoom <= vh - M) return;
  const fit = Math.min((vw - 2 * M) / Math.max(r.width, 1), (vh - 2 * M) / Math.max(r.height, 1));
  const z = Math.min(s.zoom, Math.max(0.25, fit));
  const panX = (vw - r.width * z) / 2 - wx * z;
  const panY = r.height * z <= vh - 2 * M ? (vh - r.height * z) / 2 - wy * z : M - wy * z;
  useStore.setState({ zoom: z, panX, panY });
  setUi({});
}

listeners.shot = async (reqId, target, scale) => {
  try {
    ensureLive([target]);
    const v = await waitView(target);
    if (!v) throw new Error(`画布中找不到 ${target}（节点可能被隐藏）`);
    v.finishReveal(); // 截图与检查必须看到最终状态，不能停在回放中途
    const report = v.check(target);
    const png = await v.screenshot(target, scale);
    send({ t: 'shot_result', reqId, png, report });
  } catch (e) {
    send({ t: 'shot_result', reqId, error: (e as Error).message });
  }
};
listeners.probe = async (reqId, req) => {
  try {
    const s = useStore.getState();
    const results = await probeStates(s.canvasId!, () => useStore.getState().doc, req);
    send({ t: 'probe_result', reqId, results });
  } catch (e) {
    send({ t: 'probe_result', reqId, error: (e as Error).message });
  }
};
listeners.measure = async (reqId, ids) => {
  // 还没挂载的画板先挂载并等它渲染好
  ensureLive(ids);
  await Promise.all(ids.map((id) => waitView(id)));
  const sizes = {};
  for (const v of views.values()) Object.assign(sizes, v.measure(ids));
  send({ t: 'measure_result', reqId, sizes });
};

export function Viewport() {
  const doc = useStore((s) => s.doc);
  const version = useStore((s) => s.version);
  const zoom = useStore((s) => s.zoom);
  const panX = useStore((s) => s.panX);
  const panY = useStore((s) => s.panY);
  const canvasId = useStore((s) => s.canvasId);
  const heights = useStore((s) => s.frameHeights);
  const [tick, bump] = useReducer((x: number) => x + 1, 0);
  const root = useRef<HTMLDivElement>(null);
  const [, liveBump] = useReducer((x: number) => x + 1, 0);
  const [vpSize, setVpSize] = useState({ w: 1600, h: 1000 });
  useEffect(() => {
    liveChanged = liveBump;
    return () => {
      liveChanged = null;
    };
  }, []);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 换画布时重新按需挂载
  useEffect(() => {
    live.clear();
    liveBump();
  }, [canvasId]);
  // 自动高度存到本地，下次打开时未挂载的画板按它占位
  useEffect(() => {
    if (!canvasId || !Object.keys(heights).length) return;
    try {
      localStorage.setItem(HEIGHTS_KEY(canvasId), JSON.stringify({ ...cachedHeights(canvasId), ...heights }));
    } catch {
      /* 无存储时只是占位高度不准 */
    }
  }, [canvasId, heights]);
  // 选中、编辑与 AI 光标所在的画板必须挂载
  const selection = useStore((s) => s.selection);
  const aiTarget = useStore((s) => s.aiTarget);
  const editingText = useStore((s) => s.editingText);
  useEffect(() => {
    ensureLive([...selection, ...(aiTarget ? [aiTarget.frame] : []), ...(editingText ? [editingText] : [])]);
  }, [selection, aiTarget, editingText, doc]);
  const spaceDown = useRef(false);
  const downTarget = useRef<EventTarget | null>(null);

  // 增量应用引擎广播的操作
  useLayoutEffect(() => {
    const s = useStore.getState();
    if (!s.doc) return;
    const last = s.lastOps;
    if (!last) {
      for (const v of views.values()) v.renderAll();
    } else {
      const dirty = dirtyByFrame(s.doc, last.ops, last.pre);
      const tokens = last.ops.some((o) => o.op === 'set_tokens');
      for (const v of views.values()) {
        if (tokens) v.renderTokens();
        if (dirty === 'all' || dirty.has(v.frameId)) v.finishReveal();
        if (dirty === 'all') v.renderAll();
        else if (dirty.has(v.frameId)) v.rerender(dirty.get(v.frameId)!);
      }
      // AI 新插入的节点按顺序逐个显示，光标跟随（新画板的 iframe 尚未就绪时排队到加载完成）
      if (last.origin === 'ai') {
        for (const [frameId, addrs] of insertedByFrame(s.doc, last.ops)) views.get(frameId)?.reveal(addrs);
      }
    }
    bump();
    // 画布上新建的文字节点 / 画板：选中并进入编辑
    const pe = s.pendingEdit;
    if (pe && s.doc) {
      const frame = s.doc.frames.find((f) => f.id === pe);
      if (frame) {
        useStore.setState({ pendingEdit: null });
        select([pe]);
        const p = placements(s.doc).find((q) => q.f.id === pe)!;
        const vp = root.current!.getBoundingClientRect();
        const z = Math.min(1, (vp.width - 160) / frame.width, (vp.height - 160) / p.h);
        useStore.setState({ zoom: z, panX: (vp.width - frame.width * z) / 2 - p.x * z, panY: 80 });
        setUi({});
      } else if (effective(s.doc, pe)) {
        useStore.setState({ pendingEdit: null });
        select([pe]);
        setTimeout(() => useStore.setState({ editingText: pe, editCaret: null }), 60);
      }
    }
  }, [version]);

  // 缩放与平移
  useEffect(() => {
    const el = root.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useStore.getState();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const nz = Math.min(8, Math.max(0.1, s.zoom * Math.exp(-e.deltaY * 0.01)));
        const k = nz / s.zoom;
        useStore.setState({ zoom: nz, panX: mx - (mx - s.panX) * k, panY: my - (my - s.panY) * k });
      } else useStore.setState({ panX: s.panX - e.deltaX, panY: s.panY - e.deltaY });
      setUi({});
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    // 聚焦画布内的输入框（评论、便签）时浏览器会滚动 overflow:hidden 容器，这里复位
    const onScroll = () => {
      if (el.scrollLeft || el.scrollTop) el.scrollTo(0, 0);
    };
    el.addEventListener('scroll', onScroll);
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.shiftKey && !isTyping() && !useStore.getState().play) {
        spaceDown.current = true;
        el.style.cursor = 'grab';
        e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDown.current = false;
        el.style.cursor = '';
      }
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, []);

  const onPanStart = (e: React.PointerEvent) => {
    if (!(e.button === 1 || spaceDown.current || (e.button === 0 && e.target === root.current))) return false;
    const sx = e.clientX;
    const sy = e.clientY;
    const s0 = useStore.getState();
    const move = (ev: PointerEvent) => useStore.setState({ panX: s0.panX + ev.clientX - sx, panY: s0.panY + ev.clientY - sy });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setUi({});
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return true;
  };

  const placed = placements(doc);
  const lock = useStore((s) => s.lock);
  const parked = useStore((s) => s.parkedPages);
  const pages = new Map((lock ? (lock.pages ?? []) : parked).map((p) => [p.frame, p]));

  return (
    <div
      className="viewport"
      ref={root}
      onPointerDown={(e) => {
        downTarget.current = e.target;
        for (const v of views.values()) v.finishReveal(); // 用户一动手就跳到最终状态
        if (onPanStart(e)) return;
      }}
      onClick={(e) => {
        // 仅当按下与抬起都在空白处时取消选中（按下文字后编辑框会覆盖在上方，click 目标会变成画布本身）
        const blank = (t: EventTarget | null) => t === root.current || !!(t as HTMLElement | null)?.classList?.contains('world');
        if (blank(e.target) && blank(downTarget.current)) {
          select([]);
          useStore.setState({ selNote: null, openComment: null, draft: null });
        }
      }}
    >
      <TweaksPanel />
      {!doc && <div className="empty-hint">{t('viewport.connecting')}</div>}
      {doc && !doc.frames.length && <div className="empty-hint">{t('viewport.empty')}</div>}
      <div className="world" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
        {placed.map(({ f, x }) => {
          const page = pages.get(f.id);
          const skeleton = !!page && page.status === 'pending' && page.empty;
          const cached = canvasId ? cachedHeights(canvasId)[f.id] : undefined;
          const h = heights[f.id] ?? (typeof f.height === 'number' ? f.height : (cached ?? skeletonHeight(f.width, f.height)));
          // 可视区域四周各留一屏的余量：平移时提前挂载
          const mx = vpSize.w / zoom;
          const my = vpSize.h / zoom;
          const vx = -panX / zoom;
          const vy = -panY / zoom;
          if (!live.has(f.id) && x + f.width >= vx - mx && x <= vx + 2 * mx && h >= vy - my && 0 <= vy + 2 * my) live.add(f.id);
          if (!live.has(f.id))
            return <FramePlaceholder key={f.id} x={x} width={f.width} height={h} name={f.name} zoom={zoom} />;
          return (
          <FrameBox
            key={f.id}
            frameId={f.id}
            x={x}
            width={f.width}
            declaredHeight={typeof f.height === 'number' ? f.height : null}
            height={skeleton ? Math.max(h, skeletonHeight(f.width, f.height)) : h}
            page={page}
            skeleton={skeleton}
            name={f.name}
            canvasId={canvasId}
            onHeight={(h) => useStore.setState((st) => (st.frameHeights[f.id] === h ? st : { frameHeights: { ...st.frameHeights, [f.id]: h } }))}
            tick={tick}
            spaceDown={spaceDown}
            onPan={onPanStart}
          />
          );
        })}
        {doc ? <RefCards cards={refCards(doc)} zoom={zoom} /> : null}
        <AnnotationLayer />
        <AiCursor />
      </div>
      <TextEditor />
      <ToolLayer />
      <Toolbar />
      <ZoomControl />
    </div>
  );
}

/** 空画板骨架屏的高度：声明了高度用声明值，否则按设备宽度取常见视口高度。 */
function skeletonHeight(width: number, height: number | 'auto') {
  if (typeof height === 'number') return height;
  return width <= 500 ? 844 : width <= 1100 ? 1024 : 900;
}

const PAGE_STATUS: Record<PageStatus, string> = {
  pending: t('status.pending'),
  drawing: t('status.drawing'),
  unchecked: t('status.unchecked'),
  checking: t('status.checking'),
  done: t('status.done'),
};

/** 还没挂载的画板：只占位，进入可视区域附近时换成真正的画板。 */
function FramePlaceholder(p: { x: number; width: number; height: number; name: string; zoom: number }) {
  return (
    <div className="frame frame-lazy" style={{ left: p.x, top: 0, width: p.width }}>
      <div className="frame-label" style={{ transform: `scale(${1 / p.zoom})`, transformOrigin: 'left bottom' }}>
        {p.name} <span>{p.width}</span>
      </div>
      <div className="frame-body" style={{ width: p.width, height: p.height }} />
    </div>
  );
}

/**
 * 引用卡片：本画布的页面链接到的旧画布页面（同一项目之前的迭代），只读显示名称与所在画布，
 * 不进入设计稿与导出；点“打开”在新标签页打开那个画布。
 */
function RefCards({ cards, zoom }: { cards: RefCard[]; zoom: number }) {
  useForeignVersion();
  useEffect(() => {
    for (const c of cards) loadForeign(c.canvas);
  }, [cards.map((c) => c.canvas).join(',')]);
  if (!cards.length) return null;
  return (
    <>
      {cards.map((c, i) => {
        const f = getForeign(c.canvas);
        const doc = f && typeof f === 'object' ? f : undefined;
        const page = doc?.doc.frames.find((x) => x.id === c.frame);
        const missing = f === 'error' || (doc && !page);
        return (
          <div key={`${c.canvas}/${c.frame}`} className={`ref-card${missing ? ' missing' : ''}`} style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
            {i === 0 ? (
              <div className="frame-label" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'left bottom' }}>
                {t('ref.heading')}
              </div>
            ) : null}
            <div className="ref-canvas">{doc ? doc.title : f === 'error' ? t('ref.noCanvas') : '…'}</div>
            <div className="ref-name">{page ? page.name : missing ? t('ref.noPage', { id: c.frame }) : c.frame}</div>
            {page ? <div className="ref-meta">{t('ref.readonly', { w: page.width })}</div> : null}
            <a className="ref-open" href={`/c/${c.canvas}`} target="_blank" rel="noopener">
              {t('ref.open')}
            </a>
          </div>
        );
      })}
    </>
  );
}

/** 骨架屏：不展示具体内容，整个画板就是一块带微光动画的骨架。 */
function Skeleton() {
  return <div className="skeleton" aria-hidden />;
}

function isTyping() {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

interface FrameBoxProps {
  frameId: string;
  x: number;
  width: number;
  height: number;
  declaredHeight: number | null;
  name: string;
  canvasId: string;
  onHeight: (h: number) => void;
  tick: number;
  spaceDown: React.MutableRefObject<boolean>;
  onPan: (e: React.PointerEvent) => boolean;
  page?: PlanPage;
  skeleton: boolean;
}

function FrameBox(p: FrameBoxProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const selection = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const zoom = useStore((s) => s.zoom);
  const [, force] = useReducer((x: number) => x + 1, 0);

  useLayoutEffect(() => {
    let v = views.get(p.frameId);
    if (!v) {
      v = new FrameView(p.frameId, p.canvasId, () => useStore.getState().doc);
      views.set(p.frameId, v);
    }
    v.onResize = (h) => {
      p.onHeight(h);
      force();
    };
    v.onRevealStep = (addr) => {
      if (addr) useStore.setState({ aiTarget: { frame: p.frameId, addr } });
    };
    v.attach(iframe.current!);
    return () => {
      v!.detach();
      views.delete(p.frameId);
    };
  }, [p.frameId]);

  const view = views.get(p.frameId);
  const local = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom] as const;
  };

  /** 单击直接选中命中的最深节点（Esc 回到父级）。 */
  const pickLevel = (chain: string[]): string | undefined => chain[chain.length - 1];

  const onDown = (e: React.PointerEvent) => {
    if (p.onPan(e)) return;
    if (e.button !== 0) return;
    const [lx, ly] = local(e);
    const chain = view?.hitChain(lx, ly) ?? [];
    const s = useStore.getState();
    // 点到文字元素：首次点击只选中；已处于选中状态时再点击，才进入原地编辑，光标落在点击处
    const deepest = chain[chain.length - 1];
    if (!e.shiftKey && deepest && deepest !== p.frameId && s.doc && view) {
      const eff = effective(s.doc, deepest);
      if (eff && inferRender(eff.node) === 'text') {
        if (s.editingText === deepest) return; // 编辑中：交给浏览器移动光标/选区
        e.preventDefault();
        const selected = s.selection.length === 1 && s.selection[0] === deepest;
        if (!selected) {
          select([deepest]);
          return;
        }
        if (s.lock) return toast(t('common.readonly'));
        useStore.setState({ editingText: deepest, editCaret: view.caretAt(deepest, lx, ly) });
        return;
      }
    }
    const pick = pickLevel(chain);
    if (!pick) return;
    if (e.shiftKey) select(s.selection.includes(pick) ? s.selection.filter((a) => a !== pick) : [...s.selection, pick]);
    else if (s.selection.length !== 1 || s.selection[0] !== pick) select([pick]);
  };
  const onDouble = (e: React.MouseEvent) => {
    const [lx, ly] = local(e);
    const chain = view?.hitChain(lx, ly) ?? [];
    const s = useStore.getState();
    const pick = pickLevel(chain);
    if (!pick) return;
    if (pick === s.selection[0] && s.doc) {
      const eff = effective(s.doc, pick);
      if (eff && inferRender(eff.node) === 'text') {
        if (s.lock) return toast(t('common.readonly'));
        useStore.setState({ editingText: pick, editCaret: null });
      }
      return;
    }
    select([pick]);
  };
  const onMove = (e: React.PointerEvent) => {
    const [lx, ly] = local(e);
    const chain = view?.hitChain(lx, ly) ?? [];
    const h = pickLevel(chain) ?? null;
    if (useStore.getState().hover !== h) useStore.setState({ hover: h });
  };

  const boxes: React.ReactNode[] = [];
  if (view?.ready) {
    const inv = 1 / zoom;
    if (hover && !selection.includes(hover)) {
      const r = view.rect(hover);
      if (r) boxes.push(<BoxModel key="hover" view={view} addr={hover} rect={r} inv={inv} />);
    }
    for (const a of selection) {
      const r = view.rect(a);
      if (!r) continue;
      const st = useStore.getState();
      const eff = st.doc ? effective(st.doc, a) : null;
      const tag = eff ? `${eff.node.type}${eff.node.name ? ` · ${eff.node.name}` : ''}` : a;
      boxes.push(
        <div key={a} className="sel-box" style={{ left: r.left, top: r.top, width: r.width, height: r.height, borderWidth: 1.5 * inv }}>
          {a !== p.frameId && (
            <span className="sel-tag" style={{ transform: `scale(${inv})` }}>
              {tag}
            </span>
          )}
          <span className="sel-size" style={{ transform: `scale(${inv})` }}>
            {Math.round(r.width)} × {Math.round(r.height)}
          </span>
        </div>,
      );
      if (selection.length === 1) boxes.push(<BoxModel key={`bm-${a}`} view={view} addr={a} rect={r} inv={inv} selected />);
    }
  }

  return (
    <div className="frame" style={{ left: p.x, top: 0, width: p.width }} data-tick={p.tick}>
      <div
        className={`frame-label ${selection.some((a) => a === p.frameId || viewOf(a)?.frameId === p.frameId) ? 'on' : ''}`}
        style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'left bottom' }}
        onClick={() => select([p.frameId])}
      >
        {p.name} <span>{p.width}</span>
        {p.page && <em className={`pg-chip pg-${p.page.status}`}>{PAGE_STATUS[p.page.status]}</em>}
      </div>
      {!p.skeleton && <FrameTools frameId={p.frameId} zoom={zoom} />}
      <div className={`frame-body ${p.page?.status === 'drawing' || p.page?.status === 'checking' ? 'ai-active' : ''}`} style={{ width: p.width, height: p.height }}>
        <iframe ref={iframe} sandbox="allow-same-origin" title={p.name} style={{ width: p.width, height: p.height }} />
        {p.skeleton && <Skeleton />}
        {p.declaredHeight !== null && p.height > p.declaredHeight && <div className="fold" style={{ top: p.declaredHeight }} />}
        <div className="overlay" onPointerDown={onDown} onDoubleClick={onDouble} onPointerMove={onMove} onPointerLeave={() => useStore.setState({ hover: null })}>
          {boxes}
        </div>
      </div>
    </div>
  );
}

const EXPORTS: Array<{ kind: FrameExportKind; label: string; hint?: string }> = [
  { kind: 'png1', label: 'PNG', hint: '1x' },
  { kind: 'png2', label: 'PNG', hint: '2x' },
  { kind: 'png3', label: 'PNG', hint: '3x' },
  { kind: 'pdf', label: 'PDF' },
  { kind: 'html', label: 'HTML' },
];

/** 画板上方的工具栏：单独播放此画板、导出此画板。 */
function FrameTools({ frameId, zoom }: { frameId: string; zoom: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isDoc = useStore((s) => { const f = s.doc?.frames.find((x) => x.id === frameId); return !!f && isDocFrame(f); });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const run = async (kind: FrameExportKind) => {
    setOpen(false);
    setBusy(true);
    try {
      await exportFrame(frameId, kind);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      ref={ref}
      className={`frame-tools ${open ? 'open' : ''}`}
      style={{ transform: `scale(${1 / zoom})` }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {!isDoc && (
        <button className="icon-btn xs" aria-label={t('frameTools.play')} title={t('frameTools.play')} onClick={() => startPlay(frameId)}>
          <Icon name="play" size={13} />
        </button>
      )}
      <button className={`icon-btn xs ${open ? 'on' : ''}`} aria-label={t('frameTools.export')} title={t('frameTools.export')} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>
        <Icon name="download" size={13} />
      </button>
      {open && (
        <div className="frame-menu" role="menu">
          {EXPORTS.map((x) => (
            <button key={x.kind} role="menuitem" onClick={() => run(x.kind)}>
              {x.label}
              {x.hint && <span className="fly-key">{x.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** 盒模型高亮：margin / border / padding 分色。 */
function BoxModel({ view, addr, rect, inv, selected }: { view: FrameView; addr: string; rect: DOMRect; inv: number; selected?: boolean }) {
  const cs = view.computedStyle(addr);
  if (!cs) return null;
  const n = (v: string) => parseFloat(v) || 0;
  const m = [n(cs.marginTop), n(cs.marginRight), n(cs.marginBottom), n(cs.marginLeft)];
  const b = [n(cs.borderTopWidth), n(cs.borderRightWidth), n(cs.borderBottomWidth), n(cs.borderLeftWidth)];
  const pd = [n(cs.paddingTop), n(cs.paddingRight), n(cs.paddingBottom), n(cs.paddingLeft)];
  const ring = (cls: string, outer: number[], box: { l: number; t: number; w: number; h: number }) => (
    <div
      className={`bm ${cls}`}
      style={{
        left: box.l - outer[3],
        top: box.t - outer[0],
        width: box.w + outer[1] + outer[3],
        height: box.h + outer[0] + outer[2],
        borderWidth: `${outer[0]}px ${outer[1]}px ${outer[2]}px ${outer[3]}px`,
      }}
    />
  );
  const bb = { l: rect.left, t: rect.top, w: rect.width, h: rect.height };
  const pb = { l: rect.left + b[3], t: rect.top + b[0], w: rect.width - b[1] - b[3], h: rect.height - b[0] - b[2] };
  const cb = { l: pb.l + pd[3], t: pb.t + pd[0], w: pb.w - pd[1] - pd[3], h: pb.h - pd[0] - pd[2] };
  return (
    <>
      {ring('bm-margin', m, bb)}
      {ring('bm-border', b, pb)}
      {ring('bm-padding', pd, cb)}
      {!selected && <div className="hover-box" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderWidth: inv }} />}
    </>
  );
}

/**
 * 原地文本编辑：直接把画板 iframe 中的文字元素设为可编辑，排版与渲染和编辑前完全一致
 * （不叠加输入框，不会因边框或字体渲染差异导致换行变化）。回车或失焦提交，Esc 取消。
 */
function TextEditor() {
  const editing = useStore((s) => s.editingText);

  useLayoutEffect(() => {
    if (!editing) return;
    const s = useStore.getState();
    const v = viewOf(editing);
    const el = v?.element(editing);
    const eff = s.doc && effective(s.doc, editing);
    if (!v || !el || !eff) {
      useStore.setState({ editingText: null });
      return;
    }
    const listy = eff.node.style?.listStyle && eff.node.style.listStyle !== 'none';
    if (el.children.length && !listy) {
      toast(t('viewport.textHasKids'), 'info');
      useStore.setState({ editingText: null });
      return;
    }
    const d = el.ownerDocument;
    const body = v.iframe?.parentElement;
    const original = eff.node.text ?? '';
    let latest = original;
    let done = false;
    let cancelled = false;

    if (listy) el.textContent = original; // 列表按行渲染为子元素；编辑时临时还原为纯文本
    body?.classList.add('editing');
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.spellcheck = false;
    el.style.outline = 'none';
    el.style.cursor = 'text';
    el.focus({ preventScroll: true });
    placeCaret(el, s.editCaret);

    const read = () => (el.innerText ?? el.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\u200b/g, '');
    const onInput = () => (latest = read());
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return; // 输入法组字中
      if (e.key === 'Escape') {
        cancelled = true;
        el.blur();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      }
    };
    // 点到画板内其他位置：结束编辑
    const onDocDown = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) el.blur();
    };
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', finish);
      d.removeEventListener('mousedown', onDocDown, true);
      const text = el.isConnected ? read() : latest;
      el.removeAttribute('contenteditable');
      el.style.outline = '';
      el.style.cursor = '';
      d.getSelection()?.removeAllRanges();
      body?.classList.remove('editing');
      // 焦点还回编辑器页面，否则快捷键（撤销等）会被 iframe 吞掉
      if (document.activeElement === v.iframe) v.iframe?.blur();
      if (useStore.getState().editingText === editing) useStore.setState({ editingText: null });
      const st = useStore.getState();
      const changed = !cancelled && text !== original && st.doc && effective(st.doc, editing);
      if (changed && !st.lock) commitPatch([editing], { text });
      else if (el.isConnected) v.rerender(new Set([editing])); // 恢复为文档中的内容
    };
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', finish);
    d.addEventListener('mousedown', onDocDown, true);
    return finish;
  }, [editing]);

  return null;
}

/** 把光标放在第 offset 个字符处；null 表示全选。 */
function placeCaret(el: HTMLElement, offset: number | null) {
  const d = el.ownerDocument;
  const range = d.createRange();
  if (offset === null) range.selectNodeContents(el);
  else {
    const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = offset;
    let node: Node | null = null;
    while ((node = walker.nextNode())) {
      const len = node.textContent?.length ?? 0;
      if (left <= len) break;
      left -= len;
    }
    if (node) range.setStart(node, Math.min(left, node.textContent?.length ?? 0));
    else range.selectNodeContents(el), range.collapse(false);
    range.collapse(true);
  }
  const sel = d.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
