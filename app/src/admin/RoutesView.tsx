import { confirmSentence } from '../components/Ask';
import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { STAGE_ICONS, routePartsLine, type RouteStep, type StageIcon } from '@shared/routes';
import { builtInSamples, type SampleRoute } from '@shared/route-samples';
import { DEFAULT_ROUTE_WORDS, renderButtonText, type RouteWords } from '@shared/route-words';
import {
  RENAMEABLE_KINDS, setButtonLibrary, type ButtonLibrary, type ButtonPlace, type LibraryButton,
} from '@shared/route-buttons';
import type { StepAssignee } from '@shared/routes';
import { RouteStudio } from '../pages/RouteStudioPage';
import { ApiRequestError, admin } from './api';
import { BackButton, backOps, goOps, useOpsPath } from './nav';
import { timeAgo } from '../format';
import { Loading } from '../components/Feedback';
import { Select } from '../components/Select';

type Library = Awaited<ReturnType<typeof admin.routeLibrary>>;

const ICON_LABEL: Record<StageIcon, string> = {
  supplier: '🏭 Supplier', warehouse: '🏬 Warehouse', transit: '✈️ Transit', customs: '🛃 Customs', delivery: '📦 Delivery',
};

/** How the console's examples read: on the commonest lane. */
const LANE = { origin: 'China', destination: 'India' };

/**
 * Routes, for every shop: what "Start from common steps" opens with, the
 * buttons "+ Step" offers, the sample routes under "New route", and the short
 * forms every button is drawn with.
 *
 * A route is edited in the same Studio a shop uses, on a screen of its own
 * (#routes/common, #routes/sample/<id>) so back - the console's, the
 * phone's - closes it. Saving publishes to every shop at once; a shop's own
 * saved routes are never touched by it.
 */
export function RoutesView() {
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { path } = useOpsPath();
  const [, screen, id] = path.split('/');

  const load = () => admin.routeLibrary().then((library) => {
    setButtonLibrary(library.buttons);
    setData(library);
  }).catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the route library.'));
  useEffect(() => { void load(); }, []);

  if (error && !data) return <p className="notice notice--error">{error}</p>;
  if (!data) return <Loading />;

  const savedCommon = (common: RouteStep[], customised: boolean) => setData({
    ...data, common, commonCustomised: customised, commonUpdatedAt: customised ? new Date().toISOString() : null, commonUpdatedBy: null,
  });
  const savedSamples = (samples: SampleRoute[]) => setData({ ...data, samples, customised: true, samplesUpdatedAt: new Date().toISOString() });

  if (screen === 'common') return <CommonEditor data={data} onSaved={savedCommon} />;
  if (screen === 'sample') return <SampleEditor key={id} data={data} id={id ?? 'new'} onSaved={savedSamples} />;

  return (
    <div className="stack">
      <Common data={data} onSaved={savedCommon} />
      <Buttons data={data} onSaved={(buttons) => {
        setButtonLibrary(buttons);
        setData({ ...data, buttons, buttonsUpdatedAt: new Date().toISOString() });
      }} />
      <Samples data={data} onSaved={savedSamples} />
      <Words data={data} onSaved={(words) => setData({ ...data, words, wordsUpdatedAt: new Date().toISOString() })} />
    </div>
  );
}

/** A screen of its own inside Routes: back at the top, then the Studio, edge to edge. */
function EditorScreen({ hint, error, busy, children }: {
  hint?: React.ReactNode;
  error: string | null;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="opsedit">
      <BackButton to="routes" label="Back to routes" />
      {hint && <p className="field__hint" style={{ margin: 0 }}>{hint}</p>}
      {error && <p className="notice notice--error">{error}</p>}
      {busy && <p className="faint">Saving…</p>}
      {/* The Studio links between its own screens; the console has no router of its own. */}
      <BrowserRouter>
        <div className="opsroutes__studio">{children}</div>
      </BrowserRouter>
    </section>
  );
}

/**
 * What "Start from common steps" opens with for every shop. Edited in the
 * same Studio, so the operators can add a step with its own button, reword
 * any button, and say who besides the shop presses it.
 */
function Common({ data, onSaved }: { data: Library; onSaved: (steps: RouteStep[], customised: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function restore() {
    if (!await confirmSentence('Put back Figmark’s built-in common steps?')) return;
    setBusy(true);
    try {
      const result = await admin.saveRouteCommon(null);
      onSaved(result.steps, false);
      setNote('Built-in common steps restored.');
    } catch (err) {
      setNote(err instanceof ApiRequestError ? err.message : 'Could not restore the common steps.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card--pad stack">
      <div className="row row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Common steps</h2>
          <p className="field__hint" style={{ margin: 0 }}>
            What every shop gets from “Start from common steps” under “New route”.
          </p>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => goOps('routes/common')}>Edit</button>
      </div>
      {note && <p className="notice notice--info">{note}</p>}
      <span className="faint">{routePartsLine({ steps: data.common })}</span>
      <ol className="opscommon">
        {data.common.map((step) => (
          <li key={step.id}>
            {renderButtonText(step.name, LANE)}
            {(step.trigger || step.custom) && <span className="opscommon__btn">⚡ button{step.assignee ? ` · you + ${step.assignee}` : ''}</span>}
          </li>
        ))}
      </ol>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {data.commonCustomised && (
          <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void restore()}>
            Restore built-in steps
          </button>
        )}
        {data.commonUpdatedAt && (
          <span className="faint">Last changed {timeAgo(data.commonUpdatedAt)}{data.commonUpdatedBy ? ` by ${data.commonUpdatedBy}` : ''}.</span>
        )}
      </div>
    </section>
  );
}

function CommonEditor({ data, onSaved }: { data: Library; onSaved: (steps: RouteStep[], customised: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <EditorScreen busy={busy} error={error}
      hint={<>Add a step with <b>+ Step</b> - the buttons from “Buttons” are there too - reword any button under it, and pick who besides the shop can press it.</>}>
      <RouteStudio editing={null} onSaved={() => {}} onCancel={() => backOps('routes')} cancelLabel="Back to routes"
        sample={{
          name: 'Common steps',
          steps: data.common,
          onSave: async (_name, steps) => {
            setBusy(true);
            setError(null);
            try {
              const result = await admin.saveRouteCommon(steps);
              onSaved(result.steps, true);
              backOps('routes');
            } catch (err) {
              setError(err instanceof ApiRequestError ? err.message : 'Could not save the common steps.');
              throw err;
            } finally {
              setBusy(false);
            }
          },
        }} />
    </EditorScreen>
  );
}

/* ── Buttons ─────────────────────────────────────────────────────────── */

const PLACE_LABEL: Record<ButtonPlace, string> = { pre: 'Before the lot', post: 'After the lot', both: 'Before or after the lot' };
const WHO_FOR: Record<ButtonPlace, StepAssignee[]> = { pre: ['supplier'], post: ['handler'], both: ['supplier', 'handler'] };
const WHO_LABEL: Record<StepAssignee, string> = { supplier: 'You + 🏭 Supplier', handler: 'You + 🧑‍🔧 Handler', forwarder: 'You + ✈️ Forwarder' };

/**
 * The buttons every shop finds under "+ Step": the built-in ones, in the
 * operators' words, and buttons of their own - each with where it can go and
 * who besides the shop may press it.
 */
function Buttons({ data, onSaved }: { data: Library; onSaved: (library: ButtonLibrary) => void }) {
  const [stock, setStock] = useState(data.buttons.stock);
  const [extra, setExtra] = useState<LibraryButton[]>(data.buttons.extra);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const touch = () => setSaved(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const library = await admin.saveRouteButtons({ stock, extra });
      setStock(library.stock);
      setExtra(library.extra);
      onSaved(library);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the buttons.');
    } finally {
      setBusy(false);
    }
  }

  const setExtraAt = (index: number, patch: Partial<LibraryButton>) => {
    setExtra(extra.map((entry, i) => {
      if (i !== index) return entry;
      const next = { ...entry, ...patch };
      // Who presses it follows where it can go.
      if (next.assignee && !WHO_FOR[next.place].includes(next.assignee)) delete next.assignee;
      return next;
    }));
    touch();
  };

  return (
    <section className="card card--pad stack">
      <div>
        <h2 style={{ margin: 0 }}>Buttons</h2>
        <p className="field__hint" style={{ margin: 0 }}>
          What every shop finds under <b>+ Step</b> in the route builder. Use {'{origin}'} and {'{dest}'} for the
          lot’s countries - they read as 🇨🇳 and 🇮🇳 on a China → India lot.
        </p>
      </div>

      <h3 className="opsbtns__head">Built-in buttons</h3>
      <div className="opsbtns">
        {RENAMEABLE_KINDS.map((kind) => {
          const own = stock[kind.id] ?? {};
          const set = (patch: { name?: string; button?: string }) => { setStock({ ...stock, [kind.id]: { ...own, ...patch } }); touch(); };
          return (
            <div key={kind.id} className="opsbtns__row">
              <span className="opsbtns__icon" aria-hidden="true">{kind.icon}</span>
              <label className="field">
                <span>Step</span>
                <input value={own.name ?? ''} maxLength={60} placeholder={kind.name} onChange={(event) => set({ name: event.target.value })} />
              </label>
              <label className="field">
                <span>Button says</span>
                <input value={own.button ?? ''} maxLength={28} placeholder={own.name || kind.name}
                  onChange={(event) => set({ button: event.target.value })} />
              </label>
              <span className="opswords__pill">⚡ {renderButtonText(own.button || own.name || kind.name, LANE)}</span>
            </div>
          );
        })}
      </div>

      <h3 className="opsbtns__head">New buttons</h3>
      {extra.length === 0 && <p className="faint" style={{ margin: 0 }}>None yet. Add one and every shop can put it on a route.</p>}
      <div className="opsbtns">
        {extra.map((entry, index) => (
          <div key={entry.id} className="opsbtns__row opsbtns__row--new">
            <input className="opsbtns__icon opsbtns__icon--edit" value={entry.icon} maxLength={4} aria-label="Icon"
              onChange={(event) => setExtraAt(index, { icon: event.target.value })} />
            <label className="field">
              <span>Step</span>
              <input value={entry.name} maxLength={60} placeholder="e.g. Quality checked at {origin}"
                onChange={(event) => setExtraAt(index, { name: event.target.value })} />
            </label>
            <label className="field">
              <span>Button says</span>
              <input value={entry.button} maxLength={28} placeholder={entry.name || 'e.g. QC done'}
                onChange={(event) => setExtraAt(index, { button: event.target.value })} />
            </label>
            <label className="field">
              <span>Where</span>
              <Select value={entry.place} onChange={(event) => setExtraAt(index, { place: event.target.value as ButtonPlace })}>
                {(Object.keys(PLACE_LABEL) as ButtonPlace[]).map((place) => <option key={place} value={place}>{PLACE_LABEL[place]}</option>)}
              </Select>
            </label>
            <label className="field">
              <span>Who presses it</span>
              <Select value={entry.assignee ?? ''} onChange={(event) => setExtraAt(index, { assignee: (event.target.value || undefined) as StepAssignee | undefined })}>
                <option value="">Only you</option>
                {WHO_FOR[entry.place].map((who) => <option key={who} value={who}>{WHO_LABEL[who]}</option>)}
              </Select>
            </label>
            <label className="field opsbtns__wide">
              <span>One line for the customer (optional)</span>
              <input value={entry.description} maxLength={160} placeholder="What it means for them"
                onChange={(event) => setExtraAt(index, { description: event.target.value })} />
            </label>
            <span className="opswords__pill">⚡ {renderButtonText(entry.button || entry.name || 'Button', LANE)}</span>
            <button type="button" className="btn btn--ghost btn--danger btn--sm" onClick={() => { setExtra(extra.filter((_, i) => i !== index)); touch(); }}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
        onClick={() => { setExtra([...extra, { id: `btn_${Date.now().toString(36)}`, icon: '✨', name: '', button: '', description: '', place: 'both' }]); touch(); }}>
        + New button
      </button>

      {error && <p className="notice notice--error">{error}</p>}
      {saved && <p className="notice notice--ok">Saved. Every shop sees these under + Step.</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save buttons'}</button>
        {data.buttonsUpdatedAt && (
          <span className="faint">Last changed {timeAgo(data.buttonsUpdatedAt)}{data.buttonsUpdatedBy ? ` by ${data.buttonsUpdatedBy}` : ''}.</span>
        )}
      </div>
    </section>
  );
}

/* ── Sample routes ───────────────────────────────────────────────────── */

function Samples({ data, onSaved }: { data: Library; onSaved: (samples: SampleRoute[]) => void }) {
  const list = data.samples;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  /** Every change publishes at once: there is no draft list to forget about. */
  async function publish(next: SampleRoute[], said: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await admin.saveRouteSamples(next);
      onSaved(result.samples);
      setSaved(said);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the samples.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(sample: SampleRoute) {
    if (!await confirmSentence(`Delete the sample "${sample.name}"? Shops stop being offered it. Routes shops already saved from it are not touched.`)) return;
    void publish(list.filter((entry) => entry.id !== sample.id), `"${sample.name}" deleted.`);
  }

  function move(index: number, by: number) {
    const next = [...list];
    const [taken] = next.splice(index, 1);
    next.splice(index + by, 0, taken!);
    void publish(next, 'Order saved.');
  }

  return (
    <section className="card card--pad stack">
      <div className="row row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Sample routes</h2>
          <p className="field__hint" style={{ margin: 0 }}>
            Offered to every shop under “New route”, in this order. Picking one only fills a shop’s Studio in.
          </p>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => goOps('routes/sample/new')}>+ New sample</button>
      </div>
      {!data.customised && (
        <p className="notice notice--info" style={{ margin: 0 }}>
          These are Figmark’s built-in samples. Change, reorder or delete any of them and this list becomes yours.
        </p>
      )}
      {error && <p className="notice notice--error">{error}</p>}
      {saved && <p className="notice notice--ok">{saved}</p>}
      <ol className="opsroutes">
        {list.map((sample, index) => (
          <li key={sample.id} className="opsroutes__row">
            <span className="opsroutes__icon" aria-hidden="true">{ICON_LABEL[sample.icon].split(' ')[0]}</span>
            <span className="opsroutes__body">
              <b>{sample.name}</b>
              <span className="faint">{sample.blurb}</span>
              <span className="faint">{routePartsLine(sample)}</span>
            </span>
            <span className="opsroutes__acts">
              <button type="button" className="btn btn--quiet btn--sm" disabled={busy || index === 0} aria-label="Move up" onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="btn btn--quiet btn--sm" disabled={busy || index === list.length - 1} aria-label="Move down" onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="btn btn--sm" disabled={busy} onClick={() => goOps(`routes/sample/${sample.id}`)}>Edit</button>
              <button type="button" className="btn btn--ghost btn--danger btn--sm" disabled={busy} onClick={() => remove(sample)}>Delete</button>
            </span>
          </li>
        ))}
      </ol>
      {list.length === 0 && <p className="muted">No samples: shops start from common steps or a blank route.</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
          onClick={async () => {
            if (!await confirmSentence('Put back Figmark’s built-in samples? Your list is replaced.')) return;
            void publish(builtInSamples(), 'Built-in samples restored.');
          }}>
          Restore built-in samples
        </button>
        {data.samplesUpdatedAt && data.customised && (
          <span className="faint">Last changed {timeAgo(data.samplesUpdatedAt)}{data.samplesUpdatedBy ? ` by ${data.samplesUpdatedBy}` : ''}.</span>
        )}
      </div>
    </section>
  );
}

/** One sample on a screen of its own: its card (line, icon), then its steps in the Studio. */
function SampleEditor({ data, id, onSaved }: { data: Library; id: string; onSaved: (samples: SampleRoute[]) => void }) {
  const sample = data.samples.find((entry) => entry.id === id) ?? null;
  const [blurb, setBlurb] = useState(sample?.blurb ?? '');
  const [icon, setIcon] = useState<StageIcon>(sample?.icon ?? 'transit');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = sample?.steps ?? builtInSamples()[0]?.steps ?? [];

  async function publish(next: SampleRoute[]) {
    setBusy(true);
    setError(null);
    try {
      const result = await admin.saveRouteSamples(next);
      onSaved(result.samples);
      backOps('routes');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the sample.');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  if (id !== 'new' && !sample) {
    return (
      <section className="opsedit">
        <BackButton to="routes" label="Back to routes" />
        <p className="muted">That sample is not on the list any more.</p>
      </section>
    );
  }

  return (
    <EditorScreen busy={busy} error={error}>
      <div className="opsroutes__card">
        <label className="field">
          <span>Card line</span>
          <input value={blurb} maxLength={200} onChange={(event) => setBlurb(event.target.value)}
            placeholder="One line on what kind of journey this is" />
        </label>
        <label className="field">
          <span>Icon</span>
          <Select value={icon} onChange={(event) => setIcon(event.target.value as StageIcon)}>
            {STAGE_ICONS.map((entry) => <option key={entry} value={entry}>{ICON_LABEL[entry]}</option>)}
          </Select>
        </label>
      </div>
      <RouteStudio editing={null} onSaved={() => {}} onCancel={() => backOps('routes')} cancelLabel="Back to routes"
        sample={{
          name: sample?.name ?? '',
          steps: start as RouteStep[],
          onDelete: sample ? async () => {
            if (!await confirmSentence(`Delete the sample "${sample.name}"? Shops stop being offered it.`)) return;
            void publish(data.samples.filter((entry) => entry.id !== sample.id)).catch(() => {});
          } : undefined,
          onSave: (name, steps) => {
            const next: SampleRoute = { id: sample?.id ?? `sample_${Date.now().toString(36)}`, name, blurb: blurb.trim(), icon, steps };
            return publish(sample ? data.samples.map((entry) => (entry.id === sample.id ? next : entry)) : [...data.samples, next]);
          },
        }} />
    </EditorScreen>
  );
}

/** The short forms, and whether a country on a button is its flag. */
function Words({ data, onSaved }: { data: Library; onSaved: (words: RouteWords) => void }) {
  const [terms, setTerms] = useState(data.words.terms.map((term) => ({ ...term })));
  const [flags, setFlags] = useState(data.words.flags);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const draft: RouteWords = { flags, terms: terms.filter((term) => term.from.trim() && term.to.trim()) };
  const examples = ['Received at {origin} warehouse', 'Dispatched to Freight Forwarder', 'Received at {dest} warehouse'];

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const words = await admin.saveRouteWords({ flags, terms });
      setTerms(words.terms.map((term) => ({ ...term })));
      onSaved(words);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the short forms.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card--pad stack">
      <div>
        <h2 style={{ margin: 0 }}>Button words</h2>
        <p className="field__hint" style={{ margin: 0 }}>
          How every route button is said across the marketplace. Steps keep their full words on the timeline;
          buttons use these short forms, and the lot’s country in place of {'{origin}'} and {'{dest}'}.
        </p>
      </div>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={flags} onChange={(event) => { setFlags(event.target.checked); setSaved(false); }} />
        <span>Show a country as its flag on buttons (🇨🇳 rather than China)</span>
      </label>
      <div className="opswords">
        <span className="faint">Word in a step</span><span className="faint">On a button</span><span />
        {terms.map((term, index) => (
          <WordRow key={index} term={term}
            onChange={(next) => { setTerms(terms.map((entry, i) => (i === index ? next : entry))); setSaved(false); }}
            onRemove={() => { setTerms(terms.filter((_, i) => i !== index)); setSaved(false); }} />
        ))}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setTerms([...terms, { from: '', to: '' }])}>+ Add a short form</button>
        <button type="button" className="btn btn--quiet btn--sm"
          onClick={() => { setTerms(DEFAULT_ROUTE_WORDS.terms.map((term) => ({ ...term }))); setFlags(true); setSaved(false); }}>
          Use the defaults
        </button>
      </div>
      <div className="opswords__preview">
        <span className="faint">How buttons read on a China → India lot</span>
        {examples.map((text) => (
          <span key={text} className="opswords__pill">⚡ {renderButtonText(text, { origin: 'China', destination: 'India' }, draft)}</span>
        ))}
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {saved && <p className="notice notice--ok">Saved. Every button reads this way within a minute.</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save button words'}</button>
        {data.wordsUpdatedAt && (
          <span className="faint">Last changed {timeAgo(data.wordsUpdatedAt)}{data.wordsUpdatedBy ? ` by ${data.wordsUpdatedBy}` : ''}.</span>
        )}
      </div>
    </section>
  );
}

function WordRow({ term, onChange, onRemove }: {
  term: { from: string; to: string };
  onChange: (term: { from: string; to: string }) => void;
  onRemove: () => void;
}) {
  return (
    <>
      <input value={term.from} maxLength={40} placeholder="warehouse" aria-label="Word in a step"
        onChange={(event) => onChange({ ...term, from: event.target.value })} />
      <input value={term.to} maxLength={40} placeholder="WH" aria-label="On a button"
        onChange={(event) => onChange({ ...term, to: event.target.value })} />
      <button type="button" className="btn btn--quiet btn--sm" aria-label={`Remove ${term.from || 'this short form'}`} onClick={onRemove}>✕</button>
    </>
  );
}
