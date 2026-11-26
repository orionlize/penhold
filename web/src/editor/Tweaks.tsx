// 画布内的 Tweaks 浮动面板（参照 Claude Design）：切换设计系统的主题（风格、配色、明暗），并调节 AI 用 tweaks_set 暴露的令牌。
// 控件的值就是令牌的值，改动走普通的 set_tokens（可撤销）；主题切换由守护进程把该主题的令牌写进画布。
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
const names = (xs: Array<string | undefined>) => [...new Set(xs.filter((x): x is string => !!x))];

/**
 * 主题切换：系统带几种风格或配色时按“风格 / 配色 / 明暗”分组，换其中一项时尽量保持其余两项；
 * 主题没有分组信息时（如导入的亮 / 暗主题）平铺全部主题。
 */
function ThemeSwitch({ info, disabled }: { info: ThemeInfo; disabled: boolean }) {
  const pick = (id: string) => id !== info.theme && send({ t: 'set_theme', theme: id });
  const cur = info.themes.find((th) => th.id === info.theme) ?? info.themes[0];
  const styles = names(info.themes.map((th) => th.style));
  const inStyle = info.themes.filter((th) => th.style === cur.style);
  const schemes = names(inStyle.map((th) => th.scheme));
  if (styles.length < 2 && schemes.length < 2)
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
  // 换风格时保持配色与明暗，换配色时保持明暗；没有完全对应的就退一步
  const closest = (list: ThemeItem[]) =>
    list.find((th) => th.scheme === cur.scheme && modeOf(th) === mode) ?? list.find((th) => th.scheme === cur.scheme) ?? list.find((th) => modeOf(th) === mode) ?? list[0];
  const choices = (key: 'tweaks.style' | 'tweaks.scheme', cls: string, list: string[], now: string | undefined, of: (name: string) => ThemeItem[]) => (
    <>
      <h4>{t(key)}</h4>
      <div className={cls} role="radiogroup" aria-label={t(key)}>
        {list.map((n) => {
          const target = closest(of(n));
          const on = now === n;
          return (
            <button key={n} role="radio" aria-checked={on} className={on ? 'on' : ''} disabled={disabled} title={n} onClick={() => pick(target.id)}>
              <i style={{ background: target.swatch ?? of(n).find((th) => th.swatch)?.swatch ?? 'var(--muted)' }} />
              <span>{n}</span>
            </button>
          );
        })}
      </div>
    </>
  );
  const modes = inStyle.filter((th) => th.scheme === cur.scheme);
  return (
    <>
      {styles.length > 1 && choices('tweaks.style', 'tw-schemes tw-styles', styles, cur.style, (n) => info.themes.filter((th) => th.style === n))}
      {schemes.length > 1 && choices('tweaks.scheme', 'tw-schemes', schemes, cur.scheme, (n) => inStyle.filter((th) => th.scheme === n))}
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
