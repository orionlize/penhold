'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOC_GROUPS, DOC_PAGES, docHref } from './nav';

function useCurrent() {
  const path = usePathname().replace(/\/$/, '');
  return DOC_PAGES.findIndex((p) => docHref(p.slug) === path);
}

export function Sidebar() {
  const cur = useCurrent();
  const current = DOC_PAGES[cur];
  const links = DOC_GROUPS.map((g) => (
    <div key={g.group} className="dn-group">
      <p className="dn-label">{g.group}</p>
      <ul>
        {g.pages.map((p) => (
          <li key={p.slug}>
            <Link href={docHref(p.slug)} aria-current={p === current ? 'page' : undefined}>
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ));
  return (
    <>
      <nav className="dn dn-desk" aria-label="文档目录">
        {links}
      </nav>
      <details className="dn dn-mob" key={cur}>
        <summary>
          <span className="muted">文档 /</span> {current?.title ?? '目录'}
        </summary>
        <nav aria-label="文档目录">{links}</nav>
      </details>
    </>
  );
}

export function Pager() {
  const cur = useCurrent();
  if (cur < 0) return null;
  const prev = DOC_PAGES[cur - 1];
  const next = DOC_PAGES[cur + 1];
  return (
    <nav className="pager" aria-label="上一页与下一页">
      {prev ? (
        <Link href={docHref(prev.slug)} className="pager-link">
          <span className="muted">← 上一页</span>
          <b>{prev.title}</b>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={docHref(next.slug)} className="pager-link next">
          <span className="muted">下一页 →</span>
          <b>{next.title}</b>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
