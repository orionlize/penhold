// 内置设计预设：项目与本机都没有设计 skill / 规范时的兜底。
// guides/default/SKILL.md 是通用设计规范；guides/catalog.json 是按产品类型整理的色板、风格与字体
// （由 scripts/import-presets.ts 从 ui-ux-pro-max-skill 的 MIT 数据生成）。
import fs from 'node:fs';
import path from 'node:path';
import { PKG_ROOT } from '../paths.js';
import { contrast, ensureContrast, HEX6, onColor } from '../../core/color.js';

export const GUIDES_DIR = path.join(PKG_ROOT, 'guides');
export const DEFAULT_GUIDE = path.join(GUIDES_DIR, 'default', 'SKILL.md');

export interface Product {
  id: string;
  name: string;
  keywords: string[];
  style: string;
  secondary?: string;
  landing?: string;
  dashboard?: string;
  color_focus?: string;
  considerations?: string;
  palette_note?: string;
  tokens: Record<string, string>;
}
export interface Style {
  id: string;
  name: string;
  aliases: string[];
  keywords: string[];
  colors?: string;
  effects?: string;
  best_for?: string;
  avoid_for?: string;
  variables?: string;
  dark_mode?: boolean;
}
export interface FontPair {
  name: string;
  category: string;
  heading: string;
  body: string;
  mood: string[];
  best_for?: string;
  notes?: string;
}
interface Catalog {
  source: Record<string, string>;
  products: Product[];
  styles: Style[];
  fonts: FontPair[];
}

let cache: Catalog | undefined;
export function catalog(): Catalog {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(path.join(GUIDES_DIR, 'catalog.json'), 'utf8')) as Catalog;
    for (const p of cache.products) p.tokens = normalizePalette(p.tokens);
  }
  return cache;
}

/**
 * 修正来源数据里对比度不达标的色板：主色对背景不到 3:1（如深色背景配近黑主色）而强调色达标时，
 * 主色与强调色互换；再保证主色 ≥ 3:1、正文与次要文字 ≥ 4.5:1、色块上的文字 ≥ 4.5:1。
 */
export function normalizePalette(tokens: Record<string, string>): Record<string, string> {
  const t = { ...tokens };
  const ok = (k: string) => HEX6.test(t[k] ?? '');
  if (ok('color.primary') && ok('color.accent') && ok('color.bg') && contrast(t['color.primary'], t['color.bg']) < 3 && contrast(t['color.accent'], t['color.bg']) >= 3) {
    const ringWasPrimary = t['color.ring'] === t['color.primary'];
    [t['color.primary'], t['color.accent']] = [t['color.accent'], t['color.primary']];
    [t['color.on-primary'], t['color.on-accent']] = [t['color.on-accent'], t['color.on-primary']];
    if (ringWasPrimary || (ok('color.ring') && contrast(t['color.ring'], t['color.bg']) < 3)) t['color.ring'] = t['color.primary'];
  }
  const fix = (fg: string, bg: string, min: number) => {
    if (ok(fg) && ok(bg)) t[fg] = ensureContrast(t[fg], t[bg], min);
  };
  fix('color.primary', 'color.bg', 3);
  fix('color.ring', 'color.bg', 3);
  fix('color.fg', 'color.bg', 4.5);
  fix('color.muted-fg', 'color.bg', 4.5);
  fix('color.muted-fg', 'color.card', 4.5);
  fix('color.card-fg', 'color.card', 4.5);
  for (const base of ['primary', 'secondary', 'accent', 'danger'])
    if (ok(`color.${base}`) && ok(`color.on-${base}`) && contrast(t[`color.on-${base}`], t[`color.${base}`]) < 4.5) t[`color.on-${base}`] = onColor(t[`color.${base}`]);
  return t;
}

export function defaultGuideText(): string {
  return fs.readFileSync(DEFAULT_GUIDE, 'utf8');
}

/** 常见中文说法 → 目录中的英文关键词（AI 也可能直接传中文需求）。 */
const ZH: [RegExp, string][] = [
  [/电商|商城|购物|网店/, 'e-commerce shop'],
  [/奢侈|高端|轻奢/, 'luxury premium'],
  [/后台|管理系统|管理端|中台/, 'admin dashboard b2b'],
  [/看板|仪表盘|大屏|数据可视化/, 'dashboard analytics data'],
  [/记账|理财|预算|账本/, 'personal finance budget expense'],
  [/银行/, 'banking'],
  [/金融|支付|钱包/, 'fintech payment wallet'],
  [/加密|区块链|数字货币|web3/i, 'crypto web3 blockchain'],
  [/保险/, 'insurance'],
  [/医疗|医院|问诊|诊所/, 'healthcare medical clinic'],
  [/心理|情绪/, 'mental health mood'],
  [/健身|运动|锻炼/, 'fitness gym workout'],
  [/跑步|骑行/, 'running cycling'],
  [/瑜伽/, 'yoga'],
  [/冥想|正念/, 'meditation mindfulness'],
  [/睡眠/, 'sleep'],
  [/饮食|卡路里|营养/, 'calorie nutrition'],
  [/教育|学习|课程|网课/, 'education learning course'],
  [/儿童|少儿|幼儿/, 'kids children'],
  [/背单词|语言学习|外语/, 'language learning'],
  [/社交|社区|论坛/, 'social community'],
  [/聊天|即时通讯|消息/, 'chat messaging'],
  [/交友|约会|婚恋/, 'dating'],
  [/游戏/, 'game gaming'],
  [/外卖|点餐/, 'food delivery order'],
  [/餐厅|餐饮|饭店/, 'restaurant food'],
  [/咖啡|烘焙|面包/, 'cafe bakery'],
  [/菜谱|食谱|做饭/, 'recipe cooking'],
  [/打车|出行|网约车/, 'ride hailing transportation'],
  [/公交|地铁/, 'public transit'],
  [/停车/, 'parking'],
  [/旅游|旅行/, 'travel tourism'],
  [/酒店|民宿/, 'hotel hospitality booking'],
  [/机票|航空/, 'airline flight'],
  [/房产|租房|房地产/, 'real estate property'],
  [/汽车|车辆|4s/i, 'automotive car'],
  [/充电桩|新能源/, 'ev charging'],
  [/招聘|求职|简历/, 'job recruitment resume'],
  [/音乐/, 'music streaming'],
  [/视频|影视|直播/, 'video streaming'],
  [/播客/, 'podcast'],
  [/新闻|资讯|媒体/, 'news media'],
  [/博客|杂志/, 'blog magazine'],
  [/笔记|写作|文档/, 'notes writing'],
  [/待办|任务|效率/, 'productivity task todo'],
  [/日历|日程/, 'calendar scheduling'],
  [/习惯/, 'habit tracker'],
  [/日记/, 'diary journal'],
  [/天气/, 'weather'],
  [/预约|预订/, 'booking appointment'],
  [/客户管理|crm/i, 'crm client'],
  [/库存|仓储/, 'inventory stock'],
  [/发票|账单|计费/, 'invoice billing'],
  [/物流|快递|配送/, 'logistics delivery'],
  [/宠物/, 'pet'],
  [/宠物医院|兽医/, 'veterinary vet'],
  [/母婴|育儿|宝宝/, 'parenting baby'],
  [/养老|老人|适老/, 'senior elderly'],
  [/美容|美业|美甲|\bspa\b/i, 'beauty spa wellness'],
  [/婚礼|婚庆/, 'wedding event'],
  [/活动|会议|门票|票务/, 'event ticketing conference'],
  [/政务|政府|公共服务/, 'government public service'],
  [/公益|慈善/, 'non-profit charity'],
  [/律所|法律/, 'legal'],
  [/智能家居|物联网|iot/i, 'smart home iot'],
  [/人工智能|\bai\b|大模型|智能助手|聊天机器人/i, 'ai chatbot'],
  [/开发者|开发工具|\bide\b|代码/i, 'developer tool code'],
  [/安全|隐私/, 'security privacy'],
  [/作品集|个人主页|个人网站/, 'portfolio personal'],
  [/落地页|着陆页|官网|宣传页/, 'landing'],
  [/企业官网|公司官网|企业服务/, 'b2b service corporate'],
  [/saas|软件服务/i, 'saas software'],
  [/设计系统|组件库/, 'design system component library'],
  [/摄影|相册|修图/, 'photo photography'],
  [/农业/, 'agriculture farm'],
];

/** 太泛的词只给少量分数。 */
const WEAK = new Set(['app', 'apps', 'platform', 'tool', 'tools', 'web', 'site', 'website', 'page', 'design', 'ui', 'service', 'services', 'mobile', 'system', 'online', 'management']);

function terms(query: string): string[] {
  let q = query.toLowerCase();
  for (const [re, en] of ZH) if (re.test(q)) q += ` ${en}`;
  return [...new Set(q.split(/[^a-z0-9]+/).filter((t) => t.length > 1))];
}

export interface PresetMatch {
  id: string;
  name: string;
  style: string;
  color_focus?: string;
  score: number;
}

/** 按需求描述匹配产品类型，返回得分最高的若干个。 */
export function matchPresets(query: string, limit = 5): PresetMatch[] {
  const ts = terms(query);
  if (!ts.length) return [];
  const scored = catalog().products.map((p) => {
    const kw = new Set(p.keywords.flatMap((k) => [k, ...k.split(/[^a-z0-9]+/)]));
    const nameWords = new Set(p.name.toLowerCase().split(/[^a-z0-9]+/));
    let score = 0;
    for (const t of ts) {
      const w = WEAK.has(t) ? 0.3 : 1;
      if (nameWords.has(t)) score += 3 * w;
      else if (kw.has(t)) score += 2 * w;
      else if (t.length >= 4 && p.keywords.some((k) => k.includes(t))) score += 0.5 * w;
    }
    return { p, score };
  });
  return scored
    .filter((s) => s.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p, score }) => ({ id: p.id, name: p.name, style: p.style, ...(p.color_focus ? { color_focus: p.color_focus } : {}), score: Math.round(score * 10) / 10 }));
}

/** 匹配字体时忽略的词。 */
const FONT_STOP = new Set(['personal', 'general', 'tracker', 'and', 'the', 'for', 'with']);

function findStyle(name: string): Style | undefined {
  const n = name.trim().toLowerCase();
  return catalog().styles.find((s) => s.name.toLowerCase() === n || s.aliases.some((a) => a.toLowerCase() === n));
}

/** 完整预设：产品类型 + 解析出的风格详情 + 气质匹配的字体搭配。 */
export function presetDetail(id: string) {
  const p = catalog().products.find((x) => x.id === id);
  if (!p) return undefined;
  const names = [...p.style.split('+'), ...(p.secondary ?? '').split(/[+,]/)].map((s) => s.trim()).filter(Boolean);
  const styles = [...new Set(names)].map(findStyle).filter((s): s is Style => !!s);
  // 字体：产品领域词命中 best_for 记 2 分（前 5 个字母相同即算，如 finance / fintech），风格气质词命中 mood 记 1 分
  const split = (x: string) => x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !WEAK.has(w) && !FONT_STOP.has(w));
  const domain = [...new Set([...p.keywords, p.name].flatMap(split))];
  const moodWords = new Set(styles.slice(0, 2).flatMap((s) => s.keywords.flatMap(split)));
  const near = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));
  const fonts = catalog()
    .fonts.map((f) => {
      const best = split(f.best_for ?? '');
      const score = domain.filter((w) => best.some((b) => near(w, b))).length * 2 + f.mood.filter((m) => moodWords.has(m)).length;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ f }) => f);
  return {
    ...p,
    styles: styles.map((s, i) => ({ role: i === 0 ? 'primary' : 'secondary', ...s })),
    fonts,
    hint: '预设是起点：按用户的具体题材调整色相与强调色，用户指定的颜色 / 风格优先。tokens 可直接传给 tokens_set，再补上字体（带中文回退）、字号、间距、圆角令牌（见内置规范第 5 节）；更好的做法是 design_preset({id, use:true}) 后 design_system({action:"create", from:"preset"}) 存成项目的设计系统。',
  };
}

export const presetSource = () => catalog().source;
