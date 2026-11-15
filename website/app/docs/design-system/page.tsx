import { docMeta } from '../nav';
import { Code, DocHead, H2, Note, Table } from '../ui';

export const metadata = docMeta('design-system');

export default function DesignSystem() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 设计系统"
        title="设计系统"
        lede="设计系统是一份与画布分开保存、同一项目共用的设计依据：颜色、字阶、文字样式、间距、圆角、阴影、组件和品牌说明。有了它，每张新稿都是同一套风格。"
      />

      <H2 id="priority">AI 按什么画</H2>
      <p>AI 动手前会按下面的顺序找设计依据，找到即用：</p>
      <ol>
        <li>
          <strong>项目的默认设计系统</strong>：新画布第一次写入时自动安装，不再出方向卡片和问卷。
        </li>
        <li>
          <strong>本地设计规范文件</strong>：<code>DESIGN_MCP_GUIDES</code> 指定的路径；项目目录（一直到仓库根）和{' '}
          <code>~/.claude/skills</code> 下与设计相关的 <code>SKILL.md</code>；项目里的 <code>DESIGN.md</code>、
          <code>design-system.md</code>、<code>STYLEGUIDE.md</code>、<code>docs/design*.md</code>。
        </li>
        <li>
          <strong>内置规范 + 方向卡片</strong>：以上都没有时，AI 从三张差异明显的方向卡片里选一张，再存成项目的设计系统。
        </li>
      </ol>
      <Note>需求和设计依据冲突时，以你在对话里说的为准。</Note>

      <H2 id="directions">方向卡片</H2>
      <p>
        为了避免每次都是同一套蓝色按钮加白卡片，没有设计依据时 AI 会拿到三张方向卡片。每张由一种风格原型（共 12 种，如瑞士网格、高饱和色块、杂志编辑、新粗野、深色沉浸）、一套色板、一组字体搭配和一个记忆点组成：
      </p>
      <ul>
        <li>三张的原型互不相同，主色色相至少相差 45°，至多一张深色。</li>
        <li>需求能匹配到产品类型时，第一张是该类型的稳妥解，其余两张有意拉开差距。</li>
        <li>同一项目其他画布用过的主色与原型会降权，避免雷同。</li>
        <li>选定后可以按题材换主色，色板整体转色相并修正文字对比度。</li>
      </ul>
      <p>问卷里的“视觉方向”题就是这三张卡片，你可以自己选，也可以点“换一批”。</p>

      <H2 id="presets">产品类型预设</H2>
      <p>
        内置 192 种产品类型的预设（色板、推荐风格、字体搭配、落地页与看板结构）。AI 会用你的需求描述去匹配，英文关键词最准，也能识别常见中文说法。
      </p>

      <H2 id="import">从现有代码导入</H2>
      <p>项目里已有样式代码时，直接让 AI 导入，取值原样照抄：</p>
      <Code lang="提示词" copy={false}>{`从 app/globals.css 导入设计系统，然后按它画设置页。`}</Code>
      <Table
        head={['支持的来源', '说明']}
        rows={[
          ['CSS 变量', ':root 里的 --xxx，包括 .dark 与 prefers-color-scheme 暗色块'],
          ['Tailwind v4', '@theme 块'],
          ['shadcn/ui', 'HSL 三元组写法（如 --primary: 222 47% 11%）'],
          ['tokens.json', 'Claude Design 的令牌格式'],
          ['system.json', 'Penhold 自己导出的设计系统'],
        ]}
      />
      <p>导入时对比度不达标的颜色只会列出来，不会擅自修改。</p>

      <H2 id="editor">编辑设计系统</H2>
      <p>
        画布首页的“设计系统”区列出本机所有系统，可以新建（空白加主色、选方向卡片、粘贴 CSS 变量、粘贴 tokens.json / system.json）、复制和删除（移入回收站）。点开进入编辑页{' '}
        <code>http://127.0.0.1:4470/s/&lt;系统 id&gt;</code>：
      </p>
      <ul>
        <li>改各主题的颜色（取色器，或输入 hex / rgb / hsl / oklch）、字体、字阶、文字样式、间距、圆角、阴影和品牌说明。</li>
        <li>右侧实时预览。颜色旁显示对比度，不达标的一键修正（只调明度）。只有一套主题时可以自动生成另一种明暗。</li>
        <li>
          <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>S</kbd> 保存后版本号加一，令牌同步到所有安装了它的画布（各画布保留自己选的主题，可撤销）。AI 正在修改的画布会跳过，AI 下次打开时看到版本提示。
        </li>
        <li>“用于项目”里勾选项目目录，设为该项目的默认系统。</li>
        <li>组件只能改用途或移除，结构由 AI 在画布里画好后存入。</li>
      </ul>
      <p>
        只读浏览页是 <code>/s/&lt;系统 id&gt;/view</code>，可以发给同事看色板、文字样式和组件预览。
      </p>

      <H2 id="share">和团队共用</H2>
      <p>
        设计系统默认存在 <code>~/.penhold/systems/&lt;id&gt;/</code>。让 AI 导出到项目里：
      </p>
      <Code lang="提示词" copy={false}>{`把当前设计系统导出到项目里。`}</Code>
      <p>
        会写到项目根目录的 <code>design-system/</code>，包含 <code>system.json</code>、<code>README.md</code>（品牌手册）、
        <code>tokens.css</code> 和 <code>tokens.json</code>。提交进仓库后，其他人打开同一项目会自动发现它，版本更新的会覆盖本机副本。
      </p>
      <Code lang="tokens.css" copy={false}>{`:root {
  --color-primary: #1f6f5c;
  --color-bg: #fbfaf7;
  --font-heading: "Noto Serif SC", serif;
  /* … */
}
[data-theme="dark"] {
  --color-primary: #5fc4a8;
  --color-bg: #10140f;
}`}</Code>

      <H2 id="tokens">令牌写法</H2>
      <p>
        稿子里的颜色、字体、间距都引用令牌，写成 <code>{'{color.primary}'}</code>，渲染和导出时转成 <code>var(--color-primary)</code>。改一个令牌全局生效。颜色、渐变、阴影里可以嵌入令牌，例如{' '}
        <code>{'linear-gradient(90deg, {color.primary}, {color.accent})'}</code>。
      </p>
      <Note>
        字体只用本机已安装的：生成字体令牌前会检测本机字体，没装的西文字体会从字体栈里去掉。导出的 HTML 不内嵌字体文件，导出时会列出所需字体。
      </Note>
    </>
  );
}
