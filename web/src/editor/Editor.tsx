// 编辑器：顶栏、画布（底部工具栏）、右侧图层与属性面板；快捷键与导出、版本对话框。
import { useEffect, useState } from 'react';
import { Icon } from '../lib/icons';
import { BriefPanel } from './BriefPanel';
import { Inspector } from '../inspector/Inspector';
import { LayerTree } from './LayerTree';
import { Player, startPlay } from './Player';
import { fitView, pickShape, pickTool, togglePenMode, zoomBy } from './Toolbar';
import { Viewport, viewOf } from './Viewport';
import { connect, delNote, deleteSelection, select, send, setTheme, setTool, toast, useStore, type ShapeKind, type Tool } from '../store';
import type { LockInfo } from '../../../src/core/types';
import { t } from '../i18n';
import { Select } from '../inspector/fields';

const KEY_TOOLS: Record<string, Tool> = { v: 'select', h: 'hand', t: 'text', a: 'board', n: 'note', p: 'pen', c: 'comment' };
/** 形状快捷键：直接切到形状工具的对应形状。 */
const KEY_SHAPES: Record<string, ShapeKind> = { r: 'rect', o: 'oval', l: 'line' };

export function Editor({ canvasId }: { canvasId: string }) {
  useEffect(() => connect(canvasId), [canvasId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入框里按 Enter / Esc 会先让自身失焦，所以除了焦点也要看事件来源
      const editable = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (editable(document.activeElement) || editable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const s = useStore.getState();
      if (s.play) return; // 播放中的按键由播放器处理
      if (e.shiftKey && e.code === 'Space' && !mod) {
        e.preventDefault();
        return startPlay();
      }
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (s.lock) return toast(t('editor.undoLocked'));
        send({ t: e.shiftKey ? 'redo' : 'undo' });
      } else if (mod && k === 'y') {
        e.preventDefault();
        if (!s.lock) send({ t: 'redo' });
      } else if (mod && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        zoomBy(e.key === '0' ? 0 : e.key === '-' ? 1 / 1.25 : 1.25);
      } else if (e.shiftKey && e.code === 'Digit1') {
        fitView();
      } else if (!mod && !e.altKey && e.shiftKey && k === 'p' && !e.repeat) {
        togglePenMode();
      } else if (!mod && !e.altKey && KEY_TOOLS[k] && !e.repeat) {
        pickTool(KEY_TOOLS[k]);
      } else if (!mod && !e.altKey && !e.shiftKey && KEY_SHAPES[k] && !e.repeat) {
        pickShape(KEY_SHAPES[k]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && (s.selNote || (s.openComment && s.openComment !== 'draft'))) {
        // 删除选中的批注或打开的评论
        e.preventDefault();
        delNote((s.selNote ?? s.openComment)!);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && s.selection.length && s.tool === 'select') {
        // 删除选中的元素
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Escape') {
        if (s.fly) return useStore.setState({ fly: null });
        if (s.tool !== 'select') return setTool('select');
        if (s.openComment || s.draft) return useStore.setState({ openComment: null, draft: null });
        if (s.selNote) return useStore.setState({ selNote: null });
        const sel = s.selection[0];
        if (!sel) return;
        const chain = viewOf(sel)?.chainOf(sel) ?? [];
        const parent = chain[chain.length - 2];
        select(parent ? [parent] : []);
      } else if (e.key === 'Enter' && s.selection.length === 1) {
        // 进入下一层
        const el = viewOf(s.selection[0])?.element(s.selection[0]);
        const child = el?.querySelector('[data-node-id]');
        if (child) select([child.getAttribute('data-node-id')!]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="editor">
      <TopBar />
      <div className="main">
        <Viewport />
        <aside className="sidebar">
          <LayerTree />
          <Inspector />
        </aside>
      </div>
      <BriefPanel />
      <Player />
      <Toasts />
    </div>
  );
}

/** 顶栏 AI 状态：有页面规划时显示进度。 */
function lockText(lock: LockInfo) {
  const pages = lock.pages ?? [];
  const unchecked = lock.pendingFrames.length ? t('lock.unchecked', { n: lock.pendingFrames.length }) : '';
  if (!pages.length) return t('lock.editing') + unchecked;
  const done = pages.filter((p) => p.status === 'done').length;
  const at = pages.findIndex((p) => p.frame === lock.cursor?.frame);
  return (
    t('lock.drawing') +
    (at >= 0 ? t('lock.page', { i: at + 1, n: pages.length }) : t('lock.pages', { n: pages.length })) +
    t('lock.done', { n: done }) +
    unchecked
  );
}

function TopBar() {
  const title = useStore((s) => s.title);
  const connected = useStore((s) => s.connected);
  const lock = useStore((s) => s.lock);
  const undo = useStore((s) => s.userUndo);
  const redo = useStore((s) => s.userRedo);
  const aiRound = useStore((s) => s.aiRound);
  const canvasId = useStore((s) => s.canvasId);
  const rev = useStore((s) => s.doc?.rev ?? 0);
  const theme = useStore((s) => s.theme);
  const tool = useStore((s) => s.tool);
  const comments = useStore((s) => s.notes.filter((n) => n.kind === 'comment').length);
  const [dialog, setDialog] = useState<'export' | 'versions' | null>(null);
  useEffect(() => {
    if (title) document.title = `${title} · penhold-mcp`;
  }, [title]);

  const rename = async () => {
    const name = prompt(t('editor.namePrompt'), title);
    if (!name) return;
    await fetch(`/api/canvases/${canvasId}/rename`, { method: 'POST', body: JSON.stringify({ title: name }) });
  };

  return (
    <header className="topbar">
      <a className="logo" href="/" aria-label={t('editor.all')} title={t('editor.all')}>
        <Icon name="grid" size={14} stroke={1.6} />
      </a>
      <button className="title" onClick={rename} title={t('common.rename')}>
        {title || t('editor.untitled')}
      </button>
      <span className="status">
        <span className={`dot ${connected ? 'ok' : ''}`} />
        {connected ? t('editor.connected', { rev }) : t('editor.disconnected')}
      </span>
      <div className="spacer" />
      {lock && (
        <div className="lockpill">
          <span className="dot ai" />
          <span>{lockText(lock)}</span>
          <button onClick={() => send({ t: 'unlock' })}>{t('editor.unlock')}</button>
        </div>
      )}
      <button
        className={`tb-btn ${tool === 'comment' ? 'on' : ''}`}
        aria-pressed={tool === 'comment'}
        aria-label={comments > 0 ? `${t('editor.comment')} (${comments})` : t('editor.comment')}
        title={t('editor.commentTip')}
        onClick={() => pickTool(tool === 'comment' ? 'select' : 'comment')}
      >
        <span className="cbubble" aria-hidden="true">
          {comments > 0 && (comments > 99 ? '99+' : comments)}
        </span>
      </button>
      <span className="vsep" />
      <button className="icon-btn" aria-label={t('editor.undo')} title={t('editor.undoTip')} disabled={!undo || !!lock} onClick={() => send({ t: 'undo' })}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" aria-label={t('editor.redo')} title={t('editor.redoTip')} disabled={!redo || !!lock} onClick={() => send({ t: 'redo' })}>
        <Icon name="redo" />
      </button>
      <button
        className="icon-btn"
        aria-label={t('editor.revertAi')}
        title={t('editor.revertAiTip')}
        disabled={!aiRound || !!lock}
        onClick={() => confirm(t('editor.revertAiConfirm')) && send({ t: 'revert_ai' })}
      >
        <Icon name="revert" />
      </button>
      <button className="icon-btn" aria-label={theme === 'dark' ? t('editor.toLight') : t('editor.toDark')} title={theme === 'dark' ? t('editor.toLight') : t('editor.toDark')} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <button className="secondary" onClick={() => setDialog('versions')}>
        {t('editor.versions')}
      </button>
      <button className="primary" onClick={() => setDialog('export')}>
        {t('editor.export')}
      </button>
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'versions' && <VersionsDialog onClose={() => setDialog(null)} />}
    </header>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header>
          {title}
          <button className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc)!;
  const canvasId = useStore((s) => s.canvasId);
  const selection = useStore((s) => s.selection);
  const current = doc.frames.find((f) => selection.some((a) => a === f.id || viewOf(a)?.frameId === f.id))?.id ?? doc.frames[0]?.id;
  const [frames, setFrames] = useState<string[]>(current ? [current] : []);
  const [inline, setInline] = useState(true);
  const [style, setStyle] = useState<'class' | 'inline'>('class');
  const [width, setWidth] = useState<'fixed' | 'fill'>('fixed');
  const [split, setSplit] = useState(false);
  const [interactive, setInteractive] = useState(true);
  const [result, setResult] = useState<{ fonts: Array<{ family: string; weights: number[] }>; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ frames: frames.join(','), inline: inline ? '1' : '0', style, width, split: split ? '1' : '0', interactive: interactive ? '1' : '0' });
      const r = await fetch(`/c/${canvasId}/export?${q}`);
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob();
      const name = decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'design.html');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setResult({
        fonts: JSON.parse(decodeURIComponent(r.headers.get('x-design-fonts') ?? '[]')),
        warnings: JSON.parse(decodeURIComponent(r.headers.get('x-design-warnings') ?? '[]')),
      });
    } catch (e) {
      toast(t('export.failed', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('editor.export')} onClose={onClose}>
      <div className="modal-body">
        <div className="group">
          <div className="glabel">{t('export.boards')}</div>
          {doc.frames.map((f) => (
            <label key={f.id} className="check">
              <input type="checkbox" checked={frames.includes(f.id)} onChange={(e) => setFrames(e.target.checked ? [...frames, f.id] : frames.filter((x) => x !== f.id))} />
              {f.name} <span className="dim">{f.width}</span>
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={inline} onChange={(e) => setInline(e.target.checked)} /> {t('export.inline')}
        </label>
        <label className="check">
          <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} /> {t('export.interactive')}
        </label>
        {frames.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> {t('export.split')}
          </label>
        )}
        <div className="row">
          <div className="field">
            <span className="field-label">{t('common.style')}</span>
            <Select className="field-select" label={t('common.style')} value={style} options={[['class', t('export.styleClass')], ['inline', t('export.styleInline')]]} onChange={(v) => setStyle(v as 'class')} />
          </div>
          <div className="field">
            <span className="field-label">{t('common.width')}</span>
            <Select className="field-select" label={t('common.width')} value={width} options={[['fixed', t('export.widthFixed')], ['fill', t('export.widthFill')]]} onChange={(v) => setWidth(v as 'fixed')} />
          </div>
        </div>
        {result && (
          <div className="result">
            <div className="glabel">{t('export.done')}</div>
            {result.fonts.length ? (
              <ul>
                {result.fonts.map((f) => (
                  <li key={f.family}>
                    {f.family} <span className="dim">{t('export.weights', { w: f.weights.join(', ') })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dim">{t('export.noFonts')}</div>
            )}
            {result.warnings.map((w) => (
              <div key={w} className="warn">
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
      </div>
      <footer>
        <span className="dim">{t('export.note')}</span>
        <button className="primary" disabled={!frames.length || busy} onClick={run}>
          {busy ? t('export.busy') : t('export.download')}
        </button>
      </footer>
    </Modal>
  );
}

function VersionsDialog({ onClose }: { onClose: () => void }) {
  const canvasId = useStore((s) => s.canvasId);
  const lock = useStore((s) => s.lock);
  const [list, setList] = useState<Array<{ file: string; rev: number; name: string | null; ts: number }>>([]);
  const load = () => fetch(`/api/canvases/${canvasId}/versions`).then((r) => r.json()).then(setList);
  useEffect(() => void load(), []);
  const save = async () => {
    const name = prompt(t('versions.namePrompt'), t('versions.defaultName', { time: new Date().toLocaleString() }));
    if (!name) return;
    await fetch(`/api/canvases/${canvasId}/versions`, { method: 'POST', body: JSON.stringify({ name }) });
    load();
  };
  const restore = async (file: string) => {
    if (!confirm(t('versions.confirm'))) return;
    const r = await fetch(`/api/canvases/${canvasId}/restore`, { method: 'POST', body: JSON.stringify({ file }) });
    if (!r.ok) toast((await r.json()).error);
    else onClose();
  };
  return (
    <Modal title={t('editor.versions')} onClose={onClose}>
      <div className="modal-body">
        <button className="primary" onClick={save}>
          {t('versions.save')}
        </button>
        <div className="versions">
          {list.map((v) => (
            <div key={v.file} className="version">
              <span>{v.name ?? t('versions.auto')}</span>
              <span className="dim">
                rev {v.rev} · {new Date(v.ts).toLocaleString()}
              </span>
              <button className="secondary sm" disabled={!!lock} onClick={() => restore(v.file)}>
                {t('versions.restore')}
              </button>
            </div>
          ))}
          {!list.length && <div className="dim">{t('versions.empty')}</div>}
        </div>
      </div>
    </Modal>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
