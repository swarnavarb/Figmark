import {
  BUYER_DISPUTE_REASONS,
  SELLER_DISPUTE_REASONS,
  type DisputeOutcome,
  type DisputeReason,
} from './enums.js';
import type { Dispute, Order } from './models.js';
import { sideOf, type OrderSide } from './orders.js';

/**
 * How a contested order gets settled.
 *
 * Three things shape all of it.
 *
 * Either side can open one. A seller has grievances too — a buyer who will not
 * confirm delivery of a parcel the courier says it delivered has the seller's
 * money and their silence, and "wait for the clock" is not an answer.
 *
 * Most disputes are not contested. The seller often knows the corner was
 * crushed and would rather refund half than argue about it, so an offer the
 * other side accepts in one tap settles it without the company hearing about
 * it at all. That is the outcome to design for.
 *
 * The company decides last, not first. A missed deadline escalates a dispute to
 * mediation; it never decides one. Auto-refunding on silence would be farmable
 * by anyone patient enough to say nothing.
 */

/** Days the other side has to answer before either party may escalate. */
export const RESPONSE_DAYS = 3;

/** The reasons each side may give. A seller cannot claim a parcel never arrived. */
export function reasonsFor(side: OrderSide): readonly DisputeReason[] {
  return side === 'buyer' ? BUYER_DISPUTE_REASONS : SELLER_DISPUTE_REASONS;
}

export type DisputeAction = 'reply' | 'offer' | 'accept' | 'withdraw' | 'escalate';

/** Whether this dispute has run out of patience with whoever owes a reply. */
export function responseOverdue(dispute: Pick<Dispute, 'respondByAt' | 'status'>, now = new Date()): boolean {
  if (dispute.status !== 'awaiting_response' || !dispute.respondByAt) return false;
  return new Date(dispute.respondByAt).getTime() <= now.getTime();
}

/**
 * What this person may do to this dispute now.
 *
 * The company is not in this list: mediation is a separate surface with a
 * separate route, so nothing here can be reached by an ordinary session that
 * happens to know a dispute id.
 */
export function disputeActionsFor(
  dispute: Pick<Dispute, 'status' | 'raisedBy' | 'offer' | 'respondByAt'>,
  order: Pick<Order, 'buyerId' | 'sellerId'>,
  viewerId: string,
  now = new Date(),
): DisputeAction[] {
  const side = sideOf(order, viewerId);
  if (!side) return [];
  if (dispute.status === 'resolved' || dispute.status === 'withdrawn') return [];

  const actions: DisputeAction[] = ['reply'];

  // An offer on the table is the other side's to accept, never your own — a
  // proposal you can accept yourself is just a decision.
  if (dispute.offer && dispute.offer.fromUserId !== viewerId) actions.push('accept');

  // Under mediation the company holds the pen. The thread stays open, because
  // the mediator is reading it and both parties may still be asked things.
  if (dispute.status !== 'under_mediation') {
    actions.push('offer');
    if (dispute.raisedBy === viewerId) actions.push('withdraw');
    // Escalating is open once the other side has had their days, and to the
    // person waiting rather than the person stalling.
    if (responseOverdue(dispute, now) || dispute.status === 'in_discussion') actions.push('escalate');
  }

  return actions;
}

/**
 * Split a held amount according to an outcome.
 *
 * One function so the buyer's screen, the seller's screen and the mediation
 * console cannot each arrive at a different number for the same decision.
 */
export function splitFor(
  outcome: DisputeOutcome,
  heldMinor: number,
  refundMinor: number,
): { toBuyerMinor: number; toSellerMinor: number } {
  switch (outcome) {
    case 'refund_buyer':
      return { toBuyerMinor: heldMinor, toSellerMinor: 0 };
    case 'release_seller':
    case 'withdrawn':
      return { toBuyerMinor: 0, toSellerMinor: heldMinor };
    case 'split': {
      const toBuyer = Math.max(0, Math.min(heldMinor, Math.round(refundMinor)));
      return { toBuyerMinor: toBuyer, toSellerMinor: heldMinor - toBuyer };
    }
  }
}

/**
 * Who, if anyone, lost.
 *
 * Only a wholly one-sided outcome counts against a record. A split is the
 * system working, and marking both parties down for reaching a sensible
 * compromise would teach everyone to refuse one.
 */
export function loserOf(
  outcome: DisputeOutcome,
  order: Pick<Order, 'buyerId' | 'sellerId'>,
): string | null {
  if (outcome === 'refund_buyer') return order.sellerId;
  if (outcome === 'release_seller') return order.buyerId;
  return null;
}

/** The protection fee is handed back only when the seller was wholly at fault. */
export function feeRefunded(outcome: DisputeOutcome): boolean {
  return outcome === 'refund_buyer';
}
