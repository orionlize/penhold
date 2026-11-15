// 主题：默认跟随系统（并随系统切换实时变化）；用户手动切到与系统不同的主题时才记住。
export type Theme = 'light' | 'dark';

const KEY = 'dm-theme';
const media = window.matchMedia?.('(prefers-color-scheme: dark)');

export const systemTheme = (): Theme => (media?.matches ? 'dark' : 'light');

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
}

export const currentTheme = (): Theme => stored() ?? systemTheme();

const listeners = new Set<(t: Theme) => void>();
function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  listeners.forEach((f) => f(t));
}

/** 手动切换：与系统一致时清除记录，恢复跟随系统。 */
export function chooseTheme(t: Theme) {
  try {
    if (t === systemTheme()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {}
  apply(t);
}

export function onThemeChange(f: (t: Theme) => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

apply(currentTheme());
media?.addEventListener('change', () => {
  if (!stored()) apply(systemTheme());
});
