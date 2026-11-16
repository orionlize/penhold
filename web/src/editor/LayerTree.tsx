// 侧栏图层树：选中、重命名、隐藏、锁定。不可拖拽，不可增删节点。
// 铅笔 / 钢笔 / 矩形批注也列在所属画板下（无画板的列在顶层），点击即选中该批注。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Annotation, DesignDoc, Node } from '../../../src/core/types';
import { firstFamily, fontAvailable } from '../lib/fonts';
import { Icon } from '../lib/icons';
import { commitPatch, effective, select, useStore } from '../store';
import { inLayers, noteIcon, noteName } from '../lib/shapes';
import { t } from '../i18n';

interface Row {
  addr: string;
  node: Node;
  depth: number;
  hasKids: boolean;
  inInstance: boolean;
  frame?: boolean;
}

interface NoteRow {
  note: Annotation;
  depth: number;
}

type AnyRow = ({ kind: 'node' } & Row) | ({ kind: 'note' } & NoteRow);


function rows(doc: DesignDoc, notes: Annotation[], open: Set<string>): AnyRow[] {
  const out: AnyRow[] = [];
  // 最新绘制的排在最上面（批注层位于设计稿之上）
  const drawn = notes.filter(inLayers).reverse();
  const frameIds = new Set(doc.frames.map((f) => f.id));
  const byFrame = (id?: string) => drawn.filter((n) => (id ? n.frame === id : !n.frame || !frameIds.has(n.frame)));
  for (const note of byFrame()) out.push({ kind: 'note', note, depth: 0 });
  const visit = (n: Node, addr: string, depth: number, inInstance: boolean, frame = false) => {
    const eff = effective(doc, addr);
    const node = frame ? n : (eff?.node ?? n);
    const kids = node.children ?? [];
    const own = frame ? byFrame(addr) : [];
    out.push({ kind: 'node', addr, node, depth, hasKids: kids.length + own.length > 0, inInstance, frame });
    if (!open.has(addr)) return;
    for (const note of own) out.push({ kind: 'note', note, depth: depth + 1 });
    const isInst = !!node.component && !!doc.components[node.component];
    for (const c of kids) {
      const ca = isInst ? `${addr}:${c.id}` : addr.includes(':') ? `${addr.slice(0, addr.lastIndexOf(':'))}:${c.id}` : c.id;
      visit(c, ca, depth + 1, inInstance || isInst);
    }
  };
  for (const f of doc.frames) visit({ ...f.root, name: f.name }, f.id, 0, false, true);
  return out;
}

export function LayerTree() {
  const doc = useStore((s) => s.doc);
  useStore((s) => s.version);
  const selection = useStore((s) => s.selection);
  const lock = useStore((s) => s.lock);
  const notes = useStore((s) => s.notes);
  const selNote = useStore((s) => s.selNote);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 选中变化后待滚动定位；展开祖先可能需要额外一次渲染，故用标记跨渲染保留
  const pendingScroll = useRef(false);
  const lastSel = useRef('');
  const selKey = `${selection.join(',')}|${selNote ?? ''}`;
  if (selKey !== lastSel.current) {
    lastSel.current = selKey;
    pendingScroll.current = selKey !== '|';
  }

  // 把选中行滚动到图层列表可视区域内（只滚动列表自身，不影响外层容器）
  useLayoutEffect(() => {
    if (!pendingScroll.current) return;
    const box = listRef.current;
    if (!box) return;
    const key = selNote ? `note:${selNote}` : selection[selection.length - 1];
    const el = key ? box.querySelector<HTMLElement>(`[data-addr="${CSS.escape(key)}"]`) : null;
    if (!el) return;
    pendingScroll.current = false;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop += r.top - b.top;
    else if (r.bottom > b.top + box.clientHeight) box.scrollTop += r.bottom - b.top - box.clientHeight;
  });

  // 选中批注时展开其所属画板
  useEffect(() => {
    const f = selNote ? notes.find((n) => n.id === selNote)?.frame : undefined;
    if (f && !open.has(f)) setOpen(new Set(open).add(f));
  }, [selNote]);

  // 展开到选中节点
  useEffect(() => {
    if (!doc || !selection.length) return;
    const next = new Set(open);
    let changed = false;
    for (const a of selection) {
      const segs = a.split(':');
      for (const f of doc.frames) if (!next.has(f.id)) (next.add(f.id), (changed = true));
      // 祖先：沿 DOM 无法获取，这里按索引向上找
      let id: string | undefined = segs[0];
      const idx = new Map<string, string>();
      const walk = (n: Node, p?: string) => {
        if (p) idx.set(n.id, p);
        n.children?.forEach((c) => walk(c, n.id));
      };
      doc.frames.forEach((f) => walk(f.root));
      while (id && idx.get(id)) {
        id = idx.get(id);
        if (id && !next.has(id)) (next.add(id), (changed = true));
      }
      for (let i = 1; i < segs.length; i++) {
        const pre = segs.slice(0, i).join(':');
        if (!next.has(pre)) (next.add(pre), (changed = true));
      }
    }
    if (changed) setOpen(next);
  }, [selection.join(','), doc]);

  if (!doc) return <section className="layers" />;
  const list = rows(doc, notes, open);
  const toggle = (a: string) => {
    const n = new Set(open);
    n.has(a) ? n.delete(a) : n.add(a);
    setOpen(n);
  };

  return (
    <section className="layers">
      <header className="side-title">
        {t('layers.title')}<span className="dim">{doc.frames.length ? t('layers.boards', { n: doc.frames.length }) : ''}</span>
      </header>
      <div className="layer-list" ref={listRef}>
        {list.map((r) => {
          if (r.kind === 'note') return <NoteLayer key={`note:${r.note.id}`} note={r.note} depth={r.depth} on={selNote === r.note.id} />;
          const fam = firstFamily(r.node.style?.fontFamily, useStore.getState().doc?.tokens);
          const missing = fam && !fontAvailable(fam);
          const hidden = !!r.node.meta?.hidden;
          const locked = !!r.node.meta?.locked;
          const icon = r.frame ? 'frame' : r.node.component ? 'component' : r.node.text !== undefined ? 'text' : r.node.props?.src ? 'image' : 'box';
          return (
            <div
              key={r.addr}
              data-addr={r.addr}
              className={`layer ${selection.includes(r.addr) ? 'on' : ''} ${hidden ? 'hidden' : ''} ${r.inInstance ? 'inst' : ''} ${r.frame ? 'is-frame' : ''}`}
              style={{ paddingLeft: 4 + r.depth * 14 }}
              onClick={(e) => {
                if (e.shiftKey) select(selection.includes(r.addr) ? selection.filter((x) => x !== r.addr) : [...selection, r.addr]);
                else select([r.addr]);
                if (selNote) useStore.setState({ selNote: null });
              }}
              onDoubleClick={() => !lock && !r.frame && setRenaming(r.addr)}
              onMouseEnter={() => useStore.setState({ hover: r.addr })}
              onMouseLeave={() => useStore.setState({ hover: null })}
            >
              <span
                className={`tw ${r.hasKids ? '' : 'none'} ${open.has(r.addr) ? 'open' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(r.addr);
                }}
              >
                <Icon name="caret" size={12} stroke={2} />
              </span>
              <span className={`ico ${r.node.component ? 'comp' : ''}`}>
                <Icon name={icon} size={13} />
              </span>
              {renaming === r.addr ? (
                <input
                  autoFocus
                  className="rename"
                  defaultValue={r.node.name ?? ''}
                  placeholder={r.node.type}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (r.node.name ?? '')) commitPatch([r.addr], { name: v || null });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="lname">{r.node.name ?? (r.node.text !== undefined ? r.node.text.slice(0, 24) || r.node.type : r.node.type)}</span>
              )}
              {missing && (
                <span className="warn-dot" title={t('layers.missingFont', { font: fam })}>
                  !
                </span>
              )}
              {!r.frame && (
                <span className={`acts ${hidden || locked ? 'sticky' : ''}`}>
                  <button
                    className={`icon-btn xs ${hidden ? 'on' : ''}`}
                    aria-label={hidden ? t('common.show') : t('common.hide')}
                    title={hidden ? t('common.show') : t('common.hide')}
                    disabled={!!lock}
                    onClick={(e) => {
                      e.stopPropagation();
                      commitPatch([r.addr], { meta: { hidden: hidden ? null : true } });
                    }}
                  >
                    <Icon name={hidden ? 'eyeOff' : 'eye'} size={13} />
                  </button>
                  {!r.inInstance && (
                    <button
                      className={`icon-btn xs ${locked ? 'on' : ''}`}
                      aria-label={locked ? t('layers.unlock') : t('layers.lock')}
                      title={locked ? t('layers.unlockTip') : t('layers.lockTip')}
                      disabled={!!lock}
                      onClick={(e) => {
                        e.stopPropagation();
                        commitPatch([r.addr], { meta: { locked: locked ? null : true } });
                      }}
                    >
                      <Icon name={locked ? 'lock' : 'unlock'} size={13} />
                    </button>
                  )}
                </span>
              )}
              <span className="ltag">{r.frame ? doc.frames.find((f) => f.id === r.addr)?.width : r.node.component ? r.node.component : r.node.type}</span>
            </div>
          );
        })}
        {!list.length && <div className="side-empty">{t('layers.empty')}</div>}
      </div>
    </section>
  );
}

/** 批注图层行：点击选中画布上的批注（与在画布上点击它相同）。 */
function NoteLayer({ note, depth, on }: { note: Annotation; depth: number; on: boolean }) {
  return (
    <div
      data-addr={`note:${note.id}`}
      className={`layer note ${on ? 'on' : ''}`}
      style={{ paddingLeft: 4 + depth * 14 }}
      onMouseEnter={() => useStore.setState({ hoverNote: note.id })}
      onMouseLeave={() => useStore.setState({ hoverNote: null })}
      onClick={() => {
        select([]);
        useStore.setState({ selNote: note.id, openComment: null, editNote: null });
      }}
    >
      <span className="tw none">
        <Icon name="caret" size={12} stroke={2} />
      </span>
      <span className="ico">
        <Icon name={noteIcon(note)} size={13} />
      </span>
      <span className="lname">{noteName(note)}{note.text ? <span className="lsub"> {note.text.split('\n')[0].slice(0, 24)}</span> : null}</span>
      <span className="ltag">{note.by === 'ai' ? 'AI' : note.kind}</span>
    </div>
  );
}
