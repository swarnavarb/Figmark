import type { OrderStatus } from './enums.js';
import type { Order, Review } from './models.js';

/**
 * What may happen to an order, and who may do it.
 *
 * Read by the API and the app alike, so the client never offers a button the
 * server is about to refuse — the same discipline `shared/stores.ts` keeps for
 * store rights. The API checks again regardless; sharing the rule is what stops
 * the two answers being written twice.
 *
 * The money is the reason this exists. A buyer paying a stranger for a crate
 * that has not been packed yet needs the payment held rather than handed over,
 * and the seller needs it to arrive without waiting on goodwill. So the escrow
 * record moves through exactly four transitions and nothing else touches it.
 */

/**
 * Days after dispatch before a held payment releases itself.
 *
 * The clock starts at dispatch rather than at payment: an import can sit in a
 * lot for six weeks before it moves, and a window that opened at checkout would
 * pay the seller for a box still sitting with their supplier. Fourteen days is
 * the domestic leg plus room for a slow courier and a buyer who is away.
 */
export const AUTO_RELEASE_DAYS = 14;

/**
 * Days a blind review stays hidden when only one side has written.
 *
 * Two-sided rating is worthless if the second person can read the first: the
 * honest review gets answered with a retaliatory one. So neither is visible
 * until both are in, and this window stops a review being buried forever by a
 * counterparty who simply never writes theirs.
 */
export const REVIEW_REVEAL_DAYS = 14;

/** Days a seller has to answer a dispute before it needs a human. */
export const DISPUTE_RESPONSE_DAYS = 3;

export type OrderAction =
  | 'pay' | 'settle_claim' | 'confirm' | 'dispute' | 'review' | 'reject' | 'pay_more' | 'refund_credit'
  // Accepting a fresh order or booking, and calling one off once it is.
  | 'accept' | 'cancel'
  // The reversal of a paid, cancelled order, and the dispute at the end of it.
  | 'request_reversal_details' | 'submit_reversal' | 'confirm_reversal_details' | 'ack_reversal' | 'raise_dispute'
  // The buyer answering whether a returned extra payment reached them.
  | 'ack_credit_refund';

/** Protection is only offered where the company has granted the seller it. */
export function protectionFeeMinor(totalMinor: number, feeBasisPoints: number): number {
  return Math.max(0, Math.round((totalMinor * feeBasisPoints) / 10_000));
}

/** How the viewer relates to an order. Nobody else may see one at all. */
export type OrderSide = 'buyer' | 'seller';

export function sideOf(order: Pick<Order, 'buyerId' | 'sellerId'>, viewerId: string): OrderSide | null {
  if (order.buyerId === viewerId) return 'buyer';
  if (order.sellerId === viewerId) return 'seller';
  return null;
}

/**
 * The auto-release deadline is due and nothing is contesting it.
 *
 * Evaluated when an order is read rather than by a timer, because a deadline
 * that only exists inside a scheduler is a deadline that silently stops working
 * when the scheduler does. Reading an order is the moment its state matters, so
 * that is where the clock is checked.
 */
export function autoReleaseDue(order: Pick<Order, 'escrow'>, now = new Date()): boolean {
  const { escrow } = order;
  if (escrow.state !== 'held' || !escrow.autoReleaseAt) return false;
  return new Date(escrow.autoReleaseAt).getTime() <= now.getTime();
}

/**
 * What this viewer may do to this order right now.
 *
 * Order matters to nobody but the reader: these are independent permissions,
 * not a sequence. An empty list means the order is waiting on the other party,
 * on the courier, or on nothing at all.
 */
export function actionsFor(
  order: Pick<
    Order,
    'buyerId' | 'sellerId' | 'status' | 'paymentStatus' | 'escrow' | 'completedAt' | 'protection'
  > & Partial<Pick<Order, 'credits' | 'accepted' | 'paymentClaim' | 'reversal' | 'bookingOnly'>>,
  viewerId: string,
  reviewed = false,
): OrderAction[] {
  const side = sideOf(order, viewerId);
  if (!side) return [];

  const actions: OrderAction[] = [];

  // Only the buyer pays, and only while nothing has been paid. A booking is
  // a pledge, not a payment - it asks for money only once the seller has
  // said yes, per the tagline on the Book option itself.
  const mayPayNow = !order.bookingOnly || order.accepted === true;
  if (side === 'buyer' && mayPayNow && order.paymentStatus === 'unpaid' && order.status === 'pending_payment') {
    actions.push('pay');
  }

  // A claimed payment is waiting on the seller, and on nobody else. The buyer
  // has done everything they can do and gets no button; the seller gets the
  // only one that matters, because whether the money arrived is a fact only
  // their own bank can tell them.
  if (side === 'seller' && order.paymentStatus === 'claimed') actions.push('settle_claim');

  // An advance leaves a balance, and the buyer pays it down in as many goes as
  // they like - always by the method they started with.
  const live = order.status !== 'cancelled' && order.status !== 'refunded' && order.status !== 'rejected';
  if (side === 'buyer' && live && order.paymentStatus === 'partially_paid') actions.push('pay_more');

  // Money paid over the balance is the buyer's, and only the seller holds it.
  if (side === 'seller' && order.credits?.some((credit) => credit.status === 'open' || credit.status === 'held')) {
    actions.push('refund_credit');
  }
  if (side === 'buyer' && order.credits?.some((credit) => credit.status === 'refund_pending')) {
    actions.push('ack_credit_refund');
  }

  // A brand new order or booking is waiting on the seller to say yes before
  // anything else happens to it - nobody has paid, nobody has claimed to, and
  // the seller has not yet said either way.
  const fresh = order.status === 'pending_payment' && order.paymentStatus === 'unpaid'
    && !order.accepted && !order.paymentClaim;
  if (side === 'seller' && fresh) actions.push('accept');

  // The seller cannot serve it. Every order on this marketplace is a promise
  // made before anything moves - the stock may be gone, the supplier may have
  // pulled the line, the lot may not go - so the seller needs a way to say so
  // that is not silence. Only before it is accepted, and never once money is
  // held: after that it is `cancel`, a different button with a different
  // ending, because the buyer was already told yes.
  if (side === 'seller' && fresh && order.escrow.state !== 'held') actions.push('reject');

  // Once accepted or placed, the same X button means something else: the
  // order is being called off after the buyer was told it would happen.
  const acceptedOrPlaced =
    (order.status === 'pending_payment' && order.accepted === true)
    || order.status === 'confirmed' || order.status === 'in_fulfilment' || order.status === 'shipped';
  if (side === 'seller' && acceptedOrPlaced) actions.push('cancel');

  // The reversal of a paid, cancelled order - one step at a time, and only
  // for the two people it concerns.
  if (order.status === 'payment_reversal_pending') {
    if (side === 'seller') {
      actions.push('request_reversal_details', 'submit_reversal');
    } else {
      actions.push('confirm_reversal_details');
    }
  }
  if (order.status === 'cancelled_reversed' && side === 'buyer' && order.reversal
    && order.reversal.buyerResponse === null) {
    actions.push('ack_reversal');
  }
  if (order.status === 'cancelled_reversed' && side === 'buyer' && order.reversal?.buyerResponse === 'not_received'
    && !order.reversal.disputeRaisedAt) {
    actions.push('raise_dispute');
  }

  // Confirming delivery is the buyer's alone: it is the one fact in the whole
  // pipeline that only they can know. The seller ticking "dispatched" is not
  // the same claim, which is why it does not release the money. Unprotected
  // orders confirm too — there is simply no money to let go of.
  const awaitingDelivery =
    order.status === 'shipped' && (order.escrow.state === 'held' || order.escrow.state === 'none');
  if (side === 'buyer' && awaitingDelivery && order.paymentStatus === 'paid') actions.push('confirm');

  // Disputing needs something to dispute over. Without protection the money
  // went straight to the seller and there is nothing for the company to hold,
  // which is exactly what declining protection means — so this is the one place
  // the choice made at checkout actually bites.
  const protectedAndHeld = order.protection != null && order.escrow.state === 'held';
  const disputable = side === 'buyer' ? protectedAndHeld : protectedAndHeld && order.status === 'shipped';
  if (disputable) actions.push('dispute');

  // A review is earned by a completed transaction, never by an opinion.
  if (order.completedAt && !reviewed) actions.push('review');

  return actions;
}

/** A review is revealed once both sides have written, or the window has passed. */
export function reviewRevealed(
  review: Pick<Review, 'revealed' | 'revealAt'>,
  counterpartWrote: boolean,
  now = new Date(),
): boolean {
  if (review.revealed) return true;
  if (counterpartWrote) return true;
  return new Date(review.revealAt).getTime() <= now.getTime();
}

/**
 * A trust score out of 100 from revealed reviews.
 *
 * Ratings are 1-5 and the score is a percentage, so the mean scales by twenty.
 * Null when there is nothing to compute from, which the caller reads as "leave
 * what is there" rather than "zero" — an unrated account is not a bad one.
 */
export function scoreFrom(ratings: readonly number[]): number | null {
  if (ratings.length === 0) return null;
  const mean = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
  return Math.round(mean * 20);
}

/** ISO timestamp `days` from `from`. */
export function daysFrom(days: number, from = new Date()): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

/**
 * An order that came to nothing before it shipped - called off, either way.
 *
 * `rejected` split off `cancelled` so the two could be told apart on screen,
 * but everywhere that used to read "cancelled" to mean "does not count" -
 * stock, revenue, active-order counts - both belong in that same bucket.
 */
export function isCancelledLike(status: OrderStatus): boolean {
  return status === 'cancelled' || status === 'rejected';
}
