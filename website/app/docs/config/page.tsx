import { docMeta } from '../nav';
import { Code, DocHead, H2, Table } from '../ui';

export const metadata = docMeta('config');

export default function Config() {
  return (
    <>
      <DocHead
        eyebrow="Docs / 参考"
        title="命令与配置"
        lede="命令行子命令、环境变量和数据目录。默认值对大多数人都够用，需要时再改。"
      />

      <H2 id="cli">命令行</H2>
      <Table
        head={['命令', '作用']}
        rows={[
          [<code key="c">penhold-mcp</code>, 'stdio MCP 服务（薄代理），由 Agent 客户端启动；首次调用时自动拉起守护进程'],
          [<code key="c">penhold-mcp daemon</code>, '在前台运行守护进程，排查问题时可以直接看日志'],
          [<code key="c">penhold-mcp open [画布 id]</code>, '确保守护进程在运行，打开画布首页或指定画布，并打印地址'],
          [<code key="c">penhold-mcp hook</code>, 'Claude Code 的 SessionStart hook，从 stdin 读取会话 JSON'],
          [<code key="c">penhold-mcp --version</code>, '打印版本号'],
        ]}
      />
      <p>
        没有全局安装时在前面加 <code>npx</code>，例如 <code>npx penhold-mcp open</code>。
      </p>

      <H2 id="env">环境变量</H2>
      <p>
        写在 MCP 客户端配置的 <code>env</code> 字段里，或者在启动守护进程前导出。
      </p>
      <Table
        head={['变量', '默认', '说明']}
        rows={[
          ['DESIGN_MCP_HOME', '~/.penhold', '数据目录。旧版本的 ~/.design-mcp 会在首次运行时自动迁移过来'],
          ['DESIGN_MCP_PORT', '4470', '起始端口，被占用时递增'],
          ['DESIGN_MCP_NO_BROWSER', '—', '设为 1 不自动打开浏览器，需要你手动打开画布地址'],
          ['DESIGN_MCP_BROWSER_TIMEOUT_MS', '20000', '写工具等待画布页面连上的超时'],
          ['DESIGN_MCP_CANVAS', '—', '把会话固定绑定到某个画布 id'],
          ['DESIGN_MCP_GUIDES', '—', '额外的设计规范文件或目录，多个用 : 分隔，相对路径按项目目录解析；排在设计规范列表最前'],
          ['DESIGN_MCP_IMAGES', '开启', '设为 off 关闭找图。开启时搜索词会发送给 Openverse 图库（免密钥）'],
          ['DESIGN_MCP_ASK_WAIT_MS', '50000', '问卷单次等待用户回答的时间'],
          ['DESIGN_MCP_LOCK_IDLE_MS', '30000', 'AI 空闲多久后释放编辑锁'],
          ['DESIGN_MCP_PLAN_IDLE_MS', '120000', '规划里还有未开始的页面时，编辑锁的空闲超时'],
          ['DESIGN_MCP_IDLE_MS', '1800000', '守护进程空闲多久后自动退出（30 分钟）'],
        ].map(([a, b, c]) => [<code key="a">{a}</code>, b, c])}
      />
      <Code lang=".mcp.json">{`{
  "mcpServers": {
    "penhold": {
      "command": "npx",
      "args": ["penhold-mcp"],
      "env": { "DESIGN_MCP_GUIDES": "docs/brand.md", "DESIGN_MCP_IMAGES": "off" }
    }
  }
}`}</Code>

      <H2 id="data">数据目录</H2>
      <Code lang="~/.penhold/" copy={false}>{`daemon.json          # 守护进程的 pid、端口、令牌
token                # MCP 端点令牌（权限 600）
index.json           # 画布索引：标题、工作目录、会话别名
daemon.log           # 守护进程日志
canvases/<画布 id>/
  design.json        # 设计稿快照
  ops.jsonl          # 修改日志（含逆操作，用于撤销与恢复）
  session.json       # 标题、工作目录、选定的方向 / 预设 / 设计系统、问卷回答
  annotations.json   # 评论、便签、手绘与 AI 批注
  snapshots/         # 检查点与命名版本
  assets/images/     # 图片（按内容哈希命名）
  exports/           # 导出的 HTML
systems/<系统 id>/    # 设计系统：system.json、README.md、tokens.css、tokens.json
trash/               # 删除的画布与设计系统`}</Code>
      <p>想备份或迁移，复制整个目录即可。</p>

      <H2 id="security">安全</H2>
      <ul>
        <li>守护进程只监听 127.0.0.1，并校验 Host 与 Origin，局域网里的其他设备访问不到。</li>
        <li>
          画布网页无需令牌即可打开；MCP 端点 <code>/mcp</code> 需要令牌，stdio 代理会自动携带。
        </li>
        <li>除了你主动开启的找图（发送搜索词给 Openverse），不会向外部发送任何数据。</li>
      </ul>
    </>
  );
}
