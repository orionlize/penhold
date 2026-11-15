// 可选增强：宿主（如 Claude Code）的 SessionStart hook 上报会话 id。
// 按祖先进程记录，MCP 代理用自己的祖先链找到同一宿主进程，从而把宿主会话 id 作为画布别名。
import fs from 'node:fs';
import path from 'node:path';
import { HOST_SESSIONS_DIR, ancestorPids, ensureDir, pidAlive, writeJsonAtomic } from './server/paths.js';

export async function runHook() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let data: { session_id?: string; sessionId?: string; cwd?: string } = {};
  try {
    data = JSON.parse(input || '{}');
  } catch {}
  const sessionId = data.session_id ?? data.sessionId ?? process.env.DESIGN_MCP_HOST_SESSION;
  if (!sessionId) return;
  ensureDir(HOST_SESSIONS_DIR);
  const rec = { sessionId, cwd: data.cwd ?? process.cwd(), ts: Date.now() };
  // 只记录最近的几层祖先（宿主进程通常在第 1~3 层）
  for (const pid of ancestorPids(process.ppid, 4)) writeJsonAtomic(path.join(HOST_SESSIONS_DIR, `${pid}.json`), rec);
  // 清理已退出进程的记录
  for (const f of fs.readdirSync(HOST_SESSIONS_DIR)) {
    const pid = Number(f.replace(/\.json$/, ''));
    if (pid && !pidAlive(pid)) fs.rmSync(path.join(HOST_SESSIONS_DIR, f), { force: true });
  }
}
