// stdio MCP 入口：薄代理。确保守护进程在运行，然后把 JSON-RPC 消息原样转发到守护进程的 Streamable HTTP 端点。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';
import { BUILD_ID, DAEMON_FILE, HOME, LOG_FILE, ancestorPids, ensureDir, pidAlive, readJson } from './server/paths.js';

export interface DaemonInfo {
  pid: number;
  port: number;
  token: string;
  version: string;
  build?: number;
}

async function healthy(info: DaemonInfo | null): Promise<boolean> {
  if (!info?.port || !pidAlive(info.pid)) return false;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, { headers: { 'x-dm-token': info.token }, signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 读取锁文件；守护进程不存在则拉起并等待就绪。 */
export async function ensureDaemon(): Promise<DaemonInfo> {
  ensureDir(HOME);
  let info = readJson<DaemonInfo | null>(DAEMON_FILE, null);
  if (await healthy(info)) {
    // 守护进程来自更旧的构建（重新构建后未重启）：平滑重启为当前代码。只升级不降级，避免新旧代理互相重启。
    if ((info!.build ?? 0) >= BUILD_ID) return info!;
    console.error(`[penhold-mcp] 守护进程（pid ${info!.pid}）来自旧构建，正在重启…`);
    try {
      process.kill(info!.pid, 'SIGTERM');
    } catch {}
    for (let i = 0; i < 50 && pidAlive(info!.pid); i++) await sleep(100);
  }
  const lock = path.join(HOME, 'spawn.lock');
  let owner = false;
  try {
    const st = fs.statSync(lock);
    if (Date.now() - st.mtimeMs > 15_000) fs.rmSync(lock, { force: true });
  } catch {}
  try {
    fs.closeSync(fs.openSync(lock, 'wx'));
    owner = true;
  } catch {}
  try {
    if (owner) {
      const log = fs.openSync(LOG_FILE, 'a');
      const child = spawn(process.execPath, [...process.execArgv, process.argv[1], 'daemon'], {
        detached: true,
        stdio: ['ignore', log, log],
        env: process.env,
      });
      child.unref();
    }
    for (let i = 0; i < 100; i++) {
      await sleep(150);
      info = readJson<DaemonInfo | null>(DAEMON_FILE, null);
      if (await healthy(info)) return info!;
    }
    throw new Error(`守护进程启动失败，请查看 ${LOG_FILE}`);
  } finally {
    if (owner) fs.rmSync(lock, { force: true });
  }
}

export async function runProxy() {
  let info = await ensureDaemon();
  const stdio = new StdioServerTransport();
  const ancestors = ancestorPids(process.ppid).join(',');
  let http: StreamableHTTPClientTransport | null = null;
  let initMsg: JSONRPCMessage | null = null;
  let initializedMsg: JSONRPCMessage | null = null;
  let swallowId: string | number | null = null;
  let alive: WebSocket | null = null;

  const openAlive = (sid: string) => {
    alive?.close();
    const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws/proxy`, { headers: { 'x-dm-token': info.token } });
    ws.on('open', () => ws.send(JSON.stringify({ session: sid })));
    ws.on('error', () => {});
    alive = ws;
  };

  const connect = async () => {
    const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${info.port}/mcp`), {
      requestInit: {
        headers: {
          authorization: `Bearer ${info.token}`,
          'x-dm-cwd': encodeURIComponent(process.cwd()),
          'x-dm-ancestors': ancestors,
          ...(process.env.DESIGN_MCP_CANVAS ? { 'x-dm-canvas': process.env.DESIGN_MCP_CANVAS } : {}),
          ...(process.env.DESIGN_MCP_GUIDES ? { 'x-dm-guides': encodeURIComponent(process.env.DESIGN_MCP_GUIDES) } : {}),
        },
      },
    });
    t.onmessage = (m) => {
      if (swallowId !== null && 'id' in m && m.id === swallowId && !('method' in m)) {
        swallowId = null;
        return;
      }
      if (t.sessionId && (!alive || alive.readyState > 1)) openAlive(t.sessionId);
      stdio.send(m).catch(() => {});
    };
    t.onerror = (e) => console.error('[penhold-mcp proxy]', e.message);
    await t.start();
    http = t;
  };

  const forward = async (m: JSONRPCMessage, retry = true): Promise<void> => {
    try {
      await http!.send(m);
      if (http!.sessionId && (!alive || alive.readyState > 1)) openAlive(http!.sessionId);
    } catch (e) {
      if (!retry) throw e;
      // 守护进程可能已重启：重新拉起并重放初始化握手
      const prevBuild = info.build;
      info = await ensureDaemon();
      await connect();
      if (initMsg && m !== initMsg) {
        swallowId = (initMsg as { id: string | number }).id;
        await http!.send(initMsg);
        if (initializedMsg) await http!.send(initializedMsg);
      }
      await forward(m, false);
      // 换成了另一个构建的守护进程（重新构建或其他检出升级了它）：工具与参数可能变了，通知客户端重新拉取工具列表，
      // 否则客户端会继续用会话开始时缓存的旧参数校验（例如新加的参数被拒）
      if (initMsg && info.build !== prevBuild) stdio.send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }).catch(() => {});
    }
  };

  await connect();
  stdio.onmessage = (m) => {
    if ('method' in m && m.method === 'initialize') initMsg = m;
    if ('method' in m && m.method === 'notifications/initialized') initializedMsg = m;
    forward(m).catch((e) => {
      if ('id' in m && 'method' in m)
        stdio.send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: `penhold-mcp 守护进程不可用：${(e as Error).message}` } }).catch(() => {});
    });
  };
  const quit = async () => {
    try {
      await http?.terminateSession();
    } catch {}
    alive?.close();
    process.exit(0);
  };
  stdio.onclose = quit;
  process.stdin.on('end', quit);
  await stdio.start();
}
