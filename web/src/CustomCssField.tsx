// 自定义 CSS：每条一行，左边填属性名、右边填值。
// 与已有字段重复的属性（宽高、边距、背景、字体…）不会提交，并提示去对应属性里设置。
// AI 用结构化字段写的 style.cursor 与只有 AI 能写的布局字段（zIndex、overflow、top…）也并入这里显示，
// 编辑后统一存进 style.css，原字段删除。
import { useEffect, useRef, useState } from 'react';
import { CUSTOM_CSS_MAX, cssNameError, cssValueError } from '../../src/core/customCss';
import { Icon } from './icons';
import { toast } from './store';
import { t } from './i18n';

/** 结构化字段路径 → 面板里对应属性的名称，用于“已由 xxx 管理”的提示。 */
const FIELD_LABEL: Record<string, string> = {
  'box.width': 'insp.size',
  'box.height': 'insp.size',
  'box.minWidth': 'insp.minWidth',
  'box.maxWidth': 'insp.maxWidth',
  'box.minHeight': 'insp.minHeight',
  'box.maxHeight': 'insp.maxHeight',
  'box.margin': 'insp.margin',
  'box.padding': 'insp.padding',
  'box.border': 'insp.border',
  'box.radius': 'insp.radius',
  'style.fontFamily': 'insp.font',
  'style.fontSize': 'insp.fontSize',
  'style.fontWeight': 'insp.fontWeight',
  'style.fontStyle': 'insp.italic',
  'style.lineHeight': 'insp.lineHeight',
  'style.letterSpacing': 'insp.letterSpacing',
  'style.textAlign': 'insp.textAlign',
  'style.textDecoration': 'insp.decoration',
  'style.textTransform': 'insp.case',
  'style.whiteSpace': 'insp.wrap',
  'style.listStyle': 'insp.list',
  'style.color': 'insp.color',
  'style.background': 'insp.background',
  'style.objectFit': 'insp.objectFit',
  'style.shadow': 'insp.dropShadow',
  'style.textShadow': 'insp.textShadow',
  'style.opacity': 'insp.opacity',
  'style.blur': 'insp.layerBlur',
  'style.backdropBlur': 'insp.backdropBlur',
  'style.transform': 'insp.transform',
};
const fieldLabel = (f: string) => (f.startsWith('layout.') ? t('insp.layout') : FIELD_LABEL[f] ? t(FIELD_LABEL[f] as never) : f);

/** 常用属性（浏览器拿不到属性列表时的兜底）。 */
const COMMON = [
  'cursor',
  'pointer-events',
  'user-select',
  'mix-blend-mode',
  'isolation',
  'aspect-ratio',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-width',
  'outline-style',
  'transition',
  'animation',
  'visibility',
  'box-sizing',
  'text-overflow',
  'text-indent',
  'text-decoration-color',
  'text-decoration-style',
  'text-underline-offset',
  'word-break',
  'overflow-wrap',
  'vertical-align',
  'font-variant-numeric',
  'font-feature-settings',
  'transform-origin',
  'perspective',
  'clip-path',
  'object-position',
  'grid-column',
  'grid-row',
  'grid-area',
  'justify-self',
  'order',
  'accent-color',
  'caret-color',
  'scroll-behavior',
  'resize',
  'content-visibility',
  'will-change',
];

/** 属性名候选：浏览器支持的全部 CSS 属性（含简写），去掉已由面板字段管理的与带浏览器前缀的重复项。 */
let suggestCache: string[] | null = null;
function suggestions(): string[] {
  if (suggestCache) return suggestCache;
  const all = new Set<string>(COMMON);
  try {
    // 计算样式列出所有长写属性；style 对象的键还包括简写（camelCase）
    const cs = getComputedStyle(document.documentElement);
    for (let i = 0; i < cs.length; i++) all.add(cs[i]);
    for (const k in document.documentElement.style) {
      if (typeof (document.documentElement.style as unknown as Record<string, unknown>)[k] !== 'string' || /^\d|^css/i.test(k)) continue;
      all.add(k.replace(/^(webkit|moz|ms)(?=[A-Z])/, (m) => `-${m.toLowerCase()}`).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
    }
  } catch {
    /* 非浏览器环境：只用常用列表 */
  }
  const ok = [...all].filter((p) => !p.startsWith('--') && !cssNameError(p) && !(p.startsWith('-') && all.has(p.replace(/^-(webkit|moz|ms)-/, ''))));
  suggestCache = ok.sort((a, b) => Number(a.startsWith('-')) - Number(b.startsWith('-')) || a.localeCompare(b));
  return suggestCache;
}

interface Row {
  id: number;
  name: string;
  value: string;
  error?: boolean;
}

let rowSeq = 0;
const toRows = (entries: Array<[string, string]>): Row[] => entries.map(([name, value]) => ({ id: ++rowSeq, name, value }));
const blank = (): Row => ({ id: ++rowSeq, name: '', value: '' });

export function CustomCssRows({
  addTick,
  css,
  legacy,
  disabled,
  onCommit,
  onRemove,
}: {
  /** 每次变化时新增一行空白（由分组标题上的 + 触发）。 */
  addTick: number;
  css: Record<string, string> | undefined;
  /** 结构化字段里的值（CSS 属性 → 值），并入列表显示。 */
  legacy: Array<[string, string]>;
  disabled: boolean;
  onCommit: (css: Record<string, string> | null) => void;
  /** 删掉最后一条时调用：移除整个自定义 CSS 属性。 */
  onRemove?: () => void;
}) {
  const entries: Array<[string, string]> = [...legacy.filter(([k]) => css?.[k] === undefined), ...Object.entries(css ?? {})];
  const key = JSON.stringify(entries);
  const [rows, setRows] = useState<Row[]>(() => (entries.length ? toRows(entries) : [blank()]));
  const [focusId, setFocusId] = useState<number | null>(() => (entries.length ? null : rows[0]?.id ?? null));
  const committed = useRef(key);
  const box = useRef<HTMLDivElement>(null);

  // 外部变化（撤销、AI 修改、切换选中）时重建；自己刚提交的结果不重建，保留未填完的草稿行
  useEffect(() => {
    if (key === committed.current) return;
    committed.current = key;
    setRows(entries.length ? toRows(entries) : [blank()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const commit = (next: Row[]) => {
    const out: Record<string, string> = {};
    const problems: string[] = [];
    const checked = next.map((r) => {
      const name = r.name.trim().toLowerCase();
      const value = r.value.trim();
      if (!name && !value) return { ...r, error: false };
      if (!name || !value) return { ...r, error: false }; // 未填完：留作草稿，不提交也不报错
      const ne = cssNameError(name);
      if (ne) {
        problems.push(ne.field === 'tokens' ? t('insp.cssTokens', { name }) : ne.field && ne.field !== 'all' ? t('insp.cssManaged', { name, field: fieldLabel(ne.field) }) : t('insp.cssInvalid', { name, msg: ne.message }));
        return { ...r, error: true };
      }
      if (out[name] !== undefined) {
        problems.push(t('insp.cssDup', { name }));
        return { ...r, error: true };
      }
      const ve = cssValueError(value);
      if (ve) {
        problems.push(t('insp.cssInvalid', { name, msg: ve }));
        return { ...r, error: true };
      }
      out[name] = value;
      return { ...r, name, value, error: false };
    });
    if (Object.keys(out).length > CUSTOM_CSS_MAX) problems.push(t('insp.cssMax', { n: CUSTOM_CSS_MAX }));
    setRows(checked);
    for (const p of problems.slice(0, 3)) toast(p);
    if (Object.keys(out).length > CUSTOM_CSS_MAX) return;
    const nextKey = JSON.stringify(Object.entries(out));
    if (nextKey === key) return;
    committed.current = nextKey;
    onCommit(Object.keys(out).length ? out : null);
  };

  const tick = useRef(addTick);
  useEffect(() => {
    if (addTick === tick.current) return;
    tick.current = addTick;
    if (rows.length < CUSTOM_CSS_MAX) add();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTick]);

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // 焦点离开整组输入时才提交，避免在属性名和值之间切换时提前校验
  const onBlur = (e: React.FocusEvent) => {
    if (box.current?.contains(e.relatedTarget as Node | null)) return;
    commit(rows);
  };
  const remove = (id: number) => {
    const next = rows.filter((r) => r.id !== id);
    if (!next.length) {
      committed.current = '[]';
      return onRemove ? onRemove() : (setRows([blank()]), onCommit(null));
    }
    commit(next);
  };
  const add = () => {
    const r = blank();
    setRows([...rows, r]);
    setFocusId(r.id);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  return (
    <div className="css-rows" ref={box} onBlur={onBlur}>
      <datalist id="dm-css-props">
        {suggestions().map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {rows.map((r, i) => (
        <div key={r.id} className={`css-pair ${r.error ? 'error' : ''}`}>
          <label className="pfield">
            <input
              aria-label={`${t('insp.cssName')} ${i + 1}`}
              placeholder={t('insp.cssName')}
              list="dm-css-props"
              spellCheck={false}
              autoCapitalize="off"
              value={r.name}
              disabled={disabled}
              autoFocus={r.id === focusId}
              onChange={(e) => update(r.id, { name: e.target.value, error: false })}
              onKeyDown={onKey}
            />
          </label>
          <label className="pfield">
            <input
              aria-label={`${t('insp.cssValue')} ${i + 1}`}
              placeholder={t('insp.cssValue')}
              spellCheck={false}
              autoCapitalize="off"
              value={r.value}
              disabled={disabled}
              onChange={(e) => update(r.id, { value: e.target.value, error: false })}
              onKeyDown={onKey}
            />
          </label>
          <button type="button" className="icon-btn sm" aria-label={t('insp.removeCss', { name: r.name || String(i + 1) })} title={t('insp.removeCss', { name: r.name || String(i + 1) })} disabled={disabled} onClick={() => remove(r.id)}>
            <Icon name="minus" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
