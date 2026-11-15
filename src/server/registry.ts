// 画布注册表：全局索引 index.json、别名表、已打开画布缓存（PRD 第 8 节）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Canvas, CanvasError } from './canvas.js';
import { openBrowser } from './browser.js';
import { CANVASES_DIR, HOST_SESSIONS_DIR, INDEX_FILE, TRASH_DIR, canvasDir, ensureDir, readJson, writeJsonAtomic } from './paths.js';

export interface IndexEntry {
  title: string;
  cwd: string;
  aliases: string[];
  createdAt: number;
  updatedAt: number;
}

interface IndexFile {
  canvases: Record<string, IndexEntry>;
  aliases: Record<string, string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class Registry {
  private index: IndexFile;
  private open = new Map<string, Canvas>();
  port = 0;
  token = '';
  onActivity?: () => void;

  constructor() {
    ensureDir(CANVASES_DIR);
    this.index = readJson<IndexFile>(INDEX_FILE, { canvases: {}, aliases: {} });
    // 索引缺失的画布目录补登记
    for (const id of fs.readdirSync(CANVASES_DIR)) {
      if (!UUID_RE.test(id) || this.index.canvases[id]) continue;
      const meta = readJson<{ title?: string; cwd?: string; createdAt?: number; updatedAt?: number } | null>(
        path.join(canvasDir(id), 'session.json'),
        null,
      );
      if (meta)
        this.index.canvases[id] = {
          title: meta.title ?? '未命名画布',
          cwd: meta.cwd ?? '',
          aliases: [],
          createdAt: meta.createdAt ?? Date.now(),
          updatedAt: meta.updatedAt ?? Date.now(),
        };
    }
  }

  saveIndex() {
    writeJsonAtomic(INDEX_FILE, this.index, true);
  }

  exists(id: string) {
    return UUID_RE.test(id) && fs.existsSync(path.join(canvasDir(id), 'session.json'));
  }

  get(id: string): Canvas {
    const c = this.open.get(id);
    if (c) return c;
    if (!this.exists(id)) throw new CanvasError(`画布 ${id} 不存在`, 'not_found');
    return this.load(id);
  }

  private load(id: string, init?: { title?: string; cwd?: string }): Canvas {
    const c = new Canvas(id, init);
    c.onChange = () => {
      const e = this.index.canvases[id];
      if (e) {
        e.updatedAt = Date.now();
        e.title = c.meta.title;
        this.scheduleIndexSave();
      }
      this.onActivity?.();
    };
    this.open.set(id, c);
    return c;
  }

  private indexTimer?: NodeJS.Timeout;
  private scheduleIndexSave() {
    clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => this.saveIndex(), 2000);
  }

  create(init: { title?: string; cwd: string }): Canvas {
    const id = crypto.randomUUID();
    const c = this.load(id, init);
    this.index.canvases[id] = { title: c.meta.title, cwd: init.cwd, aliases: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.saveIndex();
    return c;
  }

  list() {
    return Object.entries(this.index.canvases)
      .filter(([id]) => this.exists(id))
      .map(([id, e]) => ({ id, ...e, online: (this.open.get(id)?.clients.size ?? 0) > 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 当前工作目录下最近的画布（兜底规则）。 */
  recent(cwd: string, limit = 8) {
    return this.list()
      .filter((c) => c.cwd === cwd)
      .slice(0, limit)
      .map(({ id, title, updatedAt }) => ({ canvas_id: id, title, updated_at: new Date(updatedAt).toISOString() }));
  }

  addAlias(hostSession: string, id: string) {
    if (this.index.aliases[hostSession] === id) return;
    this.index.aliases[hostSession] = id;
    const e = this.index.canvases[id];
    if (e && !e.aliases.includes(hostSession)) e.aliases.push(hostSession);
    const c = this.open.get(id);
    if (c && !c.meta.aliases.includes(hostSession)) {
      c.meta.aliases.push(hostSession);
      c.saveMeta();
    }
    this.saveIndex();
  }

  lookupAlias(hostSession: string): string | undefined {
    const id = this.index.aliases[hostSession];
    return id && this.exists(id) ? id : undefined;
  }

  /** 由 MCP 代理的祖先进程链找到 SessionStart hook 上报的宿主会话 id。 */
  hostSessionFor(ancestors: number[]): string | undefined {
    for (const pid of ancestors) {
      const rec = readJson<{ sessionId?: string } | null>(path.join(HOST_SESSIONS_DIR, `${pid}.json`), null);
      if (rec?.sessionId) return rec.sessionId;
    }
    return undefined;
  }

  url(id?: string) {
    const base = `http://127.0.0.1:${this.port}`;
    return id ? `${base}/c/${id}` : `${base}/`;
  }

  /** 写工具前确保画布页面在线：没有则打开浏览器并等待连接。 */
  async ensureBrowser(c: Canvas, timeoutMs = Number(process.env.DESIGN_MCP_BROWSER_TIMEOUT_MS ?? 20_000)): Promise<void> {
    if (c.clients.size) return;
    openBrowser(this.url(c.id));
    const start = Date.now();
    while (!c.clients.size) {
      if (Date.now() - start > timeoutMs)
        throw new CanvasError(`浏览器画布未在 ${Math.round(timeoutMs / 1000)} 秒内连接。请手动打开 ${this.url(c.id)} 后重试`, 'offline');
      await new Promise((r) => setTimeout(r, 200));
    }
    // 等待首帧渲染
    await new Promise((r) => setTimeout(r, 300));
  }

  rename(id: string, title: string) {
    const c = this.get(id);
    c.meta.title = title.slice(0, 120);
    c.saveMeta();
    c.broadcast({ t: 'title', title: c.meta.title });
    this.index.canvases[id].title = c.meta.title;
    this.saveIndex();
  }

  duplicate(id: string): string {
    const src = this.get(id);
    src.flush();
    const nid = crypto.randomUUID();
    const dest = canvasDir(nid);
    fs.cpSync(src.dir, dest, { recursive: true, filter: (p) => !p.endsWith('.lock') });
    const meta = readJson<Record<string, unknown>>(path.join(dest, 'session.json'), {});
    const doc = readJson<Record<string, unknown>>(path.join(dest, 'design.json'), {});
    const title = `${src.meta.title} 副本`;
    writeJsonAtomic(path.join(dest, 'session.json'), { ...meta, canvasId: nid, title, aliases: [], createdAt: Date.now(), updatedAt: Date.now() }, true);
    if (doc.canvasId) writeJsonAtomic(path.join(dest, 'design.json'), { ...doc, canvasId: nid });
    this.index.canvases[nid] = { ...this.index.canvases[id], title, aliases: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.saveIndex();
    return nid;
  }

  /** 删除 = 移入回收站，不直接抹除。 */
  trash(id: string) {
    const c = this.open.get(id);
    if (c) {
      if (c.clients.size) for (const ws of c.clients) ws.close(4000, 'canvas deleted');
      c.close();
      this.open.delete(id);
    }
    ensureDir(TRASH_DIR);
    fs.renameSync(canvasDir(id), path.join(TRASH_DIR, `${id}-${Date.now()}`));
    delete this.index.canvases[id];
    for (const [k, v] of Object.entries(this.index.aliases)) if (v === id) delete this.index.aliases[k];
    this.saveIndex();
  }

  totalClients() {
    let n = 0;
    for (const c of this.open.values()) n += c.clients.size;
    return n;
  }

  closeAll() {
    for (const c of this.open.values()) c.close();
    this.saveIndex();
  }

  openCanvases() {
    return [...this.open.values()];
  }
}
