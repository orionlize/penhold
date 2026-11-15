// 本机已安装字体：画布不加载网络字体，方向卡片与字体令牌只能用本机有的字体族。
// 守护进程与画布所在的浏览器在同一台机器上，这里直接问操作系统。
import { execFileSync } from 'node:child_process';

const TTL_MS = 10 * 60_000;
let cache: { at: number; fonts: Set<string> | null } | undefined;
let forced: Set<string> | null | undefined;

const norm = (s: string) => s.trim().replace(/^['"]|['"]$/g, '').toLowerCase();

function run(cmd: string, args: string[], timeout: number): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 << 20 });
  } catch {
    return undefined;
  }
}

function fromFontconfig(): Set<string> | null {
  const out = run('fc-list', [':', 'family'], 4000);
  if (!out) return null;
  const set = new Set<string>();
  // 每行是同一字体的若干名称（含本地化名与带字重的别名），逗号分隔
  for (const line of out.split('\n')) for (const name of line.split(',')) if (name.trim()) set.add(norm(name.replace(/\\(.)/g, '$1')));
  return set.size ? set : null;
}

function fromMac(): Set<string> | null {
  const out = run('system_profiler', ['SPFontsDataType', '-json'], 15_000);
  if (!out) return null;
  try {
    const data = JSON.parse(out) as { SPFontsDataType?: Array<{ typefaces?: Array<{ family?: string }> }> };
    const set = new Set<string>();
    for (const f of data.SPFontsDataType ?? []) for (const t of f.typefaces ?? []) if (t.family) set.add(norm(t.family));
    return set.size ? set : null;
  } catch {
    return null;
  }
}

function fromWindows(): Set<string> | null {
  const set = new Set<string>();
  for (const hive of ['HKLM', 'HKCU']) {
    const out = run('reg', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts`], 5000);
    if (!out) continue;
    for (const line of out.split('\n')) {
      const m = /^\s+(.+?)\s+REG_SZ\s/.exec(line);
      if (!m) continue;
      // “Microsoft YaHei & Microsoft YaHei UI (TrueType)”
      for (const name of m[1].replace(/\s*\((TrueType|OpenType)\)\s*$/i, '').split('&')) if (name.trim()) set.add(norm(name));
    }
  }
  return set.size ? set : null;
}

function detect(): Set<string> | null {
  if (process.platform === 'win32') return fromWindows();
  if (process.platform === 'darwin') return fromFontconfig() ?? fromMac();
  return fromFontconfig();
}

/** 本机已安装的字体族（小写）；检测不到时返回 null，调用方按“未知”处理，不做筛选。 */
export function installedFonts(): Set<string> | null {
  if (forced !== undefined) return forced;
  if (cache && Date.now() - cache.at < TTL_MS) return cache.fonts;
  cache = { at: Date.now(), fonts: detect() };
  return cache.fonts;
}

/** 字体族是否已安装；检测不到本机字体时返回 undefined。 */
export function fontInstalled(family: string): boolean | undefined {
  const fonts = installedFonts();
  return fonts ? fonts.has(norm(family)) : undefined;
}

/** 测试用：固定字体清单（null 表示检测不到，undefined 恢复真实检测）。 */
export function setInstalledFontsForTest(fonts: string[] | null | undefined) {
  forced = fonts === undefined ? undefined : fonts === null ? null : new Set(fonts.map(norm));
}
