// 画布坐标换算：画板横向排布，批注坐标相对所在画板左上角。
import type { Annotation, DesignDoc, Frame } from '../../src/core/types';
import { FRAME_GAP } from '../../src/core/doc';
import { useStore } from './store';

export { FRAME_GAP };

export function placements(doc: DesignDoc | null): Array<{ f: Frame; x: number; h: number }> {
  const heights = useStore.getState().frameHeights;
  let x = 0;
  return (doc?.frames ?? []).map((f) => {
    const p = { f, x, h: heights[f.id] ?? (typeof f.height === 'number' ? f.height : 400) };
    x += f.width + FRAME_GAP;
    return p;
  });
}

/** 屏幕坐标 → 画布世界坐标。 */
export function toWorld(clientX: number, clientY: number): [number, number] {
  const s = useStore.getState();
  const vp = document.querySelector('.viewport')!.getBoundingClientRect();
  return [(clientX - vp.left - s.panX) / s.zoom, (clientY - vp.top - s.panY) / s.zoom];
}

export function frameAt(doc: DesignDoc | null, wx: number, wy: number) {
  return placements(doc).find((p) => wx >= p.x && wx <= p.x + p.f.width && wy >= 0 && wy <= p.h);
}

/** 批注所在画板的原点（画板已删除时退回世界原点）。 */
export function noteOrigin(doc: DesignDoc | null, n: Pick<Annotation, 'frame'>): [number, number] {
  if (!n.frame) return [0, 0];
  const p = placements(doc).find((q) => q.f.id === n.frame);
  return p ? [p.x, 0] : [0, 0];
}
