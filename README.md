# Penhold

**本地 AI 设计画布。** 让你的 AI Agent（Claude Code、Cursor、Codex CLI 等）通过 MCP 直接在浏览器画布上画 UI 稿，你在画布上微调样式、放评论让它改，最后导出可直接打开、能点的单文件 HTML。

[官网与文档](https://website-duck-4bf0.vercel.app) · [安装](https://website-duck-4bf0.vercel.app/docs/install) · [接入客户端](https://website-duck-4bf0.vercel.app/docs/clients)

## 特点

- **AI 画结构，你调样式**：AI 负责页面结构、布局与层级；你在画布上拖边距、改颜色字号，双方的改动互不覆盖，都能撤销。
- **会自检**：每轮绘制后 AI 都会截图检查溢出、重叠、文字换行、对比度、触控目标等问题，修好才交稿。
- **能点的原型**：tab 切换、弹窗、倒计时、表单校验、跨页跳转直接写进稿子，画布上可播放，导出后照样能点。
- **自带设计系统**：亮 / 暗主题、字阶、文字样式、间距与组件存进项目，同一项目的画稿共用；也能从 Tailwind / shadcn 的 CSS 变量导入。信息不足时先在画布上出问卷，问清视觉偏好再画。
- **导出就能用**：单文件 HTML（可选带交互脚本与 Tweaks 面板）加 `tokens.css`，不是截图。
- **全在本机**：画布与文件都存在你的电脑上，不需要账号或 API Key，用的就是你的 Agent 当前的模型。

## 安装

需要 Node.js 20 或更高版本，以及一个桌面浏览器。

**Claude Code**

```bash
claude mcp add penhold -- npx penhold-mcp
# 所有项目都可用
claude mcp add --scope user penhold -- npx penhold-mcp
```

**Cursor**：编辑 `~/.cursor/mcp.json` 或项目内的 `.cursor/mcp.json`（Claude Code 的项目级 `.mcp.json` 写法相同）：

```json
{
  "mcpServers": {
    "penhold": { "command": "npx", "args": ["penhold-mcp"] }
  }
}
```

**Codex CLI**：编辑 `~/.codex/config.toml`：

```toml
[mcp_servers.penhold]
command = "npx"
args = ["penhold-mcp"]
```

**其他客户端**：stdio 命令是 `npx penhold-mcp`，不带参数。也可以直连守护进程的 Streamable HTTP 端点 `http://127.0.0.1:<port>/mcp`，请求头带 `Authorization: Bearer <token>`，端口与令牌见 `~/.penhold/daemon.json`。

首次调用时会自动在后台启动守护进程（默认端口 4470，被占用时递增），AI 开始画稿时自动用默认浏览器打开画布。

### 可选：会话压缩后自动找回画布

Claude Code 压缩上下文后，AI 可能丢掉画布 id。在项目的 `.claude/settings.json` 中加入 SessionStart hook，同一个会话会自动绑回原画布：

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "npx penhold-mcp hook" }] }]
  }
}
```

## 使用

1. 注册后重开一个 Agent 会话，让客户端加载 MCP 服务（Claude Code 里可用 `/mcp` 确认 `penhold` 已连接）。
2. 用自然语言描述界面，例如“为记账 App 设计一个移动端的设置页”。
3. 项目里还没有设计依据时，画布上会弹出问卷（产品、视觉方向、主色、明暗等），每题都可以不填，也可以交给 AI 决定。
4. 画布先显示页面骨架，AI 逐页绘制并截图自检；自检完成前画布只读。
5. 在画布上精修样式，或按 <kbd>C</kbd> 放评论让 AI 改；完成后点画板上方的导出按钮。

已有画稿可以随时打开：`npx penhold-mcp open` 打开首页（列出本机所有画布与设计系统）。也可以让 AI 把画稿转成代码：它会读取画稿结构、截图作为视觉基准，再逐个组件实现。

## 命令

| 命令 | 作用 |
| --- | --- |
| `penhold-mcp` | stdio MCP 服务（客户端调用的就是它） |
| `penhold-mcp open [canvasId]` | 打开画布首页或指定画布 |
| `penhold-mcp daemon` | 在前台运行守护进程 |
| `penhold-mcp hook` | Claude Code SessionStart hook |
| `penhold-mcp --version` | 显示版本 |

## 配置

环境变量写在 MCP 客户端配置的 `env` 字段里。

| 变量 | 说明 |
| --- | --- |
| `DESIGN_MCP_HOME` | 数据目录，默认 `~/.penhold`（旧版的 `~/.design-mcp` 首次运行时自动迁移过来） |
| `DESIGN_MCP_PORT` | 起始端口，默认 4470 |
| `DESIGN_MCP_CANVAS` | 固定绑定某个画布 |
| `DESIGN_MCP_NO_BROWSER=1` | 不自动打开浏览器（手动打开 URL） |
| `DESIGN_MCP_BROWSER_TIMEOUT_MS` | 写工具等待画布页面连接的超时，默认 20000 |
| `DESIGN_MCP_GUIDES` | 额外的设计规范文件或目录（多个用 `:` 分隔，相对路径按项目目录解析），AI 画稿前优先阅读 |
| `DESIGN_MCP_IDLE_MS` | 守护进程空闲退出时间，默认 30 分钟 |
| `DESIGN_MCP_PLAN_IDLE_MS` | 有未开始的规划页面时编辑锁的空闲超时，默认 120000 |
| `DESIGN_MCP_IMAGES` | 设为 `off` 关闭 `design_image` 图片搜索（搜索词会发送给 Openverse 图库） |
| `DESIGN_MCP_ASK_WAIT_MS` | `design_ask` 单次等待用户回答问卷的时间，默认 50000；客户端工具调用超时更短时调小 |

AI 会自动读取项目里已有的设计规范：设计相关的 skill（项目内或 `~/.claude/skills`）、`DESIGN.md`、`design-system.md`、`STYLEGUIDE.md`、`docs/design*.md` 等。

## 隐私

守护进程只监听 `127.0.0.1`，画布、设计系统与导出文件都保存在 `~/.penhold`。唯一的外部请求是 `design_image` 找图（发送搜索词到 Openverse，可用 `DESIGN_MCP_IMAGES=off` 关闭）以及下载你或 AI 指定的图片。

## 从源码运行

```bash
git clone https://github.com/orionlize/penhold.git
cd penhold
npm install
npm run build
claude mcp add penhold -- node /绝对路径/penhold/dist/server/cli.js
```

重新构建后不用手动重启，代理发现守护进程来自旧构建时会自动平滑重启它。代码结构、实现细节与各功能的约定见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，最初的设计方案见 [docs/PRD.md](docs/PRD.md)。

## 许可证

[MIT](LICENSE)。内置设计预设与默认设计规范包含第三方内容，署名与许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
