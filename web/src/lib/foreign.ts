// 同一项目其他画布（旧迭代）的设计稿：只读，按需加载并缓存。播放预览的跨画布跳转与画布上的引用卡片共用。
import { useSyncExternalStore } from 'react';
import type { DesignDoc } from '../../../src/core/types';

export type Foreign = { doc: DesignDoc; title: string } | 'loading' | 'error';

const cache = new Map<string, Foreign>();
const subs = new Set<() => void>();
let ver = 0;
const changed = () => {
  ver++;
  for (const f of subs) f();
};
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f));

/** 开始加载（已在缓存里时不重复请求）。 */
export function loadForeign(id: string) {
  if (cache.has(id)) return;
  cache.set(id, 'loading');
  fetch(`/api/canvases/${id}/doc`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { doc: DesignDoc; title: string }) => cache.set(id, j))
    .catch(() => cache.set(id, 'error'))
    .finally(changed);
}

export function getForeign(id: string): Foreign | undefined {
  return cache.get(id);
}

/** 订阅缓存变化：返回版本号，组件据此重渲染。 */
export function useForeignVersion() {
  return useSyncExternalStore(subscribe, () => ver);
}
