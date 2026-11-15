// 需求问卷：AI 在信息不足时（design_ask）发到画布上，用户选择视觉方向、主色、页面内容等后提交。
// 可收起为顶部提示条，稍后再填；提交或跳过后由服务端撤下。
import { useEffect, useState } from 'react';
import type { BriefAnswers, BriefForm, BriefOption, BriefQuestion } from '../../src/core/types';
import { Icon } from './icons';
import { t } from './i18n';
import { send, useStore } from './store';

interface Draft {
  /** 题目 id → 选中的选项值。 */
  picked: Record<string, string[]>;
  /** 题目 id → 填写的文字（填空题的内容，或选择题的“其他”）。 */
  text: Record<string, string>;
}
const EMPTY: Draft = { picked: {}, text: {} };
/** 与服务端 brief.ts 的 AUTO 一致。 */
const AUTO = 'auto';

function collect(form: BriefForm, d: Draft): BriefAnswers {
  const out: BriefAnswers = {};
  for (const q of form.questions) {
    const text = (d.text[q.id] ?? '').trim();
    if (q.kind === 'text') {
      if (text) out[q.id] = text;
      continue;
    }
    const valid = (d.picked[q.id] ?? []).filter((v) => q.options?.some((o) => o.value === v));
    if (q.kind === 'multi') {
      const list = [...valid, ...(text ? [text] : [])];
      if (list.length) out[q.id] = list;
    } else if (text) out[q.id] = text;
    else if (valid[0]) out[q.id] = valid[0];
  }
  return out;
}

export function BriefPanel() {
  const form = useStore((s) => s.brief);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [min, setMin] = useState(false);
  const formId = form?.id;
  useEffect(() => {
    setDraft(EMPTY);
    setMin(false);
  }, [formId]);
  if (!form) return null;

  if (min)
    return (
      <button className="brief-pill" onClick={() => setMin(false)}>
        <span className="dot ai" />
        {t('brief.pill')}
      </button>
    );

  const answered = Object.keys(collect(form, draft)).length;
  const pick = (q: BriefQuestion, value: string) =>
    setDraft((d) => {
      const cur = d.picked[q.id] ?? [];
      // 多选题里“不限 / 让 AI 决定”与具体选项互斥
      const next =
        q.kind === 'multi'
          ? cur.includes(value)
            ? cur.filter((v) => v !== value)
            : value === AUTO
              ? [AUTO]
              : [...cur.filter((v) => v !== AUTO), value]
          : cur[0] === value
            ? []
            : [value];
      // 单选题选了选项就清掉“其他”里的文字，二者只取其一
      return { picked: { ...d.picked, [q.id]: next }, text: q.kind === 'single' && next.length ? { ...d.text, [q.id]: '' } : d.text };
    });
  const type = (q: BriefQuestion, value: string) =>
    setDraft((d) => ({ picked: q.kind === 'single' && value.trim() ? { ...d.picked, [q.id]: [] } : d.picked, text: { ...d.text, [q.id]: value } }));

  return (
    <div className="brief-bg">
      <section className="brief" role="dialog" aria-label={form.title}>
        <header>
          <div>
            <h2>{form.title}</h2>
            {form.intro && <p className="dim">{form.intro}</p>}
          </div>
          <button className="icon-btn" aria-label={t('brief.later')} title={t('brief.later')} onClick={() => setMin(true)}>
            <Icon name="x" />
          </button>
        </header>
        <div className="brief-body">
          {form.questions.map((q, i) => (
            <div key={q.id} className="brief-q" role="group" aria-label={q.label}>
              <div className="brief-label">
                <span className="brief-no">{i + 1}</span>
                {q.label}
                {q.kind === 'multi' && <span className="dim"> · {t('brief.multi')}</span>}
                {q.reroll && (
                  <button className="sm secondary brief-reroll" onClick={() => send({ t: 'brief_reroll', id: form.id })}>
                    {t('brief.reroll')}
                  </button>
                )}
              </div>
              {q.help && <p className="dim brief-help">{q.help}</p>}
              {q.options && (
                <div className={`brief-opts ${q.options.some((o) => o.hint) ? 'cards' : ''}`}>
                  {q.options.map((o) => (
                    <Option key={o.value} o={o} on={(draft.picked[q.id] ?? []).includes(o.value)} multi={q.kind === 'multi'} onPick={() => pick(q, o.value)} />
                  ))}
                </div>
              )}
              {(q.kind === 'text' || q.other) &&
                (q.multiline ? (
                  <textarea rows={2} value={draft.text[q.id] ?? ''} placeholder={q.placeholder} maxLength={500} onChange={(e) => type(q, e.target.value)} />
                ) : (
                  <input type="text" value={draft.text[q.id] ?? ''} placeholder={q.placeholder ?? (q.other ? t('brief.other') : undefined)} maxLength={500} onChange={(e) => type(q, e.target.value)} />
                ))}
            </div>
          ))}
        </div>
        <footer>
          <span className="dim">{t('brief.count', { n: answered, total: form.questions.length })}</span>
          <div className="spacer" />
          <button className="secondary" onClick={() => send({ t: 'brief_answer', id: form.id, answers: {}, skipped: true })}>
            {t('brief.skip')}
          </button>
          <button className="primary" disabled={!answered} onClick={() => send({ t: 'brief_answer', id: form.id, answers: collect(form, draft) })}>
            {t('brief.submit')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function Option({ o, on, multi, onPick }: { o: BriefOption; on: boolean; multi: boolean; onPick: () => void }) {
  return (
    <button type="button" role={multi ? 'checkbox' : 'radio'} aria-checked={on} className={`brief-opt ${on ? 'on' : ''}`} onClick={onPick}>
      {o.swatch && (
        <span className="brief-swatch" aria-hidden="true">
          {o.swatch.map((c, i) => (
            <i key={i} style={{ background: c }} />
          ))}
        </span>
      )}
      <span className="brief-opt-text">
        <b>{o.label}</b>
        {o.hint && <small>{o.hint}</small>}
      </span>
    </button>
  );
}
