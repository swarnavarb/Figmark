import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { joinIndexOf, sideOf, type RouteStep } from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';
import { RouteBuilder } from '../components/RouteBuilder';

/**
 * The routes a shop can send a lot along.
 *
 * Its own screen rather than a section of the new-lot form, because how a
 * shipment travels is a decision a shop makes once and reuses, not a question
 * worth asking every time somebody opens a crate.
 */
export function RoutesPage() {
  const [data, setData] = useState<RoutesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.routes());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your routes.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="page">
      <Link to="/lots" className="backlink">
        <Icon name="back" size={14} /> Track
      </Link>

      <div className="page__head">
        <div>
          <h1>Routes</h1>
          <p className="muted">
            The steps a lot travels. Buyers read these words as their tracking, so write them
            the way you would say them.
          </p>
        </div>
        <Link to="/routes/new" className="btn"><Icon name="plus" size={14} /> New route</Link>
      </div>

      {error && <ErrorNotice message={error} />}
      {!data && !error && <SkeletonRows count={4} />}

      {data && (
        <div className="rlist">
          <RouteRow
            name={data.builtIn.name}
            steps={data.builtIn.steps}
            note="Built in. Used by any lot that has not picked another."
          />
          {data.routes.map((route) => (
            <RouteRow key={route.id} to={`/routes/${route.id}`} name={route.name} steps={route.steps} />
          ))}
        </div>
      )}

      {data && data.routes.length === 0 && (
        <EmptyState icon={<Icon name="truck" size={26} />} title="One route so far">
          The built-in one covers a normal consolidated run. Write your own when a lot travels
          differently — a courier parcel, a pre-order, a supplier who ships straight to your
          forwarder.
        </EmptyState>
      )}
    </main>
  );
}

/** A route in a list: its name, its shape, and where it changes hands. */
function RouteRow({ name, steps, to, note }: {
  name: string;
  steps: RouteStep[];
  to?: string;
  note?: string;
}) {
  const join = joinIndexOf({ steps });
  const body = (
    <>
      <span className="rrow__body">
        <span className="rrow__name">{name}</span>
        <span className="rrow__sum">
          {steps.length} steps
          {join < steps.length ? ` · joins a lot after step ${join}` : ' · never joins a lot'}
        </span>
        {note && <span className="rrow__note">{note}</span>}
      </span>
      {to && <Icon name="right" size={16} />}
    </>
  );
  return to
    ? <Link to={to} className="rrow">{body}</Link>
    : <div className="rrow rrow--fixed">{body}</div>;
}

/* ── The editor ──────────────────────────────────────────────────────────── */

/**
 * Writing or correcting one route.
 *
 * Two screens in one: the shapes to start from, then the ladder itself. A shop
 * that picks "Courier, end to end" gets a correct route in one tap, where the
 * same shop in a blank builder writes one with customs missing.
 */
export function RouteEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const editing = id && id !== 'new' ? id : null;

  const [library, setLibrary] = useState<RoutesResponse | null>(null);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<RouteStep[]>([]);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.routes().then((result) => {
      setLibrary(result);
      if (!editing) return;
      const found = result.routes.find((route) => route.id === editing);
      if (!found) {
        setError('No such route.');
        return;
      }
      setName(found.name);
      // Sides made explicit on the way in, so a route written before they
      // existed splits where it always did rather than collapsing into one half.
      setSteps(found.steps.map((step, index) => ({ ...step, side: sideOf(step, index) })));
      setStarted(true);
    }).catch((err) => {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your routes.');
    });
  }, [editing]);

  const open = (from: readonly RouteStep[], called: string) => {
    setName(called);
    setSteps(from.map((step, index) => ({ ...step, position: index, side: sideOf(step, index) })));
    setStarted(true);
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveRoute({
        id: editing ?? undefined,
        name: name.trim(),
        steps: steps
          .filter((step) => step.name.trim())
          .map((step, index) => ({
            id: step.id,
            name: step.name.trim(),
            description: step.description.trim(),
            side: sideOf(step, index),
          })),
      });
      navigate('/routes');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that route.');
    } finally {
      setBusy(false);
    }
  }

  const named = steps.filter((step) => step.name.trim()).length;

  /* Nothing chosen yet: offer the shapes rather than an empty list. */
  if (!started) {
    return (
      <main className="page">
        <Link to="/routes" className="backlink">
          <Icon name="back" size={14} /> Routes
        </Link>

        <div className="page__head"><div>
          <h1>New route</h1>
          <p className="muted">Start from a shape close to yours. Everything is editable after.</p>
        </div></div>

        {error && <ErrorNotice message={error} />}
        {!library && !error && <SkeletonRows count={5} />}

        {library && (
          <div className="rlist">
            {library.presets.map((preset) => (
              <button key={preset.id} type="button" className="rrow"
                onClick={() => open(preset.steps, preset.name)}>
                <span className="rrow__body">
                  <span className="rrow__name">{preset.name}</span>
                  <span className="rrow__sum">{preset.steps.length} steps</span>
                  <span className="rrow__note">{preset.blurb}</span>
                </span>
                <Icon name="right" size={16} />
              </button>
            ))}
            <button type="button" className="rrow"
              onClick={() => open(library.suggested, '')}>
              <span className="rrow__body">
                <span className="rrow__name">Start from scratch</span>
                <span className="rrow__sum">{library.suggested.length} common steps, all editable</span>
                <span className="rrow__note">For a journey none of the shapes above describes.</span>
              </span>
              <Icon name="right" size={16} />
            </button>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="page">
      <Link to="/routes" className="backlink">
        <Icon name="back" size={14} /> Routes
      </Link>

      <form className="card card--pad form" onSubmit={save}>
        <h2>{editing ? 'Edit route' : 'New route'}</h2>

        <label className="field">
          <span>Call it</span>
          <input value={name} onChange={(event) => setName(event.target.value)}
            placeholder="Guangzhou air express" required autoFocus />
          <span className="field__hint">For your own lists. Buyers see the steps, not this.</span>
        </label>

        <RouteBuilder steps={steps} onChange={setSteps} split />

        {error && <ErrorNotice message={error} />}

        <div className="row">
          <button type="submit" className="btn" disabled={busy || named < 2 || !name.trim()}>
            {busy ? 'Saving…' : 'Save route'}
          </button>
          <Link to="/routes" className="btn btn--quiet">Cancel</Link>
        </div>
        {named < 2 && (
          <span className="field__hint">A route needs at least two named steps.</span>
        )}
      </form>
    </main>
  );
}
