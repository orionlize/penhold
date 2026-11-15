import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 数据目录默认 ~/.penhold；旧版本用 ~/.design-mcp，首次运行时整体迁移过来，迁移失败则沿用旧目录。 */
function defaultHome() {
  const home = path.join(os.homedir(), '.penhold');
  const legacy = path.join(os.homedir(), '.design-mcp');
  if (!fs.existsSync(home) && fs.existsSync(legacy)) {
    try {
      fs.renameSync(legacy, home);
    } catch {}
    if (!fs.existsSync(home)) return legacy;
  }
  return home;
}

export const HOME = process.env.DESIGN_MCP_HOME ?? defaultHome();
export const DAEMON_FILE = path.join(HOME, 'daemon.json');
export const INDEX_FILE = path.join(HOME, 'index.json');
export const CANVASES_DIR = path.join(HOME, 'canvases');
export const TRASH_DIR = path.join(HOME, 'trash');
export const HOST_SESSIONS_DIR = path.join(HOME, 'host-sessions');
export const LOG_FILE = path.join(HOME, 'daemon.log');
export const canvasDir = (id: string) => path.join(CANVASES_DIR, id);

/** 包根目录（含 package.json）。 */
export const PKG_ROOT = (() => {
  let d = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(d, 'package.json'))) {
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return d;
})();

export const VERSION: string = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;

export function ensureDir(d: string) {
  fs.mkdirSync(d, { recursive: true });
}

/** 临时文件 + 重命名，原子覆盖。 */
export function writeJsonAtomic(file: string, data: unknown, pretty = false) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : undefined));
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 当前进程的祖先 pid 链（由近到远），用于把 MCP 连接与宿主会话 hook 关联起来。 */
export function ancestorPids(start = process.ppid, max = 6): number[] {
  const out: number[] = [];
  let pid = start;
  for (let i = 0; i < max && pid > 1; i++) {
    out.push(pid);
    let ppid = 0;
    try {
      if (process.platform === 'linux') {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      } else if (process.platform === 'darwin') {
        ppid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
      } else break;
    } catch {
      break;
    }
    if (!ppid || ppid === pid) break;
    pid = ppid;
  }
  return out;
}

/**
 * 构建标识：本进程加载的代码目录（dist/server 或 src）下源文件的最新修改时间。
 * 守护进程写入 daemon.json；代理发现守护进程来自更旧的构建时会重启它，避免重新构建后仍跑旧代码。
 */
export const BUILD_ID: number = (() => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  let max = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(js|ts)$/.test(e.name)) max = Math.max(max, fs.statSync(f).mtimeMs);
    }
  };
  try {
    walk(root);
  } catch {}
  return Math.floor(max);
})();
