// 文档引擎：唯一写入方。校验、应用、编号、广播、落盘（PRD 第 2、5、8 节）。
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { applyOps, clone, emptyDoc, findFrameOfAddr, getIndex, newId } from '../../core/doc.js';
import { checkUserOps, fieldDiff } from '../../core/edit.js';
import { touchesOf, type Touch } from '../../core/changes.js';
import { validateAnnotation } from '../../core/schema.js';
import type {
  ThemeInfo,
  AiCursor,
  Annotation,
  BriefAnswers,
  BriefForm,
  ClientMsg,
  ComputedSize,
  DesignDoc,
  LockInfo,
  Op,
  Origin,
  PageStatus,
  PlanPage,
  ServerMsg,
  ProbeRequest,
  ProbeResult,
  ShotReport,
  Transaction,
  UiState,
} from '../../core/types.js';
import { flattenSystem, themeKeys } from '../../core/designSystem.js';
import { loadSystem } from '../design/systems.js';
import { directionDetail, type DirectionRecord } from '../design/directions.js';
import { briefRecord, DIRECTION_Q, type BriefRecord } from '../design/brief.js';
import { canvasDir, ensureDir, pidAlive, readJson, writeJsonAtomic } from '../paths.js';

export const CHECKPOINT_EVERY = 200;
const LOCK_IDLE_MS = Number(process.env.DESIGN_MCP_LOCK_IDLE_MS ?? 30_000);
/** 规划里还有未开始的页面时，AI 在页面之间生成大段内容可能较久，空闲超时放宽。 */
const PLAN_IDLE_MS = Number(process.env.DESIGN_MCP_PLAN_IDLE_MS ?? Math.max(LOCK_IDLE_MS, 120_000));
const SCHEMA_VERSION = 1;

export interface SessionMeta {
  canvasId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  aliases: string[];
  schemaVersion: number;
  /** 选用的内置设计预设 id（design_preset use:true 记录）。 */
  preset?: string;
  /** 选定的设计方向（design_direction pick 记录）。 */
  direction?: DirectionRecord;
  /** 最近几批给出的方向卡片 id（新的在前）：用户没选风格时，选中卡片所在批次的其余卡片成为备选风格。 */
  offered?: string[][];
  /** 需求问卷的回答（design_ask）。 */
  brief?: BriefRecord;
  /** 安装到本画布的设计系统（design_system install 记录）：令牌按 theme 展开写入 doc.tokens。 */
  system?: { id: string; version: number; theme: string; installedAt: number };
  /** 从别的画布复制来的画板（frame_create from）：画板 id → 来源画布、画板与复制时的 rev。 */
  basedOn?: Record<string, { canvas: string; frame: string; rev: number }>;
}

interface ChangeRec {
  rev: number;
  origin: Origin;
  ts: number;
  touched: Touch[];
}

interface Lock {
  session: string;
  since: number;
  round: number;
  revs: number[];
  inverses: Op[][];
  timer?: NodeJS.Timeout;
  /** design_plan 声明的页面画板 id（按声明顺序）。 */
  plan: string[];
  planMeta: Map<string, { sections?: string[]; created: boolean }>;
  /** 本轮已经写入过的画板。 */
  started: Set<string>;
  cursor: AiCursor | null;
}

export interface PlanInput {
  frame_id?: string;
  name: string;
  width: number;
  height?: number | 'auto';
  sections?: string[];
}

export class CanvasError extends Error {
  constructor(message: string, public code = 'invalid', public data?: unknown) {
    super(message);
  }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export class Canvas {
  doc: DesignDoc;
  meta: SessionMeta;
  ui: UiState;
  readonly dir: string;
  clients = new Set<WebSocket>();
  lock: Lock | null = null;
  /** 锁因空闲超时释放时暂存的规划：AI 多半还在生成内容，同一会话再次写入时恢复，空画板不回收。 */
  private suspended: Pick<Lock, 'session' | 'plan' | 'planMeta' | 'started'> | null = null;
  notes: Annotation[] = [];
  private notesTimer?: NodeJS.Timeout;
  pendingCheck = new Set<string>();
  /** 正在截图自检的画板。 */
  private shooting: string | null = null;
  private round = 0;
  private lastAiRound: Op[][] = [];
  /** AI 本轮（锁空闲超时后同一会话接着画也算同一轮）与上一轮改动过的画板：交互说明只要求补这些。 */
  aiFrames = new Set<string>();
  /** 每个截图目标最近一次的截图（内存中，供下一次截图做像素对比）。 */
  lastShots = new Map<string, { png: string; rev: number; scale: number }>();
  /** 用户整体回退了 AI 上一轮：下一次 AI 调用时告诉它一次。 */
  aiRoundReverted: { rev: number; ts: number; changes: number } | null = null;
  private userUndo: Op[][] = [];
  private userRedo: Op[][] = [];
  private changes: ChangeRec[] = [];
  /** `${id}.${key}` → 最近一次修改 */
  private lastChange = new Map<string, { rev: number; origin: Origin }>();
  /**
   * 用户改动前的基线值：`${存储节点id}.${字段键}` → 值（null 表示原本未设置）。
   * 用户首次改某字段时记下旧值；改回基线（含撤销）即移除；AI 写入、回退 AI、恢复版本会清除，
   * 即“重置”回到 AI（或初始）给出的值。持久化在 user_base.json。
   */
  private userBase = new Map<string, unknown>();
  private baseRev = 0;
  private saveTimer?: NodeJS.Timeout;
  private uiTimer?: NodeJS.Timeout;
  private txSinceCheckpoint = 0;
  private pending = new Map<string, Pending>();
  private lastUserTx?: { keys: string; ts: number };
  private reqSeq = 0;
  onChange?: () => void;
  /** 画布上正在等待用户回答的需求问卷。 */
  briefForm: BriefForm | null = null;
  private briefWaiters: Array<() => void> = [];
  private briefReroll?: (form: BriefForm) => BriefForm;

  constructor(public readonly id: string, init?: { title?: string; cwd?: string }) {
    this.dir = canvasDir(id);
    const existed = fs.existsSync(path.join(this.dir, 'session.json'));
    ensureDir(path.join(this.dir, 'snapshots'));
    ensureDir(path.join(this.dir, 'assets', 'images'));
    ensureDir(path.join(this.dir, 'exports'));
    this.acquireDirLock();
    const now = Date.now();
    this.meta = readJson<SessionMeta>(path.join(this.dir, 'session.json'), {
      canvasId: id,
      title: init?.title ?? '未命名画布',
      createdAt: now,
      updatedAt: now,
      cwd: init?.cwd ?? process.cwd(),
      aliases: [],
      schemaVersion: SCHEMA_VERSION,
    });
    this.ui = readJson<UiState>(path.join(this.dir, 'ui.json'), { zoom: 1, panX: 40, panY: 40, selection: [], panels: {} });
    const base = readJson<{ rev: number; base: Record<string, unknown> }>(path.join(this.dir, 'user_base.json'), { rev: 0, base: {} });
    this.userBase = new Map(Object.entries(base.base));
    this.baseRev = base.rev;
    this.doc = this.loadDoc();
    this.notes = readJson<Annotation[]>(path.join(this.dir, 'annotations.json'), []);
    if (!existed) this.saveMeta();
  }

  // ---------- 存储 ----------

  private acquireDirLock() {
    const lf = path.join(this.dir, '.lock');
    try {
      const pid = Number(fs.readFileSync(lf, 'utf8'));
      if (pid && pid !== process.pid && pidAlive(pid)) throw new CanvasError(`画布 ${this.id} 正被进程 ${pid} 占用`, 'busy');
    } catch (e) {
      if (e instanceof CanvasError) throw e;
    }
    fs.writeFileSync(lf, String(process.pid));
  }

  releaseDirLock() {
    try {
      fs.unlinkSync(path.join(this.dir, '.lock'));
    } catch {}
  }

  private loadDoc(): DesignDoc {
    const file = path.join(this.dir, 'design.json');
    let doc = readJson<DesignDoc | null>(file, null) ?? emptyDoc(this.id);
    if (doc.schemaVersion !== SCHEMA_VERSION) doc = this.migrate(doc);
    // 重放日志
    const opsFile = path.join(this.dir, 'ops.jsonl');
    const lines = fs.existsSync(opsFile) ? fs.readFileSync(opsFile, 'utf8').split('\n') : [];
    for (const line of lines) {
      if (!line.trim()) continue;
      let tx: Transaction;
      try {
        tx = JSON.parse(line);
      } catch {
        continue; // 未写完的最后一行
      }
      this.trackUndo(tx);
      this.txSinceCheckpoint++;
      if (tx.rev <= doc.rev) continue;
      try {
        applyOps(doc, tx.ops);
        doc.rev = tx.rev;
        if (tx.rev > this.baseRev) this.trackBase(tx);
      } catch (e) {
        console.error(`[canvas ${this.id}] 重放 rev ${tx.rev} 失败：${(e as Error).message}`);
        break;
      }
    }
    const chFile = path.join(this.dir, 'changes.jsonl');
    if (fs.existsSync(chFile)) {
      for (const line of fs.readFileSync(chFile, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const rec: ChangeRec = JSON.parse(line);
          if (rec.rev > doc.rev) continue;
          this.recordChange(rec);
        } catch {}
      }
    }
    return doc;
  }

  private migrate(doc: DesignDoc): DesignDoc {
    const v = (doc as { schemaVersion: number }).schemaVersion;
    if (v > SCHEMA_VERSION) throw new CanvasError(`画布 schemaVersion ${v} 高于当前版本支持的 ${SCHEMA_VERSION}，请升级 penhold-mcp`);
    fs.copyFileSync(path.join(this.dir, 'design.json'), path.join(this.dir, `design.v${v}.bak.json`));
    // 迁移函数随版本发布；当前只有 v1。
    return { ...doc, schemaVersion: 1 };
  }

  private trackUndo(tx: Transaction) {
    if (tx.origin !== 'user') return;
    const k = tx.kind ?? 'normal';
    if (k === 'normal') {
      this.userUndo.push(tx.inverse);
      this.userRedo = [];
    } else if (k === 'undo') {
      this.userUndo.pop();
      this.userRedo.push(tx.inverse);
    } else if (k === 'redo') {
      this.userRedo.pop();
      this.userUndo.push(tx.inverse);
    }
    if (this.userUndo.length > 500) this.userUndo.shift();
  }

  private trackBase(tx: Transaction) {
    this.baseRev = tx.rev;
    if (tx.ops.some((op) => op.op === 'doc_replace')) return this.userBase.clear();
    const user = tx.origin === 'user' && (tx.kind ?? 'normal') !== 'revert_ai' && tx.kind !== 'restore';
    tx.ops.forEach((op, i) => {
      if (op.op !== 'set') return;
      const inv = tx.inverse[tx.inverse.length - 1 - i];
      const before = inv?.op === 'set' ? inv.value : undefined;
      for (const [k, b, a] of fieldDiff(op.field, before, op.value)) {
        const key = `${op.id}.${k}`;
        if (!user) {
          this.userBase.delete(key);
          continue;
        }
        if (!this.userBase.has(key)) this.userBase.set(key, b ?? null);
        if (JSON.stringify(this.userBase.get(key)) === JSON.stringify(a ?? null)) this.userBase.delete(key);
      }
    });
  }

  private recordChange(rec: ChangeRec) {
    this.changes.push(rec);
    for (const t of rec.touched) {
      this.lastChange.set(`${t.id}.${t.key}`, { rev: rec.rev, origin: rec.origin });
      const dot = t.key.indexOf('.');
      if (dot > 0) this.lastChange.set(`${t.id}.${t.key.slice(0, dot)}`, { rev: rec.rev, origin: rec.origin });
    }
  }

  saveMeta() {
    this.meta.updatedAt = Date.now();
    writeJsonAtomic(path.join(this.dir, 'session.json'), this.meta, true);
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 1000);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    writeJsonAtomic(path.join(this.dir, 'design.json'), this.doc);
    writeJsonAtomic(path.join(this.dir, 'user_base.json'), { rev: this.baseRev, base: Object.fromEntries(this.userBase) });
  }

  private checkpoint() {
    this.saveNow();
    const snaps = path.join(this.dir, 'snapshots');
    writeJsonAtomic(path.join(snaps, `${this.doc.rev}.json`), this.doc);
    fs.writeFileSync(path.join(this.dir, 'ops.jsonl'), '');
    this.txSinceCheckpoint = 0;
    // 只保留最近 10 个自动检查点
    const autos = fs
      .readdirSync(snaps)
      .filter((f) => /^\d+\.json$/.test(f))
      .sort((a, b) => parseInt(a) - parseInt(b));
    for (const f of autos.slice(0, -10)) fs.unlinkSync(path.join(snaps, f));
  }

  flush() {
    if (this.saveTimer) this.saveNow();
    if (this.uiTimer) {
      clearTimeout(this.uiTimer);
      writeJsonAtomic(path.join(this.dir, 'ui.json'), this.ui);
    }
  }

  // ---------- 事务 ----------

  /**
   * 提交一个事务：原子应用、追加日志、记录变更、广播。
   * system=true 时跳过用户权限校验（撤销、回退 AI、恢复版本）。
   */
  commit(
    origin: Origin,
    ops: Op[],
    opts: { session?: string; kind?: Transaction['kind']; system?: boolean; plan?: boolean; note?: string } = {},
  ): Transaction {
    if (!ops.length) throw new CanvasError('没有要应用的修改', 'noop');
    if (origin === 'user') {
      if (this.lock) throw new CanvasError('AI 正在修改画布，暂时只读', 'locked');
      if (!opts.system) checkUserOps(ops, this.doc);
    } else if (!this.lock || this.lock.session !== opts.session) {
      throw new CanvasError('AI 写入前必须持有编辑锁', 'locked');
    }
    const prevRev = this.doc.rev;
    const inverse = applyOps(this.doc, ops);
    const tx: Transaction = {
      rev: prevRev + 1,
      origin,
      ts: Date.now(),
      ops,
      inverse,
      session: opts.session ?? origin,
      kind: opts.kind ?? 'normal',
      round: origin === 'ai' ? this.lock?.round : undefined,
    };
    try {
      fs.appendFileSync(path.join(this.dir, 'ops.jsonl'), JSON.stringify(tx) + '\n');
    } catch (e) {
      applyOps(this.doc, inverse);
      throw new CanvasError(`写入操作日志失败：${(e as Error).message}`, 'io');
    }
    this.doc.rev = tx.rev;

    this.trackBase(tx);
    // 变更记录
    const touched: Touch[] = [];
    ops.forEach((op, i) => touched.push(...touchesOf(op, inverse[inverse.length - 1 - i])));
    const rec: ChangeRec = { rev: tx.rev, origin, ts: tx.ts, touched };
    this.recordChange(rec);
    try {
      fs.appendFileSync(path.join(this.dir, 'changes.jsonl'), JSON.stringify(rec) + '\n');
    } catch {}

    if (origin === 'user') {
      // 连续拖拽调节同一组字段（800ms 内）合并为一个撤销步骤
      const keys = touched.map((t) => `${t.id}.${t.key}`).sort().join('|');
      const prev = this.lastUserTx;
      const merge = tx.kind === 'normal' && prev && prev.keys === keys && tx.ts - prev.ts < 800 && this.userUndo.length > 0;
      if (!merge) this.trackUndo(tx);
      this.lastUserTx = tx.kind === 'normal' ? { keys, ts: tx.ts } : undefined;
    } else this.lastUserTx = undefined;
    if (origin === 'ai' && this.lock) {
      this.lock.revs.push(tx.rev);
      this.lock.inverses.push(inverse);
      // 规划操作（建空画板、清理空画板）不算开始绘制，也不要求自检
      if (!opts.plan) {
        const frames = this.framesTouched(touched);
        for (const f of frames) {
          this.pendingCheck.add(f);
          this.lock.started.add(f);
          this.aiFrames.add(f);
        }
        const cur = this.cursorFrom(ops, frames);
        if (cur) this.lock.cursor = { ...cur, status: 'drawing', note: opts.note?.trim() || undefined, at: tx.ts };
      }
      this.armLockTimer();
    }
    if (!this.meta.title || this.meta.title === '未命名画布') {
      const first = this.doc.frames[0];
      if (first) {
        this.meta.title = first.name;
        this.broadcast({ t: 'title', title: first.name });
      }
    }
    this.broadcast({ t: 'tx', rev: tx.rev, origin, ops, ...this.undoInfo() });
    if (this.lock) this.broadcast({ t: 'lock', lock: this.lockInfo() });
    this.scheduleSave();
    if (++this.txSinceCheckpoint >= CHECKPOINT_EVERY) this.checkpoint();
    if (tx.rev % 20 === 0) this.saveMeta();
    this.onChange?.();
    return tx;
  }

  /** 光标落点：最后一个有画板归属的操作目标。 */
  private cursorFrom(ops: Op[], frames: Set<string>): { frame: string; addr: string } | null {
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      const addr =
        op.op === 'insert' ? op.node.id
        : op.op === 'frame_create' ? op.frame.id
        : op.op === 'set' || op.op === 'set_override' || op.op === 'move' || op.op === 'frame_update' ? op.id
        : undefined;
      if (!addr) continue;
      if (this.doc.frames.some((f) => f.id === addr)) return { frame: addr, addr };
      const loc = getIndex(this.doc).get(addr);
      const frame = loc?.frame?.id ?? findFrameOfAddr(this.doc, addr);
      // 组件定义内的节点不在画板 DOM 中，光标落到使用它的画板上
      if (frame) return { frame, addr: loc?.frame ? addr : frame };
    }
    const first = [...frames][0];
    return first ? { frame: first, addr: first } : null;
  }

  private framesTouched(touched: Touch[]): Set<string> {
    const out = new Set<string>();
    const frameIds = new Set(this.doc.frames.map((f) => f.id));
    for (const t of touched) {
      if (t.key === 'frame_removed') continue;
      if (frameIds.has(t.id)) {
        out.add(t.id);
        continue;
      }
      const loc = getIndex(this.doc).get(t.id.split(':')[0]);
      if (loc?.component) {
        // 组件定义变化：所有使用它的画板都要重新自检
        for (const f of this.doc.frames) if (this.frameUses(f.id, loc.component)) out.add(f.id);
      } else {
        const f = findFrameOfAddr(this.doc, t.id);
        if (f) out.add(f);
      }
    }
    return out;
  }

  private frameUses(frameId: string, comp: string): boolean {
    const f = this.doc.frames.find((x) => x.id === frameId);
    if (!f) return false;
    const seen = new Set<string>();
    const visit = (n: DesignDoc['frames'][0]['root']): boolean => {
      if (n.component) {
        if (n.component === comp) return true;
        if (!seen.has(n.component) && this.doc.components[n.component]) {
          seen.add(n.component);
          if (visit(this.doc.components[n.component].root)) return true;
        }
      }
      return (n.children ?? []).some(visit);
    };
    return visit(f.root);
  }

  /** 记下一次截图，返回同一目标的上一次截图（截图比例不同时不返回）。 */
  rememberShot(target: string, png: string, scale: number) {
    const prev = this.lastShots.get(target);
    this.lastShots.delete(target);
    this.lastShots.set(target, { png, rev: this.doc.rev, scale });
    while (this.lastShots.size > 40) this.lastShots.delete(this.lastShots.keys().next().value!);
    return prev && prev.scale === scale ? prev : undefined;
  }

  /** 取走“用户回退了 AI 上一轮”的提醒（只给一次）。 */
  takeRevertNotice() {
    const n = this.aiRoundReverted;
    this.aiRoundReverted = null;
    return n;
  }

  undoInfo() {
    return { userUndo: this.userUndo.length, userRedo: this.userRedo.length, aiRound: this.lastAiRound.length > 0, userBase: Object.fromEntries(this.userBase) };
  }

  undo() {
    const inv = this.userUndo[this.userUndo.length - 1];
    if (!inv) throw new CanvasError('没有可撤销的改动', 'noop');
    return this.commit('user', inv, { kind: 'undo', system: true });
  }

  redo() {
    const ops = this.userRedo[this.userRedo.length - 1];
    if (!ops) throw new CanvasError('没有可重做的改动', 'noop');
    return this.commit('user', ops, { kind: 'redo', system: true });
  }

  /** 整体回退 AI 上一轮（一次持锁期间）的全部写入。 */
  revertAiRound() {
    if (!this.lastAiRound.length) throw new CanvasError('没有可回退的 AI 改动', 'noop');
    const ops = [...this.lastAiRound].reverse().flat();
    this.lastAiRound = [];
    try {
      const tx = this.commit('user', ops, { kind: 'revert_ai', system: true });
      this.aiRoundReverted = { rev: tx.rev, ts: tx.ts, changes: ops.length };
      return tx;
    } catch (e) {
      throw new CanvasError(`回退失败（之后的改动与其冲突）：${(e as Error).message}`);
    }
  }

  // ---------- 编辑锁 ----------

  lockInfo(): LockInfo | null {
    const l = this.lock;
    if (!l) return null;
    const cursor: AiCursor | null = this.shooting
      ? { frame: this.shooting, addr: this.shooting, status: 'checking', at: Date.now() }
      : l.cursor && this.doc.frames.some((f) => f.id === l.cursor!.frame)
        ? l.cursor
        : null;
    return { session: l.session, since: l.since, pendingFrames: [...this.pendingCheck], pages: this.planPages(), cursor };
  }

  /** 规划页面及其状态；锁因空闲超时释放后，暂存的规划仍然算数（画布继续显示骨架屏与各页状态）。 */
  planPages(): PlanPage[] {
    const l = this.lock ?? this.suspended;
    if (!l) return [];
    const cursor = this.lock?.cursor;
    const out: PlanPage[] = [];
    for (const id of l.plan) {
      const f = this.doc.frames.find((x) => x.id === id);
      if (!f) continue;
      let status: PageStatus;
      if (this.shooting === id) status = 'checking';
      else if (!l.started.has(id)) status = 'pending';
      else if (this.pendingCheck.has(id)) status = cursor?.frame === id ? 'drawing' : 'unchecked';
      else status = 'done';
      const sections = l.planMeta.get(id)?.sections;
      out.push({ frame: id, name: f.name, status, empty: !f.root.children?.length, ...(sections?.length ? { sections } : {}) });
    }
    return out;
  }

  /** 规划中尚未画出内容的页面：未开始的，以及规划新建、只设了根节点样式仍为空的。 */
  planOutstanding(): string[] {
    const meta = (this.lock ?? this.suspended)?.planMeta;
    return this.planPages()
      .filter((p) => p.status === 'pending' || (p.empty && meta?.get(p.frame)?.created))
      .map((p) => p.frame);
  }

  /** 规划所属的会话（持锁中，或锁超时后暂存）。 */
  planOwner(): string | undefined {
    return (this.lock ?? this.suspended)?.session;
  }

  /** 锁状态消息：没有锁但有暂存规划时附上规划页面，画布据此继续显示骨架屏。 */
  private lockMsg(): { t: 'lock'; lock: LockInfo | null; pages?: PlanPage[] } {
    const pages = !this.lock && this.suspended ? this.planPages() : [];
    return { t: 'lock', lock: this.lockInfo(), ...(pages.length ? { pages } : {}) };
  }

  /**
   * 声明本轮要画的页面：为新页面建空画板（显示骨架屏），已有画板用 frame_id 纳入规划。
   * 再次调用时整体替换规划；上次规划新建、仍为空且不在新规划中的画板会被删除。
   */
  applyPlan(session: string, pages: PlanInput[]): PlanPage[] {
    const l = this.lock;
    if (!l || l.session !== session) throw new CanvasError('AI 写入前必须持有编辑锁', 'locked');
    const keep = new Set(pages.map((p) => p.frame_id).filter(Boolean) as string[]);
    // 上次规划新建、仍为空的画板：新规划里有同名页面时沿用（frame_id 不变），其余才删除。
    // AI 误以为画板没了而重新规划时，不会把画布上的骨架屏删掉重建，它记着的旧 frame_id 也仍然有效。
    const spare = l.plan.filter((id) => {
      const f = this.doc.frames.find((x) => x.id === id);
      return f && !keep.has(id) && l.planMeta.get(id)?.created && !f.root.children?.length;
    });
    pages = pages.map((p) => {
      if (p.frame_id) return p;
      const i = spare.findIndex((id) => this.doc.frames.find((x) => x.id === id)?.name === p.name);
      return i < 0 ? p : { ...p, frame_id: spare.splice(i, 1)[0] };
    });
    const ops: Op[] = [];
    const removed = spare;
    for (const id of removed) ops.push({ op: 'frame_remove', id });
    const plan: string[] = [];
    const meta = new Map<string, { sections?: string[]; created: boolean }>();
    let index = this.doc.frames.length - removed.length;
    for (const [i, p] of pages.entries()) {
      const sections = p.sections?.map((s) => s.trim()).filter(Boolean).slice(0, 12);
      if (p.frame_id) {
        const f = this.doc.frames.find((x) => x.id === p.frame_id);
        if (!f) throw new CanvasError(`pages[${i}].frame_id：画板 ${p.frame_id} 不存在`, 'not_found');
        if (plan.includes(f.id)) throw new CanvasError(`pages[${i}].frame_id：画板 ${f.id} 重复`);
        const upd: Extract<Op, { op: 'frame_update' }> = { op: 'frame_update', id: f.id };
        if (p.name && p.name !== f.name) upd.name = p.name;
        if (p.width && p.width !== f.width) upd.width = p.width;
        if (p.height !== undefined && p.height !== f.height) upd.height = p.height;
        if (upd.name || upd.width || upd.height) ops.push(upd);
        plan.push(f.id);
        meta.set(f.id, { sections, created: l.planMeta.get(f.id)?.created ?? false });
      } else {
        const id = newId('f');
        ops.push({ op: 'frame_create', index: index++, frame: { id, name: p.name, width: p.width, height: p.height ?? 'auto', root: { id, type: 'page' } } });
        plan.push(id);
        meta.set(id, { sections, created: true });
      }
    }
    if (ops.length) this.commit('ai', ops, { session, plan: true });
    for (const id of removed) this.pendingCheck.delete(id);
    l.plan = plan;
    l.planMeta = meta;
    this.armLockTimer();
    this.broadcast({ t: 'lock', lock: this.lockInfo() });
    return this.planPages();
  }

  /** AI 写入前获取锁：先让画布提交用户正在输入的值，再加锁。 */
  async acquireLock(session: string): Promise<void> {
    if (this.lock) {
      if (this.lock.session === session) return this.armLockTimer();
      throw new CanvasError('画布正被另一会话修改，请稍后再试', 'busy');
    }
    await Promise.allSettled([...this.clients].map((ws) => this.request(ws, { t: 'flush' }, 800)));
    if (this.lock) {
      if ((this.lock as Lock).session === session) return;
      throw new CanvasError('画布正被另一会话修改，请稍后再试', 'busy');
    }
    // 另一会话留下的暂存规划不会再继续：先清掉它的空画板
    if (this.suspended && this.suspended.session !== session) this.dropSuspended(this.suspended.session);
    this.lock = this.makeLock(session);
    this.armLockTimer();
    this.broadcast({ t: 'lock', lock: this.lockInfo() });
  }

  /** 新建锁；同一会话有超时暂存的规划时接着用（画板、区块与已开始状态都保留）。 */
  private makeLock(session: string): Lock {
    const s = this.suspended?.session === session ? this.suspended : null;
    if (s) this.suspended = null;
    else this.aiFrames.clear();
    const plan = s ? s.plan.filter((id) => this.doc.frames.some((f) => f.id === id)) : [];
    return {
      session,
      since: Date.now(),
      round: ++this.round,
      revs: [],
      inverses: [],
      plan,
      planMeta: s ? s.planMeta : new Map(),
      started: s ? s.started : new Set(),
      cursor: null,
    };
  }

  /** 会话结束或被其他会话接手时，清理它超时暂存的规划里仍为空的画板。 */
  dropSuspended(session: string) {
    if (this.lock || this.suspended?.session !== session) return;
    const last = this.lastAiRound;
    this.lock = this.makeLock(session);
    this.releaseLock('session_closed');
    this.lastAiRound = last;
  }

  /** 持锁会话的任何工具调用都算活动：重置空闲计时。 */
  touch(session: string) {
    if (this.lock?.session === session) this.armLockTimer();
  }

  private armLockTimer() {
    if (!this.lock) return;
    clearTimeout(this.lock.timer);
    // 规划页还空着（未开始，或只设了根节点样式、正在生成首块内容；上一次插入报错重试时尤其慢）时放宽超时，
    // 否则 AI 重新生成大段内容期间锁超时，空画板会被当作没画的规划页回收。
    const ms = this.planPages().some((p) => p.empty) ? PLAN_IDLE_MS : LOCK_IDLE_MS;
    this.lock.timer = setTimeout(() => this.releaseLock('timeout'), ms);
  }

  releaseLock(reason: 'checked' | 'timeout' | 'user' | 'session_closed') {
    if (!this.lock) return;
    // 空闲超时只解锁、不回收规划画板：AI 可能还在读规范或生成大段内容，删掉会让它下一次写入找不到画板。
    // 规划暂存起来，同一会话再次写入时恢复；会话结束、用户终止或本轮完成时才清理空画板。
    if (reason === 'timeout') {
      const { session, plan, planMeta, started } = this.lock;
      this.suspended = plan.length ? { session, plan, planMeta, started } : null;
    } else this.dropEmptyPlanned();
    clearTimeout(this.lock.timer);
    if (this.lock.inverses.length) this.lastAiRound = this.lock.inverses;
    this.lock = null;
    this.broadcast(this.lockMsg());
    this.broadcast({ t: 'tx', rev: this.doc.rev, origin: 'ai', ops: [], ...this.undoInfo() });
  }

  /** 结束本轮时删掉规划新建、却始终没画内容的空画板（骨架屏不能留在画布上）。 */
  private dropEmptyPlanned() {
    const l = this.lock;
    if (!l?.plan.length) return;
    const drop = l.plan.filter((id) => {
      const f = this.doc.frames.find((x) => x.id === id);
      return f && l.planMeta.get(id)?.created && !f.root.children?.length;
    });
    l.plan = l.plan.filter((id) => !drop.includes(id));
    if (!drop.length) return;
    try {
      this.commit('ai', drop.map((id) => ({ op: 'frame_remove', id }) as Op), { session: l.session, plan: true });
    } catch (e) {
      console.error(`[canvas ${this.id}] 清理空画板失败：${(e as Error).message}`);
    }
    for (const id of drop) this.pendingCheck.delete(id);
  }

  /** 自检完成：清除待检查画板；全部检查完（且规划的页面都已开始绘制）则释放锁。 */
  markChecked(frameIds: string[]) {
    for (const f of frameIds) this.pendingCheck.delete(f);
    for (const f of [...this.pendingCheck]) if (!this.doc.frames.some((x) => x.id === f)) this.pendingCheck.delete(f);
    if (this.lock && this.pendingCheck.size === 0 && !this.planOutstanding().length) this.releaseLock('checked');
    else if (this.lock) this.broadcast({ t: 'lock', lock: this.lockInfo() });
  }

  // ---------- 变更查询 ----------

  changesSince(sinceRev: number, origin?: Origin) {
    const byId = new Map<string, { id: string; fields: Set<string>; origins: Set<Origin>; rev: number }>();
    for (const rec of this.changes) {
      if (rec.rev <= sinceRev || (origin && rec.origin !== origin)) continue;
      for (const t of rec.touched) {
        const e = byId.get(t.id) ?? { id: t.id, fields: new Set(), origins: new Set(), rev: 0 };
        e.fields.add(t.key);
        e.origins.add(rec.origin);
        e.rev = Math.max(e.rev, rec.rev);
        byId.set(t.id, e);
      }
    }
    return [...byId.values()].map((e) => ({ id: e.id, fields: [...e.fields], origin: [...e.origins], rev: e.rev }));
  }

  /**
   * 子树（含所有实例对其内部节点的覆盖）在 baseRev 之后被用户改过的键。
   * ids 为子树中的存储节点 id；键中任一地址段命中即算。
   */
  userChangedInSubtree(ids: Set<string>, baseRev: number): string[] {
    const out: string[] = [];
    for (const [k, v] of this.lastChange) {
      if (v.origin !== 'user' || v.rev <= baseRev) continue;
      const addr = k.slice(0, k.indexOf('.') < 0 ? k.length : k.indexOf('.'));
      if (addr.split(':').some((seg) => ids.has(seg))) out.push(k);
    }
    return out;
  }

  /** 节点在 baseRev 之后被用户改过的字段键（`${id}.${field}.${sub}` 形式）。 */
  userChangedSince(id: string, baseRev: number): string[] {
    const out: string[] = [];
    for (const [k, v] of this.lastChange) {
      if (v.origin === 'user' && v.rev > baseRev && (k.startsWith(id + '.') || k.startsWith(id + ':'))) out.push(k);
    }
    return out;
  }

  // ---------- 浏览器连接 ----------

  addClient(ws: WebSocket) {
    this.clients.add(ws);
    this.send(ws, { t: 'init', doc: this.doc, lock: this.lockInfo(), pages: this.lockMsg().pages, ui: this.ui, title: this.meta.title, ...this.undoInfo(), notes: this.notes, brief: this.briefForm, themeInfo: this.themeInfo() });
    ws.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.handleClient(ws, msg);
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      this.onChange?.();
    });
    this.onChange?.();
  }

  /** 安装了设计系统时的主题信息（系统被删或只有一个主题时仍返回，由前端决定是否显示）。 */
  themeInfo(): ThemeInfo | null {
    const sys = this.meta.system;
    const ds = sys ? loadSystem(sys.id) : undefined;
    if (!sys || !ds) return null;
    return { system: ds.name, theme: sys.theme, themes: ds.color.themes.map((t) => ({ id: t.id, name: t.name, ...(t.style ? { style: t.style } : {}), ...(t.scheme ? { scheme: t.scheme } : {}), ...(t.mode ? { mode: t.mode } : {}), ...(t.swatch ? { swatch: t.swatch } : {}) })) };
  }

  pushThemeInfo() {
    this.broadcast({ t: 'themeInfo', info: this.themeInfo() });
  }

  /** 用户在 Tweaks 面板切换主题：把该主题的颜色令牌（切换风格时还有字体、圆角、阴影）写进画布（可撤销）。 */
  setSystemTheme(theme: string) {
    if (this.lock) throw new CanvasError('AI 正在修改，请稍后再切换主题');
    const sys = this.meta.system;
    const ds = sys ? loadSystem(sys.id) : undefined;
    if (!sys || !ds || !ds.color.themes.some((t) => t.id === theme)) throw new CanvasError('没有这个主题');
    const switched = themeKeys(ds);
    const next = Object.fromEntries(Object.entries(flattenSystem(ds, theme)).filter(([k, v]) => switched(k) && this.doc.tokens[k] !== v));
    if (Object.keys(next).length) this.commit('user', [{ op: 'set_tokens', tokens: next }], { system: true });
    this.meta.system = { ...sys, theme };
    this.saveMeta();
    this.pushThemeInfo();
  }

  private handleClient(ws: WebSocket, msg: ClientMsg) {
    const fail = (e: unknown, reqId?: string) => this.send(ws, { t: 'error', message: (e as Error).message, reqId });
    try {
      switch (msg.t) {
        case 'tx':
          try {
            this.commit('user', msg.ops);
          } catch (e) {
            fail(e, msg.reqId);
          }
          break;
        case 'undo':
          this.undo();
          break;
        case 'redo':
          this.redo();
          break;
        case 'set_theme':
          this.setSystemTheme(String(msg.theme));
          break;
        case 'revert_ai':
          if (this.lock) throw new CanvasError('AI 正在修改，请先终止');
          this.revertAiRound();
          break;
        case 'unlock':
          this.releaseLock('user');
          break;
        case 'ui':
          this.ui = { ...this.ui, ...msg.ui };
          clearTimeout(this.uiTimer);
          this.uiTimer = setTimeout(() => {
            this.uiTimer = undefined;
            writeJsonAtomic(path.join(this.dir, 'ui.json'), this.ui);
          }, 500);
          break;
        case 'note_put':
          try {
            this.putNote(msg.note);
          } catch (e) {
            // 拒收时把权威列表发回，页面撤掉乐观添加的批注
            this.send(ws, { t: 'notes', notes: this.notes });
            throw new CanvasError(`批注保存失败：${(e as Error).message}`);
          }
          break;
        case 'note_del':
          this.deleteNote(msg.id);
          break;
        case 'brief_answer':
          this.submitBrief(String(msg.id), msg.answers && typeof msg.answers === 'object' ? msg.answers : {}, !!msg.skipped);
          break;
        case 'brief_reroll':
          if (this.briefForm && this.briefForm.id === msg.id && this.briefReroll) {
            this.briefForm = { ...this.briefReroll(this.briefForm), id: this.briefForm.id };
            this.broadcast({ t: 'brief', form: this.briefForm });
          }
          break;
        case 'flushed':
        case 'shot_result':
        case 'probe_result':
        case 'measure_result': {
          const p = this.pending.get(msg.reqId);
          if (!p) break;
          this.pending.delete(msg.reqId);
          clearTimeout(p.timer);
          if (msg.t === 'shot_result' && msg.error) p.reject(new CanvasError(`截图失败：${msg.error}`));
          else if (msg.t === 'probe_result' && msg.error) p.reject(new CanvasError(`状态检查失败：${msg.error}`));
          else p.resolve(msg);
          break;
        }
      }
    } catch (e) {
      fail(e);
    }
  }

  // ---------- 需求问卷 ----------

  /** 在画布上展示问卷；reroll 用于“换一批”视觉方向。 */
  askBrief(form: BriefForm, reroll?: (form: BriefForm) => BriefForm) {
    this.briefForm = form;
    this.briefReroll = reroll;
    this.broadcast({ t: 'brief', form });
  }

  /** 用户提交（或跳过）问卷：记到 session.json；选了视觉方向时一并记为画布的设计方向。 */
  submitBrief(id: string, answers: BriefAnswers, skipped = false) {
    const form = this.briefForm;
    if (!form || form.id !== id) return;
    const rec = briefRecord(form, answers, skipped);
    const pick = rec.answers.find((a) => a.id === DIRECTION_Q);
    if (pick) {
      const d = typeof pick.answer === 'string' ? directionDetail(pick.answer) : undefined;
      if (d) {
        this.meta.direction = { id: d.id, name: d.name, signature: d.signature };
        pick.answer = d.name;
      } else rec.answers.splice(rec.answers.indexOf(pick), 1);
    }
    this.meta.brief = rec;
    this.saveMeta();
    this.briefForm = null;
    this.briefReroll = undefined;
    this.broadcast({ t: 'brief', form: null });
    for (const w of this.briefWaiters.splice(0)) w();
  }

  /** 等待用户回答；超时返回 false（问卷仍留在画布上）。 */
  waitBrief(ms: number): Promise<boolean> {
    if (!this.briefForm) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.briefWaiters = this.briefWaiters.filter((w) => w !== done);
        resolve(false);
      }, ms);
      this.briefWaiters.push(done);
    });
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMsg) {
    const s = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(s);
  }

  private request<T>(ws: WebSocket, msg: Record<string, unknown>, timeout: number): Promise<T> {
    const reqId = `r${++this.reqSeq}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new CanvasError('画布页面响应超时', 'timeout'));
      }, timeout);
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send(ws, { ...msg, reqId } as unknown as ServerMsg);
    });
  }

  private pickClient(): WebSocket {
    const list = [...this.clients].filter((w) => w.readyState === 1);
    if (!list.length) throw new CanvasError('画布页面未连接', 'offline');
    return list[list.length - 1];
  }

  async screenshot(target: string, scale: number): Promise<{ png: string; report: ShotReport }> {
    const ws = this.pickClient();
    const frame = this.doc.frames.some((f) => f.id === target) ? target : findFrameOfAddr(this.doc, target);
    if (this.lock && frame) {
      this.shooting = frame;
      this.broadcast({ t: 'lock', lock: this.lockInfo() });
    }
    try {
      const r = await this.request<{ png?: string; report?: ShotReport }>(ws, { t: 'shot', target, scale }, 30_000);
      if (!r.png || !r.report) throw new CanvasError('截图结果为空');
      return { png: r.png, report: r.report };
    } finally {
      if (this.shooting) {
        this.shooting = null;
        if (this.lock) this.broadcast({ t: 'lock', lock: this.lockInfo() });
      }
    }
  }

  /** 交互状态检查：画布页面在隐藏 iframe 中逐个渲染状态并检查，不影响用户看到的画布。 */
  async probe(req: ProbeRequest): Promise<ProbeResult[]> {
    const ws = this.pickClient();
    if (this.lock) {
      this.shooting = req.frame;
      this.broadcast({ t: 'lock', lock: this.lockInfo() });
    }
    try {
      const r = await this.request<{ results?: ProbeResult[] }>(ws, { t: 'probe', req }, 60_000);
      if (!r.results) throw new CanvasError('状态检查结果为空');
      return r.results;
    } finally {
      if (this.shooting) {
        this.shooting = null;
        if (this.lock) this.broadcast({ t: 'lock', lock: this.lockInfo() });
      }
    }
  }

  async measure(ids: string[]): Promise<Record<string, ComputedSize>> {
    if (!this.clients.size) return {};
    try {
      const r = await this.request<{ sizes: Record<string, ComputedSize> }>(this.pickClient(), { t: 'measure', ids }, 5000);
      return r.sizes;
    } catch {
      return {};
    }
  }

  // ---------- 版本 ----------

  listVersions() {
    const dir = path.join(this.dir, 'snapshots');
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const m = /^(\d+)(?:@(.+))?\.json$/.exec(f);
        return m ? { file: f, rev: Number(m[1]), name: m[2] ? decodeURIComponent(m[2]) : null, ts: fs.statSync(path.join(dir, f)).mtimeMs } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b!.rev - a!.rev);
  }

  saveVersion(name: string) {
    const safe = encodeURIComponent(name.slice(0, 60));
    const file = `${this.doc.rev}@${safe}.json`;
    writeJsonAtomic(path.join(this.dir, 'snapshots', file), this.doc);
    return file;
  }

  restoreVersion(file: string) {
    if (!/^\d+(@[^/\\]+)?\.json$/.test(file)) throw new CanvasError('非法版本文件');
    const snap = readJson<DesignDoc | null>(path.join(this.dir, 'snapshots', file), null);
    if (!snap) throw new CanvasError('版本不存在');
    const { rev: _r, ...rest } = snap;
    return this.commit('user', [{ op: 'doc_replace', doc: clone(rest) }], { kind: 'restore', system: true });
  }

  // ---------- 批注（评论、便签、手绘） ----------

  putNote(input: Annotation) {
    const note = validateAnnotation(input) as Annotation;
    const i = this.notes.findIndex((n) => n.id === note.id);
    if (i < 0 && this.notes.length >= 2000) throw new CanvasError('批注过多（上限 2000）');
    if (note.kind === 'comment') note.n = i >= 0 ? this.notes[i].n : Math.max(0, ...this.notes.map((n) => n.n ?? 0)) + 1;
    else delete note.n;
    if (i >= 0) this.notes[i] = note;
    else this.notes.push(note);
    this.notesChanged();
  }

  deleteNote(id: string) {
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.notes.length !== before) this.notesChanged();
  }

  private notesChanged() {
    this.broadcast({ t: 'notes', notes: this.notes });
    clearTimeout(this.notesTimer);
    this.notesTimer = setTimeout(() => this.saveNotes(), 300);
  }

  private saveNotes() {
    this.notesTimer = undefined;
    writeJsonAtomic(path.join(this.dir, 'annotations.json'), this.notes);
  }

  close() {
    if (this.notesTimer) (clearTimeout(this.notesTimer), this.saveNotes());
    this.flush();
    this.saveMeta();
    for (const p of this.pending.values()) clearTimeout(p.timer);
    if (this.lock?.timer) clearTimeout(this.lock.timer);
    this.releaseDirLock();
  }
}
