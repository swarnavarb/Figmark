import { useState } from 'react';
import { Link } from 'react-router-dom';
import { countryFlag } from '@shared/countries';
import { LOT_PHASES, LOT_PHASE_HINTS, LOT_PHASE_LABELS, type LotBuyerPhase } from '@shared/fulfilment';
import type { ItemGroup } from '../api';
import { formatMoney } from '../format';
import { buyerStatus, type StatusFacts } from './OrderStatus';
import { Modal, Thumb } from './ui';

/**
 * The buyer's side of a lot: the same box the seller packs, seen from the
 * other end of its journey.
 *
 * A lot is one shared parcel crossing an ocean, and the waiting is most of
 * what buying into one is. So the screens here are about the box - where it
 * is, who else is in it, what of yours is inside - and keep the money plain
 * and to one line unless something is owed.
 */
export type BuyerItem = ItemGroup['items'][number];

const PHASE_STOP: Record<LotBuyerPhase, { icon: string; short: string }> = {
  filling: { icon: '📥', short: 'Filling' },
  closed: { icon: '📦', short: 'Closed' },
  in_transit: { icon: '🚚', short: 'In transit' },
  received: { icon: '🏁', short: 'Received' },
  cancelled: { icon: '✖', short: 'Called off' },
};

/** The four stops a lot passes, with the box sitting on the one it is at. */
export function PhaseTrack({ phase, size = 'sm' }: { phase: LotBuyerPhase; size?: 'sm' | 'lg' }) {
  const at = LOT_PHASES.indexOf(phase);
  return (
    <ol className={`ptrack ptrack--${size}`} aria-label={`Lot status: ${LOT_PHASE_LABELS[phase]}`}>
      {LOT_PHASES.map((stop, index) => (
        <li key={stop} className={`ptrack__stop${index < at ? ' is-done' : ''}${index === at ? ' is-here' : ''}`}
          aria-current={index === at ? 'step' : undefined}>
          <span className="ptrack__dot" aria-hidden="true">{index === at ? PHASE_STOP[stop].icon : index < at ? '✓' : ''}</span>
          <span className="ptrack__label">{PHASE_STOP[stop].short}</span>
        </li>
      ))}
    </ol>
  );
}

/** The money on one item, said in the fewest words: paid, booked, or what is due. */
export function PayChip({ item }: { item: BuyerItem }) {
  if (item.outstandingMinor > 0 && item.paidMinor === 0 && item.bookingOnly) {
    return <span className="paychip paychip--info">🔖 Booked · {formatMoney(item.outstandingMinor, item.currency)} to pay</span>;
  }
  if (item.outstandingMinor > 0) {
    return <span className="paychip paychip--due">💳 {formatMoney(item.outstandingMinor, item.currency)} due</span>;
  }
  if (item.paymentHeld) return <span className="paychip paychip--ok">🛡️ Paid · protected</span>;
  return <span className="paychip paychip--ok">✓ Paid</span>;
}

/** The facts the status line is read from, off one purchase. */
export function factsOf(item: BuyerItem): StatusFacts {
  return {
    placed: item.placed,
    status: item.status,
    paymentStatus: item.paymentStatus,
    bookingOnly: item.bookingOnly,
    accepted: item.accepted,
    canPay: item.canPay,
    claimDenied: item.claimDenied,
    outstandingMinor: item.outstandingMinor,
    currency: item.currency,
    dispatched: item.status === 'shipped' || Boolean(item.checkpoints.dispatched),
    shipment: item.shipment,
    receivedAt: item.receivedAt,
    inHand: item.inHand,
    disputed: item.disputed,
  };
}

function due(items: readonly BuyerItem[]): number {
  return items.reduce((sum, item) => sum + item.outstandingMinor, 0);
}

/** A lot as a lane of two flags, or nothing when the shop never said. */
export function laneFlags(lot: NonNullable<ItemGroup['lot']>): string | null {
  if (!lot.originCountry && !lot.destinationCountry) return null;
  return `${countryFlag(lot.originCountry) || '?'} → ${countryFlag(lot.destinationCountry) || '?'}`;
}

const HUES = ['violet', 'coral', 'aqua', 'blue', 'pink', 'lime'] as const;
export function hueOfLot(id: string) {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return HUES[sum % HUES.length]!;
}

/** How long the lid takes to swing open before what is inside is shown. */
const LID_OPEN_MS = 460;

/**
 * One lot the buyer has something in, as a box: their items peeking over the
 * rim, the lot's name, where it is, and - only when something is owed - the
 * money. Tapping it swings the lid open and shows what is inside.
 */
export function BuyerLotBox({ group, onOpen }: { group: ItemGroup; onOpen: () => void }) {
  const lot = group.lot!;
  const [opening, setOpening] = useState(false);
  const owed = due(group.items);
  const lane = laneFlags(lot);
  const others = Math.max(0, lot.people - 1);

  function open() {
    if (opening) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onOpen(); return; }
    setOpening(true);
    window.setTimeout(() => { setOpening(false); onOpen(); }, LID_OPEN_MS);
  }

  return (
    <article role="button" tabIndex={0} aria-label={`Look inside ${lot.name}`}
      className={`lotbox lotbox--buyer lotbox--${hueOfLot(lot.id)}${opening ? ' is-opening' : ''}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      }}>
      {/* What of theirs is inside, peeking over the rim. */}
      <span className="lotbox__peek" aria-hidden="true">
        {group.items.slice(0, 3).map((item) => (
          <Thumb key={item.id} seed={item.id} label={item.itemName}
            photo={item.photo ? { url: item.photo } : null} className="lotbox__peekitem" />
        ))}
      </span>
      <span className="lotbox__glow" aria-hidden="true" />
      <span className="lotbox__lid" aria-hidden="true"><span className="lotbox__tape" /></span>
      <div className="lotbox__body">
        <span className="lotbox__name">{lot.name}</span>
        <span className="lotbox__meta">
          <span className="lotname__no">LOT {lot.number}</span>
          {lane && <span className="lotbox__lane">{lane}</span>}
        </span>
        <span className="lotbox__store">from {group.sellerName}</span>
        <PhaseTrack phase={lot.phase} />
        <span className="lotbox__count">
          {group.items.length === 1 ? '1 of yours' : `${group.items.length} of yours`}
          {others > 0 ? ` · ${others} ${others === 1 ? 'other' : 'others'} in it` : ''}
        </span>
        {owed > 0 && <span className="paychip paychip--due">💳 {formatMoney(owed, group.items[0]?.currency)} due</span>}
      </div>
    </article>
  );
}

/**
 * What is inside, without leaving the list: each of the buyer's items with
 * its money and where it stands, and the way into the whole lot.
 */
export function LotPeek({ group, onClose, onPayMore }: {
  group: ItemGroup;
  onClose: () => void;
  onPayMore?: () => void;
}) {
  const lot = group.lot!;
  const owing = group.items.some((item) => item.canPayMore);
  return (
    <Modal title={`📦 ${lot.name}`} onClose={onClose}>
      <div className="stack peek">
        <div className="peek__head">
          <span className="lotname__no">LOT {lot.number}</span>
          <span className="faint">from {group.sellerName}{laneFlags(lot) ? ` · ${laneFlags(lot)}` : ''}</span>
        </div>
        <PhaseTrack phase={lot.phase} />
        <p className="peek__hint">{LOT_PHASE_HINTS[lot.phase]}</p>

        <span className="peek__title">Inside, yours</span>
        <ul className="peek__items">
          {group.items.map((item) => {
            const line = buyerStatus(factsOf(item));
            return (
              <li key={item.id} className="peek__item">
                <Thumb seed={item.id} label={item.itemName} photo={item.photo ? { url: item.photo } : null} />
                <span className="peek__body">
                  <b>{item.itemName}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</b>
                  <span className="peek__status">{line.icon} {line.title}</span>
                  <PayChip item={item} />
                </span>
                {item.canPay
                  ? <Link to={`/order/${item.id}`} className="btn btn--sm">Pay</Link>
                  : <Link to={`/order/${item.id}`} className="peek__go" aria-label={`Open ${item.itemName}`}>›</Link>}
              </li>
            );
          })}
        </ul>

        <Link to={`/purchases/lot/${encodeURIComponent(lot.id)}`} className="btn btn--lg btn--block">
          Open the lot →
        </Link>
        {owing && onPayMore && (
          <button type="button" className="btn btn--ghost btn--block" onClick={onPayMore}>💳 Pay more</button>
        )}
      </div>
    </Modal>
  );
}

/** One item outside any box: on a shelf, or waiting for a lot to be opened. */
export function ItemRow({ item, note }: { item: BuyerItem; note?: string }) {
  const line = buyerStatus(factsOf(item));
  return (
    <Link to={`/order/${item.id}`} className={`irow irow--${line.tone}`}>
      <Thumb seed={item.id} label={item.itemName} photo={item.photo ? { url: item.photo } : null} />
      <span className="irow__body">
        <b>{item.itemName}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</b>
        <span className="irow__status">{line.icon} {line.title}</span>
        {note && <span className="irow__note">{note}</span>}
        <PayChip item={item} />
      </span>
      <span className="irow__go" aria-hidden="true">›</span>
    </Link>
  );
}

/**
 * An in-hand item's own little journey - it never rides a lot, so it gets
 * three stops of its own instead of a box.
 */
export function ShelfTrack({ item }: { item: BuyerItem }) {
  const stops = [
    { key: 'ready', label: 'Packing', done: true },
    { key: 'sent', label: 'Sent', done: item.status === 'shipped' || Boolean(item.checkpoints.dispatched) || item.status === 'delivered' },
    { key: 'here', label: 'With you', done: item.status === 'delivered' },
  ];
  const at = stops.map((stop) => stop.done).lastIndexOf(true);
  return (
    <ol className="ptrack ptrack--sm ptrack--shelf" aria-label="Where it is">
      {stops.map((stop, index) => (
        <li key={stop.key} className={`ptrack__stop${index < at ? ' is-done' : ''}${index === at ? ' is-here' : ''}`}>
          <span className="ptrack__dot" aria-hidden="true">{index === at ? ['🏠', '🚚', '🎁'][index] : index < at ? '✓' : ''}</span>
          <span className="ptrack__label">{stop.label}</span>
        </li>
      ))}
    </ol>
  );
}
