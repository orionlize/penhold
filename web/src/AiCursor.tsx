// AI 光标：只出现在 AI 正在工作的画板上，跟随回放中的节点移动，并标出当前状态。
import { useEffect, useState } from 'react';
import { placements } from './geom';
import { useStore } from './store';
import { views } from './Viewport';
import { t } from './i18n';

/** 两次写入之间超过这么久没有新调用，就显示“思考中”。 */
const THINKING_AFTER_MS = 2500;

export function AiCursor() {
  const cur = useStore((s) => s.lock?.cursor ?? null);
  const target = useStore((s) => s.aiTarget);
  const zoom = useStore((s) => s.zoom);
  useStore((s) => s.version);
  useStore((s) => s.frameHeights);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!cur) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [!!cur]);

  if (!cur) return null;
  const doc = useStore.getState().doc;
  const place = placements(doc).find((p) => p.f.id === cur.frame);
  if (!place) return null;
  const view = views.get(cur.frame);
  const checking = cur.status === 'checking';
  const addr = !checking && target?.frame === cur.frame ? target.addr : cur.addr;

  // 目标矩形（画板坐标）；画板本身或量不到时用整个画板
  let box: { l: number; t: number; w: number; h: number } | null = null;
  if (!checking && addr !== cur.frame && view?.ready) {
    const r = view.rect(addr);
    if (r && r.width > 0 && r.height > 0) box = { l: r.left, t: r.top, w: r.width, h: r.height };
  }
  const frameBox = { l: 0, t: 0, w: place.f.width, h: place.h };
  const tipX = box ? box.l + Math.min(box.w * 0.5, 28) : checking ? frameBox.w / 2 : 28;
  const tipY = box ? box.t + Math.min(box.h * 0.6, 20) : 28;

  const revealing = !!view?.isRevealing;
  const thinking = !checking && !revealing && now - cur.at > THINKING_AFTER_MS;
  const label = checking ? t('status.checking') : thinking ? t('ai.thinking') : cur.note ? t('ai.drawingNote', { note: cur.note }) : t('status.drawing');
  const inv = 1 / zoom;
  const shown = box ?? (checking ? frameBox : null);

  return (
    <>
      {shown && (
        <div
          className={`ai-box ${checking ? 'scan' : ''}`}
          style={{ left: place.x + shown.l, top: shown.t, width: shown.w, height: shown.h, borderWidth: 1.5 * inv }}
        />
      )}
      <div className={`ai-cursor ${thinking ? 'idle' : ''}`} style={{ transform: `translate(${place.x + tipX}px, ${tipY}px)` }}>
        <div style={{ transform: `scale(${inv})`, transformOrigin: '0 0' }}>
          <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden>
            <path d="M1.5 1.5 16 9.2l-6.4 1.6-3.3 6.9z" fill="var(--ai)" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
          <span className="ai-tag">
            <b>AI</b>
            {label}
          </span>
        </div>
      </div>
    </>
  );
}
