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

export type OrderAction = 'pay' | 'confirm' | 'dispute' | 'review';

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
  >,
  viewerId: string,
  reviewed = false,
): OrderAction[] {
  const side = sideOf(order, viewerId);
  if (!side) return [];

  const actions: OrderAction[] = [];

  // Only the buyer pays, and only while nothing has been paid.
  if (side === 'buyer' && order.paymentStatus === 'unpaid' && order.status === 'pending_payment') {
    actions.push('pay');
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
