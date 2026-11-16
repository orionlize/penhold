// 设计系统的存储：每个系统一个目录（system.json + 生成的 README.md、tokens.css、tokens.json），
// 与画布分开保存，同一项目的画布共用一个默认系统。也可导出到项目目录（design-system/），
// 提交进仓库后，其他机器打开同一项目时自动发现。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOME, TRASH_DIR, ensureDir, readJson, writeJsonAtomic } from '../paths.js';
import { flattenSystem, renderReadme, systemCss, type DesignSystem } from '../../core/designSystem.js';
import { validateTokens } from '../../core/schema.js';

export const SYSTEMS_DIR = path.join(HOME, 'systems');
const INDEX = path.join(SYSTEMS_DIR, 'index.json');
/** 导出到项目时的目录名；打开项目时按这个名字查找。 */
export const PROJECT_DIR_NAME = 'design-system';

interface SystemIndex {
  /** 项目目录 → 默认系统 id。 */
  defaults: Record<string, string>;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const systemDir = (id: string) => path.join(SYSTEMS_DIR, id);

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return s || 'ds';
}

export function newSystemId(name: string): string {
  const base = slug(name);
  for (let i = 0; i < 1000; i++) {
    const id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!fs.existsSync(systemDir(id))) return id;
  }
  throw new Error('无法分配设计系统 id');
}

export function loadSystem(id: string): DesignSystem | undefined {
  if (!ID_RE.test(id)) return undefined;
  const ds = readJson<DesignSystem | null>(path.join(systemDir(id), 'system.json'), null);
  return ds && ds.v === 1 ? ds : undefined;
}

/** Claude Design 的 tokens.json 形状（便于在其他工具里使用）。 */
export function claudeTokens(ds: DesignSystem) {
  return {
    name: ds.name,
    version: ds.version,
    color: {
      themes: ds.color.themes,
      tokens: ds.color.tokens.map((t) => ({ name: t.name, value: t.value, ...(t.usage ? { usage: t.usage } : {}) })),
    },
    type: {
      families: ds.type.families,
      groups: [
        {
          name: 'Text',
          styles: ds.type.styles.map((s) => ({
            name: s.name,
            family: s.family,
            fontSize: `${typeof s.size === 'number' ? s.size : (ds.type.scale[s.size] ?? 16)}px`,
            lineHeight: s.lineHeight,
            fontWeight: s.weight,
            ...(s.letterSpacing ? { letterSpacing: `${s.letterSpacing}px` } : {}),
          })),
        },
      ],
    },
    spacing: { tokens: ds.spacing.map((s) => ({ name: `space-${s.name}`, value: s.value, usage: s.usage ?? '' })) },
    radius: { tokens: ds.radius.map((s) => ({ name: `radius-${s.name}`, value: s.value, usage: s.usage ?? '' })) },
    shadow: { tokens: ds.shadow.map((s) => ({ name: `shadow-${s.name}`, value: s.value, usage: s.usage ?? '' })) },
  };
}

function writeFiles(dir: string, ds: DesignSystem) {
  ensureDir(dir);
  writeJsonAtomic(path.join(dir, 'system.json'), ds, true);
  fs.writeFileSync(path.join(dir, 'README.md'), renderReadme(ds));
  fs.writeFileSync(path.join(dir, 'tokens.css'), systemCss(ds));
  writeJsonAtomic(path.join(dir, 'tokens.json'), claudeTokens(ds), true);
}

/** 保存（版本号 +1）并重新生成 README 与 CSS。 */
export function saveSystem(ds: DesignSystem, bump = true): DesignSystem {
  if (!ID_RE.test(ds.id)) throw new Error(`设计系统 id 不合法：${ds.id}`);
  // 与画布令牌同样的取值限制（不含 url()、HTML 等），保证 README、CSS 与安装后的画布都安全
  for (const th of ds.color.themes) validateTokens(flattenSystem(ds, th.id));
  const prev = loadSystem(ds.id);
  const next: DesignSystem = { ...ds, version: prev && bump ? prev.version + 1 : ds.version, updatedAt: Date.now() };
  writeFiles(systemDir(ds.id), next);
  return next;
}

/** 导出到项目目录；返回目录路径。 */
export function exportSystem(ds: DesignSystem, dir: string): string {
  writeFiles(dir, ds);
  return dir;
}

function index(): SystemIndex {
  return readJson<SystemIndex>(INDEX, { defaults: {} });
}

export function setDefaultSystem(cwd: string, id: string | null) {
  const idx = index();
  const key = path.resolve(cwd);
  if (id) idx.defaults[key] = id;
  else delete idx.defaults[key];
  writeJsonAtomic(INDEX, idx, true);
}

/** 各项目目录登记的默认系统（项目目录 → 系统 id）。 */
export function systemDefaults(): Record<string, string> {
  return { ...index().defaults };
}

/** 删除 = 移入回收站，并取消以它为默认系统的项目登记。 */
export function removeSystem(id: string): boolean {
  if (!ID_RE.test(id) || !fs.existsSync(systemDir(id))) return false;
  ensureDir(TRASH_DIR);
  fs.renameSync(systemDir(id), path.join(TRASH_DIR, `system-${id}-${Date.now()}`));
  const idx = index();
  for (const [k, v] of Object.entries(idx.defaults)) if (v === id) delete idx.defaults[k];
  writeJsonAtomic(INDEX, idx, true);
  return true;
}

/** 从 cwd 向上到仓库根（或家目录）为止的目录。 */
function upDirs(cwd: string): string[] {
  const out: string[] = [];
  const home = os.homedir();
  let d = path.resolve(cwd);
  for (let i = 0; i < 8; i++) {
    out.push(d);
    if (fs.existsSync(path.join(d, '.git')) || d === home) break;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return out;
}

/** 项目目录里导出过的系统（design-system/system.json）：首次发现时登记到本机。 */
function projectSystem(cwd: string): { ds: DesignSystem; dir: string } | undefined {
  for (const d of upDirs(cwd)) {
    const dir = path.join(d, PROJECT_DIR_NAME);
    const ds = readJson<DesignSystem | null>(path.join(dir, 'system.json'), null);
    if (!ds || ds.v !== 1 || !ID_RE.test(ds.id)) continue;
    const local = loadSystem(ds.id);
    if (!local || local.version < ds.version) writeFiles(systemDir(ds.id), ds);
    return { ds: loadSystem(ds.id) ?? ds, dir };
  }
  return undefined;
}

/** 项目的默认系统：本机登记的优先，其次是项目里导出的。 */
export function defaultSystem(cwd: string): DesignSystem | undefined {
  const idx = index();
  for (const d of upDirs(cwd)) {
    const id = idx.defaults[d];
    const ds = id ? loadSystem(id) : undefined;
    if (ds) return ds;
  }
  return projectSystem(cwd)?.ds;
}

export interface SystemSummary {
  id: string;
  name: string;
  version: number;
  themes: string[];
  colors: number;
  components: number;
  source?: string;
  readme: string;
  default?: boolean;
}

export function summary(ds: DesignSystem, cwd?: string): SystemSummary {
  const def = cwd ? defaultSystem(cwd)?.id === ds.id : false;
  return {
    id: ds.id,
    name: ds.name,
    version: ds.version,
    themes: ds.color.themes.map((t) => t.id),
    colors: ds.color.tokens.length,
    components: Object.keys(ds.components).length,
    ...(ds.source ? { source: `${ds.source.kind}${ds.source.ref ? `:${ds.source.ref}` : ''}` } : {}),
    readme: path.join(systemDir(ds.id), 'README.md'),
    ...(def ? { default: true } : {}),
  };
}

/** 本机所有系统，按更新时间倒序。 */
export function listSystems(): DesignSystem[] {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(SYSTEMS_DIR).filter((x) => ID_RE.test(x));
  } catch {}
  return ids
    .map(loadSystem)
    .filter((x): x is DesignSystem => !!x)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
