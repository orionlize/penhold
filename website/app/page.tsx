import { CopyButton } from './components/copy-button';
import { Demo } from './components/demo';
import { FeatureExplorer } from './components/features';
import { GithubIcon } from './components/github-icon';
import { ReplayButton } from './components/replay-button';
import { ADD_CMD, CHANGELOG, CLIENTS, DOCS, INSTALL_DOC, LICENSES, NPX_CMD, REPO } from './site';

/** 随 <html data-h> 轮换的四个阶段：0 改字距 · 3 自检 · 2 插入副标题 · 1 换令牌 */
function Phases({ items }: { items: [React.ReactNode, React.ReactNode, React.ReactNode, React.ReactNode] }) {
  return (
    <>
      {items.map((it, i) => (
        <span key={i} className="ph" data-ph={i}>
          {it}
        </span>
      ))}
    </>
  );
}

const AI_ACTIONS: [string, string, string, string] = [
  '调整字距 letterSpacing -4',
  '替换令牌 color.accent',
  '插入节点：副标题',
  '截图自检中',
];

const RULER = Array.from({ length: 11 }, (_, i) => i * 120);

const LAYERS = ['官网首页 1440', '导航栏', 'H1 主标题', '副标题', '终端演示', '安装按钮'];

const MOBILE_FEATURES = [
  ['画布双向协作', 'AI 改结构，你拖边距、改颜色，互不覆盖。'],
  ['能点的原型', '交互写进稿子里，导出后照样能点。'],
  ['自带设计系统', '亮暗主题、字阶、组件存在项目里，也能从 Tailwind / shadcn 导入。'],
  ['画完先自检', '截图查问题、和上一张逐像素比对，有问题 AI 自己修。'],
  ['流程图自动成图', 'AI 写几行 Mermaid，画板间的跳转箭头自动排好。'],
  ['稿子不出你的电脑', '画布和文件都在本机，断网也能打开、能改。'],
  ['导出就能用', '单文件 HTML + tokens.css，不是截图。'],
];

const PROMISES = [
  ['稿子不出你的电脑', '画布和文件都在本机，没有上传这一步。断网也能打开、能改。'],
  ['不换工具，不开账号', '接在你正在用的 Agent 和模型上，没有席位费，也没有额度。'],
  ['交付的是能用的代码', '导出单文件 HTML 和 tokens.css，不是一张截图或一个分享链接。'],
];

const DIFF = [
  ['runtime:', 'vendor-cloud', 'local-daemon @ 127.0.0.1:4470'],
  ['transport:', 'https + web editor', 'mcp → stdio | streamable-http'],
  ['agent:', 'built-in chat only', 'any MCP client'],
  ['model:', 'vendor-locked', 'bring-your-own'],
  ['storage:', 'vendor://workspace/*', '~/.penhold/*.json  (git-able)'],
  ['auth:', 'account + oauth', 'none'],
  ['offline:', 'false', 'true'],
  ['pricing:', 'seat/month + credits', '0  # MIT, no paywall'],
  ['output:', 'png | share-link', 'index.html + tokens.css'],
];

const STEPS = [
  ['注册 MCP 服务', ADD_CMD],
  ['用自然语言描述界面', '“为记账 App 设计一个设置页，遵循现有设计系统”'],
  ['在画布中精修并交付', '本地画布实时同步，导出单文件 HTML 与设计令牌'],
];

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="eyebrow">
      <span className="eyebrow-mark" aria-hidden="true" />
      {children}
    </p>
  );
}

function Clients() {
  return (
    <div className="clients">
      <span className="clients-label">兼容的客户端</span>
      <ul>
        {CLIENTS.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

function YouCursor({ label }: { label: React.ReactNode }) {
  return (
    <>
      <i className="you-arrow" />
      <span className="you-tag">{label}</span>
    </>
  );
}

export default function Home() {
  return (
    <div className="page">
      <a className="skip" href="#main">
        跳到正文
      </a>

      <header className="nav">
        <div className="nav-inner">
          <a className="brand" href="#top" aria-label="Penhold 首页">
            <span className="brand-caret" aria-hidden="true" />
            <span className="brand-name">Penhold</span>
          </a>
          <nav className="nav-links only-desk" aria-label="主导航">
            <a href="#demo">演示</a>
            <a href="#features">能力</a>
            <a href="#compare">对比</a>
            <a href={DOCS}>文档</a>
            <a className="gh-link" href={REPO} aria-label="GitHub" title="GitHub">
              <GithubIcon />
            </a>
            <a className="nav-cta" href="#install">
              安装 MCP
            </a>
          </nav>
          <a className="nav-gh gh-link only-mob" href={REPO} aria-label="GitHub" title="GitHub">
            <GithubIcon />
          </a>
        </div>
      </header>

      <main id="main">
        {/* ───────── Hero ───────── */}
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-floor only-desk" aria-hidden="true" />
          <div className="ruler-top only-desk" aria-hidden="true">
            {RULER.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="ruler-left only-desk" aria-hidden="true" />

          <div className="float float-layers only-wide" aria-hidden="true">
            <span className="float-title">图层</span>
            {LAYERS.map((l, i) => (
              <span key={l} className={`layer${i === 2 ? ' sel' : ''}${i === 3 ? ' new' : ''}`}>
                <i />
                {i === 3 ? <Phases items={['副标题', '副标题', '+ 副标题  新插入', '副标题']} /> : l}
              </span>
            ))}
          </div>

          <div className="float float-props only-wide" aria-hidden="true">
            <span className="float-title">
              <Phases items={['属性：H1 主标题', '属性：H1 主标题', '属性：H1 主标题', '自检报告']} />
            </span>
            <span className="prop">
              <span>字号</span>
              <b>104</b>
            </span>
            <span className="prop" data-on="0">
              <span>字距</span>
              <b>
                <Phases items={['-2 → -4', '-4', '-4', '-4']} />
              </b>
            </span>
            <span className="prop" data-on="2">
              <span>字重</span>
              <b>600</b>
            </span>
            <span className="prop" data-on="1">
              <span>颜色</span>
              <b className="prop-color">
                <i />
                <Phases items={['color.primary', 'color.accent', 'color.primary', 'color.primary']} />
              </b>
            </span>
            <span className="float-foot">你改样式，AI 改结构</span>
          </div>

          <div className="hero-body">
            <p className="pill">
              <span className="pill-dot" aria-hidden="true" />
              给 Agent 用的本地设计画布，MIT 开源
            </p>

            <div className="sel">
              <span className="sel-outline" aria-hidden="true" />
              <span className="handle tl" aria-hidden="true" />
              <span className="handle tr" aria-hidden="true" />
              <span className="handle bl" aria-hidden="true" />
              <span className="handle br" aria-hidden="true" />
              <h1 id="hero-title" className="h1">
                <span className="h1-l1">你的 Agent，</span>
                <span className="h1-l2">
                  <span>现在会</span>
                  <span className="h1-l3">
                    <span className="h1-hl">画设计稿</span>
                    <span className="h1-caret only-mob" aria-hidden="true" />
                  </span>
                </span>
              </h1>
              <span className="sel-tag" aria-hidden="true">
                <Phases
                  items={[
                    <>
                      <span className="only-desk">H1  760 × 248  字距 -4</span>
                      <span className="only-mob">H1  48px  字距 -1</span>
                    </>,
                    <>
                      <span className="only-desk">H1  760 × 248</span>
                      <span className="only-mob">H1  302 × 189</span>
                    </>,
                    <>
                      <span className="only-desk">H1  760 × 248</span>
                      <span className="only-mob">H1  302 × 189</span>
                    </>,
                    '✓ 自检通过',
                  ]}
                />
              </span>
              <span className="ai-cursor" aria-hidden="true">
                <span className="ai-arrow">
                  <i />
                  <i />
                </span>
                <span className="ai-tag">
                  <b>AI</b>
                  <Phases items={AI_ACTIONS} />
                </span>
              </span>
              <span className="you-cursor only-desk" aria-hidden="true">
                <YouCursor
                  label={<Phases items={['你 · 拖动边距', '你 · 评论：标题再大一点', '你 · 改字重 600', '你 · 导出 HTML']} />}
                />
              </span>
            </div>

            <p className="hero-lede">
              跑在本机，用你已有的模型，不用注册账号。
              <span className="only-desk">你在画布上拖过的每一处边距，AI 下一步都读得到、不覆盖；</span>
              画完导出单文件 HTML。
            </p>

            <div className="hero-cta">
              <ReplayButton className="btn-primary only-desk">
                <i className="btn-caret" aria-hidden="true" />
                看它画一遍
              </ReplayButton>
              <div className="cmd">
                <code>$ {NPX_CMD}</code>
                <CopyButton text={NPX_CMD} className="cmd-copy" />
              </div>
            </div>
          </div>
        </section>

        {/* ───────── 演示（桌面端） ───────── */}
        <Demo />

        {/* ───────── 能力 ───────── */}
        <section id="features" className="features" aria-labelledby="features-title">
          <div className="wrap only-desk">
            <div className="section-head">
              <Eyebrow>Frame 02 / 能力</Eyebrow>
              <h2 id="features-title" className="h2">
                一块画布，Agent 和你一起用
              </h2>
            </div>
            <FeatureExplorer />
          </div>

          <div className="m-section m-features only-mob">
            <div className="section-head">
              <Eyebrow>01 / 特点</Eyebrow>
              <h2 className="h2">
                一块画布，
                <br />
                Agent 和你一起用
              </h2>
            </div>
            <ol className="m-feat-list">
              {MOBILE_FEATURES.map(([t, d], i) => (
                <li key={t}>
                  <span className="m-feat-no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="m-feat-text">
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ───────── 对比（桌面端） ───────── */}
        <section id="compare" className="compare wrap only-desk" aria-labelledby="compare-title">
          <div className="compare-head">
            <div className="section-head">
              <Eyebrow>Frame 03 / 对比</Eyebrow>
              <h2 id="compare-title" className="h2">
                把设计工具从云端搬回本机
              </h2>
            </div>
            <p className="compare-intro">同样是 AI 出设计稿，差别在稿子放在哪、归谁管。先看三句人话，再看逐行的配置对比。</p>
          </div>

          <div className="promises">
            {PROMISES.map(([t, d]) => (
              <div key={t} className="promise">
                <h3 className="h3">{t}</h3>
                <p className="muted">{d}</p>
              </div>
            ))}
          </div>

          <figure className="diff" aria-label="云端 AI 设计工具与 Penhold 的配置逐行对比">
            <div className="diff-bar">
              <span className="diff-cmd">
                <span className="muted">$</span>
                <span>git diff --no-index cloud-ai-design.yaml penhold.yaml</span>
              </span>
              <span className="diff-stat">
                <span className="mono-xs muted">9 changes</span>
                <span className="diff-blocks" aria-hidden="true">
                  <i />
                  <i />
                  <i className="on" />
                  <i className="on" />
                  <i className="on" />
                </span>
              </span>
            </div>
            <div className="diff-files">
              <span className="diff-file">
                <span className="mono-xs muted">a/</span>
                <span className="mono-xs muted">cloud-ai-design.yaml</span>
              </span>
              <span className="diff-file">
                <span className="diff-file-b">
                  <span className="mono-xs muted">b/</span>
                  <b className="mono-xs">penhold.yaml</b>
                </span>
                <span className="tag fg">MIT</span>
              </span>
            </div>
            <div className="diff-body">
              {DIFF.map(([k, a, b], i) => (
                <div key={k} className="diff-row" data-row={i}>
                  <span className="diff-cell del">
                    <span className="ln">{i + 1}</span>
                    <span className="sign">-</span>
                    <span className="key">{k}</span>
                    <s>{a}</s>
                  </span>
                  <span className="diff-cell add">
                    <span className="ln">{i + 1}</span>
                    <span className="sign">+</span>
                    <span className="key">{k}</span>
                    <b>{b}</b>
                  </span>
                </div>
              ))}
            </div>
            <div className="diff-foot">
              <span className="diff-metric">
                <b>¥0</b>
                <span>费用</span>
              </span>
              <span className="diff-metric">
                <b>1 行</b>
                <span>安装命令</span>
              </span>
              <span className="diff-metric">
                <b>0 B</b>
                <span>设计稿上传量</span>
              </span>
              <span className="mono-xs fg diff-ready">✓ ready to merge</span>
            </div>
          </figure>
        </section>

        {/* ───────── 接入 ───────── */}
        <section id="install" className="install" aria-labelledby="install-title">
          <div className="wrap install-desk only-desk">
            <div className="install-left">
              <div className="install-copy">
                <Eyebrow>Frame 04 / 接入</Eyebrow>
                <h2 id="install-title" className="h2">
                  一行配置，即刻接入
                </h2>
                <p className="lead muted">
                  Penhold MCP 以标准 MCP 服务运行，无需账号与 API Key。你现有的 Agent 即刻获得设计能力，模型、数据与产物始终由你掌控。
                </p>
              </div>
              <div className="install-actions">
                <a className="btn-primary" href={INSTALL_DOC}>
                  <i className="btn-caret" aria-hidden="true" />
                  安装 MCP
                </a>
                <a className="text-link" href={DOCS}>
                  先读文档
                </a>
              </div>
            </div>
            <div className="install-right">
              <ol className="step-cards">
                {STEPS.map(([t, d], i) => (
                  <li key={t} className="step-card">
                    <span className="step-no">{String(i + 1).padStart(2, '0')}</span>
                    <span className="step-text">
                      <h3>{t}</h3>
                      <code>{d}</code>
                    </span>
                  </li>
                ))}
              </ol>
              <Clients />
            </div>
          </div>

          <div className="m-section m-install only-mob">
            <div className="m-install-head">
              <div className="section-head">
                <Eyebrow>02 / 安装</Eyebrow>
                <h2 className="h2">一行配置，即刻接入</h2>
              </div>
              <p className="muted">标准 MCP 服务，无需账号与 API Key。</p>
            </div>
            <ol className="timeline">
              <li className="tl-step active">
                <span className="tl-rail" aria-hidden="true">
                  <span className="tl-dot">1</span>
                  <span className="tl-line" />
                </span>
                <span className="tl-body">
                  <h3>把 MCP 加进你的 Agent</h3>
                  <span className="tl-cmd">
                    <code>{ADD_CMD}</code>
                    <CopyButton text={ADD_CMD} className="tl-copy" />
                  </span>
                </span>
              </li>
              <li className="tl-step">
                <span className="tl-rail" aria-hidden="true">
                  <span className="tl-dot">2</span>
                  <span className="tl-line" />
                </span>
                <span className="tl-body">
                  <h3>用一句话描述界面</h3>
                  <p>“为记账 App 设计一个设置页”</p>
                </span>
              </li>
              <li className="tl-step">
                <span className="tl-rail" aria-hidden="true">
                  <span className="tl-dot">3</span>
                </span>
                <span className="tl-body">
                  <h3>在画布里精修、导出</h3>
                  <p>浏览器里实时同步，导出单文件 HTML。</p>
                </span>
              </li>
            </ol>
            <Clients />
            <div className="m-actions">
              <a className="btn-primary" href={INSTALL_DOC}>
                <i className="btn-caret" aria-hidden="true" />
                安装 MCP
              </a>
              <a className="m-doc-link" href={DOCS}>
                先读文档
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-brand">
          <span className="footer-caret" aria-hidden="true" />
          <span className="footer-name">Penhold</span>
          <span className="footer-license">MIT License</span>
        </div>
        <nav className="footer-links" aria-label="页脚">
          <a href={DOCS}>文档</a>
          <a className="gh-link" href={REPO} aria-label="GitHub" title="GitHub">
            <GithubIcon />
          </a>
          <a className="only-desk" href={CHANGELOG}>
            更新日志
          </a>
          <a className="only-desk" href={LICENSES}>
            第三方许可
          </a>
        </nav>
      </footer>
    </div>
  );
}
