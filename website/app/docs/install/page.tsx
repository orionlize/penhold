import Link from 'next/link';
import { REPO } from '../../site';
import { docMeta } from '../nav';
import { Code, DocHead, H2, Note } from '../ui';

export const metadata = docMeta('install');

export default function Install() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 安装"
        title="安装"
        lede="一行命令把 Penhold 注册成 MCP 服务，然后用一句话让 Agent 画第一张稿。"
      />

      <H2 id="requirements">环境要求</H2>
      <ul>
        <li>Node.js 20 或更高版本。</li>
        <li>一个支持 MCP 的 Agent 客户端，例如 Claude Code、Cursor、Codex CLI。</li>
        <li>一个桌面浏览器（Chrome、Edge、Firefox、Safari 均可），用来打开画布。</li>
      </ul>
      <p>不需要账号、API Key 或额外的模型，画稿用的就是你的 Agent 当前在用的模型。</p>

      <H2 id="register">注册 MCP 服务</H2>
      <p>以 Claude Code 为例，在终端执行：</p>
      <Code lang="bash">{`claude mcp add penhold -- npx penhold-mcp`}</Code>
      <p>
        想在所有项目里都能用，加 <code>--scope user</code>。其他客户端的写法见 <Link href="/docs/clients">接入客户端</Link>。
      </p>

      <H2 id="from-source">从源码安装</H2>
      <p>想用最新代码，或者 npm 上还没有你需要的版本时，可以从仓库构建：</p>
      <Code lang="bash">{`git clone ${REPO}.git
cd penhold
npm install
npm run build        # 编译服务端（dist/server）与画布前端（dist/web）

# 用绝对路径注册
claude mcp add penhold -- node /绝对路径/penhold/dist/server/cli.js`}</Code>
      <Note>
        重新 <code>npm run build</code> 之后不用手动重启：代理发现守护进程来自更旧的构建时，会自动平滑重启它。
      </Note>

      <H2 id="first">画第一张稿</H2>
      <ol className="dsteps">
        <li>
          <b>重开一个 Agent 会话</b>
          让客户端加载新注册的 MCP 服务。在 Claude Code 里可以用 <code>/mcp</code> 确认 <code>penhold</code> 已连接。
        </li>
        <li>
          <b>用自然语言描述界面</b>
          例如：“为记账 App 设计一个移动端的设置页”。需求越具体，AI 越少问你。
        </li>
        <li>
          <b>在浏览器里回答问卷（如果有）</b>
          项目里还没有任何设计依据时，画布上会弹出一份需求问卷：产品与用户、视觉方向、主色、明暗等。每题都可以不填，也可以点“跳过，让 AI 决定”。
        </li>
        <li>
          <b>看 AI 画</b>
          画布先按规划显示骨架屏，AI 光标逐页绘制，最后截图自检。自检完成前画布是只读的。
        </li>
        <li>
          <b>精修、评论、导出</b>
          直接在画布上改样式，或按 <kbd>C</kbd> 放评论让 AI 改。完成后点画板上方的导出按钮，拿到单文件 HTML。
        </li>
      </ol>

      <H2 id="hook">可选：会话压缩后自动找回画布</H2>
      <p>
        AI 靠对话里的 <code>canvas_id</code> 找回画布。Claude Code 压缩上下文后它可能丢失，此时 AI 会列出最近的画布让你选。配置下面的
        SessionStart hook 后，同一个会话会直接绑回原画布。在项目的 <code>.claude/settings.json</code> 中加入：
      </p>
      <Code lang="json">{`{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx penhold-mcp hook" }] }
    ]
  }
}`}</Code>

      <H2 id="uninstall">卸载</H2>
      <Code lang="bash">{`claude mcp remove penhold
rm -rf ~/.penhold      # 同时删除所有画布与设计系统，请先备份需要的稿子`}</Code>
    </>
  );
}
