// 画布底部浮动工具栏与右上角缩放控件。
import { createBoard } from './Annotations';
import { placements } from '../lib/geom';
import { startPlay } from './Player';
import { isDocFrame } from '../../../src/core/states';
import { Icon, type IconName } from '../lib/icons';
import { setTool, setUi, useStore, type PenMode, type PenOpts, type ShapeKind, type Tool } from '../store';
import { SHAPES, shapeName } from '../lib/shapes';
import { StrokeControls } from '../inspector/Stroke';
import { t } from '../i18n';

const tr = t;

const TOOLS: Array<{ id: Tool; label: string; tip: string; icon: IconName; sep?: boolean }> = [
  { id: 'select', label: t('tool.select'), tip: t('tool.selectTip'), icon: 'select' },
  { id: 'hand', label: t('tool.hand'), tip: t('tool.handTip'), icon: 'hand' },
  { id: 'text', label: t('tool.text'), tip: t('tool.textTip'), icon: 'text', sep: true },
  { id: 'board', label: t('tool.board'), tip: t('tool.boardTip'), icon: 'board' },
  { id: 'note', label: t('tool.note'), tip: t('tool.noteTip'), icon: 'note' },
  { id: 'pen', label: t('tool.pen'), tip: t('tool.penTip'), icon: 'pen', sep: true },
  { id: 'shape', label: t('tool.shape'), tip: t('tool.shapeTip'), icon: 'rect' },
];


export const BOARD_PRESETS: Array<[string, number, number]> = [
  [t('preset.mobile'), 390, 844],
  [t('preset.tablet'), 768, 1024],
  [t('preset.desktop'), 1440, 900],
];

/** 切换铅笔 / 钢笔模式（同时选中该工具）。 */
export function setPenMode(mode: PenMode) {
  const s = useStore.getState();
  useStore.setState({ pen: { ...s.pen, mode }, tool: 'pen', editingText: null });
}

export function togglePenMode() {
  setPenMode(useStore.getState().pen.mode === 'path' ? 'pencil' : 'path');
}

export function pickTool(id: Tool) {
  const s = useStore.getState();
  if (id === 'board') return useStore.setState({ fly: s.fly === 'board' ? null : 'board' });
  // 已选中带子菜单的工具：再点一次展开 / 收起子菜单
  if ((id === 'shape' || id === 'pen') && s.tool === id) return useStore.setState({ fly: s.fly === id ? null : id });
  setTool(id);
}

/** 选中形状工具并切到指定形状（快捷键 R / O / L）。 */
export function pickShape(kind: ShapeKind) {
  setTool('shape');
  useStore.setState({ shape: kind });
}

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const fly = useStore((s) => s.fly);
  const shape = useStore((s) => s.shape);
  const lock = useStore((s) => s.lock);
  const pen = useStore((s) => s.pen);
  const items: Array<{ key: string; label: string; on: boolean; pick: () => void; icon?: IconName; hint?: string }> =
    fly === 'board'
      ? BOARD_PRESETS.map(([l, w, h]) => ({ key: l, label: `${l} ${w}`, on: false, pick: () => createBoard(w, h, l) }))
      : fly === 'shape'
        ? SHAPES.map((x) => ({ key: x.kind, label: shapeName(x.kind), icon: x.icon, hint: x.key, on: shape === x.kind, pick: () => useStore.setState({ shape: x.kind, fly: null, tool: 'shape' }) }))
        : [];
  return (
    <div className="toolbar" role="toolbar" aria-label={t('toolbar.label')} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {items.length > 0 && (
        <div className={`fly fly-${fly}`}>
          {items.map((f) => (
            <button key={f.key} className={f.on ? 'on' : ''} aria-pressed={f.on} onClick={f.pick} disabled={fly === 'board' && !!lock}>
              {f.icon && <Icon name={f.icon} size={14} />}
              <span>{f.label}</span>
              {f.hint && <kbd className="fly-key">{f.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
      {fly === 'pen' && <PenFly pen={pen} />}
      {TOOLS.map((t0) => {
        const t = t0.id === 'pen' && pen.mode === 'path' ? { ...t0, label: tr('tool.path'), tip: tr('tool.pathTip'), icon: 'penTool' as IconName } : t0.id === 'shape' ? { ...t0, label: shapeName(shape) } : t0;
        return (
        <span key={t.id} className="tool-wrap">
          {t.sep && <span className="tsep" />}
          <button
            className={`tool ${tool === t.id || (t.id === 'board' && fly === 'board') ? 'on' : ''}`}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            title={t.tip}
            onClick={() => pickTool(t.id)}
          >
            <Icon name={t.icon} size={18} />
            {(t.id === 'shape' || t.id === 'pen') && <span className="tool-more" />}
          </button>
        </span>
        );
      })}
    </div>
  );
}

/** 铅笔子菜单：铅笔 / 钢笔切换 + 颜色、粗细、线型，选择后不收起，方便连续调整。 */
function PenFly({ pen }: { pen: PenOpts }) {
  const set = (p: Partial<PenOpts>) => useStore.setState({ pen: { ...pen, ...p }, tool: 'pen' });
  return (
    <div className="fly fly-pen">
      <div className="fly-label">{t('pen.mode')}</div>
      <div className="pen-row pen-mode" role="radiogroup" aria-label={t('pen.mode')}>
        {(['pencil', 'path'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={pen.mode === m} className={pen.mode === m ? 'on' : ''} title={t(m === 'path' ? 'tool.pathTip' : 'tool.penTip')} onClick={() => setPenMode(m)}>
            <Icon name={m === 'path' ? 'penTool' : 'pen'} size={14} />
            <span>{t(m === 'path' ? 'tool.path' : 'tool.pen')}</span>
          </button>
        ))}
      </div>
      <StrokeControls value={pen} onChange={set} />
    </div>
  );
}

export function fitView() {
  const s = useStore.getState();
  const vp = document.querySelector('.viewport')?.getBoundingClientRect();
  const ps = placements(s.doc);
  if (!ps.length || !vp) return;
  const total = ps[ps.length - 1].x + ps[ps.length - 1].f.width;
  const tall = Math.max(...ps.map((p) => p.h));
  const z = Math.min(2, Math.max(0.1, Math.min((vp.width - 120) / total, (vp.height - 160) / tall)));
  useStore.setState({ zoom: z, panX: (vp.width - total * z) / 2, panY: 60 });
  setUi({});
}

export function zoomBy(k: number) {
  const s = useStore.getState();
  const vp = document.querySelector('.viewport')?.getBoundingClientRect();
  const nz = k === 0 ? 1 : Math.min(8, Math.max(0.1, s.zoom * k));
  const cx = (vp?.width ?? 0) / 2;
  const cy = (vp?.height ?? 0) / 2;
  const r = nz / s.zoom;
  useStore.setState({ zoom: nz, panX: cx - (cx - s.panX) * r, panY: cy - (cy - s.panY) * r });
  setUi({});
}

export function ZoomControl() {
  const zoom = useStore((s) => s.zoom);
  const hasFrames = useStore((s) => !!s.doc?.frames.some((f) => !isDocFrame(f)));
  return (
    <div className="zoombar" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <button className="play" aria-label={t('zoom.play')} title={t('zoom.playTip')} onClick={() => startPlay()} disabled={!hasFrames}>
        <Icon name="play" size={14} />
      </button>
      <span className="vsep" />
      <button aria-label={t('zoom.out')} title={t('zoom.outTip')} onClick={() => zoomBy(1 / 1.25)}>
        <Icon name="minus" size={14} />
      </button>
      <button className="pct" title={t('zoom.resetTip')} onClick={() => zoomBy(0)}>
        {Math.round(zoom * 100)}%
      </button>
      <button aria-label={t('zoom.in')} title={t('zoom.inTip')} onClick={() => zoomBy(1.25)}>
        <Icon name="plus" size={14} />
      </button>
      <span className="vsep" />
      <button className="fit" title={t('zoom.fitTip')} onClick={fitView}>
        {t('zoom.fit')}
      </button>
    </div>
  );
}
