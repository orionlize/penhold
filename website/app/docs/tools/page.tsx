import { docMeta } from '../nav';
import { DocHead, H2, Note, Table } from '../ui';

export const metadata = docMeta('tools');

type Row = [string, string, string];

const GROUPS: { id: string; title: string; intro: string; rows: Row[] }[] = [
  {
    id: 'session',
    title: '会话与需求',
    intro: '绑定画布、了解画布当前状态、向用户提问。',
    rows: [
      ['canvas_open', '绑定或恢复画布并在浏览器打开，返回画布 id、画板、组件、令牌和设计规范路径。上下文里已有 canvas_id 时务必传入；同时列出同项目其他画布的页面（project_canvases）。已绑定时传另一个画布即换画布。', 'canvas_id · new · title · brief'],
      ['canvas_status', '读取用户的选区、评论、便签、手绘与 AI 自己写过的批注，以及还缺业务说明的画板。', 'ai_notes（brief / full）'],
      ['design_ask', '在画布上展示需求问卷并等待回答，返回 answered / waiting / skipped。', 'title · intro · questions（最多 8 题） · wait_seconds'],
      ['design_plan', '声明本轮要画的全部页面，立即建好空画板并显示骨架屏；返回页面类型规范与方向卡片。', 'pages[{name, width, height, sections, frame_id}] · enough_info · user_style'],
    ],
  },
  {
    id: 'basis',
    title: '设计依据',
    intro: '选方向、匹配预设、管理设计系统、找图。',
    rows: [
      ['design_direction', '不带参数时换一批方向卡片；pick 选定一张，返回完整令牌并记到画布。', 'pick · concept · motif · primary · brief'],
      ['design_preset', '按需求匹配 192 种产品类型预设；id + use 选定；不带参数返回内置规范全文。', 'query · id · use'],
      ['design_system', '设计系统的读取、创建、导入、安装、切换主题、更新、保存组件、导出与审计。', 'action（get / list / create / import / install / theme / update / save_components / export / audit） · id · name · from · path · theme · modes · schemes · styles'],
      ['design_image', '从 Openverse 搜索可商用的 CC 授权图片，返回地址、尺寸、授权和署名。', 'query（英文名词短语） · count · orientation · min_width'],
      ['tokens_set', '新增、修改或删除（值为 null）设计令牌。有设计系统时优先用 design_system update。', 'tokens{"color.primary": "#…"}'],
      ['tweaks_set', '把令牌暴露成 Tweaks 控件：color / range / select / toggle。', 'tweaks[{id, label, token, kind, min, max, step, unit, options}]'],
    ],
  },
  {
    id: 'write',
    title: '绘制',
    intro: '写工具都可以带 note，显示在画布的 AI 光标旁。',
    rows: [
      ['frame_create', '新建画板，可同时给出根节点；传 from 时把同项目旧画布的页面复制过来（连同组件、图片与令牌）。已在 design_plan 中声明的页面不要再建。', 'name · width · height · root · index · from{canvas_id, frame_id}'],
      ['frame_update', '修改画板名称或尺寸。', 'frame_id · name · width · height'],
      ['frame_delete', '删除画板及全部节点。', 'frame_id'],
      ['node_insert', '在父节点下插入一棵或多棵子树，一次插入整块区域；子树可写成 JSON 或更短的 JSX；校验失败整次不生效。', 'parent_id · index · nodes | jsx · base_rev'],
      ['node_replace', '用新子树整体替换节点，保持位置；JSX 里带 keepChildren 的元素沿用原有子节点；带 base_rev 时若用户改过则拒绝。', 'node_id · node | jsx · base_rev'],
      ['node_update', '批量修改节点的 layout / box / style / props / states / proto / text / 显隐。', 'updates[{node_id, …}]'],
      ['node_move', '调整父节点或同级顺序。', 'node_id · parent_id · index'],
      ['node_delete', '删除一个或多个节点及其子树。', 'node_ids · base_rev'],
      ['design_annotate', '在画板外写说明框、文字、箭头与连线；用 Mermaid 写整条流程时由服务端排版，箭头不穿过画板；关闭已处理的用户评论。端点可以指向其他画布页面的引用卡片（frame 写 "<画布 id>/<画板 id>"）。', 'add[{kind, frame, at, from, to, via, text, width}] · flow{mermaid, at} · remove · clear · resolve'],
      ['design_lint_fix', '把设计提醒里阶梯外的字号、间距、圆角和与令牌同值的色值自动换成最接近的令牌；可先预览改动。', 'frame_id · kinds · dry_run'],
    ],
  },
  {
    id: 'read',
    title: '读取与自检',
    intro: '读稿、看用户改了什么、截图检查、导出。',
    rows: [
      ['design_outline', '画板或节点下的大纲（id、类型、组件名、文本摘要）。', 'frame_id · node_id · depth（≤3） · canvas_id（只读查看其他画布）'],
      ['design_read', '读取节点或组件定义的完整内容；format:"jsx" 时以 JSX 返回，可改写后传回 node_replace。', 'node_id · component · depth · include_hidden · format · canvas_id'],
      ['design_changes', '返回某个版本号之后变化的节点与字段；origin:"user" 只看用户的手动改动。', 'since_rev · origin'],
      ['design_screenshot', '截图并附渲染检查、设计提醒与交互状态检查，并与上一次截图做像素对比；也可以模拟点击查看指定状态。', 'frame_id · node_id · scale · states · clicks · vars'],
      ['design_export', '导出为单文件 HTML 或 zip。', 'frame_ids · out_path · split · interactive · inline_images · style_mode · width_mode'],
    ],
  },
];

export default function Tools() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 参考"
        title="MCP 工具"
        lede="Penhold 提供 25 个 MCP 工具。通常不需要你直接调用，AI 会按服务说明里的流程使用它们；这里列出来方便你理解 AI 在做什么、写提示词时点名。"
      />
      <Note>参数以服务端为准：客户端的工具列表里能看到每个参数的完整说明与取值范围。</Note>
      {GROUPS.map((g) => (
        <section key={g.id}>
          <H2 id={g.id}>{g.title}</H2>
          <p>{g.intro}</p>
          <Table
            head={['工具', '作用', '主要参数']}
            rows={g.rows.map(([n, d, a]) => [<code key="n">{n}</code>, d, <span key="a" className="mono-sm muted">{a}</span>])}
          />
        </section>
      ))}

      <H2 id="ids">节点地址</H2>
      <ul>
        <li>画板 id 同时是根节点 id，可以作为 node_insert 的 parent_id。</li>
        <li>
          组件实例内部的节点写成 <code>实例id:内部id</code>。改它的文本 / 图片写入该实例的覆盖值，改盒模型 / 样式写入组件定义，所有实例同步变化。
        </li>
        <li>
          节点字段用 <code>{'{color.primary}'}</code> 引用令牌。
        </li>
      </ul>
    </>
  );
}
