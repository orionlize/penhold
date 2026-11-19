// 截图像素对比：design_screenshot 把这一次的截图与同一目标上一次的截图比较，
// 报告哪些区域变了（确认修改只落在想改的地方）、或者画面根本没变（修改没生效）。
// 画布页面导出的 PNG 是 8 位 RGBA / RGB、无隔行，这里只解码这一种；其他格式返回 null，跳过对比。
import zlib from 'node:zlib';

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA，每像素 4 字节。 */
  data: Uint8Array;
}

/** 解码 base64 PNG；不支持的格式返回 null。 */
export function decodePng(b64: string): Bitmap | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const color = body[9];
      const interlace = body[12];
      if (depth !== 8 || interlace !== 0) return null;
      channels = color === 6 ? 4 : color === 2 ? 3 : 0;
      if (!channels) return null;
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !height || !idat.length || width * height > 40_000_000) return null;
  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return null;
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * channels];
      out[o + 1] = cur[x * channels + 1];
      out[o + 2] = cur[x * channels + 2];
      out[o + 3] = channels === 4 ? cur[x * channels + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: out };
}

export interface DiffRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelDiff {
  /** 变化像素占比（0–1），按两图重叠部分计算。 */
  ratio: number;
  /** 变化区域（截图像素坐标），按面积从大到小，最多 max 个。 */
  regions: DiffRegion[];
  /** 尺寸变化时的前后尺寸。 */
  resized?: { from: [number, number]; to: [number, number] };
}

/**
 * 比较两张图。像素任一通道差超过 tolerance 计为变化；变化像素按 cell×cell 的格子聚合，
 * 相邻（含对角、间隔一格以内）的格子并成一个区域，避免一行字被拆成很多小块。
 */
export function diffBitmaps(a: Bitmap, b: Bitmap, opts: { tolerance?: number; cell?: number; max?: number } = {}): PixelDiff {
  const tol = opts.tolerance ?? 24;
  const cell = opts.cell ?? 8;
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Uint8Array(gw * gh);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const oa = (y * a.width + x) * 4;
      const ob = (y * b.width + x) * 4;
      if (
        Math.abs(a.data[oa] - b.data[ob]) > tol ||
        Math.abs(a.data[oa + 1] - b.data[ob + 1]) > tol ||
        Math.abs(a.data[oa + 2] - b.data[ob + 2]) > tol ||
        Math.abs(a.data[oa + 3] - b.data[ob + 3]) > tol
      ) {
        changed++;
        grid[Math.floor(y / cell) * gw + Math.floor(x / cell)] = 1;
      }
    }
  }
  // 连通分量（间隔一格以内算相邻）
  const seen = new Uint8Array(gw * gh);
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number; n: number }> = [];
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue;
    const box = { x0: gw, y0: gh, x1: 0, y1: 0, n: 0 };
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const gx = j % gw;
      const gy = (j - gx) / gw;
      box.x0 = Math.min(box.x0, gx);
      box.y0 = Math.min(box.y0, gy);
      box.x1 = Math.max(box.x1, gx);
      box.y1 = Math.max(box.y1, gy);
      box.n++;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const k = ny * gw + nx;
          if (grid[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
    }
    boxes.push(box);
  }
  const regions = boxes
    .map((bx) => ({
      x: bx.x0 * cell,
      y: bx.y0 * cell,
      width: Math.min(w, (bx.x1 + 1) * cell) - bx.x0 * cell,
      height: Math.min(h, (bx.y1 + 1) * cell) - bx.y0 * cell,
    }))
    .sort((p, q) => q.width * q.height - p.width * p.height)
    .slice(0, opts.max ?? 6);
  const resized = a.width !== b.width || a.height !== b.height ? { from: [a.width, a.height] as [number, number], to: [b.width, b.height] as [number, number] } : undefined;
  return { ratio: w * h ? changed / (w * h) : 0, regions, ...(resized ? { resized } : {}) };
}
