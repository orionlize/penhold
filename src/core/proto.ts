// 原型交互：校验、状态变量收集。求值与运行时见 protoEngine.ts（画布、导出与播放共用）。
import { createProtoEngine } from './protoEngine.js';
import type { DesignDoc, Frame, Node, Proto, ProtoAction, ProtoValue } from './types.js';

export const VAR_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,40}$/;
const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;

const engine = createProtoEngine();
export const { parseExpr, evalExpr, truthy, renderTemplate, ExprError } = engine;

export const hasTemplate = (text: string | undefined) => !!text && text.includes('{{');

/** 校验表达式语法，返回错误信息。 */
export function exprError(src: string): string | undefined {
  try {
    parseExpr(src);
    return undefined;
  } catch (e) {
    return `表达式 “${src}” 有误：${(e as Error).message}`;
  }
}

export function templateErrors(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TEMPLATE_RE)) {
    const err = exprError(m[1].trim());
    if (err) out.push(err);
  }
  return out;
}

/** 校验 proto 中所有表达式与变量名，返回错误列表。 */
export function protoErrors(p: Proto): string[] {
  const out: string[] = [];
  const ex = (s: string | undefined) => {
    if (s === undefined) return;
    const e = exprError(s);
    if (e) out.push(e);
  };
  const v = (n: string) => !VAR_RE.test(n) && out.push(`变量名 “${n}” 只能含字母数字下划线，且不以数字开头`);
  const acts = (list: ProtoAction[] | undefined, depth = 0) => {
    if (!list) return;
    if (depth > 8) return void out.push('动作嵌套过深');
    for (const a of list) {
      if ('var' in a) v(a.var);
      if (a.do === 'set') {
        if (a.expr !== undefined) ex(a.expr);
        else if (a.value === undefined) out.push(`set ${a.var} 需要 value 或 expr`);
      }
      if (a.do === 'if') {
        ex(a.when);
        acts(a.then, depth + 1);
        acts(a.else, depth + 1);
      }
      if (a.do === 'countdown') acts(a.then, depth + 1);
      if (a.do === 'delay') acts(a.then, depth + 1);
      if (a.do === 'open' && !/^(https?:|mailto:|tel:)/i.test(a.url)) out.push(`open 只支持 http(s)/mailto/tel 链接：${a.url}`);
    }
  };
  for (const k of Object.keys(p.vars ?? {})) v(k);
  ex(p.show);
  ex(p.disabled);
  for (const s of p.styles ?? []) ex(s.when);
  if (p.bind) v(p.bind);
  acts(p.onClick);
  acts(p.onLoad);
  return out;
}

/** 画板的初始状态：收集画板内（含组件定义展开）所有节点声明的 vars，先声明者优先。 */
export function frameVars(doc: DesignDoc, frame: Frame): Record<string, ProtoValue> {
  const out: Record<string, ProtoValue> = {};
  const seen = new Set<string>();
  const visit = (n: Node, depth: number) => {
    if (depth > 60) return;
    for (const [k, v] of Object.entries(n.proto?.vars ?? {})) if (!(k in out)) out[k] = v;
    if (n.component && doc.components[n.component] && !seen.has(n.component)) {
      seen.add(n.component);
      visit(doc.components[n.component].root, depth + 1);
      seen.delete(n.component);
    }
    n.children?.forEach((c) => visit(c, depth + 1));
  };
  visit(frame.root, 0);
  return out;
}

/** 组件实例展开后的有效 proto：实例根上写的 proto 覆盖组件定义根的同名键。 */
export function mergeProto(def: Proto | undefined, inst: Proto | undefined): Proto | undefined {
  if (!def) return inst;
  if (!inst) return def;
  return { ...def, ...inst, vars: def.vars || inst.vars ? { ...def.vars, ...inst.vars } : undefined };
}
