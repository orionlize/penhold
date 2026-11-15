import { docMeta } from '../nav';
import { Code, DocHead, H2, Note, Table } from '../ui';

export const metadata = docMeta('prototype');

export default function Prototype() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 交互原型"
        title="交互原型"
        lede="页面内的 tab 切换、倒计时、开关、弹窗、表单校验，以及跨页面跳转，都可以直接写进稿子。画布能播放，导出的 HTML 也能点。"
      />

      <H2 id="ask">怎么要</H2>
      <p>在需求里说清交互就行，AI 会把它写进节点的交互逻辑：</p>
      <Code lang="提示词" copy={false}>{`登录页做成可交互的：密码 / 验证码两个 tab 能切换；
输入 11 位手机号后“获取验证码”才可点，点了倒计时 60 秒；
登录成功跳到首页。`}</Code>

      <H2 id="play">播放预览</H2>
      <ul>
        <li>
          选中某个画板里的元素，点缩放比例左侧的播放按钮，或按 <kbd>Shift</kbd>+<kbd>Space</kbd>，从该画板开始全屏预览。
        </li>
        <li>hover、focus、active 样式生效，输入框可以输入。</li>
        <li>
          <kbd>Backspace</kbd> 返回上一页，<kbd>Esc</kbd> 退出；点空白处会高亮所有可点击区域。
        </li>
        <li>画布和截图始终显示初始状态，进入画板时状态重置为初值。</li>
      </ul>

      <H2 id="model">交互逻辑能表达什么</H2>
      <Table
        head={['能力', '写法', '例子']}
        rows={[
          ['状态变量', <code key="c">vars</code>, '画板级变量，如当前 tab、倒计时秒数、开关状态'],
          ['显隐', <code key="c">show</code>, '只在 tab == "sms" 时显示验证码输入框'],
          ['禁用', <code key="c">disabled</code>, '手机号不满 11 位时按钮禁用'],
          ['条件样式', <code key="c">styles</code>, '选中的 tab 文字变成主色'],
          ['文本插值', <code key="c">{'{{表达式}}'}</code>, '“{{sec}} 秒后重发”'],
          ['输入绑定', <code key="c">bind</code>, '输入框的值写入变量'],
          ['动作', <code key="c">onClick / onLoad</code>, 'set、toggle、countdown、stop、delay、if、navigate、back、open'],
        ]}
      />
      <p>
        简单跳转也可以直接在属性面板“交互”分组里设置，等价于 <code>props.href</code>：<code>#&lt;画板 id&gt;</code> 跳到另一页，
        <code>#back</code> 返回，<code>https://…</code> 打开外链。
      </p>
      <Note>表达式是无副作用的 JavaScript 子集，写入时就会校验语法，写错了 AI 会立即收到错误。</Note>

      <H2 id="state-check">交互状态检查</H2>
      <p>带交互的画板截图自检时，服务端会自动探索点击、输入、计时后能到达的状态（最多 4 步、24 个状态），逐个检查：</p>
      <ul>
        <li>每个状态在隐藏的页面里渲染，跑和初始状态相同的检查，你看到的画布不受影响。</li>
        <li>额外检查点击后控件是否跳动，例如选中态加粗导致 tab 位置变化。</li>
        <li>报告只列初始状态里没有的新问题，有新问题的状态才附截图，并且只截变化的区域。</li>
        <li>同时报告逻辑问题：永远不会出现的元素、跳到不存在的画板、引用了没有初值的变量。</li>
      </ul>
      <p>带交互的画板必须做过状态检查才算自检完成。</p>

      <H2 id="flow">业务流程说明</H2>
      <p>多页面、有分支或有业务规则的原型，AI 会在自检后补充说明，两种方式可以组合：</p>
      <ul>
        <li>
          <strong>画布批注</strong>：画板之间画跳转箭头（异常或可选路径用虚线），画板上方或下方放说明框，写进入条件、主要操作、跳转去向、业务规则和待确认问题。不进入导出。
        </li>
        <li>
          <strong>说明画板</strong>：需要随导出交付时，额外画一个 1440 宽的“业务流程与说明”画板，包含主流程图（卡片可点击跳到对应页面）、各页说明、业务规则和交互状态清单。
        </li>
      </ul>
      <Code lang="提示词" copy={false}>{`把业务流程和说明也画成一个画板，导出时一起带上。`}</Code>
    </>
  );
}
