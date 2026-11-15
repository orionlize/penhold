import Link from 'next/link';
import { REPO } from '../site';
import { Pager, Sidebar } from './sidebar';
import './docs.css';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page docs-page">
      <a className="skip" href="#doc">
        跳到正文
      </a>
      <header className="nav">
        <div className="nav-inner">
          <Link className="brand" href="/" aria-label="Penhold 首页">
            <span className="brand-caret" aria-hidden="true" />
            <span className="brand-name">Penhold</span>
            <span className="tag">文档</span>
          </Link>
          <nav className="nav-links docs-top" aria-label="主导航">
            <Link href="/" className="only-desk">
              首页
            </Link>
            <a href={REPO}>GitHub</a>
            <Link className="nav-cta only-desk" href="/docs/install">
              安装 MCP
            </Link>
          </nav>
        </div>
      </header>

      <div className="docs-shell">
        <Sidebar />
        <main id="doc" className="doc">
          {children}
          <Pager />
        </main>
      </div>

      <footer className="footer">
        <div className="footer-brand">
          <span className="footer-caret" aria-hidden="true" />
          <span className="footer-name">Penhold</span>
          <span className="footer-license">MIT License</span>
        </div>
        <nav className="footer-links" aria-label="页脚">
          <a href={`${REPO}/issues`}>反馈问题</a>
          <a href={`${REPO}/blob/main/README.md`}>README</a>
        </nav>
      </footer>
    </div>
  );
}
