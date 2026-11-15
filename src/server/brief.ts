// 需求问卷：用户给的信息很少、难以决定方向时，在画布上向用户提问（产品、视觉方向、主色、页面内容等），
// 而不是由 AI 自行假设后直接开始画。问卷由 design_ask 发到画布页面，用户提交后答案记在 session.json。
import type { BriefAnswers, BriefForm, BriefOption, BriefQuestion } from '../core/types.js';
import type { DirectionCard } from './directions.js';
import { pageTypeOf } from './pageGuides.js';

/** 记在画布上的问卷结果。 */
export interface BriefRecord {
  at: number;
  /** 用户选择“跳过，让 AI 决定”。 */
  skipped?: boolean;
  /** chat：用户在对话里说清楚、由 design_plan 的 enough_info + user_style 记录，没有出问卷。 */
  source?: 'chat';
  answers: Array<{ id: string; question: string; answer: string | string[] }>;
}

export const AUTO = 'auto';
export const DIRECTION_Q = 'direction';

/** 各类页面常见的内容块，作为“需要包含哪些内容”的选项。 */
const CONTENT: Record<string, string[]> = {
  login: ['手机号 + 验证码登录', '账号密码登录', '第三方登录（微信 / Apple 等）', '注册入口', '忘记密码', '用户协议勾选', '品牌标语 / 产品介绍'],
  home: ['搜索', '轮播 / 主推内容', '功能入口', '推荐列表', '今日数据 / 进行中的任务', '消息通知入口', '底部导航'],
  dashboard: ['核心指标', '趋势图表', '待处理事项', '排行 / 构成', '明细表格', '时间与维度筛选', '侧边导航'],
  landing: ['首屏主张 + 行动按钮', '产品截图 / 演示', '核心功能介绍', '客户与数据证明', '用户评价', '价格方案', '常见问题', '页脚'],
  list: ['搜索', '筛选 / 排序', '分类 tab', '列表项图片', '状态标签', '批量操作', '空状态'],
  detail: ['头图 / 图片轮播', '标题与关键信息', '详细描述', '评价 / 评论', '相关推荐', '底部主操作按钮'],
  form: ['分步填写', '基本信息', '图片上传', '选项选择', '金额汇总', '校验与错误提示', '提交成功提示'],
  profile: ['头像与昵称', '会员 / 资产信息', '订单或记录入口', '功能列表', '设置项与开关', '退出登录'],
  onboarding: ['产品亮点介绍（多屏）', '权限或偏好设置', '注册 / 登录入口', '跳过按钮', '结果状态与摘要', '下一步入口'],
};

export const COLOR_Q = 'color';

/** 主色选项；id 用作配色主题 id 的前缀。 */
const COLOR_PRESETS = [
  { id: 'blue', value: '蓝色', label: '蓝', hex: '#2563EB' },
  { id: 'green', value: '绿色', label: '绿', hex: '#059669' },
  { id: 'purple', value: '紫色', label: '紫', hex: '#7C3AED' },
  { id: 'red', value: '红色 / 粉色', label: '红 / 粉', hex: '#E11D48' },
  { id: 'orange', value: '橙色 / 黄色', label: '橙 / 黄', hex: '#F59E0B' },
  { id: 'mono', value: '黑白灰', label: '黑白灰', hex: '#18181B', swatch: ['#18181B', '#A1A1AA', '#FFFFFF'] },
];
/** “其他”里写的颜色词。 */
const COLOR_WORDS: Array<[RegExp, string, string]> = [
  [/青|cyan|teal/i, 'teal', '#0D9488'],
  [/蓝|blue/i, 'blue', '#2563EB'],
  [/绿|green/i, 'green', '#059669'],
  [/紫|purple|violet/i, 'purple', '#7C3AED'],
  [/粉|pink/i, 'pink', '#DB2777'],
  [/红|red/i, 'red', '#E11D48'],
  [/橙|orange/i, 'orange', '#EA580C'],
  [/黄|金|yellow|gold/i, 'yellow', '#CA8A04'],
  [/棕|咖啡|brown/i, 'brown', '#92400E'],
  [/黑|白|灰|gray|grey|black|mono/i, 'mono', '#18181B'],
];

const COLORS: BriefOption[] = [
  { value: AUTO, label: '不限，由方向决定' },
  ...COLOR_PRESETS.map((c) => ({ value: c.value, label: c.label, swatch: c.swatch ?? [c.hex] })),
];

const COLOR_QUESTION: BriefQuestion = {
  id: COLOR_Q,
  label: '有偏好的主色或品牌色吗？',
  help: '可多选：选了几种，设计系统就生成几套配色（各含亮 / 暗），之后在画布的 Tweaks 面板里切换比较。',
  kind: 'multi',
  options: COLORS,
  other: true,
  placeholder: '其他颜色或色值，可写多个，如 #FF6A00、墨绿',
};

/** 一套配色：主题 id 前缀、显示名、主色。 */
export interface ColorScheme {
  id: string;
  name: string;
  primary: string;
}

/** 把主色题的回答（选项文字或“其他”里写的色值 / 颜色词）整理成配色列表，去重，最多 4 套。 */
export function colorSchemes(answer: string | string[] | undefined): ColorScheme[] {
  const out: ColorScheme[] = [];
  const add = (s: ColorScheme) => {
    if (!out.some((x) => x.id === s.id || x.primary.toUpperCase() === s.primary.toUpperCase())) out.push(s);
  };
  for (const raw of Array.isArray(answer) ? answer : answer ? [answer] : []) {
    const v = raw.trim();
    const preset = COLOR_PRESETS.find((c) => c.label === v || c.value === v);
    if (preset) {
      add({ id: preset.id, name: preset.label, primary: preset.hex });
      continue;
    }
    const hexes = v.match(/#[0-9a-fA-F]{6}\b/g);
    if (hexes) {
      for (const h of hexes) add({ id: `c${h.slice(1).toLowerCase()}`, name: h.toUpperCase(), primary: h.toUpperCase() });
      continue;
    }
    for (const part of v.split(/[、,，;；/和\s]+/).filter(Boolean)) {
      const w = COLOR_WORDS.find(([re]) => re.test(part));
      if (w) add({ id: w[1], name: part.slice(0, 8), primary: w[2] });
    }
  }
  return out.slice(0, 4);
}

export function directionOptions(cards: DirectionCard[]): BriefOption[] {
  return [
    ...cards.map((c) => ({
      value: c.id,
      label: c.name,
      hint: `${c.mood}。${c.signature}`,
      swatch: [c.palette.bg, c.palette.primary, c.palette.accent, c.palette.fg],
    })),
    { value: AUTO, label: '都可以，让 AI 决定' },
  ];
}

export function directionQuestion(cards: DirectionCard[]): BriefQuestion {
  return { id: DIRECTION_Q, label: '喜欢哪种视觉方向？', help: '色块依次为背景、主色、强调色、文字色。都不合适可以换一批。', kind: 'single', options: directionOptions(cards), reroll: true };
}

const TONE: BriefQuestion = {
  id: 'tone',
  label: '浅色还是深色界面？',
  kind: 'single',
  options: [
    { value: AUTO, label: '都可以' },
    { value: '浅色', label: '浅色' },
    { value: '深色', label: '深色' },
  ],
};

let seq = 0;
const formId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export interface BriefContext {
  /** 用户原话 / 画布标题 / 页面名等。 */
  brief: string;
  cards: DirectionCard[];
  /** 用户在对话里已说清的产品与内容（design_plan 的 enough_info）：问卷只问视觉偏好。 */
  known?: string;
}

/** 只问视觉偏好的问卷：产品与内容已在对话里说清时使用。 */
function visualBriefForm(ctx: BriefContext): BriefForm {
  const questions: BriefQuestion[] = [];
  if (ctx.cards.length) questions.push(directionQuestion(ctx.cards));
  questions.push(
    COLOR_QUESTION,
    TONE,
    { id: 'reference', label: '有喜欢的参考产品或网站吗？', kind: 'text', placeholder: '可选，如：Linear、Notion' },
    { id: 'extra', label: '风格上还有其他要求吗？', kind: 'text', multiline: true, placeholder: '可选，如：不要渐变、要有手绘感' },
  );
  return {
    id: formId(),
    title: '开始设计前，先确认视觉偏好',
    intro: `已了解需求：${ctx.known!.slice(0, 80)}。动手前想先确认你喜欢的风格；每一题都可以不填，没填的部分由 AI 决定。`,
    questions,
  };
}

/** 默认问卷：产品与用户、平台、视觉方向、主色、明暗、页面内容、参考与其他要求。 */
export function defaultBriefForm(ctx: BriefContext): BriefForm {
  if (ctx.known) return visualBriefForm(ctx);
  const brief = ctx.brief;
  const type = pageTypeOf({ name: brief });
  const questions: BriefQuestion[] = [
    { id: 'product', label: '这是什么产品，主要给谁用？', kind: 'text', placeholder: '如：面向大学生的二手书交易 App' },
  ];
  if (!/移动|手机|app|小程序|h5|桌面|网页|web|pc|平板|响应式|mobile|desktop|tablet/i.test(brief))
    questions.push({
      id: 'platform',
      label: '在什么设备上使用？',
      kind: 'single',
      options: [
        { value: '手机 App / 小程序', label: '手机 App / 小程序' },
        { value: '桌面网页', label: '桌面网页' },
        { value: '手机与桌面都要', label: '手机与桌面都要' },
      ],
    });
  if (ctx.cards.length) questions.push(directionQuestion(ctx.cards));
  questions.push(
    COLOR_QUESTION,
    TONE,
  );
  questions.push(
    type && CONTENT[type]
      ? { id: 'content', label: '页面需要包含哪些内容？', help: '可多选；没列出的写在“其他”里。', kind: 'multi', options: CONTENT[type].map((x) => ({ value: x, label: x })), other: true, placeholder: '其他内容' }
      : { id: 'content', label: '需要哪些页面，每个页面包含什么内容？', kind: 'text', multiline: true, placeholder: '如：首页（搜索、推荐列表）、商品详情、购物车' },
    { id: 'reference', label: '有喜欢的参考产品或网站吗？', kind: 'text', placeholder: '可选，如：Notion、小红书' },
    { id: 'extra', label: '还有其他要求吗？', kind: 'text', multiline: true, placeholder: '可选' },
  );
  return {
    id: formId(),
    title: '开始设计前，想先了解你的想法',
    intro: `需求「${brief.slice(0, 40) || '新设计'}」的信息还比较少。每一题都可以不填，没填的部分由 AI 决定。`,
    questions,
  };
}

export interface CustomQuestion {
  id?: string;
  label: string;
  help?: string;
  kind: 'single' | 'multi' | 'text';
  options?: Array<string | { value?: string; label: string; hint?: string }>;
  placeholder?: string;
  other?: boolean;
}

/** AI 自定义的问题（可附带视觉方向题）。 */
export function customBriefForm(input: { title?: string; intro?: string; questions: CustomQuestion[] }, cards: DirectionCard[]): BriefForm {
  const used = new Set<string>();
  const questions: BriefQuestion[] = input.questions.map((q, i) => {
    let id = q.id && /^[a-zA-Z0-9_-]{1,40}$/.test(q.id) && q.id !== DIRECTION_Q ? q.id : `q${i + 1}`;
    while (used.has(id)) id += '_';
    used.add(id);
    const options = q.kind === 'text' ? undefined : (q.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value ?? o.label, label: o.label, ...(o.hint ? { hint: o.hint } : {}) }));
    return {
      id,
      label: q.label,
      kind: options && !options.length ? 'text' : q.kind,
      ...(q.help ? { help: q.help } : {}),
      ...(options?.length ? { options } : {}),
      ...(q.placeholder ? { placeholder: q.placeholder } : {}),
      ...(q.other ? { other: true } : {}),
    };
  });
  if (cards.length) questions.push(directionQuestion(cards));
  return { id: formId(), title: input.title || '开始设计前，想先了解你的想法', ...(input.intro ? { intro: input.intro } : {}), questions };
}

/** 把页面提交的答案整理成可读的记录：去掉空答案与“不限”，选项值换成显示文字。 */
export function briefRecord(form: BriefForm, answers: BriefAnswers, skipped = false): BriefRecord {
  const out: BriefRecord['answers'] = [];
  if (!skipped)
    for (const q of form.questions) {
      const raw = answers[q.id];
      const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map((x) => String(x).trim().slice(0, 500)).filter((x) => x && x !== AUTO);
      if (!list.length) continue;
      const labelOf = (v: string) => (q.id === DIRECTION_Q ? v : (q.options?.find((o) => o.value === v)?.label ?? v));
      const shown = list.map(labelOf);
      out.push({ id: q.id, question: q.label, answer: q.kind === 'multi' ? shown : shown.join('；') });
    }
  return { at: Date.now(), ...(skipped || !out.length ? { skipped: true } : {}), answers: out };
}
