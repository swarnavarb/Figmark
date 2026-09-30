import type { ReactNode } from 'react';
import type { Order } from '@shared/models';
import { groupStages, type RouteStep, type StageIcon } from '@shared/routes';
import { formatDateOrdinal, timeAgo } from '../format';
import { ShipmentChip } from './OrderStatus';
import { Ladder, STEP_XP } from './Ladder';
import type { TrackStyle } from './trackStyle';

/** One milestone on the quest skin: a stage of the journey, earned once all of it is done. */
export interface QuestBadge { icon: string; label: string; earned: boolean }

const STAGE_EMOJI: Record<StageIcon, string> = {
  supplier: '🏭', warehouse: '🏬', transit: '✈️', customs: '🛃', delivery: '🏠',
};
const TRIGGER_EMOJI: Record<string, string> = {
  china_received: '🏬', china_packed: '📦', india_received: '🛬',
  ready_to_dispatch: '🏷️', packed: '📦', dispatched: '🚚', delivered: '📬',
};

/**
 * The badges a route awards, read off the route itself.
 *
 * Its named stages when the seller grouped steps into them - "Freight
 * Forwarder", "Domestic" - since those are the chapters the seller already
 * thinks in. A route with no stages gets one badge per step instead, thinned
 * to six so the row still fits a phone.
 */
export function badgesFor(steps: readonly RouteStep[], current: number): QuestBadge[] {
  const groups = groupStages(steps).filter((group) => group.steps[0]!.step.stageId);
  if (groups.length >= 2) {
    return groups.map((group) => ({
      icon: STAGE_EMOJI[group.stageIcon ?? 'warehouse'],
      label: group.stageName,
      earned: group.steps[group.steps.length - 1]!.index <= current,
    }));
  }
  const every = Math.max(1, Math.ceil(steps.length / 6));
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ index }) => index % every === 0 || index === steps.length - 1)
    .map(({ step, index }) => ({
      icon: index === steps.length - 1 ? '🏆' : index === 0 ? '🧾' : TRIGGER_EMOJI[step.trigger ?? ''] ?? '⭐',
      label: step.name,
      earned: index <= current,
    }));
}

/**
 * Where an order has got to, as one card: a headline for the step it is on,
 * a bar for how far along that is, and the steps themselves, dated.
 *
 * The same card for the buyer and the seller - the two are looking at one
 * parcel, and should never read two different journeys.
 */
export function TrackHero({ icon, now, sub, done, total, children, skin = 'classic', badges, next }: {
  icon: string;
  /** The step it is on, in a few words. */
  now: string;
  sub?: ReactNode;
  done: number;
  total: number;
  children?: ReactNode;
  skin?: TrackStyle;
  /** Quest skin only: the milestones along the way. */
  badges?: QuestBadge[];
  /** Quest skin only: the next thing to happen, named as the next quest. */
  next?: ReactNode;
}) {
  const share = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  if (skin === 'quest') {
    const reached = Math.max(0, Math.min(done, total));
    const complete = total > 0 && reached >= total;
    return (
      <div className={`trk trk--quest${complete ? ' is-complete' : ''}`}>
        <div className="qtrk__hud">
          <span className="qtrk__lvl" aria-label={`Level ${reached} of ${total}`}>
            <small>LVL</small>
            <b>{reached}</b>
            <small>/{total}</small>
          </span>
          <span className="trk__now">
            <span className="trk__eyebrow">{complete ? 'Quest complete' : 'Current level'}</span>
            <b className="trk__title"><span aria-hidden="true">{complete ? '🏆' : icon}</span> {now}</b>
            {sub && <span className="trk__sub">{sub}</span>}
          </span>
          <span className="qtrk__xp" title="100 XP for every step reached">
            <span className="qtrk__coin" aria-hidden="true" />
            <b>{reached * STEP_XP}</b>
            <small>XP</small>
          </span>
        </div>

        {/* One segment per step, so the bar counts levels rather than a
            percentage nobody can picture. */}
        <div className="qtrk__segs" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}
          aria-label="How far along it is" style={{ ['--n' as string]: Math.max(1, total) }}>
          {Array.from({ length: Math.max(1, total) }, (_, index) => (
            <span key={index} className={index < reached ? 'is-on' : index === reached ? 'is-here' : ''}
              style={{ ['--i' as string]: index }} />
          ))}
        </div>

        {badges && badges.length > 0 && (
          <div className="qtrk__badges" aria-label="Milestones">
            {badges.map((badge, index) => (
              <span key={`${badge.label}-${index}`} className={`qtrk__badge${badge.earned ? ' is-earned' : ''}`}
                title={`${badge.label}${badge.earned ? ' — unlocked' : ' — locked'}`}
                style={{ ['--i' as string]: index }}>
                <i aria-hidden="true">{badge.earned ? badge.icon : '🔒'}</i>
                <small>{badge.label}</small>
              </span>
            ))}
          </div>
        )}

        {next && !complete && <div className="qtrk__next"><span aria-hidden="true">🎯</span> {next}</div>}
        {children}
      </div>
    );
  }
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

/**
 * The in-hand journey, drawn on the same ladder a lot uses - so an item from
 * the seller's shelf and one crossing in a container read as one kind of
 * thing, with only the steps differing.
 */
export function DirectTrack({ order, skin = 'classic' }: { order: Order; skin?: TrackStyle }) {
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
  const rungs = steps.map((step, position) => ({
    id: step.key, position, name: step.label,
    description: step.done && step.at ? formatDateOrdinal(step.at) : step.key === 'paid' && order.paymentStatus === 'claimed'
      ? 'Payment sent — the seller is checking it.' : '',
  }));

  return (
    <TrackHero icon={here.icon} now={here.label} skin={skin}
      sub={skin === 'quest'
        ? <>🏠 In hand · ships from the seller</>
        : <>🏠 In hand · ships from the seller{next ? <> · next: <b>{next.label}</b></> : null}</>}
      badges={steps.map((step) => ({ icon: step.icon, label: step.label, earned: step.done }))}
      next={next ? <>Next level: <b>{next.label}</b> <span className="qtrk__reward">+{STEP_XP} XP</span></> : null}
      done={done} total={steps.length}>
      {order.shipment && <ShipmentChip shipment={order.shipment} />}
      <div className="trk__ladder">
        <Ladder steps={rungs} current={done - 1} skin={skin} />
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
