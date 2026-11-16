// 按页面类型下发的规范片段：design_plan 声明页面后，按页面名与区块名匹配
// guides/pages/<type>.md（该类页面的构图方案与常见平庸写法），随返回值直接给出，AI 无需另行读文件。
import fs from 'node:fs';
import path from 'node:path';
import { GUIDES_DIR } from './presets.js';

export const PAGES_DIR = path.join(GUIDES_DIR, 'pages');

interface PageType {
  type: string;
  re: RegExp;
}

/** 顺序即优先级：更具体的类型在前。 */
const TYPES: PageType[] = [
  { type: 'login', re: /登录|登陆|注册|验证码|找回密码|忘记密码|重置密码|log ?in|sign ?(in|up)|register|\bauth(?!or)|password/i },
  { type: 'onboarding', re: /引导|欢迎|启动页|闪屏|空状态|结果页|成功页|失败页|支付成功|onboarding|welcome|splash|empty|success|result page/i },
  { type: 'dashboard', re: /看板|仪表盘|大屏|概览|总览|数据统计|工作台|报表|监控|dashboard|overview|analytics|metrics|console/i },
  { type: 'landing', re: /落地页|着陆页|官网|宣传页|产品介绍|定价|landing|hero|pricing|marketing/i },
  { type: 'form', re: /表单|填写|创建|新建|新增|编辑|发布|提交|结算|下单|支付|申请|预约|form|create|edit|checkout|payment|apply|booking/i },
  { type: 'profile', re: /我的|个人中心|个人主页|个人资料|账户|账号|设置|profile|account|settings|preferences/i },
  { type: 'detail', re: /详情|详细|文章页|商品页|detail|article|product page/i },
  { type: 'list', re: /列表|搜索|结果|订单|消息|通知|收藏|历史|记录|分类|list|search|orders|messages|inbox|history|feed/i },
  { type: 'home', re: /首页|主页|发现|推荐|home|discover|explore/i },
];

export interface PlannedPage {
  name: string;
  sections?: string[];
}

/** 页面类型：先看页面名，名字看不出来再看区块名。 */
export function pageTypeOf(page: PlannedPage): string | undefined {
  const byName = TYPES.find((t) => t.re.test(page.name));
  if (byName) return byName.type;
  const sections = (page.sections ?? []).join(' ');
  return sections ? TYPES.find((t) => t.re.test(sections))?.type : undefined;
}

const cache = new Map<string, string | undefined>();
export function pageGuideText(type: string): string | undefined {
  if (!cache.has(type)) {
    let text: string | undefined;
    try {
      text = fs.readFileSync(path.join(PAGES_DIR, `${type}.md`), 'utf8').trim();
    } catch {}
    cache.set(type, text);
  }
  return cache.get(type);
}

export interface PageGuide {
  type: string;
  pages: string[];
  guide: string;
}

/** 本轮规划的页面对应的规范片段，同一类型只给一次。 */
export function pageGuides(pages: PlannedPage[], limit = 4): PageGuide[] {
  const out: PageGuide[] = [];
  for (const p of pages) {
    const type = pageTypeOf(p);
    if (!type) continue;
    const hit = out.find((g) => g.type === type);
    if (hit) {
      hit.pages.push(p.name);
      continue;
    }
    const guide = pageGuideText(type);
    if (guide && out.length < limit) out.push({ type, pages: [p.name], guide });
  }
  return out;
}

export const pageTypes = () => TYPES.map((t) => t.type);
