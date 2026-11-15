import { CopyButton } from '../components/copy-button';

/** 代码块；copy 为 true 时右上角带复制按钮（复制全文） */
export function Code({ children, lang, copy = true }: { children: string; lang?: string; copy?: boolean }) {
  const text = children.replace(/^\n/, '').replace(/\n\s*$/, '');
  return (
    <div className="dcode">
      {(lang || copy) && (
        <div className="dcode-bar">
          <span className="mono-xs muted">{lang ?? ''}</span>
          {copy && <CopyButton text={text} className="dcode-copy" />}
        </div>
      )}
      <pre>
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function Note({ children, kind = 'tip' }: { children: React.ReactNode; kind?: 'tip' | 'warn' }) {
  return (
    <aside className={`dnote ${kind}`}>
      <b>{kind === 'warn' ? '注意' : '提示'}</b>
      <div>{children}</div>
    </aside>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="dtable">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: React.ReactNode }) {
  return (
    <header className="dhead">
      <p className="eyebrow">
        <span className="eyebrow-mark" aria-hidden="true" />
        {eyebrow}
      </p>
      <h1>{title}</h1>
      <p className="dlede">{lede}</p>
    </header>
  );
}

/** 页内小标题，带锚点 */
export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id}>
      <a href={`#${id}`}>{children}</a>
    </h2>
  );
}
