// CSS transform 的结构化表示：按顺序排列的变换函数列表（位移 / 旋转 / 缩放 / 倾斜），可逐项选择类型并填写。
// 只处理二维的这四类函数；matrix、3D、calc 等写法解析失败（返回 null），由界面退回原始文本编辑。

export type TransformKind = 'translate' | 'rotate' | 'scale' | 'skew';
/** 位移量：数字为 px，字符串为带单位的长度（如 "50%"、"1rem"）。 */
export type TLen = number | string;

/** 一个变换函数。translate：x/y 为长度；rotate：x 为角度（deg），y 不用；scale：倍数；skew：角度（deg）。 */
export interface TransformOp {
  fn: TransformKind;
  x: TLen;
  y: TLen;
}

export const TRANSFORM_KINDS: TransformKind[] = ['translate', 'rotate', 'scale', 'skew'];

export const defaultOp = (fn: TransformKind): TransformOp => (fn === 'scale' ? { fn, x: 1, y: 1 } : { fn, x: 0, y: 0 });

const round = (n: number) => Math.round(n * 1000) / 1000;

function angle(s: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!m[2] && n !== 0) return undefined; // 角度必须带单位（0 除外）
  const k = m[2] ?? 'deg';
  return round(k === 'turn' ? n * 360 : k === 'rad' ? (n * 180) / Math.PI : k === 'grad' ? n * 0.9 : n);
}

/** 解析长度：px 与无单位的 0 → 数字，其余支持的单位保留为字符串。 */
export function parseTLen(s: string): TLen | undefined {
  const m = /^(-?\d*\.?\d+)(px|%|rem|em|vw|vh)?$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!m[2]) return n === 0 ? 0 : undefined;
  return m[2] === 'px' ? n : `${n}${m[2]}`;
}

function factor(s: string): number | undefined {
  const m = /^(-?\d*\.?\d+)(%)?$/.exec(s.trim());
  if (!m) return undefined;
  return round(m[2] ? Number(m[1]) / 100 : Number(m[1]));
}

export function parseTransform(v: string | undefined): TransformOp[] | null {
  const out: TransformOp[] = [];
  if (!v || !v.trim() || v.trim() === 'none') return out;
  const re = /\s*([a-zA-Z]+)\(([^()]*)\)\s*/y;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(v))) {
    last = re.lastIndex;
    const name = m[1].toLowerCase();
    const args = m[2].split(',').map((s) => s.trim());
    const base = name.replace(/[xyz]$/, '') as TransformKind;
    const axis = name.length > base.length ? name.slice(-1) : '';
    if (!TRANSFORM_KINDS.includes(base) || (base === 'rotate' ? axis && axis !== 'z' : axis === 'z')) return null;
    const p = base === 'translate' ? parseTLen : base === 'scale' ? factor : angle;
    if (args.length > (axis || base === 'rotate' ? 1 : 2)) return null;
    const a = p(args[0]);
    if (a === undefined) return null;
    const op = defaultOp(base);
    if (base === 'rotate') op.x = a;
    else if (axis === 'x') op.x = a;
    else if (axis === 'y') op.y = a;
    else {
      const b = args[1] === undefined ? (base === 'scale' ? a : 0) : p(args[1]);
      if (b === undefined) return null;
      op.x = a;
      op.y = b;
    }
    out.push(op);
  }
  return last === v.length ? out : null;
}

const lenCss = (l: TLen) => (typeof l === 'number' ? (l === 0 ? '0' : `${l}px`) : l);

export function opCss(o: TransformOp): string {
  if (o.fn === 'translate') return `translate(${lenCss(o.x)}, ${lenCss(o.y)})`;
  if (o.fn === 'rotate') return `rotate(${o.x}deg)`;
  if (o.fn === 'scale') return o.x === o.y ? `scale(${o.x})` : `scale(${o.x}, ${o.y})`;
  return `skew(${o.x}deg, ${o.y}deg)`;
}

/** 序列化；空列表返回 null（即清除 transform）。 */
export function transformCss(ops: TransformOp[]): string | null {
  return ops.length ? ops.map(opCss).join(' ') : null;
}
