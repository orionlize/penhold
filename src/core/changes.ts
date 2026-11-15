// 从操作推导“改了哪些节点的哪些字段”，用于 design_changes 与写前校验。
import { walkTree } from './doc.js';
import type { Op } from './types.js';

export interface Touch {
  id: string;
  key: string; // "style.color"、"text"、"inserted"、"removed"、"moved"、"overrides.<path>"、"token:<name>"、"frame"
}

export function touchesOf(op: Op, inverse: Op): Touch[] {
  switch (op.op) {
    case 'insert': {
      const out: Touch[] = [];
      walkTree(op.node, (n) => out.push({ id: n.id, key: 'inserted' }));
      out.push({ id: op.parent, key: 'children' });
      return out;
    }
    case 'remove': {
      const out: Touch[] = [{ id: op.id, key: 'removed' }];
      if (inverse.op === 'insert') out.push({ id: inverse.parent, key: 'children' });
      return out;
    }
    case 'move':
      return [
        { id: op.id, key: 'moved' },
        { id: op.parent, key: 'children' },
        ...(inverse.op === 'move' && inverse.parent !== op.parent ? [{ id: inverse.parent, key: 'children' }] : []),
      ];
    case 'set': {
      const prev = inverse.op === 'set' ? inverse.value : undefined;
      if (op.value && typeof op.value === 'object' && !Array.isArray(op.value)) {
        const keys = new Set([...Object.keys(op.value as object), ...Object.keys((prev as object) ?? {})]);
        const out: Touch[] = [];
        for (const k of keys) {
          const a = (op.value as Record<string, unknown>)[k];
          const b = (prev as Record<string, unknown> | undefined)?.[k];
          if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ id: op.id, key: `${op.field}.${k}` });
        }
        return out.length ? out : [{ id: op.id, key: op.field }];
      }
      return [{ id: op.id, key: op.field }];
    }
    case 'set_override':
      return [{ id: `${op.id}:${op.path}`, key: 'overrides' }];
    case 'set_tokens':
      return Object.keys(op.tokens).map((k) => ({ id: `token:${k}`, key: 'token' }));
    case 'set_tweaks':
      return [{ id: 'tweaks', key: 'tweaks' }];
    case 'component_define':
      return [{ id: op.def.root.id, key: 'component' }];
    case 'component_remove':
      return [{ id: `cmp_${op.name}`, key: 'component_removed' }];
    case 'frame_create':
      return [{ id: op.frame.id, key: 'frame_created' }];
    case 'frame_update':
      return [{ id: op.id, key: 'frame' }];
    case 'frame_remove':
      return [{ id: op.id, key: 'frame_removed' }];
    case 'asset_add':
      return [];
    case 'doc_replace':
      return [{ id: '*', key: 'restored' }];
  }
}
