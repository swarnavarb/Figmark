import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { LEARN_LIMITS, learnImageOk, type LearnSection, type LearnStep, type LearnTab } from '@shared/learn';
import { LearnText } from '../components/LearnText';
import { shrink } from '../components/PhotoManager';
import { ApiRequestError, admin } from './api';
import { Confirm } from './Confirm';

/**
 * Writing the Learn guide.
 *
 * The whole guide is edited as a draft and saved in one go, so a half-made
 * change is never live: add or reorder side tabs on the left, then edit the
 * chosen tab's introduction, sections and numbered steps on the right, with a
 * preview that draws exactly what readers will see. Pictures are uploaded to
 * the same store listing photos use, or linked by https. "Reset" throws the
 * saved guide away and goes back to the one that ships with the app.
 */

const blankStep = (): LearnStep => ({ title: 'New step', body: '', image: null, caption: '' });
const blankSection = (): LearnSection => ({ id: '', title: 'New section', body: '', steps: [] });
const blankTab = (): LearnTab => ({ id: '', title: 'New tab', icon: '📘', intro: '', sections: [], hidden: true });

function move<T>(list: T[], index: number, by: number): T[] {
  const next = [...list];
  const target = index + by;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function LearnView() {
  const [tabs, setTabs] = useState<LearnTab[] | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [meta, setMeta] = useState<{ customised: boolean; updatedAt: string | null; updatedBy: string | null }>({ customised: false, updatedAt: null, updatedBy: null });
  const [selected, setSelected] = useState(0);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const take = useCallback((doc: { tabs: LearnTab[]; customised: boolean; updatedAt: string | null; updatedBy: string | null }) => {
    setTabs(doc.tabs);
    setSaved(JSON.stringify(doc.tabs));
    setMeta({ customised: doc.customised, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
  }, []);

  useEffect(() => {
    void admin.learn().then(take).catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the guide.'));
  }, [take]);

  if (!tabs) return error ? <p className="notice notice--error">{error}</p> : <p className="muted">Loading…</p>;

  const dirty = JSON.stringify(tabs) !== saved;
  const index = Math.min(selected, tabs.length - 1);
  const tab = tabs[index]!;

  const setTab = (patch: Partial<LearnTab>) => setTabs(tabs.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  const setSections = (sections: LearnSection[]) => setTab({ sections });
  const setSection = (at: number, patch: Partial<LearnSection>) =>
    setSections(tab.sections.map((entry, position) => (position === at ? { ...entry, ...patch } : entry)));

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      take(await admin.saveLearn(tabs!));
      setNotice('Saved. The Learn page shows this now.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the guide.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      take(await admin.resetLearn());
      setSelected(0);
      setNotice('Back to the guide that ships with the app.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reset the guide.');
    } finally {
      setBusy(false);
      setResetting(false);
    }
  }

  return (
    <div className="stack learned">
      <div className="learned__bar">
        <div>
          <h2 style={{ margin: 0 }}>Learn page</h2>
          <p className="faint" style={{ margin: 0 }}>
            {meta.customised
              ? `Edited${meta.updatedBy ? ` by ${meta.updatedBy}` : ''}${meta.updatedAt ? ` · ${new Date(meta.updatedAt).toLocaleString('en-IN')}` : ''}`
              : 'Showing the guide that ships with the app.'}
            {dirty && ' · unsaved changes'}
          </p>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <a className="btn btn--quiet btn--sm" href="/learn" target="_blank" rel="noreferrer">Open Learn page</a>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setPreview(!preview)}>{preview ? 'Edit' : 'Preview'}</button>
          <button type="button" className="btn btn--quiet btn--sm" disabled={!dirty || busy} onClick={() => setTabs(JSON.parse(saved) as LearnTab[])}>Discard</button>
          <button type="button" className="btn btn--quiet btn--sm" disabled={busy || !meta.customised} onClick={() => setResetting(true)}>Reset to default</button>
          <button type="button" className="btn btn--sm" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {error && <p className="notice notice--error">{error}</p>}
      {notice && <p className="notice notice--ok">{notice}</p>}

      <div className="learned__grid">
        {/* The side tabs. */}
        <aside className="learned__tabs">
          <p className="faint learned__label">Side tabs</p>
          {tabs.map((entry, at) => (
            <div key={at} className={`learned__tab${at === index ? ' is-on' : ''}`}>
              <button type="button" className="learned__pick" onClick={() => setSelected(at)}>
                <span>{entry.icon}</span> {entry.title}{entry.hidden && <em className="faint"> · hidden</em>}
              </button>
              <span className="learned__tools">
                <button type="button" aria-label="Move up" disabled={at === 0} onClick={() => { setTabs(move(tabs, at, -1)); setSelected(at - 1); }}>↑</button>
                <button type="button" aria-label="Move down" disabled={at === tabs.length - 1} onClick={() => { setTabs(move(tabs, at, 1)); setSelected(at + 1); }}>↓</button>
              </span>
            </div>
          ))}
          <button type="button" className="btn btn--quiet btn--sm" disabled={tabs.length >= LEARN_LIMITS.tabs}
            onClick={() => { setTabs([...tabs, blankTab()]); setSelected(tabs.length); }}>
            + New tab
          </button>
          <p className="faint learned__hint">A new tab starts hidden, so readers do not see it until it is ready.</p>
        </aside>

        {/* The chosen tab. */}
        <section className="learned__edit">
          {preview ? (
            <div className="learned__preview">
              <h1>{tab.icon} {tab.title}</h1>
              <LearnText text={tab.intro} inRouter={false} />
              {tab.sections.map((section, at) => (
                <div key={at} className="learn__section">
                  <h2>{section.title}</h2>
                  <LearnText text={section.body} inRouter={false} />
                  <ol className="learn__steps">
                    {section.steps.map((entry, position) => (
                      <li key={position} className="learn__step">
                        <span className="learn__num">{position + 1}</span>
                        <div className="learn__stepbody">
                          <h3>{entry.title}</h3>
                          <LearnText text={entry.body} inRouter={false} />
                          {entry.image && <img className="learned__thumb" src={entry.image} alt="" />}
                          {entry.caption && <small className="faint">{entry.caption}</small>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="card card--pad stack">
                <div className="learned__row">
                  <label className="field learned__icon">
                    <span>Icon</span>
                    <input value={tab.icon} maxLength={LEARN_LIMITS.icon} onChange={(event) => setTab({ icon: event.target.value })} />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    <span>Tab title</span>
                    <input value={tab.title} maxLength={LEARN_LIMITS.title} onChange={(event) => setTab({ title: event.target.value })} />
                  </label>
                </div>
                <label className="field">
                  <span>Introduction</span>
                  <textarea rows={3} value={tab.intro} maxLength={LEARN_LIMITS.intro} onChange={(event) => setTab({ intro: event.target.value })} />
                </label>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <label className="row learned__check">
                    <input type="checkbox" checked={tab.hidden} onChange={(event) => setTab({ hidden: event.target.checked })} />
                    Hidden from readers
                  </label>
                  <span style={{ flex: 1 }} />
                  <button type="button" className="btn btn--quiet btn--sm learned__danger" disabled={tabs.length === 1}
                    onClick={() => { setTabs(tabs.filter((_, at) => at !== index)); setSelected(Math.max(0, index - 1)); }}>
                    Delete tab
                  </button>
                </div>
                <p className="faint learned__hint">
                  Formatting: a blank line starts a paragraph, a line starting with &ldquo;- &rdquo; is a bullet, **stars** make bold,
                  and [text](/quests) links to a page in the app.
                </p>
              </div>

              {tab.sections.map((section, at) => (
                <SectionEditor key={at} section={section} position={at} count={tab.sections.length}
                  onChange={(patch) => setSection(at, patch)}
                  onMove={(by) => setSections(move(tab.sections, at, by))}
                  onDelete={() => setSections(tab.sections.filter((_, position) => position !== at))} />
              ))}
              <button type="button" className="btn btn--quiet" disabled={tab.sections.length >= LEARN_LIMITS.sections}
                onClick={() => setSections([...tab.sections, blankSection()])}>
                + Add a section
              </button>
            </>
          )}
        </section>
      </div>

      {resetting && (
        <Confirm title="Reset the Learn page?" confirmLabel="Reset" busy={busy}
          onConfirm={() => reset()} onCancel={() => setResetting(false)}>
          <p>Every change saved here - new tabs, edited text, uploaded pictures - is thrown away, and the guide that ships with the app comes back.</p>
        </Confirm>
      )}
    </div>
  );
}

function SectionEditor({ section, position, count, onChange, onMove, onDelete }: {
  section: LearnSection;
  position: number;
  count: number;
  onChange: (patch: Partial<LearnSection>) => void;
  onMove: (by: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const setStep = (at: number, patch: Partial<LearnStep>) =>
    onChange({ steps: section.steps.map((entry, index) => (index === at ? { ...entry, ...patch } : entry)) });

  return (
    <div className="card card--pad stack learned__section">
      <div className="learned__row">
        <button type="button" className="learned__fold" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} <b>{position + 1}. {section.title || 'Untitled'}</b>
          <span className="faint"> · {section.steps.length} {section.steps.length === 1 ? 'step' : 'steps'}</span>
        </button>
        <span className="learned__tools">
          <button type="button" aria-label="Move section up" disabled={position === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" aria-label="Move section down" disabled={position === count - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" aria-label="Delete section" className="learned__danger" onClick={onDelete}>✕</button>
        </span>
      </div>
      {open && (
        <>
          <label className="field">
            <span>Section title</span>
            <input value={section.title} maxLength={LEARN_LIMITS.title} onChange={(event) => onChange({ title: event.target.value })} />
          </label>
          <label className="field">
            <span>Text</span>
            <textarea rows={4} value={section.body} maxLength={LEARN_LIMITS.body} onChange={(event) => onChange({ body: event.target.value })} />
          </label>
          <div className="stack learned__steps">
            {section.steps.map((entry, at) => (
              <StepEditor key={at} step={entry} position={at} count={section.steps.length}
                onChange={(patch) => setStep(at, patch)}
                onMove={(by) => onChange({ steps: move(section.steps, at, by) })}
                onDelete={() => onChange({ steps: section.steps.filter((_, index) => index !== at) })} />
            ))}
            <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
              disabled={section.steps.length >= LEARN_LIMITS.steps}
              onClick={() => onChange({ steps: [...section.steps, blankStep()] })}>
              + Add a step
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function StepEditor({ step, position, count, onChange, onMove, onDelete }: {
  step: LearnStep;
  position: number;
  count: number;
  onChange: (patch: Partial<LearnStep>) => void;
  onMove: (by: number) => void;
  onDelete: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setProblem(null);
    try {
      const stored = await admin.uploadImage(await shrink(file));
      onChange({ image: stored.url });
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'Could not upload that picture.');
    } finally {
      setUploading(false);
    }
  }

  const badLink = step.image && !learnImageOk(step.image);

  return (
    <div className="learned__step">
      <div className="learned__row">
        <span className="learn__num">{position + 1}</span>
        <input className="learned__steptitle" value={step.title} maxLength={LEARN_LIMITS.title} aria-label="Step title"
          onChange={(event) => onChange({ title: event.target.value })} />
        <span className="learned__tools">
          <button type="button" aria-label="Move step up" disabled={position === 0} onClick={() => onMove(-1)}>↑</button>
          <button type="button" aria-label="Move step down" disabled={position === count - 1} onClick={() => onMove(1)}>↓</button>
          <button type="button" aria-label="Delete step" className="learned__danger" onClick={onDelete}>✕</button>
        </span>
      </div>
      <textarea rows={3} value={step.body} maxLength={LEARN_LIMITS.body} aria-label="Step text" placeholder="What to do, in a sentence or two."
        onChange={(event) => onChange({ body: event.target.value })} />
      <div className="learned__image">
        {step.image && !badLink && <img className="learned__thumb" src={step.image} alt="" />}
        <div className="stack" style={{ flex: 1, gap: 6 }}>
          <input value={step.image ?? ''} placeholder="Picture: upload one, or paste an https link" aria-label="Picture link"
            onChange={(event) => onChange({ image: event.target.value.trim() || null })} />
          <input value={step.caption} maxLength={LEARN_LIMITS.caption} placeholder="Caption (optional)" aria-label="Caption"
            onChange={(event) => onChange({ caption: event.target.value })} />
          <div className="row">
            <label className="btn btn--quiet btn--sm">
              {uploading ? 'Uploading…' : 'Upload picture'}
              <input type="file" accept="image/*" hidden onChange={(event) => void upload(event)} disabled={uploading} />
            </label>
            {step.image && <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange({ image: null, caption: '' })}>Remove picture</button>}
          </div>
          {badLink && <small className="learned__danger">Use an uploaded picture or an https link.</small>}
          {problem && <small className="learned__danger">{problem}</small>}
        </div>
      </div>
    </div>
  );
}
