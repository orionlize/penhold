// 背景字段：一行触发器 + 浮窗。浮窗分 Theme（设计令牌里的颜色）与 Custom（纯色 / 渐变 / 图片）。
// 三种自定义背景互斥：选其中一种会清掉另外两种对应的样式键。
import { useMemo, useRef, useState } from 'react';
import { FloatPanel } from './FloatPanel';
import { defaultGradient, GRADIENT_RE, gradientCss, parseGradient, type Gradient, type GradientType, type RadialSize } from '../../src/core/gradient';
import type { AssetRef } from '../../src/core/types';
import { ColorInput, LenField, NumRow, PropRow, ResetCtx, Select, Tabs, TextInput, isColorToken, tokenValue } from './fields';
import { Icon } from './icons';
import { commitOps, toast, useStore, EMPTY_TOKENS } from './store';
import { t } from './i18n';

export interface BgStyle {
  background?: string;
  backgroundImage?: string;
  backgroundSize?: 'cover' | 'contain' | 'auto';
}
type BgPatch = { [K in keyof BgStyle]?: BgStyle[K] | null };
type Mode = 'theme' | 'color' | 'gradient' | 'image';

export function bgMode(s: BgStyle): Mode | null {
  if (s.backgroundImage) return 'image';
  const b = s.background;
  if (!b) return null;
  if (/^\{.+\}$/.test(b)) return 'theme';
  return GRADIENT_RE.test(b) ? 'gradient' : 'color';
}

/** 上传本地图片到画布资源库，返回 asset:<hash>。 */
export async function uploadImage(canvasId: string, file: File): Promise<string> {
  const r = await fetch(`/c/${canvasId}/upload`, { method: 'POST', body: file, headers: { 'content-type': file.type, 'x-filename': encodeURIComponent(file.name) } });
  const ref = await r.json();
  if (!r.ok) throw new Error(ref.error);
  commitOps([{ op: 'asset_add', asset: ref as AssetRef }]);
  return `asset:${ref.hash}`;
}

/** 由守护进程下载 http(s) 图片并入库（渲染只引用库内资源，不直接引用外链）。 */
async function importImage(canvasId: string, src: string): Promise<string> {
  const r = await fetch(`/c/${canvasId}/import`, { method: 'POST', body: JSON.stringify({ src }), headers: { 'content-type': 'application/json' } });
  const ref = await r.json();
  if (!r.ok) throw new Error(ref.error);
  commitOps([{ op: 'asset_add', asset: ref as AssetRef }]);
  return `asset:${ref.hash}`;
}

/** 解析出可在 CSS 里直接使用的颜色/渐变（令牌按引用链取值）。 */
function useResolved(v: string | undefined) {
  const tokens = useStore((s) => s.doc?.tokens ?? EMPTY_TOKENS);
  const m = v ? /^\{(.+)\}$/.exec(v) : null;
  return m ? tokenValue(tokens, m[1]) : v;
}

export function BackgroundRow({ label, style, onPatch, onRemove, disabled }: { label: string; style: BgStyle; onPatch: (p: BgPatch) => void; onRemove?: () => void; disabled?: boolean }) {
  const doc = useStore((s) => s.doc);
  const canvasId = useStore((s) => s.canvasId);
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLButtonElement>(null);
  const mode = bgMode(style);
  const resolved = useResolved(style.background);
  const asset = /^asset:([a-f0-9]+)$/.exec(style.backgroundImage ?? '')?.[1];
  const a = asset ? doc?.assets[asset] : undefined;
  const g = mode === 'gradient' ? parseGradient(style.background) : null;
  const text =
    mode === 'image'
      ? (a?.source?.split('/').pop() ?? t('insp.image'))
      : mode === 'theme'
        ? style.background!.slice(1, -1)
        : mode === 'gradient'
          ? g
            ? t(`bg.${g.type}Name` as 'bg.linearName')
            : t('bg.gradient')
          : (style.background ?? '');
  return (
    <PropRow label={label} onRemove={onRemove} disabled={disabled}>
      <button ref={field} type="button" className={`pfield color bg-trigger ${open ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={label} disabled={disabled} onClick={() => setOpen(!open)}>
        {mode === 'image' && a ? <img src={`/c/${canvasId}/assets/${a.file}`} alt="" /> : <span className={`swatch ${mode ? '' : 'empty'}`} style={mode ? { background: resolved || 'transparent' } : undefined} />}
        <span className={`ellipsis ${mode ? '' : 'muted'}`}>{mode ? text : t('common.none')}</span>
        <span className="pfield-chevron">
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open && field.current && <BackgroundPopover anchor={field.current} label={label} style={style} onPatch={onPatch} onClose={() => setOpen(false)} disabled={disabled} />}
    </PropRow>
  );
}

function BackgroundPopover({ anchor, label, style, onPatch, onClose, disabled }: { anchor: HTMLElement; label: string; style: BgStyle; onPatch: (p: BgPatch) => void; onClose: () => void; disabled?: boolean }) {
  const tokens = useStore((s) => s.doc?.tokens ?? EMPTY_TOKENS);
  const canvasId = useStore((s) => s.canvasId);
  const doc = useStore((s) => s.doc);
  const detected = bgMode(style);
  const [tab, setTab] = useState<'theme' | 'custom'>(detected === 'theme' ? 'theme' : 'custom');
  const [sub, setSub] = useState<'color' | 'gradient' | 'image'>(detected === 'gradient' || detected === 'image' ? detected : 'color');
  const colorKeys = useMemo(() => Object.keys(tokens).filter((k) => isColorToken(tokens, k)), [tokens]);
  const resolved = useResolved(style.background);
  const current = detected === 'theme' ? style.background!.slice(1, -1) : undefined;

  /** 写入一种背景，同时清掉其余已存在的背景键，保持互斥。 */
  const set = (p: BgPatch) => {
    const out: BgPatch = { ...p };
    for (const k of ['background', 'backgroundImage', 'backgroundSize'] as const) if (!(k in out) && style[k] !== undefined) out[k] = null;
    onPatch(out);
  };
  const setColorLike = (v: string | null) => set({ background: v });

  const switchSub = (v: string) => {
    const next = v as typeof sub;
    setSub(next);
    // 切到渐变立即生成一个以当前颜色为起点的渐变，便于直接调整；切回纯色沿用第一个色标
    if (next === 'gradient' && detected !== 'gradient') {
      const from = resolved && !GRADIENT_RE.test(resolved) && CSS.supports('color', resolved) ? resolved : '#000000';
      set({ background: gradientCss(defaultGradient(from, from.toUpperCase() === '#FFFFFF' ? '#000000' : '#FFFFFF')) });
    } else if (next === 'color' && detected === 'gradient') {
      const gr = parseGradient(style.background);
      if (gr) set({ background: gr.stops[0].color });
    }
  };

  return (
    <FloatPanel anchor={anchor} label={label} onClose={onClose}>
        <div className="bg-pop-head">
          <Tabs
            label={label}
            value={tab}
            disabled={disabled}
            options={[
              { value: 'theme', label: t('bg.theme') },
              { value: 'custom', label: t('bg.custom') },
            ]}
            onChange={(v) => setTab(v as typeof tab)}
          />
          <button type="button" className="icon-btn sm" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        {tab === 'theme' ? (
          <div className="bg-tokens" role="listbox" aria-label={t('bg.theme')}>
            {colorKeys.length ? (
              colorKeys.map((k) => (
                <div
                  key={k}
                  role="option"
                  tabIndex={0}
                  aria-selected={k === current}
                  aria-disabled={disabled}
                  className="select-item"
                  onClick={() => !disabled && k !== current && set({ background: `{${k}}` })}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !disabled && k !== current && set({ background: `{${k}}` }))}
                >
                  <span className="swatch sm" style={{ background: tokenValue(tokens, k) }} />
                  <span className="ellipsis">{k}</span>
                  <span className="select-hint ellipsis">{tokens[k]}</span>
                  {k === current && <Icon name="check" size={14} stroke={2} />}
                </div>
              ))
            ) : (
              <div className="select-empty">{t('fields.noTokens')}</div>
            )}
          </div>
        ) : (
          <>
            <div className="bg-pop-sub">
              <Tabs
                label={t('bg.custom')}
                value={sub}
                disabled={disabled}
                options={[
                  { value: 'color', label: t('bg.color') },
                  { value: 'gradient', label: t('bg.gradient') },
                  { value: 'image', label: t('bg.image') },
                ]}
                onChange={switchSub}
              />
            </div>
            {sub === 'color' && (
              <PropRow label={t('bg.color')}>
                <ColorInput label={label} value={detected === 'color' || detected === 'theme' ? style.background : undefined} disabled={disabled} onCommit={setColorLike} />
              </PropRow>
            )}
            {sub === 'gradient' && <GradientEditor value={detected === 'gradient' ? style.background! : undefined} disabled={disabled} onCommit={setColorLike} />}
            {sub === 'image' && (
              <ImageEditor
                canvasId={canvasId}
                asset={detected === 'image' ? doc?.assets[/^asset:([a-f0-9]+)$/.exec(style.backgroundImage ?? '')?.[1] ?? ''] : undefined}
                size={style.backgroundSize}
                disabled={disabled}
                onPick={(src) => set({ backgroundImage: src, ...(style.backgroundSize ? { backgroundSize: style.backgroundSize } : {}) })}
                onSize={(v) => onPatch({ backgroundSize: v })}
              />
            )}
          </>
        )}
    </FloatPanel>
  );
}

function GradientEditor({ value, onCommit, disabled }: { value: string | undefined; onCommit: (v: string) => void; disabled?: boolean }) {
  const parsed = value ? parseGradient(value) : null;
  if (value && !parsed)
    return (
      <>
        <div className="bg-note">{t('bg.unparsed')}</div>
        <PropRow label="CSS">
          <TextInput label={t('bg.gradient')} value={value} multiline disabled={disabled} onCommit={(v) => v && onCommit(v)} />
        </PropRow>
      </>
    );
  const g: Gradient = parsed ?? defaultGradient();
  const put = (p: Partial<Gradient>) => onCommit(gradientCss({ ...g, ...p }));
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
  const setStop = (i: number, p: Partial<Gradient['stops'][number]>) => put({ stops: g.stops.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const addStop = () => {
    // 在间隔最大的两个色标之间插入，颜色取前一个
    const st = [...g.stops].sort((x, y) => x.pos - y.pos);
    let at = 0;
    for (let i = 1; i < st.length; i++) if (st[i].pos - st[i - 1].pos > st[at + 1].pos - st[at].pos) at = i - 1;
    const pos = Math.round((st[at].pos + st[at + 1].pos) / 2);
    put({ stops: [...st.slice(0, at + 1), { color: st[at].color, pos }, ...st.slice(at + 1)] });
  };
  const center = (
    <>
      <NumRow label={t('bg.centerX')} value={g.x} unit="%" disabled={disabled} onCommit={(v) => put({ x: num(v, 50) })} />
      <NumRow label={t('bg.centerY')} value={g.y} unit="%" disabled={disabled} onCommit={(v) => put({ y: num(v, 50) })} />
    </>
  );
  return (
    <>
      <div className="bg-preview" style={{ background: gradientCss(g) }} />
      <PropRow label={t('bg.type')}>
        <Select
          label={t('bg.type')}
          value={g.type}
          disabled={disabled}
          options={[
            ['linear', t('bg.linear')],
            ['radial', t('bg.radial')],
            ['conic', t('bg.conic')],
          ]}
          onChange={(v) => put({ type: v as GradientType, angle: v === 'linear' ? (g.type === 'linear' ? g.angle : 180) : g.type === 'conic' ? g.angle : 0 })}
        />
      </PropRow>
      <PropRow label={t('bg.repeat')}>
        <Tabs
          label={t('bg.repeat')}
          value={g.repeating ? 'yes' : 'no'}
          disabled={disabled}
          options={[
            { value: 'no', label: t('bg.no') },
            { value: 'yes', label: t('bg.yes') },
          ]}
          onChange={(v) => put({ repeating: v === 'yes' })}
        />
      </PropRow>
      {g.type === 'linear' && <NumRow label={t('bg.angle')} value={g.angle} unit="°" min={-360} max={360} disabled={disabled} onCommit={(v) => put({ angle: num(v, 180) })} />}
      {g.type === 'radial' && (
        <>
          <PropRow label={t('bg.shape')}>
            <Tabs
              label={t('bg.shape')}
              value={g.shape}
              disabled={disabled}
              options={[
                { value: 'ellipse', label: t('bg.ellipse') },
                { value: 'circle', label: t('bg.circle') },
              ]}
              onChange={(v) => put({ shape: v as Gradient['shape'] })}
            />
          </PropRow>
          <PropRow label={t('bg.extent')}>
            <Select
              label={t('bg.extent')}
              value={g.size}
              disabled={disabled}
              options={[
                ['farthest-corner', t('bg.farthestCorner')],
                ['farthest-side', t('bg.farthestSide')],
                ['closest-corner', t('bg.closestCorner')],
                ['closest-side', t('bg.closestSide')],
              ]}
              onChange={(v) => put({ size: v as RadialSize })}
            />
          </PropRow>
          {center}
        </>
      )}
      {g.type === 'conic' && (
        <>
          <NumRow label={t('bg.from')} value={g.angle} unit="°" min={-360} max={360} disabled={disabled} onCommit={(v) => put({ angle: num(v, 0) })} />
          {center}
        </>
      )}
      <div className="bg-stops-head">
        <span>{t('bg.stops')}</span>
        <button type="button" className="icon-btn sm" aria-label={t('bg.addStop')} title={t('bg.addStop')} disabled={disabled} onClick={addStop}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      {g.stops.map((s, i) => (
        <div className="bg-stop" key={i}>
          <ColorInput label={`${t('bg.stopColor')} ${i + 1}`} value={s.color} disabled={disabled} onCommit={(v) => v && v !== s.color && !/[{};<>"\\]/.test(v) && setStop(i, { color: v })} />
          <LenField label={`${t('bg.stopPos')} ${i + 1}`} value={s.pos} unit="%" disabled={disabled} onCommit={(v) => typeof v === 'number' && setStop(i, { pos: Math.max(0, Math.min(100, v)) })} />
          <button type="button" className="icon-btn sm" aria-label={`${t('bg.removeStop')} ${i + 1}`} title={t('bg.removeStop')} disabled={disabled || g.stops.length <= 2} onClick={() => put({ stops: g.stops.filter((_, j) => j !== i) })}>
            <Icon name="minus" size={14} />
          </button>
        </div>
      ))}
    </>
  );
}

function ImageEditor({ canvasId, asset, size, onPick, onSize, disabled }: { canvasId: string | null; asset: AssetRef | undefined; size: BgStyle['backgroundSize']; onPick: (src: string) => void; onSize: (v: BgStyle['backgroundSize'] | null) => void; disabled?: boolean }) {
  const [url, setUrl] = useState(/^https?:\/\//.test(asset?.source ?? '') ? asset!.source! : '');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>, msg: 'insp.uploadFailed' | 'bg.importFailed') => {
    if (!canvasId) return;
    setBusy(true);
    try {
      onPick(await fn());
    } catch (e) {
      toast(t(msg, { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };
  const doImport = () => {
    const src = url.trim();
    if (!/^https?:\/\/\S+$/i.test(src)) return toast(t('bg.importFailed', { msg: 'http(s)://…' }));
    if (src !== asset?.source) run(() => importImage(canvasId!, src), 'bg.importFailed');
  };
  return (
    <>
      <div className="bg-image">
        {asset ? <img src={`/c/${canvasId}/assets/${asset.file}`} alt="" style={{ objectFit: size === 'auto' ? 'none' : (size ?? 'cover') }} /> : <Icon name="image" size={24} />}
      </div>
      <PropRow label={t('bg.image')}>
        <label className={`pfield image ${disabled || busy ? 'disabled' : ''}`}>
          <Icon name="upload" size={14} />
          <span className="ellipsis">{asset && !/^https?:/.test(asset.source ?? '') ? (asset.source?.split('/').pop() ?? t('insp.image')) : t('insp.upload')}</span>
          <input type="file" accept="image/*" hidden disabled={disabled || busy} onChange={(e) => e.target.files?.[0] && run(() => uploadImage(canvasId!, e.target.files![0]), 'insp.uploadFailed')} />
        </label>
      </PropRow>
      <PropRow label="URL">
        <div className="bg-url">
          <label className="pfield">
            <input aria-label={t('bg.url')} placeholder="https://…" value={url} disabled={disabled || busy} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doImport()} />
          </label>
          <button type="button" className="secondary sm" disabled={disabled || busy || !url.trim()} onClick={doImport}>
            {busy ? t('bg.importing') : t('bg.import')}
          </button>
        </div>
      </PropRow>
      <PropRow label={t('bg.size')}>
        <Tabs
          label={t('bg.size')}
          value={size ?? 'cover'}
          disabled={disabled || !asset}
          options={[
            { value: 'cover', label: t('insp.cover'), text: t('bg.sizeCover') },
            { value: 'contain', label: t('insp.contain'), text: t('bg.sizeContain') },
            { value: 'auto', label: t('insp.original'), text: t('bg.sizeAuto') },
          ]}
          onChange={(v) => onSize(v === 'cover' ? null : (v as BgStyle['backgroundSize']))}
        />
      </PropRow>
    </>
  );
}
