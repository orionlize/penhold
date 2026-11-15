// 属性面板控件：属性行（标签可拖拽调节 + 输入框 + 移除）、分组标题与“添加属性”菜单。
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Len } from '../../src/core/types';
import { Icon, type IconName } from './icons';
import { useStore, EMPTY_TOKENS } from './store';
import { t } from './i18n';

export function parseLen(s: string): Len | null {
  const t = s.trim();
  if (t === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^-?\d+(\.\d+)?px$/.test(t)) return Number(t.slice(0, -2));
  return t;
}

export const fmt = (v: unknown) => (v === undefined || v === null ? '' : Array.isArray(v) ? v.join(' ') : String(v));

/** 令牌值（解析 {ref} 引用后）是否为颜色或渐变。 */
export function tokenValue(tokens: Record<string, string>, k: string): string | undefined {
  let v: string | undefined = tokens[k];
  for (let i = 0; i < 8 && typeof v === 'string'; i++) {
    const m = /^\{([^}]+)\}$/.exec(v.trim());
    if (!m) break;
    v = tokens[m[1]];
  }
  return typeof v === 'string' ? v : undefined;
}

export function isColorToken(tokens: Record<string, string>, k: string): boolean {
  const v = tokenValue(tokens, k);
  if (v === undefined) return false;
  return /gradient\(/i.test(v) || (typeof CSS !== 'undefined' && CSS.supports('color', v.trim()));
}

/** 渲染令牌候选：dm-tokens 全部、`${id}-len` 仅数值/长度（数值字段用）。颜色令牌由 ColorInput 自带菜单展示。 */
export function TokenList({ id }: { id: string }) {
  const tokens = useStore((s) => s.doc?.tokens ?? EMPTY_TOKENS);
  const keys = Object.keys(tokens);
  const opts = (ks: string[]) =>
    ks.map((k) => (
      <option key={k} value={`{${k}}`}>
        {tokens[k]}
      </option>
    ));
  return (
    <>
      <datalist id={id}>{opts(keys)}</datalist>
      <datalist id={`${id}-len`}>{opts(keys.filter((k) => /^-?\.?\d/.test(tokenValue(tokens, k)?.trim() ?? '')))}</datalist>
    </>
  );
}

/** 输入框文本与外部值同步：聚焦期间不被覆盖。 */
function useDraft(value: string) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return { text, setText, focused };
}

// ---------------------------------------------------------------------------
// 行与分组

/** add：点 + 弹出可添加的属性菜单；onAdd：点 + 直接执行（不弹菜单，优先于 add）。 */
export function Section({ title, children, add, onAdd, aside }: { title: string; children?: React.ReactNode; add?: Array<{ key: string; label: string; onAdd: () => void }>; onAdd?: () => void; aside?: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  return (
    <section className="psec" ref={ref}>
      <header>
        <span className="psec-title">{title}</span>
        {aside}
        {(onAdd || (add && add.length > 0)) && (
          <button className={`icon-btn sm ${menu ? 'on' : ''}`} aria-label={t('fields.addTo', { title })} title={t('fields.addTo', { title })} onClick={() => (onAdd ? onAdd() : setMenu(!menu))}>
            <Icon name="plus" size={14} />
          </button>
        )}
      </header>
      {menu && add && (
        <div className="menu psec-menu" ref={(el) => el?.scrollIntoView({ block: 'nearest' })}>
          {add.map((a) => (
            <button
              key={a.key}
              onClick={() => {
                a.onAdd();
                setMenu(false);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}

/** 当前属性行的“重置为修改前的值”动作；由属性面板按行提供，PropRow 在标签旁显示按钮。 */
export const ResetCtx = createContext<(() => void) | undefined>(undefined);

export function PropRow({ label, children, onRemove, onScrub, title, disabled }: { label: string; children: React.ReactNode; onRemove?: () => void; onScrub?: (e: React.PointerEvent) => void; title?: string; disabled?: boolean }) {
  const reset = useContext(ResetCtx);
  return (
    <div className="prow" title={title}>
      <div className="plabel-cell">
        <span className={`plabel ${onScrub && !disabled ? 'scrub' : ''}`} onPointerDown={disabled ? undefined : onScrub}>
          {label}
        </span>
        {reset && (
          <button className="reset-btn" aria-label={t('fields.reset', { label })} title={t('fields.reset', { label })} disabled={disabled} onClick={reset}>
            <Icon name="restart" size={12} stroke={2} />
          </button>
        )}
      </div>
      <div className="pctl">{children}</div>
      {onRemove ? (
        <button className="icon-btn sm" aria-label={t('fields.remove', { label })} title={t('fields.remove', { label })} disabled={disabled} onClick={onRemove}>
          <Icon name="minus" size={14} />
        </button>
      ) : (
        <span className="prm-gap" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 控件

interface NumProps {
  label: string;
  value: unknown;
  onCommit: (v: Len | null) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  /** 显示值 = 存储值 × scale（如不透明度 0–1 显示为 0–100%）。 */
  scale?: number;
  disabled?: boolean;
  placeholder?: string;
  onRemove?: () => void;
  title?: string;
  /** 显示长度令牌下拉菜单 */
  tokens?: boolean;
}

/** 数值行：拖拽标签调节、方向键步进（Shift ×10），回车或失焦提交；也接受 {令牌}、%、auto、fill、fit。 */
export function NumRow({ label, value, onCommit, step = 1, min, max, unit = 'px', scale = 1, disabled, placeholder, onRemove, title, tokens }: NumProps) {
  const field = useRef<HTMLLabelElement>(null);
  const shown = typeof value === 'number' ? Math.round(value * scale * 100) / 100 : value;
  const { text, setText, focused } = useDraft(fmt(shown));
  const clamp = (n: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, Math.round(n * 100) / 100));
  const out = (v: Len | null): Len | null => (typeof v === 'number' ? Math.round((clamp(v) / scale) * 10000) / 10000 : v);
  const commit = (t: string) => {
    const v = parseLen(t);
    if (fmt(v) === fmt(shown)) return;
    onCommit(out(v));
  };
  const scrub = (e: React.PointerEvent) => {
    e.preventDefault();
    const base = typeof shown === 'number' ? shown : Number(parseLen(text)) || Number(placeholder) || 0;
    const sx = e.clientX;
    let last = base;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (ev: PointerEvent) => {
      const v = clamp(base + Math.round((ev.clientX - sx) / 2) * step * (ev.shiftKey ? 10 : 1));
      if (v === last) return;
      last = v;
      setText(String(v));
      clearTimeout(timer);
      timer = setTimeout(() => onCommit(out(v)), 60);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const numeric = text === '' || /^-?\d/.test(text);
  return (
    <PropRow label={label} onScrub={scrub} onRemove={onRemove} title={title} disabled={disabled}>
      <label ref={field} className="pfield">
        <input
          aria-label={label}
          className="num"
          disabled={disabled}
          value={text}
          placeholder={placeholder}
          list={!tokens && text.startsWith('{') ? 'dm-tokens-len' : undefined}
          onFocus={() => (focused.current = true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => {
            focused.current = false;
            commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(fmt(shown));
              setTimeout(() => (e.target as HTMLInputElement).blur());
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const cur = Number(parseLen(text) ?? placeholder);
              if (Number.isNaN(cur)) return;
              const v = clamp(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
              setText(String(v));
              onCommit(out(v));
            }
          }}
        />
        {unit && numeric && <span className="unit">{unit}</span>}
        {tokens && (
          <LenTokenMenu
            label={label}
            anchor={field}
            value={fmt(shown)}
            disabled={disabled}
            onPick={(v) => {
              setText(v);
              if (v !== fmt(shown)) onCommit(v);
            }}
          />
        )}
      </label>
    </PropRow>
  );
}

/** 长度令牌菜单：输入框右侧箭头，列出值为数值 / 长度的令牌（样式同 Select）。 */
function LenTokenMenu({ label, anchor, value, disabled, onPick }: { label: string; anchor: React.RefObject<HTMLElement | null>; value: string; disabled?: boolean; onPick: (v: string) => void }) {
  const tokens = useStore((s) => s.doc?.tokens ?? EMPTY_TOKENS);
  const keys = useMemo(() => Object.keys(tokens).filter((k) => /^-?\.?\d/.test(tokenValue(tokens, k)?.trim() ?? '')), [tokens]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = /^\{(.+)\}$/.exec(value)?.[1];
  const close = () => {
    setOpen(false);
    setPos(null);
  };
  useLayoutEffect(() => {
    if (!open || !anchor.current || !menu.current) return;
    const r = anchor.current.getBoundingClientRect();
    const h = menu.current.offsetHeight;
    const w = Math.max(menu.current.offsetWidth, r.width);
    const below = window.innerHeight - r.bottom - 8;
    const up = below < h && r.top > below;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 8 - w)), top: up ? r.top - 4 - h : r.bottom + 4, width: r.width, up });
  }, [open, keys.length]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const tg = e.target as Node;
      if (!menu.current?.contains(tg) && !anchor.current?.contains(tg)) close();
    };
    const onScroll = (e: Event) => !menu.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  if (!keys.length) return null;
  return (
    <>
      <button
        type="button"
        className="pfield-chevron"
        aria-label={t('fields.lenTokens', { label })}
        aria-expanded={open}
        disabled={disabled}
        onPointerDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault(); // 不让 label 把焦点转给输入框
          if (open) close();
          else setOpen(true);
        }}
      >
        <Icon name="chevron" size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="listbox"
            aria-label={label}
            className={`select-content ${pos?.up ? 'up' : ''}`}
            style={pos ? { left: pos.left, top: pos.top, minWidth: pos.width } : { visibility: 'hidden', left: 0, top: 0 }}
            onPointerDown={(e) => e.preventDefault()}
          >
            {keys.map((k) => (
              <div
                key={k}
                role="option"
                aria-selected={k === current}
                className="select-item"
                onClick={() => {
                  close();
                  onPick(`{${k}}`);
                }}
              >
                <span>{k}</span>
                <span className="select-hint">{tokens[k]}</span>
                {k === current && <Icon name="check" size={14} stroke={2} />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** 紧凑数值框（无标签行）：方向键步进，回车 / 失焦提交；prefix 为框内前缀（如 T / R）。 */
export function LenField({ label, value, onCommit, prefix, unit, min, step = 1, placeholder, disabled }: { label: string; value: unknown; onCommit: (v: Len | null) => void; prefix?: string; unit?: string; min?: number; step?: number; placeholder?: string; disabled?: boolean }) {
  const { text, setText, focused } = useDraft(fmt(value));
  const clamp = (n: number) => Math.max(min ?? -Infinity, Math.round(n * 100) / 100);
  const commit = (raw: string) => {
    const v = parseLen(raw);
    if (fmt(v) === fmt(value)) return;
    onCommit(typeof v === 'number' ? clamp(v) : v);
  };
  return (
    <label className="pfield">
      {prefix && <span className="unit prefix">{prefix}</span>}
      <input
        aria-label={label}
        className="num"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        list={text.startsWith('{') ? 'dm-tokens-len' : undefined}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            setTimeout(() => (e.target as HTMLInputElement).blur());
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const cur = Number(parseLen(text) ?? placeholder ?? 0);
            if (Number.isNaN(cur)) return;
            const v = clamp(cur + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * step);
            setText(String(v));
            onCommit(v);
          }
        }}
      />
      {unit && (text === '' || /^-?\d/.test(text)) && <span className="unit">{unit}</span>}
    </label>
  );
}

type Sides = [Len | undefined, Len | undefined, Len | undefined, Len | undefined];
/** Spacing → [上, 右, 下, 左]。 */
export function toSides(v: unknown): Sides {
  if (v === undefined || v === null) return [undefined, undefined, undefined, undefined];
  if (!Array.isArray(v)) return [v as Len, v as Len, v as Len, v as Len];
  if (v.length === 2) return [v[0], v[1], v[0], v[1]];
  return [v[0], v[1], v[2], v[3]];
}
/** [上, 右, 下, 左] → 最简 Spacing（四边相同 → 单值，上下 / 左右相同 → 两值，noPair 时不用两值）。fill 为未填边的取值。 */
export function fromSides(s: Sides, fill: Len = 0, noPair = false): Len | [Len, Len] | [Len, Len, Len, Len] | null {
  if (s.every((x) => x === undefined)) return null;
  const [a, b, c, d] = s.map((x) => x ?? fill) as [Len, Len, Len, Len];
  if (a === b && b === c && c === d) return a;
  if (a === c && b === d && !noPair) return [a, b];
  return [a, b, c, d];
}

/**
 * 内 / 外边距、边框宽度、圆角：一个值作用于四边，或展开后分别设置 上 右 下 左。
 * corners：按四角（左上 右上 右下 左下）设置，不输出两值写法。fill：展开后未填的边按此值补齐。
 */
export function SpacingRow({ label, value, onCommit, placeholder, min, disabled, onRemove, fill = 0, corners }: { label: string; min?: number; value: unknown; onCommit: (v: Len | [Len, Len] | [Len, Len, Len, Len] | null) => void; placeholder?: Sides | string; disabled?: boolean; onRemove?: () => void; fill?: Len; corners?: boolean }) {
  const sides = toSides(value);
  const uniform = sides.every((x) => fmt(x) === fmt(sides[0]));
  const [split, setSplit] = useState(!uniform);
  const ph = Array.isArray(placeholder) ? placeholder.map((x) => fmt(x)) : [placeholder, placeholder, placeholder, placeholder];
  const phOne = ph.every((x) => x === ph[0]) ? ph[0] : t('insp.mixed');
  const names = corners ? [t('insp.topLeft'), t('insp.topRight'), t('insp.bottomRight'), t('insp.bottomLeft')] : [t('layout.top'), t('layout.right'), t('layout.bottom'), t('layout.left')];
  const prefixes = corners ? ['TL', 'TR', 'BR', 'BL'] : ['T', 'R', 'B', 'L'];
  // 网格按两行排列；四角时第二行为 左下 右下
  const order = corners ? [0, 1, 3, 2] : [0, 1, 2, 3];
  const toggle = corners ? t('insp.corners') : t('insp.sides');
  return (
    <PropRow label={label} onRemove={onRemove} disabled={disabled}>
      <div className={`spacing ${split ? 'split' : ''}`}>
        {split ? (
          order.map((i) => (
            <LenField
              key={i}
              label={`${label} ${names[i]}`}
              prefix={prefixes[i]}
              value={sides[i]}
              min={min}
              placeholder={ph[i] ?? '0'}
              disabled={disabled}
              onCommit={(v) => {
                const next = [...sides] as Sides;
                next[i] = v ?? undefined;
                onCommit(fromSides(next, fill, corners));
              }}
            />
          ))
        ) : (
          <LenField label={label} value={uniform ? sides[0] : undefined} unit="px" min={min} placeholder={uniform ? (phOne ?? '0') : t('insp.mixed')} disabled={disabled} onCommit={onCommit} />
        )}
        <button className={`icon-btn sm ${split ? 'on' : ''}`} aria-label={toggle} title={toggle} aria-pressed={split} disabled={disabled} onClick={() => setSplit(!split)}>
          <Icon name="sides" size={14} />
        </button>
      </div>
    </PropRow>
  );
}

export function TextInput({ label, value, onCommit, disabled, placeholder, list, multiline, transform }: { label: string; value: unknown; onCommit: (v: string | null) => void; disabled?: boolean; placeholder?: string; list?: string; multiline?: boolean; transform?: 'upper' }) {
  const { text, setText, focused } = useDraft(fmt(value));
  const commit = (t: string) => {
    if (t === fmt(value)) return;
    onCommit(t === '' ? null : t);
  };
  const common = {
    'aria-label': label,
    disabled,
    value: text,
    placeholder,
    onFocus: () => (focused.current = true),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      focused.current = false;
      commit(e.target.value);
    },
  };
  return (
    <label className={`pfield ${multiline ? 'multi' : ''}`}>
      {multiline ? (
        <textarea {...common} rows={3} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.target as HTMLTextAreaElement).blur()} />
      ) : (
        <input {...common} className={transform === 'upper' ? 'upper' : ''} list={list} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
    </label>
  );
}

/** 颜色：色块（点击取色）+ 文本（可写渐变或 {令牌}）+ 颜色令牌菜单（样式同 Select）。 */
export function ColorInput({ label, value, onCommit, disabled }: { label: string; value: unknown; onCommit: (v: string | null) => void; disabled?: boolean }) {
  const tokens = useStore((s) => s.doc?.tokens ?? EMPTY_TOKENS);
  const v = fmt(value);
  const m = /^\{(.+)\}$/.exec(v);
  const resolved = m ? (tokenValue(tokens, m[1]) ?? '') : v;
  const hex = /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : /^#[0-9a-f]{3}$/i.test(resolved) ? `#${[...resolved.slice(1)].map((c) => c + c).join('')}` : '#000000';
  const { text, setText, focused } = useDraft(v);
  const colorKeys = useMemo(() => Object.keys(tokens).filter((k) => isColorToken(tokens, k)), [tokens]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false); // 输入 { 时按文本过滤；点箭头打开时列出全部
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const q = text.replace(/^\{|\}$/g, '').toLowerCase();
  const items = filter ? colorKeys.filter((k) => k.toLowerCase().includes(q)) : colorKeys;
  const current = m?.[1];

  const show = (byTyping: boolean) => {
    if (disabled || !colorKeys.length) return;
    setFilter(byTyping);
    const list = byTyping ? colorKeys.filter((k) => k.toLowerCase().includes(q)) : colorKeys;
    setHi(Math.max(0, list.indexOf(current ?? '')));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setPos(null);
  };
  const pick = (k: string) => {
    const nv = `{${k}}`;
    close();
    setText(nv);
    if (nv !== v) onCommit(nv);
  };

  useLayoutEffect(() => {
    if (!open || !field.current || !menu.current) return;
    const r = field.current.getBoundingClientRect();
    const h = menu.current.offsetHeight;
    const w = Math.max(menu.current.offsetWidth, r.width);
    const below = window.innerHeight - r.bottom - 8;
    const up = below < h && r.top > below;
    // 菜单比输入框宽时向左收，保持在窗口内
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 8 - w)), top: up ? r.top - 4 - h : r.bottom + 4, width: r.width, up });
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const tg = e.target as Node;
      if (!menu.current?.contains(tg) && !field.current?.contains(tg)) close();
    };
    const onScroll = (e: Event) => !menu.current?.contains(e.target as Node) && close();
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, hi]);

  return (
    <div ref={field} className={`pfield color ${open ? 'on' : ''}`}>
      <span className="swatch" style={{ background: resolved || 'transparent' }}>
        <input type="color" aria-label={t('fields.pick', { label })} disabled={disabled} value={hex} onChange={(e) => onCommit(e.target.value.toUpperCase())} />
      </span>
      <input
        ref={input}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        disabled={disabled}
        value={text}
        placeholder={t('common.none')}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.startsWith('{')) {
            setFilter(true);
            setHi(0);
            if (!open) show(true);
          } else if (open && filter) close();
        }}
        onBlur={(e) => {
          focused.current = false;
          close();
          if (e.target.value !== v) onCommit(e.target.value.trim() || null);
        }}
        onKeyDown={(e) => {
          if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setHi((i) => Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (!open && e.key === 'ArrowDown') {
            e.preventDefault();
            show(false);
          } else if (e.key === 'Enter') {
            if (open && items[hi]) {
              e.preventDefault();
              pick(items[hi]);
            }
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            close();
          }
        }}
      />
      {colorKeys.length > 0 && (
        <button
          type="button"
          className="pfield-chevron"
          aria-label={t('fields.tokens', { label })}
          tabIndex={-1}
          disabled={disabled}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : (input.current?.focus(), show(false)))}
        >
          <Icon name="chevron" size={14} />
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={menu}
            role="listbox"
            aria-label={label}
            className={`select-content ${pos?.up ? 'up' : ''}`}
            style={pos ? { left: pos.left, top: pos.top, minWidth: pos.width } : { visibility: 'hidden', left: 0, top: 0 }}
            onPointerDown={(e) => e.preventDefault() /* 保持输入框焦点，避免先触发失焦提交 */}
          >
            {items.length ? (
              items.map((k, i) => (
                <div key={k} data-i={i} role="option" aria-selected={k === current} className={`select-item ${i === hi ? 'hi' : ''}`} onPointerMove={() => setHi(i)} onClick={() => pick(k)}>
                  <span className="swatch sm" style={{ background: tokenValue(tokens, k) }} />
                  <span>{k}</span>
                  <span className="select-hint">{tokens[k]}</span>
                  {k === current && <Icon name="check" size={14} stroke={2} />}
                </div>
              ))
            ) : (
              <div className="select-empty">{t('fields.noTokens')}</div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

type Opt = string | [string, string];

/**
 * 下拉选择（shadcn Select 样式）：触发按钮 + 浮层列表，选中项带对勾；
 * 支持方向键 / Enter / Esc / 首字母跳转。className 决定触发器外观（pfield / field 等）。
 */
export function Select({ label, value, options, onChange, disabled, placeholder, className = 'pfield' }: { label: string; value: string; options: Opt[]; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; className?: string }) {
  const items: Array<[string, string]> = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  if (placeholder !== undefined && !items.some(([v]) => v === '')) items.unshift(['', placeholder]);
  if (value && !items.some(([v]) => v === value)) items.push([value, value]); // AI 写入的其它取值也能看到
  const cur = items.find(([v]) => v === value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const show = () => {
    if (disabled) return;
    setHi(Math.max(0, items.findIndex(([v]) => v === value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    setPos(null);
    if (refocus) btn.current?.focus();
  };
  const pick = (i: number) => {
    const it = items[i];
    close();
    if (it && it[0] !== value) onChange(it[0]);
  };

  useLayoutEffect(() => {
    if (!open || !btn.current || !list.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = list.current.offsetHeight;
    const below = window.innerHeight - r.bottom - 8;
    const up = below < h && r.top > below;
    setPos({ left: r.left, top: up ? r.top - 4 - h : r.bottom + 4, width: r.width, up });
  }, [open]);
  // 定位后才可见，visibility:hidden 时无法获得焦点
  useEffect(() => {
    if (pos) list.current?.focus({ preventScroll: true });
  }, [pos]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false);
    };
    const onScroll = (e: Event) => !list.current?.contains(e.target as Node) && close(false);
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, hi]);

  const onListKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const k = e.key;
    if (k === 'ArrowDown') setHi((i) => Math.min(items.length - 1, i + 1));
    else if (k === 'ArrowUp') setHi((i) => Math.max(0, i - 1));
    else if (k === 'Home') setHi(0);
    else if (k === 'End') setHi(items.length - 1);
    else if (k === 'Enter' || k === ' ') pick(hi);
    else if (k === 'Escape') close();
    else if (k === 'Tab') return close();
    else if (k.length === 1) {
      const q = k.toLowerCase();
      const n = items.length;
      for (let d = 1; d <= n; d++) {
        const i = (hi + d) % n;
        if (items[i][1].toLowerCase().startsWith(q)) {
          setHi(i);
          break;
        }
      }
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${className} select-trigger ${open ? 'on' : ''}`}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            show();
          }
        }}
      >
        <span className={`select-value ${!cur || cur[0] === '' ? 'placeholder' : ''}`}>{cur ? cur[1] : (placeholder ?? value)}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={list}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            aria-activedescendant={`${label}-opt-${hi}`}
            className={`select-content ${pos?.up ? 'up' : ''}`}
            style={pos ? { left: pos.left, top: pos.top, minWidth: pos.width } : { visibility: 'hidden', left: 0, top: 0 }}
            onKeyDown={onListKey}
          >
            {items.map(([v, l], i) => (
              <div
                key={v}
                id={`${label}-opt-${i}`}
                data-i={i}
                role="option"
                aria-selected={v === value}
                className={`select-item ${i === hi ? 'hi' : ''}`}
                onPointerMove={() => setHi(i)}
                onClick={() => pick(i)}
              >
                <span>{l}</span>
                {v === value && <Icon name="check" size={14} stroke={2} />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * 分段切换（shadcn Tabs 样式）：选项可只给图标，label 用作无障碍名与提示；方向键切换。
 * clearable：再次点击当前项清除为 ''（回到缺省值）。value 不在选项里时追加一个文字选项。
 */
export function Tabs({ label, value, options: opts, onChange, disabled, clearable, title }: { label: string; value: string; options: Array<{ value: string; label: string; icon?: IconName; text?: string }>; onChange: (v: string) => void; disabled?: boolean; clearable?: boolean; title?: string }) {
  const options = value && !opts.some((o) => o.value === value) ? [...opts, { value, label: value }] : opts;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const go = (i: number) => {
    const o = options[(i + options.length) % options.length];
    refs.current[options.indexOf(o)]?.focus();
    if (o.value !== value) onChange(o.value);
  };
  return (
    <div className="tabs-list" role="tablist" aria-label={label} title={title}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={o.label}
            title={o.label}
            tabIndex={on || (!options.some((x) => x.value === value) && i === 0) ? 0 : -1}
            className={`tabs-trigger ${on ? 'on' : ''}`}
            disabled={disabled}
            onClick={() => (on ? clearable && onChange('') : onChange(o.value))}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              e.stopPropagation();
              go(i + d);
            }}
          >
            {o.icon ? <Icon name={o.icon} size={16} /> : (o.text ?? o.label)}
          </button>
        );
      })}
    </div>
  );
}

/** 多选开关组（外观同 Tabs），每个按钮独立切换。 */
export function ToggleGroup({ label, options, onToggle, disabled }: { label: string; options: Array<{ value: string; label: string; icon: IconName; on: boolean }>; onToggle: (v: string, on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="tabs-list" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.on} aria-label={o.label} title={o.label} className={`tabs-trigger ${o.on ? 'on' : ''}`} disabled={disabled} onClick={() => onToggle(o.value, !o.on)}>
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

/** placeholder 为空选项（清除）的文案；传 null 表示不提供空选项。 */
export function SelectInput({ label, value, options, onCommit, disabled, placeholder = '—' }: { label: string; value: unknown; options: Opt[]; onCommit: (v: string | null) => void; disabled?: boolean; placeholder?: string | null }) {
  return <Select label={label} value={fmt(value)} options={options} placeholder={placeholder ?? undefined} disabled={disabled} onChange={(v) => onCommit(v || null)} />;
}
