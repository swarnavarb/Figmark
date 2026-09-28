import type { ReactNode } from 'react';
import type { Order } from '@shared/models';
import { formatDateOrdinal, timeAgo } from '../format';
import { ShipmentChip } from './OrderStatus';

/**
 * Where an order has got to, as one card: a headline for the step it is on,
 * a bar for how far along that is, and the steps themselves, dated.
 *
 * The same card for the buyer and the seller - the two are looking at one
 * parcel, and should never read two different journeys.
 */
export function TrackHero({ icon, now, sub, done, total, children }: {
  icon: string;
  /** The step it is on, in a few words. */
  now: string;
  sub?: ReactNode;
  done: number;
  total: number;
  children?: ReactNode;
}) {
  const share = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  return (
    <div className="trk">
      <div className="trk__hero">
        <span className="trk__icon" aria-hidden="true">{icon}</span>
        <span className="trk__now">
          <span className="trk__eyebrow">Where it is now</span>
          <b className="trk__title">{now}</b>
          {sub && <span className="trk__sub">{sub}</span>}
        </span>
        <span className="trk__pct">{share}%</span>
      </div>
      <div className="trk__bar" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}
        aria-label="How far along it is">
        <span style={{ width: `${share}%` }} />
      </div>
      {children}
    </div>
  );
}

interface Step {
  key: string;
  icon: string;
  label: string;
  at: string | null;
  done: boolean;
  detail?: ReactNode;
}

/**
 * The steps an in-hand item goes through: no lot, no warehouse, just the
 * seller's shelf and a courier. Read off the order's own facts, so every
 * tick the seller makes shows up here the moment it is made.
 */
function directSteps(order: Order): Step[] {
  const paidAt = [...(order.payments ?? [])].reverse().find((payment) => payment.kind !== 'refund')?.at ?? null;
  const paid = order.paymentStatus === 'paid' || order.paymentStatus === 'partially_paid';
  const dispatchedAt = order.checkpoints?.dispatched ?? null;
  const delivered = order.status === 'delivered';
  return [
    { key: 'placed', icon: '🧾', label: order.bookingOnly ? 'Booked' : 'Order placed', at: order.placedAt ?? order.createdAt, done: true },
    {
      key: 'accepted', icon: '🤝', label: 'Seller accepted',
      at: order.acceptedAt ?? null, done: Boolean(order.accepted) || paid,
    },
    {
      key: 'paid', icon: '💳', label: order.paymentStatus === 'partially_paid' ? 'Advance paid' : 'Paid',
      at: paidAt, done: paid,
      detail: order.paymentStatus === 'claimed' ? <span className="faint">Payment sent — the seller is checking it.</span> : undefined,
    },
    {
      key: 'dispatched', icon: '📦', label: 'Dispatched', at: dispatchedAt, done: Boolean(dispatchedAt) || delivered,
      detail: order.shipment ? <ShipmentChip shipment={order.shipment} /> : undefined,
    },
    {
      key: 'delivered', icon: '📬', label: 'Delivered',
      at: order.checkpoints?.delivered ?? order.completedAt ?? null, done: delivered,
      detail: order.receivedAt
        ? <span className="faint">Buyer confirmed receipt {timeAgo(order.receivedAt)}.</span>
        : undefined,
    },
  ];
}

/** The in-hand journey, as the hero and a dated vertical timeline. */
export function DirectTrack({ order }: { order: Order }) {
  const steps = directSteps(order);
  const done = steps.filter((step) => step.done).length;
  const current = steps.findIndex((step) => !step.done);
  const here = current === -1 ? steps[steps.length - 1]! : steps[Math.max(0, current - 1)]!;
  const next = current === -1 ? null : steps[current]!;
  // What the seller said along the way, newest first, so nothing typed is lost.
  const notes = order.stageHistory
    .filter((event) => event.note && !/^Courier:/.test(event.note))
    .slice(-6)
    .reverse();

  return (
    <TrackHero icon={here.icon} now={here.label}
      sub={<>🏠 In hand · ships from the seller{next ? <> · next: <b>{next.label}</b></> : null}</>}
      done={done} total={steps.length}>
      <ol className="trk__steps">
        {steps.map((step, index) => (
          <li key={step.key}
            className={`trk__step${step.done ? ' is-done' : ''}${index === current ? ' is-next' : ''}`}>
            <span className="trk__dot" aria-hidden="true">{step.done ? '✓' : step.icon}</span>
            <span className="trk__body">
              <span className="trk__label">{step.label}</span>
              {step.at && step.done && <span className="trk__at">{formatDateOrdinal(step.at)}</span>}
              {step.detail}
            </span>
          </li>
        ))}
      </ol>
      {notes.length > 0 && (
        <div className="trk__notes">
          <span className="trk__eyebrow">Updates</span>
          {notes.map((event, index) => (
            <p key={`${event.enteredAt}-${index}`} className="trk__note">
              <span>{event.note}</span>
              <span className="faint">{timeAgo(event.enteredAt)}</span>
            </p>
          ))}
        </div>
      )}
    </TrackHero>
  );
}
