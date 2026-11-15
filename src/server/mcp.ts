// MCP 工具（PRD 第 4、6 节）：会话 8 个（含 design_ask、design_preset、design_direction、design_system、design_image、design_annotate）、绘制 9 个（含 design_plan）、读取 4 个、导出 1 个（frame_update/frame_delete 分开计，共 23 个）。
import fs from 'node:fs';
import path from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  applyOps,
  clone,
  DocError,
  findFrameOfAddr,
  framesOf,
  getIndex,
  instanceCount,
  listTypes,
  newId,
  resolveAddress,
  walkTree,
} from '../core/doc.js';
import { insertOps, prepareNodes, updateOps, type Affected, type NodePatch } from '../core/edit.js';
import { collectFonts, collectTokenRefs } from '../core/render.js';
import {
  BoxSchema,
  LayoutSchema,
  MetaSchema,
  StatesSchema,
  StyleSchema,
  validateNodeInput,
  validateTokens, validateTweaks,
  ValidationError,
  type NodeInput,
} from '../core/schema.js';
import { frameVars } from '../core/proto.js';
import { exploreFrame, isDocFrame, lintProto, stateAfter, type Exploration, type NavOut, type ProtoWarning, type Step } from '../core/states.js';
import { designCheckup, formatDesignNotes } from '../core/designLint.js';
import type { Annotation, DesignDoc, Node, Op, Origin, ProbeResult, ProtoValue, ShotReport } from '../core/types.js';
import { applyAnnotations } from './annotate.js';
import { ingestSrc } from './assets.js';
import { hitThumbnail, ImageSearchError, searchImages } from './images.js';
import { Canvas, CanvasError } from './canvas.js';
import { buildExport } from './export.js';
import { findDesignGuides } from './guides.js';
import { directionDetail, directionExample, recentUsage, suggestDirections, systemFromDirection, type DirectionCard } from './directions.js';
import {
  applyPatch,
  auditContrast,
  flattenSystem,
  importCss,
  importTokensJson,
  lintSystem,
  systemFromFlat,
  systemFromImport,
  textRecipe,
  type DesignSystem,
  type SystemPatch,
} from '../core/designSystem.js';
import { defaultSystem, exportSystem, listSystems, loadSystem, newSystemId, PROJECT_DIR_NAME, saveSystem, setDefaultSystem, summary as systemSummary } from './systems.js';
import { pageGuides } from './pageGuides.js';
import { COLOR_Q, colorSchemes, customBriefForm, defaultBriefForm, DIRECTION_Q, directionQuestion } from './brief.js';
import { catalog, DEFAULT_GUIDE, defaultGuideText, matchPresets, presetDetail, presetSource } from './presets.js';
import { VERSION } from './paths.js';
import type { Registry } from './registry.js';

export interface SessionCtx {
  id: string;
  cwd: string;
  ancestors: number[];
  envCanvas?: string;
  /** 客户端环境中的 DESIGN_MCP_GUIDES（由代理转发）。 */
  envGuides?: string;
  canvasId?: string;
  /** canvas_open 传入的需求描述，生成设计方向时使用。 */
  brief?: string;
  /** design_plan 的 enough_info：用户在对话里已说清的产品与内容（问卷只需再问视觉偏好）。 */
  known?: string;
}

// Node 字段与交互说明只随 node_insert 下发一次，其他写工具引用它，避免同一段说明在工具列表里重复多份。
const NODE_GUIDE = `Node（抽象节点，不是 HTML）字段。值可引用设计令牌 "{color.primary}"，渐变与阴影里的颜色也写令牌（如 "linear-gradient(90deg, {color.primary}, {color.accent})"、"0 0 16px {color.primary}"），不直接写色值；除 style.css 外不接受 CSS 字符串，也不接受 HTML。
- type（必填）：自由命名，如 "card" "button" "nav-item"；沿用 canvas_open 返回的已有类型名。id 可选，缺省由服务端分配。
- render：container|text|image|input，缺省按字段推断（有 text→text，有 props.src→image，否则 container）。
- component：可复用块的组件名（如 "PrimaryButton"）。首次出现的名字把这棵子树登记为组件定义；之后同名节点是实例，只写 {type, component, text?, props?, overrides?, layout?(摆放)}，给出不同子树会被拒绝。overrides 是实例级差异：{"<组件内节点id>": {text?, props?, hidden?}}。
- layout：display flex(默认)|grid|block、direction column(默认)|row、wrap、justify start|center|end|between|around|evenly、align start|center|end|stretch|baseline、gap、rowGap、columns(数字或模板)、rows、grow、shrink、basis、alignSelf、position flow|relative|absolute|fixed|sticky(+top/right/bottom/left；absolute 仅用于角标浮层)、zIndex、overflow。文本节点设置 justify/align 时也按 flex 居中。
- box：width/height（数字=px，或 "100%"、"fill"=占满父容器、"fit"、"auto"）、min/maxWidth、min/maxHeight、margin、padding（数字、[纵,横] 或 [上,右,下,左]）、border {width（数字或同 padding 的数组）, style, color, sides?}、radius（数字或四角数组）。
- style：
  · 文字：fontFamily（只写字体族名）、fontSize、fontWeight、fontStyle、lineHeight（≤4 为倍数，否则 px）、letterSpacing、textAlign、textDecoration、textTransform、whiteSpace、listStyle（none|disc|decimal，文本按行成列表）、color、textShadow。
  · textStyle（文本节点必填，只标记语义层级，不输出样式）。同时写 fontSize：已定义 size.* 令牌时一律写令牌（如 "{size.sm}"），取与该层级最接近的一档，不要照抄下面的默认字号（默认值只在没有令牌时兜底）；只有没有字号令牌时才用默认值。层级与默认字号：heading1 48 | heading2 34 | heading3 28 | heading4 22 | button 16 | heading5 18 | heading6 16 | strong 16 | heading7 14 | heading8 14 | label 14 | body 16 | link 14 | caption 12。有设计系统时按它的 text_styles 写 fontSize / lineHeight / fontWeight / fontFamily。
  · 填充与效果：background（颜色或渐变）、backgroundImage、backgroundSize、objectFit、shadow（box-shadow 值）、innerShadow（box-shadow 值，不写 inset）、opacity、blur、backdropBlur（背景模糊）、transform（CSS transform，如 translate(4px, 0) rotate(8deg) scale(1.05)）。
  · cursor：default|pointer|text；其它光标（not-allowed、grab…）写 css.cursor，二者只设一处。
  · css：自定义 CSS，仅用于没有对应字段的属性，如 {"mix-blend-mode":"multiply","aspect-ratio":"16 / 9","outline-color":"{color.primary}","transition":"all 0.2s"}。属性名用小写连字符；已有字段管理的属性（宽高、边距、边框、圆角、背景、字体、颜色、阴影、透明度、滤镜、display、flex 方向 / 对齐、gap、grid 模板、position）会被拒绝。layout 的 rowGap、shrink、basis、alignSelf、top/right/bottom/left、zIndex、overflow 也可写成对应 CSS，但同一节点只设一处。值不能含 url()、!important 或 ; { } "，令牌只能作为整个值。
- props：src（图片：http(s) URL、data URL 或本地文件路径，插入时下载入库）、alt、placeholder、href、icon、value、multiline("true")、inputType、buttonType（type 以 button/btn 结尾的节点必填：登录 / 提交 / 保存用 submit，重置表单用 reset，其余 button；按钮内不要再嵌套按钮或链接）。
- text：文本内容。states：{hover?, focus?, active?} 各为 style。meta：{hidden?}。proto：原型交互，见下。
- children：子节点数组（结构相同）。`;

const PROTO_GUIDE = `交互（proto）：让设计稿在画布“播放”里能点出页面内的真实逻辑，不只是页面跳转。
- 变量：proto.vars {"名字": 初值}，可写在任意节点上（通常是画板根，即 node_id=画板 id）；同一画板内共享，进入画板时重置为初值。
- 表达式：JS 子集，变量名直接引用；支持 ! - + * / % == != < > <= >= && || 三元 ?: 括号，字符串用单引号，函数 len(x) pad(x,n) floor(x) min(a,b) max(a,b)。
- 绑定：show:"tab == 'sms'" 为真才显示；disabled:"sec > 0" 为真时点击无效（不冒泡）；styles:[{when, style}] 条件为真时叠加样式（选中 / 激活 / 错误态）；text 中写 {{表达式}} 插值；bind:"phone" 把输入框（render:"input"）的内容实时写入变量。
- 动作：onClick（点击）与 onLoad（进入画板）各是一个按顺序执行的数组：
  · {do:"set", var, value} 设为字面量；{do:"set", var, expr} 设为表达式结果；{do:"toggle", var} 布尔取反。
  · {do:"countdown", var, from:60, interval?:1000, then?:[…]}：var 设为 from 后每 interval 毫秒减 1，到 0 停止并执行 then；{do:"stop", var} 中止。
  · {do:"delay", ms, then:[…]} 延时执行；{do:"if", when, then?:[…], else?:[…]} 条件分支。
  · {do:"navigate", frame:"<画板id>"}；{do:"back"}；{do:"open", url}。简单跳转也可写 props.href："#<画板id>" / "#back" / http(s) 链接。
- 页面内的状态切换（tab、开关、展开、倒计时、弹窗、校验提示）用变量 + show/styles 在一个画板内实现，不要为每个状态复制一个画板；所有状态的元素都要画出来，画布与截图显示初始状态。跨页面才用 navigate。
- 组件内节点的 proto 属于组件定义，所有实例共享；实例根上的 proto（如每个 tab 实例各自的 onClick 与 styles）可逐实例不同。
示例（画板根 proto.vars {"tab":"pwd","phone":"","sec":0}）：
  tab 项 {type:"tab", text:"密码登录", proto:{onClick:[{do:"set",var:"tab",value:"pwd"}], styles:[{when:"tab=='pwd'", style:{color:"{color.primary}", fontWeight:600}}]}}
  面板 {type:"panel", proto:{show:"tab=='pwd'"}, children:[…]}
  手机号 {type:"input", render:"input", props:{placeholder:"手机号", inputType:"tel"}, proto:{bind:"phone"}}
  验证码按钮 {type:"button", props:{buttonType:"button"}, text:"{{sec > 0 ? sec + 's 后重新获取' : '获取验证码'}}", proto:{disabled:"sec > 0 || len(phone) != 11", styles:[{when:"sec > 0 || len(phone) != 11", style:{opacity:0.5, cursor:"default"}}], onClick:[{do:"countdown", var:"sec", from:60}]}}`;

const INSTRUCTIONS = `penhold-mcp 是本地设计画布。用户只能在画布上改盒模型与样式；位置、顺序、层级、布局只能由你修改。

流程：
1. canvas_open（上下文里已有 canvas_id 时务必传入）。
2. 问清需求与偏好：返回 needs_brief:true 时，在选设计方向、建设计系统、设令牌或绘制之前必须先问用户（服务端会拒绝这些调用）：design_ask() 在画布上出问卷。answered → 按回答设计；waiting → 请用户去画布填写并再次 design_ask()，期间不要绘制；skipped → 由你决定。用户已在对话里说清产品与页面内容时，在 design_plan 里用 enough_info 复述，问卷随后只问视觉偏好；只有用户亲口说过视觉偏好（风格、颜色、明暗或参考产品）时，才同时传 user_style 原样转述，跳过问卷。续改同一画布不必再问。
3. design_plan：需求明确后立即声明本轮全部页面（单页也一样），早于阅读规范和 tokens_set，画布随即显示骨架屏。之后用返回的 frame_id 逐页绘制，不要再 frame_create 这些页面；计划有变时再调用一次。
4. 定设计依据：项目有设计系统（canvas_open / design_plan 返回 design_system）时，它就是依据：先读它的 README，令牌、文字样式（text_styles）、组件与视觉基础照它执行，不再选方向卡片；首次写入时自动安装。否则用读文件工具完整阅读 canvas_open 返回的 design_guides（及其引用的同目录文件），令牌、组件与版式以它为准；与用户要求冲突时以用户为准。只有内置规范（kind:"builtin"）时，还要从 design_plan 返回的 design_directions 里选一张方向卡片（没有明显更合适的就选与常规解不同的那张），调用 design_direction({pick, concept, motif})（motif 是从题材里取的具体的物或形状；色板不贴题材时再传 primary 重算），再 design_system({action:"create", name}) 把它存成项目的设计系统（亮 / 暗主题、字阶、文字样式、间距、品牌手册）并安装，不要退回你惯用的默认配色与版式。项目里已有样式代码（CSS 变量、shadcn / Tailwind 主题）时改用 design_system({action:"import", path}) 从代码导入，精确取值。需要照片而用户没给素材时用 design_image 找图，每个图位用不同的图片。画布已记录 design_direction / design_preset 时沿用，不另起一套。design_plan 返回的 page_guides 列出该类页面的构图方案与平庸写法：选一个方案（不要默认第一个），避开平庸写法。
5. 绘制：有设计系统时直接用它的令牌，文字按 text_styles 写 style，组件直接实例化；缺的令牌用 design_system({action:"update"}) 加进系统，而不是只在画布里 tokens_set（没有系统时才用 tokens_set 定义令牌）；画好的按钮、输入框、列表项等用 design_system({action:"save_components"}) 存进系统；node_update(node_id=frame_id) 设置画板根的背景与 padding，node_insert 一次插入整块区域，可复用块填 component。写工具可带 note（如“登录表单”），显示在画布的 AI 光标旁。
   - 只画界面内容：不画状态栏、刘海、Home 指示条、手机边框、浏览器地址栏、系统键盘，也不预留安全区（导航栏贴画板顶部，底部 tab 栏 / 按钮贴画板底部）。
   - 页面内逻辑（tab 切换、倒计时、开关、弹窗、表单校验）用 proto 做成可交互，跨页面用 navigate。
6. 自检：每轮结束前对改动过的画板调用 design_screenshot，自检完成后编辑锁才释放、用户才能手动修改。报告列出的每个问题（包括交互状态与交互逻辑问题）都要修复；报告通过也要按其中的清单逐项审查截图。用 node_update 修好后重新截图，直到截图与报告都没有问题。
7. 流程说明（本轮的一部分，没写不算完成，不要在这之前向用户汇报）：涉及多个页面、交互、分支或业务规则时，自检通过后立即补充业务流程与说明（画板被重新声明后要重写；只改单个页面的视觉时不必）。design_screenshot 与 canvas_status 会列出还缺说明的画板。两种方式可组合：
   - design_annotate 批注（不进入导出，无需自检）：画板之间用箭头表示跳转（异常 / 可选路径用 dashed），画板上方或下方用说明框写进入条件、主要操作、跳转去向、业务规则、交互状态、待确认问题。
   - 需要随导出交付时，另画一个“业务流程与说明”画板（宽 1440，在 design_plan 中一起声明，通常排最前）：主流程图（每步一个卡片，props.href "#<画板id>" 链到对应页面，分支与异常路径单独标出）、各页说明、业务规则、交互状态清单；与 UI 画板共用令牌，同样要自检。
   说明不要画进 UI 画板；页面改动后同步更新或删除过时的说明（canvas_status 的 ai_annotations 列出你写过的批注）。

续改：用户说“我选中的…”时用 canvas_status 取选区，并先看其中的用户评论；改前用 design_changes(since_rev, origin:"user") 查看用户的手动改动，避免覆盖。按评论改完并 design_screenshot 自检、逐条确认已改好后，用 design_annotate({resolve:[评论编号]}) 关闭这些评论；没改或拿不准的评论保留，并向用户说明原因。
转代码：design_outline 看结构 → design_screenshot 作视觉基准 → 按组件逐个 design_read，并按 proto 实现状态与事件处理。`;

const navText = (n: NavOut) => (n.kind === 'navigate' ? `跳到画板 ${n.frame}` : n.kind === 'back' ? '返回上一页' : `打开 ${n.url}`);
const pathText = (path: Step[]) => path.map((p) => p.label).join(' → ');
const fmtVars = (v: Record<string, ProtoValue>) => JSON.stringify(v).slice(0, 160);

/** 交互状态检查的文字报告；返回文字与需要附上的截图（带说明）。 */
function formatStates(ex: Exploration, results: ProbeResult[], warnings: ProtoWarning[]): { text: string; images: Array<{ label: string; png: string }> } {
  const lines: string[] = [];
  const images: Array<{ label: string; png: string }> = [];
  const others = ex.states.slice(1);
  let bad = 0;
  if (others.length) {
    lines.push(
      `交互状态检查：从初始状态出发，点击 / 输入 / 等待计时最多 ${ex.maxDepth} 步，共到达 ${others.length} 个其他状态${ex.truncated ? `（已达上限 ${ex.maxStates} 个，未穷尽）` : ''}；只列出初始状态里没有的问题，同一问题只在首次出现的状态下列出。`,
    );
    // 同一问题（类型 + 节点）在多个状态中出现时只在第一次列出
    const firstSeen = new Map<string, string>();
    const quiet: string[] = [];
    for (const st of others) {
      const r = results[st.index];
      const name = `S${st.index}`;
      if (!r) continue;
      const fresh = r.issues.filter((i) => !firstSeen.has(`${i.kind}|${i.id}`));
      const repeated = [...new Set(r.issues.filter((i) => firstSeen.has(`${i.kind}|${i.id}`)).map((i) => firstSeen.get(`${i.kind}|${i.id}`)!))];
      for (const i of fresh) firstSeen.set(`${i.kind}|${i.id}`, name);
      const rep = repeated.length ? `另有与 ${repeated.join('、')} 相同的问题` : '';
      if (!fresh.length) {
        quiet.push(`${name}（${st.step!.label.replace(/（[^）]*）$/, '')}）`);
        continue;
      }
      bad++;
      lines.push(`- ${name} ${pathText(st.path)}：发现 ${fresh.length} 个问题${rep ? `（${rep}）` : ''}（状态 vars ${fmtVars(st.vars)}）`);
      for (const i of fresh.slice(0, 12)) lines.push(`  - [${i.kind}] ${i.id}：${i.detail}`);
      if (fresh.length > 12) lines.push(`  - …另有 ${fresh.length - 12} 个`);
      if (r.png) images.push({ label: `${name} ${pathText(st.path)}${r.region ? `（变化区域 x${r.region.x} y${r.region.y} ${r.region.width}×${r.region.height}）` : ''}`, png: r.png });
    }
    if (quiet.length) lines.push(`- 其余 ${quiet.length} 个状态没有新问题：${quiet.slice(0, 16).join('、')}${quiet.length > 16 ? ' …' : ''}`);
  } else if (ex.interactive) lines.push('交互状态检查：画板内的交互不会在本页产生新的状态。');
  if (ex.exits.length) lines.push(`离开本页：${ex.exits.slice(0, 8).map((e) => `${e.step.label} → ${navText(e.nav)}`).join('；')}`);
  const stat = [
    ...ex.unreachable.map((u) => `- [unreachable] ${u.addr}：${u.what === 'show' ? 'show' : '条件样式 when'} “${u.expr}” 在所有可到达的状态中都不成立，${u.what === 'show' ? '元素永远不会显示' : '这组样式永远不会生效'}：检查变量取值与比较是否写错，或补上切换到该状态的 onClick`),
    ...warnings.map((w) => `- [${w.kind}] ${w.id}：${w.detail}`),
  ];
  if (stat.length) lines.push('交互逻辑问题：', ...stat.slice(0, 20));
  if (bad || stat.length) lines.push('以上问题要逐个修复后重新截图；要单独查看某个状态，用 design_screenshot 的 clicks 或 vars 参数。');
  return { text: lines.join('\n'), images };
}

const REVIEW_CHECKLIST = '看截图逐项审查：①按钮 / tab / 标签文字是否单行、不换行不截断；②tab 下划线、选中指示条是否与文字水平居中；③按钮、列表项、导航项内图标与文字是否垂直居中；④同类元素（按钮、tab、卡片、列表项）尺寸、间距、圆角、字号是否一致；⑤对齐线、左右边距是否统一，有无文字贴边；⑥对比度与视觉焦点。';

const noteArg = z
  .string()
  .max(40)
  .optional()
  .describe('可选：一句话说明这一步在画什么（如“顶部导航”“登录表单”），显示在画布的 AI 光标旁');

const nodeShape = z
  .object({
    id: z.string().optional(),
    type: z.string(),
    render: z.enum(['container', 'text', 'image', 'input']).optional(),
    name: z.string().optional(),
    component: z.string().optional(),
    overrides: z.record(z.string(), z.object({ text: z.string().optional(), props: z.record(z.string(), z.string()).optional(), hidden: z.boolean().optional() })).optional(),
    layout: LayoutSchema.optional(),
    box: BoxSchema.optional(),
    style: StyleSchema.optional(),
    props: z.record(z.string(), z.string()).optional(),
    text: z.string().optional(),
    states: StatesSchema.optional(),
    proto: z.record(z.string(), z.any()).optional().describe('原型交互（见 node_insert 说明的“交互”一节）'),
    meta: MetaSchema.optional(),
    children: z.array(z.any()).optional().describe('子节点数组，每项结构同本节点'),
  })
  .describe('抽象节点');

type Json = Record<string, unknown>;

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
}
function fail(e: unknown): CallToolResult {
  const err = e as Error & { code?: string; data?: unknown };
  const body: Json = { error: err.message };
  if (err.code) body.code = err.code;
  if (err.data) body.detail = err.data;
  if (!(e instanceof DocError || e instanceof CanvasError || e instanceof ValidationError)) console.error(e);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(body) }] };
}

/** 检查地址链上（含祖先）是否有被用户锁定的节点。 */
function assertUnlocked(doc: DesignDoc, addr: string, includeSubtree = false) {
  const idx = getIndex(doc);
  const segs = addr.split(':');
  for (const s of segs) {
    let loc = idx.get(s);
    while (loc) {
      if (loc.node.meta?.locked) throw new CanvasError(`节点 ${loc.node.id} 已被用户锁定，AI 不能修改它或其子节点`, 'locked_node');
      loc = loc.parent ? idx.get(loc.parent.id) : undefined;
    }
  }
  if (includeSubtree) {
    const r = resolveAddress(doc, addr);
    walkTree(r.target.node, (n) => {
      if (n.meta?.locked) throw new CanvasError(`子节点 ${n.id} 已被用户锁定，不能删除或替换其祖先`, 'locked_node');
    });
  }
}

/** 把 props.src / style.backgroundImage 中的外部图片入库，替换为 asset:<hash>。 */
async function ingestImages(c: Canvas, cwd: string, nodes: Array<NodeInput | NodePatch>): Promise<Op[]> {
  const ops: Op[] = [];
  const handle = async (holder: Record<string, unknown> | undefined | null, key: string) => {
    const v = holder?.[key];
    if (typeof v !== 'string' || !v || v.startsWith('asset:')) return;
    try {
      const ref = await ingestSrc(c.dir, v, cwd);
      if (ref) {
        holder![key] = `asset:${ref.hash}`;
        if (!c.doc.assets[ref.hash] && !ops.some((o) => o.op === 'asset_add' && o.asset.hash === ref.hash)) ops.push({ op: 'asset_add', asset: ref });
      }
    } catch (e) {
      throw new CanvasError(`图片 ${v.slice(0, 80)} 入库失败：${(e as Error).message}`);
    }
  };
  const visit = async (n: NodeInput | NodePatch) => {
    await handle(n.props as Record<string, unknown>, 'src');
    await handle(n.style as Record<string, unknown>, 'backgroundImage');
    if (n && 'overrides' in n && n.overrides) for (const o of Object.values(n.overrides)) await handle(o.props as Record<string, unknown>, 'src');
    for (const ch of (n as NodeInput).children ?? []) await visit(ch);
  };
  for (const n of nodes) await visit(n);
  return ops;
}

// ---------- 读取的精简输出 ----------

interface ReadOpts {
  depth: number;
  includeHidden: boolean;
  components: Set<string>;
  addrs: string[];
}

function readNode(doc: DesignDoc, n: Node, addr: string, depth: number, o: ReadOpts, ov?: { text?: string; props?: Record<string, string>; hidden?: boolean }): Json | null {
  if (!o.includeHidden && (ov?.hidden ?? n.meta?.hidden)) return null;
  o.addrs.push(addr);
  const out: Json = { id: addr, type: n.type };
  if (n.render) out.render = n.render;
  if (n.name) out.name = n.name;
  if (n.component) {
    out.component = n.component;
    o.components.add(n.component);
  }
  for (const k of ['layout', 'box', 'style', 'states', 'proto'] as const) if (n[k] && Object.keys(n[k]!).length) out[k] = n[k];
  const props = ov?.props ? { ...n.props, ...ov.props } : n.props;
  if (props && Object.keys(props).length) out.props = props;
  const text = ov?.text ?? n.text;
  if (text !== undefined) out.text = text;
  if (n.overrides) out.overrides = n.overrides;
  if (n.meta?.locked) out.locked = true;
  if (n.meta?.hidden) out.hidden = true;
  if (n.children?.length) {
    if (depth <= 0) out.children = n.children.map((c) => ({ id: childAddr(addr, c.id), type: c.type, ...(c.component ? { component: c.component } : {}), stub: true }));
    else
      out.children = n.children
        .map((c) => readNode(doc, c, childAddr(addr, c.id), depth - 1, o))
        .filter(Boolean);
  }
  return out;
}

function subtreeIds(n: Node): Set<string> {
  const ids = new Set<string>();
  walkTree(n, (x) => ids.add(x.id));
  return ids;
}

function childAddr(addr: string, id: string) {
  const i = addr.lastIndexOf(':');
  return i < 0 ? id : `${addr.slice(0, i)}:${id}`;
}

function outlineNode(doc: DesignDoc, n: Node, depth: number): Json {
  const out: Json = { id: n.id, type: n.type };
  if (n.component) out.component = n.component;
  if (n.name) out.name = n.name;
  if (n.text !== undefined) out.text = n.text.length > 40 ? `${n.text.slice(0, 40)}…` : n.text;
  if (n.meta?.hidden) out.hidden = true;
  if (n.meta?.locked) out.locked = true;
  const kids = n.children ?? [];
  if (kids.length) {
    out.child_count = kids.length;
    if (depth > 0) out.children = kids.map((c) => outlineNode(doc, c, depth - 1));
  }
  return out;
}

function formatReport(target: string, r: ShotReport): string {
  const lines = [`${target} 渲染尺寸 ${Math.round(r.width)}×${Math.round(r.height)}，节点 ${r.nodes} 个。`];
  if (!r.issues.length) lines.push('自动检查通过：未发现溢出、越界、重叠、零尺寸、缺失字体、破损或被放大的图片、文字换行或未居中、对比度不足、触控目标过小。');
  else {
    lines.push(`发现 ${r.issues.length} 个问题，请逐个修复后重新截图：`);
    for (const i of r.issues.slice(0, 60)) lines.push(`- [${i.kind}] ${i.id}：${i.detail}`);
    if (r.issues.length > 60) lines.push(`…另有 ${r.issues.length - 60} 个`);
  }
  lines.push(`自动检查无法覆盖全部视觉问题。${REVIEW_CHECKLIST}`);
  return lines.join('\n');
}

export function createMcpServer(hub: Registry, ctx: SessionCtx): McpServer {
  const server = new McpServer({ name: 'penhold-mcp', version: VERSION }, { instructions: INSTRUCTIONS });

  const bound = (): Canvas => {
    if (ctx.canvasId) {
      const c = hub.get(ctx.canvasId);
      c.touch(ctx.id); // 本会话的任何工具调用都算活动，避免读取 / 截图期间锁空闲超时
      return c;
    }
    // 尝试别名与环境变量自动绑定
    const host = hub.hostSessionFor(ctx.ancestors);
    const id = (host && hub.lookupAlias(host)) || (ctx.envCanvas && hub.exists(ctx.envCanvas) ? ctx.envCanvas : undefined);
    if (id) {
      ctx.canvasId = id;
      return hub.get(id);
    }
    throw new CanvasError('尚未绑定画布，请先调用 canvas_open', 'unbound');
  };

  const canvasInfo = (c: Canvas, brief?: string): Json => ({
    canvas_id: c.id,
    url: hub.url(c.id),
    title: c.meta.title,
    rev: c.doc.rev,
    browser_online: c.clients.size > 0,
    frames: c.doc.frames.map((f) => ({ id: f.id, name: f.name, width: f.width, height: f.height, children: f.root.children?.length ?? 0 })),
    types: listTypes(c.doc).filter((t) => t !== 'page'),
    components: Object.keys(c.doc.components).map((name) => ({ name, instances: instanceCount(c.doc, name) })),
    tokens: c.doc.tokens,
    ...(c.doc.tweaks?.length ? { tweaks: c.doc.tweaks } : {}),
    selection: c.ui.selection,
    pending_check: [...c.pendingCheck],
    ...guidesInfo(c, brief),
    ...(() => {
      const s = systemOf(c);
      return s ? systemInfo(c, s.ds, s.installed) : {};
    })(),
    ...(c.meta.brief && !c.meta.brief.skipped ? { user_brief: c.meta.brief.answers, user_brief_hint: '用户在需求问卷里的回答，后续设计都要遵循。' } : {}),
    ...(needsBrief(c)
      ? {
          needs_brief: true,
          needs_brief_hint:
            '这个画布还没有任何设计依据，也还没有问过用户的偏好。先调用 design_ask() 在画布上向用户提问（产品、视觉方向、主色、明暗、页面内容），得到回答后再 design_plan；不要自己选方向、建设计系统或开画，服务端会拒绝。用户已在对话里说清产品与内容时可先 design_plan(enough_info) 建画板，问卷随后只问视觉偏好；用户亲口说过视觉偏好时再加 user_style 原样转述。',
        }
      : {}),
    note: '请在后续调用中记住 canvas_id；会话恢复后用 canvas_open(canvas_id) 找回同一画布。',
  });

  /** 生成方向卡片：避开同项目其他画布用过的主色与方向。 */
  const directionCards = (c: Canvas, brief: string): DirectionCard[] => {
    const others = hub
      .recent(c.meta.cwd, 8)
      .map((r) => r.canvas_id)
      .filter((id) => id !== c.id);
    const used = recentUsage(others);
    return suggestDirections({ brief, avoidColors: used.colors, avoidArchetypes: used.archetypes });
  };
  /** 画布还没有任何设计依据（本地规范、已选方向 / 预设、已有令牌）。 */
  const needsDirection = (c: Canvas) =>
    !c.meta.system && !c.meta.direction && !c.meta.preset && !c.doc.tokens['color.primary'] && !findDesignGuides(ctx.cwd, ctx.envGuides).length && !defaultSystem(c.meta.cwd);

  // ---------- 设计系统 ----------

  /** 画布安装的系统；没有时取项目默认系统（尚未安装）。 */
  const systemOf = (c: Canvas): { ds: DesignSystem; installed: boolean } | undefined => {
    const own = c.meta.system ? loadSystem(c.meta.system.id) : undefined;
    if (own) return { ds: own, installed: true };
    const def = defaultSystem(c.meta.cwd);
    return def ? { ds: def, installed: false } : undefined;
  };
  /** 安装系统的操作：选定主题的令牌，加上画布里还没有的组件定义。 */
  const installOps = (c: Canvas, ds: DesignSystem, theme?: string): Op[] => {
    const tokens = flattenSystem(ds, theme);
    const changed = Object.fromEntries(Object.entries(tokens).filter(([k, v]) => c.doc.tokens[k] !== v));
    const ops: Op[] = Object.keys(changed).length ? [{ op: 'set_tokens', tokens: changed }] : [];
    for (const comp of Object.values(ds.components))
      if (!c.doc.components[comp.name]) ops.push({ op: 'component_define', def: { name: comp.name, root: clone(comp.root) } });
    return ops;
  };
  const markInstalled = (c: Canvas, ds: DesignSystem, theme?: string) => {
    const th = theme && ds.color.themes.some((t) => t.id === theme) ? theme : (ds.color.themes[0]?.id ?? 'light');
    c.meta.system = { id: ds.id, version: ds.version, theme: th, installedAt: Date.now() };
    c.saveMeta();
    c.pushThemeInfo();
  };
  /** 持锁后调用：画布还没有任何令牌、项目有默认系统时自动安装（与 Claude Design 一样，默认系统不必再问）。 */
  const autoInstall = (c: Canvas): DesignSystem | undefined => {
    if (c.meta.system || c.doc.tokens['color.primary']) return undefined;
    const ds = defaultSystem(c.meta.cwd);
    if (!ds) return undefined;
    const ops = installOps(c, ds);
    if (ops.length) c.commit('ai', ops, { session: ctx.id, note: `安装设计系统「${ds.name}」` });
    markInstalled(c, ds);
    return ds;
  };
  /** 返回给 AI 的系统说明：先读 README，文字样式的写法直接给出。 */
  const systemInfo = (c: Canvas, ds: DesignSystem, installed: boolean): Json => {
    const bad = auditContrast(ds);
    return {
      design_system: {
        ...systemSummary(ds, c.meta.cwd),
        page: `${hub.url()}s/${ds.id}`,
        installed,
        ...(installed && c.meta.system ? { theme: c.meta.system.theme, ...(c.meta.system.version < ds.version ? { outdated: `画布装的是 v${c.meta.system.version}，系统已是 v${ds.version}：design_system({action:"install"}) 更新` } : {}) } : {}),
        text_styles: Object.fromEntries(ds.type.styles.map((s) => [s.name, textRecipe(s)])),
        ...(bad.length ? { contrast_issues: bad.slice(0, 8).map((b) => `${b.theme}：${b.fg} 对 ${b.bg} ${b.ratio}:1（要求 ${b.min}:1）`) } : {}),
      },
      design_system_hint: installed
        ? `本画布已安装设计系统「${ds.name}」：先用读文件工具完整阅读 README（${systemSummary(ds).readme}），令牌、文字样式、组件与视觉基础以它为准；文本节点按 text_styles 选一种样式，把字段原样写进 style。有现成组件时直接实例化，不画仿制品。缺令牌或要改风格时用 design_system({action:"update"}) 改系统本身，而不是只在这个画布里 tokens_set。`
        : `本项目有默认设计系统「${ds.name}」，首次写入时会自动安装到本画布（也可现在 design_system({action:"install"})）。先阅读 README（${systemSummary(ds).readme}），不必再选设计方向。`,
    };
  };
  const briefOf = (c: Canvas, extra: string[] = []) => [...new Set([ctx.brief, c.meta.title, ...c.doc.frames.map((f) => f.name), ...extra].filter(Boolean))].join(' ');
  const DIRECTION_HINT =
    '还没有设计方向：从 design_directions 里选一张（结合用户需求；没有明显更合适的就选与常规解不同的那张），调用 design_direction({pick:"<id>", concept:"…", motif:"…"}) 取完整令牌并记录，再 tokens_set。motif 是从题材里取的一个具体的物、形状或数据形态，记忆点用它来画。不满意可 design_direction() 换一批。';
  /** 方向的示例稿及其用法说明。 */
  const exampleOf = (id: string): Json => {
    const ex = directionExample(id);
    return ex
      ? {
          example: ex,
          example_hint:
            'example 是这个方向下一张完整的移动端首屏（题材与本需求无关），root 是可直接用于 node_insert 的节点树。学它的做法：字号只用 size.* 令牌加一处展示级大字、粗体只给标题与主行动、形状分层级、颜色全部引用令牌、记忆点真的画出来。不要照搬它的内容、构图和区块顺序：构图按 page_guides 选，记忆点用你的 motif 重新画。',
        }
      : {};
  };
  const MOTIF_HINT =
    '还没有题材母题：方向卡片的记忆点只是通用的构图手法，换任何题材都一样。从这个题材里取一个具体的物、形状或数据形态（钓鱼：浮漂、水线、潮汐曲线；记账：小票、账本格线），想清楚记忆点怎样用它来画，再调用 design_direction({pick:"<同一个 id>", concept:"…", motif:"…"}) 记录。';

  /** 信息不足且还没问过用户：应先 design_ask。 */
  const needsBrief = (c: Canvas) => !c.meta.brief && needsDirection(c);
  /** 还没问过用户偏好时拒绝定方向、建系统、设令牌与绘制。 */
  const briefGate = (c: Canvas, what: string) => {
    if (!needsBrief(c)) return;
    throw new CanvasError(
      c.briefForm
        ? `需求问卷还在画布上等待用户回答，现在不能${what}：告诉用户去画布上填写，再调用 design_ask() 等待回答。`
        : `还没有问过用户的视觉偏好，不能${what}：先调用 design_ask() 在画布上请用户选择视觉方向、主色与明暗${ctx.known ? '（已传 enough_info，问卷只问视觉偏好）' : '，并确认产品与页面内容'}，得到回答（或用户点“跳过”）后再继续。不要自己选方向或配色。用户已在对话里亲口说过视觉偏好时，在 design_plan 里用 user_style 原样转述。`,
      'needs_brief',
    );
  };
  const askWait = (seconds?: number) => (seconds !== undefined ? seconds * 1000 : Number(process.env.DESIGN_MCP_ASK_WAIT_MS ?? 50_000));
  /** 问卷结果：用户的回答，以及选定的方向或待选的方向卡片。 */
  const briefResult = (c: Canvas): Json => {
    const rec = c.meta.brief!;
    const d = c.meta.direction ? directionDetail(c.meta.direction.id, briefOf(c), c.meta.direction.primary) : undefined;
    const cards = needsDirection(c) ? directionCards(c, briefOf(c)) : [];
    const rest = {
      ...(d ? { direction: d } : {}),
      ...(d && !c.meta.direction?.motif ? { motif_missing: MOTIF_HINT } : {}),
      ...(d ? exampleOf(d.id) : {}),
      ...(cards.length ? { design_directions: cards, design_directions_hint: DIRECTION_HINT } : {}),
    };
    if (rec.skipped)
      return {
        status: 'skipped',
        hint: '用户没有填写，选择让你决定。现在可以 design_plan 并开始设计：自己提出一个具体的产品与用户假设并在回复里说明，从 design_directions 里选一个方向。',
        ...rest,
      };
    return {
      status: 'answered',
      answers: rec.answers,
      hint:
        '以上是用户的回答，优先级高于设计方向卡片与内置规范；没有回答的题目由你决定。' +
        (d ? '用户选定了视觉方向（direction，已记到画布）：把 direction.tokens 传给 tokens_set，signature 要在页面里画出来；用户另外指定了主色或明暗时，按用户的调整令牌。' : '') +
        (colorSchemes(rec.answers.find((a) => a.id === COLOR_Q)?.answer).length > 1
          ? '用户多选了主色：design_system({action:"create"}) 会为每种主色各生成一套亮 / 暗主题，用户在 Tweaks 面板里切换比较；design_direction 的 primary 传第一种主色，画布上只按默认配色画，颜色一律引用令牌，不要写死色值。'
          : '') +
        '页面内容按用户勾选和填写的来，不要擅自增删。现在调用 design_plan 并开始设计。',
      ...rest,
    };
  };

  /** 本地设计 skill / 规范文件，提示 AI 先读再画。 */
  const guidesInfo = (c: Canvas, brief?: string): Json => {
    const guides = findDesignGuides(ctx.cwd, ctx.envGuides);
    const chosen = c.meta.preset ? presetDetail(c.meta.preset) : undefined;
    const preset = {
      ...(chosen ? { design_preset: { id: chosen.id, name: chosen.name, style: chosen.style, tokens: chosen.tokens } } : {}),
      ...(c.meta.direction ? { design_direction: c.meta.direction } : {}),
    };
    if (guides.length)
      return { design_guides: guides, design_guides_hint: '开始绘制前请先用读文件工具阅读以上设计 skill / 规范，按其中的品牌色、字体、间距与组件约定设定令牌和组件。', ...preset };
    const matches = !chosen && !c.meta.direction && brief ? matchPresets(brief, 3) : [];
    return {
      design_guides: [{ path: DEFAULT_GUIDE, kind: 'builtin', name: 'penhold-mcp-default', description: '内置通用设计规范（未发现本地设计 skill / 规范时使用）' }],
      design_guides_hint: systemOf(c)
        ? `未发现本地设计规范；本项目使用设计系统「${systemOf(c)!.ds.name}」（见 design_system），先读它的 README，再读内置规范补充版式、组件与文案约定。`
        : c.meta.direction
        ? `未发现本地设计规范；本画布已选定设计方向「${c.meta.direction.name}」（design_direction），沿用已有令牌、形状与记忆点，并阅读内置规范。完整内容可用 design_direction({pick:"${c.meta.direction.id}"}) 再取。`
        : chosen
          ? `未发现本地设计规范；本画布已选用内置预设「${chosen.name}」（design_preset），沿用其令牌与风格，并阅读内置规范。`
          : '未发现本地设计 skill 或规范文件，请阅读内置规范（读不到文件时调用 design_preset() 获取全文）。design_plan 会返回几张设计方向卡片（design_directions），选一张后调用 design_direction({pick, concept}) 取完整令牌并记到画布上；也可用 design_preset({query}) 查某个行业的色板。可设置环境变量 DESIGN_MCP_GUIDES 指定规范。',
      ...preset,
      ...(matches.length ? { preset_matches: matches } : {}),
    };
  };

  /** 写工具公共流程：确保浏览器在线 → 持锁 → 计算操作 → 提交。 */
  const write = async (compute: (c: Canvas) => Promise<{ ops: Op[]; affected: Affected[]; extra?: Json }>, note?: string, opts: { noAuto?: boolean } = {}): Promise<CallToolResult> => {
    try {
      const c = bound();
      briefGate(c, '写入画布');
      await hub.ensureBrowser(c);
      await c.acquireLock(ctx.id);
      const auto = opts.noAuto ? undefined : autoInstall(c);
      const { ops, affected, extra: extra0 } = await compute(c);
      const extra = auto ? { ...extra0, design_system_installed: `已自动安装项目默认设计系统「${auto.name}」v${auto.version}` } : extra0;
      if (!ops.length) return ok({ rev: c.doc.rev, affected: [], needs_check: c.pendingCheck.size > 0, note: '没有变化', ...extra });
      const tx = c.commit('ai', ops, { session: ctx.id, note });
      const planned = c.planOutstanding();
      const warnings = lintProto(c.doc, c.pendingCheck);
      return ok({
        rev: tx.rev,
        affected,
        needs_check: true,
        pending_check: [...c.pendingCheck],
        ...(planned.length ? { planned_not_started: planned } : {}),
        ...(warnings.length ? { proto_warnings: warnings.slice(0, 10).map((w) => `${w.id}：${w.detail}`) } : {}),
        ...extra,
      });
    } catch (e) {
      return fail(e);
    }
  };
  const read = async (fn: (c: Canvas) => Promise<CallToolResult | Json> | CallToolResult | Json): Promise<CallToolResult> => {
    try {
      const r = await fn(bound());
      return 'content' in r ? (r as CallToolResult) : ok(r);
    } catch (e) {
      return fail(e);
    }
  };

  // ================= 会话 =================

  server.registerTool(
    'canvas_open',
    {
      title: '打开画布',
      description:
        '绑定或恢复画布并在浏览器打开。返回 canvas_id、URL、rev、画板、已用类型名、组件、令牌，以及设计规范文件路径（design_guides，绘制前先阅读）。上下文中已有 canvas_id 时务必传入；一个会话只能编辑一个画布。返回 status:"choose" 时请用户选择继续某个画布（传 canvas_id）或新建（new:true）。',
      inputSchema: {
        canvas_id: z.string().optional().describe('要恢复的画布 id'),
        new: z.boolean().optional().describe('强制新建画布'),
        title: z.string().optional().describe('新建画布的标题'),
        brief: z.string().max(300).optional().describe('可选：一句话描述要设计的产品（如 "personal finance budget tracker app"），没有本地设计规范时据此返回匹配的内置预设 preset_matches，并用于生成设计方向卡片'),
      },
    },
    async (args) => {
      try {
        if (args.brief) ctx.brief = args.brief;
        if (ctx.canvasId) {
          if (args.canvas_id && args.canvas_id !== ctx.canvasId)
            throw new CanvasError(`本会话已绑定画布 ${ctx.canvasId}，一个会话只能编辑一个画布`, 'bound');
          if (args.new) throw new CanvasError(`本会话已绑定画布 ${ctx.canvasId}，不能再新建`, 'bound');
          const c = hub.get(ctx.canvasId);
          if (!c.clients.size) hub.ensureBrowser(c, 1).catch(() => {});
          return ok(canvasInfo(c, args.brief));
        }
        const host = hub.hostSessionFor(ctx.ancestors);
        let id = args.canvas_id;
        if (id && !hub.exists(id)) throw new CanvasError(`画布 ${id} 不存在`, 'not_found');
        if (!id && !args.new && host) id = hub.lookupAlias(host);
        if (!id && !args.new && ctx.envCanvas && hub.exists(ctx.envCanvas)) id = ctx.envCanvas;
        if (!id && !args.new) {
          const recent = hub.recent(ctx.cwd);
          if (recent.length)
            return ok({
              status: 'choose',
              canvases: recent,
              hint: '当前目录下已有画布。请询问用户继续哪一个（canvas_open({canvas_id})），或新建（canvas_open({new:true, title})）。',
            });
        }
        const c = id ? hub.get(id) : hub.create({ title: args.title, cwd: ctx.cwd });
        ctx.canvasId = c.id;
        if (host) hub.addAlias(host, c.id);
        if (!c.clients.size) hub.ensureBrowser(c, 1).catch(() => {});
        return ok(canvasInfo(c, args.brief));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'design_preset',
    {
      title: '内置设计预设',
      description:
        '内置设计规范与按产品类型整理的预设（色板令牌、视觉风格、字体搭配、页面结构），用于没有本地设计规范时。不带参数：返回内置规范全文与产品类型列表；query：按需求匹配产品类型（英文关键词最准，如 "food delivery app"）；id：返回预设详情，加 use:true 记到当前画布以保持风格一致。用户指定的颜色与风格优先。',
      inputSchema: {
        query: z.string().max(300).optional().describe('产品类型或需求描述'),
        id: z.string().max(80).optional().describe('预设 id（来自 query 结果或列表）'),
        use: z.boolean().optional().describe('与 id 一起传：把该预设记为当前画布的设计预设'),
      },
    },
    async (args) => {
      try {
        if (args.id) {
          const d = presetDetail(args.id);
          if (!d) throw new CanvasError(`没有 id 为 ${args.id} 的预设，先用 query 搜索`, 'not_found');
          let recorded = false;
          if (args.use && ctx.canvasId) {
            const c = hub.get(ctx.canvasId);
            briefGate(c, '选用预设');
            c.meta.preset = d.id;
            c.saveMeta();
            recorded = true;
          }
          return ok({ ...d, ...(args.use ? { recorded, ...(recorded ? {} : { note: '尚未绑定画布，未记录；canvas_open 后再调用一次 use:true' }) } : {}) });
        }
        if (args.query) {
          const matches = matchPresets(args.query, 5);
          return ok(
            matches.length
              ? { matches, hint: '选最贴近的一个，调用 design_preset({id, use:true}) 取完整预设并记录到画布。' }
              : { matches: [], hint: '没有匹配的产品类型；换用英文关键词再试，或不带参数调用查看全部类型，也可按内置规范第 4 节自己定一套。' },
          );
        }
        return ok({
          guide: defaultGuideText(),
          products: catalog().products.map((p) => `${p.id}: ${p.name}`),
          source: presetSource(),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'design_direction',
    {
      title: '设计方向',
      description:
        '设计方向卡片：没有本地设计规范时，动手前定下明确且不落俗套的视觉取向。不带 pick：返回 3 张差异明显的方向（风格原型、色板、字体、形状与层次、版式思路、记忆点），避开同项目其他画布用过的主色与方向，每次结果不同（可用于“换一批”）。pick：返回完整方向（可直接传给 tokens_set 的令牌、风格要点、不要做的事）并记到画布；同时用 concept 写一句这一稿与众不同的那一点。用户指定的颜色与风格优先。',
      inputSchema: {
        brief: z.string().max(300).optional().describe('需求描述（产品、用户群、页面），缺省用 canvas_open 的 brief、画布标题与页面名'),
        pick: z.string().max(160).optional().describe('选定的方向卡片 id（来自 design_directions）'),
        concept: z.string().max(200).optional().describe('与 pick 一起传：一句话说明这一稿的设计概念，如“把本月结余做成首屏唯一的大数字”'),
        motif: z
          .string()
          .max(200)
          .optional()
          .describe('与 pick 一起传：题材母题。从这个题材里取一个具体的物、形状或数据形态，并说明记忆点怎样用它来画，如钓鱼 App：“浮漂与水线：首屏的出钓指数画成一根浮在水线上的浮漂刻度”'),
        primary: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, '写成 #RRGGBB')
          .optional()
          .describe('与 pick 一起传：按题材指定主色（#RRGGBB）。返回 palette_note 说色板不是按本题材挑的、或用户指定了主色时使用；整套色板按它重算（保持明度与饱和度搭配，修正对比度）'),
      },
    },
    async (args) => {
      try {
        if (args.brief) ctx.brief = args.brief;
        const c = ctx.canvasId ? hub.get(ctx.canvasId) : undefined;
        if (args.pick) {
          if (c) briefGate(c, '选定设计方向');
          const kept = c?.meta.direction?.id === args.pick ? c.meta.direction : undefined;
          const primary = args.primary ?? kept?.primary;
          const d = directionDetail(args.pick, c ? briefOf(c) : (ctx.brief ?? ''), primary);
          if (!d) throw new CanvasError(`没有 id 为 ${args.pick} 的方向卡片，先不带 pick 调用取得卡片`, 'not_found');
          if (c) {
            const prev = c.meta.direction?.id === d.id ? c.meta.direction : undefined;
            const concept = args.concept ?? prev?.concept;
            const motif = args.motif ?? prev?.motif;
            c.meta.direction = { id: d.id, name: d.name, signature: d.signature, ...(concept ? { concept } : {}), ...(motif ? { motif } : {}), ...(primary ? { primary } : {}) };
            c.saveMeta();
          }
          const motif = args.motif ?? (c?.meta.direction?.id === d.id ? c.meta.direction.motif : undefined);
          return ok({
            ...d,
            ...(motif ? { motif } : { motif_missing: MOTIF_HINT }),
            ...exampleOf(d.id),
            recorded: !!c,
            ...(c ? {} : { note: '尚未绑定画布，未记录；canvas_open 后再调用一次' }),
            next_step:
              '把这个方向存成项目的设计系统：调用 design_system({action:"create", name:"<产品名>"})。它按本方向生成完整的小系统（亮 / 暗两套颜色、按原型密度的字阶与文字样式、间距、圆角、阴影、品牌说明），修正对比度后写入 README 并安装到画布，同项目后续画布自动沿用。不需要再手动 tokens_set。',
            hint: '（不建系统时）tokens 可直接传给 tokens_set，再按内置规范第 5 节补上字号（size.*）与间距（space.*）令牌。font.* 已按本机安装的字体生成，直接使用，不要换成本机没有的字体；字重与字号按 typography 执行。signature 是构图手法，motif 是它画的内容：两者合起来的记忆点要在每个页面里真正画出来，shape 与 layout 全稿保持一致，avoid 列出的做法不要出现。用户指定了颜色或风格时，对应部分以用户为准。',
          });
        }
        const cards = c ? directionCards(c, briefOf(c)) : suggestDirections({ brief: ctx.brief });
        return ok({ design_directions: cards, design_directions_hint: DIRECTION_HINT });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'design_system',
    {
      title: '设计系统',
      description:
        '项目级设计系统（参照 Claude Design）：颜色按亮 / 暗主题各存一值并写明用途，文字是字号 + 行高 + 字重 + 字体的组合样式，另有间距、圆角、阴影、组件与品牌手册 README。系统与画布分开保存，同一项目的画布共用默认系统，新画布首次写入时自动安装。' +
        'action：get（默认，当前画布或项目的系统与 README 路径）、list（本机全部系统）、create（from:"direction" 由已选方向卡片生成小而完整的系统，"canvas" 由画布现有令牌整理，"preset" 由已选内置预设；保存、设为项目默认并安装到画布）、' +
        'import（path 指向 CSS 文件读取其中的 CSS 变量，含 .dark / prefers-color-scheme 暗色块；或 Claude Design 的 tokens.json / 导出的 system.json）、install（id 缺省为项目默认；theme 选主题）、theme（切换画布主题）、update（patch 按名字合并修改，所有安装了它的画布在下次 install 时更新，当前画布立即更新）、' +
        'save_components（names：把画布里画好的组件存进系统，后续画布直接实例化）、export（写到项目目录 design-system/，提交进仓库后其他机器自动发现）、audit（各主题的对比度与结构检查）。',
      inputSchema: {
        action: z.enum(['get', 'list', 'create', 'import', 'install', 'theme', 'update', 'save_components', 'export', 'audit']).optional(),
        id: z.string().max(48).optional().describe('系统 id，缺省为当前画布安装的或项目默认的'),
        name: z.string().max(60).optional().describe('create / import：系统名称，通常是产品名'),
        from: z.enum(['direction', 'canvas', 'preset']).optional().describe('create 的来源，缺省：画布已选方向 → direction，否则 canvas'),
        device: z.enum(['mobile', 'desktop']).optional().describe('create：字阶按哪类设备，缺省按画布画板宽度判断'),
        path: z.string().max(400).optional().describe('import：CSS / JSON 文件路径；export：目标目录（缺省为项目根下 design-system/）。相对路径按项目目录解析'),
        theme: z.string().max(24).optional().describe('install / theme：主题 id，如 light、dark'),
        schemes: z
          .array(z.object({ name: z.string().min(1).max(12), primary: z.string().regex(/^#[0-9a-fA-F]{6}$/, '写成 #RRGGBB') }))
          .max(4)
          .optional()
          .describe('create（from:"direction"）：多套配色，每套一个主色，各生成亮 / 暗主题，用户在 Tweaks 面板切换。缺省取需求问卷里用户多选的主色；用户在对话里说了几种颜色都想看时传入。第一套是默认配色'),
        names: z.array(z.string().max(60)).max(40).optional().describe('save_components：组件名'),
        usage: z.record(z.string(), z.string().max(200)).optional().describe('save_components：组件名 → 一句用法说明'),
        patch: z
          .object({
            name: z.string().max(60).optional(),
            brand: z.record(z.string(), z.union([z.string().max(600), z.array(z.string().max(200)).max(12)])).optional(),
            colors: z
              .array(
                z.object({
                  name: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
                  value: z.union([z.string().max(60), z.record(z.string(), z.string().max(60)), z.null()]).optional(),
                  usage: z.string().max(200).optional(),
                  on: z.array(z.string().max(40)).max(6).optional(),
                  ui: z.boolean().optional(),
                }),
              )
              .max(60)
              .optional(),
            themes: z
              .array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,23}$/), name: z.string().max(24), scheme: z.string().max(24).optional(), mode: z.enum(['light', 'dark']).optional(), swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }))
              .max(12)
              .optional()
              .describe('新增主题。另一套配色：同一 scheme（配色名）各给 mode 为 light / dark 的两个主题，Tweaks 面板按“配色 × 明暗”切换'),
            families: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,23}$/), z.string().max(300).nullable()).optional(),
            scale: z.record(z.string().regex(/^[a-z0-9]{1,6}$/), z.number().min(6).max(200).nullable()).optional(),
            styles: z
              .array(
                z.object({
                  name: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),
                  size: z.union([z.string().max(6), z.number().min(6).max(300)]).optional(),
                  lineHeight: z.number().min(0.8).max(3).optional(),
                  weight: z.number().int().min(100).max(900).optional(),
                  family: z.string().max(24).optional(),
                  letterSpacing: z.number().min(-10).max(20).optional(),
                  usage: z.string().max(200).optional(),
                  remove: z.boolean().optional(),
                }),
              )
              .max(30)
              .optional(),
            spacing: z.array(z.object({ name: z.string().max(12), value: z.string().max(20).nullable().optional(), usage: z.string().max(200).optional() })).max(16).optional(),
            radius: z.array(z.object({ name: z.string().max(12), value: z.string().max(20).nullable().optional(), usage: z.string().max(200).optional() })).max(8).optional(),
            shadow: z.array(z.object({ name: z.string().max(12), value: z.string().max(200).nullable().optional(), usage: z.string().max(200).optional() })).max(8).optional(),
          })
          .optional()
          .describe('update：要改的部分，按名字合并；颜色 value 写 {"light":"#..","dark":"#.."} 或单个值（第一个主题），null 删除'),
        make_default: z.boolean().optional().describe('create / import / install：设为本项目默认系统，缺省 true'),
      },
    },
    async (args) => {
      try {
        const action = args.action ?? 'get';
        const c = ctx.canvasId ? hub.get(ctx.canvasId) : undefined;
        const cwd = c?.meta.cwd ?? ctx.cwd;
        const resolvePath = (p: string) => (path.isAbsolute(p) ? p : path.resolve(cwd, p));
        const target = (): DesignSystem => {
          const id = args.id ?? c?.meta.system?.id;
          const ds = id ? loadSystem(id) : defaultSystem(cwd);
          if (!ds) throw new CanvasError(id ? `没有 id 为 ${id} 的设计系统` : '本项目还没有设计系统：先 design_system({action:"create"}) 或 import', 'not_found');
          return ds;
        };
        const report = (ds: DesignSystem, extra: Json = {}): Json => ({
          ...systemSummary(ds, cwd),
          page: `${hub.url()}s/${ds.id}`,
          text_styles: Object.fromEntries(ds.type.styles.map((st) => [st.name, textRecipe(st)])),
          ...(() => {
            const bad = auditContrast(ds);
            const lint = lintSystem(ds);
            return { ...(bad.length ? { contrast_issues: bad.map((b) => `${b.theme}：${b.fg} 对 ${b.bg} ${b.ratio}:1（要求 ${b.min}:1）`) } : {}), ...(lint.length ? { warnings: lint } : {}) };
          })(),
          hint: `用读文件工具阅读 ${systemSummary(ds).readme}：它是这个系统的品牌手册（颜色用途与对比度、文字样式写法、间距圆角、组件、视觉基础）。page 是给用户浏览和修改的页面（各主题色板、文字样式、组件预览；用户可以在里面自己改颜色、字体、间距、品牌说明，保存后同步到画布并重新生成 README，所以每次都以 README 的当前内容为准），交付时附上。`,
          ...extra,
        });
        /** 保存后安装到当前画布（需要编辑锁）。 */
        const saveAndInstall = async (ds: DesignSystem, note: string, extra: Json = {}): Promise<CallToolResult> => {
          const saved = saveSystem(ds);
          if (args.make_default !== false) setDefaultSystem(cwd, saved.id);
          if (!c) return ok(report(saved, { installed: false, note: '尚未绑定画布：已保存为项目系统，canvas_open 后首次写入时自动安装', ...extra }));
          return write(async (cv) => {
            const theme = args.theme ?? (cv.meta.system?.id === saved.id ? cv.meta.system.theme : undefined);
            const ops = installOps(cv, saved, theme);
            markInstalled(cv, saved, theme);
            return { ops, affected: ops.length ? [{ id: 'tokens', type: 'token' }] : [], extra: report(saved, { installed: true, theme: cv.meta.system!.theme, ...extra }) };
          }, note, { noAuto: true });
        };
        const deviceOf = (): 'mobile' | 'desktop' => args.device ?? (c && c.doc.frames.some((f) => f.width >= 1024) && !c.doc.frames.some((f) => f.width < 600) ? 'desktop' : 'mobile');

        switch (action) {
          case 'list':
            return ok({ systems: listSystems().map((ds) => systemSummary(ds, cwd)), ...(c?.meta.system ? { installed: c.meta.system } : {}) });
          case 'get': {
            const s = c ? systemOf(c) : undefined;
            const ds = args.id ? target() : (s?.ds ?? defaultSystem(cwd));
            if (!ds) return ok({ design_system: null, hint: '本项目还没有设计系统。没有本地设计规范时，选一张方向卡片后 design_system({action:"create"}) 生成；项目里有现成样式时用 import 读取其 CSS 变量。' });
            return ok(report(ds, { installed: !!c && c.meta.system?.id === ds.id }));
          }
          case 'audit': {
            const ds = target();
            return ok({ ...systemSummary(ds, cwd), contrast: auditContrast(ds, true), warnings: lintSystem(ds) });
          }
          case 'create': {
            if (c) briefGate(c, '生成设计系统');
            const from = args.from ?? (c?.meta.direction ? 'direction' : c?.meta.preset ? 'preset' : 'canvas');
            const reuse = c?.meta.system ? loadSystem(c.meta.system.id) : undefined;
            const name = args.name ?? reuse?.name ?? c?.meta.title ?? '设计系统';
            const id = reuse?.id ?? newSystemId(name);
            let ds: DesignSystem | undefined;
            if (from === 'direction') {
              const dir = c?.meta.direction;
              if (!dir) throw new CanvasError('画布还没有选定方向：先 design_direction({pick}) 或改用 from:"canvas"', 'invalid');
              const schemes = args.schemes
                ? args.schemes.map((s, i) => ({ id: `s${i + 1}`, name: s.name, primary: s.primary.toUpperCase() }))
                : colorSchemes(c!.meta.brief?.answers.find((a) => a.id === COLOR_Q)?.answer);
              // 方向没指定主色时，第一套配色就是默认配色
              const primary = args.schemes ? schemes[0]?.primary : (dir.primary ?? schemes[0]?.primary);
              const main = schemes.find((s) => s.primary.toUpperCase() === primary?.toUpperCase());
              ds = systemFromDirection(dir.id, { id, name, device: deviceOf(), brief: briefOf(c!), primary, concept: dir.concept, motif: dir.motif, schemes: schemes.filter((s) => s !== main), ...(main ? { schemeName: main.name } : {}) });
            } else if (from === 'preset') {
              const pd = c?.meta.preset ? presetDetail(c.meta.preset) : undefined;
              if (!pd) throw new CanvasError('画布还没有选用内置预设：先 design_preset({id, use:true})', 'invalid');
              ds = systemFromFlat(pd.tokens, { id, name, device: deviceOf(), source: { kind: 'preset', ref: pd.id } });
            } else {
              if (!c || !Object.keys(c.doc.tokens).length) throw new CanvasError('画布还没有令牌可整理：先选方向，或 import 项目的 CSS', 'invalid');
              ds = systemFromFlat(c.doc.tokens, { id, name, device: deviceOf(), source: { kind: 'canvas', ref: c.id } });
            }
            if (!ds) throw new CanvasError('无法由该方向生成设计系统', 'invalid');
            if (reuse) ds = { ...ds, components: reuse.components, version: reuse.version, brand: { ...ds.brand, ...(reuse.brand.notes ? { notes: reuse.brand.notes } : {}) } };
            return saveAndInstall(ds, `生成设计系统「${name}」`, reuse ? { replaced: `沿用原系统 id ${reuse.id}，版本 +1` } : {});
          }
          case 'import': {
            if (!args.path) throw new CanvasError('import 需要 path：CSS 文件（读取 CSS 变量）或 tokens.json / system.json', 'invalid');
            const file = resolvePath(args.path);
            const text = fs.readFileSync(file, 'utf8');
            const name = args.name ?? path.basename(path.dirname(file));
            let ds: DesignSystem | undefined;
            let skipped: string[] = [];
            if (/\.json$/i.test(file)) {
              const j = JSON.parse(text) as DesignSystem;
              if (j && j.v === 1 && j.color?.themes) ds = { ...j, id: j.id && /^[a-z0-9][a-z0-9-]{0,47}$/.test(j.id) ? j.id : newSystemId(name) };
              else {
                const imp = importTokensJson(j);
                if (!imp) throw new CanvasError('认不出这个 JSON：支持 Claude Design 的 tokens.json（color.themes + color.tokens 列表）与 penhold-mcp 导出的 system.json', 'invalid');
                ds = systemFromImport(imp, { id: newSystemId(name), name, device: deviceOf(), ref: file });
              }
            } else {
              const imp = importCss(text);
              if (!Object.keys(imp.themes).length) throw new CanvasError('文件里没有可识别的 CSS 变量（--color-*、--font-*、--text-*、--radius-*、--spacing-*、shadcn 的 --primary 等）', 'invalid');
              skipped = imp.skipped;
              ds = systemFromImport(imp, { id: newSystemId(name), name, device: deviceOf(), ref: file });
            }
            return saveAndInstall(ds, `导入设计系统「${ds.name}」`, {
              imported_from: file,
              ...(skipped.length ? { skipped: skipped.slice(0, 30) } : {}),
              import_hint: '导入值按原样保留，未达标的对比度只列在 contrast_issues 里，不自动改动：告诉用户，经同意后再用 update 修正。来源里没有的部分（字阶、间距、文字样式）用了默认值，对照项目代码确认。',
            });
          }
          case 'install':
          case 'theme': {
            const ds = action === 'theme' && !args.id ? (c?.meta.system ? loadSystem(c.meta.system.id) : undefined) : target();
            if (!ds) throw new CanvasError('画布还没有安装设计系统', 'not_found');
            if (!c) throw new CanvasError('尚未绑定画布，请先调用 canvas_open', 'unbound');
            if (args.theme && !ds.color.themes.some((t) => t.id === args.theme))
              throw new CanvasError(`系统「${ds.name}」没有主题 ${args.theme}（有 ${ds.color.themes.map((t) => t.id).join('、')}）`, 'invalid');
            if (action === 'install' && args.make_default !== false) setDefaultSystem(cwd, ds.id);
            return write(async (cv) => {
              const theme = args.theme ?? (cv.meta.system?.id === ds.id ? cv.meta.system.theme : undefined);
              const ops = installOps(cv, ds, theme);
              markInstalled(cv, ds, theme);
              return { ops, affected: ops.length ? [{ id: 'tokens', type: 'token' }] : [], extra: report(ds, { installed: true, theme: cv.meta.system!.theme }) };
            }, `安装设计系统「${ds.name}」`, { noAuto: true });
          }
          case 'update': {
            if (!args.patch) throw new CanvasError('update 需要 patch', 'invalid');
            const ds = target();
            const next = applyPatch(ds, args.patch as SystemPatch);
            const before = new Set(auditContrast(ds).map((b) => `${b.theme}|${b.fg}|${b.bg}`));
            const introduced = auditContrast(next).filter((b) => !before.has(`${b.theme}|${b.fg}|${b.bg}`));
            const extra = introduced.length ? { contrast_regressions: introduced.map((b) => `${b.theme}：${b.fg} 对 ${b.bg} 只有 ${b.ratio}:1（要求 ${b.min}:1）`) } : {};
            if (c && c.meta.system?.id === ds.id) return saveAndInstall(next, `更新设计系统「${ds.name}」`, extra);
            const saved = saveSystem(next);
            return ok(report(saved, extra));
          }
          case 'save_components': {
            if (!c) throw new CanvasError('尚未绑定画布，请先调用 canvas_open', 'unbound');
            const ds = target();
            const names = args.names?.length ? args.names : Object.keys(c.doc.components);
            const missing = names.filter((n) => !c.doc.components[n]);
            if (missing.length) throw new CanvasError(`画布里没有组件 ${missing.join('、')}（有 ${Object.keys(c.doc.components).join('、') || '无'}）`, 'not_found');
            const next: DesignSystem = { ...ds, components: { ...ds.components } };
            for (const n of names) next.components[n] = { ...clone(c.doc.components[n]), ...(args.usage?.[n] ? { usage: args.usage[n] } : ds.components[n]?.usage ? { usage: ds.components[n].usage } : {}) };
            const saved = saveSystem(next);
            if (c.meta.system?.id === saved.id) {
              c.meta.system.version = saved.version;
              c.saveMeta();
            }
            return ok(report(saved, { saved: names, note: '组件定义已存进系统；安装了这个系统的新画布会自动带上它们。组件里的颜色、字号要引用令牌，换主题时才会跟着变。' }));
          }
          case 'export': {
            const ds = target();
            const dir = args.path ? resolvePath(args.path) : path.join(cwd, PROJECT_DIR_NAME);
            exportSystem(ds, dir);
            return ok({ ...systemSummary(ds, cwd), exported_to: dir, files: ['system.json', 'README.md', 'tokens.css', 'tokens.json'], hint: '提交进仓库后，在这个项目里打开画布会自动发现并使用它；tokens.css 可直接给前端代码使用，tokens.json 是 Claude Design 的令牌格式。' });
          }
        }
        throw new CanvasError(`未知 action ${action}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'design_image',
    {
      title: '找图片素材',
      description:
        '设计稿需要照片（商品、人物、风景、食物、封面等）而用户没有提供素材时，从图库搜索可用的图片，返回候选的地址、原始尺寸、授权与署名，并附缩略图供你挑选。把选中的 url 写进图片节点的 props.src（或 style.backgroundImage），node_insert / node_update 时自动下载入库。每个图位搜一次、各用不同的图片，不要一张图用在多处；图片原始尺寸不小于显示尺寸。query 用具体的英文名词短语最准（"grilled salmon on plate"），不要用抽象词。图标、Logo、界面截图不要用它。用户给了图片文件或链接时用用户的。搜索词会发送给图库。',
      inputSchema: {
        query: z.string().min(2).max(120).describe('搜索词，具体的英文名词短语，如 "largemouth bass close up"'),
        count: z.number().int().min(1).max(6).optional().describe('返回几张候选，默认 4'),
        orientation: z.enum(['landscape', 'portrait', 'square']).optional().describe('按图位的形状选：横图、竖图或方图'),
        min_width: z.number().int().min(100).max(4000).optional().describe('原图最小宽度（px），默认 600；按显示宽度的 2 倍取'),
      },
    },
    async (args) => {
      try {
        const r = await searchImages({ query: args.query, count: args.count, orientation: args.orientation, minWidth: args.min_width });
        if (!r.hits.length)
          return ok({
            provider: r.provider,
            images: [],
            hint: '没有符合条件的图片：换一个更常见或更具体的英文搜索词，或放宽 orientation / min_width。仍然没有就请用户提供图片，或用与题材相关的色块加简单图形占位。',
          });
        const thumbs = await Promise.all(r.hits.map((h) => hitThumbnail(h)));
        const content: CallToolResult['content'] = [
          {
            type: 'text',
            text: JSON.stringify(
              {
                provider: r.provider,
                images: r.hits.map(({ thumbnail: _t, ...h }, i) => ({ n: i + 1, ...h, ...(thumbs[i] ? {} : { preview: false }) })),
                hint: '看缩略图挑内容与构图合适的一张（主体清晰、背景干净、与题材相符；preview:false 的没有取到缩略图，优先选看得到的），把它的 url 写进 props.src，并把 title 写进 props.alt。显示尺寸不要超过 width × height。credit 是署名：交付说明里列出用到的图片及署名，正式上线前请用户确认授权或换成自有素材。',
              },
              null,
              1,
            ),
          },
        ];
        r.hits.forEach((h, i) => {
          const t = thumbs[i];
          if (t) content.push({ type: 'text', text: `候选 ${i + 1}：${h.title}` }, { type: 'image', data: t.data, mimeType: t.mimeType });
        });
        return { content };
      } catch (e) {
        if (e instanceof ImageSearchError) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: e.message, code: 'image_search' }) }] };
        return fail(e);
      }
    },
  );

  server.registerTool(
    'design_ask',
    {
      title: '需求问卷',
      description:
        '用户给的信息很少、难以决定方向时（如只说“画一个登录页”），在画布上向用户出问卷，而不是自行假设后开画。在 canvas_open 之后、design_plan 之前调用（design_plan 传了 enough_info 时在它之后调用，问卷只问视觉偏好）；问过之前，选方向、建设计系统、设令牌与绘制都会被拒绝。不带 questions 用默认问卷（产品与用户、设备、视觉方向、主色、明暗、页面内容、参考、其他要求）；带 questions 用你写的问题（最多 8 个），默认附视觉方向题。调用会等待用户提交（默认约 50 秒），返回 status：answered（各题回答；选了视觉方向时附完整 direction，已记到画布）| skipped（用户让你决定）| waiting（还没答完：请用户去画布填写，再次调用继续等待，期间不要 design_plan 或绘制）。已回答过时直接返回已有回答（again:true 重新提问）。用户没填的题由你决定。',
      inputSchema: {
        title: z.string().max(60).optional().describe('问卷标题'),
        intro: z.string().max(200).optional().describe('问卷开头的一句说明'),
        questions: z
          .array(
            z.object({
              id: z.string().max(40).optional().describe('题目 id（字母数字），回答按它返回'),
              label: z.string().min(1).max(120).describe('问题，如 “登录方式需要哪些？”'),
              help: z.string().max(200).optional(),
              kind: z.enum(['single', 'multi', 'text']).describe('single 单选 | multi 多选 | text 填空'),
              options: z
                .array(z.union([z.string().max(80), z.object({ value: z.string().max(80).optional(), label: z.string().max(80), hint: z.string().max(160).optional() })]))
                .max(12)
                .optional()
                .describe('单选 / 多选的选项'),
              placeholder: z.string().max(80).optional(),
              other: z.boolean().optional().describe('选项之外允许用户填写其他内容'),
            }),
          )
          .min(1)
          .max(8)
          .optional()
          .describe('自定义问题；缺省使用默认问卷'),
        directions: z.boolean().optional().describe('自定义问题时是否附上视觉方向题，默认 true（画布已有设计依据时不附）'),
        again: z.boolean().optional().describe('用户已回答过时仍重新提问'),
        wait_seconds: z.number().int().min(0).max(600).optional().describe('本次调用最多等待用户多久，默认 50；客户端工具超时较短时不要调大'),
      },
    },
    async (args) => {
      try {
        const c = bound();
        const waiting = () =>
          ok({
            status: 'waiting',
            url: hub.url(c.id),
            hint: '问卷已显示在画布上，用户还没有提交。现在告诉用户：请到画布上回答几个问题（也可以直接在对话里说明，或在画布上点“跳过”）。然后再次调用 design_ask() 继续等待；连续两三次仍是 waiting 就结束本轮，等用户回复。得到回答之前不要调用 design_plan，也不要开始绘制。',
          });
        if (!args.questions && !args.again) {
          if (c.briefForm) {
            await hub.ensureBrowser(c);
            return (await c.waitBrief(askWait(args.wait_seconds))) ? ok(briefResult(c)) : waiting();
          }
          if (c.meta.brief) return ok(briefResult(c));
        }
        await hub.ensureBrowser(c);
        const brief = briefOf(c);
        const withDirections = needsDirection(c) && args.directions !== false;
        const cards = withDirections ? directionCards(c, brief) : [];
        const form = args.questions ? customBriefForm({ title: args.title, intro: args.intro, questions: args.questions }, cards) : defaultBriefForm({ brief, cards, known: ctx.known });
        if (!args.questions && (args.title || args.intro)) Object.assign(form, { ...(args.title ? { title: args.title } : {}), ...(args.intro ? { intro: args.intro } : {}) });
        c.askBrief(form, (f) => {
          const next = directionQuestion(directionCards(c, briefOf(c)));
          return { ...f, questions: f.questions.map((q) => (q.id === DIRECTION_Q ? next : q)) };
        });
        return (await c.waitBrief(askWait(args.wait_seconds))) ? ok(briefResult(c)) : waiting();
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'canvas_status',
    {
      title: '画布状态',
      description:
        '返回画布是否在线、用户选区（节点 id、类型、组件名）、最新 rev、编辑锁状态、尚未自检的画板，以及用户留下的评论与批注（附所在画板与指向的节点 id）。续改前先看评论：它们是用户对设计的具体意见。你用 design_annotate 写的说明单独列在 ai_annotations。',
      inputSchema: {},
    },
    async () =>
      read((c) => {
        const idx = getIndex(c.doc);
        const selection = c.ui.selection.map((addr) => {
          try {
            const r = resolveAddress(c.doc, addr);
            const n = addr.includes(':') ? r.target.node : (idx.get(addr)?.node ?? r.target.node);
            return { id: addr, type: n.type, ...(n.component ? { component: n.component } : {}), ...(n.name ? { name: n.name } : {}) };
          } catch {
            return { id: addr, missing: true };
          }
        });
        return {
          canvas_id: c.id,
          title: c.meta.title,
          rev: c.doc.rev,
          browser_online: c.clients.size > 0,
          url: hub.url(c.id),
          selection,
          lock: c.lock ? (c.lock.session === ctx.id ? 'held_by_you' : 'held_by_other_session') : 'none',
          pending_check: [...c.pendingCheck],
          ...(c.pendingCheck.size ? { reminder: '以上画板有改动尚未截图自检，请调用 design_screenshot' } : {}),
          ...(c.planOwner() === ctx.id && c.planPages().length
            ? {
                plan: c.planPages().map((p) => ({ frame_id: p.frame, name: p.name, status: p.status, empty: p.empty })),
                ...(c.lock ? {} : { plan_hint: '编辑锁因空闲已释放，但规划的画板都还在：直接用这些 frame_id 继续 node_update / node_insert 即可接着画，不要重新 design_plan 或 frame_create。' }),
              }
            : {}),
          ...summarizeNotes(c),
          ...(!c.pendingCheck.size && missingNotesHint(c) ? { missing_notes: missingNotesHint(c) } : {}),
        };
      }),
  );

  const pointArg = z
    .union([z.tuple([z.number(), z.number()]), z.object({ frame: z.string().optional(), x: z.number(), y: z.number() })])
    .describe('[x, y] 相对本条批注的 frame 左上角（无 frame 时为画布世界坐标）；跨画板时写 {frame, x, y}，坐标相对该画板');

  server.registerTool(
    'design_annotate',
    {
      title: '说明批注',
      description:
        '在画布上为设计稿补充业务流程与说明：rect 说明框（多行文字：页面说明、业务规则、交互状态、待确认问题）、text 文字（流程标题 / 步骤标签）、arrow 箭头（页面间跳转与流程走向，可跨画板）、line 连线。批注标有 AI，不进入设计稿、导出与撤销栈，不需要编辑锁和自检。坐标相对所在画板左上角（画板横排、顶端 y=0）；画板上方 40px 是标题与工具栏，说明框底边须在 y=-40 以上（越界会自动上移），也可放在画板下方，不要放进画板内部。返回 frame_layout（各画板 x 与宽度）、box_xywh（说明框位置）与 warnings（调整与遮挡）。传 id 更新已有批注；remove 删除指定 id；clear:true 删除全部 AI 批注，clear:"<画板id>" 只删该画板的。用户的批注不能改删；用户评论按意见改完、design_screenshot 自检确认无误后，用 resolve:[评论编号] 关闭（所在画板仍待自检时会被拒绝），只传 resolve 时 add 可省略。',
      inputSchema: {
        add: z
          .array(
            z.object({
              id: z.string().max(40).optional().describe('更新已有 AI 批注时传它的 id'),
              kind: z.enum(['rect', 'note', 'text', 'arrow', 'line']).describe('rect 说明框（note 为其别名）；text 文字；arrow 箭头；line 连线'),
              frame: z.string().max(64).optional().describe('所在画板 id；坐标相对其左上角'),
              node: z.string().max(200).optional().describe('说明针对的节点 id（可选，仅作关联）'),
              at: pointArg.optional().describe('rect / text 的左上角位置'),
              from: pointArg.optional().describe('arrow / line 起点'),
              to: pointArg.optional().describe('arrow / line 终点（箭头指向此处）'),
              text: z.string().max(4000).optional().describe('rect / text 的内容，可换行'),
              width: z.number().min(40).max(1200).optional().describe('rect / text 宽度 px，说明框缺省 320，通常与画板同宽'),
              height: z.number().min(24).max(4000).optional().describe('rect 最小高度 px；缺省按文字估算'),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('rect 底色 / arrow、line 线色 #RRGGBB；缺省为 AI 蓝'),
              dash: z.enum(['solid', 'dashed', 'dotted']).optional().describe('arrow / line 线型，如异常 / 可选路径用 dashed'),
            }),
          )
          .max(100)
          .optional(),
        remove: z.array(z.string()).max(300).optional().describe('要删除的 AI 批注 id'),
        clear: z.union([z.boolean(), z.string()]).optional().describe('true 删除全部 AI 批注；传画板 id 只删该画板的'),
        resolve: z.array(z.number().int().min(1)).max(200).optional().describe('已按意见改完并自检确认的用户评论编号（canvas_status comments 里的 n），关闭后从画布移除'),
      },
    },
    async (args) =>
      read((c) => {
        const r = applyAnnotations(c, args);
        if (!c.clients.size) hub.ensureBrowser(c, 1).catch(() => {});
        const missing = framesMissingNotes(c);
        if (args.resolve?.length && !args.add?.length && !args.remove?.length && args.clear === undefined) {
          const left = c.notes.filter((n) => n.kind === 'comment' && n.by !== 'ai').map((n) => n.n);
          return { resolved_comments: r.resolved_comments ?? [], ...(left.length ? { open_comments: left } : {}) };
        }
        return { ...r, ...(missing.length ? { frames_without_notes: missing, frames_without_notes_hint: '这些画板还没有说明框，继续用 design_annotate 补上' } : {}) };
      }),
  );

  // ================= 绘制 =================

  server.registerTool(
    'design_plan',
    {
      title: '规划页面',
      description:
        '要画新页面时（单页也调用）在需求明确后立即调用，早于阅读设计规范和 tokens_set：一次声明本轮全部页面。服务端立即建好空画板（返回 frame_id），画布显示骨架屏与各页状态。之后用 frame_id 逐页绘制：node_update(node_id=frame_id) 设置根节点背景与 padding，node_insert(parent_id=frame_id) 插入内容。修改已有画板时传它的 frame_id 纳入规划。长时间没有调用（读规范、生成大段内容）只会释放编辑锁，规划的画板不会被删除，用原 frame_id 继续写入即可，不需要重新规划。再次调用会整体替换规划：上次新建、仍为空的画板，新列表里有同名页面时沿用原 frame_id，否则删除；会话结束或用户终止时仍为空的规划画板也会被删除。全部规划页面自检后编辑锁才释放。画布还没有设计依据时会拒绝并提示先 design_ask；用户已在对话里说清产品与内容时传 enough_info 先建画板，视觉偏好仍要通过 design_ask 问用户，除非用户亲口说过（传 user_style）。返回值附 page_guides（该类页面的构图方案与平庸写法），以及尚无设计依据时的 design_directions（方向卡片）。',
      inputSchema: {
        pages: z
          .array(
            z.object({
              frame_id: z.string().optional().describe('已有画板 id：纳入规划（可同时改名、改尺寸）；缺省则新建空画板'),
              name: z.string().min(1).max(60).describe('如 “登录页 / 移动端”'),
              width: z.number().int().min(100).max(10000).optional().describe('新建页面必填，如 390 / 768 / 1440'),
              height: z.union([z.number().int().min(100).max(100000), z.literal('auto')]).optional().describe('默认 auto'),
              sections: z.array(z.string().max(30)).max(12).optional().describe('页面从上到下的主要区块，如 ["顶部导航","Banner","商品列表","底部 tab"]，用于绘制骨架屏'),
            }),
          )
          .min(1)
          .max(30),
        enough_info: z
          .string()
          .min(10)
          .max(300)
          .optional()
          .describe('仅当画布还没有设计依据、而用户在对话里已经说清楚了产品与页面内容时填写：用一句话复述用户说过的产品与用户、页面内容（不能是你的假设）。传了它也只是先建画板，视觉偏好仍要 design_ask 问用户（问卷只问视觉部分），除非同时传 user_style。'),
        user_style: z
          .string()
          .min(2)
          .max(300)
          .optional()
          .describe('与 enough_info 一起传：用户在对话里亲口说过的视觉偏好（风格、颜色、明暗或参考产品），原样转述，如“用户说：深色、科技感，参考 Linear”。用户没说过就不要填，也不要替用户推断（项目名、产品类型都不算视觉偏好），改为 design_ask。'),
      },
    },
    async (args) => {
      try {
        const bad = args.pages.findIndex((p) => !p.frame_id && !p.width);
        if (bad >= 0) throw new CanvasError(`pages[${bad}]：新建页面必须给出 width`);
        const c = bound();
        if (args.user_style && !args.enough_info) throw new CanvasError('user_style 要与 enough_info 一起传', 'invalid');
        if (needsBrief(c) && !args.enough_info)
          throw new CanvasError(
            c.briefForm
              ? '需求问卷还在画布上等待用户回答：调用 design_ask() 继续等待，得到回答后再 design_plan。'
              : '这个画布还没有任何设计依据（本地规范、用户回答、已选方向）。先调用 design_ask() 在画布上向用户询问产品、视觉偏好与页面内容，得到回答后再 design_plan；不要自行假设后直接开始画。用户在对话里已经说清产品与页面内容时，传 enough_info（复述用户说过的产品与内容）先建画板，随后 design_ask() 只问视觉偏好；用户亲口说过视觉偏好时再加 user_style 原样转述，才能跳过问卷。',
            'needs_brief',
          );
        if (args.enough_info && !ctx.brief) ctx.brief = args.enough_info;
        if (args.enough_info && needsBrief(c)) {
          ctx.known = args.enough_info;
          if (args.user_style) {
            c.meta.brief = {
              at: Date.now(),
              source: 'chat',
              answers: [
                { id: 'product', question: '产品与页面内容（对话中）', answer: args.enough_info },
                { id: 'style', question: '视觉偏好（对话中）', answer: args.user_style },
              ],
            };
            c.saveMeta();
          }
        }
        const askFirst = needsBrief(c);
        await hub.ensureBrowser(c);
        await c.acquireLock(ctx.id);
        const auto = autoInstall(c);
        const pages = c.applyPlan(
          ctx.id,
          args.pages.map((p) => ({ ...p, width: p.width ?? 0 })),
        );
        const guides = pageGuides(args.pages);
        const directions = needsDirection(c) ? directionCards(c, briefOf(c, args.pages.flatMap((p) => p.sections ?? []))) : [];
        return ok({
          rev: c.doc.rev,
          pages: pages.map((p) => ({ frame_id: p.frame, name: p.name, status: p.status, empty: p.empty })),
          ...(askFirst
            ? {
                needs_brief: true,
                hint: '画板已建好，但还没有问过用户的视觉偏好：现在调用 design_ask()（只问视觉方向、主色与明暗），得到回答后再选方向、建设计系统并绘制。在此之前 design_direction({pick})、design_system({action:"create"})、tokens_set 与绘制都会被拒绝。',
              }
            : {
                hint: '按顺序逐页绘制：先 node_update(node_id=frame_id) 设置根节点，再 node_insert(parent_id=frame_id)；每页画完可立即 design_screenshot 自检。',
                ...(directions.length ? { design_directions: directions, design_directions_hint: DIRECTION_HINT } : {}),
              }),
          ...(auto ? { ...systemInfo(c, auto, true), design_system_installed: `已安装项目默认设计系统「${auto.name}」v${auto.version}` } : {}),
          ...(guides.length
            ? {
                page_guides: guides,
                page_guides_hint: '以上是本轮页面所属类型的构图方案与常见平庸写法：每类从构图方案里选一个（不要默认用第一个）并避开平庸写法；与设计规范、设计方向同时适用。',
              }
            : {}),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'frame_create',
    {
      title: '新建画板',
      description: '新建画板（一个页面或一个组件稿），可同时给出根节点（含 children，Node 结构见 node_insert）。画板 id 同时是根节点 id，可作为 node_insert 的 parent_id。桌面端与移动端分别建画板。已在 design_plan 中声明的页面不要再建。',
      inputSchema: {
        name: z.string().describe('如 “登录页 / 桌面端”'),
        width: z.number().int().min(100).max(10000).describe('视口宽度，如 1440 / 390'),
        height: z.union([z.number().int().min(100).max(100000), z.literal('auto')]).optional().describe('默认 auto'),
        root: nodeShape.optional().describe('根节点（不需要 id），用于设置背景、内边距、布局与初始子节点'),
        index: z.number().int().min(0).optional(),
        note: noteArg,
      },
    },
    async (args) =>
      write(async (c) => {
        const id = newId('f');
        const rootIn = validateNodeInput({ type: 'page', ...(args.root ?? {}) }, 'root');
        if (rootIn.component) throw new CanvasError('画板根节点不能是组件');
        const pre = await ingestImages(c, ctx.cwd, [rootIn]);
        const { children, id: _ignored, ...rest } = rootIn;
        const prep = prepareNodes(c.doc, children ?? [], undefined);
        const root: Node = { ...(rest as Node), id };
        if (prep.nodes.length) root.children = prep.nodes;
        const ops: Op[] = [...pre, ...prep.ops, { op: 'frame_create', index: args.index ?? c.doc.frames.length, frame: { id, name: args.name, width: args.width, height: args.height ?? 'auto', root } }];
        return { ops, affected: [{ id, type: root.type }, ...prep.affected], extra: { frame_id: id } };
      }, args.note),
  );

  server.registerTool(
    'frame_update',
    {
      title: '修改画板',
      description: '修改画板名称或尺寸。根节点的样式与布局用 node_update(node_id=frame_id)。',
      inputSchema: {
        frame_id: z.string(),
        name: z.string().optional(),
        width: z.number().int().min(100).max(10000).optional(),
        height: z.union([z.number().int().min(100).max(100000), z.literal('auto')]).optional(),
      },
    },
    async (args) =>
      write(async (c) => {
        const f = c.doc.frames.find((x) => x.id === args.frame_id);
        if (!f) throw new CanvasError(`画板 ${args.frame_id} 不存在`, 'not_found');
        const op: Op = { op: 'frame_update', id: f.id, name: args.name, width: args.width, height: args.height };
        return { ops: args.name || args.width || args.height ? [op] : [], affected: [{ id: f.id, type: f.root.type }] };
      }),
  );

  server.registerTool(
    'frame_delete',
    {
      title: '删除画板',
      description: '删除画板及其全部节点（可由用户“回退 AI 上一轮改动”恢复）。',
      inputSchema: { frame_id: z.string() },
    },
    async (args) =>
      write(async (c) => {
        const f = c.doc.frames.find((x) => x.id === args.frame_id);
        if (!f) throw new CanvasError(`画板 ${args.frame_id} 不存在`, 'not_found');
        assertUnlocked(c.doc, f.id, true);
        return { ops: [{ op: 'frame_remove', id: f.id }], affected: [{ id: f.id, type: f.root.type }] };
      }),
  );

  server.registerTool(
    'node_insert',
    {
      title: '插入节点',
      description: `在 parent_id 下的 index 位置（缺省末尾）插入一棵或多棵节点子树，一次可插入一整个区块。校验失败时整次调用不生效并指出出错节点与字段。parent_id 可以是画板 id、节点 id 或组件定义内节点（修改定义会同步到所有实例）。\n${NODE_GUIDE}\n${PROTO_GUIDE}`,
      inputSchema: {
        parent_id: z.string(),
        index: z.number().int().min(0).optional(),
        nodes: z.array(nodeShape).min(1),
        base_rev: z.number().int().optional(),
        note: noteArg,
      },
    },
    async (args) =>
      write(async (c) => {
        const inputs = args.nodes.map((n, i) => validateNodeInput(n, `nodes[${i}]`));
        assertUnlocked(c.doc, args.parent_id);
        const pre = await ingestImages(c, ctx.cwd, inputs);
        const prep = insertOps(c.doc, args.parent_id, args.index, inputs);
        const extra: Json = {};
        if (prep.component) extra.component_changed = { name: prep.component, instances: instanceCount(c.doc, prep.component) };
        if (prep.newComponents.length) extra.new_components = prep.newComponents;
        return { ops: [...pre, ...prep.ops], affected: prep.affected, extra };
      }, args.note),
  );

  server.registerTool(
    'node_replace',
    {
      title: '替换节点',
      description: '用新的节点子树整体替换 node_id（保持在父节点中的位置，缺省沿用原 id；Node 结构见 node_insert）。带 base_rev 时，若目标子树在其后被用户改过则拒绝并返回变化字段，请先读后写。',
      inputSchema: { node_id: z.string(), node: nodeShape, base_rev: z.number().int().optional(), note: noteArg },
    },
    async (args) =>
      write(async (c) => {
        const input = validateNodeInput(args.node, 'node');
        const r = resolveAddress(c.doc, args.node_id);
        if (!r.target.parent) throw new CanvasError('不能替换画板或组件的根节点；请用 frame_update / node_update');
        assertUnlocked(c.doc, args.node_id, true);
        if (args.base_rev !== undefined) {
          const changed = c.userChangedInSubtree(subtreeIds(r.target.node), args.base_rev);
          if (changed.length) throw new CanvasError('目标在 base_rev 之后被用户修改过，请先 design_read 再写', 'conflict', { changed });
        }
        const pre = await ingestImages(c, ctx.cwd, [input]);
        const target = r.target.node;
        const parent = r.target.parent;
        const at = parent.children!.findIndex((x) => x.id === target.id);
        if (!input.id) input.id = target.id;
        // 在副本上先删除，再准备插入，以便沿用原 id
        const scratch = clone(c.doc);
        const removeOp: Op = { op: 'remove', id: target.id };
        applyOps(scratch, [removeOp]);
        const prep = prepareNodes(scratch, [input], r.target.component);
        if (r.target.component && prep.newComponents.length) throw new CanvasError('组件定义内部不能注册新组件');
        const ops: Op[] = [...pre, removeOp, ...prep.ops, { op: 'insert', parent: parent.id, index: at, node: prep.nodes[0] }];
        return { ops, affected: prep.affected };
      }, args.note),
  );

  server.registerTool(
    'node_update',
    {
      title: '修改节点字段',
      description:
        '批量修改节点字段，按字段合并（对象字段逐键合并，值为 null 删除该键）。作用于组件内部节点（或实例上的 box/style）时修改的是组件定义，会同步到所有实例；只改一个实例时修改实例内部地址 "<实例id>:<内部id>" 的 text/props/hidden（写入 overrides）。component 填新名字可把该子树登记为组件，填 null 可把实例解除为普通节点。带 base_rev 时，用户在其后改过的键保留用户的值并在 skipped 中列出。',
      inputSchema: {
        updates: z
          .array(
            z.object({
              node_id: z.string(),
              layout: z.record(z.string(), z.any()).nullable().optional(),
              box: z.record(z.string(), z.any()).nullable().optional(),
              style: z.record(z.string(), z.any()).nullable().optional(),
              props: z.record(z.string(), z.string().nullable()).nullable().optional(),
              states: z.record(z.string(), z.any()).nullable().optional(),
              proto: z.record(z.string(), z.any()).nullable().optional().describe('原型交互，整体替换；null 清除'),
              meta: z.object({ hidden: z.boolean().nullable().optional() }).optional(),
              text: z.string().nullable().optional(),
              name: z.string().nullable().optional(),
              type: z.string().optional(),
              render: z.enum(['container', 'text', 'image', 'input']).nullable().optional(),
              component: z.string().nullable().optional(),
            }),
          )
          .min(1),
        base_rev: z.number().int().optional(),
        note: noteArg,
      },
    },
    async (args) =>
      write(async (c) => {
        const all: Op[] = [];
        const affected: Affected[] = [];
        const skipped: Json[] = [];
        const componentsChanged = new Set<string>();
        // 在副本上逐条应用，以便后续更新看到前面的结果
        const scratch = clone(c.doc);
        for (const u of args.updates) {
          const { node_id, ...patch } = u as { node_id: string } & NodePatch;
          if ((patch as { meta?: unknown }).meta && 'locked' in ((patch as { meta: object }).meta ?? {})) throw new CanvasError('锁定状态只能由用户设置');
          assertUnlocked(scratch, node_id);
          const pre = await ingestImages(c, ctx.cwd, [patch]);
          let skip: Set<string> | undefined;
          if (args.base_rev !== undefined) {
            const r = resolveAddress(scratch, node_id);
            const keys = [...c.userChangedSince(r.target.node.id, args.base_rev), ...(r.instance ? c.userChangedSince(node_id, args.base_rev) : [])];
            if (keys.length) {
              skip = new Set(keys);
              if (r.instance && keys.some((k) => k.startsWith(`${node_id}.overrides`))) {
                if (patch.text !== undefined || patch.props !== undefined) skipped.push({ node_id, fields: ['text', 'props'], reason: '用户已改过该实例的内容' });
                delete patch.text;
                delete patch.props;
              }
            }
          }
          const res = updateOps(scratch, node_id, patch, 'ai', skip);
          if (skip) {
            const wanted = Object.entries(patch).flatMap(([f, v]) =>
              v && typeof v === 'object' ? Object.keys(v).map((k) => `${f}.${k}`) : v !== undefined ? [f] : [],
            );
            const written = new Set(res.touched.map((t) => t.key));
            const lost = wanted.filter((k) => !written.has(k));
            if (lost.length) skipped.push({ node_id, fields: lost, reason: '用户在 base_rev 之后修改过，已保留用户的值' });
          }
          applyOps(scratch, [...pre, ...res.ops]);
          all.push(...pre, ...res.ops);
          if (res.component) componentsChanged.add(res.component);
          const r2 = (() => {
            try {
              return resolveAddress(scratch, node_id).target.node;
            } catch {
              return undefined;
            }
          })();
          affected.push({ id: node_id, type: r2?.type ?? '?', ...(r2?.component ? { component: r2.component } : {}) });
        }
        const extra: Json = {};
        if (skipped.length) extra.skipped = skipped;
        if (componentsChanged.size)
          extra.components_changed = [...componentsChanged].map((name) => ({ name, instances: instanceCount(c.doc, name) }));
        return { ops: all, affected, extra };
      }, args.note),
  );

  server.registerTool(
    'node_move',
    {
      title: '移动节点',
      description: '调整节点的父节点或同级顺序（只能在同一画板树或同一组件定义内移动）。',
      inputSchema: { node_id: z.string(), parent_id: z.string(), index: z.number().int().min(0), note: noteArg },
    },
    async (args) =>
      write(async (c) => {
        const r = resolveAddress(c.doc, args.node_id);
        const p = resolveAddress(c.doc, args.parent_id);
        assertUnlocked(c.doc, args.node_id);
        assertUnlocked(c.doc, args.parent_id);
        if (p.target.node.component && !p.instance) throw new CanvasError(`${args.parent_id} 是组件实例，不能作为父节点`);
        return {
          ops: [{ op: 'move', id: r.target.node.id, parent: p.target.node.id, index: args.index }],
          affected: [{ id: args.node_id, type: r.target.node.type, ...(r.target.node.component ? { component: r.target.node.component } : {}) }],
        };
      }, args.note),
  );

  server.registerTool(
    'node_delete',
    {
      title: '删除节点',
      description: '删除节点及其子树。删除组件定义内的节点会影响所有实例。带 base_rev 时，若目标在其后被用户改过则拒绝。',
      inputSchema: { node_ids: z.array(z.string()).min(1), base_rev: z.number().int().optional(), note: noteArg },
    },
    async (args) =>
      write(async (c) => {
        const ops: Op[] = [];
        const affected: Affected[] = [];
        const comps = new Set<string>();
        for (const id of args.node_ids) {
          const r = resolveAddress(c.doc, id);
          if (!r.target.parent) throw new CanvasError(`${id} 是画板或组件根节点，不能删除（删画板用 frame_delete）`);
          assertUnlocked(c.doc, id, true);
          if (args.base_rev !== undefined) {
            const changed = c.userChangedInSubtree(subtreeIds(r.target.node), args.base_rev);
            if (changed.length) throw new CanvasError(`${id} 在 base_rev 之后被用户修改过，请先 design_read 再写`, 'conflict', { changed });
          }
          if (r.target.component) comps.add(r.target.component);
          ops.push({ op: 'remove', id: r.target.node.id });
          affected.push({ id, type: r.target.node.type });
        }
        return { ops, affected, extra: comps.size ? { components_changed: [...comps] } : {} };
      }, args.note),
  );

  server.registerTool(
    'tokens_set',
    {
      title: '设置设计令牌',
      description: '新增、修改或删除（值为 null）设计令牌，如 {"color.primary":"#4f46e5","space.md":"16px","radius.md":"8px","font.body":"Inter"}。节点字段用 "{color.primary}" 引用；修改令牌全局生效。',
      inputSchema: { tokens: z.record(z.string(), z.string().nullable()) },
    },
    async (args) =>
      write(async (c) => {
        validateTokens(args.tokens);
        const undirected = needsDirection(c);
        const sys = c.meta.system ? loadSystem(c.meta.system.id) : undefined;
        const drift = sys ? Object.keys(args.tokens).filter((k) => k in flattenSystem(sys, c.meta.system!.theme) && flattenSystem(sys, c.meta.system!.theme)[k] !== args.tokens[k]) : [];
        return {
          ops: [{ op: 'set_tokens', tokens: args.tokens }],
          affected: Object.keys(args.tokens).map((k) => ({ id: `token:${k}`, type: 'token' })),
          ...(undirected
            ? { extra: { direction_reminder: '本画布还没有选定设计方向：这套令牌若出自你的习惯默认值，先调用 design_direction() 看方向卡片，选定后按其令牌调整。用户已明确指定配色与风格时可忽略。' } }
            : drift.length
              ? { extra: { system_drift: `${drift.slice(0, 6).join('、')} 与设计系统「${sys!.name}」不一致，只改了这个画布。这是对系统的有意调整时，改用 design_system({action:"update", patch}) 改系统本身，所有画布一起生效。` } }
              : {}),
        };
      }),
  );

  server.registerTool(
    'tweaks_set',
    {
      title: '设置可调节项（Tweaks）',
      description:
        '把设计令牌暴露成可随手调的控件，类似 Claude Design 的 Tweaks：用户在画布右侧“Tweaks”面板里拖滑块、取色、切换选项，直接改绑定的令牌；导出的 HTML 里也带一个浮动调节面板。整体替换现有列表，传空数组清除。' +
        '每项 {id, label, token, kind}：color（取色，如主色 color.primary）、range（滑块，需 min/max，可选 step/unit，如 radius.md 取 0–24 单位 px）、select（options:[{label,value}]，如字体 font.heading 的几种字体栈）、toggle（options 恰好两项，第一项为“关”，如亮/暗背景）。' +
        'token 必须已用 tokens_set 或设计系统定义；组件里要用 "{token}" 引用才会随之变化。挑 3–8 个最能改变整体气质的维度（主色、圆角、字体、密度、明暗），可用 group 分组。',
      inputSchema: {
        tweaks: z
          .array(
            z.object({
              id: z.string(),
              label: z.string(),
              token: z.string(),
              kind: z.enum(['color', 'range', 'select', 'toggle']),
              min: z.number().optional(),
              max: z.number().optional(),
              step: z.number().optional(),
              unit: z.string().optional(),
              options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
              group: z.string().optional(),
            }),
          )
          .max(40),
      },
    },
    async (args) =>
      write(async (c) => {
        const tweaks = validateTweaks(args.tweaks, c.doc.tokens);
        return { ops: [{ op: 'set_tweaks', tweaks }], affected: [{ id: 'tweaks', type: 'tweaks' }], extra: { count: tweaks.length } };
      }),
  );

  // ================= 读取 =================

  server.registerTool(
    'design_outline',
    {
      title: '设计稿大纲',
      description: '返回指定画板或节点下的大纲：id、类型、组件名、图层名、文本摘要、子节点数。depth 默认 2、最大 3；更深的部分按 id 继续读。不传参数时返回所有画板的顶层概览。组件实例不展开，用 design_read(component) 读取定义。',
      inputSchema: {
        frame_id: z.string().optional(),
        node_id: z.string().optional(),
        depth: z.number().int().min(0).max(3).optional(),
      },
    },
    async (args) =>
      read((c) => {
        const depth = args.depth ?? 2;
        const id = args.node_id ?? args.frame_id;
        if (!id) {
          return {
            rev: c.doc.rev,
            frames: c.doc.frames.map((f) => ({ id: f.id, name: f.name, width: f.width, height: f.height, outline: outlineNode(c.doc, f.root, Math.min(depth, 1)) })),
            components: Object.keys(c.doc.components),
          };
        }
        const r = resolveAddress(c.doc, id);
        const out = outlineNode(c.doc, r.target.node, depth);
        out.id = id;
        if (r.instance) {
          const fix = (o: Json) => {
            if (o !== out) o.id = childAddr(id, String(o.id));
            (o.children as Json[] | undefined)?.forEach(fix);
          };
          fix(out);
        }
        const frame = c.doc.frames.find((f) => f.id === id);
        return { rev: c.doc.rev, ...(frame ? { frame: { id: frame.id, name: frame.name, width: frame.width, height: frame.height } } : {}), outline: out };
      }),
  );

  server.registerTool(
    'design_read',
    {
      title: '读取节点或组件',
      description:
        '按节点 id 或组件名（二选一，必填）读取完整字段，保留令牌引用。depth 以内的后代完整给出，超出的只给存根。按组件名读取时额外返回各实例的 id 与 overrides。同时返回用到的令牌值、字体、图片本地路径和画布实测尺寸（computed）。用于把设计稿实现为代码。',
      inputSchema: {
        node_id: z.string().optional(),
        component: z.string().optional(),
        depth: z.number().int().min(0).max(10).optional().describe('默认 3'),
        include_hidden: z.boolean().optional(),
      },
    },
    async (args) =>
      read(async (c) => {
        if (!!args.node_id === !!args.component) throw new CanvasError('node_id 与 component 必须二选一');
        const o: ReadOpts = { depth: args.depth ?? 3, includeHidden: !!args.include_hidden, components: new Set(), addrs: [] };
        const doc = c.doc;
        const out: Json = { rev: doc.rev };
        const roots: Node[] = [];
        let measureAddrs: string[] = [];
        if (args.component) {
          const def = doc.components[args.component];
          if (!def) throw new CanvasError(`组件 ${args.component} 不存在。现有组件：${Object.keys(doc.components).join(', ') || '无'}`, 'not_found');
          out.component = args.component;
          out.node = readNode(doc, def.root, def.root.id, o.depth, o);
          roots.push(def.root);
          const insts = [...getIndex(doc).values()].filter((l) => l.node.component === args.component);
          out.instances = insts.map((l) => ({
            id: l.node.id,
            ...(l.frame ? { frame: l.frame.id } : { in_component: l.component }),
            ...(l.node.text !== undefined ? { text: l.node.text } : {}),
            ...(l.node.props ? { props: l.node.props } : {}),
            ...(l.node.overrides ? { overrides: l.node.overrides } : {}),
            ...(l.node.layout ? { layout: l.node.layout } : {}),
          }));
          const first = insts.find((l) => l.frame);
          if (first) {
            measureAddrs = [first.node.id];
            const sub: string[] = [];
            walkTree(def.root, (n) => n !== def.root && sub.push(`${first.node.id}:${n.id}`));
            measureAddrs.push(...sub.slice(0, 200));
          }
        } else {
          const r = resolveAddress(doc, args.node_id!);
          const ov = r.instance ? r.instance.node.overrides?.[r.instance.path] : undefined;
          out.node = readNode(doc, r.target.node, args.node_id!, o.depth, { ...o, includeHidden: true }, ov);
          roots.push(r.target.node);
          if (r.instance) out.instance_of = r.target.component;
          else if (r.target.component) out.in_component = r.target.component;
          const frames = framesOf(doc, r.target);
          if (frames.length) out.frame = frames[0];
          measureAddrs = r.target.frame || r.instance ? o.addrs.slice(0, 300) : [];
        }
        // 用到的组件：各展开一份定义
        const defs: Json = {};
        const queue = [...o.components].filter((n) => n !== args.component);
        const seen = new Set<string>(args.component ? [args.component] : []);
        while (queue.length) {
          const name = queue.shift()!;
          if (seen.has(name) || !doc.components[name]) continue;
          seen.add(name);
          const sub: ReadOpts = { ...o, components: new Set(), addrs: [] };
          defs[name] = readNode(doc, doc.components[name].root, doc.components[name].root.id, o.depth, sub);
          roots.push(doc.components[name].root);
          queue.push(...sub.components);
        }
        if (Object.keys(defs).length) out.components = defs;
        // 令牌、字体、资源
        const refs = new Set<string>();
        for (const r of roots) collectTokenRefs(r, refs);
        const tokens: Json = {};
        for (const t of refs) {
          const name = doc.tokens[t] !== undefined ? t : Object.keys(doc.tokens).find((k) => k.replace(/[^a-zA-Z0-9_-]/g, '-') === t);
          if (name) tokens[name] = doc.tokens[name];
          else tokens[t] = null;
        }
        if (Object.keys(tokens).length) out.tokens = tokens;
        const fonts = collectFonts(doc, roots);
        if (fonts.length) out.fonts = fonts;
        const assets: Json = {};
        for (const r of roots)
          walkTree(r, (n) => {
            for (const v of [n.props?.src, n.style?.backgroundImage, ...Object.values(n.overrides ?? {}).map((x) => x.props?.src)]) {
              const m = v && /^asset:([a-f0-9]+)$/.exec(v);
              if (m && doc.assets[m[1]]) assets[v!] = path.join(c.dir, 'assets', 'images', doc.assets[m[1]].file);
            }
          });
        if (Object.keys(assets).length) out.assets = assets;
        if (measureAddrs.length) {
          const sizes = await c.measure(measureAddrs);
          if (Object.keys(sizes).length)
            out.computed = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, { w: Math.round(v.width), h: Math.round(v.height) }]));
          else out.computed_note = '画布页面未在线，未返回实测尺寸';
        }
        return out;
      }),
  );

  server.registerTool(
    'design_changes',
    {
      title: '变更查询',
      description: '返回 since_rev 之后发生变化的节点 id 与字段（如 style.color、text、inserted、removed、overrides）。origin:"user" 只看用户在画布上的手动改动。续改前调用它，避免覆盖用户的调整；设计转代码时用于增量同步。',
      inputSchema: { since_rev: z.number().int().min(0), origin: z.enum(['ai', 'user']).optional() },
    },
    async (args) =>
      read((c) => {
        const list = c.changesSince(args.since_rev, args.origin as Origin | undefined);
        const idx = getIndex(c.doc);
        const enriched = list.slice(0, 300).map((ch) => {
          const loc = idx.get(ch.id.split(':')[0]);
          const node = ch.id.includes(':') ? idx.get(ch.id.split(':').pop()!)?.node : loc?.node;
          return {
            ...ch,
            ...(node ? { type: node.type, ...(node.component ? { component: node.component } : {}) } : ch.id.startsWith('token:') ? {} : { exists: false }),
            ...(loc?.component ? { in_component: loc.component } : {}),
          };
        });
        return { rev: c.doc.rev, since_rev: args.since_rev, changes: enriched, ...(list.length > 300 ? { truncated: list.length - 300 } : {}) };
      }),
  );

  server.registerTool(
    'design_screenshot',
    {
      title: '截图自检',
      description:
        '返回画板或节点的 PNG 与文字检查报告（溢出、越界、重叠、零尺寸、缺失字体、破损或被放大的图片、按钮 / tab 文字换行、指示条与图标文字未居中）。截整个画板时还附设计体检：字号是否在阶梯上、粗体与胶囊形状是否过多、卡片嵌套层数、同一张图重复使用、模板化的元信息写法等，这些是提醒而不是错误，逐条判断后修改或说明理由。带交互（proto）的画板还会自动探索点击 / 输入 / 计时后能到达的状态（最多 4 步、24 个）并逐个检查，报告各状态新增的问题（含选中态导致控件跳动的 state_shift）、永远不会显示的元素与无效跳转，有问题的状态附变化区域截图。每轮绘制结束前必须对改动过的画板调用；报告的问题全部修复后重新截图，并对照截图人工审查。全部画板自检后编辑锁释放。clicks / vars 查看指定状态（不改动文档，不计为自检）。客户端不支持图片时仅凭文字报告自检。',
      inputSchema: {
        frame_id: z.string().optional(),
        node_id: z.string().optional(),
        scale: z.number().min(0.1).max(3).optional().describe('默认按宽度自动（宽 ≤1600px）'),
        clicks: z
          .array(z.string())
          .max(20)
          .optional()
          .describe('查看指定状态：从初始状态起按顺序模拟点击这些节点（地址同 node_id）；"wait" 触发最早的延时 / 倒计时，"load" 执行 onLoad'),
        vars: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe('查看指定状态：覆盖状态变量（在 clicks 之后应用）'),
        states: z
          .enum(['auto', 'images', 'off'])
          .optional()
          .describe('交互状态检查：auto（默认）只给有问题的状态附图；images 每个状态都附图（最多 8 张）；off 不检查（带交互的画板此时不算完成自检）'),
      },
    },
    async (args) =>
      read(async (c) => {
        const target = args.node_id ?? args.frame_id ?? c.doc.frames[0]?.id;
        if (!target) throw new CanvasError('画布中还没有画板');
        resolveAddress(c.doc, target);
        await hub.ensureBrowser(c);
        const frame = c.doc.frames.find((f) => f.id === target);
        const frameId = frame?.id ?? findFrameOfAddr(c.doc, target);
        const host = frameId ? c.doc.frames.find((f) => f.id === frameId) : undefined;
        const scale = args.scale ?? Math.min(1, 1600 / (host?.width ?? 1600));

        // 指定状态：在隐藏画板中渲染，不改文档、不计为自检
        if (args.clicks?.length || args.vars) {
          if (!host) throw new CanvasError(`${target} 不在任何画板内`);
          let vars = frameVars(c.doc, host);
          let timers: string[] = [];
          if (args.clicks?.length) {
            let r;
            try {
              r = stateAfter(c.doc, host.id, args.clicks);
            } catch (e) {
              throw new CanvasError((e as Error).message);
            }
            if (r.nav) throw new CanvasError(`点击序列${navText(r.nav)}，离开了画板 ${host.id}；要查看目标页面请直接截图该画板`);
            vars = r.vars;
            timers = r.timers;
          }
          const unknown = Object.keys(args.vars ?? {}).filter((k) => !(k in vars));
          vars = { ...vars, ...args.vars };
          const [r] = await c.probe({ frame: host.id, states: [{ vars, parent: -1 }], images: 'all', dedupe: false, target, scale, maxImages: 1 });
          const head = `状态 vars ${fmtVars(vars)}${timers.length ? `，进行中：${timers.join('、')}` : ''}${unknown.length ? `\n注意：变量 ${unknown.join(', ')} 未在画板中声明` : ''}`;
          const text = formatReport(target, { width: r.width, height: r.height, nodes: 0, issues: r.issues }).replace(/，节点 0 个/, '');
          return {
            content: [
              ...(r.png ? [{ type: 'image', data: r.png, mimeType: 'image/png' }] : []),
              { type: 'text', text: `${head}\n${text}\n（查看指定状态不计为自检。）` },
            ],
          } as CallToolResult;
        }

        const shot = await c.screenshot(target, scale);
        let text = formatReport(target, shot.report);
        if (frame) {
          const notes = formatDesignNotes(designCheckup(c.doc, frame));
          if (notes) text += `\n\n${notes}`;
        }
        const extra: CallToolResult['content'] = [];
        let checked = !!frame;
        if (frame) {
          const ex = exploreFrame(c.doc, frame.id);
          const warnings = lintProto(c.doc, [frame.id]);
          if (ex.interactive || warnings.length) {
            if (args.states === 'off') {
              checked = !ex.interactive;
              if (ex.interactive) text += '\n未做交互状态检查（states:"off"）：带交互的画板要检查点击后的状态才算完成自检。';
            } else {
              const results =
                ex.states.length > 1
                  ? await c.probe({
                      frame: frame.id,
                      states: ex.states.map((st) => ({ vars: st.vars, parent: st.parent, click: st.step?.kind === 'click' ? st.step.addr : undefined })),
                      images: args.states === 'images' ? 'all' : 'issues',
                      dedupe: true,
                      scale,
                      maxImages: args.states === 'images' ? 8 : 4,
                    })
                  : [];
              const f = formatStates(ex, results, warnings);
              if (f.text) text += `\n\n${f.text}`;
              for (const im of f.images) extra.push({ type: 'text', text: `截图 ${im.label}` }, { type: 'image', data: im.png, mimeType: 'image/png' });
            }
          }
        }
        if (frame && checked) c.markChecked([frame.id]);
        const planned = c.lock?.session === ctx.id ? c.planOutstanding() : [];
        const tail =
          (c.pendingCheck.size ? `\n仍待自检的画板：${[...c.pendingCheck].join(', ')}` : '') +
          (planned.length ? `\n规划中尚未绘制的页面：${planned.join(', ')}（画完并自检后编辑锁才释放）` : '') +
          (!c.pendingCheck.size && !planned.length && frame ? doneText(c) : '') +
          (frame && checked ? openCommentsText(c, frame.id) : '');
        return {
          content: [{ type: 'image', data: shot.png, mimeType: 'image/png' }, { type: 'text', text: text + tail }, ...extra],
        } as CallToolResult;
      }),
  );

  // ================= 导出 =================

  server.registerTool(
    'design_export',
    {
      title: '导出 HTML',
      description: '把画板导出为可离线打开的单文件 HTML（不含字体），返回文件路径与所需字体清单。设计稿带 proto 交互时内嵌交互脚本，导出的页面可直接点击试用（tab 切换、倒计时、跳转等，与画布播放一致）；interactive:false 只输出初始状态、无脚本。默认导出第一个画板到画布目录 exports/。多画板生成带顶部切换条的单文件；split:true 或 inline_images:false 时输出 zip。',
      inputSchema: {
        frame_ids: z.array(z.string()).optional(),
        out_path: z.string().optional().describe('文件或目录；相对路径以当前工作目录为准'),
        inline_images: z.boolean().optional(),
        style_mode: z.enum(['class', 'inline']).optional(),
        width_mode: z.enum(['fixed', 'fill']).optional(),
        split: z.boolean().optional(),
        interactive: z.boolean().optional().describe('默认 true：执行交互逻辑'),
      },
    },
    async (args) =>
      read((c) => {
        const res = buildExport(c.doc, c.dir, {
          interactive: args.interactive,
          frameIds: args.frame_ids,
          inlineImages: args.inline_images,
          styleMode: args.style_mode,
          widthMode: args.width_mode,
          split: args.split,
        });
        let dest: string;
        if (args.out_path) {
          const p = path.resolve(ctx.cwd, args.out_path);
          dest = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, res.filename) : p;
        } else dest = path.join(c.dir, 'exports', res.filename);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, res.data);
        return { path: dest, bytes: res.data.length, frames: res.frames, fonts: res.fonts, warnings: res.warnings };
      }),
  );

  // ================= 资源 =================

  const tmpl = (kind: 'outline' | 'tokens') =>
    new ResourceTemplate(`design://{canvasId}/${kind}`, {
      list: async () => ({
        resources: hub.list().map((c) => ({ uri: `design://${c.id}/${kind}`, name: `${c.title} · ${kind}`, mimeType: 'application/json' })),
      }),
    });
  server.registerResource('outline', tmpl('outline'), { title: '设计稿大纲', mimeType: 'application/json' }, async (uri, vars) => {
    const c = hub.get(String(vars.canvasId));
    const data = { rev: c.doc.rev, frames: c.doc.frames.map((f) => ({ id: f.id, name: f.name, width: f.width, height: f.height, outline: outlineNode(c.doc, f.root, 2) })), components: Object.keys(c.doc.components) };
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data) }] };
  });
  server.registerResource('tokens', tmpl('tokens'), { title: '设计令牌', mimeType: 'application/json' }, async (uri, vars) => {
    const c = hub.get(String(vars.canvasId));
    return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(c.doc.tokens) }] };
  });

  return server;
}

/** 画布批注摘要：评论与带文字的便签逐条给出，圈画类只给位置与指向的节点。 */
/**
 * 多页面或带交互的稿子里，还没有 AI 说明批注的 UI 画板（箭头不算说明）。
 * 画板被重新声明（id 变了）时旧批注会失效，AI 也容易在补救过程中忘记重写，由服务端统一兜底。
 */
export function framesMissingNotes(c: Canvas): Array<{ id: string; name: string }> {
  const frames = c.doc.frames;
  if (frames.some(isDocFrame)) return [];
  if (frames.length < 2 && !frames.some((f) => exploreFrame(c.doc, f.id).interactive)) return [];
  const noted = new Set(c.notes.filter((n) => n.by === 'ai' && n.frame && n.kind !== 'arrow' && n.kind !== 'line').map((n) => n.frame));
  return frames.filter((f) => !noted.has(f.id)).map((f) => ({ id: f.id, name: f.name }));
}

/** 缺失交互说明时的提醒文字；都写了则为空串。 */
export function missingNotesHint(c: Canvas): string {
  const missing = framesMissingNotes(c);
  if (!missing.length) return '';
  const orphan = c.notes.filter((n) => n.by === 'ai' && n.frame && !c.doc.frames.some((f) => f.id === n.frame)).length;
  return (
    `这些画板还没有交互说明：${missing.map((f) => `${f.name}（${f.id}）`).join('、')}。` +
    '现在就调用 design_annotate：每个画板上方或下方写一个说明框（进入条件、主要操作、跳转去向、业务规则、交互状态），多页面之间画跳转箭头。' +
    (orphan ? `另有 ${orphan} 条旧说明指向已不存在的画板，用 design_annotate 的 clear 或 remove 清理。` : '')
  );
}

/** 全部画板自检完成时的结语：缺交互说明时不报“完成”，而是要求先补说明。 */
function doneText(c: Canvas): string {
  const hint = missingNotesHint(c);
  return hint
    ? `\n\n画板均已自检、编辑锁已释放，但本轮还没有完成，不要向用户汇报：${hint}写完说明才算完成。`
    : '\n所有改动过的画板均已自检，编辑锁已释放。';
}

/** 自检通过的画板上仍未关闭的用户评论：提醒 AI 确认已改好后关闭。 */
function openCommentsText(c: Canvas, frameId: string): string {
  const frameOf = (a: Annotation) => a.frame ?? (a.anchorNote ? c.notes.find((x) => x.id === a.anchorNote)?.frame : undefined);
  const open = c.notes.filter((a) => a.kind === 'comment' && a.by !== 'ai' && frameOf(a) === frameId && a.n);
  if (!open.length) return '';
  const list = open.map((a) => `#${a.n}「${(a.text ?? '').slice(0, 40)}」`).join('、');
  return `\n该画板上还有未关闭的用户评论：${list}。逐条对照截图确认已按评论改好后，用 design_annotate({resolve:[${open.map((a) => a.n).join(', ')}]}) 关闭；没改好的继续修改，不处理的保留并向用户说明。`;
}

function summarizeNotes(c: Canvas): Json {
  if (!c.notes.length) return {};
  const frameName = (id?: string) => (id ? c.doc.frames.find((f) => f.id === id)?.name : undefined);
  const nodeInfo = (addr?: string) => {
    if (!addr) return {};
    try {
      const n = resolveAddress(c.doc, addr).target.node;
      return { node: addr, node_type: n.type, ...(n.name ? { node_name: n.name } : {}) };
    } catch {
      return { node: addr, node_missing: true };
    }
  };
  const where = (a: Annotation) => ({
    ...(a.frame ? { frame: a.frame, frame_name: frameName(a.frame) } : {}),
    ...nodeInfo(a.anchor),
    at: a.pts[0].map(Math.round),
  });
  const LABEL: Record<string, string> = { note: '便签', text: '文字', pen: '手绘', path: '钢笔路径', rect: '矩形框', oval: '椭圆圈', round: '圆角框', diamond: '菱形', line: '直线', arrow: '箭头' };
  const boxOf = (a: Annotation) => {
    // 钢笔路径含两侧控制柄（与画布上的包围盒一致）
    const pts = a.kind === 'path' && a.ctrl ? a.pts.flatMap(([x, y], i) => { const [cx, cy] = a.ctrl![i] ?? [0, 0]; return [[x, y], [x + cx, y + cy], [x - cx, y - cy]]; }) : a.pts;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map(Math.round);
  };
  const mark = (a: Annotation) => ({ kind: LABEL[a.kind] ?? a.kind, ...(a.text ? { text: a.text } : {}), ...where(a), ...(a.pts.length > 1 ? { box_xywh: boxOf(a) } : {}), ...(a.kind === 'path' && a.closed ? { closed: true } : {}), ...(a.color ? { color: a.color } : {}) });
  // 关联到批注（笔迹 / 形状）的评论：给出该批注的摘要，偏移相对其包围盒左上角
  const onNote = (a: Annotation) => {
    const t = c.notes.find((x) => x.id === a.anchorNote);
    return {
      ...(a.frame ? { frame: a.frame, frame_name: frameName(a.frame) } : {}),
      // 图钉跟随批注：位置按批注当前包围盒 + 偏移计算
      at: t && a.rel ? [boxOf(t)[0] + a.rel[0], boxOf(t)[1] + a.rel[1]].map(Math.round) : a.pts[0].map(Math.round),
      ...(t ? { on_annotation: { id: t.id, ...mark(t) } } : { annotation: a.anchorNote, annotation_missing: true }),
      ...(a.rel ? { offset_in_annotation: a.rel.map(Math.round) } : {}),
    };
  };
  const ai = c.notes.filter((a) => a.by === 'ai');
  const user = c.notes.filter((a) => a.by !== 'ai');
  const comments = user
    .filter((a) => a.kind === 'comment' && a.text)
    .map((a) => ({ n: a.n, text: a.text, ...(a.anchorNote ? onNote(a) : { ...where(a), ...(a.rel ? { offset_in_node: a.rel.map(Math.round) } : {}) }) }));
  const linked = new Set(c.notes.map((a) => a.anchorNote).filter(Boolean));
  const marks = user.filter((a) => a.kind !== 'comment').map((a) => ({ ...(linked.has(a.id) ? { id: a.id } : {}), ...mark(a) }));
  return {
    ...(ai.length ? { ai_annotations: ai.map((a) => ({ id: a.id, ...mark(a), ...(a.pts.length > 1 ? { from: a.pts[0].map(Math.round), to: a.pts[a.pts.length - 1].map(Math.round) } : {}) })), ai_annotations_hint: '这些是你（AI）之前用 design_annotate 写的说明批注，不是用户意见；页面改动后用 design_annotate 同步更新或删除' } : {}),
    ...(comments.length ? { comments, comments_hint: '按评论改完并 design_screenshot 自检、确认已改好后，用 design_annotate({resolve:[n]}) 关闭对应评论；未处理的保留' } : {}),
    ...(marks.length ? { annotations: marks, annotations_hint: '坐标为相对所在画板左上角的 px；箭头从第一个点指向最后一个点' } : {}),
  };
}
