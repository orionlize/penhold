// 本机字体检测：用画布测量文本宽度，与通用回退族比较。产品不加载任何网络字体。
const cache = new Map<string, boolean>();
let ctx: CanvasRenderingContext2D | null = null;
const SAMPLE = 'mmmmmmmmmmlli1WQ@#永和中文Ag';

export function fontAvailable(family: string): boolean {
  const key = family.trim();
  if (!key) return true;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return true;
  let ok = false;
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    ctx.font = `72px ${base}`;
    const w0 = ctx.measureText(SAMPLE).width;
    ctx.font = `72px "${key.replace(/"/g, '')}", ${base}`;
    if (ctx.measureText(SAMPLE).width !== w0) {
      ok = true;
      break;
    }
  }
  cache.set(key, ok);
  return ok;
}

/** 字体族列表中的第一个；值是令牌引用（"{font.heading}"）时先取令牌的值。 */
export function firstFamily(f: string | undefined, tokens?: Record<string, string>): string {
  const ref = /^\{([a-zA-Z0-9_.-]+)\}$/.exec((f ?? '').trim());
  const value = ref ? (tokens?.[ref[1]] ?? '') : (f ?? '');
  return value.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
}
