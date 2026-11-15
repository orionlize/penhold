// 首页的“设计系统”区：列出本机的设计系统，支持新建（空白 / 风格方向 / 粘贴 CSS 或 JSON）、复制、删除。
import { useEffect, useState } from 'react';
import { t } from './i18n';

interface Item {
  id: string;
  name: string;
  version: number;
  updatedAt: number;
  themes: string[];
  colors: number;
  components: number;
  swatch: string[];
  projects: string[];
  canvases: number;
}

interface Starter {
  id: string;
  name: string;
  mood: string;
  palette: { primary: string; accent: string; bg: string; fg: string };
  fonts: string;
}

type From = 'blank' | 'direction' | 'css' | 'json';

function NewSystem({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [from, setFrom] = useState<From>('blank');
  const [usePrimary, setUsePrimary] = useState(false);
  const [primary, setPrimary] = useState('#2563EB');
  const [starters, setStarters] = useState<Starter[]>([]);
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reroll = () =>
    fetch(`/api/systems/starters?seed=${Math.floor(Math.random() * 1e9) + 1}`)
      .then((r) => r.json())
      .then((list: Starter[]) => {
        setStarters(list);
        setPick(list[0]?.id ?? '');
      })
      .catch(() => {});
  useEffect(() => {
    if (from === 'direction' && !starters.length) void reroll();
  }, [from]);
  const create = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/systems', {
        method: 'POST',
        body: JSON.stringify({ name, device, from, ...(from === 'direction' ? { ref: pick } : {}), ...(usePrimary && (from === 'blank' || from === 'direction') ? { primary } : {}), ...(from === 'css' || from === 'json' ? { text } : {}) }),
      });
      const j = await r.json();
      if (!r.ok) return setErr(j.error ?? String(r.status));
      location.href = `/s/${j.id}`;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ready = from === 'direction' ? !!pick : from === 'css' || from === 'json' ? !!text.trim() : true;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal ds-new" role="dialog" aria-label={t('ds.new')} onClick={(e) => e.stopPropagation()}>
        <header>
          {t('ds.new')}
          <button className="icon-btn" aria-label={t('common.close')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <div className="row">
            <label className="field">
              <span className="field-label">{t('ds.systemName')}</span>
              <input autoFocus className="ds-bare" value={name} placeholder={t('ds.defaultName')} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field" style={{ flex: 'none' }}>
              <span className="field-label">{t('ds.device')}</span>
              <select className="ds-bare" value={device} onChange={(e) => setDevice(e.target.value as 'mobile' | 'desktop')}>
                <option value="mobile">{t('ds.mobile')}</option>
                <option value="desktop">{t('ds.desktop')}</option>
              </select>
            </label>
          </div>
          <div className="ds-tabs" role="group" aria-label={t('ds.startFrom')}>
            {(['blank', 'direction', 'css', 'json'] as const).map((f) => (
              <button key={f} aria-pressed={from === f} className={from === f ? 'on' : ''} onClick={() => setFrom(f)}>
                {t(`ds.from.${f}`)}
              </button>
            ))}
          </div>
          <div className="dim">{t(`ds.from.${from}.hint`)}</div>
          {from === 'direction' && (
            <>
              <div className="ds-starters">
                {starters.map((s) => (
                  <button key={s.id} className={pick === s.id ? 'ds-starter on' : 'ds-starter'} aria-pressed={pick === s.id} onClick={() => setPick(s.id)}>
                    <span className="ds-strip">
                      {[s.palette.bg, s.palette.fg, s.palette.primary, s.palette.accent].map((c, i) => (
                        <i key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <b>{s.name}</b>
                    <span className="dim">{s.mood}</span>
                  </button>
                ))}
              </div>
              <button className="secondary sm" style={{ alignSelf: 'flex-start' }} onClick={() => void reroll()}>
                {t('brief.reroll')}
              </button>
            </>
          )}
          {(from === 'blank' || from === 'direction') && (
            <label className="ds-row">
              <input type="checkbox" checked={usePrimary} onChange={(e) => setUsePrimary(e.target.checked)} />
              <span>{t('ds.setPrimary')}</span>
              {usePrimary && <input type="color" aria-label={t('ds.setPrimary')} value={primary} onChange={(e) => setPrimary(e.target.value.toUpperCase())} />}
              {usePrimary && <span className="mono">{primary}</span>}
            </label>
          )}
          {(from === 'css' || from === 'json') && <textarea className="ds-in mono" rows={9} spellCheck={false} aria-label={t(`ds.from.${from}`)} placeholder={from === 'css' ? ':root {\n  --background: #ffffff;\n  --primary: #2563eb;\n  --radius: 8px;\n}\n.dark { … }' : '{ "color": { "themes": […], "tokens": […] } }'} value={text} onChange={(e) => setText(e.target.value)} />}
          {err && <div className="warn">{err}</div>}
        </div>
        <footer>
          <span />
          <button className="primary" disabled={!ready || busy} onClick={() => void create()}>
            {t('ds.create')}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function SystemList() {
  const [list, setList] = useState<Item[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = () =>
    fetch('/api/systems')
      .then((r) => (r.ok ? r.json() : []))
      .then(setList)
      .catch(() => setList([]));
  useEffect(() => void load(), []);
  const post = async (id: string, action: string) => {
    const r = await fetch(`/api/systems/${id}/${action}`, { method: 'POST', body: '{}' });
    if (!r.ok) alert((await r.json()).error);
    load();
  };
  return (
    <section className="home-sec">
      <div className="home-sec-head">
        <h2>{t('ds.title')}</h2>
        <button className="primary" onClick={() => setCreating(true)}>
          + {t('ds.new')}
        </button>
      </div>
      <p className="dim">{t('ds.intro')}</p>
      <div className="cards">
        {list?.map((s) => (
          <div key={s.id} className="card">
            <a href={`/s/${s.id}`} className="ds-strip" aria-hidden tabIndex={-1}>
              {s.swatch.map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </a>
            <a href={`/s/${s.id}`} className="card-title">
              {s.name}
              <span className="dim">v{s.version}</span>
            </a>
            <div className="dim">{t('ds.cardMeta', { themes: s.themes.join(' / '), colors: s.colors, components: s.components })}</div>
            <div className="dim">{s.projects.length ? t('ds.cardProjects', { list: s.projects.join(', ') }) : t('ds.cardNoProject')}</div>
            <div className="dim">{t('ds.cardUsed', { n: s.canvases, time: new Date(s.updatedAt).toLocaleString() })}</div>
            <div className="card-acts">
              <button onClick={() => (location.href = `/s/${s.id}`)}>{t('ds.edit')}</button>
              <button onClick={() => void post(s.id, 'duplicate')}>{t('common.duplicate')}</button>
              <button className="danger" onClick={() => confirm(t('ds.confirmDelete', { name: s.name })) && void post(s.id, 'delete')}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}
        {list && !list.length && <div className="dim">{t('ds.empty')}</div>}
      </div>
      {creating && <NewSystem onClose={() => setCreating(false)} />}
    </section>
  );
}
