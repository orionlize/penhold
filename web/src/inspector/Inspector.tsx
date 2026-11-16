// 右侧属性面板：按 尺寸 / 布局 / 外观 / 效果 / 高级 分组列出已设置的属性，“+”添加、“−”移除；
// layout 字段：布局方式 / 方向 / 对齐 / 间隙 / 网格 / 定位 / grow 可编辑，其余只读展示（由 AI 调整）。
import { useRef, useState } from 'react';
import { inferRender, instanceCount, isButton, resolveAddress } from '../../../src/core/doc';
import { storeTarget, type NodePatch } from '../../../src/core/edit';
import { TEXT_STYLES, type Border, type Layout, type Len, type Node, type Spacing, type TextStyle } from '../../../src/core/types';
import { ColorInput, LenField, NumRow, PropRow, ResetCtx, Section, SelectInput, SpacingRow, Tabs, TextInput, ToggleGroup, TokenList, fmt, parseLen, toSides } from './fields';
import { BackgroundRow, uploadImage } from './BackgroundField';
import { TransformRow } from './TransformField';
import { CustomCssRows } from './CustomCssField';
import { LAYOUT_CSS, LAYOUT_CSS_KEYS, layoutCssValue } from '../../../src/core/customCss';
import { firstFamily, fontAvailable } from '../lib/fonts';
import { Icon, type IconName } from '../lib/icons';
import { commitOps, commitPatch, effective, toast, useStore, EMPTY_TOKENS, EMPTY_TWEAKS } from '../store';
import { viewOf } from '../editor/Viewport';
import { t } from '../i18n';

const WEIGHTS: Array<[string, string]> = [
  ['100', 'Thin 100'],
  ['200', 'ExtraLight 200'],
  ['300', 'Light 300'],
  ['400', 'Regular 400'],
  ['500', 'Medium 500'],
  ['600', 'SemiBold 600'],
  ['700', 'Bold 700'],
  ['800', 'ExtraBold 800'],
  ['900', 'Black 900'],
];

/** "8" / "8 16" / "8 16 4" / "8 16 4 0" → Spacing。 */
function parseSpacing(t: string): Spacing | null | undefined {
  const parts = t.trim().split(/\s+/).filter(Boolean).map(parseLen) as Len[];
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return [parts[0], parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2], parts[1]];
  if (parts.length === 4) return [parts[0], parts[1], parts[2], parts[3]];
  return undefined;
}

interface Shadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}
const SHADOW_RE = /^(-?[\d.]+)(?:px)?\s+(-?[\d.]+)(?:px)?(?:\s+([\d.]+)(?:px)?)?(?:\s+(-?[\d.]+)(?:px)?)?\s+(.+)$/;
function parseShadow(s: unknown): Shadow | null {
  if (typeof s !== 'string') return null;
  const m = SHADOW_RE.exec(s.trim());
  if (!m || /,\s*-?\d+(px)?\s+-?\d/.test(m[5])) return null; // 多重阴影按原文编辑
  return { x: Number(m[1]), y: Number(m[2]), blur: Number(m[3] ?? 0), spread: Number(m[4] ?? 0), color: m[5] };
}
const shadowStr = (s: Shadow) => `${s.x}px ${s.y}px ${s.blur}px${s.spread ? ` ${s.spread}px` : ''} ${s.color}`;

type RK = [field: string, key?: string, sub?: string];

/** Text 分组里取这些值视同默认，不单独展示该行。 */
/** 边框各边宽度：sides 限定的边保留宽度，其余为 0（与渲染一致）。 */
function borderWidths(b: Border | undefined): unknown {
  if (!b?.sides?.length) return b?.width;
  const w = toSides(b.width ?? 1);
  return (['top', 'right', 'bottom', 'left'] as const).map((s, i) => (b.sides!.includes(s) ? (w[i] ?? 1) : 0));
}

const TEXT_DEFAULT: Record<string, string> = { textAlign: 'left', listStyle: 'none', textTransform: 'none' };

/** 值比较：忽略对象键顺序，null / undefined / 空对象视为“未设置”。 */
function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) return v.map(norm);
    if (typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const k of Object.keys(v as object).sort()) {
        const x = norm((v as Record<string, unknown>)[k]);
        if (x !== undefined) o[k] = x;
      }
      return Object.keys(o).length ? o : undefined;
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** 选文字样式时带出的字号：画布有 size.* 令牌时取最接近的一档令牌，否则用默认字号。 */
function styleFontSize(style: TextStyle, tokens: Record<string, string> | undefined): number | string {
  const want = TEXT_STYLES[style];
  let best: [string, number] | undefined;
  for (const [k, v] of Object.entries(tokens ?? {})) {
    if (!k.startsWith('size.')) continue;
    const n = parseFloat(v);
    if (Number.isFinite(n) && (!best || Math.abs(n - want) < Math.abs(best[1] - want))) best = [k, n];
  }
  return best ? `{${best[0]}}` : want;
}

const TEXT_STYLE_OPTS: Array<[string, string]> = Object.entries(TEXT_STYLES).map(([k, px]) => [
  k,
  `${k.replace(/^heading/, 'Heading ').replace(/^./, (c) => c.toUpperCase())} · ${px}px`,
]);

interface PropDef {
  key: string;
  label: string;
  has: boolean;
  pinned?: boolean;
  /** 只读（layout 字段，仅 AI 可写）。 */
  ro?: boolean;
  /** 该行对应的存储字段，用于“重置为修改前的值”：[字段组, 子键?, 子子键?]（如 ['box', 'border', 'color']）。 */
  rk?: RK[];
  clear: () => void;
  row: (onRemove?: () => void) => React.ReactNode;
}

export function Inspector() {
  const doc = useStore((s) => s.doc);
  useStore((s) => s.version);
  const selection = useStore((s) => s.selection);
  const lock = useStore((s) => s.lock);
  if (!doc) return <div className="inspector" />;
  if (!selection.length)
    return (
      <div className="inspector">
        <TokenList id="dm-tokens" />
        <div className="insp-empty">{t('insp.empty')}</div>
        <TokensSection disabled={!!lock} />
      </div>
    );
  return <InspectorBody key={selection.join(',')} />;
}

function InspectorBody() {
  const doc = useStore((s) => s.doc)!;
  const selection = useStore((s) => s.selection);
  const lock = useStore((s) => s.lock);
  const disabled = !!lock;
  const [extras, setExtras] = useState<Set<string>>(new Set());
  const [cssAdd, setCssAdd] = useState(0); // 高级分组 + 的点击计数：通知自定义 CSS 再加一行
  /** 本次选中期间已显示过的行：改成默认值时不立刻消失（移除按钮才隐藏）。 */
  const shown = useRef(new Set<string>());
  /** 刚点了移除、值尚未在文档里清掉的行：这期间不再显示，免得被重新记入 shown。 */
  const removing = useRef(new Set<string>());

  const items = selection.map((a) => ({ addr: a, eff: effective(doc, a) })).filter((x) => x.eff);
  if (!items.length) return <div className="inspector" />;
  const first = items[0].eff!;
  const n = first.node;
  const kind = inferRender(n);
  const multi = items.length > 1;
  const addrs = items.map((i) => i.addr);
  const isFrame = doc.frames.some((f) => f.id === selection[0]);
  const cs = viewOf(selection[0])?.computedStyle(selection[0]) ?? null;
  const rect = viewOf(selection[0])?.rect(selection[0]) ?? null;
  const px = (v: string | undefined) => (v && v !== 'normal' ? String(Math.round(parseFloat(v) * 100) / 100) : '');
  const userBase = useStore((s) => s.userBase);
  /** 选中节点里有被用户改过的字段时，返回把它们恢复为基线值的动作。 */
  const resetFor = (rk?: RK[]): (() => void) | undefined => {
    if (!rk?.length || disabled) return undefined;
    const plans = new Map<string, Record<string, unknown>>();
    for (const a of addrs) {
      const node = effective(doc, a)?.node as unknown as Record<string, unknown> | undefined;
      for (const [field, key, subKey] of rk) {
        let id: string | null;
        try {
          id = storeTarget(doc, a, field);
        } catch {
          continue;
        }
        const bk = id && (key ? `${id}.${field}.${key}` : `${id}.${field}`);
        if (!bk || !(bk in userBase)) continue;
        let base = userBase[bk];
        const cur = key ? (node?.[field] as Record<string, unknown> | undefined)?.[key] : node?.[field];
        if (subKey) {
          // 只恢复对象里的这一项（如边框颜色），其它项保持当前值
          const bs = (base as Record<string, unknown> | null)?.[subKey];
          if (sameValue(bs, (cur as Record<string, unknown> | undefined)?.[subKey])) continue;
          const m: Record<string, unknown> = { ...((cur as object) ?? {}) };
          if (bs === undefined) delete m[subKey];
          else m[subKey] = bs;
          base = Object.keys(m).length ? m : null;
        } else if (sameValue(base, cur)) continue; // 值已和 AI 设定的一致：无需重置
        const p = plans.get(a) ?? {};
        if (key) p[field] = { ...((p[field] as object) ?? {}), [key]: base };
        else p[field] = base;
        plans.set(a, p);
      }
    }
    if (!plans.size) return undefined;
    return () => commitPatch([...plans.keys()], (a) => plans.get(a) as NodePatch);
  };

  const setKey = (field: 'box' | 'style' | 'props', key: string, v: unknown) => commitPatch(addrs, { [field]: { [key]: v } } as NodePatch);
  const setBorder = (key: string, v: unknown) =>
    commitPatch(addrs, (a) => {
      const cur = effective(doc, a)?.node.box?.border ?? {};
      const next: Record<string, unknown> = { ...cur, [key]: v ?? undefined };
      if (next[key] === undefined) delete next[key];
      // 宽度 / 颜色依附于线型：没有显式线型时补上渲染默认的 solid，避免删掉其中一项后整个边框消失
      if (key !== 'style' && !next.style) next.style = 'solid';
      return { box: { border: Object.keys(next).length ? next : null } };
    });
  const addExtra = (k: string) => {
    removing.current.delete(k);
    setExtras(new Set(extras).add(k));
  };
  const dropExtra = (k: string) => {
    shown.current.delete(k);
    removing.current.add(k);
    const s = new Set(extras);
    s.delete(k);
    setExtras(s);
  };

  const st = n.style ?? {};
  const bx = n.box ?? {};
  const textual = kind === 'text' || kind === 'input';
  const container = kind === 'container';

  const num = (field: 'box' | 'style', key: string, label: string, o: { pinned?: boolean; step?: number; min?: number; max?: number; unit?: string; scale?: number; ph?: string; tokens?: boolean } = {}): PropDef => {
    const value = (field === 'box' ? bx : st)[key as keyof typeof bx & keyof typeof st];
    return {
      key,
      label,
      rk: [[field, key]],
      has: value !== undefined,
      pinned: o.pinned,
      clear: () => setKey(field, key, null),
      row: (rm) => <NumRow key={key} label={label} value={value} step={o.step} min={o.min} max={o.max} unit={o.unit} scale={o.scale} placeholder={o.ph} tokens={o.tokens} disabled={disabled} onCommit={(v) => setKey(field, key, v)} onRemove={rm} />,
    };
  };
  const sel = (key: string, label: string, options: Array<[string, string]>, o: { pinned?: boolean; ph?: string; num?: boolean } = {}): PropDef => ({
    key,
    label,
    rk: [['style', key]],
    has: st[key as keyof typeof st] !== undefined,
    pinned: o.pinned,
    clear: () => setKey('style', key, null),
    row: (rm) => (
      <PropRow key={key} label={label} onRemove={rm} disabled={disabled}>
        <SelectInput label={label} value={st[key as keyof typeof st]} options={options} placeholder={o.ph} disabled={disabled} onCommit={(v) => setKey('style', key, v && o.num ? Number(v) : v)} />
      </PropRow>
    ),
  });
  const color = (field: 'style' | 'border', key: string, label: string, pinned?: boolean): PropDef => {
    const value = field === 'border' ? bx.border?.color : st[key as keyof typeof st];
    return {
      key: `${field}.${key}`,
      label,
      rk: [field === 'border' ? ['box', 'border', key] : ['style', key]],
      has: value !== undefined,
      pinned,
      clear: () => (field === 'border' ? setBorder('color', null) : setKey('style', key, null)),
      row: (rm) => (
        <PropRow key={`${field}.${key}`} label={label} onRemove={rm} disabled={disabled}>
          <ColorInput label={label} value={value} disabled={disabled} onCommit={(v) => (field === 'border' ? setBorder('color', v) : setKey('style', key, v))} />
        </PropRow>
      ),
    };
  };
  const spacing = (key: 'padding' | 'margin', label: string, pinned?: boolean): PropDef => ({
    key,
    label,
    rk: [['box', key]],
    has: bx[key] !== undefined,
    pinned,
    clear: () => setKey('box', key, null),
    row: (rm) => (
      <SpacingRow
        key={key}
        label={label}
        value={bx[key]}
        min={key === 'padding' ? 0 : undefined}
        placeholder={cs ? ([cs[`${key}Top`], cs[`${key}Right`], cs[`${key}Bottom`], cs[`${key}Left`]].map(px) as [string, string, string, string]) : '0'}
        disabled={disabled}
        onRemove={rm}
        onCommit={(v) => setKey('box', key, v)}
      />
    ),
  });

  // layout 字段只读：定位 / 伸缩归“尺寸”，子元素排布归“布局”
  const L: Layout = { ...n.layout };
  if (container && !L.display) L.display = 'flex';
  if (container && L.display === 'flex' && !L.direction) L.direction = 'column';
  const parentFlow = (() => {
    try {
      const parent = resolveAddress(doc, selection[0]).target.parent;
      if (!parent) return false;
      const pl = parent.component && doc.components[parent.component] ? { ...doc.components[parent.component].root.layout, ...parent.layout } : parent.layout;
      return pl?.display !== 'block'; // flex（缺省）或 grid
    } catch {
      return false;
    }
  })();
  const lay = (key: keyof Layout): PropDef => ({
    key: `layout.${key}`,
    label: LAYOUT_LABELS[key] ?? key,
    has: !multi && L[key] !== undefined,
    ro: true,
    clear: () => {},
    row: () => (
      <PropRow key={`layout.${key}`} label={LAYOUT_LABELS[key] ?? key} title={t('insp.byAi')}>
        <span className="pfield ro">{fmt(L[key])}</span>
      </PropRow>
    ),
  });
  // 用户可写的 layout 字段（USER_LAYOUT_KEYS）
  const setLayout = (key: keyof Layout, v: unknown) => commitPatch(addrs, { layout: { [key]: v } });
  const layNum = (key: 'grow' | 'gap', o: { min?: number; unit?: string; ph?: string; int?: boolean; pinned?: boolean } = {}): PropDef => ({
    key: `layout.${key}`,
    label: LAYOUT_LABELS[key],
    rk: [['layout', key]],
    has: n.layout?.[key] !== undefined,
    pinned: o.pinned,
    clear: () => setLayout(key, null),
    row: (rm) => (
      <NumRow
        key={`layout.${key}`}
        label={LAYOUT_LABELS[key]}
        value={L[key]}
        min={o.min}
        unit={o.unit}
        placeholder={o.ph}
        disabled={disabled}
        onRemove={rm}
        onCommit={(v) => {
          if (key === 'grow' && v !== null && typeof v !== 'number') return toast(t('insp.growNum'));
          setLayout(key, v);
        }}
      />
    ),
  });
  const laySel = (key: 'display', options: Array<[string, string]>, o: { value?: string; ph?: string } = {}): PropDef => ({
    key: `layout.${key}`,
    label: LAYOUT_LABELS[key],
    rk: [['layout', key]],
    has: true,
    clear: () => setLayout(key, null),
    row: () => (
      <PropRow key={`layout.${key}`} label={LAYOUT_LABELS[key]} disabled={disabled}>
        <SelectInput label={LAYOUT_LABELS[key]} value={o.value ?? L[key] ?? ''} options={options} placeholder={o.ph ?? null} disabled={disabled} onCommit={(v) => setLayout(key, v)} />
      </PropRow>
    ),
  });
  const gridDef: PropDef = {
    key: 'layout.grid',
    label: t('layout.grid'),
    rk: [
      ['layout', 'rows'],
      ['layout', 'columns'],
    ],
    has: true,
    clear: () => {},
    row: () => (
      <PropRow key="layout.grid" label={t('layout.grid')} disabled={disabled} title={t('insp.gridTip')}>
        <div className="pair">
          {(['rows', 'columns'] as const).map((k) => (
            <LenField
              key={k}
              label={LAYOUT_LABELS[k]}
              value={L[k]}
              unit={t(k === 'rows' ? 'insp.rowsUnit' : 'insp.colsUnit')}
              min={1}
              placeholder={k === 'columns' ? '1' : t('insp.auto')}
              disabled={disabled}
              onCommit={(v) => {
                if (typeof v === 'number' && !Number.isInteger(v)) return toast(t('insp.gridNum'));
                setLayout(k, v);
              }}
            />
          ))}
        </div>
      </PropRow>
    ),
  };
  const display = L.display;
  // 对齐：图标随主轴方向变化（flex row / grid 的 justify 为水平，column 为垂直；align 反之）
  const H: Array<{ value: string; label: string; icon: IconName }> = [
    { value: 'start', label: t('insp.aLeft'), icon: 'alignLeft' },
    { value: 'center', label: t('insp.aHCenter'), icon: 'alignHCenter' },
    { value: 'end', label: t('insp.aRight'), icon: 'alignRight' },
  ];
  const V: Array<{ value: string; label: string; icon: IconName }> = [
    { value: 'start', label: t('insp.aTop'), icon: 'alignTop' },
    { value: 'center', label: t('insp.aVCenter'), icon: 'alignVCenter' },
    { value: 'end', label: t('insp.aBottom'), icon: 'alignBottom' },
  ];
  const mainH = display === 'grid' || L.direction === 'row';
  const alignTabs = (key: 'justify' | 'align'): PropDef => {
    const horizontal = key === 'justify' ? mainH : !mainH;
    const isAlign = key === 'align';
    return {
      key: `layout.${key}`,
      label: LAYOUT_LABELS[key],
      rk: [['layout', key]],
      has: true,
      clear: () => {},
      row: () => (
        <PropRow key={`layout.${key}`} label={LAYOUT_LABELS[key]} disabled={disabled}>
          <Tabs
            label={LAYOUT_LABELS[key]}
            value={isAlign ? (L.align ?? '') : (L.justify ?? 'start')}
            options={!isAlign && display === 'flex' ? [...(horizontal ? H : V), { value: 'between', label: t('insp.spaceBetween'), icon: horizontal ? 'spaceBetweenH' : 'spaceBetweenV' }] : horizontal ? H : V}
            clearable={isAlign}
            title={isAlign && !L.align ? t('insp.alignStretch') : undefined}
            disabled={disabled}
            onChange={(v) => setLayout(key, v || null)}
          />
        </PropRow>
      ),
    };
  };
  const layoutProps: PropDef[] = [];
  if (container) {
    layoutProps.push(
      laySel('display', [
        ['block', 'Block'],
        ['flex', 'Flex'],
        ['grid', 'Grid'],
      ]),
    );
    if (display === 'flex')
      layoutProps.push(
        {
          key: 'layout.direction',
          label: LAYOUT_LABELS.direction,
          rk: [['layout', 'direction'], ['layout', 'wrap']],
          has: true,
          clear: () => {},
          row: () => (
            <PropRow key="layout.direction" label={LAYOUT_LABELS.direction} disabled={disabled}>
              <div className="dir-row">
                <Tabs
                  label={LAYOUT_LABELS.direction}
                  value={L.direction ?? 'column'}
                  options={[
                    { value: 'row', label: t('insp.dirRow'), icon: 'arrowRight' },
                    { value: 'column', label: t('insp.dirColumn'), icon: 'arrowDown' },
                  ]}
                  disabled={disabled}
                  onChange={(v) => setLayout('direction', v)}
                />
                <ToggleGroup
                  label={t('insp.flexWrap')}
                  options={[{ value: 'wrap', label: t('insp.flexWrap'), icon: 'wrap', on: !!L.wrap }]}
                  disabled={disabled}
                  onToggle={(_, on) => setLayout('wrap', on || null)}
                />
              </div>
            </PropRow>
          ),
        },
        alignTabs('justify'),
        alignTabs('align'),
        layNum('gap', { min: 0, ph: '0', pinned: true }),
      );
    if (display === 'grid') layoutProps.push(gridDef, alignTabs('justify'), alignTabs('align'), layNum('gap', { min: 0, ph: '0', pinned: true }));
  } else layoutProps.push(lay('display'), lay('direction'), lay('justify'), lay('align'), lay('gap'), lay('columns'), lay('rows'));
  layoutProps.push(spacing('padding', t('insp.padding'), container), spacing('margin', t('insp.margin')));

  const shadow = (key: 'shadow' | 'innerShadow' | 'textShadow', label: string, init: Shadow): PropDef => ({
    key,
    label,
    rk: [['style', key]],
    has: st[key] !== undefined,
    clear: () => setKey('style', key, null),
    row: (rm) => <ShadowRow key={key} label={label} value={st[key]} init={init} spread={key !== 'textShadow'} disabled={disabled} onCommit={(v) => setKey('style', key, v)} onRemove={rm} />,
  });

  const transformDef: PropDef = {
    key: 'transform',
    label: t('insp.transform'),
    rk: [['style', 'transform']],
    has: st.transform !== undefined,
    clear: () => setKey('style', 'transform', null),
    row: (rm) => <TransformRow key="transform" label={t('insp.transform')} value={st.transform} disabled={disabled} onRemove={rm} onCommit={(v) => setKey('style', 'transform', v)} />,
  };

  const normAlign = (v: string | undefined) => (v === 'start' || !v ? 'left' : v === 'end' ? 'right' : v);
  const textGroup = textual || st.fontFamily !== undefined || st.fontSize !== undefined;
  const tabsDef = (key: 'textAlign' | 'listStyle' | 'textTransform', label: string, value: string, options: Array<{ value: string; label: string; icon?: IconName; text?: string }>): PropDef => ({
    key,
    label,
    rk: [['style', key]],
    has: st[key] !== undefined && st[key] !== TEXT_DEFAULT[key],
    clear: () => setKey('style', key, null),
    row: (rm) => (
      <PropRow key={key} label={label} onRemove={rm} disabled={disabled}>
        <Tabs label={label} value={value} options={options} disabled={disabled} onChange={(v) => setKey('style', key, v)} />
      </PropRow>
    ),
  });
  const deco = st.textDecoration ?? (cs?.textDecorationLine?.includes('line-through') ? 'line-through' : cs?.textDecorationLine?.includes('underline') ? 'underline' : 'none');
  const italic = (st.fontStyle ?? cs?.fontStyle) === 'italic';
  const emphasis: PropDef = {
    key: 'emphasis',
    label: t('insp.emphasis'),
    rk: [
      ['style', 'fontStyle'],
      ['style', 'textDecoration'],
    ],
    has: (st.fontStyle !== undefined && st.fontStyle !== 'normal') || (st.textDecoration !== undefined && st.textDecoration !== 'none'),
    clear: () => commitPatch(addrs, { style: { fontStyle: null, textDecoration: null } } as NodePatch),
    row: (rm) => (
      <PropRow key="emphasis" label={t('insp.emphasis')} onRemove={rm} disabled={disabled}>
        <ToggleGroup
          label={t('insp.emphasis')}
          disabled={disabled}
          options={[
            { value: 'italic', label: t('insp.italic'), icon: 'italic', on: italic },
            { value: 'underline', label: t('insp.underline'), icon: 'underline', on: deco === 'underline' },
            { value: 'line-through', label: t('insp.strike'), icon: 'strike', on: deco === 'line-through' },
          ]}
          onToggle={(v, on) => {
            // 关闭时：本节点显式设过就移除（回到继承），否则写入 normal/none 覆盖继承值
            if (v === 'italic') setKey('style', 'fontStyle', on ? 'italic' : st.fontStyle === 'italic' && cs?.fontStyle !== 'italic' ? null : 'normal');
            else setKey('style', 'textDecoration', on ? v : st.textDecoration === v ? null : 'none');
          }}
        />
      </PropRow>
    ),
  };

  const groups: Array<{ title: string; props: PropDef[]; onAdd?: () => void }> = [];
  groups.push({
    title: t('insp.size'),
    props: [
      num('box', 'width', t('common.width'), { pinned: true, tokens: true, ph: rect ? String(Math.round(rect.width)) : 'auto' }),
      num('box', 'height', t('insp.height'), { pinned: true, tokens: true, ph: rect ? String(Math.round(rect.height)) : 'auto' }),
      num('box', 'minWidth', t('insp.minWidth'), { min: 0, tokens: true }),
      num('box', 'maxWidth', t('insp.maxWidth'), { min: 0, tokens: true }),
      num('box', 'minHeight', t('insp.minHeight'), { min: 0, tokens: true }),
      num('box', 'maxHeight', t('insp.maxHeight'), { min: 0, tokens: true }),
      {
        key: 'layout.position',
        label: LAYOUT_LABELS.position,
        rk: [['layout', 'position']],
        has: true,
        clear: () => {},
        row: () => (
          <PropRow key="layout.position" label={LAYOUT_LABELS.position} disabled={disabled}>
            <SelectInput
              label={LAYOUT_LABELS.position}
              value={L.position && L.position !== 'flow' ? L.position : ''}
              placeholder="Inline"
              options={[
                ['relative', 'Relative'],
                ['absolute', 'Absolute'],
                ['fixed', 'Fixed'],
                ['sticky', 'Sticky'],
              ]}
              disabled={disabled}
              onCommit={(v) => commitPatch(addrs, { layout: { position: v } })}
            />
          </PropRow>
        ),
      },
      ...(parentFlow
        ? [
            layNum('grow', { min: 0, unit: '', ph: '0', int: false }),
          ]
        : []),
    ],
  });
  groups.push({
    title: t('insp.layout'),
    props: layoutProps,
  });
  if (textGroup)
    groups.push({
      title: t('insp.text'),
      props: [
        {
          key: 'textStyle',
          label: t('insp.textStyle'),
          pinned: true,
          rk: [['style', 'textStyle'], ['style', 'fontSize']],
          has: st.textStyle !== undefined,
          clear: () => setKey('style', 'textStyle', null),
          row: (rm) => (
            <PropRow key="textStyle" label={t('insp.textStyle')} onRemove={rm} disabled={disabled}>
              <SelectInput
                label={t('insp.textStyle')}
                value={st.textStyle}
                options={TEXT_STYLE_OPTS}
                disabled={disabled}
                // 选样式时带出该样式的字号（优先取最接近的 size.* 令牌）
                onCommit={(v) => commitPatch(addrs, { style: v ? { textStyle: v as TextStyle, fontSize: styleFontSize(v as TextStyle, useStore.getState().doc?.tokens) } : { textStyle: null } } as NodePatch)}
              />
            </PropRow>
          ),
        },
        {
          key: 'fontFamily',
          label: t('insp.font'),
          rk: [['style', 'fontFamily']],
          has: st.fontFamily !== undefined,
          clear: () => setKey('style', 'fontFamily', null),
          row: (rm) => (
            <PropRow key="fontFamily" label={t('insp.font')} onRemove={rm} disabled={disabled}>
              <TextInput label={t('insp.font')} value={st.fontFamily} list="dm-fonts" placeholder={cs ? (firstFamily(cs.fontFamily) ?? t('insp.inherit')) : t('insp.inherit')} disabled={disabled} onCommit={(v) => setKey('style', 'fontFamily', v)} />
            </PropRow>
          ),
        },
        num('style', 'fontSize', t('insp.fontSize'), { min: 1, tokens: true, ph: px(cs?.fontSize) }),
        sel('fontWeight', t('insp.fontWeight'), WEIGHTS, { ph: cs ? t('insp.inheritWith', { v: cs.fontWeight }) : t('insp.inherit'), num: true }),
        { ...num('style', 'letterSpacing', t('insp.spacing'), { step: 0.1, ph: px(cs?.letterSpacing) || '0' }), has: st.letterSpacing !== undefined && st.letterSpacing !== 0 },
        color('style', 'color', t('insp.color')),
        tabsDef('textAlign', t('insp.textAlign'), st.textAlign ?? normAlign(cs?.textAlign), [
          { value: 'left', label: t('insp.alignLeft'), icon: 'textLeft' },
          { value: 'center', label: t('insp.alignCenter'), icon: 'textCenter' },
          { value: 'right', label: t('insp.alignRight'), icon: 'textRight' },
          { value: 'justify', label: t('insp.alignJustify'), icon: 'textJustify' },
        ]),
        emphasis,
        tabsDef('listStyle', t('insp.list'), st.listStyle ?? 'none', [
          { value: 'none', label: t('insp.listNone'), icon: 'minus' },
          { value: 'disc', label: t('insp.listBullet'), icon: 'listBullet' },
          { value: 'decimal', label: t('insp.listNumber'), icon: 'listNumber' },
        ]),
        tabsDef('textTransform', t('insp.case'), st.textTransform ?? 'none', [
          { value: 'none', label: t('insp.asIs'), icon: 'minus' },
          { value: 'uppercase', label: t('insp.upper'), text: 'AA' },
          { value: 'lowercase', label: t('insp.lower'), text: 'aa' },
          { value: 'capitalize', label: t('insp.capitalize'), text: 'Aa' },
        ]),
        num('style', 'lineHeight', t('insp.lineHeight'), { step: 0.05, unit: '', ph: cs?.lineHeight === 'normal' ? t('insp.auto') : px(cs?.lineHeight) }),
        sel('whiteSpace', t('insp.wrap'), [
          ['normal', t('insp.wrapNormal')],
          ['nowrap', t('insp.nowrap')],
          ['pre-wrap', t('insp.preWrap')],
        ]),
      ],
    });
  groups.push({
    title: t('insp.appearance'),
    props: [
      {
        key: 'background',
        label: t('insp.background'),
        rk: [['style', 'background'], ['style', 'backgroundImage'], ['style', 'backgroundSize']],
        has: st.background !== undefined || st.backgroundImage !== undefined || st.backgroundSize !== undefined,
        pinned: container && !textual,
        clear: () => commitPatch(addrs, { style: { background: null, backgroundImage: null, backgroundSize: null } } as NodePatch),
        row: (rm) => <BackgroundRow key="bg" label={t('insp.background')} style={st} disabled={disabled} onRemove={rm} onPatch={(p) => commitPatch(addrs, { style: p } as NodePatch)} />,
      },
      num('style', 'opacity', t('insp.opacity'), { min: 0, max: 100, unit: '%', scale: 100, ph: '100' }),
      {
        key: 'radius',
        label: t('insp.radius'),
        rk: [['box', 'radius']],
        has: bx.radius !== undefined,
        clear: () => setKey('box', 'radius', null),
        row: (rm) => <SpacingRow key="rad" label={t('insp.radius')} value={bx.radius} min={0} corners disabled={disabled} placeholder={[cs?.borderTopLeftRadius, cs?.borderTopRightRadius, cs?.borderBottomRightRadius, cs?.borderBottomLeftRadius].map((r) => px(r) || '0') as [string, string, string, string]} onCommit={(v) => setKey('box', 'radius', v)} onRemove={rm} />,
      },
      {
        key: 'border.style',
        label: t('insp.borderLine'),
        rk: [['box', 'border']],
        has: bx.border !== undefined,
        clear: () => setKey('box', 'border', null),
        row: (rm) => (
          <PropRow key="bs" label={t('insp.borderLine')} onRemove={rm} disabled={disabled}>
            <Tabs
              label={t('insp.borderLine')}
              value={bx.border ? (bx.border.style ?? 'solid') : ''}
              options={[
                { value: 'solid', label: t('insp.solid'), icon: 'lineSolid' },
                { value: 'dashed', label: t('insp.dashed'), icon: 'lineDashed' },
                { value: 'dotted', label: t('insp.dotted'), icon: 'lineDotted' },
                { value: 'none', label: t('common.none'), icon: 'ban' },
              ]}
              disabled={disabled}
              onChange={(v) => setBorder('style', v || null)}
            />
          </PropRow>
        ),
      },
      // 宽度与颜色只在设置了可见线型后出现
      ...(bx.border && bx.border.style !== 'none'
        ? [
            {
              key: 'border.width',
              label: t('insp.borderWidth'),
              rk: [['box', 'border', 'width']],
              has: bx.border.width !== undefined,
              pinned: true,
              clear: () => setBorder('width', null),
              row: (rm) => (
                <SpacingRow
                  key="bw"
                  label={t('insp.borderWidth')}
                  value={borderWidths(bx.border)}
                  min={0}
                  placeholder="1"
                  fill={1}
                  disabled={disabled}
                  // 按边设置后由 width 数组表达，旧的 sides 一并去掉
                  onCommit={(v) => (bx.border?.sides ? commitPatch(addrs, (a) => ({ box: { border: { ...effective(doc, a)?.node.box?.border, width: v ?? undefined, sides: undefined } } })) : setBorder('width', v))}
                  onRemove={rm}
                />
              ),
            } as PropDef,
            { ...color('border', 'color', t('insp.borderColor')), pinned: true },
          ]
        : []),
      ...(textGroup
        ? []
        : [
            sel('textDecoration', t('insp.decoration'), [
              ['none', t('common.none')],
              ['underline', t('insp.underline')],
              ['line-through', t('insp.strike')],
            ]),
          ]),
      ...(kind === 'image'
        ? [
            sel(
              'objectFit',
              t('insp.objectFit'),
              [
                ['cover', t('insp.cover')],
                ['contain', t('insp.contain')],
                ['fill', t('insp.stretch')],
              ],
              { pinned: true },
            ),
          ]
        : []),
    ],
  });
  groups.push({
    title: t('insp.effects'),
    props: [
      shadow('shadow', t('insp.dropShadow'), { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.12)' }),
      shadow('innerShadow', t('insp.innerShadow'), { x: 0, y: 2, blur: 4, spread: 0, color: 'rgba(0,0,0,0.15)' }),
      num('style', 'blur', t('insp.layerBlur'), { min: 0, ph: '0' }),
      num('style', 'backdropBlur', t('insp.backdropBlur'), { min: 0, ph: '0' }),
      shadow('textShadow', t('insp.textShadow'), { x: 0, y: 1, blur: 2, spread: 0, color: 'rgba(0,0,0,0.25)' }),
      transformDef,
    ],
  });
  // 高级：自定义 CSS。AI 写的 style.cursor 与只有 AI 能写的布局字段（LAYOUT_CSS）也并入这里，编辑后迁到 style.css
  const ownLayout = n.layout ?? {};
  const legacyLayout = multi ? [] : LAYOUT_CSS_KEYS.filter((k) => ownLayout[k] !== undefined);
  const legacy: Array<[string, string]> = [...(st.cursor !== undefined ? [['cursor', st.cursor] as [string, string]] : []), ...legacyLayout.map((k) => [LAYOUT_CSS[k], layoutCssValue(k, ownLayout[k])] as [string, string])];
  const dropLegacy = (): NodePatch => ({
    ...(st.cursor !== undefined ? { style: { cursor: null } } : {}),
    ...(legacyLayout.length ? { layout: Object.fromEntries(legacyLayout.map((k) => [k, null])) } : {}),
  });
  const cssHas = st.css !== undefined || legacy.length > 0;
  const cssVisible = cssHas || extras.has('style.css') || shown.current.has('style.css');
  groups.push({
    title: t('insp.advanced'),
    onAdd: () => (cssVisible && !removing.current.has('style.css') ? setCssAdd((n) => n + 1) : addExtra('style.css')),
    props: [
      {
        key: 'style.css',
        label: t('insp.customCss'),
        rk: [['style', 'css'], ['style', 'cursor'], ...legacyLayout.map((k) => ['layout', k] as RK)],
        has: cssHas,
        clear: () => {
          const d = dropLegacy();
          commitPatch(addrs, { ...d, style: { ...d.style, css: null } } as NodePatch);
        },
        row: (rm) => (
          <CustomCssRows
            key={`css:${selection.join(',')}`}
            addTick={cssAdd}
            css={st.css}
            legacy={legacy}
            disabled={disabled}
            onRemove={rm}
            onCommit={(v) => {
              const d = dropLegacy();
              commitPatch(addrs, { ...d, style: { ...d.style, css: v } } as NodePatch);
            }}
          />
        ),
      },
    ],
  });

  const fam = firstFamily(st.fontFamily, useStore.getState().doc?.tokens);
  const missingFont = fam && !fontAvailable(fam);
  const comp = first.component;

  return (
    <div className={`inspector ${disabled ? 'locked' : ''}`}>
      <TokenList id="dm-tokens" />
      <datalist id="dm-fonts">
        {useStore.getState().fonts.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <div className="insp-head">
        <span className="insp-name">{multi ? t('insp.selected', { n: items.length }) : isFrame ? (doc.frames.find((f) => f.id === selection[0])?.name ?? n.type) : (n.name ?? n.type)}</span>
        {!multi && <span className="tag">{isFrame ? t('insp.boardTag', { w: String(doc.frames.find((f) => f.id === selection[0])?.width) }) : n.type}</span>}
        {comp && (
          <span className="tag comp" title={t('insp.compTip', { name: comp, n: instanceCount(doc, comp) })}>
            <Icon name="component" size={11} /> {comp}
          </span>
        )}
        <span className="spacer" />
        {!multi && (
          <button className="icon-btn sm" aria-label={t('insp.copyId')} title={t('insp.copyIdTip', { id: selection[0] })} onClick={() => copy(selection[0])}>
            <Icon name="copy" size={14} />
          </button>
        )}
      </div>
      {disabled && <div className="insp-lock">{t('insp.locked')}</div>}
      {missingFont && <div className="insp-warn">{t('insp.missingFont', { font: String(fam) })}</div>}

      {groups.map((g) => {
        for (const p of g.props) if (!p.has) removing.current.delete(p.key);
        const visible = g.props.filter((p) => !removing.current.has(p.key) && (p.has || (!p.ro && (p.pinned || extras.has(p.key) || shown.current.has(p.key)))));
        for (const p of visible) shown.current.add(p.key);
        const addable = g.props.filter((p) => !p.ro && !visible.includes(p));
        if (!visible.length && !addable.length) return null;
        return (
          <Section key={g.title} title={g.title} onAdd={disabled ? undefined : g.onAdd} add={disabled ? undefined : addable.map((p) => ({ key: p.key, label: p.label, onAdd: () => addExtra(p.key) }))}>
            {visible.map((p) => (
              <ResetCtx.Provider key={p.key} value={p.ro ? undefined : resetFor(p.rk)}>
                {p.row(
                  p.ro || (!p.has && p.pinned)
                    ? undefined
                    : p.has
                      ? () => {
                          p.clear();
                          dropExtra(p.key);
                        }
                      : () => dropExtra(p.key),
                )}
              </ResetCtx.Provider>
            ))}
          </Section>
        );
      })}

      {!multi && <ContentSection node={n} kind={kind} addrs={addrs} disabled={disabled} setKey={setKey} reset={resetFor} />}
      {items.every((i) => isButton(i.eff!.node)) && (
        <Section title={t('insp.control')}>
          <ResetCtx.Provider value={resetFor([['props', 'buttonType']])}>
            <PropRow label={t('insp.buttonType')}>
              <SelectInput
                label={t('insp.buttonType')}
                value={items.every((i) => i.eff!.node.props?.buttonType === n.props?.buttonType) ? (n.props?.buttonType ?? 'button') : ''}
                options={[['button', 'Button'], ['submit', 'Submit'], ['reset', 'Reset']]}
                placeholder={multi ? t('insp.mixed') : null}
                disabled={disabled}
                onCommit={(v) => v && setKey('props', 'buttonType', v)}
              />
            </PropRow>
          </ResetCtx.Provider>
        </Section>
      )}
    </div>
  );
}

function copy(s: string) {
  navigator.clipboard?.writeText(s).then(
    () => toast(t('insp.copied', { s }), 'info'),
    () => toast(t('insp.copyFailed')),
  );
}

function ShadowRow({ label, value, init, spread, disabled, onCommit, onRemove }: { label: string; value: string | undefined; init: Shadow; spread: boolean; disabled: boolean; onCommit: (v: string | null) => void; onRemove?: () => void }) {
  const [open, setOpen] = useState(false);
  const sh = parseShadow(value);
  if (value !== undefined && !sh)
    return (
      <PropRow label={label} onRemove={onRemove} disabled={disabled}>
        <TextInput label={label} value={value} disabled={disabled} onCommit={onCommit} />
      </PropRow>
    );
  const cur: Shadow = sh ?? init;
  const set = (k: keyof Shadow, v: unknown) => onCommit(shadowStr({ ...cur, [k]: k === 'color' ? String(v ?? '#000000') : Number(v) || 0 }));
  return (
    <>
      <PropRow label={label} onRemove={onRemove} disabled={disabled}>
        <button className={`pfield shadow ${open ? 'on' : ''}`} aria-expanded={open} disabled={disabled} onClick={() => (value === undefined ? onCommit(shadowStr(cur)) : setOpen(!open))}>
          <span className="swatch" style={{ background: cur.color }} />
          <span className="ellipsis">{value === undefined ? t('insp.addEffect') : `${cur.x}, ${cur.y} · ${cur.blur}px`}</span>
        </button>
      </PropRow>
      {open && sh && (
        <div className="popover-inline">
          <ResetCtx.Provider value={undefined}>
          <div className="pop-title">{label}</div>
          <NumRow label="X" value={sh.x} disabled={disabled} min={-200} max={200} onCommit={(v) => set('x', v)} />
          <NumRow label="Y" value={sh.y} disabled={disabled} min={-200} max={200} onCommit={(v) => set('y', v)} />
          <NumRow label={t('insp.blur')} value={sh.blur} disabled={disabled} min={0} max={400} onCommit={(v) => set('blur', v)} />
          {spread && <NumRow label={t('insp.spread')} value={sh.spread} disabled={disabled} min={-200} max={200} onCommit={(v) => set('spread', v)} />}
          <PropRow label={t('insp.color')}>
            <ColorInput label={t('insp.shadowColor')} value={sh.color} disabled={disabled} onCommit={(v) => set('color', v)} />
          </PropRow>
          </ResetCtx.Provider>
        </div>
      )}
    </>
  );
}

function ImagePick({ value, onPick, disabled }: { value: string | undefined; onPick: (src: string | null) => void; disabled: boolean }) {
  const doc = useStore((s) => s.doc);
  const canvasId = useStore((s) => s.canvasId);
  const hash = /^asset:([a-f0-9]+)$/.exec(value ?? '')?.[1];
  const a = hash ? doc?.assets[hash] : undefined;
  const upload = async (file: File) => {
    try {
      onPick(await uploadImage(canvasId!, file));
    } catch (e) {
      toast(t('insp.uploadFailed', { msg: (e as Error).message }));
    }
  };
  return (
    <label className={`pfield image ${disabled ? 'disabled' : ''}`}>
      {a ? <img src={`/c/${canvasId}/assets/${a.file}`} alt="" /> : <span className="swatch empty" />}
      <span className="ellipsis">{a ? (a.source?.split('/').pop() ?? t('insp.image')) : t('insp.upload')}</span>
      <input type="file" accept="image/*" hidden disabled={disabled} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
    </label>
  );
}

const LAYOUT_LABELS: Record<string, string> = {
  display: t('layout.display'),
  direction: t('layout.direction'),
  wrap: t('insp.wrap'),
  justify: t('layout.justify'),
  align: t('layout.align'),
  gap: t('layout.gap'),
  rowGap: t('layout.rowGap'),
  columns: t('layout.columns'),
  rows: t('layout.rows'),
  grow: t('layout.grow'),
  shrink: t('layout.shrink'),
  basis: t('layout.basis'),
  alignSelf: t('layout.alignSelf'),
  position: t('layout.position'),
  top: t('layout.top'),
  right: t('layout.right'),
  bottom: t('layout.bottom'),
  left: t('layout.left'),
  zIndex: t('layout.zIndex'),
  overflow: t('layout.overflow'),
};

function ContentSection({ node, kind, addrs, disabled, setKey, reset }: { node: Node; kind: string; addrs: string[]; disabled: boolean; setKey: (f: 'props', k: string, v: unknown) => void; reset: (rk: RK[]) => (() => void) | undefined }) {
  const rows: React.ReactNode[] = [];
  const R = (k: string, rk: RK[], el: React.ReactNode) => (
    <ResetCtx.Provider key={k} value={reset(rk)}>
      {el}
    </ResetCtx.Provider>
  );
  if (kind === 'text')
    rows.push(
      R('text', [['text']], <PropRow key="text" label={t('insp.text')}>
        <TextInput label={t('insp.text')} multiline value={node.text} disabled={disabled} onCommit={(v) => commitPatch(addrs, { text: v ?? '' })} />
      </PropRow>),
    );
  if (kind === 'image')
    rows.push(
      R('src', [['props', 'src']], <PropRow key="src" label={t('insp.image')}>
        <ImagePick value={node.props?.src} onPick={(src) => setKey('props', 'src', src)} disabled={disabled} />
      </PropRow>),
      R('alt', [['props', 'alt']], <PropRow key="alt" label={t('insp.alt')}>
        <TextInput label={t('insp.alt')} value={node.props?.alt} disabled={disabled} onCommit={(v) => setKey('props', 'alt', v)} />
      </PropRow>),
    );
  if (kind === 'input')
    rows.push(
      R('ph', [['props', 'placeholder']], <PropRow key="ph" label={t('insp.placeholder')}>
        <TextInput label={t('insp.placeholder')} value={node.props?.placeholder} disabled={disabled} onCommit={(v) => setKey('props', 'placeholder', v)} />
      </PropRow>),
      R('val', [['text'], ['props', 'value']], <PropRow key="val" label={t('insp.value')}>
        <TextInput label={t('insp.value')} value={node.text ?? node.props?.value} disabled={disabled} onCommit={(v) => commitPatch(addrs, { text: v })} />
      </PropRow>),
    );
  if (node.props?.icon !== undefined)
    rows.push(
      R('icon', [['props', 'icon']], <PropRow key="icon" label={t('insp.icon')}>
        <TextInput label={t('insp.icon')} value={node.props.icon} disabled={disabled} onCommit={(v) => setKey('props', 'icon', v)} />
      </PropRow>),
    );
  if (!rows.length) return null;
  return <Section title={t('insp.content')}>{rows}</Section>;
}

function TokensSection({ disabled }: { disabled: boolean }) {
  const tokens = useStore((s) => s.doc?.tokens ?? EMPTY_TOKENS);
  useStore((s) => s.version);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const set = (k: string, v: string | null) => commitOps([{ op: 'set_tokens', tokens: { [k]: v } }]);
  const valid = /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(name);
  return (
    <Section title={t('tokens.title', { n: Object.keys(tokens).length })} add={disabled ? undefined : [{ key: 'new', label: t('tokens.new'), onAdd: () => setAdding(true) }]}>
      {Object.entries(tokens).map(([k, v]) => (
        <PropRow key={k} label={k} title={`{${k}}`} onRemove={disabled ? undefined : () => set(k, null)} disabled={disabled}>
          {/color|colour|bg|fg/i.test(k) || /^#|^rgb|^hsl/i.test(v) ? (
            <ColorInput label={k} value={v} disabled={disabled} onCommit={(nv) => nv && set(k, nv)} />
          ) : (
            <TextInput label={k} value={v} disabled={disabled} onCommit={(nv) => nv && set(k, nv)} />
          )}
        </PropRow>
      ))}
      {adding && (
        <div className="prow">
          <label className="pfield" style={{ gridColumn: '1 / 3' }}>
            <input
              autoFocus
              aria-label={t('tokens.newName')}
              placeholder={t('tokens.ph')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid) {
                  set(name, '#000000');
                  setName('');
                  setAdding(false);
                }
                if (e.key === 'Escape') setAdding(false);
              }}
            />
          </label>
          <button className="icon-btn sm" aria-label={t('common.cancel')} onClick={() => setAdding(false)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      <div className="psec-hint">{t('tokens.hint')}</div>
    </Section>
  );
}
