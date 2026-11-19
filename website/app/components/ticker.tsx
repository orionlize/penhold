'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * 全站共享的两个节拍，对应设计稿 proto 里的 t（900ms）与 h（2200ms）倒计时。
 * 纯视觉的状态通过 <html data-t / data-h / data-c> 交给 CSS，只有需要数字的组件才订阅。
 */
type Snap = { t: number; h: number };

const START = 3600;
let snap: Snap = { t: START, h: START };
const listeners = new Set<() => void>();

function emit(next: Snap) {
  snap = next;
  const root = document.documentElement;
  root.dataset.t = String(next.t % 2);
  root.dataset.h = String(next.h % 4);
  root.dataset.c = String(next.t % 6);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const SERVER: Snap = { t: START + 1, h: START };

export function useTick() {
  return useSyncExternalStore(
    subscribe,
    () => snap,
    () => SERVER,
  );
}

export function Ticker() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timers: number[] = [];
    const stop = () => {
      timers.forEach(clearInterval);
      timers = [];
    };
    const start = () => {
      stop();
      if (reduce.matches) return;
      emit(snap);
      timers.push(
        window.setInterval(() => emit({ ...snap, t: snap.t > 0 ? snap.t - 1 : START }), 900),
        window.setInterval(() => emit({ ...snap, h: snap.h > 0 ? snap.h - 1 : START }), 2200),
      );
    };
    start();
    reduce.addEventListener('change', start);
    return () => {
      stop();
      reduce.removeEventListener('change', start);
    };
  }, []);
  return null;
}

/** 登录稿里的“N s 后重发”。 */
export function Resend() {
  const { t } = useTick();
  return <>{t % 60}s 后重发</>;
}
