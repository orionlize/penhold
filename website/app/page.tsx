const REPO = 'https://github.com/orionlize/penhold';

const steps = [
  {
    no: '01',
    tool: 'design_plan',
    title: '先声明，再动笔',
    body: 'AI 一次声明本轮全部页面，画布立刻建好画板并显示骨架屏，顶栏实时显示每页的进度。',
  },
  {
    no: '02',
    tool: 'node_insert',
    title: '按设计系统绘制',
    body: '颜色、字阶、间距都取自项目的设计系统令牌。插入的子树按深度优先逐个显示，AI 光标跟随当前节点。',
  },
  {
    no: '03',
    tool: 'design_screenshot',
    title: '截图自检后交还',
    body: '对比度、点击区域、位图缩放、交互状态逐项检查，问题修完才释放编辑锁，交给你接手。',
  },
];

const features = [
  {
    title: '设计系统',
    body: '亮 / 暗主题、字阶、文字样式、组件与品牌手册存为项目级系统；可从 Tailwind、shadcn 的 CSS 变量直接导入。',
  },
  {
    title: '可交互原型',
    body: 'tab 切换、短信倒计时、表单校验、跨页跳转用 proto 描述，画布内全屏播放，导出后仍可试用。',
  },
  {
    title: '交互状态检查',
    body: '自动探索点击、输入、计时后可到达的状态，逐个渲染检查，找出选中态跳动、死链与永远不显示的元素。',
  },
  {
    title: '先问需求',
    body: '信息不足时在画布上出问卷与三张差异明显的方向卡片，避免千篇一律的默认配色与版式。',
  },
  {
    title: '业务流程批注',
    body: '画板之间用箭头标注跳转，说明框写清进入条件、业务规则与待确认问题，不混进设计稿。',
  },
  {
    title: '单文件 HTML 导出',
    body: '导出自包含的 HTML，内嵌交互脚本与浮动 Tweaks 面板，发给任何人用浏览器打开即可。',
  },
];

const install = `git clone ${REPO}.git
cd penhold
npm install && npm run build

# 注册到 Claude Code（其他 stdio MCP 客户端同理）
claude mcp add design -- node "$PWD/dist/server/cli.js"`;

function CanvasMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-bar">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="mock-progress">
          绘制中 · 2 / 3 页
          <span className="mock-track">
            <span className="mock-fill" />
          </span>
        </span>
      </div>
      <div className="mock-body">
        <div className="mock-stage">
          <div className="board">
            <div className="board-name">登录 · 已完成</div>
            <div className="board-screen">
              <div className="b-title" />
              <div className="b-sub" />
              <div className="b-input" />
              <div className="b-input" />
              <div className="b-btn" />
            </div>
          </div>
          <div className="board board-active">
            <div className="board-name">首页 · 绘制中</div>
            <div className="board-screen">
              <div className="b-hero" />
              <div className="b-row">
                <div className="b-card" />
                <div className="b-card" />
              </div>
              <div className="b-line" />
              <div className="b-line short" />
              <div className="cursor">
                <svg width="14" height="16" viewBox="0 0 14 16">
                  <path d="M1 1 L13 9 L7 10 L4 15 Z" />
                </svg>
                <span>AI · 推荐卡片</span>
              </div>
            </div>
          </div>
          <div className="board board-ghost">
            <div className="board-name">个人中心 · 待绘制</div>
            <div className="board-screen">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton short" />
            </div>
          </div>
        </div>
        <div className="mock-panel">
          <div className="panel-label">盒模型</div>
          <div className="boxmodel">
            <div className="bm-pad">
              <span>16</span>
              <div className="bm-core">卡片</div>
            </div>
          </div>
          <div className="panel-label">样式</div>
          <div className="prop">
            <span>背景</span>
            <span className="swatch" />
          </div>
          <div className="prop">
            <span>圆角</span>
            <span className="val">{'{radius.md}'}</span>
          </div>
          <div className="prop">
            <span>字号</span>
            <span className="val">15</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      <header className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="#top">
            <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 3 L24 17 L16 29 L8 17 Z" fill="currentColor" />
              <circle cx="16" cy="14" r="2.4" className="nib-hole" />
            </svg>
            penhold
          </a>
          <nav className="nav-links">
            <a href="#how">工作方式</a>
            <a href="#features">能力</a>
            <a href="#start">快速开始</a>
            <a href={REPO} className="nav-gh">
              GitHub
            </a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero wrap">
          <p className="eyebrow">MCP · 本地运行 · 开源</p>
          <h1>
            AI 执笔起稿，
            <br />
            你来定稿。
          </h1>
          <p className="lede">
            penhold 是一块本地设计画布。AI 通过 MCP 工具绘制、修改、读取 UI 稿；你在浏览器里直接微调盒模型与样式，最后导出单文件
            HTML。
          </p>
          <div className="cta">
            <a className="btn btn-primary" href="#start">
              快速开始
            </a>
            <a className="btn btn-ghost" href={REPO}>
              在 GitHub 查看
            </a>
          </div>
          <CanvasMock />
        </section>

        <section className="split wrap">
          <div>
            <h2>分工明确，互不覆盖</h2>
            <p>
              结构交给 AI：位置、顺序、层级与布局只由 AI 修改。细节留给你：在画布上改间距、颜色、圆角、文字。AI 续改前会先读取你的手动改动，不会覆盖。
            </p>
          </div>
          <dl className="roles">
            <div>
              <dt>AI</dt>
              <dd>页面规划 · 布局与层级 · 组件实例化 · 交互逻辑 · 自检</dd>
            </div>
            <div>
              <dt>你</dt>
              <dd>盒模型 · 样式 · 文字编辑 · 评论与便签 · Tweaks 调节</dd>
            </div>
          </dl>
        </section>

        <section id="how" className="wrap section">
          <h2>一轮出稿的三个阶段</h2>
          <ol className="steps">
            {steps.map((s) => (
              <li key={s.no}>
                <span className="step-no">{s.no}</span>
                <code className="step-tool">{s.tool}</code>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="wrap section">
          <h2>不止是把框画出来</h2>
          <div className="grid">
            {features.map((f) => (
              <article key={f.title} className="feature">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="start" className="wrap section start">
          <div>
            <h2>快速开始</h2>
            <p>
              需要 Node.js 20 及以上。首次调用时 stdio 代理会自动拉起守护进程（默认端口 4470），AI 开始绘制时自动用默认浏览器打开画布。
            </p>
            <p className="muted">
              守护进程只监听 127.0.0.1，设计稿保存在 <code>~/.design-mcp</code>，不会上传到任何服务。
            </p>
          </div>
          <pre className="code">
            <code>{install}</code>
          </pre>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>penhold-mcp · MIT License</span>
          <a href={REPO}>github.com/orionlize/penhold</a>
        </div>
      </footer>
    </>
  );
}
