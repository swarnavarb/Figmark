import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { routePartsLine, type RouteStep } from '@shared/routes';
import { ApiRequestError, api, type RoutesResponse } from '../api';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';

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
  const [showFaq, setShowFaq] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.routes());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your routes.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Bring every unfinished lot on a route up to its latest steps. */
  const [applying, setApplying] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  async function apply(id: string, lots: number) {
    if (!window.confirm(`Update ${lots === 1 ? 'the lot' : `all ${lots} lots`} on this route? Every buyer in ${lots === 1 ? 'it' : 'them'} reads the new steps from where the lot is now.`)) return;
    setApplying(id);
    setError(null);
    try {
      const result = await api.applyRoute(id);
      setFlash(`${result.lotsUpdated === 1 ? '1 lot' : `${result.lotsUpdated} lots`} updated.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not update those lots.');
    } finally {
      setApplying(null);
    }
  }

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
          <Link to="/routes/studio/new" className="btn"><Icon name="plus" size={14} /> New route</Link>
          {spotlightNew && (
            <span className="spotlight-badge" aria-hidden="true">
              <Icon name="left" size={18} />
            </span>
          )}
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setShowFaq(!showFaq)} aria-label="FAQ" title="How routes and tracking work">
            <Icon name="message" size={14} />
          </button>
        </span>
      </div>

      {error && <ErrorNotice message={error} />}
      {flash && <p className="notice notice--ok">{flash}</p>}
      {!data && !error && <SkeletonRows count={4} />}

      {data && data.routes.length > 0 && (
        <div className="rlist">
          <span className="rlist__label">My designed Silk Routes</span>
          {data.routes.map((route) => {
            const use = data.usage?.[route.id];
            return (
              <div key={route.id} className="stack" style={{ gap: 6 }}>
                <RouteRow to={`/routes/studio/${encodeURIComponent(route.id)}`} name={route.name} steps={route.steps}
                  note={use && use.lots > 0
                    ? `On ${use.lots} ${use.lots === 1 ? 'lot' : 'lots'}${use.behind > 0 ? ` · ${use.behind} on older steps` : ''}`
                    : undefined} />
                {use && use.behind > 0 && (
                  <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }}
                    disabled={applying === route.id} onClick={() => void apply(route.id, use.behind)}>
                    {applying === route.id ? 'Updating…' : `Update ${use.behind === 1 ? 'that lot' : `${use.behind} lots`} to these steps`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data && data.routes.length === 0 && (
        <EmptyState icon={<Icon name="truck" size={26} />} title="No routes yet">
          Write one for the journey your lots actually travel — a courier parcel, a pre-order, a
          supplier who ships straight to your forwarder. Every lot can then point at it.
        </EmptyState>
      )}

      {showFaq && <RoutesFaq />}
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
          route later never rewrites the tracking a buyer has already been reading for weeks on
          its own. Saving an edit offers to bring the lots on that route up to date, and this list
          shows any lot still on older steps.
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
          From "New route": let Pip ask you a few questions, start from a blank chain, or pick a
          shape close to yours. The route has three lanes - before the lot, in the lot, after it -
          and each step's button is handed out for you. Save it, and any lot can be pointed at it.
          A route with nothing in the lot lane is for items shipped one by one and is not offered
          to lots.
        </p>
      </details>
    </div>
  );
}

/**
 * The old addresses of a route: the list and each route's own page. Both
 * live in the Sell tab and the Studio now, and a bookmark should still land.
 */
export function RouteRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={id && id !== 'new' ? `/routes/studio/${encodeURIComponent(id)}` : '/routes/studio/new'} replace />;
}

/** A route in a list: its name, its three parts, and what it is used on. */
export function RouteRow({ name, steps, to, onClick, note }: {
  name: string;
  steps: RouteStep[];
  to?: string;
  /** Open it in place, for callers that keep the route library on the same screen. */
  onClick?: () => void;
  note?: string;
}) {
  const body = (
    <>
      <span className="rrow__body">
        <span className="rrow__name">{name}</span>
        {/* The same three parts the Studio draws as lanes, so the list and
            the editor never describe one route two ways. */}
        <span className="rrow__sum">{routePartsLine({ steps })}</span>
        {note && <span className="rrow__note">{note}</span>}
      </span>
      {(to || onClick) && <Icon name="right" size={16} />}
    </>
  );
  if (to) return <Link to={to} className="rrow">{body}</Link>;
  if (onClick) return <button type="button" className="rrow" onClick={onClick}>{body}</button>;
  return <div className="rrow rrow--fixed">{body}</div>;
}
