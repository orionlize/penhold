'use client';

import { useState } from 'react';
import { Resend } from './ticker';

const ITEMS = [
  { id: 'collab', title: '画布双向协作', desc: 'AI 改结构，你调样式，互不覆盖' },
  { id: 'proto', title: '能点的原型', desc: 'tab、倒计时、校验写进稿子里' },
  { id: 'system', title: '自带设计系统', desc: '亮暗主题、字阶、组件存在项目里' },
  { id: 'check', title: '画完先自检', desc: '截图、查问题、自己修' },
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
    body: '颜色、字阶、间距、组件存成项目级系统，亮暗两套主题自动修正对比度；也能从你的 Tailwind / shadcn 变量直接导入。',
  },
  check: {
    title: '交到你手里前，先照过镜子',
    body: '每轮结束 AI 都要截图自检：溢出、对比度、触控尺寸、点击后的状态都查一遍，有问题自己修。',
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
          </div>
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
