// 画布首页：按项目（工作目录）分组列出画布，组内按创建时间排成各轮迭代；支持重命名、复制、删除（移入回收站）。
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { SystemList } from './SystemList';

interface Item {
  id: string;
  title: string;
  cwd: string;
  updatedAt: number;
  createdAt: number;
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
      {list && !list.length && <div className="dim">{t('home.empty')}</div>}
      {groups(list ?? []).map(({ cwd, items }) => (
      <section key={cwd} className="home-project">
        <h3 className="home-h3" title={cwd}>
          {cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() : t('home.noProject')}
          <span className="dim">{cwd}</span>
          {items.length > 1 ? <span className="dim">{t('home.iterations', { n: items.length })}</span> : null}
        </h3>
      <div className="cards">
        {items.map((c, i) => (
          <div key={c.id} className="card">
            <a href={`/c/${c.id}`} className="card-title">
              {items.length > 1 ? <span className="iter">{t('home.round', { n: i + 1 })}</span> : null}
              {c.title}
              {c.online && <span className="online">{t('home.online')}</span>}
            </a>
            <div className="dim mono" title={c.id}>
              {c.id}
            </div>
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
      </div>
      </section>
      ))}
      <SystemList />
    </div>
  );
}

/** 按工作目录分组：最近更新的项目在前，组内按创建时间先后（第 1 轮、第 2 轮……）。 */
function groups(list: Item[]): Array<{ cwd: string; items: Item[] }> {
  const map = new Map<string, Item[]>();
  for (const c of list) map.set(c.cwd, [...(map.get(c.cwd) ?? []), c]);
  return [...map]
    .map(([cwd, items]) => ({ cwd, items: items.sort((a, b) => a.createdAt - b.createdAt), last: Math.max(...items.map((x) => x.updatedAt)) }))
    .sort((a, b) => b.last - a.last)
    .map(({ cwd, items }) => ({ cwd, items }));
}
