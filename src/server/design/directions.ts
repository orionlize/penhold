// 设计方向卡片：提示词很短（如“移动端登录页”）、按产品类型匹配不到预设时的兜底。
// 把“风格原型 × 色板 × 字体 × 记忆点”组合成几个差异明显的方向，供 AI（或用户）选一个再动手，
// 避免模型退回自己的默认配色与版式。色板、风格详情与字体取自 guides/catalog.json。
import fs from 'node:fs';
import path from 'node:path';
import { canvasDir } from '../paths.js';
import { catalog, GUIDES_DIR, matchPresets, type FontPair, type Product, type Style } from './presets.js';
import { installedFonts } from './localFonts.js';
import { contrast as wcag, ensureContrast, fromOklch, HEX6 as HEX, hueGap as gap, onColor, toOklch } from '../../core/color.js';
import { deriveTheme, fixContrast, flattenSystem, systemFromFlat, textStyles, THEME_TOKEN, type DesignSystem, type Density, type Weights } from '../../core/designSystem.js';

/** 中文字体的类别：黑体、宋体、圆体、楷体。 */
export type CjkRole = 'sans' | 'serif' | 'round' | 'kai';

/** 风格原型：一种完整的视觉取向（形状、层次、字体气质、色板要求、记忆点）。 */
interface Archetype {
  id: string;
  name: string;
  mood: string;
  /** 色板要求。 */
  tone: 'light' | 'dark';
  chroma: 'vivid' | 'any' | 'neutral';
  /** 主色色相限定在这些区间内（度），缺省不限。 */
  hues?: Array<[from: number, to: number]>;
  /** 目录中对应的风格名（取其效果要点；也用于把产品类型的推荐风格映射回原型）。 */
  styles: string[];
  /** 字体气质词（匹配 FontPair.mood）。 */
  fontMoods: string[];
  /** 标题用哪一类中文字体（正文一律黑体）。 */
  cjk: CjkRole;
  /** 字体与字重的用法。 */
  type: string;
  /** 信息密度：决定字阶与间距。 */
  density: Density;
  /** 正文、强调、标题、展示级大字的字重。 */
  weights: Weights;
  /** 移动端展示级大字的字号（px）；桌面端按 1.6 倍。 */
  display: number;
  /** 形状与层次：圆角、边框、阴影令牌。 */
  radius: [sm: number, md: number, lg: number];
  shadow: [sm: string, md: string];
  shape: string;
  layout: string;
  /** 记忆点候选（每张卡片取一个）。 */
  signatures: string[];
  /** 这个方向下不要做的事。 */
  avoid: string[];
  /** 题材命中则加权。 */
  fits?: RegExp;
  /** 题材命中则排除。 */
  unfit?: RegExp;
  /** 只在题材命中 fits 时才出现（如高密度工具风）。 */
  onlyIfFits?: boolean;
}

const SERIOUS = /银行|金融|保险|医疗|医院|政务|政府|法律|律所|养老|bank|financ|insur|medical|health|clinic|government|legal|senior/i;
const KIDS = /儿童|少儿|幼儿|母婴|宝宝|kid|child|baby/i;

const ARCHETYPES: Archetype[] = [
  {
    id: 'swiss-precise',
    name: '瑞士网格 · 克制精确',
    mood: '理性、可信、信息清晰',
    tone: 'light',
    chroma: 'any',
    styles: ['Minimalism & Swiss Style', 'Swiss Modernism 2.0', 'Flat Design', 'Accessible & Ethical', 'Exaggerated Minimalism'],
    fontMoods: ['clean', 'minimal', 'geometric', 'precise', 'functional', 'modern', 'professional'],
    cjk: 'sans',
    type: '标题与正文同为黑体，只用 700 与 400 两档字重；标题字号至少是正文的 2.5 倍，辅助文字一律不加粗',
    density: 'regular',
    weights: { body: 400, medium: 400, heading: 700, display: 700 },
    display: 56,
    radius: [2, 4, 8],
    shadow: ['none', '0 8px 24px rgba(0,0,0,0.10)'],
    shape: '小圆角 2–8，1px 发丝线分隔，不用阴影分层（阴影只留给浮层）',
    layout: '严格左对齐，所有元素落在同一条左栅格线上；用留白和字号对比分层，不用卡片包裹',
    signatures: [
      '一个超大字号的标题或关键数字（至少是正文的 3 倍）贴左栅格线，其余文字保持小而安静',
      '一条通栏主色条或主色竖线贯穿页面，作为唯一的色彩重音',
      '标题与正文用极端字重对比（700 对 400），同一字体族，不加任何装饰图形',
    ],
    avoid: ['把内容切成一排排一样的圆角卡片', '装饰性渐变与插画', '居中对齐的大段文字'],
    fits: /后台|管理|工具|文档|企业|admin|saas|b2b|tool|doc|dashboard/i,
  },
  {
    id: 'soft-rounded',
    name: '柔和圆润 · 亲和轻松',
    mood: '友好、放松、没有压力',
    tone: 'light',
    chroma: 'any',
    styles: ['Soft UI Evolution', 'Neumorphism', 'Micro-interactions', 'Inclusive Design'],
    fontMoods: ['friendly', 'approachable', 'rounded', 'warm', 'readable', 'accessible'],
    cjk: 'round',
    type: '标题用圆体（本机没有时用黑体 600），正文黑体 400；全稿不超过 600，靠字号而不是加粗分层',
    density: 'regular',
    weights: { body: 400, medium: 500, heading: 600, display: 600 },
    display: 44,
    radius: [8, 16, 28],
    shadow: ['0 2px 8px rgba(16,24,40,0.06)', '0 12px 32px rgba(16,24,40,0.10)'],
    shape: '大圆角 16–28、胶囊按钮，大面积柔和扩散阴影，几乎不用描边',
    layout: '页面背景用主色的极浅色调（不是纯白或中性灰），内容块之间留足呼吸空间，一屏只放一件事',
    signatures: [
      '页面上半部是一整块主色浅色调的大圆角色块，承载标题与一句话说明，下半部才是操作区',
      '主按钮做成通栏胶囊形并带同色柔光阴影，是全页唯一高饱和的元素',
      '用 2–3 个不同尺寸、互相叠压的圆形或圆角色块做背景构图，替代插画',
    ],
    avoid: ['细灰描边的输入框堆叠', '所有卡片同一个圆角和同一个浅灰阴影', '冷灰色背景'],
    fits: /健康|冥想|睡眠|习惯|日记|社交|宠物|生活|wellness|habit|diary|social|pet|lifestyle/i,
  },
  {
    id: 'bold-block',
    name: '高饱和色块 · 活力直接',
    mood: '有冲劲、年轻、一眼记住',
    tone: 'light',
    chroma: 'vivid',
    styles: ['Vibrant & Block-based', 'Motion-Driven', 'Memphis Design', 'Gen Z Chaos / Maximalism'],
    fontMoods: ['bold', 'energetic', 'loud', 'strong', 'poster', 'creative', 'fun'],
    cjk: 'sans',
    type: '标题用黑体最粗一档（800–900），正文 400；粗体只给标题和主按钮，其余文字不加粗',
    density: 'regular',
    weights: { body: 400, medium: 700, heading: 900, display: 900 },
    display: 52,
    radius: [6, 12, 20],
    shadow: ['none', '0 10px 30px rgba(0,0,0,0.14)'],
    shape: '中等圆角，色块之间硬切分（不用渐变过渡、不用阴影），描边只用于输入框',
    layout: '用大面积纯色分区：主色铺满一整块区域而不是只出现在按钮上；标题粗而大，可以压在色块上',
    signatures: [
      '主色铺满页面上部约 40% 的高度，标题用反白超粗字压在上面，表单或内容卡片向上叠入色块',
      '主色与强调色两块纯色对撞分区，交界处放页面最重要的那个元素',
      '标题里的一个关键词换成强调色底的色块高亮（文字反白），其余标题为正文色',
    ],
    avoid: ['白底 + 只有按钮是主色', '浅灰卡片阴影', '主色只以 10% 透明度出现'],
    fits: /电商|外卖|餐|游戏|运动|健身|音乐|活动|年轻|shop|food|game|fitness|sport|music|event/i,
    unfit: SERIOUS,
  },
  {
    id: 'dark-immersive',
    name: '深色沉浸 · 聚焦内容',
    mood: '专注、有质感、夜间友好',
    tone: 'dark',
    chroma: 'any',
    styles: ['Dark Mode (OLED)', 'Modern Dark (Cinema Mobile)', 'AI-Native UI', 'HUD / Sci-Fi FUI'],
    fontMoods: ['modern', 'tech', 'futuristic', 'technical', 'dark', 'precise', 'premium'],
    cjk: 'sans',
    type: '标题黑体 600，正文 400；关键数字用 font.mono 或表格数字，字号至少是正文的 3 倍',
    density: 'regular',
    weights: { body: 400, medium: 500, heading: 600, display: 600 },
    display: 56,
    radius: [6, 12, 18],
    shadow: ['0 0 0 1px rgba(255,255,255,0.06)', '0 16px 48px rgba(0,0,0,0.5)'],
    shape: '中等圆角；层次靠背景明度递进（背景 → 卡片 → 浮层逐级变亮），用 1px 半透明亮边代替阴影',
    layout: '背景带一点色相（深蓝黑、深紫黑、深绿黑），不用纯黑；文字用 3 档明度（主文字、次要、禁用）',
    signatures: [
      '主按钮或关键数字带同色外发光（shadow 0 0 24px 主色半透明），是暗背景上唯一发亮的元素',
      '页面顶部一块径向渐变的主色光晕从角落透出（低透明度），其余区域保持纯净暗色',
      '关键数据用超大号等宽数字，配一条主色细线，其余信息全部降为次要明度',
    ],
    avoid: ['纯黑 #000 背景配单一荧光绿或朱红', '在深色上用深色阴影分层', '大面积高饱和色块'],
    fits: /视频|影视|音乐|游戏|加密|开发者|代码|ai|人工智能|video|music|game|crypto|developer|code|stream/i,
    unfit: /儿童|少儿|幼儿|母婴|政务|政府|养老|kid|child|baby|government|senior/i,
  },
  {
    id: 'editorial',
    name: '杂志编辑 · 排版优先',
    mood: '有品位、从容、内容为王',
    tone: 'light',
    chroma: 'any',
    styles: ['Editorial Grid / Magazine', 'Kinetic Typography', 'Bold Typography (Mobile Poster)', 'E-Ink / Paper', 'Academia (Scholarly Mobile)'],
    fontMoods: ['editorial', 'elegant', 'sophisticated', 'refined', 'luxury', 'fashion', 'journalism', 'traditional'],
    cjk: 'serif',
    type: '标题、引语与大数字用宋体 700–900，正文与界面控件用黑体 400；衬线不用于按钮、标签和小字',
    density: 'airy',
    weights: { body: 400, medium: 400, heading: 700, display: 900 },
    display: 48,
    radius: [0, 2, 4],
    shadow: ['none', '0 12px 40px rgba(0,0,0,0.12)'],
    shape: '近乎直角，几乎没有容器；层次完全靠字号、字重、衬线与无衬线的对比',
    layout: '不对称构图：标题占据大面积并靠左或靠一侧，正文窄栏；相邻两级字号之比不小于 1.5',
    signatures: [
      '衬线大标题跨两到三行，行高收紧到 1.1–1.2，其中一个词用斜体或强调色',
      '一张大图或一整块纯色占满半屏，标题压在其边缘上（半压图、半留白）',
      '用超大的编号、日期或首字作为版面图形元素，颜色取强调色',
    ],
    avoid: ['暖米色背景 + 赤陶色强调的组合', '每个标题上方加全大写小标签', '把文章切成卡片'],
    fits: /博客|杂志|新闻|资讯|阅读|奢侈|高端|时尚|作品集|酒店|blog|magazine|news|read|luxury|fashion|portfolio|hotel/i,
  },
  {
    id: 'neo-brutal',
    name: '新粗野 · 粗边硬阴影',
    mood: '直率、有态度、带点幽默',
    tone: 'light',
    chroma: 'vivid',
    styles: ['Neubrutalism', 'Neo Brutalism (Mobile)', 'Brutalism', 'Kinetic Brutalism (Mobile)', 'Anti-Polish / Raw Aesthetic'],
    fontMoods: ['bold', 'brutalist', 'loud', 'strong', 'geometric', 'creative', 'playful'],
    cjk: 'sans',
    type: '标题黑体 900，正文 500；标签与按钮文字 700，全稿不用细体',
    density: 'regular',
    weights: { body: 500, medium: 700, heading: 900, display: 900 },
    display: 48,
    radius: [0, 6, 10],
    shadow: ['4px 4px 0 #000000', '6px 6px 0 #000000'],
    shape: '2px 纯黑描边 + 不带模糊的硬偏移阴影（4px 4px 0），圆角很小；色块为不透明纯色',
    layout: '元素像贴纸一样有明确的边界，可以轻微错位或旋转 1–2 度；背景用浅色纯色而非白色',
    signatures: [
      '主按钮是带 2px 黑边与硬阴影的纯色块，按下态阴影归零并位移（states.active）',
      '标题用超粗字体，其中一个词放在旋转 -2 度的强调色贴纸块里',
      '每个输入框和卡片都有黑边硬阴影，但整页只用两种填充色',
    ],
    avoid: ['柔和的扩散阴影', '半透明与渐变', '细灰描边'],
    fits: /创意|潮流|社区|工具|独立|年轻|creative|community|indie|gen ?z/i,
    unfit: SERIOUS,
  },
  {
    id: 'glass-aurora',
    name: '渐变光感 · 通透',
    mood: '轻盈、现代、有科技感',
    tone: 'light',
    chroma: 'vivid',
    styles: ['Glassmorphism', 'Aurora UI', 'Liquid Glass', 'Gradient Mesh / Aurora Evolved', 'Spatial UI (VisionOS)'],
    fontMoods: ['modern', 'clean', 'innovative', 'startup', 'tech', 'premium', 'futuristic'],
    cjk: 'sans',
    type: '标题黑体 600、字距略收紧（letterSpacing -0.5），正文 400；毛玻璃上不用 700 以上的字重',
    density: 'regular',
    weights: { body: 400, medium: 500, heading: 600, display: 600 },
    display: 44,
    radius: [10, 16, 24],
    shadow: ['0 4px 16px rgba(31,38,135,0.08)', '0 16px 48px rgba(31,38,135,0.16)'],
    shape: '大圆角；卡片为半透明白（约 60–70% 不透明）+ backdropBlur 16–24 + 1px 半透明白色描边',
    layout: '背景是两到三个大色团组成的柔和渐变（主色、强调色与一个相邻色相），内容浮在其上；渐变只在背景出现',
    signatures: [
      '背景是从一角扩散的大面积主色到强调色渐变光团，唯一的毛玻璃卡片居中承载全部操作',
      '顶部一个巨大的模糊渐变圆（blur 60 以上）从画板边缘探出一半，是页面唯一的图形',
      '主按钮用主色到强调色的线性渐变，其余元素全部为半透明白或中性色',
    ],
    avoid: ['每张卡片都加渐变', '渐变文字', '纯白背景上叠毛玻璃（没有可透出的内容）'],
    fits: /ai|人工智能|助手|云|saas|科技|智能|assistant|cloud|tech|startup/i,
    unfit: /政务|政府|养老|government|senior/i,
  },
  {
    id: 'organic-natural',
    name: '自然有机 · 温润',
    mood: '安心、天然、有手作感',
    tone: 'light',
    chroma: 'any',
    hues: [[15, 60], [70, 170]],
    styles: ['Organic Biophilic', 'Nature Distilled', 'Biomimetic / Organic 2.0', 'Sketch Hand-Drawn (Mobile)'],
    fontMoods: ['organic', 'warm', 'friendly', 'elegant', 'traditional', 'readable', 'approachable'],
    cjk: 'kai',
    type: '标题用楷体（本机没有时用宋体）600，正文黑体 400；手写感字体只用于标题与一句引语',
    density: 'regular',
    weights: { body: 400, medium: 500, heading: 600, display: 600 },
    display: 44,
    radius: [8, 14, 24],
    shadow: ['0 2px 6px rgba(60,48,30,0.08)', '0 10px 28px rgba(60,48,30,0.14)'],
    shape: '不对称圆角（如 [28, 8, 28, 8]）与叶片、卵石般的形状；阴影带暖色调',
    layout: '色彩取自自然物（苔绿、陶土、燕麦、深棕），背景为带暖调的浅色；图片或色块用不规则圆角裁切',
    signatures: [
      '主视觉区是一个四角圆角各不相同的大色块（如 [48, 12, 48, 12]），像一片叶子或卵石',
      '用两个深浅不同的同色系不规则色块叠压，形成地形般的背景层次',
      '按钮与标签使用不对称圆角，全页重复同一种“叶片”形状作为识别元素',
    ],
    avoid: ['冷蓝或纯灰', '直角与发丝线', '高饱和荧光色'],
    fits: /茶|咖啡|烘焙|农|植物|花|瑜伽|冥想|美容|护肤|有机|民宿|食谱|tea|cafe|bakery|farm|plant|yoga|spa|organic|recipe/i,
  },
  {
    id: 'mono-accent',
    name: '黑白单色 · 一点强调',
    mood: '冷静、高级、极度克制',
    tone: 'light',
    chroma: 'neutral',
    styles: ['Minimalist Monochrome', 'Exaggerated Minimalism', 'Minimalism & Swiss Style', 'E-Ink / Paper'],
    fontMoods: ['minimal', 'sophisticated', 'refined', 'premium', 'neutral', 'modern', 'luxury'],
    cjk: 'serif',
    type: '标题用宋体最粗一档，正文黑体 400；辅助信息用小字号加大字距，不用加粗',
    density: 'airy',
    weights: { body: 400, medium: 400, heading: 700, display: 900 },
    display: 64,
    radius: [0, 4, 8],
    shadow: ['none', '0 12px 32px rgba(0,0,0,0.12)'],
    shape: '黑、白与两三档灰构成全部界面；主按钮是纯黑（或纯白）实心块',
    layout: '强调色一屏最多出现三次，只标记最重要的状态或行动；其余靠黑白反差与大留白',
    signatures: [
      '整页只有一个元素带颜色（强调色），其余全为黑白灰；这个元素就是页面的主行动或关键状态',
      '黑色实心区块与白色区块上下对切，标题反白压在黑色区块上',
      '标题字号极大、字距收紧（letterSpacing -1 到 -2），与极小的辅助文字形成反差',
    ],
    avoid: ['用 #111 之类的近黑代替纯黑', '多个强调色', '灰色描边卡片堆叠'],
    fits: /奢侈|高端|时尚|作品集|摄影|建筑|设计|luxury|fashion|portfolio|photo|architect/i,
    unfit: KIDS,
  },
  {
    id: 'playful-clay',
    name: '俏皮立体 · 软陶质感',
    mood: '好玩、可爱、想去戳一下',
    tone: 'light',
    chroma: 'vivid',
    styles: ['Claymorphism', 'Claymorphism (Mobile)', '3D & Hyperrealism', 'Tactile Digital / Deformable UI', 'Material 3 Expressive (Mobile)'],
    fontMoods: ['playful', 'fun', 'rounded', 'friendly', 'education', 'creative', 'energetic'],
    cjk: 'round',
    type: '标题用圆体或黑体 800，正文 500；字号整体偏大（正文 16 起），数字用最粗一档',
    density: 'airy',
    weights: { body: 500, medium: 700, heading: 800, display: 800 },
    display: 48,
    radius: [12, 20, 32],
    shadow: ['0 4px 0 rgba(0,0,0,0.12)', '0 12px 24px rgba(0,0,0,0.16)'],
    shape: '特大圆角 20–32；控件有厚度：底部 4px 同色加深的实心投影 + 顶部内高光（innerShadow）',
    layout: '用 3–4 个明快的纯色区分功能，色块饱满；字号偏大、行距宽松，触控目标不小于 48',
    signatures: [
      '主按钮像一块有厚度的软糖：底部 4–6px 加深色实心阴影，按下态下沉（states.active 位移并去掉阴影）',
      '每个功能入口是一块不同颜色的大圆角色块，配一个大号的简单几何图形或粗线条图标（不用 emoji）',
      '进度、等级或奖励用粗圆角进度条与大号数字表达，成为首屏主角',
    ],
    avoid: ['细线与小字号', '灰色调', '严肃的直角表格'],
    fits: /儿童|少儿|幼儿|教育|学习|背单词|游戏|习惯|宠物|kid|child|education|learn|game|habit|pet/i,
    unfit: /银行|金融|保险|政务|政府|法律|律所|企业|后台|bank|financ|insur|government|legal|b2b|admin/i,
  },
  {
    id: 'bauhaus-geo',
    name: '包豪斯几何 · 原色构成',
    mood: '明快、理性又有趣、有设计感',
    tone: 'light',
    chroma: 'vivid',
    styles: ['Bauhaus (包豪斯)', 'Memphis Design', 'Retro-Futurism', 'Vintage Analog / Retro Film', 'Flat Design'],
    fontMoods: ['geometric', 'bold', 'retro', 'creative', 'artistic', 'modern', 'strong'],
    cjk: 'sans',
    type: '标题黑体 800、字距收紧，正文 400；全稿只用这两档字重',
    density: 'regular',
    weights: { body: 400, medium: 400, heading: 800, display: 800 },
    display: 56,
    radius: [0, 0, 4],
    shadow: ['none', '0 10px 30px rgba(0,0,0,0.14)'],
    shape: '只用三种基本形：正圆、正方、直线；圆角要么为 0 要么为全圆；颜色平涂',
    layout: '用圆、半圆、四分之一圆与矩形色块拼出构图，文字严格对齐到这些几何形的边缘',
    signatures: [
      '首屏由一个大圆（或半圆）与一个矩形色块构成几何构图，分别使用主色与强调色，标题对齐其边缘',
      '用四分之一圆色块卡在画板一角，作为全套页面重复出现的识别图形',
      '按钮为全圆角胶囊或正圆，卡片为直角，两种形状形成对比并全稿一致',
    ],
    avoid: ['渐变与阴影', '中等大小的圆角（8–12）', '四种以上的颜色'],
    fits: /设计|艺术|展览|活动|教育|品牌|创意|design|art|exhibit|event|education|brand|creative/i,
    unfit: /医疗|医院|银行|保险|medical|clinic|bank|insur/i,
  },
  {
    id: 'data-dense',
    name: '高密度专业工具',
    mood: '高效、一屏看全、为熟手而做',
    tone: 'light',
    chroma: 'any',
    styles: ['Data-Dense Dashboard', 'Enterprise SaaS (Mobile)', 'Executive Dashboard', 'Real-Time Monitoring', 'Bento Box Grid'],
    fontMoods: ['data', 'technical', 'precise', 'professional', 'functional', 'developer', 'clean'],
    cjk: 'sans',
    type: '正文 size.sm（12）/ 400，表头与标签 500，只有关键指标用 700；数字用 font.mono 或表格数字对齐',
    density: 'compact',
    weights: { body: 400, medium: 500, heading: 700, display: 700 },
    display: 40,
    radius: [2, 4, 6],
    shadow: ['none', '0 8px 24px rgba(0,0,0,0.12)'],
    shape: '小圆角 2–6，1px 分隔线，行高紧凑（表格行 32–40），数字用等宽或表格数字',
    layout: '信息密度优先：正文 12px（size.sm），用对齐与分隔线而不是卡片留白来组织；颜色只表达状态',
    signatures: [
      '一个关键指标用超大数字置顶，其余指标以紧凑的表格或小型趋势条呈现，不做等大卡片阵列',
      '左侧窄图标导航 + 主区表格 + 右侧详情抽屉的三栏结构，一屏完成“看—选—改”',
      '状态用 6px 色点 + 文字表达，全页彩色只来自状态点与一个主行动按钮',
    ],
    avoid: ['四个等大的统计卡片排成一行', '大面积留白与超大圆角', '装饰性图标与插画'],
    fits: /后台|管理|看板|仪表盘|监控|数据|报表|crm|erp|admin|dashboard|analytic|monitor|console/i,
    onlyIfFits: true,
  },
];

// ---------- 颜色工具 ----------

function hsl(hex: string): [h: number, s: number, l: number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0.5];
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (!d) return [0, 0, l];
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, d / (1 - Math.abs(2 * l - 1)), l];
}
/** WCAG 对比度。 */
export const contrast = (a: string, b: string) => wcag(a, b);

const HEX6 = HEX;
/** 状态色不随主色转动（红色仍表示危险）。 */
const FIXED_HUE = /^color\.(danger|success|warning|info)\b|^color\.on-/;

/**
 * 把色板改到指定主色：在 OKLCH 里整体转动色相，各颜色的明度与彩度保持不变（超出色域时降彩度），
 * 再修正对比度（主色 / 强调色上的文字取黑或白，正文与次要文字对背景不低于 4.5:1，主色对背景不低于 3:1）。
 */
export function recolor(tokens: Record<string, string>, primary: string): Record<string, string> {
  const from = tokens['color.primary'];
  if (!HEX6.test(primary) || !from || !HEX6.test(from)) return tokens;
  const delta = toOklch(primary)[2] - toOklch(from)[2];
  const out: Record<string, string> = { ...tokens };
  for (const [k, v] of Object.entries(tokens)) {
    if (!k.startsWith('color.') || !HEX6.test(v) || FIXED_HUE.test(k)) continue;
    const [l, c, h] = toOklch(v);
    if (c >= 0.015) out[k] = fromOklch([l, c, h + delta]);
  }
  out['color.primary'] = primary.toUpperCase();
  if (tokens['color.ring'] && HEX6.test(tokens['color.ring'])) out['color.ring'] = out['color.primary'];
  // 色块上的文字：原来的颜色够对比就保留，否则取黑白中对比更高的
  for (const base of ['primary', 'secondary', 'accent']) {
    const bg = out[`color.${base}`];
    const on = `color.on-${base}`;
    if (!bg || !HEX6.test(bg) || !out[on] || !HEX6.test(out[on])) continue;
    if (contrast(out[on], bg) < 4.5) out[on] = onColor(bg);
  }
  const fix = (fgKey: string, bgKey: string, min = 4.5) => {
    const bg = out[bgKey];
    const fg = out[fgKey];
    if (bg && fg && HEX6.test(bg) && HEX6.test(fg)) out[fgKey] = ensureContrast(fg, bg, min);
  };
  fix('color.fg', 'color.bg');
  fix('color.muted-fg', 'color.bg');
  fix('color.card-fg', 'color.card');
  return out;
}

const hueGap = gap;

/** 可复现的伪随机数（mulberry32）。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T>(items: T[], weight: (x: T) => number, rand: () => number): T | undefined {
  const ws = items.map((x) => Math.max(0, weight(x)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return undefined;
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ---------- 目录索引 ----------

interface Swatch {
  p: Product;
  hue: number;
  sat: number;
  dark: boolean;
  bucket: string;
}
let swatchCache: Swatch[] | undefined;
function swatches(): Swatch[] {
  return (swatchCache ??= catalog().products.map((p) => {
    const [hue, sat] = hsl(p.tokens['color.primary']);
    const dark = hsl(p.tokens['color.bg'])[2] < 0.35;
    return { p, hue, sat, dark, bucket: sat < 0.15 ? 'neutral' : String(Math.floor(hue / 30)) };
  }));
}

function paletteFits(a: Archetype, s: Swatch): boolean {
  if ((a.tone === 'dark') !== s.dark) return false;
  if (a.chroma === 'neutral') return s.sat < 0.2;
  if (a.hues && !a.hues.some(([from, to]) => s.hue >= from && s.hue <= to)) return false;
  if (a.chroma === 'vivid') return s.sat >= 0.5;
  return s.sat >= 0.15;
}

const styleByName = (name: string): Style | undefined => {
  const n = name.toLowerCase();
  return catalog().styles.find((s) => s.name.toLowerCase() === n || s.aliases.some((x) => x.toLowerCase() === n));
};

/** 产品类型推荐的风格（主风格优先，其次备选风格）对应的原型；只取与该产品色板相容的。 */
function archetypeOf(p: Product, usable: Archetype[]): Archetype | undefined {
  const s = swatches().find((x) => x.p.id === p.id);
  if (!s) return undefined;
  const names = [...p.style.split('+'), ...(p.secondary ?? '').split(/[+,]/)].map((x) => x.trim().toLowerCase()).filter(Boolean);
  for (const name of names) {
    const a = usable.find((x) => paletteFits(x, s) && x.styles.some((st) => st.toLowerCase() === name));
    if (a) return a;
  }
  return usable.find((x) => paletteFits(x, s) && !x.onlyIfFits);
}

// ---------- 生成 ----------

export interface DirectionCard {
  id: string;
  name: string;
  mood: string;
  /** 这张卡片的由来：贴合题材的常规解，还是有意拉开差异的方案。 */
  basis: string;
  palette: { from: string; primary: string; accent: string; bg: string; fg: string };
  style: string;
  fonts: string;
  shape: string;
  layout: string;
  signature: string;
}

export interface DirectionInput {
  /** 需求描述：用户原话、画布标题、页面与区块名等拼在一起。 */
  brief?: string;
  /** 同项目近期画布用过的主色，尽量避开相近色相。 */
  avoidColors?: string[];
  /** 同项目近期画布用过的原型 id，降低权重。 */
  avoidArchetypes?: string[];
  seed?: number;
  count?: number;
}

const SEP = '/';
/** 面向其他文字系统的字体，中文界面用不上。 */
const FOREIGN_FONT = /thai|hebrew|arabic|devanagari|bengali|tamil|khmer|\b(jp|kr|tc|hk)\b|vietnam|cyrillic/i;

function fontsFor(a: Archetype): Array<{ f: FontPair; i: number; score: number }> {
  const have = installedFonts();
  return catalog()
    .fonts.map((f, i) => ({ f, i, score: f.mood.filter((m) => a.fontMoods.includes(m)).length * (have?.has(f.heading.toLowerCase()) ? 3 : 1) }))
    .filter((x) => x.score > 0 && !FOREIGN_FONT.test(`${x.f.heading} ${x.f.body}`) && !x.f.mood.includes('multilingual'));
}

// ---------- 字体栈：只用本机已安装的字体 ----------

/** 各类中文字体的候选，按优先顺序。 */
const CJK_FAMILIES: Record<CjkRole, string[]> = {
  sans: ['PingFang SC', 'HarmonyOS Sans SC', 'MiSans', 'Source Han Sans SC', 'Noto Sans CJK SC', 'Noto Sans SC', 'Microsoft YaHei'],
  serif: ['Source Han Serif SC', 'Noto Serif CJK SC', 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun'],
  round: ['Yuanti SC', 'Resource Han Rounded SC', 'YouYuan'],
  kai: ['LXGW WenKai', 'LXGW WenKai GB', 'Kaiti SC', 'STKaiti', 'KaiTi'],
};
/** 本机没有这一类字体时依次退到哪一类。 */
const CJK_FALLBACK: Record<CjkRole, CjkRole[]> = { sans: ['sans'], serif: ['serif', 'sans'], round: ['round', 'sans'], kai: ['kai', 'serif', 'sans'] };
const ROLE_NAME: Record<CjkRole, string> = { sans: '黑体', serif: '宋体', round: '圆体', kai: '楷体' };
const MONO_FAMILIES = ['JetBrains Mono', 'SF Mono', 'Menlo', 'Cascadia Mono', 'Consolas', 'Maple Mono NF CN', 'Noto Sans Mono', 'DejaVu Sans Mono', 'Liberation Mono'];
const CJK_SANS = 'PingFang SC, Noto Sans SC, Microsoft YaHei, sans-serif';
const CJK_SERIF = 'Noto Serif SC, Songti SC, serif';
const isSerif = (category: string, which: 'heading' | 'body') => {
  const parts = category.split('+').map((s) => s.trim().toLowerCase());
  const part = which === 'heading' ? parts[0] : (parts[1] ?? parts[0]);
  return /serif/.test(part ?? '') && !/sans/.test(part ?? '');
};
const serifLike = (r: CjkRole) => r === 'serif' || r === 'kai';

interface FontStack {
  /** fontFamily 值：第一个字体族一定是本机已安装的（检测不到本机字体时除外）。 */
  css: string;
  /** 实际用上的中文字体与类别。 */
  cjk?: string;
  role: CjkRole;
  /** 保留在栈首的西文字体。 */
  latin?: string;
  /** 想用但本机没有、已去掉的字体或字体类别。 */
  dropped: string[];
}

/**
 * 由“西文字体 + 中文字体类别”得到字体栈。西文字体只在已安装且与中文字体同为衬线 / 无衬线时保留，
 * 否则去掉（西文与数字跟随中文字体），避免画布回退渲染并被自检报为缺失字体。
 */
function fontStack(latin: string, latinSerif: boolean, want: CjkRole): FontStack {
  const have = installedFonts();
  if (!have) {
    // 检测不到本机字体：按西文字体的类别给通用回退
    const role: CjkRole = latinSerif ? 'serif' : 'sans';
    return { css: `${latin}, ${latinSerif ? CJK_SERIF : CJK_SANS}`, role, latin, dropped: [] };
  }
  const dropped: string[] = [];
  let role = want;
  let cjk: string[] = [];
  for (const r of CJK_FALLBACK[want]) {
    cjk = CJK_FAMILIES[r].filter((f) => have.has(f.toLowerCase())).slice(0, 2);
    role = r;
    if (cjk.length) break;
    dropped.push(ROLE_NAME[r]);
  }
  const keepLatin = have.has(latin.toLowerCase()) && latinSerif === serifLike(role);
  if (!keepLatin && !have.has(latin.toLowerCase())) dropped.push(latin);
  const css = [...(keepLatin ? [latin] : []), ...cjk, serifLike(role) ? 'serif' : 'sans-serif'].join(', ');
  return { css, role, ...(cjk[0] ? { cjk: cjk[0] } : {}), ...(keepLatin ? { latin } : {}), dropped };
}

function stacksFor(a: Archetype, f: FontPair): { heading: FontStack; body: FontStack; mono?: string } {
  const have = installedFonts();
  const mono = have ? MONO_FAMILIES.find((m) => have.has(m.toLowerCase())) : undefined;
  return {
    heading: fontStack(f.heading, isSerif(f.category, 'heading'), a.cjk),
    body: fontStack(f.body, isSerif(f.category, 'body'), 'sans'),
    ...(mono ? { mono } : {}),
  };
}

const stackLabel = (s: FontStack) => (s.cjk ? `${s.cjk}（${ROLE_NAME[s.role]}）${s.latin ? ` + ${s.latin}` : ''}` : (s.latin ?? s.css));

function card(a: Archetype, s: Swatch, fontIdx: number, sigIdx: number, basis: string): DirectionCard {
  const f = catalog().fonts[fontIdx];
  const t = s.p.tokens;
  return {
    id: [a.id, s.p.id, fontIdx, sigIdx].join(SEP),
    name: a.name,
    mood: a.mood,
    basis,
    palette: { from: s.p.name, primary: t['color.primary'], accent: t['color.accent'] ?? t['color.secondary'] ?? t['color.primary'], bg: t['color.bg'], fg: t['color.fg'] },
    style: a.styles[0],
    fonts: f ? fontsLabel(a, f) : '',
    shape: a.shape,
    layout: a.layout,
    signature: a.signatures[sigIdx] ?? a.signatures[0],
  };
}

/** 卡片上的字体说明：本机字体可知时写实际会用上的字体。 */
function fontsLabel(a: Archetype, f: FontPair): string {
  if (!installedFonts()) return `${f.heading} / ${f.body}`;
  const st = stacksFor(a, f);
  return `标题 ${stackLabel(st.heading)} / 正文 ${stackLabel(st.body)}`;
}

/** 生成若干差异明显的设计方向：原型互不相同、主色色相拉开、至多一个深色方向。 */
export function suggestDirections(input: DirectionInput = {}): DirectionCard[] {
  const brief = input.brief ?? '';
  const count = Math.min(Math.max(input.count ?? 3, 1), 5);
  const rand = rng(input.seed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)));
  const matches = brief ? matchPresets(brief, 6) : [];
  const matchScore = new Map(matches.map((m) => [m.id, m.score]));
  const avoidHues = (input.avoidColors ?? []).map((c) => hsl(c)).filter(([, s]) => s >= 0.15).map(([h]) => h);
  const avoidArch = new Set(input.avoidArchetypes ?? []);
  const all = swatches();
  const bucketSize = new Map<string, number>();
  for (const s of all) bucketSize.set(s.bucket, (bucketSize.get(s.bucket) ?? 0) + 1);

  const usable = ARCHETYPES.filter((a) => !(a.unfit && a.unfit.test(brief)) && !(a.onlyIfFits && !(a.fits && a.fits.test(brief))));
  const out: DirectionCard[] = [];
  const usedArch = new Set<string>();
  const usedHues: number[] = [];
  const usedFonts = new Set<number>();
  const usedProducts = new Set<string>();

  const palette = (a: Archetype, prefer?: string): Swatch | undefined => {
    const fit = all.filter((s) => paletteFits(a, s) && !usedProducts.has(s.p.id));
    const forced = prefer ? fit.find((s) => s.p.id === prefer) : undefined;
    if (forced) return forced;
    const weight = (s: Swatch, strict: boolean) => {
      const neutral = s.bucket === 'neutral';
      if (strict && !neutral && usedHues.some((h) => hueGap(h, s.hue) < 45)) return 0;
      // 目录中蓝色系占三分之一以上：按色相桶的大小反向加权，让各色相机会接近
      let w = 1 / (bucketSize.get(s.bucket) ?? 1);
      if (!neutral && avoidHues.some((h) => hueGap(h, s.hue) < 25)) w *= 0.08;
      const m = matchScore.get(s.p.id);
      if (m) w *= 4 + m;
      return w;
    };
    return pickWeighted(fit, (s) => weight(s, true), rand) ?? pickWeighted(fit, (s) => weight(s, false), rand);
  };

  const add = (a: Archetype, basis: string, prefer?: string): boolean => {
    const s = palette(a, prefer);
    if (!s) return false;
    const fonts = fontsFor(a);
    const f = pickWeighted(fonts, (x) => (usedFonts.has(x.i) ? 0.05 : x.score * x.score), rand);
    const sig = Math.floor(rand() * a.signatures.length);
    out.push(card(a, s, f?.i ?? 0, sig, basis));
    usedArch.add(a.id);
    usedProducts.add(s.p.id);
    if (s.bucket !== 'neutral') usedHues.push(s.hue);
    if (f) usedFonts.add(f.i);
    return true;
  };

  // 1. 题材明确时，第一张用该产品类型的推荐风格与色板（稳妥解）
  const top = matches[0] && catalog().products.find((p) => p.id === matches[0].id);
  if (top) {
    const a = archetypeOf(top, usable);
    if (a) add(a, `贴合题材的常规解：「${top.name}」的推荐风格与色板`, top.id);
  }
  // 2. 其余按权重抽取不同的原型，有意拉开差异
  let guard = 0;
  while (out.length < count && guard++ < 40) {
    const hasDark = out.some((c) => ARCHETYPES.find((a) => a.id === c.id.split(SEP)[0])?.tone === 'dark');
    const a = pickWeighted(
      usable.filter((x) => !usedArch.has(x.id) && !(hasDark && x.tone === 'dark')),
      (x) => (x.fits && x.fits.test(brief) ? 3 : 1) * (avoidArch.has(x.id) ? 0.25 : 1),
      rand,
    );
    if (!a) break;
    if (!add(a, out.length ? '有意拉开差异的方案' : '题材不明确时的一个明确取向')) usedArch.add(a.id);
  }
  return out;
}

/** 由卡片 id 还原完整方向：可直接传给 tokens_set 的令牌、风格详情、字体与注意事项。 */
export function directionDetail(id: string, briefHint?: string, primary?: string) {
  const [aid, pid, fi, si] = id.split(SEP);
  const a = ARCHETYPES.find((x) => x.id === aid);
  const s = swatches().find((x) => x.p.id === pid);
  const fontIdx = Number(fi);
  const sigIdx = Number(si);
  const f = catalog().fonts[fontIdx];
  if (!a || !s || !f || !Number.isInteger(sigIdx) || !a.signatures[sigIdx]) return undefined;
  const c = card(a, s, fontIdx, sigIdx, '');
  const styles = a.styles.map(styleByName).filter((x): x is Style => !!x).slice(0, 2);
  const st = stacksFor(a, f);
  const known = !!installedFonts();
  const dropped = [...new Set([...st.heading.dropped, ...st.body.dropped])];
  const sameFamily = st.heading.css.split(',')[0] === st.body.css.split(',')[0];
  const fontNotes = [
    ...(dropped.length ? [`本机没有 ${dropped.join('、')}，已从字体栈中去掉，不要再写进 fontFamily`] : []),
    ...(known && sameFamily ? ['标题与正文是同一个字体族：层级只能靠字号与字重，标题字号至少取正文的 2 倍，字重只用两档'] : []),
    ...(!known && f.notes ? [f.notes] : []),
  ];
  const matched = matchPresets(briefHint ?? '', 8).some((m) => m.id === s.p.id);
  const recolored = !!primary && HEX6.test(primary) && primary.toUpperCase() !== s.p.tokens['color.primary']?.toUpperCase();
  const tokens: Record<string, string> = {
    ...(recolored ? recolor(s.p.tokens, primary!) : s.p.tokens),
    'font.heading': st.heading.css,
    'font.body': st.body.css,
    ...(st.mono ? { 'font.mono': `${st.mono}, monospace` } : {}),
    'radius.sm': `${a.radius[0]}px`,
    'radius.md': `${a.radius[1]}px`,
    'radius.lg': `${a.radius[2]}px`,
    'radius.full': '999px',
    'shadow.sm': a.shadow[0],
    'shadow.md': a.shadow[1],
  };
  return {
    id,
    archetype: a.id,
    name: a.name,
    mood: a.mood,
    palette_from: s.p.name,
    ...(s.p.color_focus ? { color_focus: s.p.color_focus } : {}),
    tokens,
    ...(recolored
      ? { palette_note: `色板已按主色 ${primary!.toUpperCase()} 重算：沿用「${s.p.name}」预设的明度与饱和度搭配，色相整体转到新主色，文字对比度已修正` }
      : briefHint !== undefined && !matched
        ? { palette_note: `色板取自「${s.p.name}」预设，不是按本题材挑的。从题材里真实存在的颜色取一个主色（钓鱼：湖水的青绿；茶：茶汤的琥珀），再调用一次 design_direction 并传 primary:"#RRGGBB"，整套色板会按它重算并修正对比度` }
        : {}),
    fonts: {
      heading: known ? stackLabel(st.heading) : f.heading,
      body: known ? stackLabel(st.body) : f.body,
      ...(st.mono ? { mono: st.mono } : {}),
      ...(fontNotes.length ? { notes: fontNotes.join('；') } : {}),
    },
    typography: a.type,
    shape: a.shape,
    layout: a.layout,
    signature: c.signature,
    avoid: a.avoid,
    styles: styles.map((x) => ({ name: x.name, ...(x.effects ? { effects: x.effects } : {}), ...(x.variables ? { variables: x.variables } : {}) })),
  };
}

export type DirectionDetail = NonNullable<ReturnType<typeof directionDetail>>;

export interface DirectionExample {
  subject: string;
  shows: string;
  width: number;
  /** 可直接作为 node_insert 的 nodes[0] 的节点树（只引用令牌）。 */
  root: unknown;
}

const exampleCache = new Map<string, DirectionExample | null>();
/** 方向的示例稿（guides/examples/<原型 id>.json）：一张移动端首屏，示范形状、层次、字重与记忆点的画法。 */
export function directionExample(id: string): DirectionExample | undefined {
  const aid = id.split(SEP)[0];
  if (!ARCHETYPES.some((a) => a.id === aid)) return undefined;
  if (!exampleCache.has(aid)) {
    let ex: DirectionExample | null = null;
    try {
      const { subject, shows, width, root } = JSON.parse(fs.readFileSync(path.join(GUIDES_DIR, 'examples', `${aid}.json`), 'utf8')) as DirectionExample;
      ex = { subject, shows, width, root };
    } catch {}
    exampleCache.set(aid, ex);
  }
  return exampleCache.get(aid) ?? undefined;
}

/** 记在画布 session.json 上的已选方向。 */
export interface DirectionRecord {
  id: string;
  name: string;
  /** AI 用一句话写下的设计概念（这一稿与众不同的那一点）。 */
  concept?: string;
  /** 题材母题：从题材里取的一个具体的物、形状或数据形态，记忆点用它来画。 */
  motif?: string;
  /** 按题材指定的主色；色板按它重算。 */
  primary?: string;
  signature: string;
  /** 用户没在问卷里选定风格时，同一批卡片里的其余方向：建系统时生成为 Tweaks 面板里可切换的备选风格。 */
  alternates?: string[];
}

/** 同项目其他画布已用过的主色与方向原型，用来让新画布避开。 */
export function recentUsage(canvasIds: string[]): { colors: string[]; archetypes: string[] } {
  const colors: string[] = [];
  const archetypes: string[] = [];
  for (const id of canvasIds) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(canvasDir(id), 'design.json'), 'utf8')) as { tokens?: Record<string, string> };
      const c = doc.tokens?.['color.primary'];
      if (c && /^#[0-9a-f]{6}$/i.test(c)) colors.push(c);
    } catch {}
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(canvasDir(id), 'session.json'), 'utf8')) as { direction?: { id?: string } };
      const a = meta.direction?.id?.split(SEP)[0];
      if (a) archetypes.push(a);
    } catch {}
  }
  return { colors, archetypes };
}

export const archetypeIds = () => ARCHETYPES.map((a) => a.id);

const MODE_NAME = { light: '亮色', dark: '暗色' } as const;
type Mode = keyof typeof MODE_NAME;
/** 一个系统最多几个主题（与设计系统编辑页的校验一致）。 */
const MAX_THEMES = 12;
const THEME_ID = /^[a-z][a-z0-9-]{0,23}$/;
/** Tweaks 面板上的风格名：原型名去掉副标题。 */
const styleName = (a: Archetype) => a.name.split(' · ')[0];

export interface SystemFromDirection {
  id: string;
  name: string;
  device: 'mobile' | 'desktop';
  brief?: string;
  primary?: string;
  concept?: string;
  motif?: string;
  /**
   * 生成哪几种明暗。缺省只生成方向本身的明暗（不默认带一套相反的主题）；
   * 用户要深色而方向是浅色（或反过来）时传那一种，由方向推导；两种都要时传两种，方向本身的明暗排在前面。
   */
  modes?: Mode[];
  /**
   * 另外几套配色（用户在问卷里多选了主色）：每套按同一方向、以它的主色重算色板，生成 <id>-<明暗> 主题，
   * 在 Tweaks 面板里按“配色”切换。主色与主配色相同的会被忽略。
   */
  schemes?: Array<{ id: string; name: string; primary: string }>;
  /** 主配色的显示名，缺省“默认”。 */
  schemeName?: string;
  /**
   * 备选风格（用户没在问卷里选定风格时，同一批卡片里的其余方向）：每张按同样的明暗与配色生成 v<n>-… 主题，
   * 除颜色外还覆盖字体、圆角与阴影令牌，在 Tweaks 面板里按“风格”切换。原型与主方向相同的会被忽略。
   * primary：用户指定过主色时传入，备选风格也按它重算色板；缺省用各自卡片的色板。
   */
  styles?: { cards: string[]; primary?: string };
}

/** 去掉一个主题及它的颜色值。 */
function dropTheme(ds: DesignSystem, id: string) {
  ds.color.themes = ds.color.themes.filter((t) => t.id !== id);
  for (const t of ds.color.tokens) delete t.value[id];
}

/** 把另一个系统的主题并进来：颜色按名字对齐，主题 id 与显示名由 map 决定。 */
function mergeThemes(ds: DesignSystem, sub: DesignSystem, map: (th: DesignSystem['color']['themes'][number]) => DesignSystem['color']['themes'][number] | undefined) {
  const subFirst = sub.color.themes[0]?.id;
  for (const th of sub.color.themes) {
    const next = map(th);
    if (!next || !THEME_ID.test(next.id) || ds.color.themes.length >= MAX_THEMES || ds.color.themes.some((x) => x.id === next.id)) continue;
    for (const t of sub.color.tokens) {
      const mine = ds.color.tokens.find((x) => x.name === t.name);
      const v = t.value[th.id] ?? (subFirst ? t.value[subFirst] : undefined);
      if (mine && v) mine.value[next.id] = v;
    }
    ds.color.themes.push(next);
  }
}

/**
 * 由方向卡片生成一个“小而完整”的设计系统：颜色（带用途，按需的明暗、配色与风格主题）、按原型密度的字阶、
 * 组合文字样式、间距、圆角、阴影，以及品牌说明（概念、母题、记忆点、形状、版式、不要做的事）。
 */
export function systemFromDirection(cardId: string, o: SystemFromDirection): DesignSystem | undefined {
  const d = directionDetail(cardId, o.brief, o.primary);
  const a = ARCHETYPES.find((x) => x.id === d?.archetype);
  if (!d || !a) return undefined;
  const ds = systemFromFlat(d.tokens, {
    id: o.id,
    name: o.name,
    device: o.device,
    density: a.density,
    weights: a.weights,
    theme: { id: a.tone, name: MODE_NAME[a.tone] },
    source: { kind: 'direction', ref: cardId },
  });
  ds.type.styles = textStyles(ds.type.scale, a.weights, a.density, o.device === 'desktop' ? Math.round(a.display * 1.6) : a.display);
  // 输入框描边要能看清控件边界（3:1），分隔线 border 可以更浅
  const native = a.tone;
  const border = ds.color.tokens.find((t) => t.name === 'border')?.value[native];
  const card = ds.color.tokens.find((t) => t.name === 'card')?.value[native];
  if (border && card && HEX6.test(border) && HEX6.test(card) && !ds.color.tokens.some((t) => t.name === 'input'))
    ds.color.tokens.push({ name: 'input', value: { [native]: ensureContrast(border, card, 3) }, usage: '输入框描边（控件边界，要求 3:1）' });
  ds.brand = {
    ...(o.concept ? { concept: o.concept } : {}),
    ...(o.motif ? { motif: o.motif } : {}),
    signature: d.signature,
    mood: `${a.name}：${a.mood}`,
    typography: a.type,
    shape: a.shape,
    layout: a.layout,
    avoid: a.avoid,
    ...(d.fonts.notes ? { notes: `字体：${d.fonts.notes}` } : {}),
  };
  fixContrast(ds);
  const modes = [...new Set<Mode>(o.modes?.length ? o.modes : [native])].sort((x, y) => Number(y === native) - Number(x === native));
  for (const m of modes)
    if (m !== native) {
      deriveTheme(ds, native, { id: m, name: MODE_NAME[m] }, m);
      fixContrast(ds);
    }
  if (!modes.includes(native)) dropTheme(ds, native);
  const primaryOf = (x: DesignSystem, th: string) => x.color.tokens.find((t) => t.name === 'primary')?.value[th];
  for (const th of ds.color.themes) {
    th.mode = th.id === 'dark' ? 'dark' : 'light';
    const sw = primaryOf(ds, th.id);
    if (sw && HEX6.test(sw)) th.swatch = sw.toUpperCase();
  }
  // 备选风格：原型各不相同，且与主方向不同
  const seen = new Set([a.id]);
  const alts = (o.styles?.cards ?? []).filter((id) => {
    const x = archetypeOfCard(id);
    if (!x || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  });
  // 风格 × 配色 × 明暗不超过 MAX_THEMES：风格多时少留几套配色
  const room = Math.max(0, Math.floor(MAX_THEMES / ((1 + alts.length) * modes.length)) - 1);
  const mainPrimary = (primaryOf(ds, ds.color.themes[0].id) ?? '').toUpperCase();
  const extra = (o.schemes ?? [])
    .filter((s, i, all) => HEX6.test(s.primary) && s.primary.toUpperCase() !== mainPrimary && /^[a-z][a-z0-9]{0,15}$/.test(s.id) && s.id !== 'light' && s.id !== 'dark' && all.findIndex((x) => x.id === s.id) === i)
    .slice(0, Math.min(4, room));
  if (extra.length) {
    const mainName = o.schemeName ?? '默认';
    for (const th of ds.color.themes) {
      th.scheme = mainName;
      th.name = `${mainName} · ${th.name}`;
    }
    for (const s of extra) {
      const sub = systemFromDirection(cardId, { ...o, primary: s.primary, schemes: undefined, schemeName: undefined, styles: undefined });
      if (sub) mergeThemes(ds, sub, (th) => ({ ...th, id: `${s.id}-${th.id}`, name: `${s.name} · ${th.name}`, scheme: s.name }));
    }
  }
  if (alts.length) {
    const main = styleName(a);
    for (const th of ds.color.themes) {
      th.style = main;
      th.name = `${main} · ${th.name}`;
    }
    const base = ds.type.families;
    alts.forEach((card, i) => {
      // 用户指定过主色时备选风格也用这几套配色；否则用各自卡片的色板
      const sub = systemFromDirection(card, { ...o, primary: o.styles?.primary, concept: undefined, motif: undefined, schemes: o.styles?.primary ? extra : undefined, styles: undefined });
      const sa = archetypeOfCard(card);
      if (!sub || !sa) return;
      // 风格换的是颜色、字体、圆角与阴影；字阶、间距与文字样式沿用主方向，避免已排好的版面走样
      const flat = flattenSystem(sub);
      const tokens = Object.fromEntries(Object.entries(flat).filter(([k]) => THEME_TOKEN.test(k) && (!k.startsWith('font.') || k.slice(5) in base)));
      const name = styleName(sa);
      mergeThemes(ds, sub, (th) => ({ ...th, id: `v${i + 2}-${th.id}`, name: `${name} · ${th.name}`, style: name, tokens }));
    });
    fixContrast(ds);
  }
  return ds;
}

export const archetypeOfCard = (cardId: string) => ARCHETYPES.find((a) => a.id === cardId.split(SEP)[0]);
