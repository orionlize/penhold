// 设计体检的自动修复（design_lint_fix）：只做确定安全的机械替换，判断性的提醒（层级、粗体、胶囊…）仍由 AI 自己改。
// - off_scale：文字直接写的阶梯外字号 → 最接近的 size.* 令牌
// - off_space：padding / margin / gap / rowGap 直接写的阶梯外数字 → 最接近的 space.* 令牌
// - off_radius：阶梯外的圆角数字 → 最接近的 radius.* 令牌（四角不同的造型圆角不动）
// - raw_colors：与某个 color.* 令牌取值完全相同的色值 → 该令牌（同值的令牌有多个且按用途分不出时跳过）
// 与 designLint.ts 的判定条件保持一致：体检不会报的值这里也不改。前后端共用，不依赖 DOM / Node。
import { inferRender } from './doc.js';
import type { DesignDoc, Frame, Node } from './types.js';

export type FixKind = 'off_scale' | 'off_space' | 'off_radius' | 'raw_colors';
export const FIX_KINDS: FixKind[] = ['off_scale', 'off_space', 'off_radius', 'raw_colors'];

export interface FixChange {
  kind: FixKind;
  /** 节点 id（组件内节点即组件定义里的 id，改动同步到所有实例）。 */
  id: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface FixSkip {
  kind: FixKind;
  id: string;
  field: string;
  value: unknown;
  reason: string;
}

export interface FixPlan {
  /** 按节点聚合的补丁，可直接交给 updateOps。 */
  patches: Array<{ id: string; patch: { style?: Record<string, unknown>; box?: Record<string, unknown>; layout?: Record<string, unknown> } }>;
  changes: FixChange[];
  skipped: FixSkip[];
}

const TOKEN_RE = /^\{([a-zA-Z0-9_.-]+)\}$/;
const isToken = (v: unknown) => typeof v === 'string' && TOKEN_RE.test(v.trim());

function resolve(doc: DesignDoc, v: unknown, depth = 0): unknown {
  const m = typeof v === 'string' ? TOKEN_RE.exec(v.trim()) : null;
  if (m && depth < 4) return resolve(doc, doc.tokens[m[1]], depth + 1);
  return v;
}

/** 直接写的长度（数字或 "14px"）；令牌与其他写法返回 undefined。 */
function rawPx(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(v.trim());
  return m ? Number(m[1]) : undefined;
}

/** 前缀下的令牌阶梯：值 → 令牌名（同值取名字排序最前的）。 */
function scaleOf(doc: DesignDoc, prefix: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const k of Object.keys(doc.tokens).sort()) {
    if (!k.startsWith(prefix)) continue;
    const n = rawPx(resolve(doc, doc.tokens[k]));
    if (n !== undefined && !out.has(n)) out.set(n, k);
  }
  return out;
}

/** 最接近的一档；差距超过 30%（且超过 4px）时不改。等距取较大的一档。 */
function nearest(scale: Map<number, string>, v: number): { value: number; token: string } | undefined {
  let best: number | undefined;
  for (const s of scale.keys()) if (best === undefined || Math.abs(s - v) < Math.abs(best - v) || (Math.abs(s - v) === Math.abs(best - v) && s > best)) best = s;
  if (best === undefined) return undefined;
  if (Math.abs(best - v) > Math.max(4, v * 0.3)) return undefined;
  return { value: best, token: scale.get(best)! };
}

/** 色值归一化：小写，#abc → #aabbcc；不是单一纯色时返回 undefined。 */
function normColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  if (/^#[0-9a-f]{4}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return s;
  if (/^(rgba?|hsla?)\([^()]*\)$/.test(s)) return s.replace(/\s+/g, '');
  return undefined;
}

const ROLE_HINTS: Record<'color' | 'background' | 'border', RegExp> = {
  color: /(text|fg|foreground|on-|on_|ink|heading|body|muted|subtle|link)/i,
  background: /^(?!on[-_])(?!.*[-_.]on[-_]).*(bg|background|surface|card|page|canvas|fill|panel|base)/i,
  border: /(border|line|divider|outline|stroke|separator)/i,
};

/** 实例节点在画板树中的根；组件定义另行访问。 */
function collectNodes(doc: DesignDoc, frame: Frame): Node[] {
  const out: Node[] = [];
  const seenComp = new Set<string>();
  const visit = (n: Node, depth: number) => {
    if (depth > 60) return;
    if (n.component && doc.components[n.component]) {
      // 实例：自身只有摆放属性，内部来自定义
      if (!seenComp.has(n.component)) {
        seenComp.add(n.component);
        visit(doc.components[n.component].root, depth + 1);
      }
      return;
    }
    out.push(n);
    for (const c of n.children ?? []) visit(c, depth + 1);
  };
  visit(frame.root, 0);
  return out;
}

/** 规划一个或多个画板的自动修复。kinds 缺省为全部四类。 */
export function planLintFixes(doc: DesignDoc, frames: Frame[], kinds: Set<FixKind> = new Set(FIX_KINDS)): FixPlan {
  const sizes = scaleOf(doc, 'size.');
  const spaces = scaleOf(doc, 'space.');
  const radii = scaleOf(doc, 'radius.');
  const sizeMax = Math.max(0, ...sizes.keys());
  // 色值 → 同值的颜色令牌
  const colorTokens = new Map<string, string[]>();
  for (const k of Object.keys(doc.tokens).sort()) {
    if (!k.startsWith('color.')) continue;
    const c = normColor(resolve(doc, doc.tokens[k]));
    if (c) colorTokens.set(c, [...(colorTokens.get(c) ?? []), k]);
  }

  const changes: FixChange[] = [];
  const skipped: FixSkip[] = [];
  const patches = new Map<string, { style?: Record<string, unknown>; box?: Record<string, unknown>; layout?: Record<string, unknown> }>();
  const set = (id: string, group: 'style' | 'box' | 'layout', key: string, value: unknown) => {
    const p = patches.get(id) ?? {};
    (p[group] ??= {})[key] = value;
    patches.set(id, p);
  };
  const seen = new Set<string>();

  /** 间距值（数字或数组）逐项替换；返回新值或 undefined（无改动）。 */
  const fixSpacing = (n: Node, field: string, v: unknown): unknown => {
    if (spaces.size < 4) return undefined;
    const list = Array.isArray(v) ? v : [v];
    let hit = false;
    const next = list.map((x) => {
      const px = typeof x === 'number' ? x : undefined;
      if (px === undefined || px <= 2 || spaces.has(px)) return x;
      const near = nearest(spaces, px);
      if (!near) {
        skipped.push({ kind: 'off_space', id: n.id, field, value: x, reason: '与最近的 space.* 相差过大，需要判断是否新增一档' });
        return x;
      }
      hit = true;
      return `{${near.token}}`;
    });
    if (!hit) return undefined;
    return Array.isArray(v) ? next : next[0];
  };

  for (const frame of frames) {
    for (const n of collectNodes(doc, frame)) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      const st = n.style ?? {};
      const box = n.box ?? {};

      if (kinds.has('off_scale') && inferRender(n) === 'text' && n.text?.trim() && st.fontSize !== undefined && !isToken(st.fontSize) && sizes.size) {
        const v = rawPx(st.fontSize);
        // 与体检一致：比阶梯最大一档还大的展示级字号是有意的选择
        if (v !== undefined && !sizes.has(v) && v <= sizeMax) {
          const near = nearest(sizes, v);
          if (near) {
            set(n.id, 'style', 'fontSize', `{${near.token}}`);
            changes.push({ kind: 'off_scale', id: n.id, field: 'style.fontSize', from: st.fontSize, to: `{${near.token}}` });
          } else skipped.push({ kind: 'off_scale', id: n.id, field: 'style.fontSize', value: st.fontSize, reason: '与最近的 size.* 相差过大' });
        }
      }

      if (kinds.has('off_space')) {
        for (const [group, key, v] of [
          ['box', 'padding', box.padding],
          ['box', 'margin', box.margin],
          ['layout', 'gap', n.layout?.gap],
          ['layout', 'rowGap', n.layout?.rowGap],
        ] as const) {
          if (v === undefined) continue;
          const next = fixSpacing(n, `${group}.${key}`, v);
          if (next === undefined) continue;
          set(n.id, group, key, next);
          changes.push({ kind: 'off_space', id: n.id, field: `${group}.${key}`, from: v, to: next });
        }
      }

      if (kinds.has('off_radius') && box.radius !== undefined && radii.size >= 2) {
        const list = Array.isArray(box.radius) ? box.radius : [box.radius];
        const values = list.map((r) => (isToken(r) ? undefined : rawPx(r)));
        const asymmetric = new Set(list.map((r) => rawPx(resolve(doc, r)))).size > 1;
        if (!asymmetric) {
          let hit = false;
          const next = list.map((r, i) => {
            const v = values[i];
            if (v === undefined || v <= 0 || v >= 99 || radii.has(v)) return r;
            const near = nearest(radii, v);
            if (!near) return r;
            hit = true;
            return `{${near.token}}`;
          });
          if (hit) {
            const to = Array.isArray(box.radius) ? next : next[0];
            set(n.id, 'box', 'radius', to);
            changes.push({ kind: 'off_radius', id: n.id, field: 'box.radius', from: box.radius, to });
          }
        }
      }

      if (kinds.has('raw_colors') && colorTokens.size) {
        const fields: Array<['style' | 'box', string, 'color' | 'background' | 'border', unknown]> = [
          ['style', 'color', 'color', st.color],
          ['style', 'background', 'background', st.background],
        ];
        for (const [group, key, role, v] of fields) {
          const c = normColor(v);
          const cands = c ? colorTokens.get(c) : undefined;
          if (!cands) continue;
          const pick = cands.length === 1 ? cands : cands.filter((t) => ROLE_HINTS[role].test(t.slice('color.'.length)));
          if (pick.length !== 1) {
            skipped.push({ kind: 'raw_colors', id: n.id, field: `${group}.${key}`, value: v, reason: `多个令牌同值（${cands.join('、')}），按用途分不出该用哪个` });
            continue;
          }
          set(n.id, group, key, `{${pick[0]}}`);
          changes.push({ kind: 'raw_colors', id: n.id, field: `${group}.${key}`, from: v, to: `{${pick[0]}}` });
        }
        const bc = box.border?.color;
        const c = normColor(bc);
        const cands = c ? colorTokens.get(c) : undefined;
        if (cands) {
          const pick = cands.length === 1 ? cands : cands.filter((t) => ROLE_HINTS.border.test(t.slice('color.'.length)));
          if (pick.length === 1) {
            set(n.id, 'box', 'border', { ...box.border, color: `{${pick[0]}}` });
            changes.push({ kind: 'raw_colors', id: n.id, field: 'box.border.color', from: bc, to: `{${pick[0]}}` });
          } else skipped.push({ kind: 'raw_colors', id: n.id, field: 'box.border.color', value: bc, reason: `多个令牌同值（${cands.join('、')}），按用途分不出该用哪个` });
        }
      }
    }
  }
  return { patches: [...patches.entries()].map(([id, patch]) => ({ id, patch })), changes, skipped };
}
