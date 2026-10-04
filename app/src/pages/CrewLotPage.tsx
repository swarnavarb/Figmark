import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { CrewRole } from '@shared/services';
import { ApiRequestError, api, type CrewLotView } from '../api';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatWeight } from '../format';
import { useUndo } from '../components/Undo';

/**
 * One lot, as the crew works it.
 *
 * The shop writes the route and decides who presses what. This screen is the
 * other end of that decision: the lot's items, and on each one exactly the
 * buttons the route handed this person - no more, because a button that
 * appears and then refuses is worse than no button, and no fewer, because a
 * button the shop handed over and nobody can find is a buyer's tracking that
 * never moves.
 *
 * A forwarder also gets the crate itself: the whole-lot steps the route gave
 * them, like "Departed Guangzhou", which move every item at once.
 */

const ROLE_LABEL: Record<CrewRole, string> = { supplier: 'Supplier', handler: 'Domestic handler', forwarder: 'Forwarder' };

export function CrewLotPage() {
  const { sellerId = '', lotId = '' } = useParams<{ sellerId: string; lotId: string }>();
  const [params, setParams] = useSearchParams();
  const role = params.get('role') ?? undefined;
  const offerUndo = useUndo();

  const [view, setView] = useState<CrewLotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');

  const load = useCallback(async () => {
    try {
      setView(await api.crewLot(sellerId, lotId, role));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load that lot.');
    }
  }, [sellerId, lotId, role]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Press (or take back) one button on some items, and show it at once. */
  async function press(ids: string[], key: string, on: boolean) {
    if (!view) return;
    const tags = ids.map((id) => `${id}:${key}`);
    setBusy((current) => new Set([...current, ...tags]));
    const before = view;
    const stamp = on ? new Date().toISOString() : null;
    setView({ ...view, items: view.items.map((item) => (ids.includes(item.id) ? { ...item, ticks: { ...item.ticks, [key]: stamp } } : item)) });
    setError(null);
    try {
      for (const id of ids) {
        const result = await api.setCheckpoint(id, key, on);
        if (ids.length === 1 && result.undo) {
          const undo = result.undo;
          offerUndo({
            label: on ? 'Pressed' : 'Taken back',
            until: undo.until,
            undo: async () => { await api.setCheckpoint(id, key, !on, undefined, undo.id); await load(); },
          });
        }
      }
    } catch (err) {
      setView(before);
      setError(err instanceof ApiRequestError ? err.message : 'That press did not save.');
    } finally {
      setBusy((current) => { const next = new Set(current); tags.forEach((tag) => next.delete(tag)); return next; });
      void load();
    }
  }

  const groups = useMemo(() => {
    if (!view) return [];
    if (view.role !== 'handler') return [{ id: 'all', title: null as string | null, phone: null as string | null, items: view.items }];
    const byParcel = new Map<string, typeof view.items>();
    for (const item of view.items) byParcel.set(item.parcel ?? item.id, [...(byParcel.get(item.parcel ?? item.id) ?? []), item]);
    return [...byParcel].map(([id, items]) => ({ id, title: items[0]!.buyer?.name ?? 'A buyer', phone: items[0]!.buyer?.phone ?? null, items }))
      .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  }, [view]);

  if (error && !view) {
    return (
      <main className="page">
        <BackLink to="/services/mine">← My services</BackLink>
        <EmptyState icon={<Icon name="lock" size={26} />} title="Not your lot">{error}</EmptyState>
      </main>
    );
  }
  if (!view) return <main className="page"><p className="muted">Loading…</p></main>;

  const done = (key: string) => view.items.filter((item) => item.ticks[key]).length;
  const visible = (key: string) => filter === 'all' || (filter === `todo:${key}`);
  const weight = view.items.reduce((sum, item) => sum + item.weightGrams, 0);

  return (
    <main className="page cl-page">
      <BackLink to={view.role === 'forwarder' && view.forwarder ? `/services/store/forwarder/${view.forwarder.ownerId}?tab=work` : '/services/mine'}>
        ← {view.role === 'forwarder' && view.forwarder ? view.forwarder.name : 'My services'}
      </BackLink>

      <header className="cl-head">
        <div className="cl-head__top">
          <span className="cl-role">{ROLE_LABEL[view.role]}</span>
          {view.roles.length > 1 && (
            <span className="cl-roles">
              {view.roles.map((each) => (
                <button key={each} type="button" className={each === view.role ? 'is-on' : ''}
                  onClick={() => setParams({ role: each }, { replace: true })}>{ROLE_LABEL[each]}</button>
              ))}
            </span>
          )}
        </div>
        <h1>{view.lot.name} <span className="cl-num">{view.lot.number}</span></h1>
        <p className="muted">
          For {view.store.name}
          {view.lot.laneLabel ? ` · ${view.lot.laneLabel}` : ''}
          {view.lot.city ? ` · ${view.lot.city}` : ''}
          {view.lot.trackingReference ? ` · ${view.lot.trackingReference}` : ''}
        </p>
        <div className="cl-meta">
          <span><b>{view.items.length}</b> items</span>
          <span><b>{formatWeight(weight)}</b></span>
          {view.role === 'handler' && <span><b>{groups.length}</b> parcels</span>}
          {view.items.some((item) => item.covered) && <span>🛡 <b>{view.items.filter((item) => item.covered).length}</b> insured</span>}
          {view.store.handle && <Link to={`/messages/${view.store.handle}`} className="btn btn--ghost btn--sm"><Icon name="message" size={13} /> Message the shop</Link>}
        </div>
      </header>

      {/* The route, with this person's part of it lit. */}
      <ol className="cl-route" aria-label="The route">
        {view.steps.map((step) => {
          const mine = view.buttons.some((button) => button.index === step.index) || view.moves.some((move) => move.index === step.index);
          const state = step.index < view.lot.stepIndex ? 'done' : step.index === view.lot.stepIndex ? 'now' : 'todo';
          return (
            <li key={step.index} className={`cl-route__step cl-route__step--${state}${mine ? ' is-mine' : ''}`}>
              <span className="cl-route__dot" aria-hidden="true" />
              <span className="cl-route__name">{step.name}</span>
              {mine && <span className="cl-route__you">you</span>}
            </li>
          );
        })}
      </ol>

      {error && <ErrorNotice message={error} />}

      {view.moves.length > 0 && <CrateMoves view={view} onMoved={load} />}

      {view.buttons.length === 0 ? (
        <EmptyState icon={<Icon name="bolt" size={26} />} title="No buttons handed to you">
          The shop’s route does not give the {ROLE_LABEL[view.role].toLowerCase()} a button on this lot yet.
          {view.moves.length > 0 ? ' You can still move the crate above.' : ' Ask them to assign one in the Route Studio.'}
        </EmptyState>
      ) : (
        <>
          <section className="cl-buttons" aria-label="Your buttons">
            {view.buttons.map((button) => {
              const count = done(button.key);
              const all = count === view.items.length && view.items.length > 0;
              return (
                <div key={button.key} className={`cl-btncard${all ? ' is-done' : ''}`}>
                  <span className="cl-btncard__label">⚡ {button.label}</span>
                  <span className="cl-btncard__step">{button.step}{button.assigned ? '' : ' · your part of the trip'}</span>
                  <span className="cl-btncard__bar"><span style={{ width: `${view.items.length ? (count / view.items.length) * 100 : 0}%` }} /></span>
                  <span className="cl-btncard__foot">
                    <span><b>{count}</b>/{view.items.length}</span>
                    {!all && (
                      <button type="button" className="btn btn--sm" disabled={busy.size > 0}
                        onClick={() => void press(view.items.filter((item) => !item.ticks[button.key]).map((item) => item.id), button.key, true)}>
                        Press for all {view.items.length - count}
                      </button>
                    )}
                    <button type="button" className={`cl-filter${filter === `todo:${button.key}` ? ' is-on' : ''}`}
                      onClick={() => setFilter(filter === `todo:${button.key}` ? 'all' : `todo:${button.key}`)}>
                      {filter === `todo:${button.key}` ? 'Show all' : 'Only not yet'}
                    </button>
                  </span>
                </div>
              );
            })}
          </section>

          <section className="stack">
            {groups.map((group) => {
              const items = group.items.filter((item) => filter === 'all' || view.buttons.some((button) => visible(button.key) && !item.ticks[button.key]));
              if (items.length === 0) return null;
              return (
                <div key={group.id} className={group.title ? 'cl-parcel' : 'cl-flat'}>
                  {group.title && (
                    <div className="cl-parcel__head">
                      <span className="cl-parcel__name"><Icon name="box" size={15} /> {group.title}</span>
                      {group.phone && <a className="faint" href={`tel:${group.phone}`}>{group.phone}</a>}
                      <span className="cl-parcel__all">
                        {view.buttons.map((button) => {
                          const every = group.items.every((item) => item.ticks[button.key]);
                          return (
                            <button key={button.key} type="button" className={`tickbtn${every ? ' is-on' : ''}`} aria-pressed={every}
                              disabled={busy.size > 0} onClick={() => void press(group.items.map((item) => item.id), button.key, !every)}>
                              {button.label} · parcel
                            </button>
                          );
                        })}
                      </span>
                    </div>
                  )}
                  {items.map((item) => (
                    <article key={item.id} className="cl-item">
                      <span className="cl-item__body">
                        <span className="cl-item__name">{item.itemName}</span>
                        <span className="faint">
                          {item.condition}{item.quantity > 1 ? ` · ×${item.quantity}` : ''} · {formatWeight(item.weightGrams)}
                          {item.covered ? ' · 🛡 insured' : ''}
                        </span>
                        {item.toStudio && <span className="cl-item__flag"><Icon name="spark" size={12} /> Going to an artist’s studio</span>}
                      </span>
                      <span className="cl-item__acts">
                        {view.buttons.map((button) => {
                          const on = Boolean(item.ticks[button.key]);
                          return (
                            <button key={button.key} type="button" className={`tickbtn${on ? ' is-on' : ''}`} aria-pressed={on}
                              disabled={busy.has(`${item.id}:${button.key}`)} onClick={() => void press([item.id], button.key, !on)}>
                              {button.label}
                            </button>
                          );
                        })}
                      </span>
                    </article>
                  ))}
                </div>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}

/** The whole-crate steps handed to a forwarder. */
function CrateMoves({ view, onMoved }: { view: CrewLotView; onMoved: () => Promise<void> }) {
  const offerUndo = useUndo();
  const next = view.moves.find((move) => move.index > view.lot.stepIndex) ?? null;
  const [trackingId, setTrackingId] = useState('');
  const [shipper, setShipper] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(to: number) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.forwarderStepLot(view.lot.sellerId, view.lot.id, to, { trackingId: trackingId || undefined, shipper: shipper || undefined });
      const undo = result.undo;
      if (undo) {
        offerUndo({
          label: 'Lot moved',
          until: undo.until,
          undo: async () => {
            await api.forwarderStepLot(view.lot.sellerId, view.lot.id, undo.to, { undoOf: undo.id });
            await onMoved();
          },
        });
      }
      await onMoved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'The lot did not move.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cl-crate">
      <div className="cl-crate__head">
        <span className="cl-crate__icon" aria-hidden="true"><Icon name="plane" size={20} /></span>
        <span>
          <b>The crate</b>
          <span className="faint">Moving it moves every item in the lot, and every buyer is told.</span>
        </span>
      </div>
      <div className="cl-crate__moves">
        {view.moves.map((step) => {
          const state = step.index <= view.lot.stepIndex ? 'done' : step === next ? 'next' : 'later';
          return (
            <div key={step.index} className={`cl-move cl-move--${state}`}>
              <span className="cl-move__name">{state === 'done' && <Icon name="check" size={13} />} {step.name}</span>
              {state === 'next' && (
                <>
                  {step.forward && (
                    <span className="cl-move__ship">
                      <input value={shipper} onChange={(e) => setShipper(e.target.value)} placeholder="Carrier / airline" aria-label="Carrier" />
                      <input value={trackingId} onChange={(e) => setTrackingId(e.target.value)} placeholder="AWB / tracking" aria-label="Tracking" />
                    </span>
                  )}
                  <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void move(step.index)}>
                    Move the lot here
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {error && <ErrorNotice message={error} />}
    </section>
  );
}
