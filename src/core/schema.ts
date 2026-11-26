// 节点 schema 校验：属性是带类型的字段，不接受任意 CSS / HTML。
import { z } from 'zod';
import { CUSTOM_CSS_MAX, cssNameError, cssValueError, layoutConflictMessage, layoutConflicts } from './customCss.js';
import { protoErrors, templateErrors } from './proto.js';
import { TEXT_STYLES, type Node, type Tweak, type Proto, type ProtoAction, type TextStyle } from './types.js';

// 字符串值不能夹带 CSS 注入或标记。
const SAFE = /^[^;<>"\\{}]*$|^\{[a-zA-Z0-9_.-]+\}$/;
const safeStr = z.string().max(500).refine((s) => SAFE.test(s) && !/url\s*\(|expression\s*\(|@import/i.test(s), {
  message: '包含不允许的字符（; < > " \\ 或 url()）；令牌请写成 {token.name}',
});
/** 颜色、渐变、阴影：除整个值是令牌外，值里也可以嵌入令牌，如 linear-gradient(90deg, {color.primary}, {color.accent})。渲染时逐个转为 var()。 */
const paintStr = z.string().max(500).refine((s) => SAFE.test(s.replace(/\{[a-zA-Z][a-zA-Z0-9_.-]*\}/g, '')) && !/url\s*\(|expression\s*\(|@import/i.test(s), {
  message: '包含不允许的字符（; < > " \\ 或 url()）；令牌请写成 {token.name}',
});
const len = z.union([z.number().finite(), safeStr]);
const spacing = z.union([len, z.tuple([len, len]), z.tuple([len, len, len, len])]);

// 自定义 CSS：只收结构化字段没覆盖的属性，已有字段管理的属性会被拒绝并提示改用对应字段。
const CustomCssSchema = z.record(z.string(), z.string()).superRefine((css, c) => {
  const keys = Object.keys(css);
  if (keys.length > CUSTOM_CSS_MAX) c.addIssue({ code: 'custom', message: `最多 ${CUSTOM_CSS_MAX} 条自定义属性` });
  for (const k of keys) {
    const ne = cssNameError(k);
    if (ne) c.addIssue({ code: 'custom', path: [k], message: ne.message });
    const ve = cssValueError(css[k]);
    if (ve) c.addIssue({ code: 'custom', path: [k], message: ve });
  }
});

export const LayoutSchema = z
  .object({
    display: z.enum(['flex', 'grid', 'block']),
    direction: z.enum(['row', 'column']),
    wrap: z.boolean(),
    justify: z.enum(['start', 'center', 'end', 'between', 'around', 'evenly']),
    align: z.enum(['start', 'center', 'end', 'stretch', 'baseline']),
    gap: len,
    rowGap: len,
    columns: z.union([z.number().int().positive(), safeStr]),
    rows: z.union([z.number().int().positive(), safeStr]),
    grow: z.number().min(0),
    shrink: z.number().min(0),
    basis: len,
    alignSelf: z.enum(['auto', 'start', 'center', 'end', 'stretch']),
    position: z.enum(['flow', 'relative', 'absolute', 'fixed', 'sticky']),
    top: len,
    right: len,
    bottom: len,
    left: len,
    zIndex: z.number().int(),
    overflow: z.enum(['visible', 'hidden', 'scroll']),
  })
  .partial()
  .strict();

export const BorderSchema = z
  .object({
    width: spacing,
    style: z.enum(['solid', 'dashed', 'dotted', 'none']),
    color: safeStr,
    sides: z.array(z.enum(['top', 'right', 'bottom', 'left'])),
  })
  .partial()
  .strict();

export const BoxSchema = z
  .object({
    width: len,
    height: len,
    minWidth: len,
    maxWidth: len,
    minHeight: len,
    maxHeight: len,
    margin: spacing,
    padding: spacing,
    border: BorderSchema,
    radius: z.union([len, z.tuple([len, len, len, len])]),
  })
  .partial()
  .strict();

export const StyleSchema = z
  .object({
    fontFamily: safeStr,
    fontSize: len,
    fontWeight: z.union([z.number(), safeStr]),
    fontStyle: z.enum(['normal', 'italic']),
    lineHeight: len,
    letterSpacing: len,
    textAlign: z.enum(['left', 'center', 'right', 'justify']),
    textDecoration: z.enum(['none', 'underline', 'line-through']),
    textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']),
    whiteSpace: z.enum(['normal', 'nowrap', 'pre-wrap']),
    listStyle: z.enum(['none', 'disc', 'decimal']),
    color: paintStr,
    background: paintStr,
    backgroundImage: safeStr,
    backgroundSize: z.enum(['cover', 'contain', 'auto']),
    objectFit: z.enum(['cover', 'contain', 'fill']),
    shadow: paintStr,
    innerShadow: paintStr,
    textShadow: paintStr,
    opacity: z.number().min(0).max(1),
    blur: len,
    backdropBlur: len,
    transform: safeStr,
    cursor: z.enum(['default', 'pointer', 'text']),
    textStyle: z.enum(Object.keys(TEXT_STYLES) as [TextStyle, ...TextStyle[]]),
    css: CustomCssSchema,
  })
  .partial()
  .strict()
  .superRefine((s, c) => {
    // cursor 既可写 style.cursor 也可写在 css 里，只能二选一
    if (s.cursor !== undefined && s.css?.cursor !== undefined) c.addIssue({ code: 'custom', path: ['css', 'cursor'], message: 'cursor 已在 style.cursor 设置，不能在 css 里重复设置' });
  });

/** 按钮类节点的 props.buttonType 取值（对应 HTML button 的 type）。 */
export const BUTTON_TYPES = ['button', 'submit', 'reset'] as const;

export const PropsSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/), z.string().max(100_000));

export const OverrideSchema = z
  .object({ text: z.string().max(20_000).superRefine((t, c) => templateErrors(t).forEach((message) => c.addIssue({ code: 'custom', message }))), props: PropsSchema, hidden: z.boolean() })
  .partial()
  .strict();

export const MetaSchema = z.object({ locked: z.boolean(), hidden: z.boolean() }).partial().strict();

export const StatesSchema = z
  .object({ hover: StyleSchema, focus: StyleSchema, active: StyleSchema })
  .partial()
  .strict();

const protoValue = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);
const varName = z.string().max(41);
const expr = z.string().min(1).max(500);
export const ProtoActionSchema: z.ZodType<ProtoAction> = z.lazy(() =>
  z.union([
    z.object({ do: z.literal('set'), var: varName, value: protoValue.optional(), expr: expr.optional() }).strict(),
    z.object({ do: z.literal('toggle'), var: varName }).strict(),
    z.object({ do: z.literal('countdown'), var: varName, from: z.number().int().min(1).max(3600), interval: z.number().int().min(50).max(60_000).optional(), then: z.array(ProtoActionSchema).max(20).optional() }).strict(),
    z.object({ do: z.literal('stop'), var: varName }).strict(),
    z.object({ do: z.literal('navigate'), frame: z.string().max(64), canvas: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).optional() }).strict(),
    z.object({ do: z.literal('back') }).strict(),
    z.object({ do: z.literal('open'), url: z.string().max(2000) }).strict(),
    z.object({ do: z.literal('delay'), ms: z.number().int().min(0).max(600_000), then: z.array(ProtoActionSchema).max(20) }).strict(),
    z.object({ do: z.literal('if'), when: expr, then: z.array(ProtoActionSchema).max(20).optional(), else: z.array(ProtoActionSchema).max(20).optional() }).strict(),
  ]),
) as z.ZodType<ProtoAction>;

export const ProtoSchema = z
  .object({
    vars: z.record(varName, protoValue),
    onClick: z.array(ProtoActionSchema).max(20),
    onLoad: z.array(ProtoActionSchema).max(20),
    show: expr,
    disabled: expr,
    styles: z.array(z.object({ when: expr, style: StyleSchema }).strict()).max(20),
    bind: varName,
  })
  .partial()
  .strict()
  .superRefine((p, c) => {
    for (const e of protoErrors(p as Proto)) c.addIssue({ code: 'custom', message: e });
  });

const TextSchema = z
  .string()
  .max(20_000)
  .superRefine((t, c) => {
    for (const e of templateErrors(t)) c.addIssue({ code: 'custom', message: e });
  });

export const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
export const COMPONENT_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** 单层节点字段（children 递归校验）。 */
export const NodeFieldsSchema = z
  .object({
    id: z.string().regex(ID_RE, 'id 只能包含字母、数字、_ 和 -，且以字母开头'),
    type: z.string().min(1).max(64),
    render: z.enum(['container', 'text', 'image', 'input']),
    name: z.string().max(200),
    component: z.string().regex(COMPONENT_RE, '组件名需以字母开头，只含字母数字 _ -'),
    overrides: z.record(z.string(), OverrideSchema),
    layout: LayoutSchema,
    box: BoxSchema,
    style: StyleSchema,
    props: PropsSchema,
    text: TextSchema,
    states: StatesSchema,
    proto: ProtoSchema,
    children: z.array(z.unknown()),
    meta: MetaSchema,
  })
  .partial()
  .required({ type: true })
  .strict()
  .superRefine((n, c) => {
    for (const [name, key] of layoutConflicts(n.style?.css, n.layout)) c.addIssue({ code: 'custom', path: ['style', 'css', name], message: layoutConflictMessage(name, key) });
  });

export type NodeInput = Omit<Partial<Node>, 'children'> & { type: string; children?: NodeInput[] };

export class ValidationError extends Error {
  constructor(public path: string, message: string) {
    super(`${path}: ${message}`);
  }
}

function fmtIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ');
}

/** 递归校验节点输入。path 用于指出出错节点（如 nodes[0].children[2]）。 */
export function validateNodeInput(input: unknown, path = 'node', depth = 0): NodeInput {
  if (depth > 40) throw new ValidationError(path, '嵌套过深（>40 层）');
  const r = NodeFieldsSchema.safeParse(input);
  if (!r.success) {
    const name = (input as { id?: string; type?: string })?.id ?? (input as { type?: string })?.type ?? '';
    throw new ValidationError(`${path}${name ? `(${name})` : ''}`, fmtIssues(r.error));
  }
  const node = r.data as NodeInput;
  if (node.props?.href && /^\s*(javascript|data|vbscript):/i.test(node.props.href)) {
    throw new ValidationError(path, 'props.href 不允许 javascript:/data: 链接');
  }
  if (node.props?.buttonType !== undefined && !BUTTON_TYPES.includes(node.props.buttonType as (typeof BUTTON_TYPES)[number])) {
    throw new ValidationError(path, `props.buttonType 只能是 ${BUTTON_TYPES.join(' / ')}`);
  }
  if (node.children) {
    node.children = node.children.map((c, i) => validateNodeInput(c, `${path}.children[${i}]`, depth + 1));
  }
  return node;
}

export function validateField(field: string, value: unknown, path = field): unknown {
  if (value === undefined || value === null) return undefined;
  const schema: Record<string, z.ZodType> = {
    layout: LayoutSchema,
    box: BoxSchema,
    style: StyleSchema,
    props: PropsSchema,
    meta: MetaSchema,
    states: StatesSchema,
    proto: ProtoSchema,
    text: TextSchema,
    name: z.string().max(200),
    render: z.enum(['container', 'text', 'image', 'input']),
    type: z.string().min(1).max(64),
  };
  const s = schema[field];
  if (!s) throw new ValidationError(path, `未知字段 ${field}`);
  const r = s.safeParse(value);
  if (!r.success) throw new ValidationError(path, fmtIssues(r.error));
  return r.data;
}

export const TOKEN_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

export function validateTokens(tokens: Record<string, string | null>): void {
  for (const [k, v] of Object.entries(tokens)) {
    if (!TOKEN_NAME_RE.test(k)) throw new ValidationError(`tokens.${k}`, '令牌名只能含字母数字 _ . -');
    if (v !== null) {
      const r = safeStr.safeParse(v);
      if (!r.success) throw new ValidationError(`tokens.${k}`, fmtIssues(r.error));
    }
  }
}

const TweakSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/),
    label: z.string().min(1).max(40),
    token: z.string().regex(TOKEN_NAME_RE),
    kind: z.enum(['color', 'range', 'select', 'toggle']),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    unit: z.string().max(8).optional(),
    options: z.array(z.object({ label: z.string().min(1).max(40), value: safeStr }).strict()).max(24).optional(),
    group: z.string().max(40).optional(),
  })
  .strict();

/** 校验 Tweaks 定义：id 唯一、令牌已存在、各类型的必填参数。 */
export function validateTweaks(tweaks: unknown, tokens: Record<string, string>): Tweak[] {
  const r = z.array(TweakSchema).max(40).safeParse(tweaks);
  if (!r.success) throw new ValidationError('tweaks', fmtIssues(r.error));
  const ids = new Set<string>();
  r.data.forEach((t, i) => {
    const at = `tweaks[${i}]`;
    if (ids.has(t.id)) throw new ValidationError(`${at}.id`, `id ${t.id} 重复`);
    ids.add(t.id);
    if (!(t.token in tokens)) throw new ValidationError(`${at}.token`, `令牌 ${t.token} 不存在：先用 tokens_set 定义它`);
    if (t.kind === 'range' && (t.min === undefined || t.max === undefined || t.min >= t.max)) throw new ValidationError(at, 'range 需要 min < max');
    if (t.kind === 'select' && (t.options?.length ?? 0) < 2) throw new ValidationError(`${at}.options`, 'select 至少 2 个选项');
    if (t.kind === 'toggle' && t.options?.length !== 2) throw new ValidationError(`${at}.options`, 'toggle 需要恰好 2 个选项（第一项为“关”）');
  });
  return r.data as Tweak[];
}

const AnnotationSchema = z
  .object({
    id: z.string().regex(/^a_[a-zA-Z0-9]{4,24}$/),
    kind: z.enum(['comment', 'note', 'text', 'pen', 'path', 'rect', 'oval', 'round', 'diamond', 'line', 'arrow']),
    frame: z.string().max(64).optional(),
    anchor: z.string().max(200).optional(),
    anchorNote: z.string().regex(/^a_[a-zA-Z0-9]{4,24}$/).optional(),
    rel: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    pts: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(1).max(4000),
    ctrl: z.array(z.tuple([z.number().finite(), z.number().finite()])).max(4000).optional(),
    closed: z.boolean().optional(),
    width: z.number().positive().max(32).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    dash: z.enum(['solid', 'dashed', 'dotted']).optional(),
    text: z.string().max(4000).optional(),
    n: z.number().int().positive().optional(),
    by: z.literal('ai').optional(),
    w: z.number().min(40).max(1200).optional(),
    ts: z.number(),
  })
  .strict()
  .refine((a) => !a.ctrl || a.ctrl.length === a.pts.length, { message: 'ctrl 须与 pts 等长', path: ['ctrl'] });

export function validateAnnotation(input: unknown) {
  const r = AnnotationSchema.safeParse(input);
  if (!r.success) throw new ValidationError('note', fmtIssues(r.error));
  return r.data;
}
