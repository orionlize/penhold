import { docMeta } from '../nav';
import { DocHead, H2, Note, Table } from '../ui';

export const metadata = docMeta('canvas');

export default function Canvas() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 画布"
        title="画布操作"
        lede="画布地址是 http://127.0.0.1:4470/c/<画布 id>，左边是画布，右边是图层与属性。你改样式和文字，AI 改结构，两边实时同步。"
      />

      <H2 id="home">画布首页</H2>
      <p>
        运行 <code>npx penhold-mcp open</code> 打开首页，可以看到本机所有画布与设计系统。<code>npx penhold-mcp open &lt;画布 id&gt;</code> 直接打开某个画布。
      </p>

      <H2 id="edit">你能改什么</H2>
      <Table
        head={['能改', '说明']}
        rows={[
          ['盒模型', '宽高、内外边距、圆角、边框。数值框可拖拽调节，方向键步进。'],
          ['样式', '颜色、背景、字体、字号、字重、行高、字距、阴影等。颜色、字号、间距可以绑定设计令牌。'],
          ['文字', '单击文字元素直接进入编辑：回车提交，Shift+回车换行，Esc 取消。'],
          ['新增文字与画板', '用文字工具在画板里点一下插入文字节点；用画板工具新建空画板（移动 390 / 平板 768 / 桌面 1440）。'],
          ['跳转', '属性面板“交互”分组可以设置点击跳到哪个画板。'],
          ['Tweaks', '不选中任何节点时，右侧显示 AI 暴露出来的可调项（取色、滑块、下拉、开关）。'],
        ]}
      />
      <p>
        元素的位置、顺序、层级和布局方式只能由 AI 修改，属性面板里的布局是只读的。想调整排布，直接告诉 AI 或者留评论。
      </p>
      <Note>
        属性面板按分组只列出已经设置的属性，用 “+” 添加、“−” 移除。800 毫秒内对同一组字段的连续修改（比如拖动数值）合并成一步撤销。
      </Note>

      <H2 id="tools">工具栏与快捷键</H2>
      <Table
        head={['工具', '快捷键', '用途']}
        rows={[
          ['选择', <kbd key="k">V</kbd>, '点选元素；Shift+单击多选'],
          ['拖拽', <kbd key="k">H</kbd>, '移动画布，也可以按住空格'],
          ['文字', <kbd key="k">T</kbd>, '画板内插入文字节点，画板外添加批注文字'],
          ['画板', <kbd key="k">A</kbd>, '新建空画板'],
          ['便签', <kbd key="k">N</kbd>, '贴一张便签'],
          ['铅笔 / 钢笔', <kbd key="k">P</kbd>, '自由圈画或画路径，Shift+P 在两者间切换'],
          ['形状', <span key="k"><kbd>R</kbd> <kbd>O</kbd> <kbd>L</kbd></span>, '矩形、椭圆、直线；再点一次可选圆角矩形、菱形、箭头'],
          ['评论', <kbd key="k">C</kbd>, '在元素上放评论图钉，AI 能读到'],
          ['撤销 / 重做', <span key="k"><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></span>, '只作用于你自己的改动'],
          ['播放', <span key="k"><kbd>Shift</kbd>+<kbd>Space</kbd></span>, '从选中元素所在画板开始全屏预览交互'],
          ['删除批注', <kbd key="k">Delete</kbd>, '删除选中的便签、形状或评论'],
        ]}
      />

      <H2 id="annotations">批注与评论</H2>
      <p>便签、批注文字、手绘、形状和评论都不进入设计稿、导出和撤销栈，只用来沟通：</p>
      <ul>
        <li>评论关联到点击处的元素（包括组件实例内部的元素），元素移动后图钉跟着走。放下图钉后自动退出评论模式。</li>
        <li>AI 调用 <code>canvas_status</code> 时能读到全部批注，以及它们所在的画板、指向的元素和坐标。</li>
        <li>AI 写的说明框、箭头显示为蓝色并带 “AI” 角标。AI 只能改自己的批注，不会动你的。</li>
        <li>点评论里的“标为已解决”会移除这条评论。</li>
      </ul>

      <H2 id="versions">版本</H2>
      <p>
        画布每 200 次修改自动保存一个检查点，你也可以随时保存命名版本，之后回滚到任一版本。回滚本身也能撤销。
      </p>

      <H2 id="theme-lang">主题与语言</H2>
      <ul>
        <li>画布界面默认跟随系统亮色 / 暗色。手动切到与系统不同的主题时会被记住，切回与系统一致即恢复跟随。</li>
        <li>
          浏览器语言是中文时界面显示中文，否则显示英文。地址后加 <code>?lang=zh</code> 或 <code>?lang=en</code> 手动切换。
        </li>
      </ul>
    </>
  );
}
