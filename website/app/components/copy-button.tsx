'use client';

import { useEffect, useRef, useState } from 'react';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, className }: { text: string; className: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={className}
      data-copied={state === 'ok' || undefined}
      aria-label={`复制命令：${text}`}
      onClick={async () => {
        setState((await copy(text)) ? 'ok' : 'fail');
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setState('idle'), 1800);
      }}
    >
      <span aria-live="polite">{state === 'ok' ? '已复制' : state === 'fail' ? '请手动复制' : '复制'}</span>
    </button>
  );
}
