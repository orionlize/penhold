// 单文件 HTML 导出（PRD 第 7 节）：与画布共用渲染器；不含字体。
// 设计稿带交互（proto / #back）时内嵌一段交互脚本：与画布播放共用 protoEngine 的源码。
import fs from 'node:fs';
import path from 'node:path';
import {
  BACK_HREF,
  collectFonts,
  cssLen,
  fontFamilyCss,
  escHtml,
  hrefFrame,
  newSerializeState,
  RESET_CSS,
  renderFrame,
  serialize,
  tokensCss,
  type HNode,
  type ProtoEntry,
} from '../core/render.js';
import { frameVars } from '../core/proto.js';
import { createProtoEngine, type RuntimeEntry } from '../core/protoEngine.js';
import type { DesignDoc, Frame } from '../core/types.js';
import { makeZip } from './zip.js';

export interface ExportOptions {
  frameIds?: string[];
  inlineImages?: boolean; // 默认 true
  styleMode?: 'class' | 'inline'; // 默认 class
  widthMode?: 'fixed' | 'fill'; // 默认 fixed
  split?: boolean; // 多画板时每画板一个文件（zip）
  interactive?: boolean; // 默认 true：执行 proto 交互逻辑（内嵌脚本）；false 时只输出初始状态、无脚本
}

/** 令牌值 → 导出页里 :root 变量的值（与 tokensCss 一致）。 */
const tokenCssValue = (k: string, v: string) => (k.startsWith('font.') && !/^\{.*\}$|^var\(/.test(v.trim()) ? fontFamilyCss(v) : (cssLen(v) ?? v));

/** Tweaks 浮动面板：改 :root 上对应的 CSS 变量；没有可调项时为空。 */
function tweaksPanel(doc: DesignDoc): { css: string; html: string } {
  const items = (doc.tweaks ?? []).filter((t) => t.token in doc.tokens);
  if (!items.length) return { css: '', html: '' };
  const data = items.map((t) => ({
    id: t.id,
    label: t.label,
    group: t.group ?? '',
    kind: t.kind,
    v: '--' + t.token.replace(/[^a-zA-Z0-9_-]/g, '-'),
    value: doc.tokens[t.token],
    css: tokenCssValue(t.token, doc.tokens[t.token]),
    min: t.min,
    max: t.max,
    step: t.step,
    unit: t.unit ?? '',
    options: (t.options ?? []).map((o) => ({ label: o.label, value: o.value, css: tokenCssValue(t.token, o.value) })),
  }));
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  const css = [
    '.dm-tw{position:fixed;right:16px;bottom:16px;z-index:2147483646;font:13px/1.4 system-ui,sans-serif;color:#111}',
    '.dm-tw *{box-sizing:border-box}',
    '.dm-tw>button{padding:8px 14px;border-radius:999px;background:#111827;color:#fff;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer}',
    '.dm-tw-p{position:absolute;right:0;bottom:44px;width:260px;max-height:70vh;overflow:auto;padding:12px;border-radius:12px;background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.28),0 0 0 1px rgba(0,0,0,.08)}',
    '.dm-tw-p[hidden]{display:none}',
    '.dm-tw-p h4{margin:10px 0 4px;font-size:11px;font-weight:600;letter-spacing:.04em;color:#6b7280;text-transform:uppercase}.dm-tw-p h4:first-child{margin-top:0}',
    '.dm-tw-r{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 0}.dm-tw-r label{flex:1;min-width:0}',
    '.dm-tw-r input[type=range]{width:110px}.dm-tw-r input[type=color]{width:34px;height:24px;padding:0;border:1px solid #d1d5db;border-radius:4px;background:none;cursor:pointer}',
    '.dm-tw-r select{max-width:130px;padding:3px 4px;border:1px solid #d1d5db;border-radius:4px;background:#fff;color:#111;font:inherit}',
    '.dm-tw-r output{min-width:40px;text-align:right;color:#6b7280;font-variant-numeric:tabular-nums}',
    '@media print{.dm-tw{display:none}}',
  ].join('\n');
  const html = `<div class="dm-tw" id="dm-tw"><div class="dm-tw-p" hidden></div><button type="button" aria-expanded="false">Tweaks</button></div>
<script>
(function () {
var T = ${json};
var root = document.documentElement, box = document.getElementById('dm-tw'), panel = box.querySelector('.dm-tw-p'), btn = box.querySelector('button');
btn.addEventListener('click', function () { var o = panel.hidden; panel.hidden = !o; btn.setAttribute('aria-expanded', String(o)); });
function el(tag, props, kids) { var e = document.createElement(tag); for (var k in props) e[k] = props[k]; (kids || []).forEach(function (c) { e.appendChild(c); }); return e; }
function put(t, css) { root.style.setProperty(t.v, css); }
var group = null;
T.forEach(function (t, i) {
  if (t.group !== group) { group = t.group; if (group) panel.appendChild(el('h4', { textContent: group })); }
  var id = 'dm-tw-' + i, label = el('label', { htmlFor: id, textContent: t.label }), ctl, out = null;
  if (t.kind === 'color') {
    ctl = el('input', { id: id, type: 'color', value: /^#[0-9a-f]{6}$/i.test(t.value) ? t.value : '#000000' });
    ctl.addEventListener('input', function () { put(t, ctl.value); });
  } else if (t.kind === 'range') {
    var n = parseFloat(t.value); if (isNaN(n)) n = t.min;
    ctl = el('input', { id: id, type: 'range', min: t.min, max: t.max, step: t.step || 1, value: n });
    out = el('output', { textContent: n + t.unit });
    ctl.addEventListener('input', function () { put(t, ctl.value + t.unit); out.textContent = ctl.value + t.unit; });
  } else if (t.kind === 'select') {
    ctl = el('select', { id: id }, t.options.map(function (o) { return el('option', { value: o.value, textContent: o.label, selected: o.value === t.value }); }));
    ctl.addEventListener('change', function () { var o = t.options[ctl.selectedIndex]; put(t, o.css); });
  } else {
    ctl = el('input', { id: id, type: 'checkbox', checked: t.options[1] && t.options[1].value === t.value });
    ctl.addEventListener('change', function () { put(t, t.options[ctl.checked ? 1 : 0].css); });
  }
  panel.appendChild(el('div', { className: 'dm-tw-r' }, out ? [label, ctl, out] : [label, ctl]));
});
})();
</script>`;
  return { css, html };
}

/** 导出页面的交互脚本：内嵌 createProtoEngine 源码与各画板的交互数据。 */
function bootScript(data: unknown): string {
  const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
  return `<script>
// penhold-mcp 原型交互运行时
(function () {
var __name = function (f) { return f; };
var createProtoEngine = ${createProtoEngine.toString().replace(/<\/script/gi, '<\\/script')};
var D = ${json};
var E = createProtoEngine();
var radios = Array.prototype.slice.call(document.querySelectorAll('input.dm-r'));
var cur = 0, hist = [0];
var nav = {
  go: function (id) {
    var i = D.ids.indexOf(id);
    if (i >= 0) { if (radios[i]) radios[i].checked = true; enter(i, true); }
    else if (D.files[id]) location.href = D.files[id];
  },
  back: function () {
    if (hist.length > 1) { hist.pop(); var i = hist[hist.length - 1]; if (radios[i]) radios[i].checked = true; enter(i, false); }
    else history.back();
  },
  open: function (url) { if (/^(https?:|mailto:|tel:)/i.test(url)) window.open(url, '_blank', 'noopener'); },
  follow: function (href) {
    if (href === '#back') return nav.back();
    if (href.charAt(0) === '#') return nav.go(href.slice(1));
    nav.open(href);
  }
};
var rts = D.frames.map(function (f, i) {
  var rt = new E.ProtoRuntime(window, nav);
  rt.reset(f.vars);
  rt.mount(document.querySelector('[data-dm-frame="' + i + '"]') || document, f.entries, i + '-');
  return rt;
});
function enter(i, push) {
  if (push && i === cur) return;
  rts[cur].stopAll();
  cur = i;
  if (push) hist.push(i);
  rts[i].reset(D.frames[i].vars);
  rts[i].apply();
  rts[i].runLoad();
  window.scrollTo(0, 0);
}
radios.forEach(function (r, i) { r.addEventListener('change', function () { if (r.checked) enter(i, true); }); });
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t || !t.closest) return;
  if (rts[cur].click(t) && t.closest('[data-dm-disabled],[data-dm-href]')) e.preventDefault();
});
document.addEventListener('input', function (e) { if (e.target && e.target.getAttribute) rts[cur].input(e.target); });
rts[0].runLoad();
})();
</script>`;
}

export interface ExportResult {
  filename: string;
  data: Buffer;
  mime: string;
  fonts: Array<{ family: string; weights: number[] }>;
  warnings: string[];
  frames: string[];
}

function slug(s: string) {
  return s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'design';
}

export function buildExport(doc: DesignDoc, canvasDir: string, opts: ExportOptions = {}): ExportResult {
  const frames: Frame[] = opts.frameIds?.length
    ? opts.frameIds.map((id) => {
        const f = doc.frames.find((x) => x.id === id);
        if (!f) throw new Error(`画板 ${id} 不存在`);
        return f;
      })
    : doc.frames.slice(0, 1);
  if (!frames.length) throw new Error('画布中还没有画板');
  const inline = opts.inlineImages !== false;
  const styleMode = opts.styleMode ?? 'class';
  const fill = opts.widthMode === 'fill';
  const warnings: string[] = [];
  const missing = new Set<string>();
  const usedAssets = new Set<string>();

  const asset = (hash: string) => {
    const a = doc.assets[hash];
    if (!a) return undefined;
    const p = path.join(canvasDir, 'assets', 'images', a.file);
    if (!fs.existsSync(p)) return undefined;
    usedAssets.add(hash);
    return inline ? `data:${a.mime};base64,${fs.readFileSync(p).toString('base64')}` : `assets/${a.file}`;
  };

  const fonts = collectFonts(
    doc,
    frames.map((f) => f.root),
  );

  const interactive = opts.interactive !== false;
  /** 分文件导出时各画板所在文件，用于跨文件跳转。 */
  const files_: Record<string, string> = {};

  const renderOne = (fs_: Frame[], title: string): string => {
    const st = newSerializeState(styleMode);
    let needsScript = false;
    // 画板间跳转：多画板导出时渲染为切换对应单选框的 label；分文件导出时链接到对应文件；
    // 目标不在导出结果中则不渲染为链接。"#back" 需要脚本。
    const link = (href: string): { tag: string; attrs: Record<string, string> } | null => {
      if (href === BACK_HREF) {
        if (!interactive) return null;
        needsScript = true;
        return { tag: 'div', attrs: { 'data-dm-href': href } };
      }
      const target = hrefFrame(href);
      if (target === undefined) return { tag: 'a', attrs: { href } };
      const i = fs_.findIndex((f) => f.id === target);
      if (i >= 0 && fs_.length > 1) return { tag: 'label', attrs: { for: `dm-f${i}` } };
      if (files_[target]) return { tag: 'a', attrs: { href: files_[target] } };
      return null;
    };
    const runtime: Array<{ vars: Record<string, unknown>; entries: RuntimeEntry[] }> = [];
    const bodies = fs_.map((f, fi) => {
      const entries: RuntimeEntry[] = [];
      const proto = interactive
        ? (e: ProtoEntry) => {
            entries.push({ proto: e.proto, template: e.template, styles: e.styles });
            return `${fi}-${entries.length - 1}`;
          }
        : undefined;
      const h: HNode = renderFrame(doc, f, { mode: 'export', asset, missingAssets: missing, link, proto });
      runtime.push({ vars: frameVars(doc, f), entries });
      if (entries.length) needsScript = true;
      if (fill) h.css = h.css.map((d) => (d.startsWith('width:') ? 'width:100%' : d));
      else h.css.push('margin:0 auto');
      return serialize(h, st);
    });
    const fontNote = fonts.length
      ? fonts.map((f) => `  - ${f.family}（字重 ${f.weights.join(', ')}）`).join('\n')
      : '  （未指定字体，使用系统默认字体）';
    const head = `<!--\n  由 penhold-mcp 导出。本文件不包含字体文件，请先安装以下字体以获得与画布一致的效果：\n${fontNote}\n-->`;
    const multi = fs_.length > 1;
    let switcherCss = '';
    let nav = '';
    let radios = '';
    let main: string;
    if (multi) {
      radios = fs_.map((_, i) => `<input class="dm-r" type="radio" name="dm-frame" id="dm-f${i}"${i === 0 ? ' checked' : ''}>`).join('');
      nav = `<nav class="dm-tabs">${fs_.map((f, i) => `<label for="dm-f${i}">${escHtml(f.name)}</label>`).join('')}</nav>`;
      main = `<main>${bodies.map((b, i) => `<section class="dm-frame dm-s${i}" data-dm-frame="${i}">${b}</section>`).join('')}</main>`;
      switcherCss = [
        '.dm-r{position:absolute;opacity:0;pointer-events:none}',
        '.dm-tabs{position:sticky;top:0;z-index:2147483647;display:flex;gap:4px;padding:8px 12px;background:#111827;font:13px/1.4 system-ui,sans-serif}',
        '.dm-tabs label{color:#d1d5db;padding:4px 10px;border-radius:6px;cursor:pointer}',
        '.dm-frame{display:none}',
        ...fs_.map((_, i) => `#dm-f${i}:checked~main .dm-s${i}{display:block}#dm-f${i}:checked~nav label[for=dm-f${i}]{background:#374151;color:#fff}`),
      ].join('\n');
    } else main = `<main data-dm-frame="0">${bodies[0]}</main>`;
    const script = needsScript ? `\n${bootScript({ ids: fs_.map((f) => f.id), files: files_, frames: runtime })}` : '';
    const protoCss = needsScript ? '[data-dm-click],[data-dm-href]{cursor:pointer}\n[data-dm-disabled],[data-dm-disabled] *{cursor:not-allowed}' : '';
    const tw = interactive ? tweaksPanel(doc) : { css: '', html: '' };
    const css = [RESET_CSS, tokensCss(doc.tokens), fill ? '' : 'body{background:#fff}', switcherCss, protoCss, st.rules.join('\n'), tw.css]
      .filter(Boolean)
      .join('\n');
    return `<!DOCTYPE html>\n${head}\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escHtml(title)}</title>\n<style>\n${css}\n</style>\n</head>\n<body>\n${radios}${nav}${main}${script}${tw.html ? `\n${tw.html}` : ''}\n</body>\n</html>\n`;
  };

  const base = slug(frames.length === 1 ? frames[0].name : `${frames[0].name}-等${frames.length}个画板`);
  const files: Array<{ name: string; data: Buffer }> = [];
  if (frames.length > 1 && opts.split) {
    for (const f of frames) files_[f.id] = `${slug(f.name)}.html`;
    for (const f of frames) files.push({ name: `${slug(f.name)}.html`, data: Buffer.from(renderOne([f], f.name)) });
  } else {
    files.push({ name: inline ? `${base}.html` : 'index.html', data: Buffer.from(renderOne(frames, frames.map((f) => f.name).join(' / '))) });
  }
  for (const h of missing) warnings.push(`图片资源缺失：asset:${h}`);
  // 也检查引用了但文档中没有登记的资源
  if (!inline) {
    for (const h of usedAssets) {
      const a = doc.assets[h];
      files.push({ name: `assets/${a.file}`, data: fs.readFileSync(path.join(canvasDir, 'assets', 'images', a.file)) });
    }
  }
  const frameNames = frames.map((f) => f.id);
  if (files.length === 1 && inline) return { filename: files[0].name, data: files[0].data, mime: 'text/html; charset=utf-8', fonts, warnings, frames: frameNames };
  return { filename: `${base}.zip`, data: makeZip(files), mime: 'application/zip', fonts, warnings, frames: frameNames };
}
