import type { ReactNode } from 'react';
import type { Order } from '@shared/models';
import { renderStepText, type RouteStep, type StageIcon } from '@shared/routes';
import { settledHistory } from '@shared/fulfilment';
import { formatDateOrdinal, timeAgo } from '../format';
import { ShipmentChip } from './OrderStatus';
import { Ladder } from './Ladder';
import '../styles/StepActs.css';

const STAGE_EMOJI: Record<StageIcon, string> = {
  supplier: '🏭', warehouse: '🏬', transit: '✈️', customs: '🛃', delivery: '🏠',
};
const TRIGGER_EMOJI: Record<string, string> = {
  china_received: '🏬', china_packed: '📦', india_received: '🛬',
  ready_to_dispatch: '🏷️', packed: '📦', dispatched: '🚚', delivered: '📬',
};

/** A picture for a step, read off its words first - the seller named it - then its button, then its stage. */
export function stepEmoji(step: Pick<RouteStep, 'name' | 'trigger' | 'stageIcon' | 'locked'>, index: number): string {
  const name = step.name.toLowerCase();
  if (index === 0 || /order placed|ordered|booked/.test(name)) return '🧾';
  if (/deliver/.test(name)) return '📬';
  if (/dispatch|courier|out for/.test(name)) return '🚚';
  if (/custom/.test(name)) return '🛃';
  if (/forward/.test(name)) return '🤝';
  if (/pack|box/.test(name)) return '📦';
  if (/air|flight|fly/.test(name)) return '✈️';
  if (/sea|ship|vessel|container/.test(name)) return '🚢';
  if (/land|arriv/.test(name)) return '🛬';
  if (/ready|check/.test(name)) return '🏷️';
  if (/supplier|factory/.test(name)) return '🏭';
  if (/warehouse|\bwh\b|received/.test(name)) return '🏬';
  if (step.trigger) return TRIGGER_EMOJI[step.trigger] ?? '📍';
  if (step.stageIcon) return STAGE_EMOJI[step.stageIcon];
  return '📍';
}

/* Lives in shared now, beside the rule that made it mostly unnecessary; kept
   importable from here for the screens that draw it. */
export { withLastMile } from '@shared/buttons';

/**
 * Where an order has got to, as one card: a headline for the step it is on,
 * a thin bar for how far along that is, and the steps themselves, dated.
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
          <b className="trk__title">{now}</b>
          {sub && <span className="trk__sub">{sub}</span>}
        </span>
        <span className="trk__count" aria-label={`Step ${Math.min(done, total)} of ${total}`}>
          {Math.min(done, total)}<span aria-hidden="true">/{total}</span>
        </span>
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
  /** The seller's button that reaches it, for the two that one reaches. */
  trigger?: 'dispatched' | 'delivered';
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
    { key: 'placed', icon: '🧾', label: order.bookingOnly ? 'Booked' : 'Order placed',
      // Pressing Buy only opens a checkout; it is placed once they choose how to pay.
      at: order.placedAt ?? order.createdAt, done: order.placedAt !== null },
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
      key: 'dispatched', icon: '🚚', label: 'Dispatched', trigger: 'dispatched', at: dispatchedAt, done: Boolean(dispatchedAt) || delivered,
      detail: order.shipment ? <ShipmentChip shipment={order.shipment} /> : undefined,
    },
    {
      key: 'delivered', icon: '📬', label: 'Delivered', trigger: 'delivered',
      at: order.checkpoints?.delivered ?? order.completedAt ?? null, done: delivered,
      detail: order.receivedAt
        ? <span className="faint">Buyer confirmed receipt {timeAgo(order.receivedAt)}.</span>
        : undefined,
    },
  ];
}

/**
 * The in-hand journey, drawn on the same ladder a lot uses - so an item from
 * the seller's shelf and one crossing in a container read as one kind of
 * thing, with only the steps differing.
 */
/** Statuses that end an order's journey for good. */
const ENDED_LABELS: Partial<Record<Order['status'], string>> = {
  cancelled: 'Order cancelled',
  rejected: 'Order turned down',
  refunded: 'Cancelled and refunded',
  payment_reversal_pending: 'Order cancelled · money on its way back',
  cancelled_reversed: 'Cancelled and refunded',
};

/** How an order's timeline ends, when it was called off - or null while it is still travelling. */
export function endedOf(order: Pick<Order, 'status' | 'updatedAt'> & { cancelReason?: string | null }) {
  const label = ENDED_LABELS[order.status];
  return label ? { label, at: order.updatedAt, note: order.cancelReason ?? null } : null;
}

export function DirectTrack({ order, actFor }: {
  order: Order;
  /** The seller's buttons, on the rungs they reach. */
  actFor?: (step: RouteStep, index: number, steps: readonly RouteStep[]) => ReactNode;
}) {
  const steps = directSteps(order);
  const done = steps.filter((step) => step.done).length;
  const current = steps.findIndex((step) => !step.done);
  // Where it actually is: the furthest step reached. A parcel sent out on
  // trust is dispatched even while its payment step is still open, and the
  // open step stays visibly unticked below.
  const furthest = steps.map((step) => step.done).lastIndexOf(true);
  const here = steps[Math.max(0, furthest)]!;
  // An order that ended has no next step, whatever was left unticked.
  const next = endedOf(order) ? null
    : steps.slice(furthest + 1).find((step) => !step.done) ?? (current === -1 ? null : steps[current]!);
  // What the seller said along the way, newest first, so nothing typed is lost.
  const notes = settledHistory(order.stageHistory)
    .filter((event) => event.note && !/^Courier:/.test(event.note))
    .slice(-6)
    .reverse();
  const rungs: RouteStep[] = steps.map((step, position) => ({
    // All the item's own: there is no lot on a shelf sale to carry any of it.
    id: step.key, position, name: step.label, trigger: step.trigger, side: 'pre',
    description: step.done && step.at ? formatDateOrdinal(step.at) : step.key === 'paid' && order.paymentStatus === 'claimed'
      ? 'Payment sent — the seller is checking it.' : '',
  }));

  return (
    <TrackHero icon={endedOf(order) ? '🚫' : here.icon} now={endedOf(order)?.label ?? here.label}
      sub={<>🏠 In hand · ships from the seller{next ? <> · next: <b>{next.label}</b></> : null}</>}
      done={done} total={steps.length}>
      {order.shipment && <ShipmentChip shipment={order.shipment} />}
      <div className="trk__ladder">
        <Ladder steps={rungs} current={done - 1} actFor={actFor} lockFrom={3} ended={endedOf(order)} />
      </div>
      {order.receivedAt && <span className="faint">Buyer confirmed receipt {timeAgo(order.receivedAt)}.</span>}
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
