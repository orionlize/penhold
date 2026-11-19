// 节点的 JSX 写法：node_insert / node_replace 的 jsx 参数与 design_read 的 format:"jsx"。
// 只是 Node JSON 的另一种拼写，不是 React，也不执行任何代码：
// - 标签名即 type；layout / box / style 的字段、交互态（hover / focus / active）与 proto 的字段可以直接写成属性，
//   其余未知属性归入 props（值转成字符串）；也可以整块写 layout={{…}} style={{…}}。
// - 属性值："字符串" / '字符串'，或 {JSON 值}（键可不加引号，可用单引号与尾逗号）；不带值的属性为 true。
// - 子元素即 children；元素内的纯文字即 text（按原样保留，{{表达式}} 插值不会被当成 JSX 表达式，
//   多行时逐行去掉首尾空白）。文字里的 < & 写成 &lt; &amp;。文字与子元素不能混写。
// 前后端共用，不依赖 DOM / Node。
import { BoxSchema, LayoutSchema, StyleSchema } from './schema.js';
import type { NodeInput } from './schema.js';

export class JsxError extends Error {
  constructor(message: string, public pos?: number) {
    super(message);
  }
}

const keysOf = (s: { shape?: Record<string, unknown> }) => new Set(Object.keys(s.shape ?? {}));
const LAYOUT_KEYS = keysOf(LayoutSchema as never);
const BOX_KEYS = keysOf(BoxSchema as never);
const STYLE_KEYS = keysOf(StyleSchema as never);
const STATE_KEYS = new Set(['hover', 'focus', 'active']);
const PROTO_KEYS = new Set(['vars', 'onClick', 'onLoad', 'show', 'disabled', 'styles', 'bind']);
const OBJECT_FIELDS = new Set(['layout', 'box', 'style', 'props', 'states', 'proto', 'overrides', 'meta']);
const PLAIN_FIELDS = new Set(['id', 'type', 'render', 'name', 'component', 'text']);
/** 只在 design_read 输出里出现、不能写回的标记。 */
const READ_ONLY = new Set(['stub', 'locked']);

/** 读取后写回时保留原子节点：<card id="x" keepChildren …/>。 */
export const KEEP_CHILDREN = 'keepChildren';

export interface JsxNode extends NodeInput {
  /** keepChildren：沿用该 id 原有的子节点（只在 node_replace 中有效）。 */
  keepChildren?: boolean;
}

// ---------------- 解析 ----------------

const TAG_RE = /[\p{L}_][\p{L}\p{N}_.-]*/uy;
const ATTR_RE = /[A-Za-z_][\w-]*/y;

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', lbrace: '{', rbrace: '}' };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

class Parser {
  i = 0;
  constructor(private s: string) {}

  fail(msg: string, at = this.i): never {
    const before = this.s.slice(0, at);
    const line = before.split('\n').length;
    const col = at - before.lastIndexOf('\n');
    const near = this.s.slice(at, at + 24).replace(/\n/g, '⏎');
    throw new JsxError(`JSX 第 ${line} 行第 ${col} 列：${msg}${near ? `（在 “${near}” 处）` : ''}`, at);
  }

  ws() {
    for (;;) {
      while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
      if (this.s.startsWith('{/*', this.i)) {
        const end = this.s.indexOf('*/}', this.i + 3);
        if (end < 0) this.fail('注释没有结束');
        this.i = end + 3;
      } else if (this.s.startsWith('<!--', this.i)) {
        const end = this.s.indexOf('-->', this.i + 4);
        if (end < 0) this.fail('注释没有结束');
        this.i = end + 3;
      } else return;
    }
  }

  match(re: RegExp): string | undefined {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (!m) return undefined;
    this.i += m[0].length;
    return m[0];
  }

  expect(ch: string) {
    if (!this.s.startsWith(ch, this.i)) this.fail(`应为 “${ch}”`);
    this.i += ch.length;
  }

  /** 顶层：若干个兄弟元素。 */
  roots(): Array<{ tag: string; attrs: Map<string, unknown>; children: unknown[]; text?: string; at: number }> {
    const out = [];
    this.ws();
    while (this.i < this.s.length) {
      if (this.s[this.i] !== '<') this.fail('顶层只能是元素（以 < 开头）');
      out.push(this.element());
      this.ws();
    }
    if (!out.length) this.fail('没有任何元素');
    return out;
  }

  element(): { tag: string; attrs: Map<string, unknown>; children: unknown[]; text?: string; at: number } {
    const at = this.i;
    this.expect('<');
    const tag = this.match(TAG_RE);
    if (!tag) this.fail('缺少标签名（即节点 type）');
    const attrs = new Map<string, unknown>();
    for (;;) {
      this.ws();
      if (this.s.startsWith('/>', this.i)) {
        this.i += 2;
        return { tag, attrs, children: [], at };
      }
      if (this.s[this.i] === '>') {
        this.i++;
        break;
      }
      const nameAt = this.i;
      const name = this.match(ATTR_RE);
      if (!name) this.fail('属性名无效');
      if (attrs.has(name)) this.fail(`属性 ${name} 重复`, nameAt);
      this.ws();
      if (this.s[this.i] !== '=') {
        attrs.set(name, true);
        continue;
      }
      this.i++;
      this.ws();
      const q = this.s[this.i];
      if (q === '"' || q === "'") {
        const end = this.s.indexOf(q, this.i + 1);
        if (end < 0) this.fail('字符串没有结束');
        attrs.set(name, decodeEntities(this.s.slice(this.i + 1, end)));
        this.i = end + 1;
      } else if (q === '{') {
        this.i++;
        this.ws();
        const v = this.value();
        this.ws();
        this.expect('}');
        attrs.set(name, v);
      } else this.fail(`属性 ${name} 的值要写成 "…" 或 {…}`);
    }
    // 子内容：文字或子元素
    const children: unknown[] = [];
    let text = '';
    for (;;) {
      if (this.i >= this.s.length) this.fail(`<${tag}> 没有闭合`, at);
      if (this.s.startsWith('</', this.i)) {
        this.i += 2;
        const close = this.match(TAG_RE);
        if (close !== tag) this.fail(`闭合标签 </${close ?? ''}> 与 <${tag}> 不匹配`);
        this.ws();
        this.expect('>');
        break;
      }
      if (this.s.startsWith('{/*', this.i) || this.s.startsWith('<!--', this.i)) {
        this.ws();
        continue;
      }
      if (this.s[this.i] === '<') {
        children.push(this.element());
        continue;
      }
      const stops = [this.s.indexOf('<', this.i), this.s.indexOf('{/*', this.i)].filter((x) => x >= 0);
      const end = stops.length ? Math.min(...stops) : this.s.length;
      text += this.s.slice(this.i, end);
      this.i = end;
    }
    const lines = text.split('\n').map((l) => l.trim());
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const body = decodeEntities(lines.join('\n'));
    if (body && children.length) this.fail(`<${tag}> 里文字与子元素混写：把文字放进单独的子元素（如 <text>…</text>）`, at);
    return { tag, attrs, children, ...(body ? { text: body } : {}), at };
  }

  // ---- 宽松 JSON 值 ----
  value(): unknown {
    this.ws();
    const c = this.s[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"' || c === "'") return this.string();
    const num = this.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y);
    if (num !== undefined) return Number(num);
    const word = this.match(/[A-Za-z_]\w*/y);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    if (word !== undefined) this.fail(`不支持的值 ${word}：只接受 JSON 值（字符串要加引号）`);
    this.fail('应为一个值');
  }

  string(): string {
    const q = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length && this.s[this.i] !== q) {
      const ch = this.s[this.i++];
      if (ch !== '\\') {
        out += ch;
        continue;
      }
      const e = this.s[this.i++];
      if (e === 'n') out += '\n';
      else if (e === 't') out += '\t';
      else if (e === 'r') out += '\r';
      else if (e === 'u') {
        const hex = this.s.slice(this.i, this.i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('\\u 后应为 4 位十六进制');
        out += String.fromCharCode(parseInt(hex, 16));
        this.i += 4;
      } else out += e;
    }
    if (this.s[this.i] !== q) this.fail('字符串没有结束');
    this.i++;
    return out;
  }

  object(): Record<string, unknown> {
    this.expect('{');
    const out: Record<string, unknown> = {};
    for (;;) {
      this.ws();
      if (this.s[this.i] === '}') {
        this.i++;
        return out;
      }
      const c = this.s[this.i];
      const key = c === '"' || c === "'" ? this.string() : this.match(/[A-Za-z_$][\w$-]*/y);
      if (key === undefined) this.fail('对象键无效');
      this.ws();
      this.expect(':');
      out[key] = this.value();
      this.ws();
      if (this.s[this.i] === ',') this.i++;
      else if (this.s[this.i] !== '}') this.fail('对象成员之间应为 “,”');
    }
  }

  array(): unknown[] {
    this.expect('[');
    const out: unknown[] = [];
    for (;;) {
      this.ws();
      if (this.s[this.i] === ']') {
        this.i++;
        return out;
      }
      out.push(this.value());
      this.ws();
      if (this.s[this.i] === ',') this.i++;
      else if (this.s[this.i] !== ']') this.fail('数组成员之间应为 “,”');
    }
  }
}

type Raw = ReturnType<Parser['roots']>[number];

function toNode(el: Raw, path: string): JsxNode {
  const node: Record<string, unknown> = { type: el.tag === '_' ? undefined : el.tag };
  const groups: Record<string, Record<string, unknown>> = {};
  const put = (group: string, key: string, v: unknown, attr: string) => {
    const g = (groups[group] ??= {});
    if (key in g) throw new JsxError(`${path}：${attr} 与 ${group}={{…}} 里的 ${key} 重复`);
    g[key] = v;
  };
  for (const [k, v] of el.attrs) {
    if (READ_ONLY.has(k)) {
      throw new JsxError(
        k === 'stub'
          ? `${path}：stub 是 design_read 未展开的存根，不能写回；要保留它原有的子节点写 keepChildren，或先加大 depth 读取`
          : `${path}：locked 由用户设置，不能写入`,
      );
    }
    if (k === KEEP_CHILDREN) {
      if (v !== true) throw new JsxError(`${path}：keepChildren 不带值`);
      node.keepChildren = true;
    } else if (k === 'hidden') {
      if (typeof v !== 'boolean') throw new JsxError(`${path}：hidden 应为布尔值`);
      put('meta', 'hidden', v, k);
    } else if (k === 'type') node.type = v;
    else if (PLAIN_FIELDS.has(k)) node[k] = v;
    else if (OBJECT_FIELDS.has(k)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new JsxError(`${path}：${k} 应写成 ${k}={{…}}`);
      for (const [kk, vv] of Object.entries(v)) put(k, kk, vv, `${k}.${kk}`);
    } else if (LAYOUT_KEYS.has(k)) put('layout', k, v, k);
    else if (BOX_KEYS.has(k)) put('box', k, v, k);
    else if (STYLE_KEYS.has(k)) put('style', k, v, k);
    else if (STATE_KEYS.has(k)) put('states', k, v, k);
    else if (PROTO_KEYS.has(k)) put('proto', k, v, k);
    else {
      if (v !== null && typeof v === 'object') throw new JsxError(`${path}：未知属性 ${k}（只有字符串 / 数字 / 布尔值的属性会归入 props）`);
      put('props', k, v === null ? '' : String(v), k);
    }
  }
  Object.assign(node, groups);
  if (!node.type) throw new JsxError(`${path}：<_> 需要 type 属性`);
  if (el.text !== undefined) {
    if (node.text !== undefined) throw new JsxError(`${path}：text 属性与元素内文字只能写一处`);
    node.text = el.text;
  }
  if (el.children.length) {
    if (node.keepChildren) throw new JsxError(`${path}：keepChildren 与子元素只能二选一`);
    node.children = (el.children as Raw[]).map((c, i) => toNode(c, `${path}.children[${i}]`));
  }
  return node as unknown as JsxNode;
}

/** 把 JSX 解析成节点输入（尚未做字段校验，交给 validateNodeInput）。 */
export function parseJsx(src: string): JsxNode[] {
  if (src.length > 400_000) throw new JsxError('JSX 过长（>400k 字符），请分批插入');
  const roots = new Parser(src).roots();
  return roots.map((r, i) => toNode(r, roots.length > 1 ? `jsx[${i}]` : 'jsx'));
}

/**
 * 处理 keepChildren：把标记节点替换为带原有子节点的节点。
 * original(id) 返回该 id 原有的子节点（不存在时返回 undefined）。
 */
export function applyKeepChildren<T extends JsxNode>(nodes: T[], original: (id: string) => unknown[] | undefined, path = 'jsx'): T[] {
  return nodes.map((n, i) => {
    const at = nodes.length > 1 ? `${path}[${i}]` : path;
    const { keepChildren, ...rest } = n;
    if (keepChildren) {
      if (!n.id) throw new JsxError(`${at}：keepChildren 需要 id，指明沿用哪个节点的子节点`);
      const kids = original(n.id);
      if (!kids) throw new JsxError(`${at}：keepChildren 找不到节点 ${n.id} 原有的子节点（只能沿用被替换子树内的节点）`);
      return { ...rest, ...(kids.length ? { children: kids } : {}) } as T;
    }
    if (rest.children) return { ...rest, children: applyKeepChildren(rest.children as JsxNode[], original, `${at}.children`) } as T;
    return rest as T;
  });
}

/** 去掉 keepChildren 标记（node_insert 不支持沿用子节点）。 */
export function assertNoKeep(nodes: JsxNode[]): void {
  const walk = (n: JsxNode) => {
    if (n.keepChildren) throw new JsxError(`keepChildren 只能用于 node_replace（节点 ${n.id ?? n.type}）`);
    (n.children as JsxNode[] | undefined)?.forEach(walk);
  };
  nodes.forEach(walk);
}

// ---------------- 序列化 ----------------

const SIMPLE_TAG = /^[\p{L}_][\p{L}\p{N}_.-]*$/u;
const ALL_FLAT = new Set([...LAYOUT_KEYS, ...BOX_KEYS, ...STYLE_KEYS, ...STATE_KEYS, ...PROTO_KEYS, ...PLAIN_FIELDS, ...OBJECT_FIELDS, ...READ_ONLY, 'hidden', 'type', KEEP_CHILDREN]);

const ident = (k: string) => /^[A-Za-z_$][\w$-]*$/.test(k);
/** 紧凑的对象字面量：键不加引号（能省则省），值用 JSON。 */
function lit(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(lit).join(', ')}]`;
  if (v && typeof v === 'object') {
    const parts = Object.entries(v).map(([k, x]) => `${ident(k) ? k : JSON.stringify(k)}: ${lit(x)}`);
    return `{${parts.join(', ')}}`;
  }
  return JSON.stringify(v);
}

function attr(k: string, v: unknown): string {
  if (v === true) return k;
  if (typeof v === 'string' && !/["\n&]/.test(v)) return `${k}="${v}"`;
  return `${k}={${lit(v)}}`;
}

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
/** 文字能否原样写成元素内容（逐行去首尾空白后不变、首尾无空行）。 */
const textInline = (s: string) => s.length > 0 && s.split('\n').every((l) => l === l.trim() && l.length > 0);

/**
 * 把 design_read 输出的节点（含 stub / locked / hidden 标记）序列化为 JSX。
 * 输出可直接作为 node_replace 的 jsx 写回（stub 需改成 keepChildren）。
 */
export function toJsx(node: Record<string, unknown>, indent = ''): string {
  const type = String(node.type);
  const tag = SIMPLE_TAG.test(type) ? type : '_';
  const attrs: string[] = [];
  if (tag === '_') attrs.push(attr('type', type));
  for (const k of ['id', 'name', 'component', 'render'] as const) if (node[k] !== undefined) attrs.push(attr(k, node[k]));
  for (const group of ['layout', 'box', 'style', 'states', 'proto'] as const) {
    const g = node[group] as Record<string, unknown> | undefined;
    if (!g) continue;
    // 与其他分组同名的键（理论上没有）或非法属性名时整块写
    const flat = Object.keys(g).every((k) => ident(k) && !PLAIN_FIELDS.has(k) && !OBJECT_FIELDS.has(k));
    if (flat) for (const [k, v] of Object.entries(g)) attrs.push(attr(k, v));
    else attrs.push(attr(group, g));
  }
  const props = node.props as Record<string, string> | undefined;
  if (props) {
    const flat = Object.keys(props).every((k) => ident(k) && !ALL_FLAT.has(k));
    if (flat) for (const [k, v] of Object.entries(props)) attrs.push(attr(k, v));
    else attrs.push(attr('props', props));
  }
  if (node.overrides) attrs.push(attr('overrides', node.overrides));
  if (node.hidden) attrs.push('hidden');
  if (node.locked) attrs.push('locked');
  if (node.stub) attrs.push('stub');
  const text = node.text as string | undefined;
  const children = node.children as Array<Record<string, unknown>> | undefined;
  if (text !== undefined && !textInline(text)) attrs.push(attr('text', text));
  const open = `${indent}<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  if (children?.length) {
    const inner = children.map((c) => toJsx(c, `${indent}  `)).join('\n');
    return `${open}>\n${inner}\n${indent}</${tag}>`;
  }
  if (text !== undefined && textInline(text)) {
    if (!text.includes('\n')) return `${open}>${escText(text)}</${tag}>`;
    const body = text.split('\n').map((l) => `${indent}  ${escText(l)}`).join('\n');
    return `${open}>\n${body}\n${indent}</${tag}>`;
  }
  return `${open} />`;
}
