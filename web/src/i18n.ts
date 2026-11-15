// 界面国际化：中文系统显示中文，其余一律英文。可用 localStorage 'dm-lang'（zh / en）或 ?lang= 覆盖。
import { en } from './locales/en';
import { zh } from './locales/zh';

export type Lang = 'zh' | 'en';
export type MessageKey = keyof typeof zh;
export type Messages = Record<MessageKey, string>;
/** 可选的单数形式（params.n === 1 时优先使用），目前只有英文需要。 */
export type PluralKeys = { [K in `${MessageKey}_one`]?: string };

const KEY = 'dm-lang';
const dicts: Record<Lang, Messages & PluralKeys> = { zh, en };

function detect(): Lang {
  const pick = (v: string | null | undefined): Lang | null => (v === 'zh' || v === 'en' ? v : null);
  try {
    const q = pick(new URLSearchParams(location.search).get('lang'));
    if (q) {
      localStorage.setItem(KEY, q);
      return q;
    }
    const s = pick(localStorage.getItem(KEY));
    if (s) return s;
  } catch {}
  // 只看首选语言：语言列表里排在后面的中文（如 en-US, zh-CN）不算中文系统
  const primary = navigator.languages?.[0] ?? navigator.language ?? '';
  return /^zh\b/i.test(primary) ? 'zh' : 'en';
}

export const lang: Lang = detect();
const dict = dicts[lang];

document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

/** 取文案；`{name}` 占位符由 params 替换。 */
export function t(key: MessageKey, params?: Record<string, string | number | null | undefined>): string {
  const s = (params?.n === 1 ? dict[`${key}_one`] : undefined) ?? dict[key] ?? zh[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k] ?? '') : m)) : s;
}
