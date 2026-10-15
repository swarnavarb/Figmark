import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { STAGE_ICONS, routePartsLine, type RouteStep, type StageIcon } from '@shared/routes';
import { builtInSamples, type SampleRoute } from '@shared/route-samples';
import { DEFAULT_ROUTE_WORDS, renderButtonText, type RouteWords } from '@shared/route-words';
import { RouteStudio } from '../pages/RouteStudioPage';
import { ApiRequestError, admin } from './api';
import { timeAgo } from '../format';

type Library = Awaited<ReturnType<typeof admin.routeLibrary>>;

const ICON_LABEL: Record<StageIcon, string> = {
  supplier: '🏭 Supplier', warehouse: '🏬 Warehouse', transit: '✈️ Transit', customs: '🛃 Customs', delivery: '📦 Delivery',
};

/**
 * Routes, for every shop: the sample routes offered under "New route", and
 * the short forms every button is drawn with.
 *
 * A sample is edited in the same Studio a shop uses, so what an operator
 * writes is exactly what a shop picks. Saving publishes the whole list to
 * every shop at once; a shop's own saved routes are never touched by it.
 */
export function RoutesView() {
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => admin.routeLibrary().then(setData)
    .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the route library.'));
  useEffect(() => { void load(); }, []);

  if (error && !data) return <p className="notice notice--error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <Samples data={data} onSaved={(samples) => setData({ ...data, samples, customised: true, samplesUpdatedAt: new Date().toISOString() })} />
      <Words data={data} onSaved={(words) => setData({ ...data, words, wordsUpdatedAt: new Date().toISOString() })} />
    </div>
  );
}

function Samples({ data, onSaved }: { data: Library; onSaved: (samples: SampleRoute[]) => void }) {
  const [list, setList] = useState<SampleRoute[]>(data.samples);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
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
      setList(result.samples);
      onSaved(result.samples);
      setSaved(said);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the samples.');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  const current = editing === 'new' ? null : list.find((entry) => entry.id === editing) ?? null;
  if (editing) {
    return (
      <SampleEditor key={editing} sample={current} busy={busy} error={error}
        onCancel={() => { setEditing(null); setError(null); }}
        onSave={async (sample) => {
          const next = current ? list.map((entry) => (entry.id === current.id ? sample : entry)) : [...list, sample];
          await publish(next, current ? `"${sample.name}" updated for every shop.` : `"${sample.name}" added for every shop.`);
          setEditing(null);
        }}
        onDelete={current ? () => void remove(current) : undefined} />
    );
  }

  async function remove(sample: SampleRoute) {
    if (!window.confirm(`Delete the sample "${sample.name}"? Shops stop being offered it. Routes shops already saved from it are not touched.`)) return;
    await publish(list.filter((entry) => entry.id !== sample.id), `"${sample.name}" deleted.`).catch(() => {});
    setEditing(null);
  }

  function move(index: number, by: number) {
    const next = [...list];
    const [taken] = next.splice(index, 1);
    next.splice(index + by, 0, taken!);
    void publish(next, 'Order saved.').catch(() => {});
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
        <button type="button" className="btn btn--sm" onClick={() => setEditing('new')}>+ New sample</button>
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
              <button type="button" className="btn btn--sm" disabled={busy} onClick={() => setEditing(sample.id)}>Edit</button>
              <button type="button" className="btn btn--ghost btn--danger btn--sm" disabled={busy} onClick={() => void remove(sample)}>Delete</button>
            </span>
          </li>
        ))}
      </ol>
      {list.length === 0 && <p className="muted">No samples: shops start from common steps or a blank route.</p>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
          onClick={() => {
            if (!window.confirm('Put back Figmark’s built-in samples? Your list is replaced.')) return;
            void publish(builtInSamples(), 'Built-in samples restored.').catch(() => {});
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

/** One sample: its card (name, line, icon), then its steps in the Studio. */
function SampleEditor({ sample, busy, error, onSave, onCancel, onDelete }: {
  sample: SampleRoute | null;
  busy: boolean;
  error: string | null;
  onSave: (sample: SampleRoute) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [blurb, setBlurb] = useState(sample?.blurb ?? '');
  const [icon, setIcon] = useState<StageIcon>(sample?.icon ?? 'transit');
  const start = sample?.steps ?? builtInSamples()[0]?.steps ?? [];

  return (
    <section className="card card--pad stack">
      <div className="row row--between">
        <h2 style={{ margin: 0 }}>{sample ? `Edit “${sample.name}”` : 'New sample route'}</h2>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Back to the list</button>
      </div>
      <div className="opsroutes__card">
        <label className="field">
          <span>Card line</span>
          <input value={blurb} maxLength={200} onChange={(event) => setBlurb(event.target.value)}
            placeholder="One line on what kind of journey this is" />
        </label>
        <label className="field">
          <span>Icon</span>
          <select value={icon} onChange={(event) => setIcon(event.target.value as StageIcon)}>
            {STAGE_ICONS.map((entry) => <option key={entry} value={entry}>{ICON_LABEL[entry]}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {busy && <p className="faint">Saving…</p>}
      {/* The Studio links between its own screens; the console has no router of its own. */}
      <BrowserRouter>
        <div className="opsroutes__studio">
          <RouteStudio editing={null} onSaved={() => {}} onCancel={onCancel} cancelLabel="Back to the list"
            sample={{
              name: sample?.name ?? '',
              steps: start as RouteStep[],
              onDelete,
              onSave: (name, steps) => onSave({
                id: sample?.id ?? `sample_${Date.now().toString(36)}`,
                name, blurb: blurb.trim(), icon, steps,
              }),
            }} />
        </div>
      </BrowserRouter>
    </section>
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
  const examples = ['Received at {origin} warehouse', 'Dispatched to Freight Forwarder', 'Received at {destination} warehouse'];

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
          buttons use these short forms, and the lot’s country in place of {'{origin}'} and {'{destination}'}.
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
