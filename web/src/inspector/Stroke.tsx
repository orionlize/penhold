// 铅笔 / 钢笔笔触样式：颜色、粗细、线型。工具栏子菜单与选中笔迹的样式面板共用。
import type { StrokeDash } from '../../../src/core/types';
import { PEN_WIDTHS } from '../store';
import { t } from '../i18n';

/** 可选颜色；undefined 为默认的批注红（随主题变化）。 */
export const PEN_COLORS: Array<string | undefined> = [undefined, '#f97316', '#eab308', '#16a34a', '#2563eb', '#9333ea', '#71717a'];
const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];

export interface StrokeStyle {
  width: number;
  dash: StrokeDash;
  color?: string;
}

/** 线型对应的 stroke-dasharray（配合圆头端点，点线的点直径等于线宽）。 */
export function dashArray(dash: StrokeDash | undefined, w: number) {
  if (dash === 'dashed') return `${w * 2.5} ${w * 2.5}`;
  if (dash === 'dotted') return `0 ${w * 2}`;
  return undefined;
}

export function StrokeControls({ value, onChange }: { value: StrokeStyle; onChange: (p: Partial<StrokeStyle>) => void }) {
  const ink = value.color ?? 'var(--markup)';
  const sample = (w: number, dash: StrokeDash) => (
    <svg width="44" height="14" viewBox="0 0 44 14" aria-hidden="true">
      <line x1={w / 2 + 2} y1="7" x2={42 - w / 2} y2="7" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeDasharray={dashArray(dash, w)} />
    </svg>
  );
  return (
    <>
      <ColorControls color={value.color} onChange={(color) => onChange({ color })} />
      <div className="fly-label">{t('pen.width')}</div>
      <div className="pen-row" role="radiogroup" aria-label={t('pen.width')}>
        {PEN_WIDTHS.map((w) => (
          <button key={w} role="radio" aria-checked={value.width === w} aria-label={t('pen.widthN', { n: w })} className={value.width === w ? 'on' : ''} title={t('pen.widthN', { n: w })} onClick={() => onChange({ width: w })}>
            <span className="pen-dot" style={{ width: w + 2, height: w + 2, background: ink }} />
          </button>
        ))}
      </div>
      <div className="fly-label">{t('pen.style')}</div>
      {DASHES.map((d) => (
        <button key={d} role="radio" aria-checked={value.dash === d} className={value.dash === d ? 'on' : ''} onClick={() => onChange({ dash: d })}>
          {sample(Math.max(2, value.width), d)}
          <span>{t(`pen.${d}`)}</span>
        </button>
      ))}
    </>
  );
}

/** 颜色选择行：笔触与形状填充共用。 */
export function ColorControls({ color, onChange }: { color?: string; onChange: (c: string | undefined) => void }) {
  return (
    <>
      <div className="fly-label">{t('pen.color')}</div>
      <div className="pen-row pen-colors" role="radiogroup" aria-label={t('pen.color')}>
        {PEN_COLORS.map((c) => (
          <button key={c ?? 'default'} role="radio" aria-checked={color === c} aria-label={c ?? t('pen.colorDefault')} className={color === c ? 'on' : ''} title={c ?? t('pen.colorDefault')} onClick={() => onChange(c)}>
            <span className="pen-swatch" style={{ background: c ?? 'var(--markup)' }} />
          </button>
        ))}
      </div>
    </>
  );
}
