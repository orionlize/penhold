// 设计体检：从节点数据统计“设计感不足”的常见成因（层级太平、处处加粗、满屏胶囊、卡片套卡片、
// 一图多用、模板化文案细节）。溢出、重叠等渲染问题由画布页面检查，这里只看设计取向，结果是提醒而不是错误。
import { inferRender, mergeOverride } from './doc.js';
import type { DesignDoc, Frame, Node, Override } from './types.js';
import { TEXT_STYLES } from './types.js';

export interface DesignNote {
  kind:
    | 'off_scale'
    | 'too_many_sizes'
    | 'flat_hierarchy'
    | 'bold_everywhere'
    | 'pill_everywhere'
    | 'nested_cards'
    | 'image_reuse'
    | 'dot_meta'
    | 'arrow_suffix'
    | 'raw_colors'
    | 'off_space'
    | 'off_radius'
    | 'too_many_weights'
    | 'too_many_fonts'
    | 'emoji_icon'
    | 'accent_border'
    | 'many_primary';
  detail: string;
}

interface TextInfo {
  addr: string;
  size: number;
  weight: number;
  text: string;
}

const TOKEN_RE = /^\{([a-zA-Z0-9_.-]+)\}$/;

function tokenName(v: unknown): string | undefined {
  return typeof v === 'string' ? TOKEN_RE.exec(v.trim())?.[1] : undefined;
}

function resolve(doc: DesignDoc, v: unknown, depth = 0): unknown {
  const name = tokenName(v);
  if (name && depth < 4) return resolve(doc, doc.tokens[name], depth + 1);
  return v;
}

function px(doc: DesignDoc, v: unknown): number | undefined {
  const r = resolve(doc, v);
  if (typeof r === 'number') return r;
  if (typeof r !== 'string') return undefined;
  const m = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(r.trim());
  return m ? Number(m[1]) : undefined;
}

function weightOf(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return undefined;
  if (v === 'bold') return 700;
  if (v === 'normal') return 400;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const transparent = (v: unknown) => typeof v !== 'string' || !v.trim() || /^(transparent|none)$/i.test(v.trim()) || /^rgba\([^)]*,\s*0(\.0+)?\s*\)$/i.test(v.trim());
/** 直接写的色值，或渐变里含有直接写的色值。 */
const rawColor = (v: unknown): v is string => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()|gradient\(.*(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\()/i.test(v.trim());
const fmt = (n: number) => String(Math.round(n * 10) / 10);
const sample = (ids: string[], n = 3) => `${ids.slice(0, n).join('、')}${ids.length > n ? ' 等' : ''}`;
const quote = (s: string) => `「${s.length > 16 ? `${s.slice(0, 16)}…` : s}」`;

/** 对一个画板做设计体检，返回提醒（可能为空）。 */
export function designCheckup(doc: DesignDoc, frame: Frame): DesignNote[] {
  const texts: TextInfo[] = [];
  const offScale = new Map<number, string[]>();
  const pills: string[] = [];
  let rounded = 0;
  let deepest = { depth: 0, addr: '' };
  const images = new Map<string, string[]>();
  const colors = new Map<string, string[]>();

  const scale = new Set<number>();
  for (const [k, v] of Object.entries(doc.tokens)) {
    if (!k.startsWith('size.')) continue;
    const n = px(doc, v);
    if (n !== undefined) scale.add(n);
  }

  const scaleMax = Math.max(0, ...scale);
  const lengthSet = (prefix: string) => {
    const set = new Set<number>();
    for (const [k, v] of Object.entries(doc.tokens)) {
      if (!k.startsWith(prefix)) continue;
      const n = px(doc, v);
      if (n !== undefined) set.add(n);
    }
    return set;
  };
  const spaceSet = lengthSet('space.');
  const radiusSet = lengthSet('radius.');
  const offSpace = new Map<number, string[]>();
  const offRadius = new Map<number, string[]>();
  const families = new Map<string, string[]>();
  const emoji: TextInfo[] = [];
  const accentBorders: string[] = [];
  const primaries: string[] = [];
  const EMOJI = /\p{Extended_Pictographic}/u;
  const noteSpace = (v: unknown, addr: string) => {
    if (spaceSet.size < 4) return;
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x !== 'number' || tokenName(x) || x <= 2 || spaceSet.has(x)) continue;
      offSpace.set(x, [...(offSpace.get(x) ?? []), addr]);
    }
  };

  const noteColor = (v: unknown, addr: string) => {
    if (!rawColor(v)) return;
    const key = v.trim().toLowerCase();
    colors.set(key, [...(colors.get(key) ?? []), addr]);
  };
  const noteImage = (src: unknown, addr: string) => {
    const hash = typeof src === 'string' ? /^asset:([0-9a-f]+)/i.exec(src)?.[1] : undefined;
    const asset = hash ? doc.assets[hash] : undefined;
    if (!hash || !asset) return;
    // 图标（矢量或很小的位图）重复使用是正常的
    if (/svg/i.test(asset.mime) || (asset.width !== undefined && asset.width <= 96)) return;
    images.set(hash, [...(images.get(hash) ?? []), addr]);
  };

  type Stack = Array<{ prefix: string; overrides: Record<string, Override> | undefined }>;
  const visit = (node: Node, addr: string, stack: Stack, inherit: { size: number; weight: number }, surfaces: number, depth: number) => {
    if (depth > 60) return;
    let ov: Override | undefined;
    for (let i = stack.length - 1; i >= 0; i--) {
      const f = stack[i];
      if (f.overrides && addr.startsWith(`${f.prefix}:`)) ov = mergeOverride(ov, f.overrides[addr.slice(f.prefix.length + 1)]);
    }
    let eff = node;
    let next = stack;
    const def = node.component ? doc.components[node.component] : undefined;
    if (def) {
      eff = { ...def.root, id: node.id, text: node.text ?? def.root.text, props: node.props ? { ...def.root.props, ...node.props } : def.root.props, meta: node.meta };
      next = [...stack, { prefix: addr, overrides: node.overrides }];
    }
    if (ov?.hidden ?? eff.meta?.hidden) return;

    const kind = inferRender(eff);
    const st = eff.style ?? {};
    const box = eff.box ?? {};
    const size = px(doc, st.fontSize) ?? (st.textStyle ? TEXT_STYLES[st.textStyle] : undefined) ?? inherit.size;
    const weight = weightOf(resolve(doc, st.fontWeight)) ?? inherit.weight;
    const text = (ov?.text ?? eff.text ?? '').trim();
    const kids = eff.children ?? [];

    if (kind === 'text' && text) {
      texts.push({ addr, size, weight, text });
      // 比阶梯最大一档还大的展示级字号（首屏大数字、大标题）是有意的选择，不算
      if (st.fontSize !== undefined && !tokenName(st.fontSize) && scale.size && !scale.has(size) && size <= scaleMax) offScale.set(size, [...(offScale.get(size) ?? []), addr]);
    }

    // 圆角：只统计承载文字的块（标签、按钮、卡片），头像、圆点、装饰形状不算
    const radii = (Array.isArray(box.radius) ? box.radius : [box.radius]).map((r) => ({ name: tokenName(r), value: px(doc, r), raw: resolve(doc, r) }));
    const hasRadius = radii.some((r) => (r.value ?? 0) > 0 || r.raw === '50%');
    const carriesText = kind !== 'image' && (!!text || kids.length > 0);
    if (hasRadius && carriesText) {
      rounded++;
      if (radii.every((r) => r.name === 'radius.full' || (r.value ?? 0) >= 99 || r.raw === '50%')) pills.push(addr);
    }

    // 卡片层：有填充，且有圆角 / 描边 / 投影之一的容器
    let level = surfaces;
    const bordered = !!box.border && box.border.style !== 'none' && (px(doc, Array.isArray(box.border.width) ? box.border.width[0] : box.border.width) ?? 1) > 0;
    const shadowed = typeof resolve(doc, st.shadow) === 'string' && !/^none$/i.test(String(resolve(doc, st.shadow)).trim());
    if (kind === 'container' && kids.length > 0 && !transparent(resolve(doc, st.background)) && (hasRadius || bordered || shadowed)) {
      level++;
      if (level > deepest.depth) deepest = { depth: level, addr };
    }

    // 间距、圆角是否在令牌阶梯上（直接写的数字）
    noteSpace(box.padding, addr);
    noteSpace(box.margin, addr);
    noteSpace(eff.layout?.gap, addr);
    noteSpace(eff.layout?.rowGap, addr);
    // 四角各不相同的不对称圆角（叶片、卵石形）是有意的造型，不算
    const asymmetric = new Set(radii.map((r) => r.value)).size > 1;
    if (radiusSet.size >= 2 && !asymmetric)
      for (const r of radii) if (!r.name && r.value !== undefined && r.value > 0 && r.value < 99 && !radiusSet.has(r.value)) offRadius.set(r.value, [...(offRadius.get(r.value) ?? []), addr]);
    if (st.fontFamily !== undefined) {
      const name = tokenName(st.fontFamily);
      if (name !== 'font.mono') {
        const fam = String(resolve(doc, st.fontFamily) ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
        if (fam) families.set(fam, [...(families.get(fam) ?? []), addr]);
      }
    }
    if (kind === 'text' && text && EMOJI.test(text)) emoji.push({ addr, size, weight, text });
    // 左侧粗色条的卡片（AI 生成稿的常见套路）
    const sides = box.border?.sides;
    const bw = px(doc, Array.isArray(box.border?.width) ? box.border?.width[3] : box.border?.width) ?? 0;
    if (kind === 'container' && Array.isArray(sides) && sides.length === 1 && sides[0] === 'left' && bw >= 3 && !transparent(resolve(doc, st.background))) accentBorders.push(addr);
    // 主色实心按钮
    if (/button|btn/i.test(`${eff.type} ${node.component ?? ''}`) && typeof st.background === 'string' && /\{color\.primary\}/.test(st.background)) primaries.push(addr);
    noteColor(st.color, addr);
    noteColor(st.background, addr);
    noteColor(box.border?.color, addr);
    noteImage(eff.props?.src ?? ov?.props?.src, addr);
    noteImage(st.backgroundImage, addr);

    for (const c of kids) {
      const i = addr.lastIndexOf(':');
      const child = def ? `${addr}:${c.id}` : i < 0 ? c.id : `${addr.slice(0, i)}:${c.id}`;
      visit(c, child, next, { size, weight }, level, depth + 1);
    }
  };
  visit(frame.root, frame.root.id, [], { size: 16, weight: 400 }, 0, 0);

  const notes: DesignNote[] = [];
  const total = texts.length;

  if (offScale.size) {
    const list = [...offScale.entries()].sort((a, b) => b[1].length - a[1].length);
    const count = list.reduce((n, [, ids]) => n + ids.length, 0);
    notes.push({
      kind: 'off_scale',
      detail: `${count} 处文字的字号不在 size.* 阶梯上（${list.slice(0, 6).map(([s, ids]) => `${fmt(s)}px × ${ids.length}`).join('、')}，如 ${sample(list[0][1])}）：改用最接近的 size.* 令牌，确实需要新的一档就加进令牌并全稿统一`,
    });
  }

  const bySize = new Map<number, number>();
  for (const t of texts) bySize.set(t.size, (bySize.get(t.size) ?? 0) + 1);
  if (bySize.size > 8)
    notes.push({
      kind: 'too_many_sizes',
      detail: `用了 ${bySize.size} 种字号（${[...bySize.keys()].sort((a, b) => a - b).map(fmt).join(' / ')}）：相邻字号差 1–2px 看不出层级，收敛到 5–7 档，相邻两档之比不小于 1.2`,
    });

  if (total >= 8) {
    const body = [...bySize.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const max = Math.max(...bySize.keys());
    if (max / body < 1.75)
      notes.push({
        kind: 'flat_hierarchy',
        detail: `最大字号 ${fmt(max)}px 只有最常用字号 ${fmt(body)}px 的 ${fmt(max / body)} 倍：页面没有明显的视觉焦点。让这一页最重要的那个标题或数字至少是正文的 2 倍，其余保持小而安静`,
      });

    const bold = texts.filter((t) => t.weight >= 600);
    if (bold.length / total > 0.4)
      notes.push({
        kind: 'bold_everywhere',
        detail: `${total} 处文字里有 ${bold.length} 处是 600 以上的粗体（${Math.round((bold.length / total) * 100)}%）：处处加粗等于没有重点。粗体只留给标题、关键数字和主按钮，标签、列表项、辅助信息改回 400 / 500`,
      });
  }

  if (rounded >= 10 && pills.length / rounded > 0.5)
    notes.push({
      kind: 'pill_everywhere',
      detail: `${rounded} 个带圆角的块里有 ${pills.length} 个是全圆角胶囊（如 ${sample(pills)}）：形状没有层级。胶囊只留给一类元素（如主按钮或筛选项），标签用 radius.sm，卡片用 radius.md / radius.lg`,
    });

  if (deepest.depth >= 3)
    notes.push({
      kind: 'nested_cards',
      detail: `卡片套卡片达到 ${deepest.depth} 层（最内层 ${deepest.addr}）：去掉中间一层的底色、描边或投影，用留白、分隔线或字号来分组`,
    });

  for (const [hash, ids] of images) {
    if (ids.length < 2) continue;
    notes.push({
      kind: 'image_reuse',
      detail: `同一张图片（asset:${hash.slice(0, 8)}）用了 ${ids.length} 处（${sample(ids)}）：内容不同的位置换成各自的图片；没有素材时先向用户要，或用与题材相关的色块 + 图形占位，不要重复同一张照片`,
    });
  }

  const dotted = texts.filter((t) => /\S\s*[·•・]\s*\S/.test(t.text));
  if (dotted.length >= 3)
    notes.push({
      kind: 'dot_meta',
      detail: `${dotted.length} 处文字用 “A · B · C” 拼接元信息（如 ${dotted.slice(0, 2).map((t) => quote(t.text)).join('、')}）：这是模板化写法。按重要性拆开——最重要的一项单独成行或放大，其余用图标、标签或对齐的分栏表达，不重要的删掉`,
    });

  const arrows = texts.filter((t) => /\S\s*(→|›|»)\s*$/.test(t.text) && t.text.length <= 14);
  if (arrows.length >= 2)
    notes.push({
      kind: 'arrow_suffix',
      detail: `${arrows.length} 处按钮或链接文字以箭头结尾（如 ${arrows.slice(0, 2).map((t) => quote(t.text)).join('、')}）：去掉箭头，需要指示方向时用图标节点`,
    });

  if (colors.size >= 8) {
    const list = [...colors.entries()].sort((a, b) => b[1].length - a[1].length);
    notes.push({
      kind: 'raw_colors',
      detail: `直接写了 ${colors.size} 种色值而不是令牌（${list.slice(0, 5).map(([c]) => c).join('、')}，如 ${sample(list[0][1])}）：收敛到 color.* 令牌；确实需要的新颜色先加进令牌`,
    });
  }

  if (offSpace.size) {
    const list = [...offSpace.entries()].sort((a, b) => b[1].length - a[1].length);
    const count = list.reduce((n, [, ids]) => n + ids.length, 0);
    if (count >= 3)
      notes.push({
        kind: 'off_space',
        detail: `${count} 处间距（padding / margin / gap）不在 space.* 阶梯上（${list.slice(0, 6).map(([v, ids]) => `${fmt(v)}px × ${ids.length}`).join('、')}，如 ${sample(list[0][1])}）：改用最接近的 space.* 令牌，同一层级的间距保持一致`,
      });
  }
  if (offRadius.size) {
    const list = [...offRadius.entries()].sort((a, b) => b[1].length - a[1].length);
    const count = list.reduce((n, [, ids]) => n + ids.length, 0);
    if (count >= 3)
      notes.push({
        kind: 'off_radius',
        detail: `${count} 处圆角直接写了阶梯外的数字（${list.slice(0, 5).map(([v, ids]) => `${fmt(v)}px × ${ids.length}`).join('、')}，如 ${sample(list[0][1])}）：改用 radius.sm / md / lg / full，按元素层级区分`,
      });
  }
  const weights = new Map<number, number>();
  for (const t of texts) weights.set(t.weight, (weights.get(t.weight) ?? 0) + 1);
  if (weights.size > 3)
    notes.push({
      kind: 'too_many_weights',
      detail: `文字用了 ${weights.size} 档字重（${[...weights.keys()].sort((a, b) => a - b).join(' / ')}）：收敛到两三档，按设计系统的文字样式取值`,
    });
  if (families.size > 2)
    notes.push({
      kind: 'too_many_fonts',
      detail: `用了 ${families.size} 个字体族（${[...families.keys()].slice(0, 5).join('、')}）：标题与正文最多两个，数字可另用 font.mono`,
    });
  if (emoji.length)
    notes.push({
      kind: 'emoji_icon',
      detail: `${emoji.length} 处文字里有 emoji（如 ${emoji.slice(0, 2).map((t) => quote(t.text)).join('、')}）：emoji 当图标会显得廉价且各平台不一致。换成线性描边图标（统一线宽与尺寸），或删掉`,
    });
  if (accentBorders.length)
    notes.push({
      kind: 'accent_border',
      detail: `${accentBorders.length} 个卡片只在左侧有粗色条（如 ${sample(accentBorders)}）：这是 AI 生成稿的常见套路。用字号、留白或底色区分重点，确实要标记状态时用小色点或标签`,
    });
  if (primaries.length >= 3)
    notes.push({
      kind: 'many_primary',
      detail: `${primaries.length} 个按钮都是主色实心（如 ${sample(primaries)}）：一屏只留一个主按钮，其余改为描边、浅底或文字按钮`,
    });

  return notes;
}

/** 体检结果的文字报告；没有提醒时返回空字符串。 */
export function formatDesignNotes(notes: DesignNote[]): string {
  if (!notes.length) return '';
  return [
    `设计体检：${notes.length} 项提醒（不影响自检通过）。逐条判断：是这一稿有意的设计选择就保留并在回复里说明，否则修改后重新截图。`,
    ...notes.map((n) => `- [${n.kind}] ${n.detail}`),
  ].join('\n');
}
