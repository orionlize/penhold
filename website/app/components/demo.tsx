'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { REPLAY_EVENT } from './replay-button';
import { Resend } from './ticker';

type DemoId = 'site' | 'login' | 'dash';

const DEMOS: Record<
  DemoId,
  { tab: string; prompt: string; canvas: string; plan: string; insertA: string; insertB: string }
> = {
  site: {
    tab: '开源工具官网',
    prompt: '给我的开源 CLI 工具画一个深色官网首页，要有终端演示',
    canvas: '画布 · 官网首页',
    plan: '(官网首页 · 1440)',
    insertA: '(顶部导航 + Hero)',
    insertB: '(终端演示 + 特性)',
  },
  login: {
    tab: '移动端登录页',
    prompt: '画一个移动端登录页，支持短信验证码和 60 秒倒计时',
    canvas: '画布 · 登录页',
    plan: '(登录页 · 390)',
    insertA: '(手机号 + 验证码表单)',
    insertB: '(倒计时交互 proto)',
  },
  dash: {
    tab: 'SaaS 数据看板',
    prompt: '做一个 SaaS 数据看板：侧边栏、4 个指标卡和趋势图',
    canvas: '画布 · 数据看板',
    plan: '(数据看板 · 1440)',
    insertA: '(侧边栏 + 指标卡)',
    insertB: '(趋势图 + 明细表)',
  },
};

/** 回放进度：从 20 倒数到 0，每步 380ms。数值越小越接近完成。 */
const STEPS = 20;
const STEP_MS = 380;

function status(s: number) {
  if (s > 14) return '等待连接';
  if (s > 9) return '待绘制';
  if (s > 5) return '绘制中';
  if (s > 3) return '自检中';
  return '已完成';
}

export function Demo() {
  const [demo, setDemo] = useState<DemoId>('site');
  const [s, setS] = useState(STEPS);
  const timer = useRef<number | undefined>(undefined);
  const root = useRef<HTMLElement>(null);

  const replay = useCallback(() => {
    clearInterval(timer.current);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setS(0);
      return;
    }
    setS(STEPS);
    timer.current = window.setInterval(() => {
      setS((v) => {
        if (v <= 1) clearInterval(timer.current);
        return Math.max(0, v - 1);
      });
    }, STEP_MS);
  }, []);

  // 滚到可见时才开始第一次回放
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          replay();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    window.addEventListener(REPLAY_EVENT, replay);
    return () => {
      io.disconnect();
      window.removeEventListener(REPLAY_EVENT, replay);
      clearInterval(timer.current);
    };
  }, [replay]);

  const d = DEMOS[demo];
  const off = (n: number) => (s > n ? ' off' : '');

  const calls = [
    { name: 'canvas_open', arg: '(new: true)', out: '画布已在浏览器打开 · 127.0.0.1:4470', at: 14 },
    { name: 'design_plan', arg: d.plan, out: '已建 1 个画板，画布显示骨架屏', at: 12 },
    { name: 'design_system', arg: '(action: create)', out: '主题 + 2 种备选风格 · 10 种文字样式 · 对比度已修正', at: 11 },
    { name: 'node_insert', arg: d.insertA, out: '插入 18 个节点 · 画布逐个回放', at: 9 },
    { name: 'node_insert', arg: d.insertB, out: '插入 26 个节点 · 可在画布里点播放试用', at: 7 },
    { name: 'design_screenshot', arg: '(自检)', out: '0 溢出 · 0 低对比度 · 交互状态全部通过', at: 5 },
  ];

  const aiPos = s <= 9 && s > 7 ? 'p1' : s <= 7 && s > 5 ? 'p2' : s <= 5 && s > 3 ? 'p3' : 'p0';

  return (
    <section id="demo" ref={root} className="demo wrap only-desk" aria-labelledby="demo-title">
      <div className="demo-head">
        <div className="section-head">
          <p className="eyebrow">
            <span className="eyebrow-mark" aria-hidden="true" />
            Frame 01 / 工作流
          </p>
          <h2 id="demo-title" className="h2">
            在终端里说，在画布上看
          </h2>
        </div>
        <div className="demo-controls">
          <span className="demo-hint">换个提示词试试</span>
          {(Object.keys(DEMOS) as DemoId[]).map((id) => (
            <button
              key={id}
              type="button"
              className="chip"
              aria-pressed={demo === id}
              onClick={() => {
                setDemo(id);
                replay();
              }}
            >
              {DEMOS[id].tab}
            </button>
          ))}
          <button type="button" className="ghost-btn" onClick={replay}>
            重新播放
          </button>
        </div>
      </div>

      <div className="demo-stage">
        {/* 终端 */}
        <div className="term-frame">
          <div className="term">
            <div className="term-bar">
              <span className="dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="mono-xs muted">claude — ~/my-project</span>
              <span className="term-mcp">
                <i aria-hidden="true" />
                MCP · penhold 已连接
              </span>
            </div>
            <div className="term-body" aria-live="off">
              <div className={`term-prompt rv${off(19)}`}>
                <span className="term-gt">&gt;</span>
                <span className={`term-typed${s > 18 ? ' reset' : ''}`}>{d.prompt}</span>
              </div>
              <div className={`term-status rv${off(15)}`}>
                <span className="term-star">✻</span>
                <span>{s > 4 ? '正在调用 Penhold MCP …' : '共调用 6 个 MCP 工具，用时 6.8s'}</span>
              </div>
              {calls.map((c, i) => (
                <div key={i} className={`term-call rv clip${off(c.at)}`}>
                  <div className="term-call-head">
                    <i aria-hidden="true" />
                    <span className="term-call-name">penhold.{c.name}</span>
                    <span className="muted">{c.arg}</span>
                  </div>
                  <div className="term-call-out">⎿  {c.out}</div>
                </div>
              ))}
              <div className={`term-done rv clip${off(3)}`}>
                <span className="term-check">✓</span>
                <span>完成。去画布里拖一拖边距，或者直接导出 HTML</span>
              </div>
            </div>
            <div className="term-input">
              <span className="muted">&gt;</span>
              <i className="term-caret" aria-hidden="true" />
            </div>
          </div>
        </div>

        {/* MCP 连线 */}
        <div className="link" aria-hidden="true">
          <span className="link-line" />
          <span className="link-dot" />
          <span className="link-badge">
            <b>MCP</b>
            <span className="mono-xs muted">stdio</span>
          </span>
        </div>

        {/* 画布 */}
        <div className="cv-frame">
          <div className="cv">
            <div className="cv-inner">
              <div className="row-between">
                <span className="cv-title">{d.canvas}</span>
                <span className={`cv-status${s <= 3 ? ' done' : ''}`}>{status(s)}</span>
              </div>

              <div
                className={`board${s > 12 ? ' hidden' : ''}${s <= 9 && s > 3 ? ' active' : ''}`}
                aria-label={`${d.canvas}（示意）`}
                role="img"
              >
                {demo === 'site' && <SiteMock off={off} />}
                {demo === 'login' && <LoginMock off={off} />}
                {demo === 'dash' && <DashMock off={off} />}

                <div className={`board-skeleton${s <= 9 ? ' hidden' : ''}`} aria-hidden="true">
                  {demo === 'site' && (
                    <div className="sk-col">
                      <i style={{ height: 20 }} />
                      <i style={{ height: 120 }} />
                      <i style={{ height: 90 }} />
                      <div className="sk-row">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                  )}
                  {demo === 'login' && (
                    <div className="sk-center">
                      <div className="sk-phone">
                        <i className="sk-logo" />
                        <i className="sk-title" />
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                  )}
                  {demo === 'dash' && (
                    <div className="sk-dash">
                      <i className="sk-side" />
                      <div className="sk-main">
                        <i className="sk-h" />
                        <div className="sk-grid">
                          <i />
                          <i />
                          <i />
                          <i />
                        </div>
                        <i className="sk-fill" />
                      </div>
                    </div>
                  )}
                </div>

                <span className={`board-ai ${aiPos}${s > 12 || s <= 3 ? ' hidden' : ''}`} aria-hidden="true">
                  {s > 9 ? 'AI  规划中' : s > 5 ? 'AI  绘制中' : 'AI  自检中'}
                </span>
              </div>

              <div className={`board-wait${s <= 12 ? ' hidden' : ''}`}>
                <span className="muted mono-sm">等待 Agent 调用 canvas_open</span>
              </div>

              <div className="row-between">
                <span className="text-xs muted">你改盒模型与样式 · AI 改结构</span>
                <span className="mono-xs accent">导出 .html</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="made-with">
        <div className="made-with-text">
          <h3 className="h3">你正在看的这个页面，就是这样画出来的</h3>
          <p className="muted">Agent 在 Penhold 画布里画结构和交互，人在画布上改配色，最后导出成一个 HTML 文件。</p>
        </div>
        <div className="made-with-stats">
          <div className="stat">
            <b>700+</b>
            <span>个节点</span>
          </div>
          <div className="stat">
            <b>1</b>
            <span>个 HTML 文件</span>
          </div>
          <a className="outline-btn" href="/penhold-homepage.html" download>
            下载本页源稿
          </a>
        </div>
      </div>
    </section>
  );
}

type Off = (n: number) => string;

function SiteMock({ off }: { off: Off }) {
  return (
    <div className="mk-site">
      <div className={`mk-site-nav rv10${off(9)}`}>
        <span className="mk-brand">
          <i />
          shipd
        </span>
        <span className="mk-links">
          <span>文档</span>
          <span>示例</span>
          <span>更新日志</span>
          <span className="mk-gh">GitHub</span>
        </span>
      </div>
      <div className={`mk-site-hero rv10 d1${off(9)}`}>
        <span className="mk-badge">v2.0 已发布</span>
        <span className="mk-site-h">一条命令，把应用部署到边缘</span>
        <span className="text-xs muted">零配置，增量上传，任何版本 30 秒内回滚。</span>
        <span className="mk-ctas">
          <span className="mk-cta">快速开始</span>
          <span className="mk-cmd">$ npm i -g shipd</span>
        </span>
      </div>
      <div className={`mk-term rv10${off(7)}`}>
        <span className="mono-xs fg">$ shipd deploy</span>
        <span className="mono-xs muted">✓ 构建完成，用时 1.8s</span>
        <span className="mono-xs muted">✓ 上传 12 个文件，跳过 148 个未改动</span>
        <span className="mono-xs fg">已上线 https://my-app.shipd.dev</span>
      </div>
      <div className={`mk-cards rv10${off(5)}`}>
        {[
          ['零配置', '自动识别框架与构建命令'],
          ['增量上传', '只传改动过的文件'],
          ['一键回滚', '任何版本 30 秒内恢复'],
        ].map(([t, b]) => (
          <span key={t} className="mk-card">
            <b>{t}</b>
            <span className="text-xs muted">{b}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LoginMock({ off }: { off: Off }) {
  return (
    <div className="mk-login-wrap">
      <div className="mk-login">
        <i className={`mk-logo rv10${off(9)}`} />
        <div className={`mk-login-title rv10 d1${off(9)}`}>
          <b>欢迎回来</b>
          <span className="text-xs muted">登录后继续同步你的账本</span>
        </div>
        <div className={`mk-tabs rv10${off(7)}`}>
          <span className="text-xs muted">密码登录</span>
          <span className="on">验证码登录</span>
        </div>
        <span className={`mk-field rv10${off(7)}`}>138 0013 8000</span>
        <div className={`mk-code rv10 d1${off(7)}`}>
          <span className="mk-field grow text-xs muted">6 位验证码</span>
          <span className="mk-resend">
            <Resend />
          </span>
        </div>
        <span className={`mk-submit rv10 d2${off(7)}`}>登录</span>
        <span className={`text-xs muted center fade${off(5)}`}>登录即表示同意用户协议与隐私政策</span>
      </div>
    </div>
  );
}

const BARS = [40, 54, 48, 66, 60, 78, 72, 90, 84, 100, 94];

function DashMock({ off }: { off: Off }) {
  return (
    <div className="mk-dash">
      <div className={`mk-side rv10${off(9)}`}>
        <span className="mk-brand">
          <i />
          <b className="text-xs">Orbit</b>
        </span>
        <span className="mk-nav on">概览</span>
        <span className="mk-nav">订单</span>
        <span className="mk-nav">客户</span>
        <span className="mk-nav">报表</span>
        <span className="mk-nav">设置</span>
      </div>
      <div className="mk-main">
        <div className={`row-between rv10 d1${off(9)}`}>
          <b className="mk-dash-h">概览</b>
          <span className="mk-range">近 30 天</span>
        </div>
        <div className={`mk-kpis rv10${off(7)}`}>
          {[
            ['营收', '¥128,400', '+12.4%'],
            ['订单', '3,902', '+8.1%'],
            ['转化率', '4.8%', '+0.6'],
            ['客单价', '¥32.9', '-1.2%'],
          ].map(([k, v, d]) => (
            <span key={k} className="mk-kpi">
              <span className="text-xs muted">{k}</span>
              <span className="mk-kpi-row">
                <b>{v}</b>
                <span className="mono-xs muted">{d}</span>
              </span>
            </span>
          ))}
        </div>
        <div className={`mk-chart rv10${off(5)}`}>
          <div className="row-between">
            <b className="text-xs">每周营收</b>
            <span className="text-xs muted">单位：千元</span>
          </div>
          <div className="mk-bars">
            {BARS.map((h, i) => (
              <i key={i} style={{ height: h }} />
            ))}
            <i className="mk-bar-hi" style={{ height: 116 }} />
          </div>
          <div className="row-between">
            <span className="mono-xs muted">第 1 周</span>
            <span className="mono-xs muted">第 6 周</span>
            <span className="mono-xs fg">第 12 周</span>
          </div>
        </div>
      </div>
    </div>
  );
}
