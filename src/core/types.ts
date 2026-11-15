// 设计稿数据模型（PRD 第 3 节）。前后端共用。

/** 数值（px）或字符串：令牌引用 "{color.primary}"、百分比 "50%"、"auto"、"fill"、"fit"。 */
export type Len = number | string;
/** 四边间距：统一值、[纵, 横]、[上, 右, 下, 左]。 */
export type Spacing = Len | [Len, Len] | [Len, Len, Len, Len];

export interface Layout {
  display?: 'flex' | 'grid' | 'block';
  direction?: 'row' | 'column';
  wrap?: boolean;
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  gap?: Len;
  rowGap?: Len;
  columns?: number | string; // grid：列数或模板，如 "1fr 2fr"
  rows?: number | string;
  grow?: number;
  shrink?: number;
  basis?: Len;
  alignSelf?: 'auto' | 'start' | 'center' | 'end' | 'stretch';
  position?: 'flow' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  top?: Len;
  right?: Len;
  bottom?: Len;
  left?: Len;
  zIndex?: number;
  overflow?: 'visible' | 'hidden' | 'scroll';
}

export interface Border {
  width?: Spacing; // 单值，或 [纵, 横] / [上, 右, 下, 左]
  style?: 'solid' | 'dashed' | 'dotted' | 'none';
  color?: string;
  sides?: Array<'top' | 'right' | 'bottom' | 'left'>; // 缺省四边
}

export interface Box {
  width?: Len;
  height?: Len;
  minWidth?: Len;
  maxWidth?: Len;
  minHeight?: Len;
  maxHeight?: Len;
  margin?: Spacing;
  padding?: Spacing;
  border?: Border;
  radius?: Len | [Len, Len, Len, Len]; // 左上、右上、右下、左下
}

export interface Style {
  fontFamily?: string;
  fontSize?: Len;
  fontWeight?: number | string;
  fontStyle?: 'normal' | 'italic';
  lineHeight?: Len;
  letterSpacing?: Len;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textDecoration?: 'none' | 'underline' | 'line-through';
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  whiteSpace?: 'normal' | 'nowrap' | 'pre-wrap';
  listStyle?: 'none' | 'disc' | 'decimal'; // 文本按行渲染为列表项
  color?: string;
  background?: string; // 颜色、渐变或令牌
  backgroundImage?: string; // asset:<hash>
  backgroundSize?: 'cover' | 'contain' | 'auto';
  objectFit?: 'cover' | 'contain' | 'fill';
  shadow?: string; // 投影（CSS box-shadow 值）
  innerShadow?: string; // 内阴影（box-shadow 值，不含 inset）
  textShadow?: string; // 文字阴影（CSS text-shadow 值）
  opacity?: number;
  blur?: Len; // 图层模糊
  backdropBlur?: Len; // 背景模糊
  transform?: string; // CSS transform，如 "rotate(8deg) scale(1.05)"
  cursor?: 'default' | 'pointer' | 'text';
  /** 文本样式（语义层级），选择时带出默认字号，见 TEXT_STYLES。 */
  textStyle?: TextStyle;
  /** 自定义 CSS：{"mix-blend-mode": "multiply"}；已由其它字段管理的属性不可写（见 customCss.ts）。 */
  css?: Record<string, string>;
}

/** 文本样式 → 默认字号（px），顺序即面板下拉顺序。 */
export const TEXT_STYLES = {
  heading1: 48,
  heading2: 34,
  heading3: 28,
  heading4: 22,
  button: 16,
  heading5: 18,
  heading6: 16,
  strong: 16,
  heading7: 14,
  heading8: 14,
  label: 14,
  body: 16,
  link: 14,
  caption: 12,
} as const;
export type TextStyle = keyof typeof TEXT_STYLES;

export type RenderKind = 'container' | 'text' | 'image' | 'input';

export interface Override {
  text?: string;
  props?: Record<string, string>;
  hidden?: boolean;
}

/** 交互状态变量的值。 */
export type ProtoValue = string | number | boolean;

/** 交互动作（播放时执行）。表达式语法见 src/core/proto.ts。 */
export type ProtoAction =
  | { do: 'set'; var: string; value?: ProtoValue; expr?: string }
  | { do: 'toggle'; var: string }
  | { do: 'countdown'; var: string; from: number; interval?: number; then?: ProtoAction[] }
  | { do: 'stop'; var: string }
  | { do: 'navigate'; frame: string }
  | { do: 'back' }
  | { do: 'open'; url: string }
  | { do: 'delay'; ms: number; then: ProtoAction[] }
  | { do: 'if'; when: string; then?: ProtoAction[]; else?: ProtoAction[] };

/**
 * 原型交互：画板内共享一组状态变量（vars 可声明在任意节点上，进入画板时重置为初值），
 * 节点按表达式决定显隐、禁用、条件样式，文本可用 {{表达式}} 插值。
 */
export interface Proto {
  vars?: Record<string, ProtoValue>;
  onClick?: ProtoAction[];
  /** 进入画板时执行（如启动页 2 秒后跳转）。 */
  onLoad?: ProtoAction[];
  /** 表达式为真时显示，否则隐藏。 */
  show?: string;
  /** 表达式为真时点击无效（不冒泡到外层）。 */
  disabled?: string;
  /** 条件样式：按顺序叠加所有条件为真的 style。 */
  styles?: Array<{ when: string; style: Style }>;
  /** 输入框：输入内容实时写入该变量。 */
  bind?: string;
}

export interface Node {
  id: string;
  type: string;
  render?: RenderKind;
  name?: string;
  component?: string;
  overrides?: Record<string, Override>;
  layout?: Layout;
  box?: Box;
  style?: Style;
  props?: Record<string, string>;
  text?: string;
  states?: { hover?: Style; focus?: Style; active?: Style };
  proto?: Proto;
  children?: Node[];
  meta?: { locked?: boolean; hidden?: boolean };
}

export interface ComponentDef {
  name: string;
  root: Node;
}

export interface Frame {
  id: string;
  name: string;
  width: number;
  height: number | 'auto';
  root: Node;
}

export interface AssetRef {
  hash: string;
  file: string; // assets/images/ 下的文件名
  mime: string;
  width?: number;
  height?: number;
  source?: string; // 原始来源（URL 或文件名）
}

/**
 * Tweak（参照 Claude Design 的 Tweaks）：把一个设计令牌暴露成可随手调的控件。
 * 控件的值就是令牌的值：画布里调节会改令牌（可撤销），导出的 HTML 里则带一个浮动调节面板。
 */
export interface Tweak {
  id: string;
  label: string;
  /** 绑定的令牌名，如 color.primary、radius.md、font.heading。 */
  token: string;
  /** color 取色；range 滑块（数值 + unit）；select 在 options 里选一个值；toggle 在两个值之间切换。 */
  kind: 'color' | 'range' | 'select' | 'toggle';
  /** range：范围、步长与单位（令牌值 = 数值 + unit）。 */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** select / toggle：可选值（toggle 恰好两项，第一项为“关”）。 */
  options?: Array<{ label: string; value: string }>;
  /** 面板里的分组名。 */
  group?: string;
}

export interface DesignDoc {
  schemaVersion: 1;
  canvasId: string;
  rev: number;
  tokens: Record<string, string>;
  /** 可调节项（Tweaks）。 */
  tweaks?: Tweak[];
  components: Record<string, ComponentDef>;
  frames: Frame[];
  assets: Record<string, AssetRef>;
}

/** 画布装的设计系统与当前主题（Tweaks 面板的主题切换用）。 */
export interface ThemeInfo {
  system: string;
  theme: string;
  themes: Array<{ id: string; name: string; scheme?: string; mode?: 'light' | 'dark'; swatch?: string }>;
}

export type Origin = 'ai' | 'user';

/** 节点上可整体设置的字段组。 */
export type FieldGroup = 'layout' | 'box' | 'style' | 'props' | 'text' | 'name' | 'meta' | 'states' | 'render' | 'type' | 'component' | 'overrides' | 'proto';

/**
 * 原子操作。所有 id 都是文档中的真实节点 id（画板节点或组件定义内节点），
 * 实例内部节点的差异用 set_override 表达。
 */
export type Op =
  | { op: 'insert'; parent: string; index: number; node: Node }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; parent: string; index: number }
  | { op: 'set'; id: string; field: FieldGroup; value: unknown } // value 为 undefined 表示清除
  | { op: 'set_override'; id: string; path: string; value: Override | undefined }
  | { op: 'set_tokens'; tokens: Record<string, string | null> }
  | { op: 'set_tweaks'; tweaks: Tweak[] }
  | { op: 'component_define'; def: ComponentDef }
  | { op: 'component_remove'; name: string }
  | { op: 'frame_create'; frame: Frame; index: number }
  | { op: 'frame_update'; id: string; name?: string; width?: number; height?: number | 'auto' }
  | { op: 'frame_remove'; id: string }
  | { op: 'asset_add'; asset: AssetRef }
  | { op: 'doc_replace'; doc: Omit<DesignDoc, 'rev'> };

export interface Transaction {
  rev: number;
  origin: Origin;
  ts: number;
  ops: Op[];
  inverse: Op[]; // 逆序可直接应用
  session?: string; // AI 会话 id 或 'user'
  round?: number; // AI 持锁轮次
  kind?: 'normal' | 'undo' | 'redo' | 'revert_ai' | 'restore';
}

/** 画布页面与守护进程之间的 WebSocket 消息。 */
export type ServerMsg =
  | { t: 'init'; doc: DesignDoc; lock: LockInfo | null; pages?: PlanPage[]; ui: UiState; title: string; userUndo: number; userRedo: number; aiRound: boolean; userBase: Record<string, unknown>; notes: Annotation[]; brief?: BriefForm | null; themeInfo?: ThemeInfo | null }
  | { t: 'themeInfo'; info: ThemeInfo | null }
  | { t: 'brief'; form: BriefForm | null }
  | { t: 'notes'; notes: Annotation[] }
  | { t: 'tx'; rev: number; origin: Origin; ops: Op[]; userUndo: number; userRedo: number; aiRound: boolean; userBase: Record<string, unknown> }
  | { t: 'lock'; lock: LockInfo | null; /** 没有锁时：空闲超时后暂存的规划页面（画板保留，等 AI 继续）。 */ pages?: PlanPage[] }
  | { t: 'flush'; reqId: string }
  | { t: 'shot'; reqId: string; target: string; scale: number }
  | { t: 'measure'; reqId: string; ids: string[] }
  | { t: 'probe'; reqId: string; req: ProbeRequest }
  | { t: 'error'; message: string; reqId?: string }
  | { t: 'title'; title: string };

export type ClientMsg =
  | { t: 'tx'; ops: Op[]; reqId?: string }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'revert_ai' }
  | { t: 'set_theme'; theme: string }
  | { t: 'unlock' }
  | { t: 'flushed'; reqId: string }
  | { t: 'shot_result'; reqId: string; png?: string; report?: ShotReport; error?: string }
  | { t: 'measure_result'; reqId: string; sizes: Record<string, ComputedSize> }
  | { t: 'probe_result'; reqId: string; results?: ProbeResult[]; error?: string }
  | { t: 'ui'; ui: Partial<UiState> }
  | { t: 'note_put'; note: Annotation }
  | { t: 'note_del'; id: string }
  | { t: 'brief_answer'; id: string; answers: BriefAnswers; skipped?: boolean }
  | { t: 'brief_reroll'; id: string };

/** 需求问卷（design_ask）：AI 在信息不足时发到画布上，用户填写后提交。 */
export interface BriefOption {
  value: string;
  label: string;
  hint?: string;
  /** 色块（#RRGGBB），用于视觉方向与颜色选项。 */
  swatch?: string[];
}
export interface BriefQuestion {
  id: string;
  label: string;
  help?: string;
  kind: 'single' | 'multi' | 'text';
  options?: BriefOption[];
  placeholder?: string;
  /** 选项之外允许填写其他内容。 */
  other?: boolean;
  multiline?: boolean;
  /** 选项可“换一批”（视觉方向）。 */
  reroll?: boolean;
}
export interface BriefForm {
  id: string;
  title: string;
  intro?: string;
  questions: BriefQuestion[];
}
/** 题目 id → 选中的选项值或填写的文字。 */
export type BriefAnswers = Record<string, string | string[]>;

/**
 * 画布批注：评论、便签、手绘与形状。不属于设计稿（不进入导出与撤销栈），
 * 用于用户向 AI 指示意图；AI 通过 canvas_status 读取。
 */
export type AnnotationKind = 'comment' | 'note' | 'text' | 'pen' | 'path' | 'rect' | 'oval' | 'round' | 'diamond' | 'line' | 'arrow';
export type StrokeDash = 'solid' | 'dashed' | 'dotted';
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  /** 坐标相对该画板左上角；缺省为画布世界坐标。 */
  frame?: string;
  /** 创建时指向的节点地址。 */
  anchor?: string;
  /** 评论关联的批注（铅笔 / 钢笔笔迹或形状）id；与 anchor 二选一。 */
  anchorNote?: string;
  /** 评论相对 anchor 节点（或 anchorNote 批注包围盒）左上角的偏移（px）；目标移动或尺寸变化时图钉跟随。 */
  rel?: [number, number];
  /** comment/note/text 1 个点；形状与线条 2 个点（起止）；铅笔为折线；钢笔路径为锚点。 */
  pts: Array<[number, number]>;
  /** 钢笔路径：每个锚点的出方向控制柄（相对锚点的偏移，入方向为其镜像）；[0,0] 为尖角。与 pts 等长。 */
  ctrl?: Array<[number, number]>;
  /** 钢笔路径是否闭合。 */
  closed?: boolean;
  /** 铅笔 / 钢笔线宽（px，屏幕像素，不随缩放变化）；缺省 2.5。 */
  width?: number;
  /** 铅笔 / 钢笔颜色（#RRGGBB）；缺省为批注红。 */
  color?: string;
  /** 铅笔 / 钢笔线型；缺省 solid。 */
  dash?: StrokeDash;
  text?: string;
  /** 评论编号（服务端分配）。 */
  n?: number;
  /** 作者：'ai' 为 AI 通过 design_annotate 写的说明批注；缺省为用户。 */
  by?: 'ai';
  /** 便签 / 文字的宽度（px）；缺省便签 160、文字自适应。 */
  w?: number;
  ts: number;
}

export interface LockInfo {
  session: string;
  since: number;
  pendingFrames: string[];
  /** 本轮用 design_plan 声明的页面（按声明顺序）。 */
  pages?: PlanPage[];
  /** AI 光标：最近一次写入所在的画板与节点。 */
  cursor?: AiCursor | null;
}

/**
 * 规划页面的状态：pending 待绘制 · drawing 绘制中（光标所在）· unchecked 已画待自检
 * · checking 自检截图中 · done 已自检。
 */
export type PageStatus = 'pending' | 'drawing' | 'unchecked' | 'checking' | 'done';

export interface PlanPage {
  frame: string;
  name: string;
  status: PageStatus;
  /** 画板根下还没有任何节点（骨架屏只在空画板上显示）。 */
  empty: boolean;
  /** AI 预告的页面区块，用于绘制更贴近结构的骨架。 */
  sections?: string[];
}

export interface AiCursor {
  frame: string;
  /** 最近写入的节点地址（画板 id 表示画板本身）。 */
  addr: string;
  /** checking：正在截图自检该画板。 */
  status: 'drawing' | 'checking';
  /** AI 在写工具中附带的简短说明，如“顶部导航”。 */
  note?: string;
  /** 最近一次活动的时间戳；前端据此在空闲时显示“思考中”。 */
  at: number;
}

export interface UiState {
  zoom: number;
  panX: number;
  panY: number;
  selection: string[];
  panels: Record<string, boolean>;
}

export interface ComputedSize {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShotIssue {
  kind: 'overflow' | 'out_of_parent' | 'overlap' | 'zero_size' | 'missing_font' | 'broken_image' | 'low_res_image' | 'frame_overflow' | 'text_wrap' | 'misaligned' | 'state_shift' | 'low_contrast' | 'small_target';
  id: string;
  detail: string;
}

/** 交互状态检查：在隐藏的 iframe 中按给定状态变量逐个渲染并检查。 */
export interface ProbeState {
  vars: Record<string, ProtoValue>;
  /** 由哪个状态（下标）经一步操作得到；初始状态为 -1。 */
  parent: number;
  /** 这一步点击的节点地址（用于检查被点控件及其同级是否跳动）。 */
  click?: string;
}

export interface ProbeRequest {
  frame: string;
  states: ProbeState[];
  /** none：只回文字；issues：有新问题的状态附图；all：每个状态都附图。 */
  images: 'none' | 'issues' | 'all';
  /** 去掉与第一个状态相同的问题（第一个状态为基线，不返回问题）。 */
  dedupe: boolean;
  /** 截图目标节点（缺省为整个画板，按变化区域裁切）。 */
  target?: string;
  scale: number;
  maxImages: number;
}

export interface ProbeResult {
  issues: ShotIssue[];
  png?: string;
  /** 附图裁切区域（画板坐标）；整页时缺省。 */
  region?: { x: number; y: number; width: number; height: number };
  /** 与上一状态相比显隐、位置或文字变化的节点数。 */
  changed: number;
  width: number;
  height: number;
}

export interface ShotReport {
  width: number;
  height: number;
  nodes: number;
  issues: ShotIssue[];
}
