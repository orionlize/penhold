import { docMeta } from '../nav';
import { Code, DocHead, H2, Note } from '../ui';

export const metadata = docMeta('clients');

export default function Clients() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 接入客户端"
        title="接入客户端"
        lede="Penhold 是标准的 MCP 服务，支持 stdio 和 Streamable HTTP 两种接法。任何能配置 MCP 的客户端都能用。"
      />

      <H2 id="claude-code">Claude Code</H2>
      <Code lang="bash">{`# 当前项目
claude mcp add penhold -- npx penhold-mcp

# 所有项目
claude mcp add --scope user penhold -- npx penhold-mcp`}</Code>
      <p>
        也可以写进项目根目录的 <code>.mcp.json</code>，提交到仓库后团队成员打开项目即可使用：
      </p>
      <Code lang=".mcp.json">{`{
  "mcpServers": {
    "penhold": { "command": "npx", "args": ["penhold-mcp"] }
  }
}`}</Code>

      <H2 id="cursor">Cursor</H2>
      <p>
        编辑 <code>~/.cursor/mcp.json</code>（全局）或项目内的 <code>.cursor/mcp.json</code>：
      </p>
      <Code lang="mcp.json">{`{
  "mcpServers": {
    "penhold": { "command": "npx", "args": ["penhold-mcp"] }
  }
}`}</Code>

      <H2 id="codex">Codex CLI</H2>
      <p>
        编辑 <code>~/.codex/config.toml</code>：
      </p>
      <Code lang="config.toml">{`[mcp_servers.penhold]
command = "npx"
args = ["penhold-mcp"]`}</Code>

      <H2 id="other">其他 stdio 客户端</H2>
      <p>
        命令是 <code>npx penhold-mcp</code>，没有参数。从源码运行时换成 <code>node /绝对路径/penhold/dist/server/cli.js</code>。需要传环境变量（如{' '}
        <code>DESIGN_MCP_NO_BROWSER=1</code>）时写在客户端配置的 <code>env</code> 字段里，完整列表见命令与配置。
      </p>

      <H2 id="http">直连 HTTP 端点</H2>
      <p>不方便启动子进程的客户端可以直接连守护进程的 Streamable HTTP 端点：</p>
      <Code lang="bash">{`# 先确保守护进程在运行（会打印画布首页地址）
npx penhold-mcp open

# 端口与令牌
cat ~/.penhold/daemon.json     # {"port":4470,"token":"…",…}`}</Code>
      <Code lang="json">{`{
  "mcpServers": {
    "penhold": {
      "url": "http://127.0.0.1:4470/mcp",
      "headers": { "Authorization": "Bearer <daemon.json 里的 token>" }
    }
  }
}`}</Code>
      <Note kind="warn">
        <p>守护进程空闲 30 分钟会退出，重新启动后端口可能变化。长期使用建议走 stdio，代理会自动拉起守护进程并携带令牌。</p>
        <p>
          直连时 AI 读不到你本机的设计规范文件，可以让它调用 <code>design_preset()</code>（不带参数）拿到内置规范全文。
        </p>
      </Note>

      <H2 id="timeout">工具调用超时</H2>
      <p>
        <code>design_ask</code> 会在画布上等你填问卷，默认最多等 50 秒，超时后返回 <code>waiting</code>，AI 会提醒你去填写并再次等待。如果你的客户端工具超时短于 50 秒，把{' '}
        <code>DESIGN_MCP_ASK_WAIT_MS</code> 调小。
      </p>
    </>
  );
}
