import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TRIGGER_LABELS, joinIndexOf, sideOf, type RouteStep } from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';
import { RouteBuilder, STAGE_ICON_META } from '../components/RouteBuilder';
import { Ladder } from '../components/Ladder';

/**
 * The routes a shop can send a lot along.
 *
 * Its own screen rather than a section of the new-lot form, because how a
 * shipment travels is a decision a shop makes once and reuses, not a question
 * worth asking every time somebody opens a crate.
 */
/**
 * The list of routes, without the page chrome around it.
 *
 * Split out so the Sell tab can show the same list inline, under its workflow
 * buttons, instead of navigating to a separate screen for it.
 */
export function RoutesList({ spotlightNew = false }: {
  /**
   * True only when a Lot's "Define your Silk Route" sent the seller here -
   * never on an ordinary visit to this tab. That is the one rule this whole
   * pointer has to get right.
   */
  spotlightNew?: boolean;
} = {}) {
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
    <div className="stack">
      <div className="page__head">
        <div>
          <h1>Routes</h1>
          <p className="muted">
            The steps a lot travels. Buyers read these words as their tracking, so write them
            the way you would say them.
          </p>
        </div>
        <span className="spotlight-row">
          <Link to="/routes/new" className="btn"><Icon name="plus" size={14} /> New route</Link>
          {spotlightNew && <Icon name="left" size={16} className="spotlight-arrow" aria-hidden="true" />}
        </span>
      </div>

      {error && <ErrorNotice message={error} />}
      {!data && !error && <SkeletonRows count={4} />}

      {data && data.routes.length > 0 && (
        <div className="rlist">
          <span className="rlist__label">My designed Silk Routes</span>
          {data.routes.map((route) => (
            <RouteRow key={route.id} to={`/routes/${route.id}`} name={route.name} steps={route.steps} />
          ))}
        </div>
      )}

      {data && data.routes.length === 0 && (
        <EmptyState icon={<Icon name="truck" size={26} />} title="No routes yet">
          Write one for the journey your lots actually travel — a courier parcel, a pre-order, a
          supplier who ships straight to your forwarder. Every lot can then point at it.
        </EmptyState>
      )}

      <RoutesFaq />
    </div>
  );
}

/**
 * How this whole feature works, for whoever has not read the code.
 *
 * `<details>` rather than a modal or a tooltip: it sits at the bottom of the
 * screen it explains, opens with a tap (the device most of this is worked on
 * has no hover), and costs nothing when closed.
 */
function RoutesFaq() {
  return (
    <div className="card card--pad stack">
      <h2>How routes and tracking work</h2>

      <details className="faq__item">
        <summary>What is a route?</summary>
        <p className="muted">
          A ladder of steps you write once, here, and reuse on every lot that travels the same
          way. A lot carries its own copy of the route it is given, so renaming or editing a
          route later never rewrites the tracking a buyer has already been reading for weeks —
          only lots given the route afterwards see the change.
        </p>
      </details>

      <details className="faq__item">
        <summary>How does tracking actually move?</summary>
        <p className="muted">
          Every order inherits the route of the lot it rides in. Moving the lot forward, from
          Sell → Lots, moves every order in it at once — one tap instead of ticking each buyer's
          timeline by hand. An order can also move on its own, ahead of or behind the rest, for
          the exception: a piece pulled aside at customs while the rest of the crate clears.
        </p>
      </details>

      <details className="faq__item">
        <summary>What happens when an item joins a lot? (auto tracking)</summary>
        <p className="muted">
          It is tracked automatically from the moment it joins — before the lot exists, the
          moment it sells, or halfway down the ladder, it makes no difference. It is placed at
          the correct step from two things: how far the lot it joins has already moved, and
          anything already ticked for that item on its own (its "China WH received" tick, say).
          Nobody has to re-position it by hand.
        </p>
      </details>

      <details className="faq__item">
        <summary>Which steps move themselves? (⚡ Activity Triggered)</summary>
        <p className="muted">
          While designing a route, a step bound to one of the seller's own buttons ("China WH",
          "Dispatched" and so on) is marked <strong>⚡ Activity Triggered</strong>: pressing that
          button on an order moves its tracking to that step automatically, with no separate
          edit to the timeline. A step with nothing bound is marked <strong>✋ Manual</strong> —
          moved only by hand, from the lot's or the item's own ladder. A "hand-over" step can
          also ask for a tracking ID and courier when the lot is moved onto it (see below); that
          is where a live carrier lookup would plug in once one is connected.
        </p>
      </details>

      <details className="faq__item">
        <summary>What does the seller see?</summary>
        <p className="muted">
          The lot's own ladder, in Sell → Lots: which step it is on, a button to move it to the
          next one, and a place to add a note without moving it — the ordinary way to say
          "still waiting on the airline, booked for Thursday" without inventing a step for it.
          Handing a lot to a carrier also asks for that carrier's tracking ID and name, recorded
          against the step it happened at.
        </p>
      </details>

      <details className="faq__item">
        <summary>What does the buyer see?</summary>
        <p className="muted">
          The same ladder, on their own order, in the seller's own words — never the lot itself,
          or who else is travelling in it. They see which steps are done, which one is current,
          any notes the seller wrote along the way, and the tracking ID and courier once the lot
          has been handed over to one.
        </p>
      </details>

      <details className="faq__item">
        <summary>How do I design a route?</summary>
        <p className="muted">
          From "New route": tap <strong>✨ Design your Silk Route</strong> for a blank ladder of
          common steps, or pick one of the predefined shapes below it if it is close to yours.
          Name it, group its steps into stages, and bind a step to one of the seller's buttons if
          you want it to move on its own. Save it, and any lot — this one or a future one — can
          be pointed at it.
        </p>
      </details>
    </div>
  );
}

/**
 * The routes a shop can send a lot along.
 *
 * Its own screen rather than a section of the new-lot form, because how a
 * shipment travels is a decision a shop makes once and reuses, not a question
 * worth asking every time somebody opens a crate.
 */
export function RoutesPage() {
  return (
    <main className="page">
      <Link to="/shop?tab=lots" className="backlink">
        <Icon name="back" size={14} /> Lots
      </Link>
      <RoutesList />
    </main>
  );
}

/** A route in a list: its name, its shape, and where it changes hands. */
export function RouteRow({ name, steps, to, onClick, note }: {
  name: string;
  steps: RouteStep[];
  to?: string;
  /** Open it in place, for callers that keep the route library on the same screen. */
  onClick?: () => void;
  note?: string;
}) {
  const join = joinIndexOf({ steps });
  const body = (
    <>
      <span className="rrow__body">
        <span className="rrow__name">{name}</span>
        <span className="rrow__sum">
          {/* Where the route expects the hand-over, not where it happened: an
              item can be in a lot before it is listed, or join halfway. The
              split says which steps are written for one item on its own. */}
          {join === 0
            ? `${steps.length} steps, all with the lot`
            : join >= steps.length
              ? `${steps.length} steps, never joins a lot`
              : `${join} step${join === 1 ? '' : 's'} alone, then ${steps.length - join} with the lot`}
        </span>
        {note && <span className="rrow__note">{note}</span>}
      </span>
      {(to || onClick) && <Icon name="right" size={16} />}
    </>
  );
  if (to) return <Link to={to} className="rrow">{body}</Link>;
  if (onClick) return <button type="button" className="rrow" onClick={onClick}>{body}</button>;
  return <div className="rrow rrow--fixed">{body}</div>;
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
  return (
    <main className="page">
      <Link to="/routes" className="backlink">
        <Icon name="back" size={14} /> Routes
      </Link>
      <RouteEditor
        editing={id && id !== 'new' ? id : null}
        onSaved={() => navigate('/routes')}
        onCancel={() => navigate('/routes')}
      />
    </main>
  );
}

/**
 * Writing or correcting one route, wherever that is being done.
 *
 * Its own component because a shop is asked for its route twice: once on the
 * way in, while opening the storefront, and every time after that from the
 * route library. Two copies of this would be two answers to "what is a route",
 * and the one on the way in would be the worse of them.
 */
export function RouteEditor({ editing, onSaved, onCancel, intro, cancelLabel = 'Cancel' }: {
  editing: string | null;
  onSaved: () => void;
  onCancel: () => void;
  /** Said above the shapes, for somebody meeting routes for the first time. */
  intro?: ReactNode;
  cancelLabel?: string;
}) {
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
            trigger: step.trigger,
            stageId: step.stageId,
            stageName: step.stageName,
            stageIcon: step.stageIcon,
          })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that route.');
    } finally {
      setBusy(false);
    }
  }

  const named = steps.filter((step) => step.name.trim()).length;
  /** How much of this route works itself, which is the point of binding one. */
  const bound = steps.filter((step) => step.name.trim() && step.trigger).length;

  /* Nothing chosen yet: offer the shapes rather than an empty list. */
  if (!started) {
    return (
      <>
        {intro ?? (
          <div className="page__head"><div>
            <h1>New route</h1>
            <p className="muted">Start from a shape close to yours. Everything is editable after.</p>
          </div></div>
        )}

        {error && <ErrorNotice message={error} />}
        {!library && !error && <SkeletonRows count={5} />}

        {library && (
          <div className="stack">
            {/* The primary door: a blank ladder, in the seller's own words.
                Styled as an action rather than as one more row in the list
                below it, since picking a shape is the common case and this
                is the uncommon, deliberate one. */}
            <button type="button" className="silkcta silkcta--wide"
              onClick={() => open(library.suggested, '')}>
              <span className="silkcta__label">✨ Design your Silk Route</span>
              <span className="silkcta__note">
                {library.suggested.length} common steps to start from, all editable — for a
                journey none of the shapes below describes.
              </span>
            </button>

            <div className="rlist">
              <span className="rlist__label">Use predefined routes</span>
              {/* Where an order enters the lot's journey - the supplier holds
                  it until enough orders are ready, or it goes straight to the
                  forwarder - is a decision, not something to assume. */}
              {library.routeTemplates.map((template) => (
                <button key={template.id} type="button" className="rrow"
                  onClick={() => open(template.steps, template.name)}>
                  <span className="rrow__body">
                    <span className="rrow__name">
                      <Icon name={STAGE_ICON_META[template.icon].icon} size={15} /> {template.name}
                    </span>
                    <span className="rrow__sum">{template.steps.length} steps</span>
                    <span className="rrow__note">{template.blurb}</span>
                  </span>
                  <Icon name="right" size={16} />
                </button>
              ))}
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
            </div>
          </div>
        )}

        <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }}
          onClick={onCancel}>
          {cancelLabel}
        </button>
      </>
    );
  }

  return (
    <form className="card card--pad form" onSubmit={save}>
      <h2>{editing ? 'Edit route' : 'New route'}</h2>

      <label className="field">
        <span>Call it *</span>
        <input value={name} onChange={(event) => setName(event.target.value)}
          placeholder="Guangzhou air express" required autoFocus />
        <span className="field__hint">For your own lists. Buyers see the steps, not this.</span>
      </label>

      <RouteBuilder steps={steps} onChange={setSteps} split />

      {/* What the buyer will actually read, while it is being written. The
          builder is a list of fields; this is the thing the fields produce,
          and seeing it beside them is the difference between writing a route
          and guessing at one. */}
      <div className="preview">
        <div className="preview__head">
          <h3>What your buyer will see</h3>
          <span className="field__hint">
            {bound === 0
              ? 'Nothing here moves on its own yet — bind a button to a step above.'
              : `${bound} of ${named} steps move when you press a button.`}
          </span>
        </div>
        <Ladder steps={named > 0 ? steps.filter((step) => step.name.trim()) : []} current={-1} />
        {named === 0 && <p className="muted">Name a step and it appears here.</p>}

        {bound > 0 && (
          <div className="preview__keys">
            <span className="field__hint">The buttons this route uses:</span>
            <div className="preview__row">
              {steps.filter((step) => step.name.trim() && step.trigger).map((step) => (
                <span key={step.id} className="trigkey">
                  <span className="trigkey__btn">{TRIGGER_LABELS[step.trigger!].button}</span>
                  <Icon name="right" size={11} />
                  <span className="trigkey__to">{step.name}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <ErrorNotice message={error} />}

      <div className="row">
        <button type="submit" className="btn" disabled={busy || named < 2 || !name.trim()}>
          {busy ? 'Saving…' : 'Save route'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>{cancelLabel}</button>
      </div>
      {named < 2 && (
        <span className="field__hint">A route needs at least two named steps.</span>
      )}
    </form>
  );
}
