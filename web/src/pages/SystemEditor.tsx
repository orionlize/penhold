// 设计系统编辑页（/s/<id>）：用户自己改颜色、文字、间距、圆角、阴影与品牌说明，右侧实时预览。
// 保存后服务端重新生成 README / tokens.css，并把令牌同步到安装了这个系统的画布。
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';
import { auditContrast, deriveTheme, fixContrast, flattenSystem, lintSystem, normalizeColor, type DesignSystem, type DsLength, type DsTextStyle } from '../../../src/core/designSystem';
import { HEX6, luminance, parseColor } from '../../../src/core/color';
import { t } from '../i18n';

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;
const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const BRAND_FIELDS = ['concept', 'motif', 'signature', 'mood', 'typography', 'shape', 'layout'] as const;

interface Info {
  projects: Array<{ cwd: string; system: string | null }>;
  canvases: Array<{ id: string; title: string }>;
}

/** 失焦或回车时才提交的输入框；onCommit 返回 false 表示不接受，恢复原值。 */
function Draft({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => boolean | void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      {...rest}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value && onCommit(v.trim()) === false) setV(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setV(value);
      }}
    />
  );
}

function Num({ value, onCommit, min, max, step, ...rest }: { value: number; onCommit: (n: number) => void; min: number; max: number; step?: number } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'step'>) {
  return (
    <Draft
      {...rest}
      className="ds-in num"
      inputMode="decimal"
      value={String(value)}
      onCommit={(s) => {
        const n = Number(s);
        if (!Number.isFinite(n) || s === '') return false;
        onCommit(Math.min(max, Math.max(min, step && step >= 1 ? Math.round(n) : n)));
      }}
    />
  );
}

const cssVar = (k: string) => `--${k.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function SystemEditor({ id }: { id: string }) {
  const [ds, setDs] = useState<DesignSystem | null>(null);
  const [saved, setSaved] = useState<DesignSystem | null>(null);
  const [info, setInfo] = useState<Info>({ projects: [], canvases: [] });
  const [theme, setTheme] = useState('');
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [newProject, setNewProject] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/systems/${id}`);
    if (!r.ok) return setStatus({ text: t('ds.loadFailed', { status: r.status }), error: true });
    const j = (await r.json()) as Info & { system: DesignSystem };
    setInfo({ projects: j.projects, canvases: j.canvases });
    return j.system;
  }, [id]);

  useEffect(() => {
    void load().then((s) => {
      if (!s) return;
      setDs(s);
      setSaved(s);
      setTheme(s.color.themes[0].id);
      document.title = `${s.name} · ${t('ds.title')}`;
    });
    fetch('/api/fonts')
      .then((r) => (r.ok ? r.json() : []))
      .then(setFonts)
      .catch(() => {});
  }, [load]);

  const dirty = useMemo(() => !!ds && !!saved && JSON.stringify(ds) !== JSON.stringify(saved), [ds, saved]);
  const edit = (fn: (d: DesignSystem) => void) =>
    setDs((cur) => {
      if (!cur) return cur;
      const next = structuredClone(cur);
      fn(next);
      return next;
    });
  const fail = (text: string) => (setStatus({ text, error: true }), false as const);

  const save = useCallback(async () => {
    if (!ds || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/systems/${id}`, { method: 'PUT', body: JSON.stringify(ds) });
      const j = await r.json();
      if (!r.ok) return void setStatus({ text: t('ds.saveFailed', { msg: j.error ?? r.status }), error: true });
      setDs(j.system);
      setSaved(j.system);
      document.title = `${j.system.name} · ${t('ds.title')}`;
      setStatus({ text: [t('ds.saved', { v: j.system.version }), j.synced ? t('ds.synced', { n: j.synced }) : '', j.skipped ? t('ds.skipped', { n: j.skipped }) : ''].filter(Boolean).join(' · ') });
    } catch (e) {
      setStatus({ text: t('ds.saveFailed', { msg: (e as Error).message }), error: true });
    } finally {
      setBusy(false);
    }
  }, [ds, busy, id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        setTimeout(() => void save(), 0);
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [save, dirty]);

  if (!ds || !saved)
    return (
      <div className="ds-page">
        <div className="ds-main">{status ? <div className="warn">{status.text}</div> : <span className="dim">{t('ds.loading')}</span>}</div>
      </div>
    );

  const themes = ds.color.themes;
  const first = themes[0].id;
  const th = themes.some((x) => x.id === theme) ? theme : first;
  const flat = flattenSystem(ds, th);
  const pairs = auditContrast(ds, true);
  const failing = pairs.filter((p) => p.ratio < p.min);
  const lint = lintSystem(ds);
  const valueOf = (name: string) => flat[`color.${name}`] ?? '';
  const toneOf = (themeId: string) => {
    const bg = flattenSystem(ds, themeId)['color.bg'];
    return bg && parseColor(bg) && luminance(parseColor(bg)!.rgb) < 0.4 ? 'dark' : 'light';
  };

  // ---------- 颜色 ----------
  const setColor = (i: number, raw: string) => {
    const v = normalizeColor(raw);
    if (!parseColor(v)) return fail(t('ds.badColor', { v: raw }));
    edit((d) => (d.color.tokens[i].value[th] = HEX6.test(v) ? v.toUpperCase() : v));
  };
  const renameColor = (i: number, name: string) => {
    if (!NAME_RE.test(name)) return fail(t('ds.badName'));
    if (ds.color.tokens.some((x, j) => j !== i && x.name === name)) return fail(t('ds.dupName', { name }));
    edit((d) => {
      const old = d.color.tokens[i].name;
      d.color.tokens[i].name = name;
      for (const x of d.color.tokens) if (x.on) x.on = x.on.map((o) => (o === old ? name : o));
    });
  };
  const addTheme = () => {
    const tone = toneOf(first) === 'dark' ? 'light' : 'dark';
    const tid = uniqueName(tone, themes.map((x) => x.id));
    edit((d) => {
      deriveTheme(d, first, { id: tid, name: t(tone === 'dark' ? 'ds.themeDark' : 'ds.themeLight') }, tone);
      fixContrast(d);
    });
    setTheme(tid);
  };
  const removeTheme = () => {
    if (th === first || !confirm(t('ds.confirmRemoveTheme', { name: themes.find((x) => x.id === th)!.name }))) return;
    edit((d) => {
      d.color.themes = d.color.themes.filter((x) => x.id !== th);
      for (const c of d.color.tokens) delete c.value[th];
    });
    setTheme(first);
  };

  // ---------- 文字 ----------
  const scaleKeys = Object.keys(ds.type.scale);
  const familyKeys = Object.keys(ds.type.families);
  /** 改对象的键名但保持顺序。 */
  const renameKey = <T,>(obj: Record<string, T>, from: string, to: string) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v])) as Record<string, T>;
  const stylePx = (s: DsTextStyle) => (typeof s.size === 'number' ? s.size : (ds.type.scale[s.size] ?? 16));
  const styleCss = (s: DsTextStyle | undefined): CSSProperties =>
    s ? { fontFamily: ds.type.families[s.family] ?? ds.type.families.body, fontSize: stylePx(s), lineHeight: s.lineHeight, fontWeight: s.weight, letterSpacing: s.letterSpacing ?? 0 } : {};
  const ts = (name: string) => styleCss(ds.type.styles.find((s) => s.name === name) ?? ds.type.styles.find((s) => s.name === 'body'));

  // ---------- 间距 / 圆角 / 阴影 ----------
  const lengths = (kind: 'spacing' | 'radius' | 'shadow', title: string, fallback: string, visual: (v: string) => ReactNode) => (
    <section className="ds-sec">
      <h2>{title}</h2>
      <div className="ds-rows">
        {ds[kind].map((s: DsLength, i) => (
          <div key={i} className="ds-row ds-len">
            <div className="ds-vis">{visual(s.value)}</div>
            <Draft
              className="ds-in name"
              aria-label={t('ds.name')}
              value={s.name}
              onCommit={(v) => {
                if (!NAME_RE.test(v)) return fail(t('ds.badName'));
                if (ds[kind].some((x, j) => j !== i && x.name === v)) return fail(t('ds.dupName', { name: v }));
                edit((d) => (d[kind][i].name = v));
              }}
            />
            <Draft className="ds-in mono" aria-label={t('ds.value')} value={s.value} onCommit={(v) => (v ? edit((d) => (d[kind][i].value = v)) : false)} />
            <Draft className="ds-in grow" aria-label={t('ds.usage')} placeholder={t('ds.usage')} value={s.usage ?? ''} onCommit={(v) => edit((d) => (d[kind][i].usage = v || undefined))} />
            <button className="icon-btn xs" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => edit((d) => void d[kind].splice(i, 1))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="secondary sm" onClick={() => edit((d) => void d[kind].push({ name: uniqueName(String(d[kind].length + 1), d[kind].map((x) => x.name)), value: fallback }))}>
        + {t('ds.add')}
      </button>
    </section>
  );

  // ---------- 预览 ----------
  const vars = Object.fromEntries(Object.entries(flat).map(([k, v]) => [cssVar(k), v])) as CSSProperties;
  const sp = (i: number) => ds.spacing[Math.min(i, ds.spacing.length - 1)]?.value ?? '16px';
  const rad = (n: string) => `var(--radius-${n}, ${ds.radius[Math.min(1, ds.radius.length - 1)]?.value ?? '8px'})`;
  const preview = (
    <div className="ds-preview" style={{ ...vars, background: 'var(--color-bg)', color: 'var(--color-fg)', padding: sp(3), gap: sp(2) }}>
      <div>
        <div style={{ ...ts('caption'), color: 'var(--color-muted-fg)' }}>{t('ds.sample.caption')}</div>
        <div style={ts('display')}>1,280</div>
      </div>
      <div style={ts('heading')}>{t('ds.sample.heading')}</div>
      <div style={ts('body')}>{t('ds.sample.body')}</div>
      <div style={{ background: 'var(--color-card, var(--color-bg))', color: 'var(--color-card-fg, var(--color-fg))', border: '1px solid var(--color-border)', borderRadius: rad('lg'), boxShadow: 'var(--shadow-sm, none)', padding: sp(3), display: 'flex', flexDirection: 'column', gap: sp(1) }}>
        <div style={ts('subheading')}>{t('ds.sample.card')}</div>
        <div style={{ ...ts('body'), color: 'var(--color-muted-fg)' }}>{t('ds.sample.muted')}</div>
        <div style={{ ...ts('label'), marginTop: sp(0) }}>{t('ds.sample.label')}</div>
        <div style={{ ...ts('body'), border: '1px solid var(--color-input, var(--color-border))', borderRadius: rad('md'), padding: `${sp(1)} ${sp(2)}`, color: 'var(--color-muted-fg)' }}>{t('ds.sample.placeholder')}</div>
        <div style={{ display: 'flex', gap: sp(1), marginTop: sp(1) }}>
          <div style={{ ...ts('button'), background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderRadius: rad('md'), padding: `${sp(1)} ${sp(3)}`, boxShadow: 'var(--shadow-sm, none)' }}>{t('ds.sample.primary')}</div>
          <div style={{ ...ts('button'), background: 'var(--color-muted, transparent)', color: 'var(--color-fg)', borderRadius: rad('md'), padding: `${sp(1)} ${sp(3)}` }}>{t('ds.sample.secondary')}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1) }}>
        {['accent', 'success', 'warning', 'danger'].filter(valueOf).map((n) => (
          <span key={n} style={{ ...ts('caption'), color: `var(--color-${n})`, border: `1px solid var(--color-${n})`, borderRadius: rad('full'), padding: '2px 10px' }}>
            {n}
          </span>
        ))}
      </div>
    </div>
  );

  const themeTabs = (
    <div className="ds-tabs" role="group" aria-label={t('ds.theme')}>
      {themes.map((x) => (
        <button key={x.id} aria-pressed={x.id === th} className={x.id === th ? 'on' : ''} onClick={() => setTheme(x.id)}>
          {x.name}
        </button>
      ))}
    </div>
  );

  const toggleProject = async (cwd: string, on: boolean) => {
    const r = await fetch(`/api/systems/${id}/default`, { method: 'POST', body: JSON.stringify({ cwd, on }) });
    if (!r.ok) return void fail((await r.json()).error);
    await load();
  };

  return (
    <div className="ds-page">
      <header className="ds-bar">
        <a href="/" className="ds-back" title={t('ds.back')}>
          ←
        </a>
        <Draft className="ds-in ds-title" aria-label={t('ds.systemName')} value={ds.name} onCommit={(v) => (v ? edit((d) => (d.name = v.slice(0, 80))) : false)} />
        <select className="ds-in" aria-label={t('ds.device')} value={ds.device} onChange={(e) => edit((d) => (d.device = e.target.value as DesignSystem['device']))}>
          <option value="mobile">{t('ds.mobile')}</option>
          <option value="desktop">{t('ds.desktop')}</option>
        </select>
        <span className="dim">v{saved.version}</span>
        <span className="spacer" />
        {status && (
          <span className={status.error ? 'ds-status error' : 'ds-status'} role="status">
            {status.text}
          </span>
        )}
        <a className="ds-link" href={`/s/${id}/view`} target="_blank" rel="noreferrer">
          {t('ds.viewPage')}
        </a>
        <button
          className="secondary"
          disabled={!dirty}
          onClick={() => {
            setDs(saved);
            setStatus(null);
          }}
        >
          {t('ds.revert')}
        </button>
        <button className="primary" disabled={!dirty || busy} onClick={() => void save()}>
          {dirty ? t('ds.save') : t('ds.savedBtn')}
        </button>
      </header>

      <div className="ds-body">
        <main className="ds-main">
          <section className="ds-sec">
            <div className="ds-sec-head">
              <h2>{t('ds.colors')}</h2>
              {themeTabs}
              <span className="spacer" />
              {themes.length === 1 && (
                <button className="secondary sm" onClick={addTheme}>
                  + {t(toneOf(first) === 'dark' ? 'ds.addLight' : 'ds.addDark')}
                </button>
              )}
              {th !== first && (
                <button className="secondary sm danger" onClick={removeTheme}>
                  {t('ds.removeTheme')}
                </button>
              )}
              {failing.length > 0 && (
                <button
                  className="secondary sm"
                  onClick={() =>
                    edit((d) => {
                      const changes = fixContrast(d);
                      setStatus({ text: t('ds.fixed', { n: changes.length }) });
                    })
                  }
                >
                  {t('ds.fixContrast', { n: failing.length })}
                </button>
              )}
            </div>
            <p className="dim">{t('ds.colorsHint')}</p>
            <div className="ds-rows">
              {ds.color.tokens.map((c, i) => {
                const v = c.value[th] ?? c.value[first] ?? '';
                const inherited = th !== first && c.value[th] === undefined;
                return (
                  <div key={i} className="ds-row ds-color">
                    <label className="ds-chip" style={{ background: v }} title={t('ds.pickColor')}>
                      <input type="color" aria-label={t('ds.pickColor')} value={HEX6.test(v) ? v : '#888888'} onChange={(e) => edit((d) => (d.color.tokens[i].value[th] = e.target.value.toUpperCase()))} />
                    </label>
                    <Draft className={`ds-in mono${inherited ? ' inherited' : ''}`} aria-label={t('ds.value')} value={v} onCommit={(x) => setColor(i, x)} />
                    <Draft className="ds-in name" aria-label={t('ds.name')} value={c.name} onCommit={(x) => renameColor(i, x)} />
                    <Draft className="ds-in grow" aria-label={t('ds.usage')} placeholder={t('ds.usage')} value={c.usage ?? ''} onCommit={(x) => edit((d) => (d.color.tokens[i].usage = x || undefined))} />
                    <span className="ds-cr">
                      {pairs
                        .filter((p) => p.fg === c.name && p.theme === th)
                        .map((p) => (
                          <span key={p.bg} className={p.ratio < p.min ? 'bad' : ''} title={t('ds.contrastTip', { bg: p.bg, min: p.min })}>
                            {p.bg} {p.ratio}
                          </span>
                        ))}
                    </span>
                    <button className="icon-btn xs" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => edit((d) => void d.color.tokens.splice(i, 1))}>
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              className="secondary sm"
              onClick={() => edit((d) => void d.color.tokens.push({ name: uniqueName('color', d.color.tokens.map((x) => x.name)), value: { [first]: '#888888' } }))}
            >
              + {t('ds.add')}
            </button>
          </section>

          <section className="ds-sec">
            <h2>{t('ds.type')}</h2>
            <h3>{t('ds.families')}</h3>
            <div className="ds-rows">
              {familyKeys.map((k) => (
                <div key={k} className="ds-row">
                  <Draft
                    className="ds-in name"
                    aria-label={t('ds.name')}
                    value={k}
                    readOnly={k === 'body' || k === 'heading'}
                    onCommit={(v) => {
                      if (!NAME_RE.test(v)) return fail(t('ds.badName'));
                      if (familyKeys.includes(v)) return fail(t('ds.dupName', { name: v }));
                      edit((d) => {
                        d.type.families = renameKey(d.type.families, k, v);
                        for (const s of d.type.styles) if (s.family === k) s.family = v;
                      });
                    }}
                  />
                  <Draft className="ds-in grow" aria-label={t('ds.fontStack')} list="ds-fonts" style={{ fontFamily: ds.type.families[k] }} value={ds.type.families[k]} onCommit={(v) => (v ? edit((d) => (d.type.families[k] = v.replace(/["';]/g, ''))) : false)} />
                  {k !== 'body' && k !== 'heading' && (
                    <button className="icon-btn xs" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => edit((d) => void delete d.type.families[k])}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <datalist id="ds-fonts">
              {fonts.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <button className="secondary sm" onClick={() => edit((d) => (d.type.families[uniqueName('mono', Object.keys(d.type.families))] = 'ui-monospace, SFMono-Regular, Menlo, monospace'))}>
              + {t('ds.add')}
            </button>

            <h3>{t('ds.scale')}</h3>
            <div className="ds-scale">
              {scaleKeys.map((k) => (
                <div key={k} className="ds-row">
                  <Draft
                    className="ds-in name short"
                    aria-label={t('ds.name')}
                    value={k}
                    onCommit={(v) => {
                      if (!NAME_RE.test(v)) return fail(t('ds.badName'));
                      if (scaleKeys.includes(v)) return fail(t('ds.dupName', { name: v }));
                      edit((d) => {
                        d.type.scale = renameKey(d.type.scale, k, v);
                        for (const s of d.type.styles) if (s.size === k) s.size = v;
                      });
                    }}
                  />
                  <Num aria-label={t('ds.px')} value={ds.type.scale[k]} min={6} max={400} step={1} onCommit={(n) => edit((d) => (d.type.scale[k] = n))} />
                  <button className="icon-btn xs" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => edit((d) => void delete d.type.scale[k])}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button className="secondary sm" onClick={() => edit((d) => (d.type.scale[uniqueName('size', Object.keys(d.type.scale))] = 16))}>
              + {t('ds.add')}
            </button>

            <h3>{t('ds.styles')}</h3>
            <p className="dim">{t('ds.stylesHint')}</p>
            <div className="ds-styles">
              {ds.type.styles.map((s, i) => {
                const set = (fn: (x: DsTextStyle) => void) => edit((d) => fn(d.type.styles[i]));
                return (
                  <div key={i} className="ds-style">
                    <div className="ds-row">
                      <Draft
                        className="ds-in name"
                        aria-label={t('ds.name')}
                        value={s.name}
                        onCommit={(v) => {
                          if (!NAME_RE.test(v)) return fail(t('ds.badName'));
                          if (ds.type.styles.some((x, j) => j !== i && x.name === v)) return fail(t('ds.dupName', { name: v }));
                          set((x) => (x.name = v));
                        }}
                      />
                      <label>
                        <span className="dim">{t('ds.size')}</span>
                        <select className="ds-in" value={typeof s.size === 'number' ? '' : s.size} onChange={(e) => set((x) => (x.size = e.target.value || stylePx(s)))}>
                          {scaleKeys.map((k) => (
                            <option key={k} value={k}>
                              {k} · {ds.type.scale[k]}
                            </option>
                          ))}
                          {typeof s.size === 'string' && !scaleKeys.includes(s.size) && <option value={s.size}>{s.size} · ?</option>}
                          <option value="">{t('ds.customPx')}</option>
                        </select>
                        {typeof s.size === 'number' && <Num aria-label={t('ds.px')} value={s.size} min={6} max={400} step={1} onCommit={(n) => set((x) => (x.size = n))} />}
                      </label>
                      <label>
                        <span className="dim">{t('ds.lineHeight')}</span>
                        <Num value={s.lineHeight} min={0.8} max={3} onCommit={(n) => set((x) => (x.lineHeight = n))} />
                      </label>
                      <label>
                        <span className="dim">{t('ds.weight')}</span>
                        <select className="ds-in" value={s.weight} onChange={(e) => set((x) => (x.weight = Number(e.target.value)))}>
                          {WEIGHTS.map((w) => (
                            <option key={w}>{w}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span className="dim">{t('ds.family')}</span>
                        <select className="ds-in" value={s.family} onChange={(e) => set((x) => (x.family = e.target.value))}>
                          {familyKeys.map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                          {!familyKeys.includes(s.family) && <option>{s.family}</option>}
                        </select>
                      </label>
                      <label>
                        <span className="dim">{t('ds.letterSpacing')}</span>
                        <Num value={s.letterSpacing ?? 0} min={-10} max={20} onCommit={(n) => set((x) => (x.letterSpacing = n || undefined))} />
                      </label>
                      <span className="spacer" />
                      <button className="icon-btn xs" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => edit((d) => void d.type.styles.splice(i, 1))}>
                        ×
                      </button>
                    </div>
                    <div className="ds-sample" style={styleCss(s)}>
                      {s.name === 'display' ? '1,280' : t('ds.sample.line')}
                    </div>
                    <Draft className="ds-in wide" aria-label={t('ds.usage')} placeholder={t('ds.usage')} value={s.usage ?? ''} onCommit={(v) => set((x) => (x.usage = v || undefined))} />
                  </div>
                );
              })}
            </div>
            <button
              className="secondary sm"
              onClick={() => edit((d) => void d.type.styles.push({ name: uniqueName('style', d.type.styles.map((x) => x.name)), size: scaleKeys.includes('md') ? 'md' : (scaleKeys[0] ?? 16), lineHeight: 1.5, weight: 400, family: 'body' }))}
            >
              + {t('ds.add')}
            </button>
          </section>

          {lengths('spacing', t('ds.spacing'), '16px', (v) => (
            <div className="ds-bar-vis" style={{ width: v }} />
          ))}
          {lengths('radius', t('ds.radius'), '8px', (v) => (
            <div className="ds-box-vis" style={{ borderRadius: v }} />
          ))}
          {lengths('shadow', t('ds.shadow'), '0 2px 8px rgba(0,0,0,0.12)', (v) => (
            <div className="ds-box-vis" style={{ boxShadow: v, border: 0 }} />
          ))}

          <section className="ds-sec">
            <h2>{t('ds.brand')}</h2>
            <p className="dim">{t('ds.brandHint')}</p>
            <div className="ds-brand">
              {BRAND_FIELDS.map((k) => (
                <label key={k}>
                  <span>{t(`ds.brand.${k}`)}</span>
                  <textarea className="ds-in" rows={5} value={ds.brand[k] ?? ''} onChange={(e) => edit((d) => (d.brand[k] = e.target.value || undefined))} />
                </label>
              ))}
              <label>
                <span>{t('ds.brand.avoid')}</span>
                <textarea className="ds-in" rows={6} value={(ds.brand.avoid ?? []).join('\n')} onChange={(e) => edit((d) => (d.brand.avoid = e.target.value ? e.target.value.split('\n') : undefined))} />
              </label>
              <label className="full">
                <span>{t('ds.brand.notes')}</span>
                <textarea className="ds-in" rows={8} value={ds.brand.notes ?? ''} onChange={(e) => edit((d) => (d.brand.notes = e.target.value || undefined))} />
              </label>
            </div>
          </section>

          <section className="ds-sec">
            <h2>{t('ds.components')}</h2>
            {Object.keys(ds.components).length ? (
              <div className="ds-comps">
                {Object.entries(ds.components).map(([name, c]) => (
                  <div key={name} className="ds-comp">
                    <div className="ds-row">
                      <code>{name}</code>
                      <Draft className="ds-in grow" aria-label={t('ds.usage')} placeholder={t('ds.usage')} value={c.usage ?? ''} onCommit={(v) => edit((d) => (d.components[name].usage = v || undefined))} />
                      <button className="icon-btn xs" title={t('common.delete')} aria-label={t('common.delete')} onClick={() => confirm(t('ds.confirmRemoveComp', { name })) && edit((d) => void delete d.components[name])}>
                        ×
                      </button>
                    </div>
                    {saved.components[name] && <iframe title={name} sandbox="" src={`/api/systems/${id}/component?name=${encodeURIComponent(name)}&theme=${encodeURIComponent(th)}&v=${saved.version}`} />}
                  </div>
                ))}
              </div>
            ) : (
              <p className="dim">{t('ds.noComponents')}</p>
            )}
          </section>

          <section className="ds-sec">
            <h2>{t('ds.projects')}</h2>
            <p className="dim">{t('ds.projectsHint')}</p>
            <div className="ds-rows">
              {info.projects.map((p) => (
                <label key={p.cwd} className="ds-row ds-proj">
                  <input type="checkbox" checked={p.system === id} onChange={(e) => void toggleProject(p.cwd, e.target.checked)} />
                  <span className="mono">{p.cwd}</span>
                  {p.system && p.system !== id && <span className="dim">{t('ds.usesOther', { id: p.system })}</span>}
                </label>
              ))}
            </div>
            <form
              className="ds-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (newProject.trim()) void toggleProject(newProject.trim(), true).then(() => setNewProject(''));
              }}
            >
              <input className="ds-in grow mono" aria-label={t('ds.projectPath')} placeholder={t('ds.projectPath')} value={newProject} onChange={(e) => setNewProject(e.target.value)} />
              <button className="secondary sm" disabled={!newProject.trim()}>
                + {t('ds.add')}
              </button>
            </form>
            {info.canvases.length > 0 && (
              <>
                <h3>{t('ds.canvases', { n: info.canvases.length })}</h3>
                <div className="ds-links">
                  {info.canvases.map((c) => (
                    <a key={c.id} href={`/c/${c.id}`}>
                      {c.title}
                    </a>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="ds-sec">
            <h2>{t('ds.export')}</h2>
            <p className="dim">{t('ds.exportHint')}</p>
            <div className="ds-links">
              {['tokens.css', 'tokens.json', 'system.json', 'README.md'].map((f) => (
                <a key={f} href={`/api/systems/${id}/file?name=${f}`} download={f}>
                  {f}
                </a>
              ))}
            </div>
          </section>
        </main>

        <aside className="ds-side">
          <div className="ds-sec-head">
            <h2>{t('ds.preview')}</h2>
            <span className="spacer" />
            {themeTabs}
          </div>
          {preview}
          {(failing.length > 0 || lint.length > 0) && (
            <div className="ds-issues">
              <h3>{t('ds.issues', { n: failing.length + lint.length })}</h3>
              <ul>
                {failing.map((p) => (
                  <li key={`${p.theme}|${p.fg}|${p.bg}`}>{t('ds.contrastIssue', { theme: themes.find((x) => x.id === p.theme)?.name ?? p.theme, fg: p.fg, bg: p.bg, ratio: p.ratio, min: p.min })}</li>
                ))}
                {lint.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
