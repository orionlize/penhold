// 侧栏字段的浮窗外壳：放在侧栏左侧（左侧放不下时放在触发器下方），点外部 / 滚动 / 缩放窗口 / Esc 关闭。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ResetCtx } from '../inspector/fields';

export const POP_W = 288;

export function FloatPanel({ anchor, label, onClose, children, width = POP_W }: { anchor: HTMLElement; label: string; onClose: () => void; children: React.ReactNode; width?: number }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      if (!pop.current) return;
      const r = anchor.getBoundingClientRect();
      const side = anchor.closest('.sidebar')?.getBoundingClientRect();
      const h = pop.current.offsetHeight;
      const clampTop = (y: number) => Math.max(8, Math.min(y, window.innerHeight - 8 - h));
      if (side && side.left - width - 8 >= 8) setPos({ left: side.left - width - 8, top: clampTop(r.top - 40) });
      else {
        const below = window.innerHeight - r.bottom - 8;
        setPos({ left: Math.max(8, Math.min(r.right - width, window.innerWidth - 8 - width)), top: below >= h || below > r.top ? r.bottom + 4 : clampTop(r.top - 4 - h) });
      }
    };
    place();
    // 内容高度变化（切换标签、增删条目）时重新定位
    const ro = new ResizeObserver(place);
    if (pop.current) ro.observe(pop.current);
    return () => ro.disconnect();
  }, [anchor, width]);

  useEffect(() => {
    // 关闭前先让浮窗里正在编辑的输入框失焦提交
    const close = () => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae && pop.current?.contains(ae)) ae.blur();
      onClose();
    };
    const inside = (n: EventTarget | null) => n instanceof Node && (pop.current?.contains(n) || anchor.contains(n) || (n instanceof Element && !!n.closest('.select-content')));
    const onDown = (e: PointerEvent) => !inside(e.target) && close();
    const onScroll = (e: Event) => !inside(e.target) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.select-content')) return;
      e.stopPropagation();
      close();
      anchor.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={pop} role="dialog" aria-label={label} className="bg-pop" style={pos ? { left: pos.left, top: pos.top, width } : { visibility: 'hidden', left: 0, top: 0, width }}>
      <ResetCtx.Provider value={undefined}>{children}</ResetCtx.Provider>
    </div>,
    document.body,
  );
}
