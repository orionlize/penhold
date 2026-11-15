// 单个画板的快速导出：PNG（1x / 2x / 3x）、PDF、HTML。
// PNG 与截图共用 FrameView.screenshot（初始状态静态渲染）；PDF 把 2x 位图无损（Flate）嵌入单页 PDF，
// 页面尺寸按 CSS 像素换算为 pt（1px = 0.75pt），打印时与画板尺寸一致；HTML 走服务端单文件导出。
import { toast, useStore } from './store';
import { t } from './i18n';
import { views } from './Viewport';
import { rgbToPdf } from './pdf';

export type FrameExportKind = 'png1' | 'png2' | 'png3' | 'pdf' | 'html';

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function slug(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design';
}

function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function shot(frameId: string, scale: number) {
  const v = views.get(frameId);
  if (!v?.ready) throw new Error(t('frameExport.notReady'));
  v.finishReveal();
  await v.imagesLoaded();
  return v.screenshot(frameId, scale);
}

/** 把 PNG 位图做成单页 PDF；cssW / cssH 为画板的 CSS 像素尺寸。 */
async function pngToPdf(png: Uint8Array, cssW: number, cssH: number): Promise<Blob> {
  const img = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }));
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
  const rgb = new Uint8Array(c.width * c.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  return rgbToPdf(rgb, c.width, c.height, cssW, cssH);
}

export async function exportFrame(frameId: string, kind: FrameExportKind) {
  const s = useStore.getState();
  const frame = s.doc?.frames.find((f) => f.id === frameId);
  if (!frame || !s.canvasId) return;
  const name = slug(frame.name);
  try {
    if (kind === 'html') {
      const q = new URLSearchParams({ frames: frameId, inline: '1', style: 'class', width: 'fixed', split: '0', interactive: '1' });
      const r = await fetch(`/c/${s.canvasId}/export?${q}`);
      if (!r.ok) throw new Error((await r.json()).error);
      const file = decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `${name}.html`);
      downloadBlob(await r.blob(), file);
    } else if (kind === 'pdf') {
      const png = b64ToBytes(await shot(frameId, 2));
      const v = views.get(frameId)!;
      const r = v.element(frameId)!.getBoundingClientRect();
      const el = v.element(frameId)!;
      const w = Math.ceil(Math.max(r.width, el.scrollWidth));
      const h = Math.ceil(Math.max(r.height, el.scrollHeight));
      downloadBlob(await pngToPdf(png, w, h), `${name}.pdf`);
    } else {
      const scale = kind === 'png1' ? 1 : kind === 'png2' ? 2 : 3;
      const png = b64ToBytes(await shot(frameId, scale));
      downloadBlob(new Blob([png as BlobPart], { type: 'image/png' }), scale === 1 ? `${name}.png` : `${name}@${scale}x.png`);
    }
  } catch (e) {
    toast(t('export.failed', { msg: (e as Error).message }));
  }
}
