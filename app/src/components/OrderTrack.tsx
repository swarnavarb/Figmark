import { useEffect, useRef, type ReactNode } from 'react';
import type { Order } from '@shared/models';
import type { RouteStep, StageIcon } from '@shared/routes';
import { formatDateOrdinal, timeAgo } from '../format';
import { ShipmentChip } from './OrderStatus';
import { Ladder } from './Ladder';

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

/**
 * A route with its last mile on it.
 *
 * Every timeline ends with the two presses that matter most - dispatched to
 * the buyer, delivered - so the seller presses them from the timeline and the
 * buyer watches them unlock there. A route written before that was
 * guaranteed (or one that left them to a plain "Delivered" step) gets them
 * added here, for drawing only; `at` carries the server's position over.
 */
export function withLastMile(steps: readonly RouteStep[]): { steps: RouteStep[]; at: (index: number) => number; added: number } {
  const out = steps.map((step, index) => (index === steps.length - 1 && !step.trigger && /^delivered$/i.test(step.name.trim())
    ? { ...step, trigger: 'delivered' as const }
    : step));
  let insertedAt = -1;
  let added = 0;
  if (!out.some((step) => step.trigger === 'dispatched')) {
    const before = out.findIndex((step) => step.trigger === 'delivered');
    insertedAt = before >= 0 ? before : out.length;
    out.splice(insertedAt, 0, {
      id: 'lastmile_dispatched', name: 'Dispatched to you', description: 'On its way with the courier.',
      position: 0, trigger: 'dispatched', lastMile: true,
    });
    added += 1;
  }
  if (!out.some((step) => step.trigger === 'delivered')) {
    out.push({ id: 'lastmile_delivered', name: 'Delivered', description: 'It reached you.', position: 0, trigger: 'delivered', lastMile: true });
    added += 1;
  }
  return {
    steps: out.map((step, index) => ({ ...step, position: index })),
    at: (index) => (insertedAt >= 0 && index >= insertedAt ? index + 1 : index),
    added,
  };
}

/** One box in the row across the top of a timeline: a step, and whether it has been reached. */
export interface TrackBox { key: string; icon: string; label: string; state: 'done' | 'here' | 'next' | 'locked' }

/**
 * The steps as boxes - "Order placed", "Received at the warehouse", on to
 * "Delivered" - each ticked once reached. Everything past the next one is
 * locked: the journey opens a box at a time as it gets there.
 */
export function boxesFor(steps: readonly Pick<RouteStep, 'id' | 'name' | 'trigger' | 'stageIcon' | 'locked'>[], current: number,
  vars?: { origin?: string | null; destination?: string | null }): TrackBox[] {
  return steps.map((step, index) => ({
    key: `${step.id}-${index}`,
    icon: stepEmoji(step, index),
    label: step.name.replace(/\{(origin|destination)\}/g, (_, key: 'origin' | 'destination') => vars?.[key] ?? key),
    state: index < current ? 'done' : index === current ? 'here' : index === current + 1 ? 'next' : 'locked',
  }));
}

/** The row of boxes itself, slid along to the one it is at. */
export function TrackBoxes({ boxes }: { boxes: TrackBox[] }) {
  const row = useRef<HTMLOListElement>(null);
  const here = boxes.findIndex((box) => box.state === 'here');
  /* Slide the row, not the page, so the box it is at sits in view with the one before it. */
  useEffect(() => {
    const list = row.current;
    const item = list?.children[Math.max(0, here - 1)] as HTMLElement | undefined;
    if (list && item) list.scrollTo({ left: item.offsetLeft, behavior: 'smooth' });
  }, [here]);
  return (
    <ol ref={row} className="trkbox" aria-label="Milestones">
      {boxes.map((box, index) => (
        <li key={box.key} className={`trkbox__item is-${box.state}`} style={{ ['--i' as string]: index }}
          title={`${box.label}${box.state === 'locked' ? ' — unlocks as the journey gets there' : ''}`}>
          <span className="trkbox__icon" aria-hidden="true">{box.state === 'done' || box.state === 'here' ? box.icon : box.state === 'locked' ? '🔒' : box.icon}</span>
          <span className="trkbox__label">{box.label}</span>
          {(box.state === 'done' || box.state === 'here') && <span className="trkbox__tick" aria-label="reached">✓</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Where an order has got to, as one card: a headline for the step it is on,
 * a bar for how far along that is, the milestones as boxes, and the steps
 * themselves, dated.
 *
 * The same card for the buyer and the seller - the two are looking at one
 * parcel, and should never read two different journeys.
 */
export function TrackHero({ icon, now, sub, done, total, boxes, children }: {
  icon: string;
  /** The step it is on, in a few words. */
  now: string;
  sub?: ReactNode;
  done: number;
  total: number;
  boxes?: TrackBox[];
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
      {boxes && boxes.length > 0 && <TrackBoxes boxes={boxes} />}
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
export function DirectTrack({ order, actFor }: {
  order: Order;
  /** The seller's buttons, on the rungs they reach. */
  actFor?: (step: RouteStep, index: number) => ReactNode;
}) {
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
  const rungs: RouteStep[] = steps.map((step, position) => ({
    id: step.key, position, name: step.label, trigger: step.trigger,
    description: step.done && step.at ? formatDateOrdinal(step.at) : step.key === 'paid' && order.paymentStatus === 'claimed'
      ? 'Payment sent — the seller is checking it.' : '',
  }));

  return (
    <TrackHero icon={here.icon} now={here.label}
      sub={<>🏠 In hand · ships from the seller{next ? <> · next: <b>{next.label}</b></> : null}</>}
      boxes={steps.map((step, index) => ({
        key: step.key, icon: step.icon, label: step.label,
        state: step.done ? (index === done - 1 ? 'here' : 'done') : index === done ? 'next' : 'locked',
      }))}
      done={done} total={steps.length}>
      {order.shipment && <ShipmentChip shipment={order.shipment} />}
      <div className="trk__ladder">
        <Ladder steps={rungs} current={done - 1} actFor={actFor} lockFrom={3} />
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
