import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LOT_PHASE_HINTS } from '@shared/fulfilment';
import { renderStepText, type RouteStep } from '@shared/routes';
import { ApiRequestError, api, type ItemGroup, type OrderTracking } from '../api';
import { MoneyBar } from '../components/Buy';
import { PayChip, PhaseTrack, factsOf, hueOfLot, laneFlags, type BuyerItem } from '../components/BuyerLots';
import { Ladder } from '../components/Ladder';
import { LotPhaseBadge } from '../components/LotName';
import { buyerStatus, ShipmentChip } from '../components/OrderStatus';
import { ErrorNotice, Icon, Thumb } from '../components/ui';
import { formatDate } from '../format';
import { PayMore } from './PurchasesPage';

/**
 * One lot, from inside: everything a buyer in it could want to know, and
 * each of their items' own journey.
 *
 * The box first - its name, where it is on its four stops, who else is in
 * it - then the route it travels, then what of theirs is inside. Each item
 * opens onto its own timeline, because an item can be somewhere its lot is
 * not: received at the warehouse before the lot sails, or sent out on its
 * own once the lot has landed.
 */
export function BuyerLotPage() {
  const { lotId = '' } = useParams();
  const [group, setGroup] = useState<ItemGroup | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = (await api.myItems()).groups.find((row) => row.lot?.id === lotId) ?? null;
      setGroup(found ? { ...found, items: found.items.filter((item) => item.placed) } : null);
      setMissing(!found);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this lot.');
    }
  }, [lotId]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (missing) {
    return (
      <main className="page">
        <Link to="/purchases" className="backlink"><Icon name="back" size={14} /> My Purchases</Link>
        <p className="muted">You have nothing in this lot.</p>
      </main>
    );
  }
  if (!group || !group.lot) return <main className="page"><p className="muted">Opening the box…</p></main>;

  const lot = group.lot;
  const vars = { origin: lot.originCountry, destination: lot.destinationCountry };
  const owing = group.items.some((item) => item.canPayMore);
  const sum = (key: 'totalMinor' | 'paidMinor' | 'outstandingMinor' | 'creditMinor') =>
    group.items.reduce((total, item) => total + item[key], 0);
  const others = Math.max(0, lot.people - 1);
  const now = lot.steps[lot.lotStep];

  return (
    <main className="page blot">
      <Link to="/purchases" className="backlink"><Icon name="back" size={14} /> My Purchases</Link>

      {/* The box, open: the lid tipped back, and the lot's name on its front. */}
      <header className={`blot__hero lotbox--${hueOfLot(lot.id)}`}>
        <span className="blot__lid" aria-hidden="true"><span className="lotbox__tape" /></span>
        <div className="blot__front">
          <h1 className="blot__name">{lot.name}</h1>
          <div className="blot__ids">
            <span className="lotname__no">LOT {lot.number}</span>
            {laneFlags(lot) && <span>{laneFlags(lot)}</span>}
            <span>from {group.sellerHandle
              ? <Link to={`/${group.sellerHandle}`}>{group.sellerName}</Link>
              : group.sellerName}</span>
          </div>
          <LotPhaseBadge phase={lot.phase} />
          <p className="blot__hint">{LOT_PHASE_HINTS[lot.phase]}</p>
          <PhaseTrack phase={lot.phase} size="lg" />
          <div className="blot__facts">
            <span><b>{group.items.length}</b> of yours</span>
            <span>{others === 0 ? 'Just you so far' : <><b>{others}</b> {others === 1 ? 'other buyer' : 'other buyers'}</>}</span>
            {lot.estimatedDispatchAt && <span>Leaves around <b>{formatDate(lot.estimatedDispatchAt)}</b></span>}
            {lot.trackingReference && <span>Tracking <b>{lot.trackingReference}</b></span>}
          </div>
        </div>
      </header>

      <section className="card card--pad stack">
        <div className="row row--between">
          <h2 className="blot__h">The lot's journey</h2>
          <span className="faint">{lot.routeName}</span>
        </div>
        {now && <p className="blot__now">Now: <b>{renderStepText(now.name, vars)}</b></p>}
        <Ladder steps={lot.steps} current={lot.lotStep} vars={vars} />
      </section>

      <section className="stack">
        <h2 className="blot__h">Yours, inside</h2>
        {group.items.map((item) => <InsideItem key={item.id} item={item} steps={lot.steps} vars={vars} />)}
      </section>

      <section className="card card--pad stack">
        <h2 className="blot__h">Money</h2>
        <MoneyBar totalMinor={sum('totalMinor')} paidMinor={sum('paidMinor')}
          outstandingMinor={sum('outstandingMinor')} creditMinor={sum('creditMinor')}
          currency={group.items[0]?.currency} />
        {owing && (
          <button type="button" className="btn btn--lg btn--block" onClick={() => setPaying(true)}>💳 Pay more</button>
        )}
      </section>

      {paying && (
        <PayMore group={group} onClose={() => setPaying(false)}
          onPaid={async () => { setPaying(false); await load(); }} />
      )}
    </main>
  );
}

/**
 * One of the buyer's items in the lot: what it is, its money, where it
 * stands - and, opened, its own timeline with everything the shop said
 * along the way.
 */
function InsideItem({ item, steps, vars }: {
  item: BuyerItem;
  steps: RouteStep[];
  vars: { origin?: string | null; destination?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<OrderTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const line = buyerStatus(factsOf(item));
  const at = item.stepAt ?? 0;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !track) {
      try {
        setTrack(await api.orderTracking(item.id));
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'Could not load its tracking.');
      }
    }
  }

  return (
    <article className={`inside${open ? ' is-open' : ''}`}>
      <div className="inside__main">
        <Thumb seed={item.id} label={item.itemName} photo={item.photo ? { url: item.photo } : null} />
        <span className="inside__body">
          <b>{item.itemName}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</b>
          <span className="inside__status">{line.icon} {line.title}</span>
          <span className="inside__step">Step {at + 1} of {steps.length} · {renderStepText(steps[at]?.name ?? '', vars)}</span>
          <PayChip item={item} />
        </span>
      </div>
      {item.shipment && <ShipmentChip shipment={item.shipment} />}
      <div className="inside__acts">
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={open} onClick={() => void toggle()}>
          {open ? 'Hide its tracking' : 'Track this item'}
        </button>
        {item.canPay && <Link to={`/order/${item.id}`} className="btn btn--sm">Pay now</Link>}
        {item.canConfirm && <Link to={`/order/${item.id}`} className="btn btn--sm">It arrived</Link>}
        <Link to={`/order/${item.id}`} className="inside__link">Open order →</Link>
      </div>
      {open && (
        <div className="inside__track">
          {error && <ErrorNotice message={error} />}
          {!track && !error && <p className="muted">Loading its timeline…</p>}
          {track?.route && (
            <Ladder steps={track.route.steps} current={track.route.currentStep}
              history={track.order.stageHistory} vars={vars} />
          )}
        </div>
      )}
    </article>
  );
}
