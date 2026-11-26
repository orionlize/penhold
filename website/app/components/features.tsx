'use client';

import { useState } from 'react';
import { Resend } from './ticker';

const ITEMS = [
  { id: 'collab', title: '画布双向协作', desc: 'AI 改结构，你调样式，互不覆盖' },
  { id: 'proto', title: '能点的原型', desc: 'tab、倒计时、校验写进稿子里' },
  { id: 'system', title: '自带设计系统', desc: '颜色主题、字阶、组件存在项目里' },
  { id: 'check', title: '画完先自检', desc: '截图、比对、查问题、自己修' },
  { id: 'flow', title: '流程图自动成图', desc: '几行 Mermaid，画板间箭头排好' },
  { id: 'rounds', title: '按迭代分画布', desc: '新一轮另开画布，跨画布链到旧页' },
  { id: 'export', title: '导出就能用', desc: '单文件 HTML + tokens.css' },
] as const;

type FeatId = (typeof ITEMS)[number]['id'];

const COPY: Record<FeatId, { title: string; body: string }> = {
  collab: {
    title: '你拖的边距，AI 看得见',
    body: '用户只能改盒模型与样式，结构和布局由 AI 负责。AI 动手前先查 design_changes，你的改动会被保留。',
  },
  proto: {
    title: '稿子本身就能点',
    body: 'tab 切换、短信倒计时、表单校验、弹窗都用变量写进设计稿。画布里按播放就能试，导出的 HTML 也一样能点。',
  },
  system: {
    title: '设计系统跟着项目走',
    body: '颜色、字阶、间距、组件存成项目级系统，对比度自动修正。明暗、配色和备选风格都是主题，在 Tweaks 面板随手切换；也能从你的 Tailwind / shadcn 变量直接导入。',
  },
  check: {
    title: '交到你手里前，先照过镜子',
    body: '每轮结束 AI 都要截图自检：溢出、对比度、触控尺寸、点击后的状态都查一遍；再截图时和上一张逐像素比对，改到别处或改了没生效都会被指出。阶梯外的字号、间距、圆角一键换成令牌。',
  },
  flow: {
    title: '业务流程，写几行就成图',
    body: 'AI 用 Mermaid 写出跳转与分支，服务端排好位置：画板之间直接连箭头，不相邻的从上方绕过去，判断与异常路径单独标出。说明只画在画布上，不进导出。',
  },
  rounds: {
    title: '画到第十轮，画布也不臃肿',
    body: '每轮的新页面画在同一项目的新画布上，跳到旧页面用跨画布链接，旧页面在画布上显示成只读卡片，播放和导出时也能跳过去。旧页面要改就先复制过来，旧画布保持原样；AI 每次只读本轮的稿子，更快也更省 token。',
  },
  export: {
    title: '导出的是文件，不是链接',
    body: '单文件 HTML 离线可用、交互保留；转代码时 Agent 也能逐个组件读取设计稿，照着写。',
  },
};

const SWATCHES = ['primary', 'secondary', 'violet', 'accent', 'muted', 'fg'];
const TYPE = [
  ['title 48', 48, 1.1],
  ['heading 32', 32, 1.2],
  ['lead 20', 20, 1.3],
  ['body 16', 16, 1.6],
] as const;

export function FeatureExplorer() {
  const [feat, setFeat] = useState<FeatId>('collab');

  return (
    <div className="fx">
      <div className="fx-list" role="tablist" aria-label="能力" aria-orientation="vertical">
        <div className="fx-list-head">
          <span>图层</span>
          <span className="text-xs muted">点一项看预览</span>
        </div>
        {ITEMS.map((it, i) => (
          <button
            key={it.id}
            type="button"
            role="tab"
            id={`fx-tab-${it.id}`}
            aria-selected={feat === it.id}
            aria-controls={`fx-pane-${it.id}`}
            className="fx-item"
            onClick={() => setFeat(it.id)}
          >
            <span className="fx-no">{String(i + 1).padStart(2, '0')}</span>
            <span className="fx-text">
              <span className="fx-title">{it.title}</span>
              <span className="fx-desc">{it.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="fx-stage">
        {ITEMS.map((it) => (
          <div
            key={it.id}
            id={`fx-pane-${it.id}`}
            role="tabpanel"
            aria-labelledby={`fx-tab-${it.id}`}
            aria-hidden={feat !== it.id}
            className={`fx-pane${feat === it.id ? ' on' : ''}`}
          >
            <div className="fx-visual" aria-hidden="true">
              <Visual id={it.id} />
            </div>
            <div className="fx-copy">
              <h3 className="h3">{COPY[it.id].title}</h3>
              <p className="muted">{COPY[it.id].body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Visual({ id }: { id: FeatId }) {
  switch (id) {
    case 'collab':
      return (
        <div className="v-collab">
          <div className="v-pad">
            <span className="v-pad-label">padding 28</span>
            <span className="v-btn">
              安装 MCP
              <i />
            </span>
            <span className="v-dim">
              <i />
              <b>
                <span className="tv" data-tv="0">
                  281
                </span>
                <span className="tv" data-tv="1">
                  260
                </span>
              </b>
            </span>
            <span className="v-you">
              <i className="you-arrow" />
              <span className="you-tag">你在拖宽度</span>
            </span>
          </div>
          <span className="v-note">
            <i />
            AI 已读到你的改动，下一步不会覆盖
          </span>
        </div>
      );
    case 'proto':
      return (
        <div className="v-login">
          <div className="v-tabs">
            <span>密码登录</span>
            <span className="on">验证码登录</span>
          </div>
          <span className="v-field mono">138 0013 8000</span>
          <span className="v-code">
            <span className="v-field grow muted">验证码</span>
            <span className="v-resend">
              <Resend />
            </span>
          </span>
          <span className="v-submit">登录</span>
        </div>
      );
    case 'system':
      return (
        <div className="v-system">
          <div className="v-swatches">
            {SWATCHES.map((s) => (
              <span key={s} className="v-swatch">
                <i className={`sw-${s}`} />
                <span className="mono-xs muted">{s}</span>
              </span>
            ))}
          </div>
          <div className="v-type">
            {TYPE.map(([label, size, lh]) => (
              <span key={label} className="v-type-row">
                <b style={{ fontSize: size, lineHeight: lh, fontWeight: size >= 32 ? 600 : size === 20 ? 500 : 400 }}>Aa</b>
                <span className="mono-xs muted">{label}</span>
              </span>
            ))}
          </div>
        </div>
      );
    case 'check':
      return (
        <div className="v-check">
          <div className="v-check-card">
            <i className="half" />
            <i className="title" />
            <i className="v-bad" />
            <span className="v-check-row">
              <i />
              <i />
            </span>
          </div>
          <div className="v-report">
            <b className="mono-sm">design_screenshot</b>
            <span className="mono-xs fg">
              <span className="tv" data-tv="0">
                ✓ 对比度已修复 4.8:1
              </span>
              <span className="tv" data-tv="1">
                ✕ 对比度不足 3.2:1
              </span>
            </span>
            <span className="mono-xs accent">✓ 无溢出、重叠、截断</span>
            <span className="mono-xs accent">✓ 24 个交互状态已探索</span>
            <span className="mono-xs accent">✓ 像素对比：只有按钮区域变化</span>
            <span className="mono-xs muted">design_lint_fix · 3 处字号对齐令牌</span>
          </div>
        </div>
      );
    case 'flow':
      return (
        <div className="v-flow">
          <span className="v-flow-code">
            <span className="mono-xs muted">flowchart LR</span>
            <span className="mono-xs accent">  登录 --&gt;|成功| 首页</span>
            <span className="mono-xs accent">  首页 --&gt; 支付</span>
            <span className="mono-xs secondary">  支付 -.-&gt;|失败| 登录</span>
          </span>
          <span className="v-flow-board">
            <span className="v-flow-back">
              <i />
              <span className="mono-xs muted">失败</span>
            </span>
            {['登录', '首页', '支付'].map((name, i) => (
              <span key={name} className="v-flow-step">
                {i > 0 && (
                  <span className="v-flow-arrow">
                    {i === 1 && <span className="mono-xs muted">成功</span>}
                    <i />
                  </span>
                )}
                <span className="v-flow-frame">
                  <span className="mono-xs muted">{name}</span>
                  <i className="title" />
                  <i />
                  <i className="btn" />
                </span>
              </span>
            ))}
          </span>
        </div>
      );
    case 'rounds':
      return (
        <div className="v-rounds">
          <span className="v-round old">
            <span className="mono-xs muted">第 1 轮 · 首页与登录</span>
            <span className="v-round-frames">
              {['首页', '登录'].map((name) => (
                <span key={name} className="v-flow-frame">
                  <span className="mono-xs muted">{name}</span>
                  <i className="title" />
                  <i />
                  <i className="btn" />
                </span>
              ))}
            </span>
          </span>
          <span className="v-round new">
            <span className="mono-xs accent">第 2 轮 · 会员体系</span>
            <span className="v-round-frames">
              {['会员中心', '支付结果'].map((name, i) => (
                <span key={name} className="v-flow-step">
                  {i > 0 && (
                    <span className="v-flow-arrow">
                      <i />
                    </span>
                  )}
                  <span className="v-flow-frame">
                    <span className="mono-xs muted">{name}</span>
                    <i className="title" />
                    <i />
                    <i className="btn" />
                  </span>
                </span>
              ))}
              <span className="v-flow-arrow dashed">
                <span className="mono-xs muted">返回首页</span>
                <i />
              </span>
              <span className="v-ref">
                <span className="mono-xs muted">只读 · 第 1 轮</span>
                <b className="mono-sm">首页</b>
                <span className="mono-xs accent">打开所在画布 ↗</span>
              </span>
            </span>
            <span className="mono-xs fg">
              <span className="tv" data-tv="0">
                href: #&lt;第 1 轮画布&gt;/home · 跨画布链接
              </span>
              <span className="tv" data-tv="1">
                frame_create(from) · 复制过来再改，旧画布不动
              </span>
            </span>
          </span>
        </div>
      );
    case 'export':
      return (
        <div className="v-export">
          <span className="v-file a">
            <i className="v-thumb" />
            <b className="mono-sm">index.html</b>
            <span className="text-xs muted">双击打开，交互可点</span>
          </span>
          <span className="v-file b">
            <span className="v-code-thumb">
              <span className="mono-xs muted">:root {'{'}</span>
              <span className="mono-xs accent">  --color-primary</span>
              <span className="mono-xs secondary">  --space-4: 16px</span>
            </span>
            <b className="mono-sm">tokens.css</b>
            <span className="text-xs muted">直接提交进仓库</span>
          </span>
        </div>
      );
  }
}
