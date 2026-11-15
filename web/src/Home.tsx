// 画布首页：列出所有画布，支持重命名、复制、删除（移入回收站）。
import { useEffect, useState } from 'react';
import { t } from './i18n';
import { SystemList } from './SystemList';

interface Item {
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
  online: boolean;
  aliases: string[];
}

export function Home() {
  const [list, setList] = useState<Item[] | null>(null);
  const [err, setErr] = useState('');
  const load = () =>
    fetch('/api/canvases')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(t('home.loadFailed', { status: r.status })))))
      .then(setList)
      .catch((e) => setErr(e.message));
  useEffect(() => void load(), []);
  const post = async (id: string, action: string, body?: unknown) => {
    const r = await fetch(`/api/canvases/${id}/${action}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
    if (!r.ok) alert((await r.json()).error);
    load();
  };
  return (
    <div className="home">
      <header>
        <h1>◧ penhold-mcp</h1>
        <p>{t('home.intro')}</p>
      </header>
      {err && <div className="warn">{err}</div>}
      <h2 className="home-h2">{t('home.canvases')}</h2>
      <div className="cards">
        {list?.map((c) => (
          <div key={c.id} className="card">
            <a href={`/c/${c.id}`} className="card-title">
              {c.title}
              {c.online && <span className="online">{t('home.online')}</span>}
            </a>
            <div className="dim mono" title={c.id}>
              {c.id}
            </div>
            <div className="dim">{c.cwd}</div>
            <div className="dim">{t('home.updated', { time: new Date(c.updatedAt).toLocaleString() })}</div>
            <div className="card-acts">
              <button
                onClick={() => {
                  const name = prompt(t('home.newName'), c.title);
                  if (name) post(c.id, 'rename', { title: name });
                }}
              >
                {t('common.rename')}
              </button>
              <button onClick={() => post(c.id, 'duplicate')}>{t('common.duplicate')}</button>
              <button className="danger" onClick={() => confirm(t('home.confirmDelete', { title: c.title })) && post(c.id, 'delete')}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}
        {list && !list.length && <div className="dim">{t('home.empty')}</div>}
      </div>
      <SystemList />
    </div>
  );
}
