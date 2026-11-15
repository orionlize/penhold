// 变换字段：一行触发器（概要）+ 浮窗。浮窗里按顺序列出变换函数，每项选择类型（位移 / 旋转 / 缩放 / 倾斜）并填写数值。
// 无法拆分的写法（matrix、3D 等）在浮窗里按原始 CSS 编辑。
import { useRef, useState } from 'react';
import { TRANSFORM_KINDS, defaultOp, parseTLen, parseTransform, transformCss, type TransformKind, type TransformOp } from '../../src/core/transform';
import type { Len } from '../../src/core/types';
import { LenField, PropRow, Select, TextInput, fmt } from './fields';
import { FloatPanel } from './FloatPanel';
import { Icon } from './icons';
import { toast } from './store';
import { t } from './i18n';

const KIND_LABEL: Record<TransformKind, () => string> = {
  translate: () => t('insp.translate'),
  rotate: () => t('insp.rotate'),
  scale: () => t('insp.scale'),
  skew: () => t('insp.skew'),
};

const unitOf = (fn: TransformKind) => (fn === 'translate' ? 'px' : fn === 'scale' ? undefined : '°');

/** 概要：如 “位移 12, 0 · 旋转 8°”。 */
function summary(ops: TransformOp[]): string {
  return ops
    .map((o) => {
      const u = unitOf(o.fn) === '°' ? '°' : '';
      const v = o.fn === 'rotate' ? `${o.x}${u}` : o.fn === 'scale' && o.x === o.y ? `${o.x}` : `${fmt(o.x)}${u}, ${fmt(o.y)}${u}`;
      return `${KIND_LABEL[o.fn]()} ${v}`;
    })
    .join(' · ');
}

export function TransformRow({ label, value, onCommit, onRemove, disabled }: { label: string; value: string | undefined; onCommit: (v: string | null) => void; onRemove?: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLButtonElement>(null);
  const ops = parseTransform(value);
  const text = !value ? t('common.none') : ops ? summary(ops) : value;
  return (
    <PropRow label={label} onRemove={onRemove} disabled={disabled}>
      <button ref={field} type="button" className={`pfield bg-trigger ${open ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={label} disabled={disabled} onClick={() => setOpen(!open)}>
        <span className="tf-icon">
          <Icon name="move" size={14} />
        </span>
        <span className={`ellipsis ${value ? '' : 'muted'}`}>{text}</span>
        <span className="pfield-chevron">
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open && field.current && (
        <FloatPanel anchor={field.current} label={label} onClose={() => setOpen(false)}>
          <TransformEditor label={label} value={value} ops={ops} onCommit={onCommit} onClose={() => setOpen(false)} disabled={disabled} />
        </FloatPanel>
      )}
    </PropRow>
  );
}

function TransformEditor({ label, value, ops, onCommit, onClose, disabled }: { label: string; value: string | undefined; ops: TransformOp[] | null; onCommit: (v: string | null) => void; onClose: () => void; disabled?: boolean }) {
  const put = (next: TransformOp[]) => onCommit(transformCss(next));
  const list = ops ?? [];
  const setOp = (i: number, o: TransformOp) => put(list.map((x, j) => (j === i ? o : x)));
  const add = () => {
    // 新增一项：优先选列表里还没有的类型
    const fn = TRANSFORM_KINDS.find((k) => !list.some((o) => o.fn === k)) ?? 'translate';
    put([...list, defaultOp(fn)]);
  };
  const num = (v: Len | null, fb: number) => {
    const n = v === null ? fb : typeof v === 'number' ? v : Number.parseFloat(v);
    return Number.isFinite(n) ? n : fb;
  };
  const setAxis = (i: number, axis: 'x' | 'y', v: Len | null) => {
    const o = list[i];
    if (o.fn === 'translate') {
      const l = v === null ? 0 : typeof v === 'number' ? v : parseTLen(v);
      if (l === undefined) return toast(t('insp.transformBadLen'));
      return setOp(i, { ...o, [axis]: l });
    }
    setOp(i, { ...o, [axis]: num(v, o.fn === 'scale' ? 1 : 0) });
  };

  return (
    <>
      <div className="bg-pop-head tf-head">
        <span className="tf-title">{label}</span>
        <button type="button" className="icon-btn sm" aria-label={t('insp.addTransform')} title={t('insp.addTransform')} disabled={disabled || !ops} onClick={add}>
          <Icon name="plus" size={14} />
        </button>
        <button type="button" className="icon-btn sm" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {!ops ? (
        <>
          <div className="bg-note">{t('insp.transformRaw')}</div>
          <PropRow label="CSS">
            <TextInput label={label} value={value} multiline disabled={disabled} onCommit={onCommit} />
          </PropRow>
        </>
      ) : !list.length ? (
        <button type="button" className="tf-empty" disabled={disabled} onClick={add}>
          <Icon name="plus" size={14} />
          {t('insp.addTransform')}
        </button>
      ) : (
        list.map((o, i) => (
          <div key={i} className={`tf-op ${o.fn === 'rotate' ? 'single' : ''}`}>
            <Select
              label={`${label} ${i + 1}`}
              value={o.fn}
              disabled={disabled}
              options={TRANSFORM_KINDS.map((k) => [k, KIND_LABEL[k]()] as [string, string])}
              onChange={(v) => v !== o.fn && setOp(i, defaultOp(v as TransformKind))}
            />
            {o.fn === 'rotate' ? (
              <LenField label={`${KIND_LABEL[o.fn]()} ${i + 1}`} value={o.x} unit="°" placeholder="0" disabled={disabled} onCommit={(v) => setAxis(i, 'x', v)} />
            ) : (
              (['x', 'y'] as const).map((axis) => (
                <LenField
                  key={axis}
                  label={`${KIND_LABEL[o.fn]()} ${i + 1} ${axis.toUpperCase()}`}
                  prefix={axis.toUpperCase()}
                  value={o[axis]}
                  unit={unitOf(o.fn)}
                  step={o.fn === 'scale' ? 0.1 : 1}
                  placeholder={o.fn === 'scale' ? '1' : '0'}
                  disabled={disabled}
                  onCommit={(v) => setAxis(i, axis, v)}
                />
              ))
            )}
            <button type="button" className="icon-btn sm" aria-label={`${t('insp.removeTransform')} ${i + 1}`} title={t('insp.removeTransform')} disabled={disabled} onClick={() => put(list.filter((_, j) => j !== i))}>
              <Icon name="minus" size={14} />
            </button>
          </div>
        ))
      )}
      {ops && list.length > 1 && <div className="bg-note">{t('insp.transformOrder')}</div>}
    </>
  );
}
