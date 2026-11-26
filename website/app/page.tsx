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
  ['自带设计系统', '颜色主题、字阶、组件存在项目里，也能从 Tailwind / shadcn 导入。'],
  ['画完先自检', '截图查问题、和上一张逐像素比对，有问题 AI 自己修。'],
  ['流程图自动成图', 'AI 写几行 Mermaid，画板间的跳转箭头自动排好。'],
  ['按迭代分画布', '每轮新页面另开画布，跨画布链接到旧页面，画布不会越画越大。'],
  ['稿子不出你的电脑', '画布和文件都在本机，断网也能打开、能改。'],
  ['导出就能用', '单文件 HTML + tokens.css，不是截图。'],
];

/** 对比区：独立开发者的顾虑 → Penhold 怎么做 → OpenPencil 那边 */
const PAINS = [
  ['不知道要做成什么样', 'AI 先问你几个问题：做什么产品、要哪几页、喜欢什么感觉，再动手。', '得先自己想清楚，再开始画。'],
  ['不会配色和排版', '给你 3 种风格挑一种，浅色、深色两套自动配好，每一页都照着它来。', '颜色、字体、组件由你来挑。'],
  ['怕一看就是 AI 做的', '列表页、详情页、表单各按成熟的做法排版，避开千篇一律的模板套路。', '做得好不好，看你自己的功力。'],
  ['怕交出来有低级错误', '文字溢出、按钮太多、层级不清、配色看不清，交给你之前它会自己查一遍改掉。', '能查对比度、字太小、图层命名。'],
  ['想先点一点试试', '画完就能点：切换 tab、倒计时、表单校验、页面跳转都能用。', '预览里能拨开关、拖滑块。'],
  ['想自己改两笔', '直接在画布上拖间距、换颜色；看不顺眼就留条评论，AI 照着改。', '每一处都能自己动手改，还能多人一起改。'],
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

        {/* ───────── 对比 ───────── */}
        <section id="compare" className="compare" aria-labelledby="compare-title">
          <div className="compare-inner">
            <div className="compare-head">
              <div className="section-head">
                <Eyebrow>
                  <span className="only-desk">Frame 03 / 对比</span>
                  <span className="only-mob">02 / 对比</span>
                </Eyebrow>
                <h2 id="compare-title" className="h2">
                  <span className="only-desk">
                    OpenPencil 帮你画，
                    <br />
                    Penhold 替你画完
                  </span>
                  <span className="only-mob">
                    帮你画，
                    <br />
                    还是替你画完
                  </span>
                </h2>
              </div>
              <p className="compare-intro">
                独立开发没有设计师。OpenPencil 是开源的 Figma，适合会画图的人；Penhold 让你手边的 AI 直接把界面设计好、自己检查一遍，你只管看和提意见。
              </p>
            </div>

            <div className="pain-stage">
              <div className="pain-floor-clip" aria-hidden="true">
                <div className="pain-floor" />
              </div>
              <ul className="pain-grid">
                {PAINS.map(([q, p, o], i) => (
                  <li key={q} className="pain-card" data-card={i}>
                    <h3>{q}</h3>
                    <p>{p}</p>
                    <p className="pain-other">OpenPencil：{o}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="verdict">
              <p className="pick">
                <span>适合用 OpenPencil</span>
                你会用 Figma，想自己动手画。
              </p>
              <p className="pick us">
                <span>适合用 Penhold</span>
                你没有设计师，想让 AI 把界面做好，你来拍板。
              </p>
            </div>
          </div>
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
                <Eyebrow>03 / 安装</Eyebrow>
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
