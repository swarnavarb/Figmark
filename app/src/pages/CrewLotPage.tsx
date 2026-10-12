import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { CrewRole } from '@shared/services';
import type { OrderPhoto } from '@shared/models';
import { shortButtonLabel } from '@shared/routes';
import { ApiRequestError, api, type CrewLotView } from '../api';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon, Modal, Thumb } from '../components/ui';
import { formatMoney, formatWeight } from '../format';
import { useUndo } from '../components/Undo';
import { OrderPhotos } from '../components/OrderPhotos';
import { ConditionTag } from '../components/ConditionTag';
import { shrink } from '../components/PhotoManager';
import { useSession } from '../session';

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

type CrewItem = CrewLotView['items'][number];
type CrewButtonRef = CrewLotView['buttons'][number];

/**
 * How the lot is laid out. The supplier packs pieces, so they get tiles; the
 * handler makes up parcels, so they get customers, and tiles at a toggle for
 * the unpacking. A forwarder keeps the list.
 */
type Layout = 'tiles' | 'customers' | 'list';

/** Why a button cannot be pressed on this item right now, or null. */
function heldBack(view: CrewLotView, item: CrewItem, button: CrewButtonRef): string | null {
  if (button.key === 'dispatched' && item.cleared === false && !item.ticks.dispatched) {
    return 'Waiting for the shop to mark this customer ready to dispatch.';
  }
  return null;
}

export function CrewLotPage() {
  const { sellerId = '', lotId = '' } = useParams<{ sellerId: string; lotId: string }>();
  const [params, setParams] = useSearchParams();
  const role = params.get('role') ?? undefined;
  const offerUndo = useUndo();

  const [view, setView] = useState<CrewLotView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { user } = useSession();

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

  /** The orders waiting on a courier and AWB before they are marked dispatched. */
  const [shipping, setShipping] = useState<{ ids: string[] } | null>(null);

  /**
   * Press (or take back) one button on some items. Dispatched asks first for
   * the courier and AWB, as the shop's own Dispatched does, so the customer
   * gets their tracking with the news.
   */
  async function press(ids: string[], key: string, on: boolean) {
    if (key === 'dispatched' && on) {
      setShipping({ ids });
      return;
    }
    await save(ids, key, on);
  }

  /** Save one button on some items, and show it at once. */
  async function save(ids: string[], key: string, on: boolean, shipment?: { courier?: string; awb?: string }) {
    if (!view) return;
    const tags = ids.map((id) => `${id}:${key}`);
    setBusy((current) => new Set([...current, ...tags]));
    const before = view;
    const stamp = on ? new Date().toISOString() : null;
    setView({ ...view, items: view.items.map((item) => (ids.includes(item.id) ? { ...item, ticks: { ...item.ticks, [key]: stamp } } : item)) });
    setError(null);
    try {
      for (const id of ids) {
        const result = await api.setCheckpoint(id, key, on, shipment);
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

  /** New photos for one item, as the server returned them. */
  function setPhotos(id: string, photos: OrderPhoto[]) {
    setView((current) => current && { ...current, items: current.items.map((item) => (item.id === id ? { ...item, photos } : item)) });
  }

  const groups = useMemo(() => {
    if (!view) return [];
    if (view.role !== 'handler') return [{ id: 'all', title: null as string | null, phone: null as string | null, items: view.items }];
    const byParcel = new Map<string, typeof view.items>();
    for (const item of view.items) byParcel.set(item.parcel ?? item.id, [...(byParcel.get(item.parcel ?? item.id) ?? []), item]);
    return [...byParcel].map(([id, items]) => ({ id, title: items[0]!.buyer?.name ?? 'A customer', phone: items[0]!.buyer?.phone ?? null, items }))
      .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  }, [view]);

  /** The handler's parcels after the search box and the "Only not yet" filter. */
  const shown = useMemo(() => {
    if (!view || view.role !== 'handler') return groups;
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (needle && !`${group.title ?? ''} ${group.phone ?? ''}`.toLowerCase().includes(needle)) return false;
      if (filter === 'all') return true;
      const key = filter.replace(/^todo:/, '');
      return group.items.some((item) => !item.ticks[key]);
    });
  }, [view, groups, query, filter]);

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
  const layout: Layout = view.role === 'supplier' ? 'tiles'
    : view.role === 'handler' ? (params.get('view') === 'tiles' ? 'tiles' : 'customers')
      : 'list';

  return (
    <main className={`page cl-page${view.role === 'handler' ? ' cl-page--handler' : ''}`}>
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
        <div className="cl-bar">
          {/* Every lot they work in this role, one tap away - the supplier on
              three runs does not go back to My services between them. */}
          <label className="cl-lotpick">
            <span className="cl-lotpick__no">LOT {view.lot.number}</span>
            <Icon name="sort" size={15} />
            <select aria-label="Switch lot" value={`${view.lot.sellerId}/${view.lot.id}`}
              onChange={(event) => navigate(`/services/crew/${event.target.value}?role=${view.role}`)}>
              {(view.lots.some((row) => row.lotId === view.lot.id) ? view.lots : [{ sellerId: view.lot.sellerId, lotId: view.lot.id, name: view.lot.name, number: view.lot.number }, ...view.lots])
                .map((row) => (
                  <option key={`${row.sellerId}/${row.lotId}`} value={`${row.sellerId}/${row.lotId}`}>LOT {row.number} · {row.name}</option>
                ))}
            </select>
          </label>
          <span className="cl-orders"><b>{view.items.length}</b> {view.items.length === 1 ? 'Order' : 'Orders'}</span>
        </div>
        <h1>{view.lot.name} <span className="cl-num">{view.lot.number}</span></h1>
        <p className="muted">
          For {view.store.name}
          {view.lot.laneLabel ? ` · ${view.lot.laneLabel}` : ''}
          {view.lot.city ? ` · ${view.lot.city}` : ''}
          {view.lot.trackingReference ? ` · ${view.lot.trackingReference}` : ''}
        </p>
        <div className="cl-meta">
          <span><b>{view.items.length}</b> {view.items.length === 1 ? 'order' : 'orders'}</span>
          <span><b>{formatWeight(weight)}</b></span>
          {view.role === 'handler' && <span><b>{groups.length}</b> {groups.length === 1 ? 'customer' : 'customers'}</span>}
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
        view.role === 'forwarder' ? (
          <EmptyState icon={<Icon name="bolt" size={26} />} title="No buttons handed to you">
            The shop’s route does not give the forwarder a button on this lot yet.
            {view.moves.length > 0 ? ' You can still move the crate above.' : ' Ask them to assign one in the Route Studio.'}
          </EmptyState>
        ) : (
          /* Nothing to press yet, but the pieces are still worth seeing - and
             photographing - while the shop decides what to hand over. */
          <>
            <p className="muted">
              The shop has not handed the {ROLE_LABEL[view.role].toLowerCase()} a button on this lot yet. You can still
              see the orders and add photos; ask them to choose your buttons on the lot’s Crew tab.
            </p>
            <CrewTiles view={view} items={view.items} busy={busy} onPress={press} onPhotos={setPhotos} />
          </>
        )
      ) : (
        <>
          {view.role === 'handler' ? (
            <>
              <HandlerSummary view={view} groups={groups} busy={busy.size > 0} filter={filter} onFilter={setFilter} onPress={press} />
              <div className="hx-tools">
                <div className="hx-layout" role="group" aria-label="Layout">
                  <button type="button" aria-pressed={layout === 'customers'}
                    onClick={() => setParams({ role: view.role, view: 'customers' }, { replace: true })}>
                    <Icon name="users" size={16} /> Customers
                  </button>
                  <button type="button" aria-pressed={layout === 'tiles'}
                    onClick={() => setParams({ role: view.role, view: 'tiles' }, { replace: true })}>
                    <Icon name="image" size={16} /> Tiles
                  </button>
                </div>
                {layout === 'customers' && groups.length > 3 && (
                  <label className="hx-search">
                    <Icon name="search" size={16} />
                    <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
                      placeholder="Find a customer" aria-label="Find a customer by name or phone" enterKeyHint="search" />
                  </label>
                )}
              </div>
            </>
          ) : (
            <section className="cl-buttons" aria-label="Your buttons">
              {view.buttons.map((button) => {
                const count = done(button.key);
                const all = count === view.items.length && view.items.length > 0;
                const pressable = view.items.filter((item) => !item.ticks[button.key] && !heldBack(view, item, button));
                return (
                  <div key={button.key} className={`cl-btncard${all ? ' is-done' : ''}`}>
                    <span className="cl-btncard__label">⚡ {button.label}</span>
                    <span className="cl-btncard__step">{button.step}{button.assigned ? '' : ' · your part of the trip'}</span>
                    <span className="cl-btncard__bar"><span style={{ width: `${view.items.length ? (count / view.items.length) * 100 : 0}%` }} /></span>
                    <span className="cl-btncard__foot">
                      <span><b>{count}</b>/{view.items.length}</span>
                      {!all && pressable.length > 0 && (
                        <button type="button" className="btn btn--sm" disabled={busy.size > 0}
                          onClick={() => void press(pressable.map((item) => item.id), button.key, true)}>
                          Press for all {pressable.length}
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

          )}
          {layout === 'tiles' ? (
            <CrewTiles view={view} items={view.items.filter((item) => filter === 'all' || view.buttons.some((button) => visible(button.key) && !item.ticks[button.key]))}
              busy={busy} onPress={press} onPhotos={setPhotos} />
          ) : view.role === 'handler' ? (
            <HandlerParcels view={view} groups={shown} total={groups.length} query={query} busy={busy} me={user?.id}
              onClear={() => { setQuery(''); setFilter('all'); }} onPress={press} onPhotos={setPhotos} />
          ) : (
          <section className="stack">
            {groups.map((group) => {
              const items = group.items.filter((item) => filter === 'all' || view.buttons.some((button) => visible(button.key) && !item.ticks[button.key]));
              if (items.length === 0) return null;
              return (
                <div key={group.id} className="cl-flat">
                  {items.map((item) => (
                    <article key={item.id} className="cl-item">
                      <span className="cl-item__body">
                        <span className="cl-item__name">{item.itemName}</span>
                        <span className="faint">
                          <ConditionTag condition={item.condition} />{item.quantity > 1 ? ` ×${item.quantity}` : ''} · {formatWeight(item.weightGrams)}
                          {item.covered ? ' · 🛡 insured' : ''}
                        </span>
                        {item.toStudio && <span className="cl-item__flag"><Icon name="spark" size={12} /> Going to an artist’s studio</span>}
                        {view.role !== 'forwarder' && (
                          <OrderPhotos orderId={item.id} photos={item.photos} me={user?.id}
                            onChange={(photos) => setPhotos(item.id, photos)} />
                        )}
                      </span>
                      <span className="cl-item__acts">
                        {view.buttons.map((button) => {
                          const on = Boolean(item.ticks[button.key]);
                          const held = heldBack(view, item, button);
                          return (
                            <button key={button.key} type="button" className={`tickbtn${on ? ' is-on' : ''}`} aria-pressed={on}
                              disabled={busy.has(`${item.id}:${button.key}`) || Boolean(held)} title={held ?? undefined}
                              onClick={() => void press([item.id], button.key, !on)}>
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
          )}
        </>
      )}

      {shipping && (
        <ShipDialog view={view} ids={shipping.ids} onClose={() => setShipping(null)}
          onSave={(shipment) => { const { ids } = shipping; setShipping(null); void save(ids, 'dispatched', true, shipment); }} />
      )}
    </main>
  );
}

/**
 * Courier and AWB, asked as Dispatched is pressed. One customer's box gets
 * one AWB; several customers at once share a courier at most, since each box
 * has its own tracking number.
 */
function ShipDialog({ view, ids, onClose, onSave }: {
  view: CrewLotView;
  ids: string[];
  onClose: () => void;
  onSave: (shipment: { courier?: string; awb?: string }) => void;
}) {
  const items = view.items.filter((item) => ids.includes(item.id));
  const people = [...new Set(items.map((item) => item.parcel ?? item.id))];
  const one = people.length === 1;
  const who = items[0]?.buyer?.name ?? 'the customer';
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  return (
    <Modal title="🚚 Dispatch it" onClose={onClose}>
      <form className="stack" onSubmit={(event) => {
        event.preventDefault();
        onSave({ courier: courier.trim() || undefined, awb: one ? awb.trim() || undefined : undefined });
      }}>
        <p style={{ margin: 0 }}>
          {one
            ? <>{items.length === 1 ? <b>{items[0]!.itemName}</b> : <><b>{items.length} orders</b></>} for <b>{who}</b>. Add the courier and AWB so they can track their parcel.</>
            : <>{items.length} orders for {people.length} customers. Each box has its own AWB, so add those one customer at a time; a courier name here goes on all of them.</>}
        </p>
        <label className="field">
          <span>Courier name</span>
          <input value={courier} onChange={(event) => setCourier(event.target.value)} maxLength={80}
            placeholder="Delhivery, Blue Dart, DTDC…" autoFocus />
        </label>
        {one && (
          <label className="field">
            <span>AWB / tracking number</span>
            <input value={awb} onChange={(event) => setAwb(event.target.value)} maxLength={80}
              placeholder="e.g. 1234567890" className="mono" />
          </label>
        )}
        <span className="field__hint">No AWB yet? Dispatch now; the shop can add it later.</span>
        <button type="submit" className="btn btn--block">🚚 Mark dispatched</button>
        <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>Cancel</button>
      </form>
    </Modal>
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
          <span className="faint">Moving it moves every item in the lot, and every customer is told.</span>
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

/* ── The domestic handler's lot ────────────────────────────────────────── */

/** One customer's share of the lot: everything that goes out in one box. */
type ParcelGroup = { id: string; title: string | null; phone: string | null; items: CrewItem[] };

/** Every button handed over is pressed on every item in the parcel. */
function parcelDone(view: CrewLotView, items: CrewItem[]): boolean {
  return view.buttons.length > 0 && view.buttons.every((button) => items.every((item) => item.ticks[button.key]));
}

/** "Asha Rao" → "AR", for the round badge beside a customer. */
function initials(name: string | null): string {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase() || '?';
}

/**
 * A hue per customer, from their name, so a handler scanning thirty boxes
 * finds the one they were just on by colour as well as by name. The name is
 * always beside it: colour is a second cue, never the only one.
 */
const HUES = [
  ['var(--violet-text)', 'var(--violet-soft)'],
  ['var(--aqua)', 'var(--aqua-soft)'],
  ['var(--pink-text)', 'var(--pink-soft)'],
  ['var(--blue-text)', 'var(--blue-soft)'],
  ['var(--lime)', 'var(--lime-soft)'],
  ['var(--coral)', 'var(--coral-soft)'],
] as const;

function hueOf(name: string | null): CSSProperties {
  let hash = 0;
  for (const char of name ?? '') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [ink, soft] = HUES[hash % HUES.length]!;
  return { '--hue': ink, '--hue-soft': soft } as CSSProperties;
}

/** A progress ring. Decorative: the words beside it say the same thing. */
function Ring({ value }: { value: number }) {
  const r = 26;
  const length = 2 * Math.PI * r;
  return (
    <svg className="hx-ring" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className="hx-ring__track" cx="32" cy="32" r={r} />
      <circle className="hx-ring__fill" cx="32" cy="32" r={r}
        strokeDasharray={length} strokeDashoffset={length * (1 - Math.min(1, Math.max(0, value)))} />
      <text x="32" y="32" dominantBaseline="central" textAnchor="middle" className="hx-ring__pct">
        {Math.round(value * 100)}%
      </text>
    </svg>
  );
}

/**
 * The top of the handler's screen: how many boxes are out, what is holding
 * the rest, and each button the shop handed over with its own progress and a
 * way to press it for everything at once.
 */
function HandlerSummary({ view, groups, busy, filter, onFilter, onPress }: {
  view: CrewLotView;
  groups: ParcelGroup[];
  busy: boolean;
  filter: string;
  onFilter: (filter: string) => void;
  onPress: (ids: string[], key: string, on: boolean) => Promise<void>;
}) {
  const total = groups.length;
  const finished = groups.filter((group) => parcelDone(view, group.items)).length;
  const waiting = view.settings.readyGate ? groups.filter((group) => group.items.some((item) => item.cleared === false)).length : 0;
  const due = view.settings.seesPayment
    ? groups.filter((group) => group.items.some((item) => (item.payment?.outstandingMinor ?? 0) > 0)).length
    : 0;
  const left = total - finished;

  return (
    <section className="hx-sum" aria-labelledby="hx-sum-title">
      <div className="hx-sum__top">
        <Ring value={total ? finished / total : 0} />
        <div className="hx-sum__text">
          <h2 id="hx-sum-title" className="hx-sum__title" aria-live="polite">
            {total === 0 ? 'No customers yet' : left === 0 ? 'Every customer is done' : <>{finished} of {total} customers done</>}
          </h2>
          <p className="hx-sum__line">
            {total === 0 ? 'Customers appear as they order into the lot.'
              : left === 0 ? 'Nothing left to press on this lot.'
                : `${left} still to pack and send`}
            {waiting > 0 && <span className="hx-sum__warn"><Icon name="lock" size={12} /> {waiting} waiting on the shop</span>}
            {due > 0 && <span className="hx-sum__warn"><Icon name="bank" size={12} /> {due} with money due</span>}
          </p>
        </div>
      </div>

      {/* One slim row per button: its name, a meter, the count, and the press for everything. */}
      <ul className="hx-steps" aria-label="Your buttons">
        {view.buttons.map((button) => {
          const count = view.items.filter((item) => item.ticks[button.key]).length;
          const all = count === view.items.length && view.items.length > 0;
          const pressable = view.items.filter((item) => !item.ticks[button.key] && !heldBack(view, item, button));
          const only = filter === `todo:${button.key}`;
          return (
            <li key={button.key} className={`hx-step${all ? ' is-done' : ''}`} title={button.step}>
              <span className="hx-step__label">{shortLabel(button)}</span>
              <span className="hx-meter" role="progressbar" aria-label={`${button.label}: ${count} of ${view.items.length} orders`}
                aria-valuemin={0} aria-valuemax={view.items.length} aria-valuenow={count}>
                <span style={{ width: `${view.items.length ? (count / view.items.length) * 100 : 0}%` }} />
              </span>
              <span className="hx-step__count"><b>{count}</b>/{view.items.length}</span>
              <span className="hx-step__acts">
                {all ? (
                  <span className="hx-step__done" aria-label="All pressed"><Icon name="check" size={14} /></span>
                ) : pressable.length > 0 ? (
                  <button type="button" className="hx-btn hx-btn--solid" disabled={busy}
                    onClick={() => void onPress(pressable.map((item) => item.id), button.key, true)}>
                    All {pressable.length}
                  </button>
                ) : (
                  <span className="hx-step__wait" title="The rest are waiting on the shop" aria-label="The rest are waiting on the shop"><Icon name="lock" size={14} /></span>
                )}
                {!all && (
                  <button type="button" className="hx-btn hx-btn--toggle" aria-pressed={only}
                    aria-label={only ? 'Show every customer' : `Only customers not yet ${button.label}`} title="Only not yet"
                    onClick={() => onFilter(only ? 'all' : `todo:${button.key}`)}>
                    <Icon name="filter" size={14} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The handler's customers: one section each, the customer first, then their orders. */
function HandlerParcels({ view, groups, total, query, busy, me, onClear, onPress, onPhotos }: {
  view: CrewLotView;
  groups: ParcelGroup[];
  total: number;
  query: string;
  busy: Set<string>;
  me: string | undefined;
  onClear: () => void;
  onPress: (ids: string[], key: string, on: boolean) => Promise<void>;
  onPhotos: (id: string, photos: OrderPhoto[]) => void;
}) {
  if (total === 0) {
    return <EmptyState icon={<Icon name="box" size={26} />} title="No customers yet">Each customer who orders into the lot shows up here.</EmptyState>;
  }
  if (groups.length === 0) {
    return (
      <EmptyState icon={<Icon name="search" size={26} />} title={query.trim() ? 'No customer matches' : 'Nothing left to press'}>
        {query.trim() ? `Nobody called “${query.trim()}” in this lot. ` : 'Every customer is pressed for that button. '}
        <button type="button" className="hx-link" onClick={onClear}>Show every customer</button>
      </EmptyState>
    );
  }
  return (
    <section aria-label="Customers">
      <p className="hx-count" aria-live="polite">
        {groups.length === total ? `${total} ${total === 1 ? 'customer' : 'customers'}` : `Showing ${groups.length} of ${total} customers`}
      </p>
      <ul className="hx-parcels">
        {groups.map((group) => (
          <li key={group.id}>
            <HandlerParcel view={view} group={group} busy={busy} me={me} onPress={onPress} onPhotos={onPhotos} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const shortLabel = (button: CrewButtonRef) => shortButtonLabel(button.key, button.label);

/**
 * Whether the shop has let this customer's orders go: all of them, none, or
 * some - a shop can send what is paid and hold the rest. Null once nothing is
 * left to send, or when the lot has no ready gate.
 */
function gateOf(view: CrewLotView, items: CrewItem[]): { tone: 'ok' | 'warn' | 'split'; text: string } | null {
  if (!view.settings.readyGate) return null;
  const open = items.filter((item) => !item.ticks.dispatched);
  if (open.length === 0) return null;
  const go = open.filter((item) => item.cleared).length;
  if (go === open.length) return { tone: 'ok', text: 'Ready to dispatch' };
  if (go === 0) return { tone: 'warn', text: 'Waiting on the shop' };
  return { tone: 'split', text: `${go} of ${open.length} ready` };
}

/**
 * One customer: who it is for and how to reach them, whether the shop has
 * let it go, one button per step that moves every order at once ("Packed all
 * 3"), and then the orders themselves - each on a slim row with its own
 * buttons when there is more than one, and a camera for a photo.
 */
function HandlerParcel({ view, group, busy, me, onPress, onPhotos }: {
  view: CrewLotView;
  group: ParcelGroup;
  busy: Set<string>;
  me: string | undefined;
  onPress: (ids: string[], key: string, on: boolean) => Promise<void>;
  onPhotos: (id: string, photos: OrderPhoto[]) => void;
}) {
  const done = parcelDone(view, group.items);
  const [open, setOpen] = useState(!done);
  const name = group.title ?? 'A customer';
  const id = `hx-${group.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const count = group.items.length;
  const weight = group.items.reduce((sum, item) => sum + item.weightGrams, 0);
  const working = group.items.some((item) => view.buttons.some((button) => busy.has(`${item.id}:${button.key}`)));
  const several = count > 1;
  const gate = gateOf(view, group.items);

  // The first reason a step cannot move this customer, in words rather than
  // a tooltip nobody on a phone will ever see.
  let held: string | null = null;
  for (const button of view.buttons) {
    const pending = group.items.filter((item) => !item.ticks[button.key]);
    if (pending.length > 0 && pending.every((item) => heldBack(view, item, button))) {
      held = heldBack(view, pending[0]!, button);
      break;
    }
  }
  /* The pill in the header already says "Waiting on the shop". */
  if (gate?.tone === 'warn') held = null;
  /* Some orders cleared: say which stay, so the right ones go in the box. */
  const heldItems = group.items.filter((item) => item.cleared === false && !item.ticks.dispatched);
  if (!held && heldItems.length > 0 && heldItems.length < group.items.filter((item) => !item.ticks.dispatched).length) {
    held = `Send only what is ready. Held by the shop: ${heldItems.map((item) => item.itemName).join(', ')}.`;
  }

  return (
    <article className={`hx-parcel${done ? ' is-done' : ''}`} aria-labelledby={`${id}-name`} aria-busy={working} style={hueOf(group.title)}>
      <header className="hx-parcel__head">
        <span className="hx-avatar" aria-hidden="true">{done ? <Icon name="check" size={16} /> : initials(group.title)}</span>
        <div className="hx-parcel__who">
          <span className="hx-parcel__kicker">Customer</span>
          <h3 id={`${id}-name`} className="hx-parcel__name">{name}</h3>
        </div>
        {done
          ? <span className="hx-state is-done"><Icon name="check" size={12} /> Done</span>
          : gate && <span className={`hx-state hx-state--${gate.tone}`}>{gate.text}</span>}
      </header>

      <div className="hx-parcel__info">
        <span>{count} {count === 1 ? 'order' : 'orders'} · {formatWeight(weight)}</span>
        {view.settings.seesPayment && <ParcelMoney items={group.items} />}
      </div>

      <div className="hx-ticks" role="group" aria-label={`Every order for ${name}`}>
        {view.buttons.map((button) => {
          const every = group.items.every((item) => item.ticks[button.key]);
          // Only what can move: a held order's dispatch waits for the shop.
          const targets = group.items.filter((item) => (every ? item.ticks[button.key] : !item.ticks[button.key] && !heldBack(view, item, button)));
          const word = shortLabel(button);
          const pressed = group.items.filter((item) => item.ticks[button.key]).length;
          return (
            <button key={button.key} type="button" className={`hx-tick${every ? ' is-on' : ''}`} aria-pressed={every}
              disabled={busy.size > 0 || targets.length === 0} title={button.label}
              aria-describedby={!every && targets.length === 0 && held ? `${id}-held` : undefined}
              onClick={() => void onPress(targets.map((item) => item.id), button.key, !every)}>
              <span className="hx-tick__box" aria-hidden="true"><Icon name="check" size={13} /></span>
              {/* "all N" unless the shop holds some back: then say how many will go. */}
              <span className="hx-tick__label">
                {!several ? word : !every && targets.length > 0 && targets.length < count - pressed ? `${word} ${targets.length} of ${count}` : `${word} all ${count}`}
              </span>
              {several && pressed > 0 && !every && <span className="hx-tick__count">{pressed}/{count}</span>}
            </button>
          );
        })}
      </div>
      {held && <p id={`${id}-held`} className="hx-held"><Icon name="lock" size={13} /> {held}</p>}

      <div className="hx-orders">
        <button type="button" className="hx-more" aria-expanded={open} aria-controls={open ? `${id}-items` : undefined}
          onClick={() => setOpen(!open)}>
          <span>Orders <span className="hx-more__n">{count}</span></span>
          <Icon name="chevron" size={16} className={`hx-more__chev${open ? ' is-open' : ''}`} />
        </button>

        {open && (
          <ol id={`${id}-items`} className="hx-items">
            {group.items.map((item) => {
              const state = !view.settings.readyGate || item.ticks.dispatched ? null : item.cleared ? 'ok' : 'warn';
              return (
                <li key={item.id} className="hx-item">
                  <Thumb seed={item.id} label={item.itemName} className="thumb hx-item__pic"
                    photo={{ url: item.photos[item.photos.length - 1]?.url ?? item.photoUrl ?? undefined }} />
                  <div className="hx-item__top">
                    <span className="hx-item__name">{item.itemName}</span>
                    {state && <span className={`readychip readychip--${state === 'ok' ? 'ok' : 'held'}`}>{state === 'ok' ? 'Ready' : 'Held'}</span>}
                  </div>
                  <div className="hx-item__meta">
                    <ConditionTag condition={item.condition} />
                    {item.quantity > 1 && <span>×{item.quantity}</span>}
                    <span>{formatWeight(item.weightGrams)}</span>
                    {item.covered && <span className="hx-item__flag">🛡 Insured</span>}
                    {item.toStudio && <span className="hx-item__flag hx-item__flag--pink"><Icon name="spark" size={11} /> To an artist’s studio</span>}
                  </div>
                  <div className="hx-item__acts">
                    {/* A one-order customer already has these above. */}
                    {several && view.buttons.map((button) => {
                      const on = Boolean(item.ticks[button.key]);
                      const reason = heldBack(view, item, button);
                      return (
                        <button key={button.key} type="button" className={`hx-mini${on ? ' is-on' : ''}`} aria-pressed={on}
                          disabled={busy.has(`${item.id}:${button.key}`) || Boolean(reason)} title={reason ?? button.label}
                          aria-label={`${button.label}: ${item.itemName}`}
                          onClick={() => void onPress([item.id], button.key, !on)}>
                          <Icon name="check" size={11} /> {shortLabel(button)}
                        </button>
                      );
                    })}
                    <OrderPhotos orderId={item.id} photos={item.photos} me={me} compact onChange={(photos) => onPhotos(item.id, photos)} />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </article>
  );
}

/** What this customer owes and has paid, where the shop lets the handler see it. */
function ParcelMoney({ items }: { items: CrewItem[] }) {
  const rows = items.flatMap((item) => (item.payment ? [item.payment] : []));
  if (rows.length === 0) return null;
  const currency = rows[0]!.currency;
  const total = rows.reduce((sum, row) => sum + row.totalMinor, 0);
  const outstanding = rows.reduce((sum, row) => sum + row.outstandingMinor, 0);
  return (
    <span className={`hx-chip ${outstanding > 0 ? 'hx-chip--warn' : 'hx-chip--ok'}`}>
      <Icon name="bank" size={13} />
      {outstanding > 0
        ? <>Due <b>{formatMoney(outstanding, currency)}</b> of {formatMoney(total, currency)}</>
        : <>Paid <b>{formatMoney(total, currency)}</b></>}
    </span>
  );
}

/**
 * The lot as tiles: a picture of each piece, its name, and its buttons.
 *
 * What a packing floor works from - find the piece by sight, press, next. The
 * picture is the latest photo the shop shared of this very piece, or the
 * listing's; the camera on each tile adds one without leaving the grid.
 */
function CrewTiles({ view, items, busy, onPress, onPhotos }: {
  view: CrewLotView;
  items: CrewItem[];
  busy: Set<string>;
  onPress: (ids: string[], key: string, on: boolean) => Promise<void>;
  onPhotos: (id: string, photos: OrderPhoto[]) => void;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addPhoto(item: CrewItem, file: File) {
    setUploading(item.id);
    setError(null);
    try {
      onPhotos(item.id, (await api.addOrderPhoto(item.id, await shrink(file))).photos);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That photo did not upload.');
    } finally {
      setUploading(null);
    }
  }

  if (items.length === 0) {
    return view.items.length === 0
      ? <EmptyState title="Nothing in this lot yet">Orders appear here as customers order into the lot.</EmptyState>
      : <EmptyState title="Nothing to show">Every order here is pressed. Tap “Show all” to see them again.</EmptyState>;
  }

  return (
    <>
      {error && <ErrorNotice message={error} />}
      <div className="ctiles">
        {items.map((item) => {
          const picture = item.photos[item.photos.length - 1]?.url ?? item.photoUrl;
          const allDone = view.buttons.length > 0 && view.buttons.every((button) => item.ticks[button.key]);
          return (
            <article key={item.id} className={`ctile${allDone ? ' is-done' : ''}`}>
              <h3 className="ctile__name" title={item.itemName}>{item.itemName}</h3>
              <ConditionTag condition={item.condition} />
              <div className="ctile__pic">
                {picture
                  ? <img src={picture} alt="" loading="lazy" />
                  : <span className="ctile__nopic"><Icon name="box" size={30} /></span>}
                {allDone && <span className="ctile__check" aria-label="Done"><Icon name="check" size={18} /></span>}
                {item.quantity > 1 && <span className="ctile__qty" aria-label={`${item.quantity} of these`}>{item.quantity}</span>}
                {view.settings.readyGate && item.cleared && !item.ticks.dispatched && <span className="ctile__flag">Ready to dispatch</span>}
                <label className={`ctile__cam${uploading === item.id ? ' is-busy' : ''}`} aria-label="Add a photo">
                  <input type="file" accept="image/*" capture="environment" disabled={uploading !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void addPhoto(item, file);
                    }} />
                  <Icon name="camera" size={15} />
                </label>
              </div>
              {view.buttons.map((button) => {
                const on = Boolean(item.ticks[button.key]);
                const held = heldBack(view, item, button);
                return (
                  <button key={button.key} type="button" className={`ctile__btn${on ? ' is-on' : ''}`} aria-pressed={on}
                    disabled={busy.has(`${item.id}:${button.key}`) || Boolean(held)} title={held ?? undefined}
                    onClick={() => void onPress([item.id], button.key, !on)}>
                    {on ? '✓ ' : ''}{button.label}
                  </button>
                );
              })}
            </article>
          );
        })}
      </div>
    </>
  );
}
