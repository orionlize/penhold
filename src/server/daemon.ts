// 守护进程：HTTP（画布静态资源、导出、管理 API）+ WebSocket（操作同步）+ Streamable HTTP MCP 端点。仅监听 127.0.0.1。
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { WebSocketServer, type WebSocket } from 'ws';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Registry } from './canvas/registry.js';
import { loadSystem } from './design/systems.js';
import { componentPreview, systemPage } from './design/systemPage.js';
import { createSystem, deleteSystem, detailForUi, listForUi, setProjectDefault, starterCards, updateSystem } from './design/systemApi.js';
import { systemDir } from './design/systems.js';
import { createMcpServer, type SessionCtx } from './mcp.js';
import { buildExport } from './export/export.js';
import { ingestSrc, storeAsset } from './canvas/assets.js';
import { CanvasError } from './canvas/canvas.js';
import { BUILD_ID, DAEMON_FILE, HOME, PKG_ROOT, VERSION, ensureDir, readJson, writeJsonAtomic } from './paths.js';

const BASE_PORT = Number(process.env.DESIGN_MCP_PORT ?? 4470);
const IDLE_MS = Number(process.env.DESIGN_MCP_IDLE_MS ?? 30 * 60_000);
const WEB_DIR = path.join(PKG_ROOT, 'dist', 'web');

interface McpSession {
  transport: StreamableHTTPServerTransport;
  ctx: SessionCtx;
  lastSeen: number;
  proxies: number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

export async function runDaemon() {
  ensureDir(HOME);
  // 访问令牌跨守护进程重启保持不变，已打开的画布页面才能自动重连
  const tokenFile = path.join(HOME, 'token');
  let token = '';
  try {
    token = fs.readFileSync(tokenFile, 'utf8').trim();
  } catch {}
  if (!/^[0-9a-f]{36}$/.test(token)) {
    token = crypto.randomBytes(18).toString('hex');
    fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  }
  const hub = new Registry();
  hub.token = token;
  const sessions = new Map<string, McpSession>();
  let lastActivity = Date.now();
  hub.onActivity = () => (lastActivity = Date.now());

  const authed = (req: http.IncomingMessage, url: URL) => {
    const h = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? (req.headers['x-dm-token'] as string | undefined);
    const t = h ?? url.searchParams.get('t');
    return !!t && t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token));
  };
  // 只监听 127.0.0.1；校验 Host 防 DNS 重绑定，校验 Origin 防其他网站跨站访问
  const hostOk = (req: http.IncomingMessage) => {
    const h = req.headers.host ?? '';
    return h === `127.0.0.1:${hub.port}` || h === `localhost:${hub.port}`;
  };
  const originOk = (req: http.IncomingMessage) => {
    const o = req.headers.origin;
    if (!o) return true; // 非浏览器客户端（MCP 代理）
    return o === `http://127.0.0.1:${hub.port}` || o === `http://localhost:${hub.port}`;
  };

  const send = (res: http.ServerResponse, code: number, body: unknown, type = 'application/json') => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(data);
  };
  const readBody = (req: http.IncomingMessage, limit = 20 * 1024 * 1024) =>
    new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      req.on('data', (c: Buffer) => {
        n += c.length;
        if (n > limit) {
          reject(new Error('请求体过大'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const serveWebIndex = (res: http.ServerResponse) => {
    const file = path.join(WEB_DIR, 'index.html');
    if (!fs.existsSync(file)) return send(res, 500, '画布前端未构建：请先运行 npm run build:web', 'text/plain; charset=utf-8');
    const headers: Record<string, string> = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; frame-src 'self' about:; font-src 'self' data:",
    };
    res.writeHead(200, headers);
    res.end(fs.readFileSync(file));
  };

  // ---------- MCP（Streamable HTTP） ----------
  const handleMcp = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const sid = req.headers['mcp-session-id'] as string | undefined;
    let body: unknown;
    if (req.method === 'POST') {
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch {
        return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      }
    }
    lastActivity = Date.now();
    if (sid && sessions.has(sid)) {
      const s = sessions.get(sid)!;
      s.lastSeen = Date.now();
      return s.transport.handleRequest(req, res, body);
    }
    if (req.method === 'POST' && !sid && isInitializeRequest(body)) {
      const ancestors = String(req.headers['x-dm-ancestors'] ?? '')
        .split(',')
        .map(Number)
        .filter((n) => n > 1);
      const ctx: SessionCtx = {
        id: '',
        cwd: decodeURIComponent(String(req.headers['x-dm-cwd'] ?? '')) || process.cwd(),
        ancestors,
        envCanvas: (req.headers['x-dm-canvas'] as string | undefined) || undefined,
        envGuides: req.headers['x-dm-guides'] ? safeDecode(req.headers['x-dm-guides'] as string) : undefined,
      };
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          ctx.id = id;
          sessions.set(id, { transport, ctx, lastSeen: Date.now(), proxies: 0 });
        },
      });
      transport.onclose = () => closeSession(transport.sessionId);
      const server = createMcpServer(hub, ctx);
      await server.connect(transport);
      return transport.handleRequest(req, res, body);
    }
    if (sid) return send(res, 404, { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null });
    return send(res, 400, { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session' }, id: null });
  };

  const closeSession = (sid?: string) => {
    if (!sid) return;
    const s = sessions.get(sid);
    if (!s) return;
    sessions.delete(sid);
    for (const c of hub.openCanvases()) {
      if (c.lock?.session === sid) c.releaseLock('session_closed');
      else c.dropSuspended(sid);
    }
  };

  // ---------- 本机字体 ----------
  let fontCache: string[] | null = null;
  const listFonts = () =>
    new Promise<string[]>((resolve) => {
      if (fontCache) return resolve(fontCache);
      execFile('fc-list', [':', 'family'], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
        let fams: string[] = [];
        if (!err) fams = out.split('\n').flatMap((l) => l.split(',')[0] ? [l.split(',')[0].trim()] : []);
        else {
          const dirs =
            process.platform === 'darwin'
              ? ['/System/Library/Fonts', '/Library/Fonts', path.join(process.env.HOME ?? '', 'Library/Fonts')]
              : process.platform === 'win32'
                ? [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')]
                : ['/usr/share/fonts', path.join(process.env.HOME ?? '', '.local/share/fonts')];
          for (const d of dirs) {
            try {
              for (const f of fs.readdirSync(d, { recursive: true }) as string[]) {
                const m = /([^/\\]+)\.(ttf|otf|ttc)$/i.exec(f);
                if (m) fams.push(m[1].replace(/[-_](Regular|Bold|Italic|Light|Medium|Semibold|SemiBold|Black|Thin|ExtraBold|Heavy).*$/i, '').replace(/[-_]/g, ' '));
              }
            } catch {}
          }
        }
        fontCache = [...new Set(fams.filter(Boolean))].sort((a, b) => a.localeCompare(b));
        resolve(fontCache);
      });
    });

  // ---------- HTTP 路由 ----------
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`);
      const p = url.pathname;

      // 前端静态资源（不含敏感数据，无需令牌）
      if (p.startsWith('/assets/') && req.method === 'GET') {
        const file = path.join(WEB_DIR, path.normalize(p).replace(/^([/\\])+/, ''));
        if (!file.startsWith(WEB_DIR) || !fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
        return fs.createReadStream(file).pipe(res);
      }
      if (p === '/favicon.ico') return send(res, 204, '');
      if (!hostOk(req) || !originOk(req)) return send(res, 403, { error: 'bad host or origin' });
      // 画布页面与管理 API 直接可用；只有 MCP 端点需要令牌（由 stdio 代理自动携带）
      if ((p === '/mcp' || p === '/api/health') && !authed(req, url)) return send(res, 401, { error: '需要访问令牌' });

      if (p === '/mcp') return handleMcp(req, res);
      if (p === '/api/health') return send(res, 200, { ok: true, pid: process.pid, version: VERSION, port: hub.port });

      // 页面
      if (req.method === 'GET' && (p === '/' || /^\/c\/[0-9a-f-]{36}$/.test(p))) {
        return serveWebIndex(res);
      }

      // 设计系统：/s/<id> 是可编辑页面（前端应用），/s/<id>/view 是只读的浏览页
      let sm = /^\/s\/([a-z0-9][a-z0-9-]{0,47})(\/view)?$/.exec(p);
      if (sm && req.method === 'GET') {
        const ds = loadSystem(sm[1]);
        if (!ds) return send(res, 404, 'not found', 'text/plain');
        return sm[2] ? send(res, 200, systemPage(ds), 'text/html; charset=utf-8') : serveWebIndex(res);
      }
      if (p === '/api/systems' && req.method === 'GET') return send(res, 200, listForUi(hub));
      if (p === '/api/systems/starters' && req.method === 'GET') {
        const seed = Number(url.searchParams.get('seed'));
        return send(res, 200, starterCards(Number.isFinite(seed) && seed ? seed : undefined));
      }
      if (p === '/api/systems' && req.method === 'POST') {
        const ds = createSystem(JSON.parse((await readBody(req, 2e6)).toString('utf8') || '{}'));
        return send(res, 200, { id: ds.id });
      }
      sm = /^\/api\/systems\/([a-z0-9][a-z0-9-]{0,47})(?:\/(duplicate|delete|default|component|file))?$/.exec(p);
      if (sm) {
        const [, id, action] = sm;
        const ds = loadSystem(id);
        if (!ds) return send(res, 404, { error: '设计系统不存在' });
        if (!action && req.method === 'GET') return send(res, 200, detailForUi(hub, ds));
        if (!action && req.method === 'PUT') return send(res, 200, updateSystem(hub, id, JSON.parse((await readBody(req, 4e6)).toString('utf8') || '{}')));
        if (action === 'component' && req.method === 'GET') {
          const name = url.searchParams.get('name') ?? '';
          if (!Object.hasOwn(ds.components, name)) return send(res, 404, 'not found', 'text/plain');
          const theme = url.searchParams.get('theme') ?? ds.color.themes[0].id;
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" });
          return res.end(componentPreview(ds, name, theme));
        }
        if (action === 'file' && req.method === 'GET') {
          const name = url.searchParams.get('name') ?? '';
          if (!['system.json', 'tokens.json', 'tokens.css', 'README.md'].includes(name)) return send(res, 404, 'not found', 'text/plain');
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${name}"` });
          return res.end(fs.readFileSync(path.join(systemDir(id), name)));
        }
        if (req.method === 'POST') {
          const body = JSON.parse((await readBody(req, 1e5)).toString('utf8') || '{}');
          if (action === 'duplicate') return send(res, 200, { id: createSystem({ from: 'copy', ref: id, name: typeof body.name === 'string' ? body.name : undefined }).id });
          if (action === 'delete') return (deleteSystem(id), send(res, 200, { ok: true }));
          if (action === 'default') return (setProjectDefault(id, String(body.cwd ?? ''), body.on !== false), send(res, 200, { ok: true }));
        }
      }

      // 管理 API
      if (p === '/api/canvases' && req.method === 'GET') return send(res, 200, hub.list());
      if (p === '/api/fonts' && req.method === 'GET') return send(res, 200, await listFonts());
      let m = /^\/api\/canvases\/([0-9a-f-]{36})\/(rename|duplicate|delete|versions|restore|doc)$/.exec(p);
      if (m) {
        const [, id, action] = m;
        const body = req.method === 'POST' ? JSON.parse((await readBody(req, 1e6)).toString() || '{}') : {};
        if (action === 'rename' && req.method === 'POST') return (hub.rename(id, String(body.title ?? '')), send(res, 200, { ok: true }));
        if (action === 'duplicate' && req.method === 'POST') return send(res, 200, { id: hub.duplicate(id) });
        if (action === 'delete' && req.method === 'POST') return (hub.trash(id), send(res, 200, { ok: true }));
        // 播放预览跨画布跳转：只读取另一个画布的设计稿
        if (action === 'doc' && req.method === 'GET') {
          const c = hub.get(id);
          return send(res, 200, { doc: c.doc, title: c.meta.title });
        }
        if (action === 'versions' && req.method === 'GET') return send(res, 200, hub.get(id).listVersions());
        if (action === 'versions' && req.method === 'POST') return send(res, 200, { file: hub.get(id).saveVersion(String(body.name || '未命名版本')) });
        if (action === 'restore' && req.method === 'POST') return send(res, 200, { rev: hub.get(id).restoreVersion(String(body.file)).rev });
      }

      // 画布资源
      m = /^\/c\/([0-9a-f-]{36})\/assets\/([a-f0-9]{32}\.[a-z]+)$/.exec(p);
      if (m && req.method === 'GET') {
        const c = hub.get(m[1]);
        const file = path.join(c.dir, 'assets', 'images', m[2]);
        if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
        res.writeHead(200, {
          'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
          'cache-control': 'private, max-age=31536000, immutable',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        });
        return fs.createReadStream(file).pipe(res);
      }
      m = /^\/c\/([0-9a-f-]{36})\/upload$/.exec(p);
      if (m && req.method === 'POST') {
        const c = hub.get(m[1]);
        const buf = await readBody(req, 15 * 1024 * 1024);
        const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'upload'));
        return send(res, 200, storeAsset(c.dir, buf, name, String(req.headers['content-type'] ?? '')));
      }
      m = /^\/c\/([0-9a-f-]{36})\/import$/.exec(p);
      if (m && req.method === 'POST') {
        const c = hub.get(m[1]);
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
        const src = typeof body.src === 'string' ? body.src.trim() : '';
        if (!/^https?:\/\//i.test(src)) return send(res, 400, { error: '只支持 http(s) 图片地址' });
        try {
          const ref = await ingestSrc(c.dir, src, process.cwd());
          if (!ref || !ref.mime?.startsWith('image/')) return send(res, 400, { error: '地址返回的不是图片' });
          return send(res, 200, ref);
        } catch (e) {
          return send(res, 400, { error: (e as Error).message });
        }
      }
      m = /^\/c\/([0-9a-f-]{36})\/export$/.exec(p);
      if (m && req.method === 'GET') {
        const c = hub.get(m[1]);
        const q = url.searchParams;
        const r = buildExport(c.doc, c.dir, {
          foreign: (id) => (hub.exists(id) ? { doc: hub.get(id).doc, dir: hub.get(id).dir } : undefined),
          frameIds: q.get('frames')?.split(',').filter(Boolean),
          inlineImages: q.get('inline') !== '0',
          styleMode: q.get('style') === 'inline' ? 'inline' : 'class',
          widthMode: q.get('width') === 'fill' ? 'fill' : 'fixed',
          split: q.get('split') === '1',
          interactive: q.get('interactive') !== '0',
        });
        res.writeHead(200, {
          'content-type': r.mime,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`,
          'x-design-fonts': encodeURIComponent(JSON.stringify(r.fonts)),
          'x-design-warnings': encodeURIComponent(JSON.stringify(r.warnings)),
        });
        return res.end(r.data);
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      const err = e as CanvasError;
      if (!res.headersSent) send(res, err.code === 'not_found' ? 404 : 400, { error: err.message });
      else res.end();
    }
  });

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!hostOk(req) || !originOk(req) || (url.pathname === '/ws/proxy' && !authed(req, url))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      lastActivity = Date.now();
      if (url.pathname === '/ws/proxy') {
        // MCP 代理的存活连接：断开即清理对应会话
        let sid: string | undefined;
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(String(raw));
            if (msg.session && sessions.has(msg.session)) {
              sid = msg.session;
              sessions.get(sid!)!.proxies++;
            }
          } catch {}
        });
        ws.on('close', () => {
          lastActivity = Date.now();
          const s = sid && sessions.get(sid);
          if (s && --s.proxies <= 0) {
            s.transport.close().catch(() => {});
            closeSession(sid);
          }
        });
        return;
      }
      if (url.pathname === '/ws') {
        const id = url.searchParams.get('canvas') ?? '';
        try {
          hub.get(id).addClient(ws);
        } catch (e) {
          ws.close(4004, (e as Error).message.slice(0, 100));
        }
        return;
      }
      ws.close(4004, 'unknown endpoint');
    });
  });

  // ---------- 端口与锁文件 ----------
  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const onErr = (e: NodeJS.ErrnoException) => {
        server.off('listening', onOk);
        reject(e);
      };
      const onOk = () => {
        server.off('error', onErr);
        resolve(port);
      };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(port, '127.0.0.1');
    });
  let port = BASE_PORT;
  for (;;) {
    try {
      await listen(port);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port > BASE_PORT + 50) throw e;
      port++;
    }
  }
  hub.port = port;
  writeJsonAtomic(DAEMON_FILE, { pid: process.pid, port, token, version: VERSION, build: BUILD_ID, startedAt: Date.now() });
  console.error(`[penhold-mcp] 守护进程已启动 http://127.0.0.1:${port}/  pid=${process.pid}`);

  // ---------- 生命周期 ----------
  let stopping = false;
  const shutdown = (why: string) => {
    if (stopping) return;
    stopping = true;
    console.error(`[penhold-mcp] 守护进程退出：${why}`);
    try {
      hub.closeAll();
    } catch (e) {
      console.error(e);
    }
    const cur = readJson<{ pid?: number }>(DAEMON_FILE, {});
    if (cur.pid === process.pid) fs.rmSync(DAEMON_FILE, { force: true });
    for (const ws of wss.clients) ws.terminate();
    server.close();
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  setInterval(() => {
    const proxies = [...sessions.values()].reduce((n, s) => n + s.proxies, 0);
    // 没有代理连接的直连会话 30 分钟无请求视为断开
    for (const [sid, s] of sessions) if (!s.proxies && Date.now() - s.lastSeen > IDLE_MS) closeSession(sid);
    const active = proxies > 0 || sessions.size > 0 || hub.totalClients() > 0;
    if (active) lastActivity = Date.now();
    else if (Date.now() - lastActivity > IDLE_MS) shutdown('空闲超过 30 分钟');
  }, Math.min(60_000, IDLE_MS / 2)).unref();
  return { port, token, hub };
}

function safeDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s);
  } catch {
    return undefined;
  }
}
