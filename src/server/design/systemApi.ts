// 设计系统的管理接口（给浏览器里的编辑页用）：列表、新建、保存、复制、删除、设为项目默认。
// 用户在 /s/<id> 页面里改颜色、字体、间距等，保存后同步到所有安装了这个系统的画布。
import path from 'node:path';
import { z } from 'zod';
import { CanvasError } from '../canvas/canvas.js';
import type { Registry } from '../canvas/registry.js';
import { canvasDir, readJson } from '../paths.js';
import { suggestDirections, systemFromDirection } from './directions.js';
import { listSystems, loadSystem, newSystemId, removeSystem, saveSystem, setDefaultSystem, systemDefaults } from './systems.js';
import {
  auditContrast,
  deriveTheme,
  fixContrast,
  flattenSystem,
  importCss,
  importTokensJson,
  lintSystem,
  systemFromFlat,
  systemFromImport,
  type DesignSystem,
} from '../../core/designSystem.js';
import { HEX6, fromOklch, onColor, toOklch } from '../../core/color.js';

// ---------- 校验 ----------

const NAME = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/, '名字只能含字母、数字、- 和 _，最长 40');
const usage = z.string().max(300).optional();
const Length = z.object({ name: NAME, value: z.string().trim().min(1).max(300), usage });
const brandText = z.string().max(2000).optional();

const SystemInput = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(80),
  device: z.enum(['mobile', 'desktop']),
  brand: z
    .object({
      concept: brandText,
      motif: brandText,
      signature: brandText,
      mood: brandText,
      shape: brandText,
      layout: brandText,
      typography: brandText,
      avoid: z.array(z.string().max(300)).max(30).optional(),
      notes: z.string().max(8000).optional(),
    })
    .default({}),
  color: z.object({
    themes: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, '主题 id 只能含小写字母、数字和 -'),
          name: z.string().trim().min(1).max(40),
          scheme: z.string().trim().min(1).max(24).optional(),
          mode: z.enum(['light', 'dark']).optional(),
          swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        }),
      )
      .min(1)
      .max(12),
    tokens: z
      .array(z.object({ name: NAME, value: z.record(z.string(), z.string().trim().min(1).max(200)), usage, on: z.array(NAME).max(8).optional(), ui: z.boolean().optional() }))
      .max(120),
  }),
  type: z.object({
    families: z.record(NAME, z.string().trim().min(1).max(400)),
    scale: z.record(NAME, z.number().min(6).max(400)),
    styles: z
      .array(
        z.object({
          name: NAME,
          size: z.union([NAME, z.number().min(6).max(400)]),
          lineHeight: z.number().min(0.8).max(3),
          weight: z.number().int().min(100).max(900),
          family: NAME,
          letterSpacing: z.number().min(-10).max(20).optional(),
          usage,
        }),
      )
      .max(40),
  }),
  spacing: z.array(Length).max(40),
  radius: z.array(Length).max(40),
  shadow: z.array(Length).max(40),
  /** 只能保留或删除已有组件、改用途；组件结构仍由 AI 在画布里画好后存入。 */
  components: z.record(z.string(), z.object({ usage }).loose()).optional(),
});

const invalid = (msg: string) => new CanvasError(msg, 'invalid');

function dup(list: Array<{ name: string }>, what: string) {
  const seen = new Set<string>();
  for (const x of list) {
    if (seen.has(x.name)) throw invalid(`${what}「${x.name}」重复`);
    seen.add(x.name);
  }
}

/** 把浏览器提交的内容整理成可保存的系统：结构校验、名字去重、颜色只留现有主题的值；组件结构取自原系统。 */
export function sanitizeSystem(input: unknown, prev: DesignSystem): DesignSystem {
  const r = SystemInput.safeParse(input);
  if (!r.success) throw invalid(r.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}：${i.message}`).join('；'));
  const v = r.data;
  dup(v.color.themes.map((t) => ({ name: t.id })), '主题');
  dup(v.color.tokens, '颜色');
  dup(v.type.styles, '文字样式');
  dup(v.spacing, '间距');
  dup(v.radius, '圆角');
  dup(v.shadow, '阴影');
  const themeIds = v.color.themes.map((t) => t.id);
  const tokens = v.color.tokens.map((t) => {
    const value = Object.fromEntries(Object.entries(t.value).filter(([k]) => themeIds.includes(k)));
    if (!value[themeIds[0]]) throw invalid(`颜色「${t.name}」在默认主题下没有值`);
    return { name: t.name, value, ...(t.usage ? { usage: t.usage } : {}), ...(t.on?.length ? { on: t.on } : {}), ...(t.ui !== undefined ? { ui: t.ui } : {}) };
  });
  const clean = (list: Array<{ name: string; value: string; usage?: string }>) => list.map((x) => ({ name: x.name, value: x.value, ...(x.usage ? { usage: x.usage } : {}) }));
  const components: DesignSystem['components'] = {};
  for (const [name, c] of Object.entries(v.components ?? prev.components)) {
    const old = prev.components[name];
    if (!old) continue;
    const { usage: _u, ...def } = old;
    components[name] = { ...def, ...(c.usage ? { usage: c.usage } : {}) };
  }
  const brand = Object.fromEntries(
    Object.entries(v.brand)
      .map(([k, x]) => [k, Array.isArray(x) ? x.map((s) => s.trim()).filter(Boolean) : typeof x === 'string' ? x.trim() : x] as const)
      .filter(([, x]) => (Array.isArray(x) ? x.length : x)),
  ) as DesignSystem['brand'];
  return {
    v: 1,
    id: prev.id,
    name: v.name,
    version: prev.version,
    updatedAt: prev.updatedAt,
    ...(prev.source ? { source: prev.source } : {}),
    device: v.device,
    brand,
    color: { themes: v.color.themes, tokens },
    type: {
      families: v.type.families,
      scale: v.type.scale,
      styles: v.type.styles.map((s) => ({
        name: s.name,
        size: s.size,
        lineHeight: s.lineHeight,
        weight: s.weight,
        family: s.family,
        ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : {}),
        ...(s.usage ? { usage: s.usage } : {}),
      })),
    },
    spacing: clean(v.spacing),
    radius: clean(v.radius),
    shadow: clean(v.shadow),
    components,
  };
}

// ---------- 新建 ----------

/** 空白起点：中性灰阶加一个主色，亮 / 暗两套主题，对比度修正到达标。 */
export function blankSystem(o: { id: string; name: string; device?: 'mobile' | 'desktop'; primary?: string }): DesignSystem {
  const primary = o.primary && HEX6.test(o.primary) ? o.primary.toUpperCase() : '#2563EB';
  const [, c, h] = toOklch(primary);
  const accent = fromOklch([0.62, Math.max(c, 0.12), (h + 60) % 360]);
  const ds = systemFromFlat(
    {
      'color.bg': '#FFFFFF',
      'color.fg': '#18181B',
      'color.card': '#FFFFFF',
      'color.card-fg': '#18181B',
      'color.muted': '#F4F4F5',
      'color.muted-fg': '#63636E',
      'color.border': '#E4E4E7',
      'color.input': '#8E8E99',
      'color.primary': primary,
      'color.on-primary': onColor(primary),
      'color.accent': accent,
      'color.danger': '#DC2626',
      'color.on-danger': '#FFFFFF',
      'color.success': '#15803D',
      'color.warning': '#B45309',
      'shadow.sm': '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1)',
      'shadow.md': '0 4px 6px rgba(0,0,0,0.07), 0 10px 15px rgba(0,0,0,0.1)',
    },
    { id: o.id, name: o.name, device: o.device ?? 'mobile', source: { kind: 'manual' } },
  );
  fixContrast(ds);
  deriveTheme(ds, 'light', { id: 'dark', name: '暗色' }, 'dark');
  fixContrast(ds);
  return ds;
}

/** 新建页给出的起点：几张风格方向卡片（与 AI 用的是同一套）。 */
export function starterCards(seed?: number) {
  return suggestDirections({ count: 5, ...(seed !== undefined ? { seed } : {}) }).map((c) => ({ id: c.id, name: c.name, mood: c.mood, palette: c.palette, fonts: c.fonts, shape: c.shape }));
}

export interface CreateInput {
  name?: string;
  device?: 'mobile' | 'desktop';
  /** blank：空白；direction：风格方向卡片；css：粘贴的 CSS 变量；json：tokens.json / system.json；copy：复制已有系统。 */
  from?: 'blank' | 'direction' | 'css' | 'json' | 'copy';
  /** direction 的卡片 id，或 copy 的系统 id。 */
  ref?: string;
  primary?: string;
  /** css / json 的内容。 */
  text?: string;
}

export function createSystem(body: CreateInput): DesignSystem {
  const from = body.from ?? 'blank';
  const device = body.device === 'desktop' ? 'desktop' : 'mobile';
  const primary = body.primary && HEX6.test(body.primary) ? body.primary : undefined;
  const src = from === 'copy' ? loadSystem(String(body.ref ?? '')) : undefined;
  if (from === 'copy' && !src) throw new CanvasError('要复制的设计系统不存在', 'not_found');
  const name = (body.name ?? '').trim().slice(0, 80) || (src ? `${src.name} 副本` : '我的设计系统');
  const id = newSystemId(name);
  let ds: DesignSystem | undefined;
  if (from === 'copy') ds = { ...structuredClone(src!), id, name, version: 1, source: { kind: 'manual', ref: src!.id } };
  else if (from === 'direction') {
    ds = systemFromDirection(String(body.ref ?? ''), { id, name, device, ...(primary ? { primary } : {}) });
    if (!ds) throw invalid('这张风格卡片已失效，换一批后重选');
  } else if (from === 'css' || from === 'json') {
    const text = String(body.text ?? '');
    if (!text.trim()) throw invalid('没有可导入的内容');
    if (from === 'json') {
      let j: unknown;
      try {
        j = JSON.parse(text);
      } catch {
        throw invalid('不是合法的 JSON');
      }
      const full = j as DesignSystem;
      if (full && full.v === 1 && full.color?.themes && full.type?.styles) ds = sanitizeSystem(full, { ...full, id, version: 1, updatedAt: Date.now(), components: {}, source: { kind: 'import' } });
      else {
        const imp = importTokensJson(j);
        if (!imp) throw invalid('认不出这个 JSON：支持 Claude Design 的 tokens.json 与 penhold-mcp 的 system.json');
        ds = systemFromImport(imp, { id, name, device });
      }
      ds.name = name;
    } else {
      const imp = importCss(text);
      if (!Object.keys(imp.themes).length) throw invalid('没有可识别的 CSS 变量（--color-*、--font-*、--text-*、--radius-*、--spacing-*、shadcn 的 --primary 等）');
      ds = systemFromImport(imp, { id, name, device });
    }
  } else ds = blankSystem({ id, name, device, ...(primary ? { primary } : {}) });
  return saveSystem(ds, false);
}

// ---------- 列表与详情 ----------

const metaSystem = (canvasId: string) => readJson<{ system?: { id: string } } | null>(path.join(canvasDir(canvasId), 'session.json'), null)?.system?.id;

/** 安装了各系统的画布。 */
function canvasesBySystem(hub: Registry): Map<string, Array<{ id: string; title: string }>> {
  const out = new Map<string, Array<{ id: string; title: string }>>();
  for (const e of hub.list()) {
    const sid = metaSystem(e.id);
    if (!sid) continue;
    out.set(sid, [...(out.get(sid) ?? []), { id: e.id, title: e.title }]);
  }
  return out;
}

export function listForUi(hub: Registry) {
  const defaults = systemDefaults();
  const used = canvasesBySystem(hub);
  return listSystems().map((ds) => {
    const flat = flattenSystem(ds);
    return {
      id: ds.id,
      name: ds.name,
      version: ds.version,
      updatedAt: ds.updatedAt,
      device: ds.device,
      themes: ds.color.themes.map((t) => t.name),
      colors: ds.color.tokens.length,
      components: Object.keys(ds.components).length,
      swatch: ['bg', 'fg', 'primary', 'accent', 'muted'].map((k) => flat[`color.${k}`]).filter(Boolean),
      projects: Object.entries(defaults)
        .filter(([, id]) => id === ds.id)
        .map(([cwd]) => cwd),
      canvases: used.get(ds.id)?.length ?? 0,
    };
  });
}

export function detailForUi(hub: Registry, ds: DesignSystem) {
  const defaults = systemDefaults();
  const projects = [...new Set([...hub.list().map((c) => c.cwd), ...Object.keys(defaults)].filter(Boolean))].sort();
  return {
    system: ds,
    /** 已知的项目目录，以及各自当前的默认系统。 */
    projects: projects.map((cwd) => ({ cwd, system: defaults[path.resolve(cwd)] ?? null })),
    canvases: canvasesBySystem(hub).get(ds.id) ?? [],
  };
}

// ---------- 保存与同步 ----------

/** 把系统的最新令牌写进安装了它的画布（保持各画布选定的主题）。AI 正在修改的画布跳过，AI 下次打开时会看到版本提示。 */
export function syncCanvases(hub: Registry, ds: DesignSystem): { synced: number; skipped: number } {
  let synced = 0;
  let skipped = 0;
  for (const e of hub.list()) {
    if (metaSystem(e.id) !== ds.id) continue;
    const c = hub.get(e.id);
    const cur = c.meta.system;
    if (!cur || cur.id !== ds.id) continue;
    if (c.lock) {
      skipped++;
      continue;
    }
    const theme = ds.color.themes.some((t) => t.id === cur.theme) ? cur.theme : ds.color.themes[0].id;
    const tokens = flattenSystem(ds, theme);
    const changed = Object.fromEntries(Object.entries(tokens).filter(([k, v]) => c.doc.tokens[k] !== v));
    if (Object.keys(changed).length) c.commit('user', [{ op: 'set_tokens', tokens: changed }], { system: true });
    c.meta.system = { ...cur, version: ds.version, theme };
    c.saveMeta();
    synced++;
  }
  return { synced, skipped };
}

export function updateSystem(hub: Registry, id: string, input: unknown) {
  const prev = loadSystem(id);
  if (!prev) throw new CanvasError('设计系统不存在', 'not_found');
  const saved = saveSystem(sanitizeSystem(input, prev));
  return { system: saved, ...syncCanvases(hub, saved), contrast: auditContrast(saved).length, warnings: lintSystem(saved) };
}

export function deleteSystem(id: string) {
  if (!removeSystem(id)) throw new CanvasError('设计系统不存在', 'not_found');
}

/** 设为（或取消）某个项目目录的默认系统：该项目的新画布首次写入时自动安装。 */
export function setProjectDefault(id: string, cwd: string, on: boolean) {
  if (!loadSystem(id)) throw new CanvasError('设计系统不存在', 'not_found');
  if (!cwd || !path.isAbsolute(cwd)) throw invalid('项目目录要写绝对路径');
  if (on) setDefaultSystem(cwd, id);
  else if (systemDefaults()[path.resolve(cwd)] === id) setDefaultSystem(cwd, null);
}
