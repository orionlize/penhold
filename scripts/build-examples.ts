// 生成各设计方向的示例稿（guides/examples/<原型 id>.json）：一张 390 宽的移动端首屏，
// 只用令牌引用，示范这个方向的形状、层次、字重与记忆点的画法。design_direction 选定方向时随结果下发。
// 用法：tsx scripts/build-examples.ts
import fs from 'node:fs';
import path from 'node:path';

type N = Record<string, any>;
const SIZE = { xs: 'caption', sm: 'heading8', md: 'strong', lg: 'heading5', xl: 'heading4', '2xl': 'heading3', '3xl': 'heading2' } as const;
type Sz = keyof typeof SIZE | number;

/** 文本节点：size 为 size.* 档位名，或展示级字号（数字，一页一处）。 */
const t = (text: string, size: Sz, style: N = {}, rest: N = {}): N => ({
  type: 'text',
  text,
  ...rest,
  style: { textStyle: typeof size === 'number' ? 'heading1' : SIZE[size], fontSize: typeof size === 'number' ? size : `{size.${size}}`, ...style },
});
const box = (type: string, fields: N, children: N[] = []): N => ({ type, ...fields, ...(children.length ? { children } : {}) });
const row = (type: string, fields: N, children: N[]): N => box(type, { ...fields, layout: { direction: 'row', align: 'center', ...fields.layout } }, children);
const C = (k: string) => `{color.${k}}`;
const S = (n: number) => `{space.${n}}`;
const R = (k: string) => `{radius.${k}}`;
const H = '{font.heading}';

interface Example {
  subject: string;
  /** 这张示例示范了什么。 */
  shows: string;
  root: N;
}

const examples: Record<string, Example> = {
  'swiss-precise': {
    subject: '电费账单',
    shows: '一个超大数字贴左栅格线；发丝线分组，没有卡片；只有 700 与 400 两档字重',
    root: box('page', { box: { padding: [S(7), S(5), S(6), S(5)] }, layout: { gap: S(6) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('hero', { layout: { gap: S(2) } }, [
        t('11 月用电', 'sm', { color: C('muted-fg') }),
        row('figure', { layout: { align: 'baseline', gap: S(2) } }, [t('286', 96, { fontFamily: H, fontWeight: 700, lineHeight: 1, letterSpacing: -3 }), t('度', 'lg', { color: C('muted-fg') })]),
        t('比上月少 41 度，电费 152.30 元', 'md'),
      ]),
      box('rule', { box: { height: 4, width: 56 }, style: { background: C('primary') } }),
      box('breakdown', {}, [
        ...[['峰时', '08:00–22:00', '198 度'], ['谷时', '22:00–次日 08:00', '88 度'], ['阶梯', '第一档，余量 114 度', '0.52 元/度']].map(([a, b, c]) =>
          row('line', { layout: { justify: 'between' }, box: { padding: [S(4), 0], border: { width: 1, color: C('border'), sides: ['top'] } } }, [
            box('label', { layout: { gap: S(1) } }, [t(a, 'md'), t(b, 'xs', { color: C('muted-fg') })]),
            t(c, 'md', { fontWeight: 700 }),
          ]),
        ),
      ]),
      box('pay-button', { props: { buttonType: 'submit' }, layout: { align: 'center', justify: 'center' }, box: { height: 48, radius: R('md') }, style: { background: C('primary') } }, [
        t('缴纳 152.30 元', 'md', { color: C('on-primary'), fontWeight: 700 }),
      ]),
    ]),
  },

  'soft-rounded': {
    subject: '睡眠记录',
    shows: '上半部是一整块浅色调的大圆角色块，下半部才是操作；不用描边，全页只有主按钮是高饱和',
    root: box('page', { box: { padding: [S(4), S(4), S(6), S(4)] }, layout: { gap: S(5) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('hero', { box: { padding: [S(7), S(5), S(6), S(5)], radius: R('lg') }, layout: { gap: S(3) }, style: { background: C('muted') } }, [
        t('昨晚', 'sm', { color: C('muted-fg') }),
        t('睡了 7 小时 20 分', '3xl', { fontFamily: H, fontWeight: 600, lineHeight: 1.25 }),
        t('比平时早睡 35 分钟，深睡接近两小时。', 'md', { color: C('muted-fg'), lineHeight: 1.6 }),
      ]),
      box('stages', { layout: { gap: S(4) }, box: { padding: [0, S(2)] } }, [
        ...[['入睡', '23:10'], ['深睡', '1 小时 52 分'], ['醒来', '06:30']].map(([a, b]) => row('stage', { layout: { justify: 'between' } }, [t(a, 'md', { color: C('muted-fg') }), t(b, 'md')])),
      ]),
      box('start-button', { props: { buttonType: 'button' }, layout: { align: 'center', justify: 'center' }, box: { height: 56, radius: R('full') }, style: { background: C('primary'), shadow: '{shadow.md}' } }, [
        t('开始今晚的记录', 'md', { color: C('on-primary'), fontWeight: 600 }),
      ]),
      t('睡前半小时放下手机，更容易入睡', 'sm', { color: C('muted-fg'), textAlign: 'center' }),
    ]),
  },

  'bold-block': {
    subject: '健身团课预约',
    shows: '主色铺满上部，标题反白压在色块上；内容卡片向上叠入色块；交界处硬切，不用渐变',
    root: box('page', { style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      // 色块与页面背景硬切（同一位置两个色标），卡片跨在交界线上
      box('top', { box: { padding: [S(7), S(4), 0, S(4)] }, layout: { gap: S(6) }, style: { background: 'linear-gradient(180deg, {color.primary} 0%, {color.primary} 72%, {color.bg} 72%, {color.bg} 100%)' } }, [
       box('hero', { box: { padding: [0, S(2)] }, layout: { gap: S(3) } }, [
        t('周四 19:30', 'md', { color: C('on-primary') }),
        t('燃脂搏击\n45 分钟', 44, { fontFamily: H, fontWeight: 900, lineHeight: 1.1, color: C('on-primary') }),
       ]),
       box('card', { box: { padding: S(5), radius: R('lg') }, layout: { gap: S(5) }, style: { background: C('card'), color: C('card-fg'), shadow: '{shadow.md}' } }, [
        row('coach', { layout: { gap: S(3) } }, [
          box('avatar', { box: { width: 48, height: 48, radius: R('full') }, style: { background: C('accent') } }),
          box('who', { layout: { gap: S(1), grow: 1 } }, [t('阿杰教练', 'lg', { fontWeight: 900 }), t('2 号馆，还剩 6 个位置', 'sm', { color: C('muted-fg') })]),
        ]),
        box('book-button', { props: { buttonType: 'submit' }, layout: { align: 'center', justify: 'center' }, box: { height: 52, radius: R('md') }, style: { background: C('accent') } }, [
          t('预约这节课', 'md', { color: C('on-accent'), fontWeight: 900 }),
        ]),
       ]),
      ]),
      box('notes', { box: { padding: [S(5), S(5), S(6), S(5)] }, layout: { gap: S(3) } }, [
        t('上课前', 'sm', { color: C('muted-fg') }),
        t('提前 10 分钟到场热身，自带毛巾和水。开课前 2 小时可以免费取消。', 'md', { lineHeight: 1.6 }),
      ]),
    ]),
  },

  'dark-immersive': {
    subject: '专注计时',
    shows: '层次靠背景明度递进；唯一发亮的是关键数字和它下面的主色细线；其余文字降为次要明度',
    root: box('page', { box: { padding: [S(7), S(5), S(6), S(5)] }, layout: { gap: S(6) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('timer', { layout: { gap: S(4) } }, [
        t('写周报', 'md', { color: C('muted-fg') }),
        t('24:18', 88, { fontFamily: '{font.mono}', fontWeight: 600, lineHeight: 1, letterSpacing: -2 }),
        box('track', { box: { height: 4, radius: R('full') }, style: { background: C('border') } }, [box('progress', { box: { height: 4, width: '62%', radius: R('full') }, style: { background: C('primary'), shadow: '0 0 16px {color.primary}' } })]),
        t('这一轮还剩 15 分 42 秒', 'sm', { color: C('muted-fg') }),
      ]),
      box('panel', { box: { padding: S(4), radius: R('lg') }, layout: { gap: S(4) }, style: { background: C('card'), color: C('card-fg'), shadow: '{shadow.sm}' } }, [
        ...[['今天已专注', '2 小时 05 分'], ['完成轮次', '4 轮'], ['被打断', '1 次']].map(([a, b]) => row('stat', { layout: { justify: 'between' } }, [t(a, 'sm', { color: C('muted-fg') }), t(b, 'sm')])),
      ]),
      box('pause-button', { props: { buttonType: 'button' }, layout: { align: 'center', justify: 'center' }, box: { height: 52, radius: R('md') }, style: { background: C('primary') } }, [
        t('暂停', 'md', { color: C('on-primary'), fontWeight: 600 }),
      ]),
    ]),
  },

  editorial: {
    subject: '长文阅读首页',
    shows: '衬线大标题跨三行、行高收紧，一个词用强调色；没有容器，层次全靠字号与衬线 / 无衬线的对比',
    root: box('page', { box: { padding: [S(8), S(5), S(6), S(5)] }, layout: { gap: S(6) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('lead', { layout: { gap: S(4) } }, [
        t('第 48 期', 'sm', { color: C('muted-fg') }),
        box('headline', { layout: { display: 'block' }, style: { fontFamily: H, fontSize: 44, fontWeight: 900, lineHeight: 1.15 } }, [
          t('一座小城', 44, { textStyle: 'heading1' }, { layout: { display: 'block' } }),
          t('怎样留住', 44, { textStyle: 'heading1', color: C('accent'), fontStyle: 'italic' }, { layout: { display: 'block' } }),
          t('它的书店', 44, { textStyle: 'heading1' }, { layout: { display: 'block' } }),
        ]),
        t('十年里关了九家，剩下的一家把二楼改成了自习室。', 'lg', { lineHeight: 1.6, color: C('muted-fg') }, { box: { maxWidth: 280 } }),
      ]),
      row('byline', { layout: { justify: 'between' }, box: { padding: [S(4), 0], border: { width: 1, color: C('fg'), sides: ['top'] } } }, [t('周予安', 'sm'), t('阅读约 12 分钟', 'sm', { color: C('muted-fg') })]),
      box('more', { layout: { gap: S(5) } }, [
        ...[['02', '菜市场里的修表匠'], ['03', '最后一班渡轮']].map(([n, title]) =>
          row('entry', { layout: { gap: S(4), align: 'baseline' } }, [t(n, '2xl', { fontFamily: H, color: C('accent') }), t(title, 'lg', { fontFamily: H })]),
        ),
      ]),
    ]),
  },

  'neo-brutal': {
    subject: '市集摊位报名',
    shows: '粗描边 + 不带模糊的硬偏移阴影；标题里一个词放在轻微旋转的贴纸色块上；全页只用两种填充色',
    root: box('page', { box: { padding: [S(7), S(5), S(6), S(5)] }, layout: { gap: S(6) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('title', { box: { padding: [0, S(1), S(2), S(1)] }, layout: { gap: S(2), align: 'start' } }, [
        t('周末市集', 40, { fontFamily: H, fontWeight: 900, lineHeight: 1.1 }),
        box('sticker', { box: { padding: [S(1), S(3)], border: { width: 2, color: C('fg') } }, style: { background: C('accent'), transform: 'rotate(-2deg)' } }, [
          t('还剩 8 个摊位', '2xl', { fontFamily: H, fontWeight: 900, color: C('on-accent') }),
        ]),
      ]),
      t('12 月 6 日至 7 日，旧厂房中庭。摊位 2 米宽，自带桌布和灯。', 'md', { fontWeight: 500, lineHeight: 1.6 }),
      box('field', { layout: { gap: S(2) } }, [
        t('你卖什么', 'sm', { fontWeight: 700 }),
        box('input', { render: 'input', props: { placeholder: '例如：手冲咖啡、旧书、陶器' }, box: { height: 52, padding: [0, S(4)], border: { width: 2, color: C('fg') }, radius: R('md') }, style: { background: C('card'), fontSize: '{size.md}', shadow: '{shadow.sm}' } }),
      ]),
      box('apply-button', { props: { buttonType: 'submit' }, layout: { align: 'center', justify: 'center' }, box: { height: 56, border: { width: 2, color: C('fg') }, radius: R('md') }, style: { background: C('primary'), shadow: '{shadow.md}' }, states: { active: { shadow: 'none', transform: 'translate(6px, 6px)' } } }, [
        t('报名摆摊', 'lg', { color: C('on-primary'), fontWeight: 900 }),
      ]),
    ]),
  },

  'glass-aurora': {
    subject: '会议纪要助手',
    shows: '背景色团只出现一次，从画板边缘探出；一张毛玻璃卡片承载全部操作；主按钮是唯一的渐变',
    root: box('page', { box: { padding: [S(8), S(5), S(6), S(5)], minHeight: 640 }, layout: { gap: S(6), overflow: 'hidden' }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('glow', { layout: { position: 'absolute', top: -120, right: -100 }, box: { width: 320, height: 320, radius: R('full') }, style: { background: 'linear-gradient(135deg, {color.primary}, {color.accent})', blur: 64, opacity: 0.55 } }),
      box('intro', { layout: { gap: S(3), zIndex: 1 } }, [
        t('刚开完的会，\n三分钟出纪要', '3xl', { fontFamily: H, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.5 }),
        t('上传录音，自动整理成结论、待办和负责人。', 'md', { color: C('muted-fg'), lineHeight: 1.6 }),
      ]),
      box('glass-card', { layout: { gap: S(5), zIndex: 1 }, box: { padding: S(5), radius: R('lg'), border: { width: 1, color: 'rgba(255,255,255,0.7)' } }, style: { background: 'rgba(255,255,255,0.6)', backdropBlur: 20, shadow: '{shadow.md}' } }, [
        row('file', { layout: { justify: 'between' } }, [box('name', { layout: { gap: S(1) } }, [t('周一产品例会', 'md', { fontWeight: 600 }), t('录音 46 分钟', 'sm', { color: C('muted-fg') })]), t('已上传', 'sm', { color: C('primary') })]),
        box('generate-button', { props: { buttonType: 'submit' }, layout: { align: 'center', justify: 'center' }, box: { height: 52, radius: R('md') }, style: { background: 'linear-gradient(90deg, {color.primary}, {color.accent})' } }, [
          t('生成纪要', 'md', { color: C('on-primary'), fontWeight: 600 }),
        ]),
      ]),
    ]),
  },

  'organic-natural': {
    subject: '茶铺单品',
    shows: '主视觉是一个四角圆角各不相同的大色块；按钮与标签重复同一种不对称圆角；阴影很轻',
    root: box('page', { box: { padding: [S(5), S(5), S(6), S(5)] }, layout: { gap: S(5) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('leaf', { box: { height: 280, padding: S(5), radius: [96, 20, 96, 20] }, layout: { justify: 'end', gap: S(2) }, style: { background: C('primary') } }, [
        t('明前', 'md', { color: C('on-primary') }),
        t('狮峰龙井', 40, { fontFamily: H, fontWeight: 600, lineHeight: 1.15, color: C('on-primary') }),
      ]),
      t('三月底采的一芽一叶，豆香里带一点兰花味。80 度水，泡两分钟。', 'md', { lineHeight: 1.7 }),
      row('specs', { layout: { gap: S(2) } }, [
        ...['50 克', '杭州西湖', '2025 年春'].map((x) => box('spec', { box: { padding: [S(1), S(3)], radius: [12, 4, 12, 4] }, style: { background: C('muted') } }, [t(x, 'sm', { color: C('muted-fg') })])),
      ]),
      row('buy', { layout: { justify: 'between' } }, [
        row('price', { layout: { align: 'baseline', gap: S(1) } }, [t('268', '2xl', { fontFamily: H, fontWeight: 600 }), t('元', 'sm', { color: C('muted-fg') })]),
        box('cart-button', { props: { buttonType: 'submit' }, layout: { align: 'center', justify: 'center' }, box: { height: 48, padding: [0, S(6)], radius: [24, 8, 24, 8] }, style: { background: C('accent') } }, [
          t('加入茶篮', 'md', { color: C('on-accent'), fontWeight: 600 }),
        ]),
      ]),
    ]),
  },

  'mono-accent': {
    subject: '摄影师约拍',
    shows: '黑白两块上下对切，标题反白压在深色块上；整页只有主行动一个元素带颜色',
    root: box('page', { style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('dark', { box: { padding: [S(8), S(5), S(6), S(5)] }, layout: { gap: S(4) }, style: { background: C('fg') } }, [
        t('人像与婚礼', 'sm', { color: C('bg'), opacity: 0.7, letterSpacing: 2 }),
        t('林深\n摄影', 64, { fontFamily: H, fontWeight: 900, lineHeight: 1.05, letterSpacing: -2, color: C('bg') }),
      ]),
      box('light', { box: { padding: [S(6), S(5)] }, layout: { gap: S(5) } }, [
        t('只拍自然光，每月只接 6 组。\n12 月还剩 2 个档期。', 'lg', { lineHeight: 1.6 }),
        box('facts', {}, [
          ...[['半日拍摄', '3,800 元'], ['交付', '精修 40 张，30 天内']].map(([a, b]) =>
            row('fact', { layout: { justify: 'between' }, box: { padding: [S(3), 0], border: { width: 1, color: C('border'), sides: ['top'] } } }, [t(a, 'sm', { color: C('muted-fg') }), t(b, 'sm')]),
          ),
        ]),
        box('book-button', { props: { buttonType: 'submit' }, layout: { align: 'center', justify: 'center' }, box: { height: 52, radius: R('sm') }, style: { background: C('accent') } }, [
          t('预约 12 月档期', 'md', { color: C('on-accent'), fontWeight: 700 }),
        ]),
      ]),
    ]),
  },

  'playful-clay': {
    subject: '儿童识字',
    shows: '控件有厚度：底部同色加深的实心投影，按下下沉；进度用粗圆角进度条和大数字，是首屏主角',
    root: box('page', { box: { padding: [S(6), S(5), S(6), S(5)] }, layout: { gap: S(5) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('progress-card', { box: { padding: S(5), radius: R('lg') }, layout: { gap: S(4) }, style: { background: C('primary'), shadow: '0 6px 0 rgba(0,0,0,0.18)' } }, [
        t('今天认识了', 'md', { color: C('on-primary'), fontWeight: 500 }),
        row('count', { layout: { align: 'baseline', gap: S(2) } }, [t('12', 80, { fontFamily: H, fontWeight: 800, lineHeight: 1, color: C('on-primary') }), t('个字', 'xl', { fontWeight: 500, color: C('on-primary') })]),
        box('bar', { box: { height: 20, radius: R('full') }, style: { background: 'rgba(255,255,255,0.35)' } }, [box('bar-fill', { box: { height: 20, width: '60%', radius: R('full') }, style: { background: C('accent') } })]),
        t('再认 8 个就能拿到小星星', 'md', { color: C('on-primary'), fontWeight: 500 }),
      ]),
      row('word', { layout: { gap: S(4) }, box: { padding: S(5), radius: R('lg') }, style: { background: C('card'), color: C('card-fg') } }, [
        t('山', 64, { textStyle: 'heading2', fontFamily: H, fontWeight: 800, lineHeight: 1, color: C('primary') }),
        box('hint', { layout: { gap: S(1), grow: 1 } }, [t('shān', 'lg', { fontWeight: 500 }), t('三个尖尖的山峰', 'md', { color: C('muted-fg'), fontWeight: 500 })]),
      ]),
      box('next-button', { props: { buttonType: 'button' }, layout: { align: 'center', justify: 'center' }, box: { height: 60, radius: R('lg') }, style: { background: C('accent'), shadow: '0 6px 0 rgba(0,0,0,0.2)' }, states: { active: { shadow: 'none', transform: 'translate(0, 6px)' } } }, [
        t('下一个字', 'xl', { fontFamily: H, color: C('on-accent'), fontWeight: 800 }),
      ]),
    ]),
  },

  'bauhaus-geo': {
    subject: '展览门票',
    shows: '一个大圆与一个矩形色块构成首屏，文字对齐到几何形的边缘；按钮全圆、卡片直角，颜色平涂',
    root: box('page', { style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      box('composition', { box: { height: 320 }, layout: { overflow: 'hidden' } }, [
        box('block', { layout: { position: 'absolute', left: 0, bottom: 0 }, box: { width: 160, height: 200 }, style: { background: C('primary') } }),
        box('circle', { layout: { position: 'absolute', right: -40, top: 40 }, box: { width: 240, height: 240, radius: R('full') }, style: { background: C('accent') } }),
      ]),
      box('info', { box: { padding: [S(5), S(5), S(6), S(5)] }, layout: { gap: S(5) } }, [
        t('形与色\n一百年', 44, { fontFamily: H, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1 }),
        t('包豪斯教学手稿与家具，共 214 件。展至 2 月 28 日，周一闭馆。', 'md', { lineHeight: 1.6 }),
        row('buy', { layout: { justify: 'between' } }, [
          box('price', { layout: { gap: S(1) } }, [t('成人票', 'sm', { color: C('muted-fg') }), t('80 元', 'xl', { fontFamily: H, fontWeight: 800 })]),
          box('buy-button', { props: { buttonType: 'submit' }, layout: { align: 'center', justify: 'center' }, box: { height: 52, padding: [0, S(6)], radius: R('full') }, style: { background: C('fg') } }, [
            t('选日期购票', 'md', { color: C('bg'), fontWeight: 800 }),
          ]),
        ]),
      ]),
    ]),
  },

  'data-dense': {
    subject: '库存预警',
    shows: '一个关键指标用大数字置顶，其余是紧凑的表格行；彩色只来自状态点和一个主行动；不做等大统计卡片',
    root: box('page', { box: { padding: [S(5), S(4), S(5), S(4)] }, layout: { gap: S(4) }, style: { background: C('bg'), color: C('fg'), fontFamily: '{font.body}' } }, [
      row('head', { layout: { justify: 'between', align: 'end' } }, [
        box('kpi', { layout: { gap: S(1) } }, [
          t('低于安全库存', 'xs', { color: C('muted-fg') }),
          row('figure', { layout: { align: 'baseline', gap: S(1) } }, [t('17', 56, { fontFamily: '{font.mono}', fontWeight: 700, lineHeight: 1 }), t('个 SKU，共 342 个在售', 'xs', { color: C('muted-fg') })]),
        ]),
        box('restock-button', { props: { buttonType: 'button' }, layout: { align: 'center', justify: 'center' }, box: { height: 36, padding: [0, S(4)], radius: R('md') }, style: { background: C('primary') } }, [
          t('生成补货单', 'sm', { color: C('on-primary'), fontWeight: 500 }),
        ]),
      ]),
      box('table', { box: { border: { width: 1, color: C('border'), sides: ['top'] } } }, [
        row('thead', { box: { height: 32, border: { width: 1, color: C('border'), sides: ['bottom'] } } }, [
          t('商品', 'xs', { color: C('muted-fg'), fontWeight: 500 }, { layout: { grow: 1 } }),
          t('现有', 'xs', { color: C('muted-fg'), fontWeight: 500, textAlign: 'right' }, { box: { width: 56 } }),
          t('可售天数', 'xs', { color: C('muted-fg'), fontWeight: 500, textAlign: 'right' }, { box: { width: 72 } }),
        ]),
        ...[['danger', '挂耳咖啡 10 包装', '36', '1.5'], ['danger', '燕麦奶 1L', '48', '2'], ['accent', '滤纸 V60 100 片', '120', '5'], ['accent', '冷萃瓶 500ml', '64', '6'], ['muted-fg', '手冲壶 600ml', '22', '9']].map(([c, n, q, d]) =>
          row('tr', { box: { height: 40, border: { width: 1, color: C('border'), sides: ['bottom'] } } }, [
            row('name', { layout: { gap: S(2), grow: 1 } }, [box('dot', { box: { width: 6, height: 6, radius: R('full') }, style: { background: C(c) } }), t(n, 'xs')]),
            t(q, 'xs', { fontFamily: '{font.mono}', textAlign: 'right' }, { box: { width: 56 } }),
            t(d, 'xs', { fontFamily: '{font.mono}', textAlign: 'right' }, { box: { width: 72 } }),
          ]),
        ),
      ]),
      t('红点 3 天内断货，强调色点一周内断货。可售天数按近 14 天销量估算。', 'xs', { color: C('muted-fg'), lineHeight: 1.6 }),
    ]),
  },
};

const out = path.join(import.meta.dirname, '..', 'guides', 'examples');
fs.mkdirSync(out, { recursive: true });
for (const [id, ex] of Object.entries(examples)) fs.writeFileSync(path.join(out, `${id}.json`), `${JSON.stringify({ archetype: id, width: 390, ...ex })}\n`);
console.log(`已生成 ${Object.keys(examples).length} 个示例 → ${out}`);
