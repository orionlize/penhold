// 画板 iframe：渲染、增量更新、命中测试、测量、页面内栅格化截图与渲染检查。
import { componentUsers, getIndex, resolveAddress, walkTree } from '../../../src/core/doc';
import { newSerializeState, renderAddress, renderFrame, RESET_CSS, serialize, tokensCss } from '../../../src/core/render';
import type { ComputedSize, DesignDoc, Op, ProbeRequest, ProbeResult, ProtoValue, ShotIssue, ShotReport } from '../../../src/core/types';
import { fontAvailable } from './fonts';
import { composite, contrast, parseColor, type Rgb } from '../../../src/core/color';

const CANVAS_CSS = `html,body{overflow:hidden;background:transparent}
body{min-height:100%}
[data-node-id]{outline:none}
[data-dm-pending]{opacity:0!important;transition:none!important;animation:none!important}`;

/** 回放 AI 新插入节点的总时长上限（毫秒）；节点多时按批显示。 */
const REVEAL_TOTAL_MS = 1200;
const REVEAL_TICK_MIN = 24;
const REVEAL_TICK_MAX = 70;

/** 按 type / component / name 识别按钮、tab、标签等需要单行且居中的控件。 */
const CONTROL_RE = /button|btn|(?<![a-z])tabs?(?![a-z])|tab-?(bar|item)|chip|(?<![a-z])tags?(?![a-z])|badge|pill|segment|nav-?item|menu-?item|按钮|标签|选项卡|胶囊/;
/** 名字里带控件词但实为内容区的容器（如 tab-panel）。 */
const NOT_CONTROL_RE = /panel|content|page|body|list|section|card|group/;

export class FrameView {
  iframe: HTMLIFrameElement | null = null;
  ready = false;
  onResize?: (h: number) => void;
  /** 回放推进到某个节点（AI 光标跟随）；addr 为 null 表示回放结束。 */
  onRevealStep?: (addr: string | null) => void;
  /** 指定状态变量（状态检查用的隐藏画板）；缺省为画板初值。 */
  vars?: Record<string, ProtoValue>;
  private ro?: ResizeObserver;
  private revealing: { els: HTMLElement[]; i: number; timer?: ReturnType<typeof setTimeout> } | null = null;
  /** 正在播放的淡入动画（finishReveal 时直接走完）。 */
  private fades = new Set<Animation>();
  private queuedReveal: string[] = [];

  constructor(public frameId: string, private canvasId: string, private getDoc: () => DesignDoc | null) {}

  get docEl(): Document | null {
    return this.iframe?.contentDocument ?? null;
  }

  assetUrl = (hash: string) => {
    const a = this.getDoc()?.assets[hash];
    return a ? `/c/${this.canvasId}/assets/${a.file}` : undefined;
  };

  attach(iframe: HTMLIFrameElement) {
    if (this.iframe === iframe) return;
    this.iframe = iframe;
    this.ready = false;
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style id="dm-reset">${RESET_CSS}\n${CANVAS_CSS}</style><style id="dm-tokens"></style></head><body></body></html>`;
    iframe.onload = () => {
      this.ready = true;
      this.renderAll();
      if (this.queuedReveal.length) {
        const q = this.queuedReveal;
        this.queuedReveal = [];
        this.reveal(q);
      }
      const body = this.docEl?.body;
      if (body && 'ResizeObserver' in window) {
        this.ro?.disconnect();
        this.ro = new ResizeObserver(() => this.reportSize());
        this.ro.observe(body);
      }
    };
  }

  detach() {
    this.finishReveal();
    this.ro?.disconnect();
    this.iframe = null;
    this.ready = false;
  }

  private reportSize() {
    const d = this.docEl;
    const doc = this.getDoc();
    const f = doc?.frames.find((x) => x.id === this.frameId);
    if (!d || !f) return;
    const root = d.body.firstElementChild as HTMLElement | null;
    const h = Math.max(root?.scrollHeight ?? 0, root?.getBoundingClientRect().height ?? 0, typeof f.height === 'number' ? f.height : 200);
    this.onResize?.(Math.ceil(h));
  }

  renderTokens() {
    const doc = this.getDoc();
    const el = this.docEl?.getElementById('dm-tokens');
    if (doc && el) el.textContent = tokensCss(doc.tokens);
  }

  renderAll() {
    const doc = this.getDoc();
    const d = this.docEl;
    if (!doc || !d || !this.ready) return;
    const f = doc.frames.find((x) => x.id === this.frameId);
    if (!f) return;
    this.renderTokens();
    d.body.innerHTML = serialize(renderFrame(doc, f, { mode: 'canvas', asset: this.assetUrl, vars: this.vars }), newSerializeState('inline'));
    this.reportSize();
  }

  /** 按地址重新渲染元素（outerHTML 替换）；定位不到时整画板重绘。 */
  rerender(addrs: Set<string>) {
    const doc = this.getDoc();
    const d = this.docEl;
    if (!doc || !d || !this.ready) return;
    if (addrs.has(this.frameId)) return this.renderAll();
    const els: Element[] = [];
    for (const a of addrs) {
      const found = d.querySelectorAll(`[data-node-id="${CSS.escape(a)}"]`);
      if (!found.length) continue;
      els.push(...found);
    }
    // 只保留最外层
    const top = els.filter((e) => !els.some((o) => o !== e && o.contains(e)));
    for (const el of top) {
      const addr = el.getAttribute('data-node-id')!;
      const h = renderAddress(doc, addr, { mode: 'canvas', asset: this.assetUrl, vars: this.vars });
      if (!h) return this.renderAll();
      el.outerHTML = serialize(h, newSerializeState('inline'));
    }
    this.reportSize();
  }

  // ---------- AI 绘制回放 ----------

  /**
   * 按文档顺序（深度优先）逐个显示刚插入的子树。最终布局先整体排好，未显示的节点只是透明，
   * 所以位置不会跳动；只是视觉效果，不影响文档、撤销与导出。
   */
  reveal(topAddrs: string[]) {
    if (!this.ready) {
      this.queuedReveal.push(...topAddrs);
      return;
    }
    this.finishReveal();
    const seen = new Set<HTMLElement>();
    const els: HTMLElement[] = [];
    const push = (el: HTMLElement) => {
      if (!seen.has(el)) (seen.add(el), els.push(el));
    };
    for (const a of topAddrs) {
      const el = this.element(a);
      if (!el) continue;
      if (a !== this.frameId) push(el);
      for (const k of el.querySelectorAll<HTMLElement>('[data-node-id]')) push(k);
    }
    if (!els.length) return;
    for (const el of els) el.setAttribute('data-dm-pending', '');
    const tick = Math.max(REVEAL_TICK_MIN, Math.min(REVEAL_TICK_MAX, REVEAL_TOTAL_MS / els.length));
    const perTick = Math.max(1, Math.ceil(els.length / (REVEAL_TOTAL_MS / tick)));
    const r: NonNullable<FrameView['revealing']> = { els, i: 0 };
    this.revealing = r;
    // 用定时器而非 requestAnimationFrame：后台标签页里也要能走完
    const step = () => {
      if (this.revealing !== r) return;
      const end = Math.min(els.length, r.i + perTick);
      let last: HTMLElement | null = null;
      for (; r.i < end; r.i++) {
        const el = els[r.i];
        if (!el.isConnected) continue;
        el.removeAttribute('data-dm-pending');
        const to = this.iframe?.contentWindow?.getComputedStyle(el).opacity ?? '1';
        const anim = el.animate?.([{ opacity: 0 }, { opacity: to }], { duration: 180, easing: 'ease-out' });
        if (anim) {
          this.fades.add(anim);
          anim.onfinish = anim.oncancel = () => this.fades.delete(anim);
        }
        last = el;
      }
      if (last) this.onRevealStep?.(last.getAttribute('data-node-id'));
      if (r.i >= els.length) {
        this.revealing = null;
        this.onRevealStep?.(null);
      } else r.timer = setTimeout(step, tick);
    };
    step();
  }

  get isRevealing() {
    return !!this.revealing;
  }

  /** 立即显示全部（用户操作、截图、新的写入到来时）。 */
  finishReveal() {
    // 已显示节点的淡入动画也直接走完：截图与检查不能看到半透明的文字
    for (const a of [...this.fades]) a.finish();
    const r = this.revealing;
    if (!r) return;
    clearTimeout(r.timer);
    this.revealing = null;
    for (const el of r.els) el.removeAttribute('data-dm-pending');
    this.onRevealStep?.(null);
  }

  element(addr: string): HTMLElement | null {
    if (addr === this.frameId) return (this.docEl?.body?.firstElementChild as HTMLElement) ?? null;
    return (this.docEl?.querySelector(`[data-node-id="${CSS.escape(addr)}"]`) as HTMLElement) ?? null;
  }

  /** 节点矩形（画板坐标）。 */
  rect(addr: string): DOMRect | null {
    const el = this.element(addr);
    return el ? el.getBoundingClientRect() : null;
  }

  /** 命中测试：返回从画板根到命中节点的地址链。 */
  hitChain(x: number, y: number): string[] {
    const d = this.docEl;
    if (!d) return [];
    let el = d.elementFromPoint(x, y) as HTMLElement | null;
    const chain: string[] = [];
    while (el && el !== d.body) {
      const a = el.getAttribute?.('data-node-id');
      if (a) chain.unshift(a);
      el = el.parentElement;
    }
    return chain;
  }

  /** 点击位置在节点文本中的字符偏移（无法确定时返回 null）。 */
  caretAt(addr: string, x: number, y: number): number | null {
    const d = this.docEl;
    const el = this.element(addr);
    if (!d || !el) return null;
    const doc = d as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    let node: Node | null = null;
    let offset = 0;
    const r = doc.caretRangeFromPoint?.(x, y);
    if (r) ((node = r.startContainer), (offset = r.startOffset));
    else {
      const p = doc.caretPositionFromPoint?.(x, y);
      if (p) ((node = p.offsetNode), (offset = p.offset));
    }
    if (!node || !el.contains(node)) return (el.textContent ?? '').length;
    const pre = doc.createRange();
    pre.setStart(el, 0);
    pre.setEnd(node, offset);
    return pre.toString().length;
  }

  /** 某地址的祖先链（含自身）。 */
  chainOf(addr: string): string[] {
    const chain: string[] = [];
    let el: HTMLElement | null = this.element(addr);
    while (el && el !== this.docEl?.body) {
      const a = el.getAttribute('data-node-id');
      if (a) chain.unshift(a);
      el = el.parentElement;
    }
    return chain;
  }

  computedStyle(addr: string): CSSStyleDeclaration | null {
    const el = this.element(addr);
    return el ? (this.iframe!.contentWindow!.getComputedStyle(el) as CSSStyleDeclaration) : null;
  }

  measure(ids: string[]): Record<string, ComputedSize> {
    const out: Record<string, ComputedSize> = {};
    const root = this.element(this.frameId)?.getBoundingClientRect();
    for (const id of ids) {
      const r = this.rect(id);
      if (r && root) out[id] = { x: r.left - root.left, y: r.top - root.top, width: r.width, height: r.height };
    }
    return out;
  }

  // ---------- 检查 ----------

  check(targetAddr: string): ShotReport {
    const d = this.docEl!;
    const rootEl = this.element(targetAddr)!;
    const doc = this.getDoc()!;
    const frame = doc.frames.find((f) => f.id === this.frameId)!;
    const win = this.iframe!.contentWindow!;
    const issues: ShotIssue[] = [];
    const nodes = [rootEl, ...rootEl.querySelectorAll<HTMLElement>('[data-node-id]')];
    const visible = (el: HTMLElement) => win.getComputedStyle(el).display !== 'none' && !el.closest('[style*="display:none"]');
    const fontsChecked = new Set<string>();
    // 节点角色：按 type / component / name 推断是否为按钮、tab、标签等控件
    const roleOf = (el: Element): string => {
      const a = el.getAttribute('data-node-id');
      if (!a) return '';
      try {
        const n = resolveAddress(doc, a).target.node;
        return `${n.type} ${n.component ?? ''} ${n.name ?? ''}`.toLowerCase();
      } catch {
        return '';
      }
    };
    const isControl = (el: Element | null) => {
      const role = el ? roleOf(el) : '';
      return CONTROL_RE.test(role) && !NOT_CONTROL_RE.test(role);
    };
    const nodeParent = (el: Element) => el.parentElement?.closest('[data-node-id]') ?? null;
    const nodeOf = (el: Element) => {
      try {
        return resolveAddress(doc, el.getAttribute('data-node-id')!).target.node;
      } catch {
        return undefined;
      }
    };
    /** 文字下方的实际底色：向上找第一个不透明背景，半透明的逐层叠上；途中遇到渐变或图片背景则无法判断。 */
    const backdrop = (el: HTMLElement): Rgb | undefined => {
      const layers: Array<{ rgb: Rgb; alpha: number }> = [];
      for (let e: HTMLElement | null = el; e; e = e.parentElement) {
        const cs = win.getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return undefined;
        const c = parseColor(cs.backgroundColor);
        if (c && c.alpha > 0) {
          layers.push(c);
          if (c.alpha >= 1) break;
        }
      }
      let base: Rgb = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) base = layers[i].alpha >= 1 ? layers[i].rgb : composite(layers[i].rgb, layers[i].alpha, base);
      return base;
    };
    const opacityOf = (el: HTMLElement) => {
      let o = 1;
      for (let e: HTMLElement | null = el; e && e !== d.body; e = e.parentElement) o *= parseFloat(win.getComputedStyle(e).opacity) || 1;
      return o;
    };
    const isClickable = (n: ReturnType<typeof nodeOf>) => !!n && (!!n.props?.href || !!n.proto?.onClick || /button|btn|按钮/i.test(`${n.type} ${n.component ?? ''}`));
    const mobile = frame.width <= 480;
    const contrastSeen = new Set<string>();
    const ownText = (el: HTMLElement) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    /** 文字实际占据的区域与行数（按行框的 top 去重）。 */
    const glyphs = (el: HTMLElement) => {
      const range = d.createRange();
      range.selectNodeContents(el);
      const rows = new Set<number>();
      for (const rc of range.getClientRects()) if (rc.width > 0.5 && rc.height > 0.5) rows.add(Math.round(rc.top));
      return { rect: range.getBoundingClientRect(), lines: rows.size };
    };
    const contentBox = (el: HTMLElement, r: DOMRect, cs: CSSStyleDeclaration) => {
      const top = r.top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
      const bottom = r.bottom - parseFloat(cs.paddingBottom) - parseFloat(cs.borderBottomWidth);
      const left = r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
      const right = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      return { top, bottom, left, right, cx: (left + right) / 2, cy: (top + bottom) / 2 };
    };
    const short = (s: string) => (s.length > 12 ? `${s.slice(0, 12)}…` : s);
    for (const el of nodes) {
      if (!visible(el)) continue;
      const id = el.getAttribute('data-node-id')!;
      const cs = win.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if ((r.width < 1 || r.height < 1) && (hasText || el.tagName === 'IMG' || el.children.length))
        issues.push({ kind: 'zero_size', id, detail: `渲染尺寸为 ${Math.round(r.width)}×${Math.round(r.height)}` });
      if (hasText) {
        const range = d.createRange();
        range.selectNodeContents(el);
        const tr = range.getBoundingClientRect();
        const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        const padR = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
        const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
        const padB = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
        // 行高小于字形盒（标题收紧行距）时，字形盒上下各超出半个差值，不算溢出
        const lh = parseFloat(cs.lineHeight);
        const rows = new Set<number>();
        for (const rc of range.getClientRects()) if (rc.width > 0.5 && rc.height > 0.5) rows.add(Math.round(rc.top));
        const tight = Number.isFinite(lh) && rows.size ? Math.max(0, (tr.height - rows.size * lh) / 2) : 0;
        if (tr.right > r.right - padR + 1 || tr.left < r.left + padL - 1 || tr.bottom > r.bottom - padB + 1 + tight || tr.top < r.top + padT - 1 - tight)
          issues.push({
            kind: 'overflow',
            id,
            detail: `文本内容 ${Math.round(tr.width)}×${Math.round(tr.height)} 超出内容区 ${Math.round(r.width - padL - padR)}×${Math.round(r.height - padT - padB)}${cs.overflow === 'hidden' ? '（被裁切）' : ''}`,
          });
        // 按钮 / tab / 标签类文字或短文本被挤成多行
        const txt = ownText(el);
        const g = glyphs(el);
        const p1 = nodeParent(el);
        const ctl = isControl(el) || isControl(p1) || isControl(p1 && nodeParent(p1));
        if (g.lines > 1 && !txt.includes('\n') && (ctl || [...txt].length <= 12))
          issues.push({
            kind: 'text_wrap',
            id,
            detail: `文字「${short(txt)}」被挤成 ${g.lines} 行（可用宽度 ${Math.round(r.width - padL - padR)}px）：${ctl ? '按钮 / tab / 标签' : '短文本'}应单行显示，加宽容器、减小左右 padding / 字号或缩短文案，再设 whiteSpace:"nowrap"`,
          });
        // 控件内文字自身未垂直居中（如按钮固定高度但文字贴顶）
        if (isControl(el) && g.lines === 1) {
          const cb = contentBox(el, r, cs);
          const dy = (g.rect.top + g.rect.bottom) / 2 - cb.cy;
          if (Math.abs(dy) > 2 && cb.bottom - cb.top > g.rect.height + 4)
            issues.push({ kind: 'misaligned', id, detail: `文字在控件内未垂直居中（偏${dy > 0 ? '下' : '上'} ${Math.round(Math.abs(dy))}px）：设 layout.align:"center"（文本节点也按 flex 居中）` });
        }
        const fam = cs.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
        if (fam && !fontsChecked.has(fam)) {
          fontsChecked.add(fam);
          if (!/^(serif|sans-serif|monospace|system-ui|cursive|fantasy)$/.test(fam) && !fontAvailable(fam))
            issues.push({ kind: 'missing_font', id, detail: `本机缺少字体 “${fam}”，正以回退字体渲染` });
        }
      }
      if (el.tagName === 'IMG') {
        const img = el as HTMLImageElement;
        if (!img.getAttribute('src')) issues.push({ kind: 'broken_image', id, detail: '图片没有 src（资源缺失或未设置）' });
        else if (img.complete && img.naturalWidth === 0) issues.push({ kind: 'broken_image', id, detail: '图片加载失败' });
        else if (img.complete && !/\.svg(\?|$)|^data:image\/svg/i.test(img.currentSrc || img.src)) {
          // 位图被放大显示会发虚：按 object-fit 算出实际放大倍数
          const fit = cs.objectFit;
          const sx = r.width / img.naturalWidth;
          const sy = r.height / img.naturalHeight;
          const up = fit === 'contain' || fit === 'scale-down' ? Math.min(sx, sy) : fit === 'none' ? 1 : Math.max(sx, sy);
          if (up > 1.3 && Math.max(r.width, r.height) >= 96)
            issues.push({
              kind: 'low_res_image',
              id,
              detail: `图片原始尺寸 ${img.naturalWidth}×${img.naturalHeight}，显示为 ${Math.round(r.width)}×${Math.round(r.height)}，被放大 ${up.toFixed(1)} 倍会发虚：换一张不小于显示尺寸的图片（高清屏建议 2 倍），或缩小图片区域`,
            });
        }
      }
      // 文字对比度：正文 4.5:1，大字（≥ 24px，或 ≥ 18.67px 且 700 以上）3:1；禁用的控件不要求
      if (hasText && !el.closest('[disabled],[aria-disabled="true"],[data-dm-disabled]')) {
        const fg = parseColor(cs.color);
        const bg = backdrop(el);
        if (fg && bg) {
          const alpha = fg.alpha * opacityOf(el);
          const ratio = contrast(alpha < 1 ? composite(fg.rgb, alpha, bg) : fg.rgb, bg);
          const size = parseFloat(cs.fontSize);
          const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
          const min = large ? 3 : 4.5;
          const key = `${cs.color}|${bg.join(',')}|${min}`;
          if (ratio < min - 0.005 && !contrastSeen.has(key)) {
            contrastSeen.add(key);
            const same = nodes.filter((x) => x !== el && x.getAttribute('data-node-id') && win.getComputedStyle(x).color === cs.color).length;
            issues.push({
              kind: 'low_contrast',
              id,
              detail: `文字「${short(ownText(el))}」对底色的对比度只有 ${ratio.toFixed(2)}:1（${large ? '大字' : '正文'}要求 ${min}:1${alpha < 1 ? `，含 ${Math.round(alpha * 100)}% 透明度` : ''}）${same ? `，同色文字还有约 ${same} 处` : ''}：换用对比更高的文字色令牌（如 {color.fg} / {color.muted-fg}），或调整底色；颜色本身不达标时改设计系统的令牌，而不是逐个节点改`,
            });
          }
        }
      }
      // 触控目标：移动端可点击元素不小于 44×44（行内文字链接至少高 24，再用 padding 扩大点击区域）
      if (mobile) {
        const n = nodeOf(el);
        // 外层已经是可点击块（如按钮里的文字、链接卡片里的标题）时只看外层
        let outer = false;
        for (let p = nodeParent(el); p && !outer; p = nodeParent(p)) outer = isClickable(nodeOf(p));
        if (isClickable(n) && !outer && r.width > 0 && ((r.width < 44 && r.height < 44) || r.height < 24))
          issues.push({
            kind: 'small_target',
            id,
            detail: `可点击区域只有 ${Math.round(r.width)}×${Math.round(r.height)}px：移动端触控目标至少 44×44，加 padding 或最小宽高（文字链接可上下各加 padding 扩大点击区域，不必放大字号）`,
          });
      }
      // 子节点越界与同级重叠
      const kids = [...el.children].filter((k): k is HTMLElement => (k as Element).nodeType === 1 && k.hasAttribute('data-node-id') && visible(k as HTMLElement));
      const flow = kids.filter((k) => !/^(absolute|fixed)$/.test(win.getComputedStyle(k).position));
      // 滚动容器里内容超出可视范围是预期的（瀑布流、详情长内容），该方向不算越界
      const scrollX = /^(auto|scroll)$/.test(cs.overflowX);
      const scrollY = /^(auto|scroll)$/.test(cs.overflowY);
      for (const k of flow) {
        const kr = k.getBoundingClientRect();
        if (kr.width < 1 && kr.height < 1) continue;
        const dx = scrollX ? 0 : Math.max(r.left - kr.left, kr.right - r.right);
        const dy = scrollY ? 0 : Math.max(r.top - kr.top, kr.bottom - r.bottom);
        if (dx > 1 || dy > 1) {
          const clipped = cs.overflow === 'hidden' || cs.overflowX === 'hidden';
          issues.push({
            kind: 'out_of_parent',
            id: k.getAttribute('data-node-id')!,
            detail: `超出父节点 ${id}（横向 ${Math.max(0, Math.round(dx))}px，纵向 ${Math.max(0, Math.round(dy))}px）${clipped ? '，被裁切' : ''}`,
          });
        }
      }
      // tab 下划线 / 选中指示条应与同级文字水平居中对齐
      const textKids = kids.filter((k) => ownText(k));
      if (textKids.length === 1) {
        for (const k of kids) {
          if (k === textKids[0] || k.querySelector('[data-node-id]') || k.textContent!.trim() || k.tagName === 'IMG') continue;
          const kr = k.getBoundingClientRect();
          if (kr.height > 4 || kr.height < 0.5 || kr.width < 6 || kr.width < kr.height * 3) continue;
          const gr = glyphs(textKids[0]).rect;
          const dx = (kr.left + kr.right) / 2 - (gr.left + gr.right) / 2;
          if (Math.abs(dx) > 2)
            issues.push({
              kind: 'misaligned',
              id: k.getAttribute('data-node-id')!,
              detail: `指示条中心与文字「${short(ownText(textKids[0]))}」中心横向偏${dx > 0 ? '右' : '左'} ${Math.round(Math.abs(dx))}px：tab 下划线应与文字居中，给父容器 ${id} 设 layout.align:"center"（或让文字与指示条同宽且 textAlign:"center"）`,
            });
        }
      }
      // 横排控件（图标 + 文字按钮、导航项等）的子项未垂直居中
      if (isControl(el) && cs.display.includes('flex') && cs.flexDirection.startsWith('row') && !cs.flexWrap.startsWith('wrap') && flow.length > 1) {
        const cb = contentBox(el, r, cs);
        for (const k of flow) {
          const kr = ownText(k) ? glyphs(k).rect : k.getBoundingClientRect();
          if (kr.height < 1) continue;
          const dy = (kr.top + kr.bottom) / 2 - cb.cy;
          if (Math.abs(dy) > 2 && cb.bottom - cb.top > kr.height + 2)
            issues.push({ kind: 'misaligned', id: k.getAttribute('data-node-id')!, detail: `在 ${id} 中未垂直居中（偏${dy > 0 ? '下' : '上'} ${Math.round(Math.abs(dy))}px）：给 ${id} 设 layout.align:"center"` });
        }
      }
      for (let i = 0; i < flow.length; i++)
        for (let j = i + 1; j < flow.length; j++) {
          const a = flow[i].getBoundingClientRect();
          const b = flow[j].getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 2 && h > 2)
            issues.push({ kind: 'overlap', id: flow[j].getAttribute('data-node-id')!, detail: `与同级 ${flow[i].getAttribute('data-node-id')} 重叠 ${Math.round(w)}×${Math.round(h)}px` });
        }
      if (issues.length > 200) break;
    }
    const rr = rootEl.getBoundingClientRect();
    if (targetAddr === this.frameId) {
      const sw = Math.max(rootEl.scrollWidth, d.body.scrollWidth);
      if (sw > frame.width + 1) issues.push({ kind: 'frame_overflow', id: this.frameId, detail: `内容宽 ${sw}px 超出画板宽度 ${frame.width}px` });
      if (typeof frame.height === 'number' && rr.height > frame.height + 1)
        issues.push({ kind: 'frame_overflow', id: this.frameId, detail: `内容高 ${Math.round(rr.height)}px 超出画板高度 ${frame.height}px` });
    }
    return { width: rr.width, height: rr.height, nodes: nodes.length, issues };
  }

  // ---------- 截图 ----------

  /** 等待图片加载完成（新渲染的隐藏画板需要）。 */
  async imagesLoaded() {
    const d = this.docEl;
    if (!d) return;
    await waitImages(d);
  }

  /** region：按画板坐标裁切（缺省为目标节点的范围）。 */
  async screenshot(targetAddr: string, scale: number, region?: { x: number; y: number; width: number; height: number }): Promise<string> {
    const d = this.docEl!;
    const win = this.iframe!.contentWindow!;
    const rootEl = this.element(this.frameId)!;
    const target = this.element(targetAddr);
    if (!target) throw new Error(`画布中找不到节点 ${targetAddr}（可能被隐藏）`);
    await waitImages(d);
    const rr = rootEl.getBoundingClientRect();
    let tr = target.getBoundingClientRect();
    // 截单个节点时，它可能在滚动容器的可视范围之外：克隆里展开这些容器（不裁切），并按未滚动时的位置取图
    const unclip = new Map<string, string>();
    if (target !== rootEl && !region) {
      let ox = 0;
      let oy = 0;
      for (let p = target.parentElement; p; p = p.parentElement) {
        const cs = win.getComputedStyle(p);
        const id = p.getAttribute('data-node-id');
        if (id && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
          // 改成 visible 后弹性子项的自动最小尺寸会变，保留原来的计算值，避免布局变化
          unclip.set(id, `overflow:visible !important;min-width:${cs.minWidth === 'auto' ? '0px' : cs.minWidth};min-height:${cs.minHeight === 'auto' ? '0px' : cs.minHeight}`);
          ox += p.scrollLeft;
          oy += p.scrollTop;
        }
        if (p === rootEl) break;
      }
      if (ox || oy) tr = new DOMRect(tr.left + ox, tr.top + oy, tr.width, tr.height);
    }
    const fullW = Math.ceil(Math.max(rr.width, rootEl.scrollWidth, unclip.size ? tr.right - rr.left : 0));
    const fullH = Math.ceil(Math.max(rr.height, rootEl.scrollHeight, unclip.size ? tr.bottom - rr.top : 0));
    const clone = d.body.cloneNode(true) as HTMLElement;
    for (const [id, css] of unclip) {
      const el = clone.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
      if (el) el.style.cssText += `;${css}`;
    }
    // 位图按显示尺寸缩小后再内嵌：原图（常见 1000px 以上）直接转 base64 会让 SVG 有好几 MB，序列化与解码都很慢
    const liveImgs = [...d.body.querySelectorAll('img')];
    const cloneImgs = [...clone.querySelectorAll('img')];
    liveImgs.forEach((img, i) => {
      const small = scaledImage(img, scale);
      if (small && cloneImgs[i]) cloneImgs[i].setAttribute('src', small);
    });
    let html = new XMLSerializer().serializeToString(clone);
    // 其余资源换成 data URL（同一资源只取一次）
    const urls = new Set<string>();
    html.replace(/\/c\/[0-9a-f-]{36}\/assets\/[a-f0-9]{32}\.[a-z]+/g, (m) => (urls.add(m), m));
    for (const u of urls) html = html.split(u).join(await assetDataUrl(u));
    html = html.replace(/^<body([^>]*)>/, '<div$1 class="dm-body">').replace(/<\/body>$/, '</div>');
    // body/html 选择器在 foreignObject 中不生效，改写到包裹元素上
    const css = [...d.querySelectorAll('style')]
      .map((s) => s.textContent ?? '')
      .join('\n')
      .replace(/(^|[\s,}])(html|body)(?=[\s,{])/g, '$1.dm-body');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${fullW}" height="${fullH}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${fullW}px;height:${fullH}px;background:#fff"><style>${escXml(css)}</style>${html}</div></foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const sx = region ? region.x : tr.left - rr.left;
    const sy = region ? region.y : tr.top - rr.top;
    const w = Math.max(1, Math.ceil(region ? region.width : target === rootEl ? fullW : tr.width));
    const h = Math.max(1, Math.ceil(region ? region.height : target === rootEl ? fullH : tr.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -sx, -sy);
    return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
  }
}

interface Snap {
  vis: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

/** 记录画板内每个节点的显隐、位置（画板坐标）与文字。 */
function snapshot(v: FrameView): Map<string, Snap> {
  const out = new Map<string, Snap>();
  const root = v.element(v.frameId);
  const d = v.docEl;
  if (!root || !d) return out;
  const win = v.iframe!.contentWindow!;
  const rr = root.getBoundingClientRect();
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('[data-node-id]')]) {
    const r = el.getBoundingClientRect();
    const vis = win.getComputedStyle(el).display !== 'none' && !el.parentElement?.closest('[style*="display:none"]') && r.width + r.height > 0;
    out.set(el.getAttribute('data-node-id') ?? v.frameId, {
      vis,
      x: r.left - rr.left,
      y: r.top - rr.top,
      w: r.width,
      h: r.height,
      text: el.childElementCount ? '' : (el.textContent ?? (el as HTMLInputElement).value ?? ''),
    });
  }
  return out;
}

const moved = (a: Snap, b: Snap) => Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1 || Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1;

/**
 * 交互状态检查：在页面外的隐藏 iframe 中按每个状态的变量渲染画板，运行与截图自检相同的检查，
 * 另外检查被点击的控件及其同级是否因状态切换而跳动（state_shift）；按需附上变化区域的截图。
 * 用户看到的画布不受影响。
 */
export async function probeStates(canvasId: string, getDoc: () => DesignDoc | null, req: ProbeRequest): Promise<ProbeResult[]> {
  const doc = getDoc();
  const frame = doc?.frames.find((f) => f.id === req.frame);
  if (!frame) throw new Error(`没有画板 ${req.frame}`);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  const h = typeof frame.height === 'number' ? frame.height : 900;
  iframe.style.cssText = `position:fixed;left:-40000px;top:0;width:${frame.width}px;height:${h}px;border:0;opacity:0;pointer-events:none`;
  const v = new FrameView(frame.id, canvasId, getDoc);
  v.vars = req.states[0]?.vars;
  const loaded = new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('状态检查画板加载超时')), 10_000);
    const tick = () => (v.ready ? (clearTimeout(t), res()) : setTimeout(tick, 20));
    tick();
  });
  v.attach(iframe);
  document.body.appendChild(iframe);
  try {
    await loaded;
    const snaps: Array<Map<string, Snap>> = [];
    const results: ProbeResult[] = [];
    let baseline = new Set<string>();
    let images = 0;
    const area = frame.width * h;
    const started = performance.now();
    const budget = req.budgetMs ?? Infinity;
    for (let i = 0; i < req.states.length; i++) {
      const elapsed = performance.now() - started;
      // 到点停止：返回的结果比请求的状态少，服务端据此报告哪些状态没来得及检查
      if (elapsed > budget) break;
      const st = req.states[i];
      v.vars = st.vars;
      v.renderAll();
      await v.imagesLoaded();
      await new Promise((r) => setTimeout(r, 20));
      const snap = snapshot(v);
      snaps.push(snap);
      const target = req.target && v.element(req.target) ? req.target : frame.id;
      const report = v.check(target);
      let issues = report.issues;
      const key = (x: ShotIssue) => `${x.kind}|${x.id}`;
      if (req.dedupe && i === 0) {
        baseline = new Set(issues.map(key));
        results.push({ issues: [], changed: 0, width: report.width, height: report.height });
        continue;
      }
      if (req.dedupe) issues = issues.filter((x) => !baseline.has(key(x)));
      // 与上一状态比较：变化的节点、被点控件及其同级的跳动
      const prev = st.parent >= 0 ? snaps[st.parent] : undefined;
      const changed: string[] = [];
      if (prev)
        for (const [a, s] of snap) {
          const p = prev.get(a);
          if (!p || p.vis !== s.vis || (s.vis && (moved(p, s) || p.text !== s.text))) changed.push(a);
        }
      if (prev && st.click) {
        const el = v.element(st.click);
        const parentEl = el?.parentElement?.closest('[data-node-id]');
        const group = parentEl ? [...parentEl.children].map((k) => k.getAttribute('data-node-id')).filter((a): a is string => !!a) : st.click ? [st.click] : [];
        for (const a of group) {
          const p = prev.get(a);
          const s = snap.get(a);
          if (!p || !s || !p.vis || !s.vis || !moved(p, s)) continue;
          const dx = Math.round(s.x - p.x);
          const dy = Math.round(s.y - p.y);
          const dw = Math.round(s.w - p.w);
          const dh = Math.round(s.h - p.h);
          const parts = [dx && `x${dx > 0 ? '+' : ''}${dx}`, dy && `y${dy > 0 ? '+' : ''}${dy}`, dw && `宽${dw > 0 ? '+' : ''}${dw}`, dh && `高${dh > 0 ? '+' : ''}${dh}`].filter(Boolean).join(' ');
          issues.push({
            kind: 'state_shift',
            id: a,
            detail: `点击 ${st.click} 后${a === st.click ? '自身' : '同级'}位置 / 尺寸变化（${parts}px）：选中态不应改变控件尺寸：给控件固定 box.width 并设 textAlign:"center"（字重变化不再挤动同级），边框类选中态在未选中时预留同宽的透明边框`,
          });
        }
      }
      // 变化区域：变化节点与问题节点的并集
      let region: ProbeResult['region'];
      const boxes = [...new Set([...changed, ...issues.map((x) => x.id)])]
        .map((a) => snap.get(a))
        .filter((s): s is Snap => !!s && s.vis && s.w * s.h > 0 && s.w * s.h < area * 0.98);
      if (boxes.length) {
        const pad = 12;
        const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
        const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
        const x1 = Math.min(report.width, Math.max(...boxes.map((b) => b.x + b.w)) + pad);
        const y1 = Math.min(report.height, Math.max(...boxes.map((b) => b.y + b.h)) + pad);
        if (st.parent >= 0 && (x1 - x0) * (y1 - y0) < report.width * report.height * 0.6) region = { x: Math.round(x0), y: Math.round(y0), width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
      }
      const want = req.images === 'all' || (req.images === 'issues' && issues.length > 0);
      let png: string | undefined;
      // 截图最费时：用掉六成预算后只做文字检查
      if (want && images < req.maxImages && performance.now() - started < budget * 0.6) {
        images++;
        png = await v.screenshot(target, req.scale, target === frame.id ? region : undefined);
      }
      results.push({ issues: issues.slice(0, 40), png, region: png && target === frame.id ? region : undefined, changed: changed.length, width: report.width, height: report.height });
    }
    return results;
  } finally {
    v.detach();
    iframe.remove();
  }
}

/** 等待文档内图片加载完（用事件监听，不覆盖页面自己的 onload）。 */
function waitImages(d: Document): Promise<unknown> {
  return Promise.all(
    [...d.images].map((img) =>
      img.complete
        ? null
        : new Promise((r) => {
            img.addEventListener('load', r, { once: true });
            img.addEventListener('error', r, { once: true });
          }),
    ),
  );
}

const assetCache = new Map<string, Promise<string>>();
/** 资源转 data URL，按地址缓存（资源按内容寻址，地址不变内容就不变）。 */
function assetDataUrl(u: string): Promise<string> {
  let p = assetCache.get(u);
  if (!p) {
    p = fetch(u)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(String(fr.result));
            fr.onerror = () => rej(fr.error);
            fr.readAsDataURL(blob);
          }),
      );
    p.catch(() => assetCache.delete(u));
    if (assetCache.size >= 200) assetCache.delete(assetCache.keys().next().value!);
    assetCache.set(u, p);
  }
  return p;
}

const scaledCache = new Map<string, string>();
/** 把明显大于显示尺寸的位图缩到显示尺寸 × 截图倍率（最多 2 倍）；无需缩小或无法绘制时返回 undefined。 */
function scaledImage(img: HTMLImageElement, scale: number): string | undefined {
  if (!img.complete || !img.naturalWidth || /\.svg(\?|$)/i.test(img.currentSrc || img.src)) return undefined;
  const r = img.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return undefined;
  const k = Math.min(2, Math.max(1, scale));
  // object-fit: cover 会裁切：按铺满显示框所需的倍率缩放
  const ratio = Math.max((r.width * k) / img.naturalWidth, (r.height * k) / img.naturalHeight);
  if (ratio > 0.75) return undefined;
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const key = `${img.currentSrc || img.src}|${w}x${h}`;
  const hit = scaledCache.get(key);
  if (hit) return hit;
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    // webp 保留透明度且体积小；不支持时浏览器会退回 png
    const url = c.toDataURL('image/webp', 0.9);
    if (scaledCache.size >= 200) scaledCache.delete(scaledCache.keys().next().value!);
    scaledCache.set(key, url);
    return url;
  } catch {
    return undefined;
  }
}

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 根据一组操作计算每个画板需要重绘的地址。 */
export function dirtyByFrame(doc: DesignDoc, ops: Op[], pre: Map<string, string | null>): Map<string, Set<string>> | 'all' {
  const out = new Map<string, Set<string>>();
  const idx = getIndex(doc);
  const add = (frameId: string, addr: string) => {
    let s = out.get(frameId);
    if (!s) out.set(frameId, (s = new Set()));
    s.add(addr);
  };
  const touchNode = (id: string) => {
    const loc = idx.get(id);
    if (!loc) return;
    if (loc.frame) {
      // 实例节点或普通节点；作为父容器时子节点需要“fill”上下文，直接重绘自身即可
      add(loc.frame.id, loc.parent ? id : loc.frame.id);
    } else if (loc.component) {
      for (const u of componentUsers(doc, loc.component)) add(u.frame!.id, u.node.id);
    }
  };
  for (const op of ops) {
    switch (op.op) {
      case 'set':
        touchNode(op.id);
        // 布局变化影响子节点的 fill 计算：重绘父节点更稳妥
        if (op.field === 'layout' || op.field === 'box') {
          const p = idx.get(op.id)?.parent;
          if (p) touchNode(p.id);
        }
        break;
      case 'set_override':
        touchNode(op.id);
        break;
      case 'insert':
        touchNode(op.parent);
        break;
      case 'remove':
      case 'move': {
        const p = pre.get(op.id);
        if (p) touchNode(p);
        if (op.op === 'move') touchNode(op.parent);
        break;
      }
      case 'set_tokens':
      case 'set_tweaks':
      case 'asset_add':
        break;
      default:
        return 'all';
    }
  }
  return out;
}

/** AI 一次写入中新插入的子树（按画板分组），用于回放；插入组件定义内的节点不回放。 */
export function insertedByFrame(doc: DesignDoc, ops: Op[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const idx = getIndex(doc);
  const add = (frameId: string, addr: string) => {
    const l = out.get(frameId);
    if (l) l.push(addr);
    else out.set(frameId, [addr]);
  };
  for (const op of ops) {
    if (op.op === 'insert') {
      const loc = idx.get(op.node.id);
      if (loc?.frame) add(loc.frame.id, op.node.id);
    } else if (op.op === 'frame_create' && op.frame.root.children?.length && doc.frames.some((f) => f.id === op.frame.id)) add(op.frame.id, op.frame.id);
  }
  return out;
}

/** 文档中的所有图片地址都需要用资源 URL；导出给检查用。 */
export function allAddrs(doc: DesignDoc, frameId: string): string[] {
  const f = doc.frames.find((x) => x.id === frameId);
  const out: string[] = [];
  if (f) walkTree(f.root, (n) => out.push(n.id));
  return out;
}
