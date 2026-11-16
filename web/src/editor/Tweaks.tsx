// 画布内的 Tweaks 浮动面板（参照 Claude Design）：切换设计系统的主题，并调节 AI 用 tweaks_set 暴露的令牌。
// 控件的值就是令牌的值，改动走普通的 set_tokens（可撤销）；主题切换由守护进程把该主题的颜色写进画布。
import { useEffect, useRef, useState } from 'react';
import type { ThemeInfo, Tweak } from '../../../src/core/types';
import { commitOps, send, useStore } from '../store';
import { t } from '../i18n';

// 选择器回退值必须是稳定引用，否则每次渲染都像状态变了，React 会无限更新
const NO_TWEAKS: Tweak[] = [];
const NO_TOKENS: Record<string, string> = {};
const OPEN_KEY = 'dm-tweaks-open';
const loadOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

function RangeCtl({ tw, value, disabled, onCommit }: { tw: Tweak; value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const unit = tw.unit ?? '';
  const n = parseFloat(value);
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? (Number.isFinite(n) ? n : (tw.min ?? 0));
  const done = () => {
    if (drag !== null && drag !== n) onCommit(`${drag}${unit}`);
    setDrag(null);
  };
  return (
    <div className="tw-range">
      <input type="range" aria-label={tw.label} min={tw.min} max={tw.max} step={tw.step ?? 1} value={shown} disabled={disabled} onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={done} onKeyUp={done} onBlur={done} />
      <output>{`${shown}${unit}`}</output>
    </div>
  );
}

function ColorCtl({ label, value, disabled, onCommit }: { label: string; value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 原生 change 在取色器关闭时才触发：一次取色只记一步撤销
    const h = () => onCommit(el.value);
    el.addEventListener('change', h);
    return () => el.removeEventListener('change', h);
  });
  return (
    <div className="tw-color">
      <input ref={ref} type="color" aria-label={label} defaultValue={hex} key={hex} disabled={disabled} />
      <code>{value}</code>
    </div>
  );
}

type ThemeItem = ThemeInfo['themes'][number];
const modeOf = (th: ThemeItem) => th.mode ?? (/(^|-)dark$/.test(th.id) ? 'dark' : 'light');

/** 主题切换：有多套配色时分“配色”与“明暗”两组，否则平铺全部主题。 */
function ThemeSwitch({ info, disabled }: { info: ThemeInfo; disabled: boolean }) {
  const pick = (id: string) => id !== info.theme && send({ t: 'set_theme', theme: id });
  const cur = info.themes.find((th) => th.id === info.theme) ?? info.themes[0];
  const schemes = [...new Set(info.themes.map((th) => th.scheme).filter((x): x is string => !!x))];
  if (schemes.length < 2)
    return (
      <>
        <h4>{t('tweaks.theme')}</h4>
        <div className="tw-seg" role="group" aria-label={t('tweaks.theme')}>
          {info.themes.map((th) => (
            <button key={th.id} aria-pressed={th.id === info.theme} className={th.id === info.theme ? 'on' : ''} disabled={disabled} onClick={() => pick(th.id)}>
              {th.name}
            </button>
          ))}
        </div>
      </>
    );
  const mode = modeOf(cur);
  // 换配色时保持当前明暗；换明暗时保持当前配色
  const inScheme = (s: string) => info.themes.filter((th) => th.scheme === s);
  const modes = inScheme(cur.scheme ?? schemes[0]);
  return (
    <>
      <h4>{t('tweaks.scheme')}</h4>
      <div className="tw-schemes" role="radiogroup" aria-label={t('tweaks.scheme')}>
        {schemes.map((s) => {
          const list = inScheme(s);
          const target = list.find((th) => modeOf(th) === mode) ?? list[0];
          const on = cur.scheme === s;
          return (
            <button key={s} role="radio" aria-checked={on} className={on ? 'on' : ''} disabled={disabled} title={s} onClick={() => pick(target.id)}>
              <i style={{ background: target.swatch ?? list.find((th) => th.swatch)?.swatch ?? 'var(--muted)' }} />
              <span>{s}</span>
            </button>
          );
        })}
      </div>
      {modes.length > 1 && (
        <>
          <h4>{t('tweaks.mode')}</h4>
          <div className="tw-seg" role="group" aria-label={t('tweaks.mode')}>
            {modes.map((th) => (
              <button key={th.id} aria-pressed={th.id === info.theme} className={th.id === info.theme ? 'on' : ''} disabled={disabled} onClick={() => pick(th.id)}>
                {t(modeOf(th) === 'dark' ? 'tweaks.dark' : 'tweaks.light')}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function TweaksPanel() {
  const tweaks = useStore((s) => s.doc?.tweaks ?? NO_TWEAKS);
  const tokens = useStore((s) => s.doc?.tokens ?? NO_TOKENS);
  const info = useStore((s) => s.themeInfo);
  const locked = useStore((s) => !!s.lock);
  useStore((s) => s.version);
  const [open, setOpen] = useState(loadOpen);
  const items = tweaks.filter((x) => x.token in tokens);
  const themes = info && info.themes.length > 1 ? info : null;
  if (!items.length && !themes) return null;
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      /* 无存储时只在本次生效 */
    }
  };
  const set = (k: string, v: string) => commitOps([{ op: 'set_tokens', tokens: { [k]: v } }]);

  const rows: React.ReactNode[] = [];
  let group: string | undefined;
  for (const tw of items) {
    if (tw.group && tw.group !== group) rows.push(<h4 key={`g:${tw.group}`}>{tw.group}</h4>);
    group = tw.group;
    const v = tokens[tw.token];
    rows.push(
      <div key={tw.id} className="tw-row" title={`{${tw.token}}`}>
        <span>{tw.label}</span>
        {tw.kind === 'color' ? (
          <ColorCtl label={tw.label} value={v} disabled={locked} onCommit={(nv) => nv !== v && set(tw.token, nv)} />
        ) : tw.kind === 'range' ? (
          <RangeCtl tw={tw} value={v} disabled={locked} onCommit={(nv) => set(tw.token, nv)} />
        ) : tw.kind === 'select' ? (
          <select aria-label={tw.label} value={v} disabled={locked} onChange={(e) => set(tw.token, e.target.value)}>
            {!tw.options?.some((o) => o.value === v) && <option value={v}>{v}</option>}
            {tw.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input type="checkbox" aria-label={tw.label} checked={v === tw.options?.[1]?.value} disabled={locked} onChange={(e) => tw.options && set(tw.token, tw.options[e.target.checked ? 1 : 0].value)} />
        )}
      </div>,
    );
  }

  return (
    <div className="tweaks" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {open && (
        <div className="tweaks-panel" role="group" aria-label="Tweaks">
          {themes && <ThemeSwitch info={themes} disabled={locked} />}
          {rows}
          <p className="tw-hint">{t('tweaks.hint')}</p>
        </div>
      )}
      <button className="tweaks-btn" aria-expanded={open} onClick={toggle}>
        Tweaks
      </button>
    </div>
  );
}
