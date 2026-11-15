// 图片资源入库：远程 URL 在插入时下载、data URL 与本地文件复制到 assets/images/，按内容哈希命名。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AssetRef } from '../core/types.js';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};
const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]));
EXT_MIME.jpeg = 'image/jpeg';
const MAX = 15 * 1024 * 1024;

export function sniffMime(buf: Buffer, hint?: string): string | undefined {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.subarray(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(4, 12).toString().includes('ftypavif')) return 'image/avif';
  const head = buf.subarray(0, 512).toString('utf8').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  if (hint && MIME_EXT[hint]) return hint;
  return undefined;
}

export function storeAsset(canvasDir: string, buf: Buffer, source?: string, hint?: string): AssetRef {
  if (buf.length > MAX) throw new Error('图片超过 15MB');
  const mime = sniffMime(buf, hint);
  if (!mime) throw new Error('不支持的图片格式（支持 png/jpg/gif/webp/svg/avif）');
  if (mime === 'image/svg+xml' && /<script|on\w+\s*=|javascript:/i.test(buf.toString('utf8'))) throw new Error('SVG 含脚本，已拒绝');
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const file = `${hash}.${MIME_EXT[mime]}`;
  const dest = path.join(canvasDir, 'assets', 'images', file);
  if (!fs.existsSync(dest)) fs.writeFileSync(dest, buf);
  const ref: AssetRef = { hash, file, mime, source: source?.slice(0, 300) };
  const dim = imageSize(buf, mime);
  if (dim) Object.assign(ref, dim);
  return ref;
}

function imageSize(buf: Buffer, mime: string): { width: number; height: number } | undefined {
  try {
    if (mime === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === 'image/gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) return;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + len;
      }
    }
  } catch {}
  return undefined;
}

/** 把 AI 给出的 src（http(s) URL、data URL、本地绝对路径、asset:<hash>）入库，返回 asset 引用。 */
export async function ingestSrc(canvasDir: string, src: string, cwd: string): Promise<AssetRef | null> {
  if (/^asset:[a-f0-9]+$/.test(src)) return null;
  if (src.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
    if (!m) throw new Error('无法解析 data URL');
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    return storeAsset(canvasDir, buf, 'data-url', m[1]);
  }
  if (/^https?:\/\//i.test(src)) {
    const ctl = AbortSignal.timeout(20_000);
    const res = await fetch(src, { signal: ctl, redirect: 'follow' });
    if (!res.ok) throw new Error(`下载图片失败：HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return storeAsset(canvasDir, buf, src, res.headers.get('content-type')?.split(';')[0]);
  }
  const p = path.isAbsolute(src) ? src : path.resolve(cwd, src);
  if (!fs.existsSync(p)) throw new Error(`图片文件不存在：${p}`);
  const ext = path.extname(p).slice(1).toLowerCase();
  return storeAsset(canvasDir, fs.readFileSync(p), path.basename(p), EXT_MIME[ext]);
}

export function assetPath(canvasDir: string, ref: AssetRef) {
  return path.join(canvasDir, 'assets', 'images', ref.file);
}
