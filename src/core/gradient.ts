// CSS 渐变的结构化表示：把 linear/radial/conic-gradient(...) 拆成可逐项编辑的字段。

export type GradientType = 'linear' | 'radial' | 'conic';
export type RadialShape = 'ellipse' | 'circle';
export type RadialSize = 'farthest-corner' | 'farthest-side' | 'closest-corner' | 'closest-side';

export interface GradientStop {
  color: string;
  /** 位置（%）；linear/radial 为长度百分比，conic 为角度百分比。 */
  pos: number;
}

export interface Gradient {
  type: GradientType;
  repeating: boolean;
  /** linear：方向角；conic：起始角（from）。单位 deg。 */
  angle: number;
  shape: RadialShape;
  size: RadialSize;
  /** radial / conic 的中心点（%）。 */
  x: number;
  y: number;
  stops: GradientStop[];
}

export const GRADIENT_RE = /^\s*(repeating-)?(linear|radial|conic)-gradient\(/i;

export const defaultGradient = (from = '#000000', to = '#FFFFFF'): Gradient => ({
  type: 'linear',
  repeating: false,
  angle: 180,
  shape: 'ellipse',
  size: 'farthest-corner',
  x: 50,
  y: 50,
  stops: [
    { color: from, pos: 0 },
    { color: to, pos: 100 },
  ],
});

/** 按顶层逗号拆分（忽略括号里的逗号，如 rgba(…)）。 */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const SIDES: Record<string, number> = {
  top: 0,
  'top right': 45,
  'right top': 45,
  right: 90,
  'bottom right': 135,
  'right bottom': 135,
  bottom: 180,
  'bottom left': 225,
  'left bottom': 225,
  left: 270,
  'top left': 315,
  'left top': 315,
};

function angleOf(s: string): number | undefined {
  const m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const k = m[2] ?? 'deg';
  return Math.round((k === 'turn' ? n * 360 : k === 'rad' ? (n * 180) / Math.PI : k === 'grad' ? n * 0.9 : n) * 100) / 100;
}

const KEYWORD_POS: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

/** 解析 `at x y`：支持百分比与关键字。 */
function parseAt(s: string): { x: number; y: number } | undefined {
  const parts = s.trim().split(/\s+/);
  if (!parts.length || parts.length > 2) return undefined;
  const val = (p: string) => (p in KEYWORD_POS ? KEYWORD_POS[p] : /^-?[\d.]+%$/.test(p) ? Number(p.slice(0, -1)) : undefined);
  let [a, b] = parts;
  if (b === undefined) b = 'center';
  // 关键字顺序可以是 "top left"
  if (a === 'top' || a === 'bottom') [a, b] = [b, a];
  const x = val(a);
  const y = val(b);
  return x === undefined || y === undefined ? undefined : { x, y };
}

/** 解析色标：`<color> [<pos>%]`；返回 pos 为 undefined 时稍后均匀补齐。 */
function parseStop(s: string): { color: string; pos?: number } | undefined {
  const m = /^(.*?)\s+(-?[\d.]+)(%|deg)?$/.exec(s);
  if (m && m[1] && !/[(,]$/.test(m[1])) {
    const n = Number(m[2]);
    if (m[3] === '%') return { color: m[1].trim(), pos: n };
    if (m[3] === 'deg') return { color: m[1].trim(), pos: Math.round((n / 360) * 10000) / 100 };
  }
  if (/\s/.test(s.replace(/\([^)]*\)/g, ''))) return undefined; // 双位置或长度单位等不支持的写法
  return s ? { color: s } : undefined;
}

export function parseGradient(v: string | undefined): Gradient | null {
  if (!v) return null;
  const m = /^\s*(repeating-)?(linear|radial|conic)-gradient\((.*)\)\s*$/is.exec(v);
  if (!m) return null;
  const g = defaultGradient();
  g.repeating = !!m[1];
  g.type = m[2].toLowerCase() as GradientType;
  const args = splitTop(m[3]);
  if (!args.length) return null;
  const head = args[0].toLowerCase();
  let first = 0;
  if (g.type === 'linear') {
    if (head.startsWith('to ')) {
      const a = SIDES[head.slice(3).trim()];
      if (a === undefined) return null;
      g.angle = a;
      first = 1;
    } else if (angleOf(head) !== undefined) {
      g.angle = angleOf(head)!;
      first = 1;
    }
  } else if (g.type === 'radial') {
    if (/\b(circle|ellipse|closest|farthest|at)\b/.test(head)) {
      const [shapeSize, at] = head.split(/\bat\b/);
      for (const w of shapeSize.trim().split(/\s+/).filter(Boolean)) {
        if (w === 'circle' || w === 'ellipse') g.shape = w;
        else if (/^(closest|farthest)-(side|corner)$/.test(w)) g.size = w as RadialSize;
        else return null;
      }
      if (at !== undefined) {
        const p = parseAt(at);
        if (!p) return null;
        Object.assign(g, p);
      }
      first = 1;
    }
  } else {
    if (/^(from|at)\b/.test(head)) {
      const fm = /^from\s+(\S+)/.exec(head);
      if (fm) {
        const a = angleOf(fm[1]);
        if (a === undefined) return null;
        g.angle = a;
      } else g.angle = 0;
      const at = /\bat\s+(.+)$/.exec(head);
      if (at) {
        const p = parseAt(at[1]);
        if (!p) return null;
        Object.assign(g, p);
      }
      first = 1;
    } else g.angle = 0;
  }
  const raw = args.slice(first).map(parseStop);
  if (raw.length < 2 || raw.some((s) => !s)) return null;
  const stops = raw as Array<{ color: string; pos?: number }>;
  // 缺省位置：首尾为 0 / 100，中间在相邻已知位置间均分（与 CSS 规则一致）
  if (stops[0].pos === undefined) stops[0].pos = 0;
  if (stops[stops.length - 1].pos === undefined) stops[stops.length - 1].pos = 100;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].pos !== undefined) continue;
    let j = i;
    while (stops[j].pos === undefined) j++;
    const a = stops[i - 1].pos!;
    const b = stops[j].pos!;
    for (let k = i; k < j; k++) stops[k].pos = Math.round((a + ((b - a) * (k - i + 1)) / (j - i + 1)) * 100) / 100;
  }
  g.stops = stops as GradientStop[];
  return g;
}

export function gradientCss(g: Gradient): string {
  const stops = g.stops.map((s) => `${s.color} ${s.pos}%`).join(', ');
  let head = '';
  if (g.type === 'linear') head = `${g.angle}deg`;
  else if (g.type === 'radial') {
    const parts = [g.shape !== 'ellipse' ? g.shape : '', g.size !== 'farthest-corner' ? g.size : ''].filter(Boolean);
    if (g.x !== 50 || g.y !== 50) parts.push(`at ${g.x}% ${g.y}%`);
    head = parts.join(' ');
  } else {
    const parts = [g.angle ? `from ${g.angle}deg` : '', g.x !== 50 || g.y !== 50 ? `at ${g.x}% ${g.y}%` : ''].filter(Boolean);
    head = parts.join(' ');
  }
  return `${g.repeating ? 'repeating-' : ''}${g.type}-gradient(${head ? `${head}, ` : ''}${stops})`;
}
