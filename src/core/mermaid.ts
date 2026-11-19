// Mermaid 流程图（flowchart / graph）的子集解析与分层布局，供 design_annotate 的 flow 参数用：
// AI 用几行 Mermaid 写出业务流程，服务端排好位置，生成说明框与箭头，免得逐个计算坐标、箭头互相穿过。
// 支持：方向 TD/TB/BT/LR/RL；节点 id[文字]、id(文字)、id((文字))、id{文字}、id([文字])、id[[文字]]、id>文字] 等；
// 连线 -->、---、-.->、-.-、==>、===，标签 -->|文字| 或 -- 文字 -->；链式 A --> B --> C 与 A & B --> C。
// 忽略 subgraph / end / classDef / class / style / linkStyle / click 与 %% 注释。不依赖 DOM / Node。

export type FlowDir = 'TD' | 'LR' | 'BT' | 'RL';

export interface FlowNode {
  id: string;
  text: string;
  /** decision：菱形 {…}；terminal：圆角 / 圆形；box：其余。 */
  shape: 'box' | 'decision' | 'terminal';
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  arrow: boolean;
}

export interface FlowGraph {
  dir: FlowDir;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export class FlowError extends Error {}

const ID = /[\p{L}\p{N}_]+/uy;
const SHAPES: Array<[string, string, FlowNode['shape']]> = [
  ['(((', ')))', 'terminal'],
  ['((', '))', 'terminal'],
  ['([', '])', 'terminal'],
  ['[[', ']]', 'box'],
  ['[(', ')]', 'box'],
  ['{{', '}}', 'decision'],
  ['[/', '/]', 'box'],
  ['[\\', '\\]', 'box'],
  ['[/', '\\]', 'box'],
  ['[\\', '/]', 'box'],
  ['[', ']', 'box'],
  ['(', ')', 'terminal'],
  ['{', '}', 'decision'],
  ['>', ']', 'box'],
];
// 带文字的连线：-- 文字 -->、-. 文字 .->、== 文字 ==>
const LABELED = [/--\s*([^->|][^|]*?)\s*(-->|---)/y, /-\.\s*(.+?)\s*\.(->|-)/y, /==\s*([^=>|][^|]*?)\s*(==>|===)/y];
const PLAIN = /<?(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|--[ox]|==[ox])/y;

const cleanText = (t: string) =>
  t
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&quot;/g, '"')
    .replace(/#quot;/g, '"')
    .trim();

/** 解析 Mermaid 流程图。 */
export function parseFlow(src: string): FlowGraph {
  if (src.length > 40_000) throw new FlowError('流程图过长');
  const lines = src
    .split(/\n|;/)
    .map((l) => l.replace(/%%.*$/, '').trim())
    .filter(Boolean);
  let dir: FlowDir = 'TD';
  const head = /^(flowchart|graph)\b\s*(TD|TB|BT|LR|RL)?\s*$/i.exec(lines[0] ?? '');
  if (head) {
    const d = (head[2] ?? 'TD').toUpperCase();
    dir = d === 'TB' ? 'TD' : (d as FlowDir);
    lines.shift();
  }
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const touch = (id: string, text?: string, shape?: FlowNode['shape']) => {
    const n = nodes.get(id);
    if (!n) nodes.set(id, { id, text: text ?? id, shape: shape ?? 'box' });
    else if (text !== undefined) Object.assign(n, { text, shape: shape ?? n.shape });
  };

  for (const [no, line] of lines.entries()) {
    if (/^(subgraph|end$|end\s|classDef|class\s|style\s|linkStyle|click\s|direction\s|accTitle|accDescr|title\s)/i.test(line)) continue;
    let i = 0;
    const fail = (msg: string): never => {
      throw new FlowError(`流程图第 ${no + 1} 行“${line}”：${msg}`);
    };
    const ws = () => {
      while (i < line.length && /\s/.test(line[i])) i++;
    };
    /** 一组节点：A 或 A & B & C。 */
    const group = (): string[] => {
      const ids: string[] = [];
      for (;;) {
        ws();
        ID.lastIndex = i;
        const m = ID.exec(line);
        if (!m) fail('应为节点 id');
        const id = m![0];
        i += id.length;
        let text: string | undefined;
        let shape: FlowNode['shape'] | undefined;
        for (const [open, close, sh] of SHAPES) {
          if (!line.startsWith(open, i)) continue;
          const end = line.indexOf(close, i + open.length);
          if (end < 0) continue;
          text = cleanText(line.slice(i + open.length, end));
          shape = sh;
          i = end + close.length;
          break;
        }
        touch(id, text, shape);
        ids.push(id);
        ws();
        if (line[i] === '&') {
          i++;
          continue;
        }
        return ids;
      }
    };
    /** 连线；没有连线时返回 undefined。 */
    const link = (): Omit<FlowEdge, 'from' | 'to'> | undefined => {
      ws();
      PLAIN.lastIndex = i;
      const m = PLAIN.exec(line);
      if (!m) {
        for (const re of LABELED) {
          re.lastIndex = i;
          const lm = re.exec(line);
          if (lm) {
            i += lm[0].length;
            const op = lm[0];
            return { label: cleanText(lm[1]), dashed: op.startsWith('-.'), arrow: op.endsWith('>') };
          }
        }
        return undefined;
      }
      i += m[0].length;
      const op = m[1];
      let label: string | undefined;
      ws();
      if (line[i] === '|') {
        const end = line.indexOf('|', i + 1);
        if (end < 0) fail('连线标签 |…| 没有结束');
        label = cleanText(line.slice(i + 1, end));
        i = end + 1;
      }
      return { ...(label ? { label } : {}), dashed: op.includes('.'), arrow: op.endsWith('>') };
    };

    let from = group();
    for (;;) {
      const l = link();
      if (!l) break;
      const to = group();
      for (const a of from) for (const b of to) edges.push({ from: a, to: b, ...l });
      from = to;
    }
    ws();
    if (i < line.length) fail(`无法识别 “${line.slice(i, i + 16)}”`);
  }
  if (!nodes.size) throw new FlowError('流程图里没有节点');
  if (nodes.size > 80) throw new FlowError(`节点过多（${nodes.size} 个，上限 80）：拆成几张图`);
  return { dir, nodes: [...nodes.values()], edges };
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 分层布局：去掉回边后按最长路径分层，层内按重心排序两轮，逐层居中。
 * size(id) 给出各节点的宽高；fixed 中的节点（如已存在的画板）不参与排布。返回左上角坐标（原点为 0,0）。
 */
export function layoutFlow(g: FlowGraph, size: (id: string) => { w: number; h: number }, fixed: Set<string> = new Set(), gap = { rank: 72, node: 40 }): Placed[] {
  const ids = g.nodes.map((n) => n.id).filter((id) => !fixed.has(id));
  const idSet = new Set(ids);
  const out = new Map<string, string[]>();
  const inn = new Map<string, string[]>();
  for (const id of ids) (out.set(id, []), inn.set(id, []));
  // 回边：DFS 中指向栈内节点的边
  const state = new Map<string, number>();
  const forward: Array<[string, string]> = [];
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of g.edges) if (idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to) adj.get(e.from)!.push(e.to);
  const dfs = (u: string) => {
    state.set(u, 1);
    for (const v of adj.get(u)!) {
      if (state.get(v) === 1) continue;
      forward.push([u, v]);
      if (!state.get(v)) dfs(v);
    }
    state.set(u, 2);
  };
  for (const id of ids) if (!state.get(id)) dfs(id);
  for (const [u, v] of forward) (out.get(u)!.push(v), inn.get(v)!.push(u));
  // 最长路径分层（拓扑序）
  const rank = new Map<string, number>();
  const indeg = new Map(ids.map((id) => [id, inn.get(id)!.length]));
  const queue = ids.filter((id) => !indeg.get(id));
  for (const id of queue) rank.set(id, 0);
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of out.get(u)!) {
      rank.set(v, Math.max(rank.get(v) ?? 0, rank.get(u)! + 1));
      indeg.set(v, indeg.get(v)! - 1);
      if (!indeg.get(v)) queue.push(v);
    }
  }
  const layers: string[][] = [];
  for (const id of ids) (layers[rank.get(id) ?? 0] ??= []).push(id);
  // 重心排序
  const pos = new Map<string, number>();
  const index = () => layers.forEach((l) => l?.forEach((id, i) => pos.set(id, i)));
  index();
  for (let pass = 0; pass < 2; pass++) {
    for (const [r, layer] of layers.entries()) {
      if (!layer || r === 0) continue;
      const bc = (id: string) => {
        const ps = inn.get(id)!.map((p) => pos.get(p)!);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(id)!;
      };
      layer.sort((a, b) => bc(a) - bc(b));
      index();
    }
  }
  const horizontal = g.dir === 'LR' || g.dir === 'RL';
  const reverse = g.dir === 'BT' || g.dir === 'RL';
  // 主轴：层；交叉轴：层内。主轴上每层占该层最大的厚度
  const thick = layers.map((l) => Math.max(0, ...(l ?? []).map((id) => (horizontal ? size(id).w : size(id).h))));
  const spans = layers.map((l) => (l ?? []).reduce((s, id, i) => s + (horizontal ? size(id).h : size(id).w) + (i ? gap.node : 0), 0));
  const widest = Math.max(0, ...spans);
  const placed: Placed[] = [];
  let main = 0;
  const order = reverse ? [...layers.keys()].reverse() : [...layers.keys()];
  for (const r of order) {
    const layer = layers[r] ?? [];
    let cross = (widest - spans[r]) / 2;
    for (const id of layer) {
      const { w, h } = size(id);
      const along = horizontal ? w : h;
      const m = main + (thick[r] - along) / 2;
      placed.push(horizontal ? { id, x: Math.round(m), y: Math.round(cross), w, h } : { id, x: Math.round(cross), y: Math.round(m), w, h });
      cross += (horizontal ? h : w) + gap.node;
    }
    main += thick[r] + gap.rank;
  }
  return placed;
}

/** 两个矩形之间的连线端点：各取朝向对方中心的那条边的中点。 */
export function connect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): [[number, number], [number, number]] {
  const ac = [a.x + a.w / 2, a.y + a.h / 2];
  const bc = [b.x + b.w / 2, b.y + b.h / 2];
  const dx = bc[0] - ac[0];
  const dy = bc[1] - ac[1];
  // 按归一化的方向决定走横边还是竖边
  const horiz = Math.abs(dx) / (a.w + b.w) > Math.abs(dy) / (a.h + b.h);
  if (horiz) {
    const s = Math.sign(dx) || 1;
    return [
      [Math.round(ac[0] + (s * a.w) / 2), Math.round(ac[1])],
      [Math.round(bc[0] - (s * b.w) / 2), Math.round(bc[1])],
    ];
  }
  const s = Math.sign(dy) || 1;
  return [
    [Math.round(ac[0]), Math.round(ac[1] + (s * a.h) / 2)],
    [Math.round(bc[0]), Math.round(bc[1] - (s * b.h) / 2)],
  ];
}
