// 播放（原型预览）：按导出渲染画板，悬停 / 聚焦 / 按下状态生效、输入框可输入；
// 节点的 proto 交互（状态变量、点击动作、倒计时、条件显隐与样式）由 ProtoRuntime 驱动；
// props.href 跳转到目标画板（"#<画板id>"）、返回（"#back"）或在新窗口打开外部链接。
// 跨画布链接（"#<画布id>/<画板id>"，同一项目的旧迭代）就地只读加载另一个画布的设计稿播放，返回时回到本画布；
// 这类历史记录写作 "<画布id>/<画板id>"。
// 画板像设备屏幕一样以固定高度显示（auto 高度按宽度推断，见 screenHeight），内容超出时在屏幕内滚动，
// sticky 的顶栏 / 底栏随之固定在屏幕上。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { findFrameOfAddr } from '../../../src/core/doc';
import { frameVars } from '../../../src/core/proto';
import { entryFrame, isDocFrame, pageFrames } from '../../../src/core/states';
import { BACK_HREF, hrefTarget, newSerializeState, renderFrame, RESET_CSS, screenHeight, serialize, tokensCss, type ProtoEntry } from '../../../src/core/render';
import { Icon } from '../lib/icons';
import { ProtoRuntime, type ProtoRuntimeType } from '../lib/protoRuntime';
import { toast, useStore } from '../store';
import { t } from '../i18n';
import { Select } from '../inspector/fields';
import { getForeign, loadForeign, useForeignVersion } from '../lib/foreign';

const PLAY_CSS = `html,body{background:#fff}
html{height:100%;overflow:auto;scrollbar-width:none}
html::-webkit-scrollbar{display:none}
[data-dm-href],[data-dm-click]{cursor:pointer}
[data-dm-disabled],[data-dm-disabled] *{cursor:not-allowed}
body.dm-hint :is([data-dm-href],[data-dm-click]){outline:2px solid rgba(37,99,235,.55);outline-offset:-2px;transition:outline-color .2s}`;

/**
 * 开始播放。传 frameId（画板工具栏的播放）时从该画板开始；
 * 不传（全局工具栏 / 快捷键）时总是从入口页开始。说明 / 流程等文档画板不参与预览。
 */
export function startPlay(frameId?: string) {
  const s = useStore.getState();
  const doc = s.doc;
  if (!doc) return;
  const picked = frameId ? doc.frames.find((f) => f.id === frameId) : undefined;
  const start = picked && !isDocFrame(picked) ? picked.id : entryFrame(doc)?.id;
  if (!start) return;
  useStore.setState({ play: [start], editingText: null, fly: null });
}

export const stopPlay = () => useStore.setState({ play: null });

/** 历史记录项：本画布写画板 id，别的画布写 "<画布id>/<画板id>"。 */
function parseEntry(e: string): { canvas?: string; frame: string } {
  const i = e.indexOf('/');
  return i < 0 ? { frame: e } : { canvas: e.slice(0, i), frame: e.slice(i + 1) };
}

/** 跳转。canvas 缺省时指当前所在画布（正在播放别的画布的页面时，本地链接指那个画布）。 */
function go(id: string, canvas?: string) {
  const s = useStore.getState();
  if (!s.play) return;
  const here = parseEntry(s.play[s.play.length - 1]).canvas;
  const target = canvas ?? here;
  if (!target || target === s.canvasId) {
    if (!s.doc?.frames.some((f) => f.id === id && !isDocFrame(f))) return toast(t('player.noTarget'));
    if (s.play[s.play.length - 1] !== id) useStore.setState({ play: [...s.play, id] });
    return;
  }
  const f = getForeign(target);
  if (f && typeof f === 'object' && !f.doc.frames.some((x) => x.id === id && !isDocFrame(x))) return toast(t('player.noTarget'));
  if (f === 'error') return toast(t('player.noTarget'));
  loadForeign(target);
  const entry = `${target}/${id}`;
  if (s.play[s.play.length - 1] !== entry) useStore.setState({ play: [...s.play, entry] });
}

function back() {
  const p = useStore.getState().play;
  if (p && p.length > 1) useStore.setState({ play: p.slice(0, -1) });
}

function open(url: string) {
  if (/^(https?:|mailto:|tel:)/i.test(url.trim())) window.open(url.trim(), '_blank', 'noopener');
  else toast(t('player.linkExport', { url }), 'info');
}

function follow(href: string) {
  if (href === BACK_HREF) return back();
  const target = hrefTarget(href);
  if (target) return go(target.frame, target.canvas);
  open(href);
}

export function Player() {
  const play = useStore((s) => s.play);
  if (!play) return null;
  return <PlayerView history={play} />;
}

function PlayerView({ history }: { history: string[] }) {
  const ownDoc = useStore((s) => s.doc);
  const version = useStore((s) => s.version);
  const ownId = useStore((s) => s.canvasId);
  const fver = useForeignVersion();
  const cur = history[history.length - 1];
  const entry = parseEntry(cur);
  const isForeign = !!entry.canvas && entry.canvas !== ownId;
  const ext = isForeign ? getForeign(entry.canvas!) : undefined;
  const doc = isForeign ? (ext && typeof ext === 'object' ? ext.doc : undefined) : ownDoc;
  const canvasId = isForeign ? entry.canvas! : ownId;
  const frame = doc?.frames.find((f) => f.id === entry.frame && !isDocFrame(f));
  const stage = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const runtime = useRef<ProtoRuntimeType | null>(null);
  useEffect(() => () => runtime.current?.stopAll(), []);

  // 当前画板被删除（或别的画布加载失败 / 没有该画板）：退回上一个仍存在的画板，都不在则退出
  useEffect(() => {
    if (isForeign) {
      if (entry.canvas) loadForeign(entry.canvas);
      if (ext === 'error' || (doc && !frame)) {
        toast(t('player.noTarget'));
        useStore.setState({ play: history.length > 1 ? history.slice(0, -1) : null });
      }
      return;
    }
    if (!ownDoc || frame) return;
    const pages = new Set(pageFrames(ownDoc).map((f) => f.id));
    const alive = history.filter((id) => pages.has(id) || parseEntry(id).canvas);
    const first = entryFrame(ownDoc);
    useStore.setState({ play: alive.length ? alive : first ? [first.id] : null });
  }, [ownDoc, doc, frame, history, version, isForeign, ext, fver]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) return;
      if (e.key === 'Escape') stopPlay();
      else if (e.key === 'Backspace' || (e.key === 'ArrowLeft' && e.altKey)) back();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // iframe 文档：一次性建立，之后只替换样式与内容
  useEffect(() => {
    const f = iframe.current!;
    f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>${RESET_CSS}\n${PLAY_CSS}</style><style id="dm-tokens"></style><style id="dm-rules"></style></head><body></body></html>`;
    f.onload = () => {
      const d = f.contentDocument!;
      runtime.current = new ProtoRuntime(f.contentWindow!, { go, back, open, follow });
      d.addEventListener('click', (e) => {
        const t = e.target as Element | null;
        if (!t?.closest) return;
        if (runtime.current!.click(t)) return e.preventDefault();
        // 点到非交互区域：短暂高亮所有可点击元素
        if (t.closest('input,textarea')) return;
        d.body.classList.add('dm-hint');
        setTimeout(() => d.body.classList.remove('dm-hint'), 700);
      });
      d.addEventListener('input', (e) => {
        const t = e.target as Element | null;
        if (t?.getAttribute) runtime.current!.input(t);
      });
      d.addEventListener('keydown', (e) => {
        const t = e.target as HTMLElement;
        const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
        if (e.key === 'Escape') stopPlay();
        else if (!typing && e.key === 'Backspace') back();
        else return;
        e.preventDefault();
      });
      setReady(true);
    };
  }, []);

  // 渲染当前画板（文档变化时就地刷新，保留滚动位置；换画板时回到顶部）
  const lastFrame = useRef<string | null>(null);
  const lastHtml = useRef('');
  const lastVisit = useRef('');
  useEffect(() => {
    const d = iframe.current?.contentDocument;
    if (!ready || !d || !doc || !frame) return;
    const asset = (hash: string) => {
      const a = doc.assets[hash];
      return a ? `/c/${canvasId}/assets/${a.file}` : undefined;
    };
    const st = newSerializeState('class');
    const entries: ProtoEntry[] = [];
    const html = serialize(
      renderFrame(doc, frame, {
        mode: 'export',
        asset,
        link: (href) => ({ tag: 'div', attrs: { 'data-dm-href': href } }),
        proto: (e) => String(entries.push(e) - 1),
      }),
      st,
    );
    const rt = runtime.current!;
    const visit = `${history.length}:${cur}`;
    const entering = visit !== lastVisit.current;
    // 内容未变（如其他画板被修改）时不重绘，保留输入框里输入的内容与当前状态
    const key = `${cur}\n${frame.height}\n${tokensCss(doc.tokens)}\n${st.rules.join('\n')}\n${JSON.stringify(entries)}\n${html}`;
    if (key === lastHtml.current && !entering) return;
    lastHtml.current = key;
    lastVisit.current = visit;
    if (entering) rt.reset(frameVars(doc, frame));
    else rt.merge(frameVars(doc, frame));
    d.getElementById('dm-tokens')!.textContent = tokensCss(doc.tokens);
    d.getElementById('dm-rules')!.textContent = st.rules.join('\n');
    const sc = d.scrollingElement;
    const keep = lastFrame.current === cur ? { x: sc?.scrollLeft ?? 0, y: sc?.scrollTop ?? 0 } : { x: 0, y: 0 };
    d.body.innerHTML = html;
    rt.mount(d, entries);
    if (entering) rt.runLoad();
    sc?.scrollTo(keep.x, keep.y);
    lastFrame.current = cur;
  }, [ready, doc, frame, version, canvasId, history.length, cur]);

  if (!ownDoc) return null;
  const w = frame?.width ?? 0;
  const h = frame ? screenHeight(frame) : 0;
  const pad = 48;
  const scale = Math.min(1, (stageSize.w - pad) / w || 1, (stageSize.h - pad) / h || 1);
  const start = history[0];

  return (
    <div className="player" role="dialog" aria-label={t('player.label')}>
      <header className="player-bar">
        <button className="icon-btn" aria-label={t('proto.back')} title={t('player.backTip')} disabled={history.length < 2} onClick={back}>
          <Icon name="back" />
        </button>
        <button className="icon-btn" aria-label={t('player.restart')} title={t('player.restartTip')} disabled={history.length < 2} onClick={() => useStore.setState({ play: [start] })}>
          <Icon name="restart" />
        </button>
        <Select
          className="player-frame pfield"
          label={t('tool.board')}
          value={cur}
          options={[
            ...(isForeign && frame ? [[cur, frame.name] as [string, string]] : []),
            ...pageFrames(ownDoc).map((f) => [f.id, f.name] as [string, string]),
          ]}
          onChange={(id) => go(id, ownId)}
        />
        {isForeign ? (
          <span className="player-foreign" title={t('player.foreignTip')}>
            {t('player.foreign', { title: ext && typeof ext === 'object' ? ext.title : '…' })}
          </span>
        ) : null}
        <span className="player-meta">
          {frame ? `${w} × ${h}` : ''}
          {frame?.height === 'auto' ? ` · ${t('player.screen')}` : ''}
          {scale < 0.999 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>
        <div className="spacer" />
        <span className="player-tip">{t('player.tip')}</span>
        <button className="secondary" onClick={stopPlay} title={t('player.exitTip')}>
          <Icon name="x" size={14} />
          <span>{t('player.exit')}</span>
        </button>
      </header>
      <div className="player-stage" ref={stage}>
        <div className="player-screen" style={{ width: w * scale, height: h * scale }}>
          <iframe ref={iframe} title={frame?.name ?? t('zoom.play')} style={{ width: w, height: h, transform: `scale(${scale})` }} />
        </div>
      </div>
    </div>
  );
}
