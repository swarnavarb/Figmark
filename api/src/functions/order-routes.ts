import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { REVIEW_DIRECTIONS } from '../../../shared/enums.js';
import type { Dispute, Order, Review, User } from '../../../shared/models.js';
import {
  AUTO_RELEASE_DAYS,
  DISPUTE_RESPONSE_DAYS,
  REVIEW_REVEAL_DAYS,
  actionsFor,
  autoReleaseDue,
  protectionFeeMinor,
  daysFrom,
  reviewRevealed,
  scoreFrom,
  sideOf,
} from '../../../shared/orders.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * What happens to an order after it is placed.
 *
 * Until now an order was created `pending_payment` and nothing could ever move
 * it: the buyer's half of the marketplace stopped at "ordered". This is the
 * rest of it — money held, delivery confirmed, money released, both sides rated.
 *
 * The payment itself is simulated. There is no provider wired up, and pretending
 * otherwise would be worse than saying so: `pay` records a hold exactly as a
 * real one would, and every response carries `simulatedPayment` so no screen can
 * quietly imply a card was charged. Swapping in a provider is a change to this
 * one function.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** The order, or the refusal to show it. Nobody but the two parties may look. */
async function ownOrder(
  request: HttpRequest,
  repository: Repo,
  viewerId: string,
): Promise<{ order: Order } | { refusal: ReturnType<typeof error> }> {
  const id = request.params.id;
  if (!id) return { refusal: error(400, 'invalid_request', 'An order id is required.') };

  const order = await repository.getOrder(id);
  if (!order) return { refusal: error(404, 'not_found', 'No such order.') };
  if (!sideOf(order, viewerId)) {
    return { refusal: error(403, 'forbidden', 'That order is not yours.') };
  }
  return { order };
}

/** Appends a stage event, so the buyer's timeline records what happened and when. */
function note(order: Order, text: string, by: string): void {
  order.stageHistory = [
    ...order.stageHistory,
    { stage: order.stage, enteredAt: new Date().toISOString(), note: text, recordedBy: by },
  ];
}

/**
 * Releases a held payment, and completes the order.
 *
 * One function for both ways it can happen — the buyer confirming, and the
 * deadline passing — because the resulting state has to be identical. Two code
 * paths writing the same five fields is how they drift.
 */
async function release(order: Order, reason: string, by: string, repository: Repo): Promise<Order> {
  const now = new Date().toISOString();
  order.escrow = { ...order.escrow, state: 'released', releasedAt: now };
  order.status = 'delivered';
  order.stage = 'delivered';
  order.completedAt = now;
  order.updatedAt = now;
  note(order, reason, by);

  // A completed transaction is the only thing that counts toward trust, on both
  // sides. Ratings adjust the score later; this is the count behind it.
  for (const id of [order.buyerId, order.sellerId]) {
    const person = await repository.getUserById(id);
    if (!person) continue;
    const signals = id === order.buyerId ? person.buyerTrust : person.sellerTrust;
    signals.completedTransactions += 1;
    person.updatedAt = now;
    await repository.updateUser(person);
  }

  return repository.updateOrder(order);
}

/**
 * Settles anything the clock has decided since this order was last touched.
 *
 * Called on every read, because a deadline that only exists inside a scheduled
 * job stops working the moment the job does — and there is no job here. The
 * read is when the state matters, so the read is where it is settled.
 */
async function settle(order: Order, repository: Repo): Promise<Order> {
  if (!autoReleaseDue(order)) return order;
  return release(order, `Payment released automatically after ${AUTO_RELEASE_DAYS} days.`, 'system', repository);
}

/**
 * POST /api/orders/{id}/pay - the buyer pays, with or without protection.
 *
 * Protection is what creates the escrow. Bought, the money is held and the
 * company will settle a dispute over it; declined, it goes to the seller and
 * the buyer is on their own with them. That is a real choice with a real cost
 * either way, so the checkout states both halves rather than defaulting the
 * buyer into one quietly.
 *
 * It is only on the table where the company has granted the seller it, which is
 * the point of the grant: the marketplace is agreeing to arbitrate for that
 * seller, and it does not agree to that for everyone.
 */
async function pay(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  let body: { protection?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Paying without a body is paying without protection. Explicit is better,
    // but a missing body must not become an accidental purchase of it.
    body = {};
  }

  if (!actionsFor(order, user.id).includes('pay')) {
    return error(409, 'not_payable', 'This order is not waiting for payment.');
  }

  const seller = await repository.getUserById(order.sellerId);
  const rights = seller?.escrowRights ?? null;
  if (body.protection && !rights) {
    return error(409, 'protection_unavailable', 'This seller is not set up for buyer protection.');
  }

  const now = new Date().toISOString();
  const totalMinor = order.unitPriceMinor * order.quantity;

  order.paymentStatus = 'paid';
  order.status = 'confirmed';
  order.updatedAt = now;

  if (body.protection && rights) {
    order.protection = {
      // The rate is copied onto the order, not looked up later: the fee is a
      // term of this transaction and must not move when the grant is changed.
      feeBasisPoints: rights.feeBasisPoints,
      feeMinor: protectionFeeMinor(totalMinor, rights.feeBasisPoints),
      boughtAt: now,
      refundedAt: null,
    };
    order.escrow = {
      ...order.escrow,
      state: 'held',
      amountMinor: totalMinor,
      heldAt: now,
      // Deliberately not set yet. The clock starts at dispatch, because an
      // import can sit in a lot for weeks and a window opened at checkout would
      // pay the seller for a box still with their supplier.
      autoReleaseAt: null,
    };
    note(order, `Paid with buyer protection. ${totalMinor} held.`, user.id);
  } else {
    order.protection = null;
    order.escrow = { ...order.escrow, state: 'none', heldAt: null, autoReleaseAt: null };
    note(order, 'Paid directly to the seller, without protection.', user.id);
  }

  return json(200, {
    order: await repository.updateOrder(order),
    simulatedPayment: true,
  });
}

/**
 * GET /api/orders/{id}/checkout - what paying for this would cost, and buy.
 *
 * Read before paying so the buyer is choosing between two stated outcomes
 * rather than agreeing to a line item. Protection is absent, not zero, when the
 * seller has not been granted it: an option priced at nothing still reads as an
 * option.
 */
async function checkout(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  const seller = await repository.getUserById(order.sellerId);
  const rights = seller?.escrowRights ?? null;
  const totalMinor = order.unitPriceMinor * order.quantity;

  return json(200, {
    itemMinor: totalMinor,
    currency: order.currency,
    protection: rights
      ? {
          available: true,
          feeMinor: protectionFeeMinor(totalMinor, rights.feeBasisPoints),
          feeBasisPoints: rights.feeBasisPoints,
        }
      : { available: false, feeMinor: 0, feeBasisPoints: 0 },
    sellerName: seller?.sellerProfile?.storefrontName ?? seller?.displayName ?? 'the seller',
  });
}

/**
 * POST /api/orders/{id}/confirm - the buyer says it arrived.
 *
 * The one fact in the pipeline only the buyer holds. The seller ticking
 * "dispatched" says the box left; it does not say it landed, which is why that
 * tick does not release the money.
 */
async function confirm(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('confirm')) {
    return error(409, 'not_confirmable', 'This order is not waiting on delivery.');
  }

  return json(200, { order: await release(order, 'Delivery confirmed by the buyer.', user.id, repository) });
}

/**
 * POST /api/orders/{id}/review - rate the other party.
 *
 * Blind: neither review is visible until both are written or the window passes.
 * A rating the counterparty can read before writing their own is a rating they
 * can answer, and retaliation is what makes two-sided feedback worthless.
 */
async function review(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  let body: { rating?: number; body?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return error(400, 'invalid_review', 'A rating is a whole number from 1 to 5.');
  }
  const text = (body.body ?? '').trim();
  if (text.length > 2000) return error(400, 'invalid_review', 'Keep a review under 2000 characters.');

  if (!order.completedAt) {
    return error(409, 'not_reviewable', 'Reviews open once the order is complete.');
  }

  const side = sideOf(order, user.id)!;
  const existing = await repository.listReviewsForOrder(order.id);
  if (existing.some((entry) => entry.authorId === user.id)) {
    return error(409, 'already_reviewed', 'You have already reviewed this order.');
  }

  const now = new Date().toISOString();
  const written: Review = {
    id: `rev_${randomUUID().slice(0, 12)}`,
    subjectId: side === 'buyer' ? order.sellerId : order.buyerId,
    authorId: user.id,
    orderId: order.id,
    direction: side === 'buyer' ? REVIEW_DIRECTIONS[0] : REVIEW_DIRECTIONS[1],
    rating,
    body: text,
    // The counterparty's review, if it exists, is what reveals both.
    revealed: existing.length > 0,
    revealAt: daysFrom(REVIEW_REVEAL_DAYS),
    createdAt: now,
    updatedAt: now,
  };
  await repository.createReview(written);

  // Writing the second one opens the first, which is the whole mechanism.
  for (const other of existing) {
    if (other.revealed) continue;
    other.revealed = true;
    other.updatedAt = now;
    await repository.updateReview(other);
    await rescore(other.subjectId, repository);
  }
  if (written.revealed) await rescore(written.subjectId, repository);

  return json(201, { review: written });
}

/**
 * Recomputes one person's trust score from the reviews now visible about them.
 *
 * Only revealed ratings count, so a score cannot move before the review behind
 * it can be read. An account with none keeps whatever it had rather than
 * dropping to zero: unrated is not the same as badly rated.
 */
async function rescore(subjectId: string, repository: Repo): Promise<void> {
  const person = await repository.getUserById(subjectId);
  if (!person) return;

  const reviews = await repository.listReviewsAbout(subjectId);
  for (const direction of ['buyer_to_seller', 'seller_to_buyer'] as const) {
    const ratings = reviews.filter((r) => r.revealed && r.direction === direction).map((r) => r.rating);
    const score = scoreFrom(ratings);
    if (score === null) continue;
    // A review of a seller scores their seller side; of a buyer, their buyer side.
    const signals = direction === 'buyer_to_seller' ? person.sellerTrust : person.buyerTrust;
    signals.score = score;
    signals.computedAt = new Date().toISOString();
  }
  person.updatedAt = new Date().toISOString();
  await repository.updateUser(person);
}

/**
 * GET /api/orders/{id}/state - everything the order screen needs to decide.
 *
 * Separate from the tracking view because it answers a different question: not
 * "where is my parcel" but "what can I do about it". Settles the clock first, so
 * what comes back is current rather than merely stored.
 */
async function orderState(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = await settle(found.order, repository);

  const reviews = await repository.listReviewsForOrder(order.id);
  const mine = reviews.find((entry) => entry.authorId === user.id) ?? null;
  const theirs = reviews.find((entry) => entry.authorId !== user.id) ?? null;

  // The other party, named. This screen reads the same for both sides, so
  // "from Arjun Collects" on Arjun's own sale is the kind of thing that only
  // shows up once somebody looks at their own order.
  const side = sideOf(order, user.id);
  const otherId = side === 'buyer' ? order.sellerId : order.buyerId;
  const [other] = await repository.listUsersByIds([otherId]);

  return json(200, {
    order,
    side,
    counterpartyName:
      side === 'buyer'
        ? (other?.sellerProfile?.storefrontName ?? other?.displayName ?? 'the seller')
        : (other?.displayName ?? 'the buyer'),
    actions: actionsFor(order, user.id, mine !== null),
    simulatedPayment: true,
    myReview: mine,
    // Only if it may be seen: an unrevealed review is exactly what this whole
    // mechanism exists to keep out of the counterparty's hands.
    theirReview: theirs && reviewRevealed(theirs, mine !== null) ? theirs : null,
    theirReviewPending: theirs !== null && !(theirs && reviewRevealed(theirs, mine !== null)),
    dispute: order.escrow.disputeId
      ? await repository.getDispute(order.id, order.escrow.disputeId)
      : null,
  });
}

/**
 * GET /api/users/{id}/reviews - what is publicly said about someone.
 *
 * Revealed rows only, so a profile never has to re-derive a rule it should not
 * have been handed the rows for.
 *
 * The averages are split by direction because being a good seller and being a
 * good buyer are different claims: one account is both, `buyerTrust` and
 * `sellerTrust` are separate fields for exactly that reason, and blending them
 * would let a prompt-paying buyer carry a shop that never posts anything.
 */
async function reviewsAbout(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A user id is required.');

  const all = await repository.listReviewsAbout(id);
  const visible = all.filter((entry) => reviewRevealed(entry, false));
  const authors = await repository.listUsersByIds([...new Set(visible.map((entry) => entry.authorId))]);
  const nameOf = new Map(authors.map((author: User) => [author.id, author.displayName]));

  const inDirection = (direction: string) => {
    const ratings = visible.filter((entry) => entry.direction === direction).map((entry) => entry.rating);
    return { average: scoreFrom(ratings), count: ratings.length };
  };

  return json(200, {
    reviews: visible.map((entry) => ({
      id: entry.id,
      rating: entry.rating,
      body: entry.body,
      direction: entry.direction,
      authorName: nameOf.get(entry.authorId) ?? 'Someone',
      createdAt: entry.createdAt,
    })),
    asSeller: inDirection('buyer_to_seller'),
    asBuyer: inDirection('seller_to_buyer'),
    count: visible.length,
    // Written but not yet visible, so a thin page reads as young rather than
    // as nobody having bothered.
    pending: all.length - visible.length,
  });
}

export const payRoute = handler(pay);
export const confirmRoute = handler(confirm);
export const reviewRoute = handler(review);
export const orderStateRoute = handler(orderState);
export const checkoutRoute = handler(checkout);
export const reviewsAboutRoute = handler(reviewsAbout);

const anon = { authLevel: 'anonymous' } as const;

app.http('order-pay', { ...anon, methods: ['POST'], route: 'orders/{id}/pay', handler: payRoute });
app.http('order-confirm', { ...anon, methods: ['POST'], route: 'orders/{id}/confirm', handler: confirmRoute });
app.http('order-review', { ...anon, methods: ['POST'], route: 'orders/{id}/review', handler: reviewRoute });
app.http('order-state', { ...anon, methods: ['GET'], route: 'orders/{id}/state', handler: orderStateRoute });
app.http('order-checkout', { ...anon, methods: ['GET'], route: 'orders/{id}/checkout', handler: checkoutRoute });
app.http('user-reviews', { ...anon, methods: ['GET'], route: 'users/{id}/reviews', handler: reviewsAboutRoute });
