// 原型交互引擎：表达式求值、文本插值与播放运行时。
//
// createProtoEngine 必须自包含（不引用模块作用域内的任何值，类型除外）：
// 导出 HTML 时直接把它的源码（Function.prototype.toString）嵌入页面脚本，
// 让导出的文件与画布播放执行同一套逻辑。
//
// 表达式语法（JS 子集，无副作用）：
//   字面量 12、'文本'、"文本"、true、false；变量名 tab、sec；
//   运算 ! - + * / %  == != < > <= >=  && ||  条件 ? 是 : 否  括号；
//   函数 len(x) 长度、pad(x, n) 左侧补 0、floor(x)、min(a, b)、max(a, b)。
import type { Proto, ProtoAction, ProtoValue } from './types.js';

/** 运行时需要的节点交互数据（由渲染器收集）。 */
export interface RuntimeEntry {
  proto: Proto;
  /** 含 {{}} 的文本模板。 */
  template?: string;
  /** 条件样式（已转为 CSS 声明）。 */
  styles: Array<{ when: string; css: string[] }>;
}

export interface ProtoNav {
  go(frameId: string): void;
  back(): void;
  open(url: string): void;
  follow(href: string): void;
}

export function createProtoEngine() {
  type Ast =
    | { k: 'lit'; v: ProtoValue }
    | { k: 'var'; n: string }
    | { k: 'un'; op: string; a: Ast }
    | { k: 'bin'; op: string; a: Ast; b: Ast }
    | { k: 'cond'; c: Ast; a: Ast; b: Ast }
    | { k: 'call'; f: string; args: Ast[] };

  const FNS: Record<string, (...a: ProtoValue[]) => ProtoValue> = {
    len: (x) => String(x ?? '').length,
    pad: (x, n) => String(x ?? '').padStart(Number(n) || 2, '0'),
    floor: (x) => Math.floor(Number(x) || 0),
    min: (a, b) => Math.min(Number(a), Number(b)),
    max: (a, b) => Math.max(Number(a), Number(b)),
  };
  const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;

  class ExprError extends Error {}

  function tokenize(src: string): string[] {
    const out: string[] = [];
    const re = /\s*(?:(\d+(?:\.\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([a-zA-Z_][a-zA-Z0-9_]*)|(==|!=|<=|>=|&&|\|\||[-+*/%!<>?:(),]))/y;
    let i = 0;
    while (i < src.length) {
      if (/^\s*$/.test(src.slice(i))) break;
      re.lastIndex = i;
      const m = re.exec(src);
      if (!m) throw new ExprError(`无法识别 “${src.slice(i).trim().slice(0, 12)}”`);
      out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
      i = re.lastIndex;
    }
    return out;
  }

  const cache = new Map<string, Ast>();

  function parseExpr(src: string): Ast {
    const hit = cache.get(src);
    if (hit) return hit;
    if (src.length > 500) throw new ExprError('表达式过长');
    const t = tokenize(src);
    let p = 0;
    const peek = () => t[p];
    const eat = (s?: string) => {
      const v = t[p];
      if (s !== undefined && v !== s) throw new ExprError(`缺少 “${s}”`);
      if (v === undefined) throw new ExprError('表达式不完整');
      p++;
      return v;
    };
    const bin = (lvl: number): Ast => {
      if (lvl === LEVELS.length) return unary();
      let a = bin(lvl + 1);
      while (LEVELS[lvl].includes(peek())) {
        const op = eat();
        a = { k: 'bin', op, a, b: bin(lvl + 1) };
      }
      return a;
    };
    const unary = (): Ast => {
      if (peek() === '!' || peek() === '-') {
        const op = eat();
        return { k: 'un', op, a: unary() };
      }
      return primary();
    };
    const primary = (): Ast => {
      const v = eat();
      if (v === '(') {
        const e = expr();
        eat(')');
        return e;
      }
      if (/^\d/.test(v)) return { k: 'lit', v: Number(v) };
      if (v[0] === "'" || v[0] === '"') return { k: 'lit', v: v.slice(1, -1).replace(/\\(.)/g, '$1') };
      if (v === 'true' || v === 'false') return { k: 'lit', v: v === 'true' };
      if (/^[a-zA-Z_]/.test(v)) {
        if (peek() !== '(') return { k: 'var', n: v };
        if (!FNS[v]) throw new ExprError(`未知函数 ${v}()`);
        eat('(');
        const args: Ast[] = [];
        if (peek() !== ')') {
          args.push(expr());
          while (peek() === ',') {
            eat(',');
            args.push(expr());
          }
        }
        eat(')');
        return { k: 'call', f: v, args };
      }
      throw new ExprError(`意外的 “${v}”`);
    };
    const expr = (): Ast => {
      const c = bin(0);
      if (peek() !== '?') return c;
      eat('?');
      const a = expr();
      eat(':');
      return { k: 'cond', c, a, b: expr() };
    };
    const ast = expr();
    if (p < t.length) throw new ExprError(`多余的 “${t[p]}”`);
    if (cache.size > 2000) cache.clear();
    cache.set(src, ast);
    return ast;
  }

  const eq = (a: ProtoValue, b: ProtoValue) => (typeof a === typeof b ? a === b : String(a) === String(b));

  function run(a: Ast, vars: Record<string, ProtoValue>): ProtoValue {
    switch (a.k) {
      case 'lit':
        return a.v;
      case 'var':
        return vars[a.n] ?? '';
      case 'un': {
        const v = run(a.a, vars);
        return a.op === '!' ? !v : -Number(v);
      }
      case 'cond':
        return run(a.c, vars) ? run(a.a, vars) : run(a.b, vars);
      case 'call':
        return FNS[a.f](...a.args.map((x) => run(x, vars)));
      case 'bin': {
        if (a.op === '&&') return run(a.a, vars) && run(a.b, vars);
        if (a.op === '||') return run(a.a, vars) || run(a.b, vars);
        const l = run(a.a, vars);
        const r = run(a.b, vars);
        switch (a.op) {
          case '==':
            return eq(l, r);
          case '!=':
            return !eq(l, r);
          case '+':
            return typeof l === 'number' && typeof r === 'number' ? l + r : `${l}${r}`;
          case '-':
            return Number(l) - Number(r);
          case '*':
            return Number(l) * Number(r);
          case '/':
            return Number(l) / Number(r);
          case '%':
            return Number(l) % Number(r);
          case '<':
            return Number(l) < Number(r);
          case '>':
            return Number(l) > Number(r);
          case '<=':
            return Number(l) <= Number(r);
          case '>=':
            return Number(l) >= Number(r);
        }
      }
    }
    return '';
  }

  /** 求值；语法错误返回 undefined。 */
  function evalExpr(src: string, vars: Record<string, ProtoValue>): ProtoValue | undefined {
    try {
      return run(parseExpr(src), vars);
    } catch {
      return undefined;
    }
  }

  const truthy = (src: string | undefined, vars: Record<string, ProtoValue>) => (src === undefined ? true : !!evalExpr(src, vars));

  /** 文本插值：{{表达式}}。 */
  function renderTemplate(text: string, vars: Record<string, ProtoValue>): string {
    return text.replace(TEMPLATE_RE, (_, e: string) => {
      const v = evalExpr(e.trim(), vars);
      return v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
    });
  }

  /** 一个画板的运行时：维护状态变量，执行动作，按状态刷新显隐、条件样式、文本与禁用。 */
  class ProtoRuntime {
    vars: Record<string, ProtoValue> = {};
    private entries = new Map<string, RuntimeEntry>();
    private els: Array<[HTMLElement, RuntimeEntry, string]> = [];
    private countdowns = new Map<string, number>();
    private timeouts = new Set<number>();
    /** 进入画板或停止时递增：之前排队的动作不再执行。 */
    private gen = 0;

    constructor(
      private win: Window,
      private nav: ProtoNav,
    ) {}

    /** 进入画板：重置状态。 */
    reset(initial: Record<string, ProtoValue>) {
      this.stopAll();
      this.vars = { ...initial };
    }

    /** 文档变化后同一画板重绘：保留当前状态，只补充新声明的变量。 */
    merge(initial: Record<string, ProtoValue>) {
      for (const [k, v] of Object.entries(initial)) if (!(k in this.vars)) this.vars[k] = v;
    }

    /** 绑定渲染结果：root 内 data-dm-p="<prefix><序号>" 的元素对应 entries[序号]。 */
    mount(root: ParentNode, entries: RuntimeEntry[], prefix = '') {
      this.entries = new Map(entries.map((e, i) => [prefix + i, e]));
      this.els = [];
      for (const [id, e] of this.entries) {
        const el = root.querySelector<HTMLElement>(`[data-dm-p="${id}"]`);
        if (!el) continue;
        if (e.proto.onClick) el.setAttribute('data-dm-click', '');
        // 内联样式模式下元素自带样式：条件样式叠加在其后
        this.els.push([el, e, el.getAttribute('style') ?? '']);
      }
      this.apply();
    }

    owns(el: Element) {
      const id = el.getAttribute('data-dm-p');
      return id !== null && this.entries.has(id);
    }

    runLoad() {
      for (const e of this.entries.values()) if (e.proto.onLoad) this.run(e.proto.onLoad);
    }

    stopAll() {
      this.gen++;
      for (const t of this.countdowns.values()) this.win.clearInterval(t);
      for (const t of this.timeouts) this.win.clearTimeout(t);
      this.countdowns.clear();
      this.timeouts.clear();
    }

    apply() {
      const v = this.vars;
      for (const [el, e, base] of this.els) {
        const css: string[] = base ? [base] : [];
        for (const s of e.styles) if (truthy(s.when, v)) css.push(...s.css);
        if (!truthy(e.proto.show, v)) css.push('display:none');
        const text = css.join(';');
        if (el.style.cssText !== text) el.style.cssText = text;
        el.toggleAttribute('data-dm-disabled', e.proto.disabled !== undefined && truthy(e.proto.disabled, v));
        if (e.template && !el.firstElementChild) {
          const t = renderTemplate(e.template, v);
          if (el.textContent !== t) el.textContent = t;
        }
        if (e.proto.bind && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          const field = el as HTMLInputElement;
          const val = String(v[e.proto.bind] ?? '');
          if (field.value !== val && el.ownerDocument.activeElement !== el) field.value = val;
        }
      }
    }

    private entryOf(el: Element): RuntimeEntry | undefined {
      const id = el.getAttribute('data-dm-p');
      return id === null ? undefined : this.entries.get(id);
    }

    /** 处理点击：返回是否命中了可交互元素（含被禁用的元素）。 */
    click(target: Element): boolean {
      let el: Element | null = target.closest('[data-dm-click],[data-dm-href]');
      while (el) {
        if (el.hasAttribute('data-dm-disabled')) return true;
        const e = this.entryOf(el);
        const href = el.getAttribute('data-dm-href');
        if (e?.proto.onClick || href) {
          const gen = this.gen;
          if (e?.proto.onClick) this.run(e.proto.onClick);
          if (href && gen === this.gen) this.nav.follow(href);
          return true;
        }
        el = el.parentElement?.closest('[data-dm-click],[data-dm-href]') ?? null;
      }
      return !!target.closest('[data-dm-disabled]');
    }

    input(target: Element) {
      const e = this.entryOf(target);
      if (!e?.proto.bind || !('value' in target)) return;
      this.vars[e.proto.bind] = String((target as HTMLInputElement).value);
      this.apply();
    }

    run(actions: ProtoAction[]) {
      const gen = this.gen;
      for (const a of actions) {
        if (gen !== this.gen) return;
        switch (a.do) {
          case 'set': {
            const v = a.expr !== undefined ? evalExpr(a.expr, this.vars) : a.value;
            if (v !== undefined) this.vars[a.var] = v;
            break;
          }
          case 'toggle':
            this.vars[a.var] = !this.vars[a.var];
            break;
          case 'countdown': {
            this.clearCountdown(a.var);
            this.vars[a.var] = a.from;
            const t = this.win.setInterval(() => {
              const n = Number(this.vars[a.var]) - 1;
              this.vars[a.var] = Math.max(0, n);
              if (n <= 0) {
                this.clearCountdown(a.var);
                if (a.then) this.run(a.then);
              }
              this.apply();
            }, a.interval ?? 1000);
            this.countdowns.set(a.var, t);
            break;
          }
          case 'stop':
            this.clearCountdown(a.var);
            break;
          case 'delay': {
            const t = this.win.setTimeout(() => {
              this.timeouts.delete(t);
              if (gen === this.gen) this.run(a.then);
            }, a.ms);
            this.timeouts.add(t);
            break;
          }
          case 'if':
            this.run((truthy(a.when, this.vars) ? a.then : a.else) ?? []);
            break;
          case 'navigate':
            return this.nav.go(a.frame);
          case 'back':
            return this.nav.back();
          case 'open':
            this.nav.open(a.url);
            break;
        }
      }
      if (gen === this.gen) this.apply();
    }

    private clearCountdown(name: string) {
      const t = this.countdowns.get(name);
      if (t !== undefined) this.win.clearInterval(t);
      this.countdowns.delete(name);
    }
  }

  return { ExprError, parseExpr, evalExpr, truthy, renderTemplate, ProtoRuntime };
}

export type ProtoEngine = ReturnType<typeof createProtoEngine>;
export type ProtoRuntime = InstanceType<ProtoEngine['ProtoRuntime']>;
