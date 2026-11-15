// 本地设计规范发现：AI 开始绘制前应先阅读的设计 skill 与设计规范文档。
// 守护进程只返回路径与摘要，内容由 AI 用自己的读文件工具读取（skill 可能引用同目录下的其他文件）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface DesignGuide {
  path: string;
  kind: 'skill' | 'doc' | 'custom' | 'builtin';
  name: string;
  description?: string;
}

/** 名称或描述命中即视为设计相关的 skill。 */
const DESIGN_RE = /design|设计|\bui\b|\bux\b|界面|视觉|品牌|brand|style.?guide|样式|token|令牌|figma|组件库|component.?library|typography|排版|配色|color|palette|theme|主题/i;

/** 项目中常见的设计规范文档（相对项目根或其上级目录）。 */
const DOC_NAMES = [
  'DESIGN.md',
  'design.md',
  'DESIGN_SYSTEM.md',
  'design-system.md',
  'STYLEGUIDE.md',
  'styleguide.md',
  'docs/DESIGN.md',
  'docs/design.md',
  'docs/design-system.md',
  'docs/styleguide.md',
  '.claude/design.md',
];

const MAX = 20;

function readHead(file: string): string {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  }
}

/** 解析 SKILL.md 头部的 name / description。 */
function frontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const get = (k: string) => {
    const r = new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(m[1]);
    return r ? r[1].trim().replace(/^["']|["']$/g, '') : undefined;
  };
  return { name: get('name'), description: get('description') };
}

/** 在 skills 目录下找 SKILL.md（最多 3 层，兼容 synced/<id>/<skill>/SKILL.md）。 */
function skillFiles(dir: string, depth = 0, out: string[] = []): string[] {
  if (depth > 3 || out.length > 200) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const f = path.join(dir, e.name);
    if (e.isFile() && e.name === 'SKILL.md') out.push(f);
    else if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') skillFiles(f, depth + 1, out);
  }
  return out;
}

/** 从 cwd 向上到项目根（含 .git 的目录）或家目录为止的目录链。 */
function projectDirs(cwd: string): string[] {
  const home = os.homedir();
  const dirs: string[] = [];
  let d = path.resolve(cwd);
  for (let i = 0; i < 8; i++) {
    dirs.push(d);
    if (fs.existsSync(path.join(d, '.git')) || d === home) break;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return dirs;
}

export function findDesignGuides(cwd: string, extra = process.env.DESIGN_MCP_GUIDES): DesignGuide[] {
  const out: DesignGuide[] = [];
  const seen = new Set<string>();
  const add = (g: DesignGuide) => {
    const real = (() => {
      try {
        return fs.realpathSync(g.path);
      } catch {
        return g.path;
      }
    })();
    if (seen.has(real) || out.length >= MAX) return;
    seen.add(real);
    out.push(g);
  };

  // 1. 用户显式指定：DESIGN_MCP_GUIDES=文件或目录（多个用系统路径分隔符）
  for (const p of (extra ?? '').split(path.delimiter).filter(Boolean)) {
    const abs = path.resolve(cwd, p.replace(/^~(?=$|\/)/, os.homedir()));
    try {
      if (fs.statSync(abs).isDirectory()) {
        const skills = skillFiles(abs);
        if (skills.length) for (const f of skills) add({ path: f, kind: 'custom', ...nameOf(f) });
        else
          for (const e of fs.readdirSync(abs))
            if (/\.(md|mdx|txt)$/i.test(e)) add({ path: path.join(abs, e), kind: 'custom', name: e });
      } else add({ path: abs, kind: 'custom', ...nameOf(abs) });
    } catch {}
  }

  // 2. 设计相关的 skill：项目内（由近到远）优先，再到用户级
  const skillRoots = [...projectDirs(cwd).map((d) => path.join(d, '.claude', 'skills')), path.join(os.homedir(), '.claude', 'skills')];
  for (const root of skillRoots)
    for (const f of skillFiles(root)) {
      const meta = frontmatter(readHead(f));
      const name = meta.name ?? path.basename(path.dirname(f));
      if (DESIGN_RE.test(`${name} ${meta.description ?? ''}`)) add({ path: f, kind: 'skill', name, ...(meta.description ? { description: clip(meta.description) } : {}) });
    }

  // 3. 项目中的设计规范文档
  for (const d of projectDirs(cwd))
    for (const n of DOC_NAMES) {
      const f = path.join(d, n);
      if (fs.existsSync(f)) add({ path: f, kind: 'doc', name: n });
    }
  return out;
}

function nameOf(file: string): { name: string; description?: string } {
  if (path.basename(file) === 'SKILL.md') {
    const m = frontmatter(readHead(file));
    return { name: m.name ?? path.basename(path.dirname(file)), ...(m.description ? { description: clip(m.description) } : {}) };
  }
  return { name: path.basename(file) };
}

const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);
