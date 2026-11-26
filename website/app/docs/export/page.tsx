import Link from 'next/link';
import { docMeta } from '../nav';
import { Code, DocHead, H2, Note, Table } from '../ui';

export const metadata = docMeta('export');

export default function Export() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 导出"
        title="导出与转代码"
        lede="导出的是能离线打开、能点、能看源码的 HTML，不是截图或分享链接。也可以让 AI 照着稿子写进你的项目。"
      />

      <H2 id="html">导出 HTML</H2>
      <p>两种方式：</p>
      <ul>
        <li>在画布上点画板上方的导出按钮，或顶栏的“导出 HTML”。</li>
        <li>
          对 AI 说“把所有画板导出到 ./design”，它会调用 <code>design_export</code>。
        </li>
      </ul>
      <p>
        默认导出到画布目录的 <code>exports/</code>（<code>~/.penhold/canvases/&lt;画布 id&gt;/exports/</code>），也可以指定路径。
      </p>

      <H2 id="options">导出选项</H2>
      <Table
        head={['选项', '默认', '说明']}
        rows={[
          ['多画板', '单文件', '多个画板合成一个文件，顶部带切换条；选“分文件”时每个画板一个 HTML，打包成 zip，跨画板跳转指向对应文件'],
          ['保留交互', '开', '内嵌交互脚本，tab、倒计时、显隐、跳转与返回都能用；关掉则只输出初始状态，不带脚本'],
          ['内嵌图片', '开', '图片写成 data URI，单文件即可离线打开；关掉时图片单独存放，输出 zip'],
          ['样式写法', '合并为 class', '合并为 class 输出样式表，或写成内联样式'],
          ['宽度', '按画板宽度', '按画板宽度居中，或铺满视口'],
        ]}
      />
      <Note>
        <p>导出的 HTML 不内嵌字体文件。导出结果会列出用到的字体，在别的电脑上打开前请确认已安装，或换成网络字体。</p>
        <p>没有任何交互的稿子导出时不含脚本。</p>
        <p>导出画板链接到其他画布的页面时，那些页面会作为只读页面一起打包（tab 显示为斜体），只打包直接链接到的一层。找不到的目标会列在导出结果的警告里。</p>
      </Note>

      <H2 id="tweaks">Tweaks 面板</H2>
      <p>
        让 AI 把关键令牌暴露成可调项（如“主色”“圆角”“紧凑模式”），画布右侧不选中元素时显示 Tweaks 面板。导出的 HTML 带同样的浮动面板，改的是{' '}
        <code>:root</code> 上的 CSS 变量，适合给评审的人自己试配色和密度。关闭“保留交互”的导出不带面板。
      </p>
      <p>
        设计系统有多个主题时，画布上的 Tweaks 面板顶部还能按风格、配色、明暗切换主题，详见<Link href="/docs/design-system#themes">设计系统 · 主题</Link>。
      </p>
      <Code lang="提示词" copy={false}>{`加几个 Tweaks：主色、圆角大小、亮暗切换。`}</Code>

      <H2 id="to-code">让 AI 照稿写代码</H2>
      <p>稿子定下来后，在同一个会话里让 AI 实现成你项目里的组件。它会按这个顺序读稿：</p>
      <ol>
        <li>
          <code>design_outline</code> 看整体结构。
        </li>
        <li>
          <code>design_screenshot</code> 截图作为视觉基准。
        </li>
        <li>
          按组件逐个 <code>design_read</code>，拿到精确的布局、样式、令牌引用和交互逻辑。传 <code>format:"jsx"</code> 时以 JSX 返回，结构一眼看清，也更省上下文。
        </li>
      </ol>
      <Code lang="提示词" copy={false}>{`把画布上的设置页实现成 src/pages/Settings.tsx，用项目现有的 Tailwind 配置，
交互逻辑照稿子里的实现。`}</Code>
      <p>
        之后你在画布上再做调整，让 AI 用 <code>design_changes</code> 只同步变化的部分，不必整页重写。
      </p>
      <p>
        反过来改稿也走同一条路：AI 把某个区块读成 JSX，改写后用 <code>node_replace</code> 整块写回。没展开的子节点标成 <code>keepChildren</code> 原样保留，节点 id 不变，你在上面的评论和手动改动记录都还在。
      </p>
    </>
  );
}
