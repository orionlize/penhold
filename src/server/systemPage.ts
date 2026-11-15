// 设计系统的浏览页（/s/<id>）：各主题的色板与对比度、文字样式、间距、圆角、阴影与组件预览，
// 相当于 Claude Design 里 Design System 的可浏览页面。只读，由 system.json 生成。
import os from 'node:os';
import { auditContrast, flattenSystem, systemCss, type DesignSystem } from '../core/designSystem.js';
import { escAttr, escHtml } from '../core/render.js';
import { emptyDoc } from '../core/doc.js';
import { buildExport } from './export.js';

export function componentPreview(ds: DesignSystem, name: string, theme: string): string {
  const doc = emptyDoc('ds-preview');
  doc.tokens = flattenSystem(ds, theme);
  doc.components = Object.fromEntries(Object.entries(ds.components).map(([k, v]) => [k, { name: v.name, root: v.root }]));
  doc.frames.push({
    id: 'f',
    name,
    width: 340,
    height: 'auto',
    root: { id: 'r', type: 'page', box: { padding: 16 }, style: { background: '{color.bg}', color: '{color.fg}', fontFamily: '{font.body}' }, children: [{ id: 'i', type: ds.components[name].root.type, component: name }] },
  });
  try {
    // 导出页默认 body 为白底，预览要跟着主题：补一条在其后生效的背景与文字色
    const html = buildExport(doc, os.tmpdir(), { frameIds: ['f'], interactive: false, widthMode: 'fill' }).data.toString('utf8');
    return html.replace('</style>', 'html,body{background:var(--color-bg,#fff);color:var(--color-fg,#111)}\n</style>');
  } catch (e) {
    return `<p style="font:13px system-ui;color:#b91c1c">无法预览：${escHtml((e as Error).message)}</p>`;
  }
}

export function systemPage(ds: DesignSystem): string {
  const themes = ds.color.themes;
  const first = themes[0]?.id ?? 'light';
  const pairs = auditContrast(ds, true);
  const sw = (theme: string) =>
    ds.color.tokens
      .map((t) => {
        const v = t.value[theme] ?? t.value[first] ?? '';
        const checks = pairs.filter((p) => p.fg === t.name && p.theme === theme);
        const badge = checks.map((p) => `<span class="${p.ratio < p.min ? 'bad' : 'ok'}">${escHtml(p.bg)} ${p.ratio}</span>`).join(' ');
        return `<div class="sw"><div class="chip" style="background:${escAttr(v)}"></div><code>${escHtml(t.name)}</code><small>${escHtml(v)}</small><p>${escHtml(t.usage ?? '')}</p><div class="cr">${badge}</div></div>`;
      })
      .join('');
  const scale = ds.type.scale;
  const styles = ds.type.styles
    .map((s) => {
      const px = typeof s.size === 'number' ? s.size : (scale[s.size] ?? 16);
      return `<div class="ts"><div class="meta"><code>${escHtml(s.name)}</code><small>${px}px / ${s.lineHeight} / ${s.weight} · ${escHtml(s.family)}</small><p>${escHtml(s.usage ?? '')}</p></div><div style="font-family:var(--font-${escAttr(s.family)});font-size:${px}px;line-height:${s.lineHeight};font-weight:${s.weight};letter-spacing:${s.letterSpacing ?? 0}px;color:var(--color-fg)">${escHtml(s.name === 'display' ? '1,280' : '设计系统让每一页都说同一种语言')}</div></div>`;
    })
    .join('');
  const lens = (title: string, list: DesignSystem['spacing'], render: (v: string) => string) =>
    list.length
      ? `<h2>${title}</h2><div class="lens">${list.map((s) => `<div class="len">${render(s.value)}<code>${escHtml(s.name)}</code><small>${escHtml(s.value)}</small><p>${escHtml(s.usage ?? '')}</p></div>`).join('')}</div>`
      : '';
  const comps = Object.keys(ds.components);
  const compHtml = comps.length
    ? comps
        .map(
          (n) =>
            `<div class="comp"><code>${escHtml(n)}</code><p>${escHtml(ds.components[n].usage ?? '')}</p>${themes
              .map((t, i) => `<iframe data-theme-grid="${escAttr(t.id)}"${i ? ' hidden' : ''} title="${escAttr(`${n} · ${t.name}`)}" srcdoc="${escAttr(componentPreview(ds, n, t.id))}"></iframe>`)
              .join('')}</div>`,
        )
        .join('')
    : '<p class="empty">还没有组件。画好可复用块后用 design_system({action:"save_components"}) 存进系统。</p>';
  const b = ds.brand;
  const brand = [
    ['设计概念', b.concept],
    ['题材母题', b.motif],
    ['记忆点', b.signature],
    ['气质', b.mood],
    ['形状与层次', b.shape],
    ['版式', b.layout],
    ['不要做', b.avoid?.join('；')],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${k}</dt><dd>${escHtml(v!)}</dd>`)
    .join('');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(ds.name)} · 设计系统</title>
<style>
${systemCss(ds)}
*{box-sizing:border-box}body{margin:0;background:var(--color-bg);color:var(--color-fg);font-family:var(--font-body)}
main{max-width:1120px;margin:0 auto;padding:40px 16px 80px}
header{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:16px;margin-bottom:32px}
h1{font-family:var(--font-heading);font-size:40px;line-height:1.1;margin:0}h2{font-size:20px;margin:48px 0 16px}
small,p{color:var(--color-muted-fg)}p{margin:4px 0 0;font-size:13px;line-height:1.5}code{font-size:13px}
.tabs{display:flex;gap:8px}.tabs button{font:inherit;font-size:14px;padding:8px 14px;border-radius:8px;border:1px solid var(--color-border);background:var(--color-card);color:var(--color-card-fg);cursor:pointer}
.tabs button[aria-pressed=true]{background:var(--color-primary);color:var(--color-on-primary);border-color:transparent}
dl{display:grid;grid-template-columns:max-content 1fr;gap:8px 16px;font-size:14px;line-height:1.6;margin:0}dt{font-weight:600}dd{margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
.sw{background:var(--color-card);color:var(--color-card-fg);border:1px solid var(--color-border);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:2px}
.chip{height:56px;border-radius:8px;border:1px solid var(--color-border);margin-bottom:8px}
.cr{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.cr span{font-size:11px;padding:2px 6px;border-radius:4px;background:var(--color-muted);color:var(--color-muted-fg)}.cr .bad{background:var(--color-danger);color:var(--color-on-danger)}
.ts{display:grid;grid-template-columns:220px 1fr;gap:16px;align-items:center;padding:16px 0;border-top:1px solid var(--color-border)}
.lens{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px}.len{display:flex;flex-direction:column;gap:2px}
.bar{height:16px;background:var(--color-primary);border-radius:2px}.box{width:64px;height:64px;background:var(--color-card);border:1px solid var(--color-border)}
.comp{margin-bottom:24px}.comp iframe[hidden]{display:none}.comp iframe{width:100%;max-width:344px;min-height:220px;height:220px;border:1px solid var(--color-border);border-radius:12px;margin:8px 16px 0 0;background:var(--color-bg)}
@media (max-width:640px){.ts{grid-template-columns:1fr}}
</style></head>
<body><main>
<header><div><small>设计系统 v${ds.version} · ${ds.device === 'desktop' ? '桌面端' : '移动端'}字阶</small><h1>${escHtml(ds.name)}</h1></div>
<div class="tabs" role="group" aria-label="主题">${themes.map((t, i) => `<button type="button" data-theme-btn="${escAttr(t.id)}" aria-pressed="${i === 0}">${escHtml(t.name)}</button>`).join('')}</div></header>
${brand ? `<h2>视觉基础</h2><dl>${brand}</dl>` : ''}
<h2>颜色</h2>${themes.map((t, i) => `<div class="grid" data-theme-grid="${escAttr(t.id)}"${i ? ' hidden' : ''}>${sw(t.id)}</div>`).join('')}
<h2>文字</h2>${styles}
${lens('间距', ds.spacing, (v) => `<div class="bar" style="width:${escAttr(v)}"></div>`)}
${lens('圆角', ds.radius, (v) => `<div class="box" style="border-radius:${escAttr(v)}"></div>`)}
${lens('阴影', ds.shadow, (v) => `<div class="box" style="box-shadow:${escAttr(v)}"></div>`)}
<h2>组件</h2>${compHtml}
</main>
<script>
document.querySelectorAll('[data-theme-btn]').forEach(function (b) {
  b.addEventListener('click', function () {
    var id = b.getAttribute('data-theme-btn');
    document.documentElement.setAttribute('data-theme', id);
    document.querySelectorAll('[data-theme-btn]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    document.querySelectorAll('[data-theme-grid]').forEach(function (g) { g.hidden = g.getAttribute('data-theme-grid') !== id; });
  });
});
</script>
</body></html>
`;
}
