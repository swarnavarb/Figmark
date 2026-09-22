import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { REVIEW_DIRECTIONS } from '../../../shared/enums.js';
import { DIRECT_LOT_ID } from '../../../shared/fulfilment.js';
import type { Dispute, Order, PaymentRecord, Review, SellerPaymentDetails, User } from '../../../shared/models.js';
import {
  PAYMENT_KIND_LABELS, advanceMinor, allocatePayment, methodOf, orderMoney, rupees,
} from '../../../shared/payments.js';
import { personRef, sellerRef } from '../../../shared/parties.js';
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
import { notify } from './notify.js';
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

/** Records one dated payment on the order and puts it on the buyer's timeline. */
function record(
  order: Order,
  entry: Omit<PaymentRecord, 'id' | 'at' | 'batchId' | 'batchTotalMinor' | 'reference'> &
    Partial<Pick<PaymentRecord, 'batchId' | 'batchTotalMinor' | 'reference'>>,
): void {
  order.payments = [
    ...(order.payments ?? []),
    {
      id: `pay_${randomUUID().slice(0, 12)}`,
      at: new Date().toISOString(),
      batchId: null,
      batchTotalMinor: null,
      reference: null,
      ...entry,
    },
  ];
  const label = entry.kind === 'refund' ? '↩️ Refund processed' : `💳 ${PAYMENT_KIND_LABELS[entry.kind]} received`;
  const part = entry.batchTotalMinor && entry.batchTotalMinor !== entry.amountMinor
    ? ` (from a ${rupees(entry.batchTotalMinor)} payment)` : '';
  note(order, `${label} — ${rupees(entry.amountMinor)}${part}`, entry.recordedBy);
}

/** Paid in full once nothing is outstanding; partly paid while something is. */
function statusFromMoney(order: Order): void {
  const money = orderMoney(order);
  order.paymentStatus = money.outstandingMinor === 0 ? 'paid' : money.paidMinor > 0 ? 'partially_paid' : 'unpaid';
}

/** How much the chosen plan asks for now, or the refusal. */
function planAmount(order: Order, plan: unknown): { plan: 'full' | 'advance'; amountMinor: number } | null {
  const totalMinor = order.unitPriceMinor * order.quantity;
  if (plan !== 'advance') return { plan: 'full', amountMinor: totalMinor };
  if (!order.advancePercent) return null;
  return { plan: 'advance', amountMinor: advanceMinor(totalMinor, order.advancePercent) };
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

  let body: { protection?: boolean; escrowAgentId?: string; plan?: 'full' | 'advance' };
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

  // Protection means an escrow holds the money, so it needs a named one. The
  // buyer chooses; there is no house default, because "whoever the platform
  // picked" is not a party either side agreed to trust.
  let agent = null;
  if (body.protection) {
    if (!body.escrowAgentId) {
      return error(400, 'no_escrow', 'Choose an escrow to hold the payment.');
    }
    agent = await repository.getUserById(body.escrowAgentId);
    if (!agent?.escrowRights) {
      return error(409, 'protection_unavailable', 'That escrow is not approved to hold payments.');
    }
    // Neither end of a trade can be the neutral party in it.
    if (agent.id === order.buyerId || agent.id === order.sellerId) {
      return error(400, 'invalid_escrow', 'An escrow cannot be the buyer or the seller.');
    }
  }

  const terms = planAmount(order, body.plan);
  if (!terms) return error(400, 'no_advance', 'This item does not take an advance.');

  const now = new Date().toISOString();
  const totalMinor = order.unitPriceMinor * order.quantity;

  order.status = 'confirmed';
  order.updatedAt = now;
  order.paymentPlan = terms.plan;
  order.paymentMethod = agent ? 'protected' : 'direct';

  if (agent?.escrowRights) {
    const rights = agent.escrowRights;
    order.protection = {
      escrowAgentId: agent.id,
      // Their name as it was today: a later rename must not rewrite what the
      // buyer agreed to.
      escrowName: rights.displayName || agent.displayName,
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
      amountMinor: terms.amountMinor,
      heldAt: now,
      // Deliberately not set yet. The clock starts at dispatch, because an
      // import can sit in a lot for weeks and a window opened at checkout would
      // pay the seller for a box still with their supplier.
      autoReleaseAt: null,
    };
    note(order, `Paid with buyer protection. ${order.protection.escrowName} is holding it.`, user.id);
  } else {
    order.protection = null;
    order.escrow = { ...order.escrow, state: 'none', heldAt: null, autoReleaseAt: null };
    note(order, 'Paid directly to the seller, without protection.', user.id);
  }
  record(order, { kind: terms.plan, method: order.paymentMethod, amountMinor: terms.amountMinor, recordedBy: user.id });
  statusFromMoney(order);

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
  const totalMinor = order.unitPriceMinor * order.quantity;

  // Everyone approved to hold money, minus the two people who cannot be neutral
  // in this particular trade.
  const agents = (await repository.listEscrowAgents()).filter(
    (agent) => agent.id !== order.buyerId && agent.id !== order.sellerId && !agent.suspended,
  );

  // What each of them has actually done as an escrow. Read per agent because a
  // rating assembled from anything else would be a number we made up.
  const records = await Promise.all(agents.map((agent) => escrowRecord(agent, repository)));

  const payment = seller?.sellerProfile?.payment ?? null;

  return json(200, {
    itemMinor: totalMinor,
    /** Null when the seller does not take an advance on this item. */
    advanceMinor: order.advancePercent ? advanceMinor(totalMinor, order.advancePercent) : null,
    advancePercent: order.advancePercent ?? null,
    currency: order.currency,
    seller: sellerRef(seller),
    /**
     * How to pay them, if they have said. Null means a direct sale cannot be
     * offered at all - there is nowhere to send the money.
     */
    sellerPayment: payment && hasAnyDetail(payment) ? payment : null,
    escrows: agents.map((agent, index) => ({
      id: agent.id,
      name: agent.escrowRights!.displayName || agent.displayName,
      feeBasisPoints: agent.escrowRights!.feeBasisPoints,
      feeMinor: protectionFeeMinor(totalMinor, agent.escrowRights!.feeBasisPoints),
      /** What the group already knows about them, rather than a rating we invented. */
      heldBefore: agent.buyerTrust.completedTransactions,
      ...records[index]!,
    })),
    suggested: await suggestEscrow(order, agents, repository),
  });
}

/** True once a seller has filled in at least one way to be paid. */
function hasAnyDetail(payment: SellerPaymentDetails): boolean {
  return Boolean(payment.upiId?.trim() || (payment.accountNumber?.trim() && payment.ifsc?.trim()));
}

/**
 * What an escrow has done, as a rating a buyer can weigh.
 *
 * Assembled from their own record rather than from stars anybody typed: how
 * much they have held, how many arguments they settled, and how many of those
 * were escalated past them. `rating` is null when there is nothing behind it -
 * a new escrow is unproven, not bad, and five blank stars would say the
 * opposite of the truth.
 */
async function escrowRecord(
  agent: User,
  repository: Repo,
): Promise<{
  held: number;
  settled: number;
  openNow: number;
  rating: number | null;
  since: string;
}> {
  const holdings = await repository.listOrdersHeldBy(agent.id);
  const settled = holdings.filter((order) => order.escrow.state === 'released' || order.escrow.state === 'refunded');
  const openNow = holdings.filter((order) => order.escrow.state === 'held' || order.escrow.state === 'disputed');

  // Their published trust score, but only once they have actually held
  // something. Out of five, because that is how the picker reads it.
  const rating = settled.length > 0 ? Math.round((agent.buyerTrust.score / 20) * 10) / 10 : null;

  return {
    held: holdings.length,
    settled: settled.length,
    openNow: openNow.length,
    rating,
    since: agent.escrowRights!.grantedAt,
  };
}

/**
 * The escrow the rest of this lot is already using.
 *
 * A consignment is one shipment with one set of problems, and thirty buyers
 * each picking a different holder turns a single conversation into thirty. So
 * when others in the same lot have already settled on somebody, say so — and
 * say how many, because that is the actual reason to agree with them.
 *
 * A suggestion, never a default: the buyer still chooses.
 */
async function suggestEscrow(
  order: Order,
  agents: User[],
  repository: Repo,
): Promise<{ agentId: string; name: string; because: string } | null> {
  // A direct sale rides in no consignment, so there is nobody to agree with.
  if (order.lotId === DIRECT_LOT_ID) return null;

  const siblings = await repository.listOrdersForLot(order.lotId);
  const counts = new Map<string, number>();
  for (const sibling of siblings) {
    const held = sibling.protection?.escrowAgentId;
    if (!held || sibling.id === order.id) continue;
    counts.set(held, (counts.get(held) ?? 0) + 1);
  }

  let best: { agentId: string; count: number } | null = null;
  for (const [agentId, count] of counts) {
    // Only somebody this buyer could actually choose.
    if (!agents.some((agent) => agent.id === agentId)) continue;
    if (!best || count > best.count) best = { agentId, count };
  }
  if (!best) return null;

  const agent = agents.find((entry) => entry.id === best!.agentId)!;
  return {
    agentId: agent.id,
    name: agent.escrowRights!.displayName || agent.displayName,
    because:
      best.count === 1
        ? '1 other order in this lot already uses them.'
        : `${best.count} other orders in this lot already use them.`,
  };
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
    // Which page their name opens is which side of the trade they are on: a
    // seller's name goes to the shop, a buyer's to the person.
    counterparty: side === 'buyer' ? sellerRef(other) : personRef(other, 'the buyer'),
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
 * Largest screenshot the order will carry, as a data URL.
 *
 * A Cosmos item stops at 2 MB and this one shares the order with everything
 * else on it, so the app downscales before sending and this is the backstop.
 * Refusing with the actual size beats a write that fails deep in the store.
 */
const MAX_SCREENSHOT_BYTES = 400_000;

/**
 * POST /api/orders/{id}/claim-payment - the buyer says they have sent it.
 *
 * A direct sale settles outside this app, so nothing here watches the money
 * move. What this records is the buyer's account of having sent it, with
 * whatever proof they have, and puts the order in front of the seller. It is
 * deliberately not "paid": only the person whose account it lands in can say
 * that, and the whole point of this state is that the two claims are separate.
 */
async function claimPayment(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (order.buyerId !== user.id) {
    return error(403, 'not_the_buyer', 'Only the buyer can say they have paid.');
  }
  if (!actionsFor(order, user.id).includes('pay')) {
    return error(409, 'not_payable', 'This order is not waiting for payment.');
  }

  let body: { reference?: string; screenshot?: string; plan?: 'full' | 'advance' };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const terms = planAmount(order, body.plan);
  if (!terms) return error(400, 'no_advance', 'This item does not take an advance.');

  const reference = (body.reference ?? '').trim();
  const screenshot = (body.screenshot ?? '').trim();

  // One of the two, at minimum. A claim with neither is just a button press,
  // and the seller has nothing to check it against.
  if (!reference && !screenshot) {
    return error(400, 'no_proof', 'Add the transaction reference or a screenshot of it.');
  }
  if (screenshot && !screenshot.startsWith('data:image/')) {
    return error(400, 'invalid_screenshot', 'That does not look like an image.');
  }
  if (screenshot.length > MAX_SCREENSHOT_BYTES) {
    return error(
      413,
      'screenshot_too_large',
      `That screenshot is ${Math.round(screenshot.length / 1000)} KB and the limit is ` +
        `${MAX_SCREENSHOT_BYTES / 1000} KB. A smaller crop of the confirmation is enough.`,
    );
  }

  const now = new Date().toISOString();
  order.paymentStatus = 'claimed';
  order.updatedAt = now;
  order.paymentClaim = {
    claimedAt: now,
    reference: reference || null,
    screenshot: screenshot || null,
    decision: null,
    decidedAt: null,
    decidedReason: null,
    plan: terms.plan,
    amountMinor: terms.amountMinor,
  };
  order.paymentPlan = terms.plan;
  order.paymentMethod = 'direct';
  note(order, reference ? `Buyer paid directly — reference ${reference}.` : 'Buyer paid directly.', user.id);
  await repository.updateOrder(order);

  // The seller is the only person who can answer this, and they have no reason
  // to be looking at the order until somebody tells them to.
  await notify(repository, [order.sellerId], {
    kind: 'payment_claimed',
    title: 'A buyer says they have paid',
    body: order.itemName,
    link: `/order/${order.id}`,
  });

  return json(200, { order, awaiting: 'seller' });
}

/**
 * POST /api/orders/{id}/settle-claim - the seller answers it.
 *
 * Accepting is the seller saying the money is in their account, which is the
 * only place that fact exists. Denying puts the order back to unpaid so the
 * buyer can try again, and keeps the claim: a denied payment is the start of an
 * argument, and throwing away the buyer's evidence would leave one side of it.
 */
async function settleClaim(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('settle_claim')) {
    return error(409, 'nothing_to_settle', 'There is no payment waiting on you for this order.');
  }

  let body: { accept?: boolean; reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_request', 'Say whether the payment arrived.');
  }
  if (typeof body.accept !== 'boolean') {
    return error(400, 'invalid_request', 'Say whether the payment arrived.');
  }

  const reason = (body.reason ?? '').trim();
  // A denial the buyer cannot understand is a denial they cannot act on, and
  // they have already sent money somewhere.
  if (!body.accept && reason.length < 4) {
    return error(400, 'no_reason', 'Say why it has not arrived, so the buyer knows what to do.');
  }

  const now = new Date().toISOString();
  const claim = order.paymentClaim;
  if (claim) {
    claim.decision = body.accept ? 'accepted' : 'denied';
    claim.decidedAt = now;
    claim.decidedReason = body.accept ? null : reason;
  }

  if (body.accept) {
    order.status = 'confirmed';
    order.paymentMethod = 'direct';
    record(order, {
      kind: claim?.plan ?? 'full',
      method: 'direct',
      amountMinor: claim?.amountMinor ?? order.unitPriceMinor * order.quantity,
      reference: claim?.reference ?? null,
      recordedBy: user.id,
    });
    statusFromMoney(order);
    // Nobody is holding this. The money went from the buyer to the seller
    // directly, so there is no escrow to release and nothing to dispute over -
    // which is exactly what buying without protection means.
    order.escrow = { ...order.escrow, state: 'none' };
    note(order, 'Seller confirmed the payment arrived.', user.id);
  } else {
    order.paymentStatus = 'unpaid';
    note(order, `Seller says the payment has not arrived: ${reason}`, user.id);
  }

  order.updatedAt = now;
  await repository.updateOrder(order);

  // The buyer has sent money somewhere and is waiting to hear. A denial is the
  // one they most need, because it is the one they have to act on.
  await notify(repository, [order.buyerId], {
    kind: 'payment_settled',
    title: body.accept ? 'Your payment was confirmed' : 'The seller says your payment has not arrived',
    body: body.accept ? order.itemName : reason,
    link: `/order/${order.id}`,
  });

  return json(200, { order });
}


/**
 * POST /api/me/purchases/pay - pay more towards items in one store's lot.
 *
 * One payment, spread over the chosen items in the order they were chosen:
 * each is cleared before the next is touched, the rest spills onto the other
 * items still owing in the same group, and anything left over is kept as a
 * credit the seller refunds. Nothing is lost and nothing is guessed.
 *
 * Always by the method the orders were first paid with. A group whose items
 * were paid two different ways is refused rather than quietly switched.
 */
async function payMore(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { orderIds?: string[]; amountMinor?: number; reference?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const ids = [...new Set(body.orderIds ?? [])];
  const amountMinor = Math.round(Number(body.amountMinor) || 0);
  if (ids.length === 0) return error(400, 'no_items', 'Choose at least one item to pay towards.');
  if (amountMinor <= 0) return error(400, 'invalid_amount', 'Enter an amount above zero.');

  const selected: Order[] = [];
  for (const id of ids) {
    const order = await repository.getOrder(id);
    if (!order || order.buyerId !== user.id) return error(404, 'not_found', 'No such purchase of yours.');
    if (!actionsFor(order, user.id).includes('pay_more')) {
      return error(409, 'not_payable', `${order.itemName} is not waiting on a further payment.`);
    }
    selected.push(order);
  }
  const first = selected[0]!;
  if (selected.some((o) => o.sellerId !== first.sellerId || o.lotId !== first.lotId)) {
    return error(400, 'mixed_group', 'Pay towards items from one store and lot at a time.');
  }
  const method = methodOf(first);
  if (selected.some((o) => methodOf(o) !== method)) {
    return error(409, 'mixed_method', 'These items were paid different ways, so pay them separately.');
  }

  // The rest of the group, for the remainder to spill onto: same store, same
  // lot, still owing, and paid the same way.
  const others = (await repository.listOrdersForBuyer(user.id)).filter((o) =>
    o.sellerId === first.sellerId && o.lotId === first.lotId && !ids.includes(o.id)
    && actionsFor(o, user.id).includes('pay_more') && methodOf(o) === method);

  const byId = new Map([...selected, ...others].map((o) => [o.id, o]));
  const outstanding = (o: Order) => ({ id: o.id, outstandingMinor: orderMoney(o).outstandingMinor });
  const plan = allocatePayment(amountMinor, selected.map(outstanding), others.map(outstanding));

  const batchId = `bat_${randomUUID().slice(0, 12)}`;
  const touched = new Map<string, Order>();
  for (const line of plan.lines) {
    const order = byId.get(line.orderId)!;
    record(order, {
      kind: 'additional', method, amountMinor: line.amountMinor, batchId, batchTotalMinor: amountMinor,
      reference: body.reference?.trim() || null, recordedBy: user.id,
    });
    statusFromMoney(order);
    if (order.escrow.state === 'held') {
      order.escrow = { ...order.escrow, amountMinor: order.escrow.amountMinor + line.amountMinor };
    }
    touched.set(order.id, order);
  }

  // Over the balance: kept against the last item it reached, never dropped.
  if (plan.extraMinor > 0) {
    const holder = byId.get(plan.lines.at(-1)?.orderId ?? first.id)!;
    holder.credits = [
      ...(holder.credits ?? []),
      {
        id: `crd_${randomUUID().slice(0, 12)}`,
        createdAt: new Date().toISOString(),
        amountMinor: plan.extraMinor,
        batchId,
        refundedMinor: 0,
        refundedAt: null,
        refundedBy: null,
        status: 'open',
      },
    ];
    note(holder, `💰 Extra payment / credit — ${rupees(plan.extraMinor)}`, user.id);
    touched.set(holder.id, holder);
  }

  const now = new Date().toISOString();
  const saved: Order[] = [];
  for (const order of touched.values()) saved.push(await repository.updateOrder({ ...order, updatedAt: now }));

  await notify(repository, [first.sellerId], {
    kind: 'payment_received',
    title: `A buyer paid ${rupees(amountMinor)}`,
    body: saved.map((o) => o.itemName).join(', '),
    link: `/order/${first.id}`,
  });

  return json(200, { allocation: plan, method, orders: saved, simulatedPayment: method === 'protected' });
}

/**
 * POST /api/orders/{id}/refund-credit - the seller hands back an overpayment.
 *
 * Marks the credit refunded with who did it and when, and writes the refund
 * into the order's payments and timeline. The credit row stays: it is the
 * record of what was overpaid in the first place.
 */
async function refundCredit(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;
  if (!actionsFor(order, user.id).includes('refund_credit')) {
    return error(409, 'nothing_to_refund', 'There is no extra payment waiting to be refunded.');
  }

  let body: { creditId?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // No body: refund every open credit.
  }

  const now = new Date().toISOString();
  let total = 0;
  order.credits = (order.credits ?? []).map((credit) => {
    if (credit.status !== 'open' || (body.creditId && credit.id !== body.creditId)) return credit;
    const amount = credit.amountMinor - credit.refundedMinor;
    total += amount;
    return { ...credit, refundedMinor: credit.amountMinor, refundedAt: now, refundedBy: user.id, status: 'refunded' };
  });
  if (total === 0) return error(404, 'not_found', 'No such open credit on this order.');

  record(order, { kind: 'refund', method: methodOf(order), amountMinor: total, recordedBy: user.id });
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);

  await notify(repository, [order.buyerId], {
    kind: 'credit_refunded',
    title: `${rupees(total)} refunded to you`,
    body: order.itemName,
    link: `/order/${order.id}`,
  });

  return json(200, { order: saved, refundedMinor: total });
}

export const payRoute = handler(pay);
export const payMoreRoute = handler(payMore);
export const refundCreditRoute = handler(refundCredit);
export const claimPaymentRoute = handler(claimPayment);
/**
 * POST /api/orders/{id}/reject - the seller cannot serve this order.
 *
 * Every order on this marketplace is a promise made before anything moves: the
 * stock may have gone, the supplier may have pulled the line, the lot may not
 * fill. The seller needs a way to say so that is not silence, and the buyer
 * needs it to be a thing that happened rather than an order that quietly never
 * arrives.
 *
 * It puts back everything the order took: the stock, and the place it held in a
 * pre-order. Refused once money is being held, because that is a refund or a
 * dispute - different rules, different screen, and an escrow that can be
 * emptied by one side calling it off is not an escrow.
 */
async function rejectOrder(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('reject')) {
    return error(409, 'cannot_reject', 'This order has gone too far to be called off here.');
  }

  let body: { reason?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const reason = (body.reason ?? '').trim();
  // Somebody is waiting on an item, and possibly on money they have already
  // sent. A rejection they cannot understand is one they cannot act on.
  if (reason.length < 4) {
    return error(400, 'no_reason', 'Say why, so the buyer knows where they stand.');
  }

  const now = new Date().toISOString();
  order.status = 'cancelled';
  // Any claim on it is answered by the same act: the order is off, so the
  // money - if it was sent - is going back rather than being confirmed.
  if (order.paymentClaim && !order.paymentClaim.decision) {
    order.paymentClaim.decision = 'denied';
    order.paymentClaim.decidedAt = now;
    order.paymentClaim.decidedReason = reason;
  }
  if (order.paymentStatus === 'paid' || order.paymentStatus === 'claimed') {
    order.paymentStatus = 'refunded';
  }
  order.updatedAt = now;
  note(order, `Seller could not serve this order: ${reason}`, user.id);
  await repository.updateOrder(order);

  // Put back what the order took. A cancelled order that still holds a unit is
  // stock nobody can buy and a pre-order that can never fill.
  const listing = await repository.getListing(order.listingId);
  if (listing) {
    await repository.updateListing({
      ...listing,
      quantityAvailable: listing.quantityAvailable + order.quantity,
      status: listing.status === 'sold_out' ? 'active' : listing.status,
      preOrder: listing.preOrder
        ? {
            ...listing.preOrder,
            filledCount: Math.max(0, listing.preOrder.filledCount - order.quantity),
          }
        : null,
      updatedAt: now,
    });
  }

  await notify(repository, [order.buyerId], {
    kind: 'order_rejected',
    title: `${order.itemName} could not be sold to you`,
    body: reason,
    link: `/order/${order.id}`,
  });

  return json(200, { order });
}

export const settleClaimRoute = handler(settleClaim);
export const rejectOrderRoute = handler(rejectOrder);
export const confirmRoute = handler(confirm);
export const reviewRoute = handler(review);
export const orderStateRoute = handler(orderState);
export const checkoutRoute = handler(checkout);

const anon = { authLevel: 'anonymous' } as const;

app.http('purchases-pay', { ...anon, methods: ['POST'], route: 'me/purchases/pay', handler: payMoreRoute });
app.http('order-refund-credit', { ...anon, methods: ['POST'], route: 'orders/{id}/refund-credit', handler: refundCreditRoute });
app.http('order-pay', { ...anon, methods: ['POST'], route: 'orders/{id}/pay', handler: payRoute });
app.http('order-claim-payment', { ...anon, methods: ['POST'], route: 'orders/{id}/claim-payment', handler: claimPaymentRoute });
app.http('order-settle-claim', { ...anon, methods: ['POST'], route: 'orders/{id}/settle-claim', handler: settleClaimRoute });
app.http('order-reject', { ...anon, methods: ['POST'], route: 'orders/{id}/reject', handler: rejectOrderRoute });
app.http('order-confirm', { ...anon, methods: ['POST'], route: 'orders/{id}/confirm', handler: confirmRoute });
app.http('order-review', { ...anon, methods: ['POST'], route: 'orders/{id}/review', handler: reviewRoute });
app.http('order-state', { ...anon, methods: ['GET'], route: 'orders/{id}/state', handler: orderStateRoute });
app.http('order-checkout', { ...anon, methods: ['GET'], route: 'orders/{id}/checkout', handler: checkoutRoute });
