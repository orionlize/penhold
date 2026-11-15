// 颜色工具：WCAG 对比度与 OKLCH 换算。转色相、调明度都在 OKLCH 里做，
// 同一明度下不同色相的感知亮度一致（HSL 里黄和蓝同为 50% 明度，看起来却差很多）。

export const HEX6 = /^#[0-9a-f]{6}$/i;

export type Rgb = [r: number, g: number, b: number];
export type Oklch = [l: number, c: number, h: number];

/** 解析 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba()；返回 0–255 的通道与 alpha。 */
export function parseColor(v: string): { rgb: Rgb; alpha: number } | undefined {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return undefined;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: a };
  }
  return undefined;
}

export function hex(rgb: Rgb): string {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const lin = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const gam = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

export function luminance(c: string | Rgb): number {
  const rgb = typeof c === 'string' ? parseColor(c)?.rgb : c;
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 对比度。 */
export function contrast(a: string | Rgb, b: string | Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 半透明前景叠到不透明背景上。 */
export function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as Rgb;
}

// ---------- OKLCH ----------

export function toOklch(c: string | Rgb): Oklch {
  const rgb = typeof c === 'string' ? (parseColor(c)?.rgb ?? [0, 0, 0]) : c;
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return [L, C, H];
}

function oklchToLinear([L, C, H]: Oklch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → #RRGGBB；超出 sRGB 色域时保持明度与色相、降低彩度。 */
export function fromOklch([L, C, H]: Oklch): string {
  const inGamut = (c: number) => oklchToLinear([L, c, H]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let c = C;
  if (!inGamut(c)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(mid)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  return hex(oklchToLinear([Math.min(1, Math.max(0, L)), c, H]).map((v) => gam(Math.min(1, Math.max(0, v)))) as Rgb);
}

export const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** 只改明度，直到对 bg 的对比度达到 min（朝远离背景的方向）；做不到时取黑或白中对比更高的。 */
export function ensureContrast(fg: string, bg: string, min: number): string {
  if (!HEX6.test(fg) || !HEX6.test(bg) || contrast(fg, bg) >= min) return fg;
  const [l, c, h] = toOklch(fg);
  const darker = contrast('#000000', bg) >= contrast('#FFFFFF', bg);
  for (let i = 1; i <= 60; i++) {
    const L = l + (darker ? -1 : 1) * i * 0.0125;
    if (L < 0 || L > 1) break;
    const out = fromOklch([L, c, h]);
    if (contrast(out, bg) >= min) return out;
  }
  return darker ? '#000000' : '#FFFFFF';
}

/** 色块上的文字：黑白中对比更高的。 */
export const onColor = (bg: string) => (contrast('#FFFFFF', bg) >= contrast('#000000', bg) ? '#FFFFFF' : '#000000');
