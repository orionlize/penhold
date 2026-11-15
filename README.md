# penhold-mcp

本地 AI 设计画布：AI 通过 MCP 工具绘制、修改、读取 UI 稿；用户在浏览器画布中微调盒模型与样式；可导出单文件 HTML。方案见 [docs/PRD.md](docs/PRD.md)。

## 快速开始

```bash
npm install
npm run build        # 编译服务端（dist/server）与画布前端（dist/web）
npm test
```

在 Claude Code 中注册（其他支持 stdio 的 MCP 客户端同理）：

```bash
claude mcp add design -- node /绝对路径/penhold-mcp/dist/server/cli.js
```

发布到 npm 后即为 `npx penhold-mcp`。首次调用时 stdio 代理会自动拉起守护进程（默认端口 4470，占用时递增），AI 调用绘制工具时自动用默认浏览器打开画布。

也可直连守护进程的 Streamable HTTP 端点 `http://127.0.0.1:<port>/mcp`，请求头带 `Authorization: Bearer <token>`（端口与令牌见 `~/.penhold/daemon.json`）。

### 可选：宿主会话别名（Claude Code SessionStart hook）

让同一个 Claude Code 会话在上下文被压缩后仍能自动找回画布：在 `.claude/settings.json` 中加入

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node /绝对路径/penhold-mcp/dist/server/cli.js hook" }] }]
  }
}
```

### 命令

| 命令 | 作用 |
| --- | --- |
| `penhold-mcp` | stdio MCP 服务（薄代理） |
| `penhold-mcp daemon` | 前台运行守护进程 |
| `penhold-mcp open [canvasId]` | 打开画布首页或指定画布 |
| `penhold-mcp hook` | SessionStart hook，从 stdin 读取会话 JSON |

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `DESIGN_MCP_HOME` | 数据目录，默认 `~/.penhold`（旧版的 `~/.design-mcp` 首次运行时自动迁移过来） |
| `DESIGN_MCP_PORT` | 起始端口，默认 4470 |
| `DESIGN_MCP_CANVAS` | 固定绑定某个画布（绑定规则第 3 条） |
| `DESIGN_MCP_NO_BROWSER=1` | 不自动打开浏览器（手动打开 URL） |
| `DESIGN_MCP_BROWSER_TIMEOUT_MS` | 写工具等待画布页面连接的超时，默认 20000 |
| `DESIGN_MCP_GUIDES` | 额外的设计规范文件或目录（多个用 `:` 分隔，相对路径按项目目录解析），会排在 `design_guides` 最前 |
| `DESIGN_MCP_IDLE_MS` | 守护进程空闲退出时间，默认 30 分钟 |
| `DESIGN_MCP_PLAN_IDLE_MS` | 有未开始的规划页面时编辑锁的空闲超时，默认 120000 |
| `DESIGN_MCP_IMAGES` | 设为 `off` 关闭 `design_image` 图片搜索（搜索词会发送给 Openverse 图库，免密钥，CC 授权图片） |
| `DESIGN_MCP_ASK_WAIT_MS` | `design_ask` 单次调用等待用户回答问卷的时间，默认 50000 |

### 界面语言

画布界面支持中文与英文：浏览器语言为中文（`zh-*`）时显示中文，其余显示英文。在地址后加 `?lang=zh` 或 `?lang=en` 可手动切换（会记在浏览器 localStorage `dm-lang` 中）。文案位于 `web/src/locales/`，新增文案先加到 `zh.ts`（键集合以其为准），再在 `en.ts` 补齐，否则类型检查不通过。

## 代码结构

```text
src/core/        前后端共用：数据模型、schema 校验、操作与逆操作、编辑翻译、渲染器
src/server/      守护进程：文档引擎(canvas.ts)、注册表与绑定、MCP 工具(mcp.ts)、HTTP/WS、导出
src/proxy.ts     stdio 薄代理（守护进程重启后自动重放握手）
src/hook.ts      宿主会话 hook
web/src/         画布前端：iframe 渲染与增量更新、选中与盒模型覆盖层、属性面板、图层树、页面内截图与渲染检查
guides/          内置设计规范（default/SKILL.md）、页面类型规范片段（pages/*.md）、设计方向示例稿（examples/*.json）与产品类型预设目录（catalog.json）
website/         官网（Next.js，独立依赖，部署见 website/README.md）
scripts/         开发辅助：import-presets.ts 生成内置预设目录，build-examples.ts 生成各设计方向的示例稿，open.ts 新建画布、call.ts 调用单个工具、e2e-login.ts 端到端出稿演示、e2e-plan.ts 页面规划与绘制过程演示，e2e-states.ts 交互状态检查演示
```

## 与 PRD 的差异与补充约定

- **字体只用本机已安装的**：设计方向（`design_direction`）生成字体令牌前先检测本机字体（Linux / macOS 用 `fc-list`，macOS 无 fontconfig 时用 `system_profiler`，Windows 读注册表），目录里没安装的西文字体会从字体栈中去掉；标题按风格原型取宋体、楷体、圆体或黑体，本机没有该类字体时依次回退。检测不到时沿用目录字体加通用中文回退。
- **字体令牌与嵌入令牌**：`fontFamily: "{font.heading}"` 渲染为 `var(--font-heading)`（令牌值按字体族列表输出）；颜色、渐变、阴影的值里可以嵌入令牌，如 `linear-gradient(90deg, {color.primary}, {color.accent})`。
- **方向示例稿**：`guides/examples/<原型 id>.json` 是每个风格原型的一张移动端首屏（只引用令牌），选定方向时随 `design_direction` 返回；由 `scripts/build-examples.ts` 生成，改示例改这个脚本。
- **找图**：`design_image` 搜索图库并返回候选地址、原始尺寸、授权、署名和缩略图（`src/server/images.ts`）；选中的地址写进 `props.src` 后由原有的入库流程下载。Openverse 只取允许商用和修改的授权。
- **按题材主色重算色板**：`design_direction({pick, primary})` 把预设色板的色相整体转到指定主色，保持明度与饱和度搭配，并修正文字对比度；主色记在画布上，再取方向时沿用。
- **题材母题**：`design_direction({pick, concept, motif})` 的 `motif` 记录从题材里取的具体的物或形状，与方向卡片的记忆点（构图手法）一起记到画布。
- **设计体检**：`design_screenshot` 截整个画板时，在渲染检查之外附一段设计提醒（`src/core/designLint.ts`）：阶梯外的字号 / 间距 / 圆角、字号档数过多、字重或字体族过多、没有视觉焦点、粗体过多、胶囊过多、卡片嵌套、左侧粗色条卡片、三个以上主色实心按钮、同图重复、emoji 图标、模板化元信息、直接写色值。提醒不阻塞自检；位图被放大超过 1.3 倍（`low_res_image`）、文字对比度不足（`low_contrast`：按实际底色计算，正文 4.5:1、大字 3:1，禁用控件除外）、移动端画板上可点击元素小于 44×44（`small_target`）则算作需要修复的问题。

- **服务端框架**：用 Node 内置 `http` + `ws`，未引入 Hono/Fastify（MCP SDK 的 Streamable HTTP 传输直接基于 Node 请求对象）。
- **令牌绑定写法**：面板与 AI 都写 `{color.primary}`，渲染与导出时转为 `var(--color-primary)`；也接受直接写 `var(--x)`。
- **同组件名给出完整子树**：若与定义同结构、同样式，仅文本 / props / 显隐不同，差异自动转为实例 `overrides`；结构或样式不同仍拒绝（AI 一次插入多个同名表单项时无需预先知道内部 id）。
- **实例的摆放属性**：`grow`、`alignSelf`、定位等“在父容器中的摆放”留在实例上，可逐实例不同；其余布局、盒模型与样式属于组件定义。
- **实例内部地址**：画布与工具中用 `实例id:内部id` 指向实例内的节点；改其文本 / 图片写入该实例的 overrides，改盒模型 / 样式写入组件定义。
- **编辑锁释放**：所有被 AI 改动过的画板都做过 `design_screenshot` 后释放；用 `design_plan` 规划过页面时，还要等规划的页面都开始绘制才释放；节点级截图不计为画板自检。
- **页面规划与绘制过程可视化**：AI 要画新页面时（单页也一样）在 `canvas_open` 之后立即调用 `design_plan` 声明全部页面（可附各页区块），早于阅读设计规范与选预设，服务端立即建好空画板，画布在未绘制的页面上显示骨架屏，画板名旁标出状态（待绘制 / 绘制中 / 待自检 / 自检中 / 已完成），顶栏显示进度。AI 光标只出现在正在工作的画板上，跟随最近写入的节点，旁边显示状态与写工具的 `note`；两次调用间空闲超过 2.5 秒显示“思考中”。本轮结束（自检完成、用户终止或会话关闭）时仍为空的规划画板自动删除；规划里还有未开始的页面时，锁的空闲超时放宽为 `DESIGN_MCP_PLAN_IDLE_MS`（默认 120 秒）。空闲超时只解锁、不回收规划画板：规划会暂存，同一会话下一次写入时自动恢复；持锁会话的任何工具调用（含读取、截图）都会重置空闲计时。
- **绘制回放**：MCP 工具参数整体到达，无法真正流式绘制；画布收到 AI 插入的子树后先排好最终布局，再按深度优先顺序逐个显示节点（总时长不超过约 1.2 秒），光标随之移动。回放只是视觉效果：截图自检、新的写入或用户点击画布时立即显示全部，不影响文档、撤销与导出。
- **撤销合并**：800ms 内对同一组字段的连续修改（如拖拽调节数值）合并为一个撤销步骤。
- **画布界面**：两栏（画布 + 右侧图层与属性），主题默认跟随系统亮色 / 暗色并随系统实时切换；顶栏手动切到与系统不同的主题时才记住，切回与系统一致即恢复跟随。单击文字元素即直接进入原地编辑（光标落在点击处，回车提交、Shift+回车换行、Esc 取消）；Shift+单击仍为多选。属性面板按分组只列出已设置的属性，“+”添加、“−”移除；布局只读。
- **画布工具**（底部工具栏，快捷键 V H T A N P R O L，评论 C）：
  - 选择、拖拽。
  - 文字：点在画板内会插入文字节点（按点击位置排序），点在画板外则是批注文字。
  - 画板：新建空画板，可选移动 390 / 平板 768 / 桌面 1440。
  - 便签、铅笔 / 钢笔、形状（矩形 / 圆角矩形 / 椭圆 / 菱形 / 直线 / 箭头，合为一个工具，R / O / L 直接切到矩形 / 椭圆 / 直线）、评论。
  - 便签、批注文字、铅笔、钢笔与形状批注也列在图层中（便签 / 文字用工具名并带文字摘要，铅笔 / 钢笔名为 Drawing，形状用各自的名称），点击即选中。
  - 文字与画板是用户唯一可做的结构改动，可撤销；其余结构仍只由 AI 修改。
- **交互与播放**：
  - 节点的 `proto` 字段描述页面内交互逻辑（AI 通过 MCP 写入，服务说明里有完整语法与 tab、短信倒计时示例）：画板级状态变量 `vars`；绑定 `show`（显隐）、`disabled`（禁用）、`styles`（条件样式）、文本 `{{表达式}}` 插值、输入框 `bind`；动作 `onClick` / `onLoad`：`set`、`toggle`、`countdown`、`stop`、`delay`、`if`、`navigate`、`back`、`open`。表达式是无副作用的 JS 子集（`src/core/proto.ts`），写入时校验语法。
  - 简单跳转也可写 `props.href`：`#<画板id>`、`#back`、`http(s):`；属性面板“交互”分组可设置跳转，并只读展示节点的交互逻辑。
  - 画布、截图与导出按初始状态静态渲染（初始隐藏的元素导出时不输出）；进入画板时状态重置为初值。
  - **交互状态检查**：`design_screenshot` 对带交互的画板，除初始状态外还会自动探索点击、输入、计时后能到达的状态，并逐个检查（`src/core/states.ts` 不依赖 DOM 模拟动作，最多 4 步、24 个状态，按状态变量去重；输入框按表达式里 `len(x) == N` 之类的比较取 N 位样例）。
    - 每个状态在页面外的隐藏 iframe 中按该状态的 vars 渲染，跑与截图自检相同的检查。用户看到的画布不受影响。
    - 额外检查 `state_shift`：点击后，被点控件或其同级的位置、尺寸发生变化，例如选中态加粗导致 tab 跳动。
    - 报告只列初始状态里没有的问题，同一问题只在首次出现的状态下列出，没有新问题的状态合并成一行。
    - 只有出现新问题的状态才附截图（最多 4 张），并且只截变化区域。`states:"images"` 时每个状态都附图（最多 8 张）。
    - 同时给出静态问题：永远不会成立的 `show` 或条件样式（`unreachable`），跳到不存在的画板（`dead_link`），引用未声明初值的变量（`undeclared_var`）。后两类在写工具的返回值 `proto_warnings` 中也会提示。
    - 带交互的画板必须做过状态检查才算自检完成；`states:"off"` 时不释放编辑锁。
    - `design_screenshot({frame_id, clicks:[…], vars:{…}})` 用来查看指定状态：`clicks` 按顺序模拟点击，`"wait"` 触发最早的延时或倒计时，`"load"` 执行 onLoad。这种调用不改文档，也不计为自检。
  - 缩放比例左侧的播放按钮（Shift+空格）从选中元素所在画板开始全屏预览：交互逻辑由运行时执行，hover / focus / active 生效，输入框可输入；Backspace 返回、Esc 退出，点空白处高亮可点击区域。
  - 导出：设计稿有交互时，HTML 内嵌一段交互脚本（直接嵌入 `src/core/protoEngine.ts` 中 `createProtoEngine` 的源码，与画布播放执行同一套逻辑），导出的页面可直接试用 tab、倒计时、显隐、跨画板跳转与返回；分文件导出时跨画板跳转到对应文件。导出对话框取消“保留交互”或 `design_export` 传 `interactive:false` 时只输出初始状态、无脚本。没有任何交互的设计稿导出仍不含脚本。
  - `createProtoEngine` 必须保持自包含（不引用模块作用域的值），否则嵌入导出页面后会失效；测试会独立求值导出页面中的引擎源码。
- **业务流程与额外说明**：服务说明鼓励 AI 为多页面 / 有分支或业务规则的交互稿补充说明，两种方式可组合：
  - `design_annotate` 画布批注：AI 在画板外的空白区放说明框（`rect`，矩形承载多行文字，`note` 为别名，可设 `width` / `height` / 底色；高度按文字估算，内容多时自动撑高）、文字（`text`）、箭头与连线（`arrow` / `line`，可跨画板，`{frame, x, y}` 指定另一画板的点，可设颜色与 `dashed` 线型），写页面说明、业务规则、跳转走向与待确认问题。这些批注和用户的便签、文字一样列在图层面板中（所在画板下，矩形显示为 Rectangle 并带文字摘要，标签为 AI）。批注带 `by:"ai"`，画布上显示为蓝色带 “AI” 角标，不进入设计稿、导出与撤销栈，无需编辑锁和自检；AI 只能更新（传 `id`）、`remove`、`clear` 自己的批注，不能动用户的。
  - 不遮挡画板标题与工具栏：画板正上方 40px 留给画板名称与播放 / 导出按钮。伸进这一带的说明框或文字由服务端自动上移，并避开同一画板上已有的说明依次往上叠（返回 `warnings`）；画板上方的说明框内容变多时向上长；这两样在屏幕上不随缩放变化，缩小画布时画板上方的 AI 说明整体再上移。放进画板内部时返回遮挡警告。返回值 `frame_layout` 给出各画板的 x 与宽度（画板横排、顶端 y=0、间距 120），`box_xywh` 给出说明框位置。`canvas_status` 把它们单独列在 `ai_annotations`，与用户意见区分。
  - 说明画板：要随导出交付时，额外画一个“业务流程与说明”画板（在 `design_plan` 中一起声明），包含主流程图（卡片用 `props.href` 链到各页面）、各页面说明、业务规则、交互状态清单与数据字段；它是普通画板，会进入导出，同样需要截图自检。
  - 说明内容都不放进 UI 画板。
- **批注**：评论、便签、手绘与形状存在画布目录的 `annotations.json`，不进入设计稿、导出与撤销栈。
  - AI 调用 `canvas_status` 时会读到这些批注，附带所在画板、指向的节点 id 和坐标。
  - 评论关联到点击处的元素（含组件实例内部元素），记录相对该元素的偏移，元素移动后图钉跟随；放下图钉后自动退出评论模式。
  - 选中批注或点开评论后按 Delete 删除；评论点“标为已解决”也会移除。
- **本地设计规范**：`canvas_open` 返回 `design_guides`，列出 AI 动手前须阅读的本地设计规范（服务端说明中也要求先读再画），按以下顺序查找：
  1. `DESIGN_MCP_GUIDES` 指定的文件或目录。
  2. 项目目录及上级直到仓库根、以及 `~/.claude/skills` 下，名称或描述与设计相关（设计、UI、品牌、样式、令牌、配色、排版等）的 skill（`SKILL.md`）。
  3. 项目中的 `DESIGN.md`、`design-system.md`、`STYLEGUIDE.md`、`docs/design*.md` 等文件。

  守护进程只给出路径与摘要，内容由 AI 用自己的读文件工具读取，所以 skill 引用的同目录文件也能读到。
- **设计系统（参照 Claude Design）**：设计依据是一个与画布分开保存、同一项目共用的设计系统（`design_system` 工具，`src/core/designSystem.ts`、`src/server/systems.ts`）。
  - 内容：颜色按主题（亮 / 暗）各存一值并写明用途与对比度检查对象；字阶加组合文字样式（字号 + 行高 + 字重 + 字体，`text_styles` 给出可直接写进 style 的字段）；间距、圆角、阴影；组件定义；品牌说明（概念、母题、记忆点、形状、版式、不要做的事）。
  - 存放：`~/.penhold/systems/<id>/`，含 `system.json` 与生成的 `README.md`（品牌手册，AI 先读它）、`tokens.css`（`:root` 为默认主题，其余主题写在 `[data-theme=…]`）、`tokens.json`（Claude Design 的令牌格式）。`systems/index.json` 记录各项目目录的默认系统。
  - 来源：`create` 由方向卡片生成（按风格原型的信息密度定字阶、间距与字重，自动推导另一种明暗，修正对比度）、由内置预设或画布现有令牌整理；`import` 从 CSS 变量（Tailwind v4 `@theme`、shadcn 的 HSL 三元组、`.dark` / `prefers-color-scheme` 暗色块）或 Claude Design 的 tokens.json 导入，取值照抄，不达标的对比度只列出不改。
  - 安装：画布记录 `session.json` 的 `system`（id、版本、主题），选定主题展开成扁平令牌写入 `doc.tokens`，系统里的组件一并复制。项目有默认系统时，新画布不再出方向卡片与问卷，首次写入（含 `design_plan`）时自动安装。`theme` 切换主题；`update` 按名字合并修改系统并重装到当前画布；对已安装系统的令牌直接 `tokens_set` 会返回 `system_drift` 提醒。
  - `save_components` 把画布里的组件存进系统；`export` 写到项目的 `design-system/`，提交进仓库后其他机器打开同一项目自动发现（版本更新的覆盖本机副本）。
  - 用户自定义：首页的“设计系统”区列出本机所有系统，可新建（空白加主色、风格方向卡片、粘贴 CSS 变量、粘贴 tokens.json / system.json）、复制、删除（移入回收站）。
  - 编辑页：`http://127.0.0.1:<port>/s/<系统 id>`（[web/src/SystemEditor.tsx](web/src/SystemEditor.tsx)）。
    - 可改：各主题的颜色（取色器或直接输入 hex / rgb / hsl / oklch）、字体、字阶、文字样式、间距、圆角、阴影、品牌说明；组件只能改用途或移除，结构仍由 AI 在画布里画好后存入。
    - 右侧实时预览；颜色旁显示对比度，未达标的可一键修正（只调明度）；只有一套主题时可由它生成另一种明暗。
    - 保存（Ctrl / Cmd+S）后版本号 +1，重新生成 README、tokens.css 与 tokens.json，并把令牌同步到所有安装了它的画布（各画布保持自己选的主题，画布里可撤销）；AI 正在修改的画布跳过，AI 下次打开时会看到版本提示。
    - “用于项目”里勾选项目目录，把它设为该项目的默认系统。
    - 接口在 [src/server/systemApi.ts](src/server/systemApi.ts)：`GET/POST /api/systems`、`GET/PUT /api/systems/<id>`、`POST /api/systems/<id>/(duplicate|delete|default)`；提交内容经结构校验，取值与画布令牌同一套限制。
  - 只读浏览页：`http://127.0.0.1:<port>/s/<系统 id>/view`，展示各主题色板与对比度、文字样式、间距圆角阴影与组件预览。
  - 内置预设的色板在加载时修正对比度：主色对背景不足 3:1 而强调色达标时两者互换，正文、次要文字与色块上的文字补到 4.5:1。按主色重算色板改在 OKLCH 中转色相。
- **内置设计预设（兜底）**：以上都没找到时，`design_guides` 只含内置通用规范 [guides/default/SKILL.md](guides/default/SKILL.md)，AI 先选设计方向卡片（见下），需要具体行业的色板时再用 `design_preset` 按用户需求匹配产品类型预设：
  - `design_preset({query})` 按需求匹配 192 种产品类型（英文关键词最准，也识别常见中文说法），返回候选；`canvas_open({brief})` 也会直接附上 `preset_matches`。
  - `design_preset({id, use:true})` 返回完整预设（可直接传给 `tokens_set` 的语义色板令牌、推荐视觉风格及其适用 / 禁用场景、字体搭配、落地页与看板结构），并记到画布 `session.json` 的 `preset`；之后 `canvas_open` 返回 `design_preset`，保持同一画布风格一致。
  - `design_preset()` 不带参数返回内置规范全文与全部产品类型，供读不到本地文件的客户端（如直连 HTTP 端点）使用。
  - 预设数据 [guides/catalog.json](guides/catalog.json) 由 `scripts/import-presets.ts` 从 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT）的数据表生成；内置规范部分改编自 Anthropic 的 frontend-design skill（Apache-2.0）。署名与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- **需求问卷（信息不足时先问用户）**：画布还没有任何设计依据（本地规范、已选方向 / 预设、已有令牌、问卷回答）时，`canvas_open` 返回 `needs_brief:true`，AI 应调用 `design_ask` 在画布上展示问卷，而不是自行假设后直接开始画。
  - 默认问卷：产品与用户、使用设备（需求里没提到时）、视觉方向（3 张方向卡片，带色块，可“换一批”）、主色、明暗、页面内容（按页面类型给出多选项，可填“其他”）、参考产品、其他要求。AI 也可以传 `questions`（最多 8 个，单选 / 多选 / 填空）自定义问题，默认仍附上视觉方向题。
  - 每题都可以不填；“跳过，让 AI 决定”返回 `status:"skipped"`。问卷可收起为顶部提示条，稍后再填。
  - `design_ask` 默认等待约 50 秒（`wait_seconds` 或环境变量 `DESIGN_MCP_ASK_WAIT_MS` 调整，注意客户端的工具调用超时）；超时返回 `status:"waiting"`，问卷仍留在画布上，AI 告诉用户去填写并再次调用 `design_ask()` 等待。用户随时提交，回答都会记到画布 `session.json` 的 `brief`，之后 `canvas_open` 返回 `user_brief`。
  - 用户选了视觉方向时，服务端直接把它记为画布的设计方向，`design_ask` 返回完整的 `direction`（令牌、形状、记忆点）。
  - `design_plan` 在没有设计依据、也没有问卷回答时会拒绝（`needs_brief`）。用户在对话里已经把产品、视觉偏好和页面内容说清楚时，AI 传 `enough_info`（一句话复述用户说过的要点）跳过问卷。`frame_create` 不受此限制。
- **设计方向卡片（提示词很短时的兜底）**：“移动端登录页”这类需求里没有产品类型，按产品类型匹配不到预设，模型会退回自己的默认配色与版式。画布没有任何设计依据（本地规范、已选方向 / 预设、已有令牌）时，`design_plan` 的返回值附带 `design_directions`：
  - 3 张差异明显的方向卡片，每张由风格原型（[src/server/directions.ts](src/server/directions.ts) 中的 12 种，如瑞士网格、高饱和色块、杂志编辑、新粗野、深色沉浸）、目录中的一套色板、一组字体搭配和一个记忆点组合而成。
  - 差异化规则：原型互不相同，主色色相相差不小于 45°，至多一个深色方向；目录中蓝色系色板占三分之一以上，抽取时按色相反向加权；同项目其他画布用过的主色与原型降权；需求能匹配到产品类型时，第一张是该类型的推荐风格与色板（稳妥解），其余有意拉开。
  - `design_direction({pick, concept})` 返回完整方向（可直接传给 `tokens_set` 的颜色 / 字体 / 圆角 / 阴影令牌、风格效果要点、该方向下不要做的事），并记到画布 `session.json` 的 `direction`；之后 `canvas_open` 返回 `design_direction`。`design_direction()` 不带参数换一批。
  - 尚未选定方向就调用 `tokens_set` 时，返回值带 `direction_reminder`。
- **页面类型规范片段**：`design_plan` 按页面名与区块名识别页面类型，把 [guides/pages/](guides/pages/) 下对应的片段（登录、首页、看板、落地页、列表、详情、表单、个人中心、引导 / 结果页）随返回值的 `page_guides` 直接下发，内容是该类页面的几种构图方案与常见平庸写法。有本地设计规范时同样下发：品牌色与字体以本地规范为准，构图由片段补充。新增类型：在 `guides/pages/` 加 `<type>.md`，并在 [src/server/pageGuides.ts](src/server/pageGuides.ts) 的 `TYPES` 中登记匹配规则。
- **重新构建后自动升级守护进程**：守护进程在 `daemon.json` 中记录构建标识（编译产物的最新修改时间）；代理或 `penhold-mcp open` 发现守护进程来自更旧的构建时会平滑重启它（只升级不降级）。
- **画布无需令牌**：画布页面、管理 API 与画布 WebSocket 直接打开即可（`http://127.0.0.1:<port>/c/<canvasId>`），靠只监听 127.0.0.1 + 校验 Host 与 Origin 防护；只有 MCP 端点（`/mcp`）需要令牌，由 stdio 代理自动携带（`~/.penhold/token`，权限 600）。

## Tweaks（可调节项）

参照 Claude Design 的 Tweaks：AI 用 `tweaks_set` 把令牌暴露成控件（`color` 取色、`range` 滑块、`select` 下拉、`toggle` 开关），数据存在 `doc.tweaks`。用户在画布右侧未选中节点时的“Tweaks”面板里调节，改的就是绑定的令牌（可撤销）；导出的 HTML 带一个浮动 Tweaks 面板，通过改 `:root` 的 CSS 变量实时生效（`interactive:false` 的导出不带面板）。
