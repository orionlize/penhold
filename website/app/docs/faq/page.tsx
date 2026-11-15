import Link from 'next/link';
import { REPO } from '../../site';
import { docMeta } from '../nav';
import { Code, DocHead, H2 } from '../ui';

export const metadata = docMeta('faq');

export default function Faq() {
  return (
    <>
      <DocHead eyebrow="Docs / 常见问题" title="常见问题" lede="遇到问题先看这里。没找到答案的，欢迎到 GitHub 提 issue。" />

      <H2 id="no-browser">AI 开始画了，浏览器却没打开</H2>
      <p>
        可能是默认浏览器没设置好，或者设置了 <code>DESIGN_MCP_NO_BROWSER=1</code>。手动打开：
      </p>
      <Code lang="bash">{`npx penhold-mcp open`}</Code>
      <p>
        写工具会等画布页面连上（默认 20 秒）。远程开发机上浏览器打不开时，把 4470 端口转发到本机再访问，例如{' '}
        <code>ssh -L 4470:127.0.0.1:4470 你的主机</code>。
      </p>

      <H2 id="port">端口被占用了</H2>
      <p>
        守护进程从 4470 开始找空闲端口，自动递增，不需要处理。想换起始端口，设置 <code>DESIGN_MCP_PORT</code>。当前端口记在{' '}
        <code>~/.penhold/daemon.json</code>。
      </p>

      <H2 id="readonly">画布一直是只读，改不了</H2>
      <p>
        AI 持有编辑锁时画布只读，要等它对改过的画板都做完截图自检。AI 中途停下时，30 秒没有调用就会自动解锁（规划里还有没开始的页面时是 120 秒）。也可以点顶栏的“终止并解锁”。
      </p>

      <H2 id="lost">新开对话后，AI 找不到上次的画布</H2>
      <ul>
        <li>告诉 AI 画布 id（地址栏 <code>/c/</code> 后面那一段），或者直接说“继续上次的画布”，AI 会列出当前目录下最近的画布让你选。</li>
        <li>
          Claude Code 用户可以配置 SessionStart hook，压缩上下文后自动绑回，见<Link href="/docs/install#hook">安装</Link>。
        </li>
        <li>
          想固定用某个画布，设置 <code>DESIGN_MCP_CANVAS</code>。
        </li>
      </ul>

      <H2 id="style">AI 画出来的风格总是差不多</H2>
      <p>
        在需求里写清视觉偏好和参考产品；或者在问卷的“视觉方向”里点“换一批”，挑一张和平时不一样的。已经有设计系统的项目，所有稿子都会遵循它，想换风格就新建一个设计系统并设为项目默认。
      </p>

      <H2 id="overwrite">AI 会不会把我改过的地方改回去</H2>
      <p>
        不会。你的每次改动都带版本号记录，AI 续改前会查看你的手动改动；整体替换节点时如果目标被你改过，服务端会拒绝，让 AI 先读再写。
      </p>

      <H2 id="fonts">导出的页面字体不对</H2>
      <p>
        导出的 HTML 不内嵌字体文件，会用打开它的电脑上已安装的字体。导出完成时会列出用到的字体，请在接收方的电脑上安装，或者在代码里换成网络字体。
      </p>

      <H2 id="multi">能同时开几个会话画同一个画布吗</H2>
      <p>
        可以，比如分叉出来的对话会共用同一个画布。写入由编辑锁串行化：同一时刻只有一个会话的 AI 能改，其他会话会收到“画布正被另一会话修改”。一个会话只能编辑一个画布。
      </p>

      <H2 id="offline">能离线使用吗</H2>
      <p>
        画布、设计系统和导出都在本机，断网也能打开和修改。需要联网的只有你用的模型本身，以及可选的找图功能。
      </p>

      <H2 id="logs">怎么看日志</H2>
      <Code lang="bash">{`tail -f ~/.penhold/daemon.log
# 或者在前台运行守护进程
npx penhold-mcp daemon`}</Code>
      <p>
        还是解决不了，请带上日志到 <a href={`${REPO}/issues`}>GitHub Issues</a> 反馈。
      </p>
    </>
  );
}
