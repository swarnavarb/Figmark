import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { REVIEW_DIRECTIONS } from '../../../shared/enums.js';
import { DIRECT_LOT_ID } from '../../../shared/fulfilment.js';
import { threadIdFor } from '../../../shared/handles.js';
import type {
  CreditRecord, Dispute, DisputeTopic, Message, MessageParty, Order, PaymentRecord, Review, SellerPaymentDetails, User,
} from '../../../shared/models.js';
import {
  PAYMENT_KIND_LABELS, advanceMinor, allocatePayment, creditIsLive, creditLeft, methodOf, orderMoney, rupees,
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
  disputeSubjects,
  isCancelledLike,
  reviewRevealed,
  scoreFrom,
  sideOf,
} from '../../../shared/orders.js';
import { DISPUTE_TOPIC_LABELS } from '../../../shared/disputes.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { notify } from './notify.js';
import { openDisputeRecord } from './dispute-routes.js';
import { placeOrder } from './placement.js';
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
  // Until the buyer pays or books, it is their checkout, not the seller's order.
  if (order.placedAt === null && order.sellerId === viewerId) {
    return { refusal: error(404, 'not_found', 'No such order.') };
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
  const label = entry.kind === 'refund' ? '↩️ Refund processed'
    : entry.kind === 'credit' ? '💰 Extra payment applied' : `💳 ${PAYMENT_KIND_LABELS[entry.kind]} received`;
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

  // Choosing to pay is what makes a checkout an order the seller sees.
  const refusal = await placeOrder(repository, order, terms.plan === 'advance' ? 'advance' : 'paid', user.id);
  if (refusal) return error(409, 'unavailable', refusal);

  const now = new Date().toISOString();
  const totalMinor = order.unitPriceMinor * order.quantity;

  order.status = 'confirmed';
  order.accepted = true;
  order.acceptedAt = order.acceptedAt ?? now;
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
    /** Rejections of a payment this viewer made, that they could dispute. */
    disputable: disputeSubjects(order, user.id),
    simulatedPayment: true,
    // Lets the seller's cancel/reversal screen know, before they try, whether
    // the buyer has somewhere for the money to go.
    buyerHasReversalDetails: side === 'seller'
      ? Boolean((await repository.getUserById(order.buyerId))?.reversalDetails)
      : null,
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

  // The claim itself tells the seller, so placing stays quiet.
  const refusal = await placeOrder(repository, order, terms.plan === 'advance' ? 'advance' : 'paid', user.id, { tellSeller: false });
  if (refusal) return error(409, 'unavailable', refusal);

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
    // Only the order's first claim moves it into 'confirmed' - a further
    // instalment towards a balance is settling money on an order already
    // under way, and must not rewind its status or restamp its accept time.
    if (order.status === 'pending_payment') {
      order.status = 'confirmed';
      order.accepted = true;
      order.acceptedAt = order.acceptedAt ?? now;
    }
    order.paymentMethod = 'direct';
    record(order, {
      kind: claim?.plan === 'additional' ? 'additional' : (claim?.plan ?? 'full'),
      method: 'direct',
      amountMinor: claim?.amountMinor ?? order.unitPriceMinor * order.quantity,
      batchId: claim?.batchId ?? null,
      batchTotalMinor: claim?.batchTotalMinor ?? null,
      reference: claim?.reference ?? null,
      recordedBy: user.id,
    });
    statusFromMoney(order);
    // Nobody is holding this. The money went from the buyer to the seller
    // directly, so there is no escrow to release and nothing to dispute over -
    // which is exactly what buying without protection means.
    order.escrow = { ...order.escrow, state: 'none' };
    note(order, 'Seller confirmed the payment arrived.', user.id);

    // The part of this payment that overshot this order's own balance,
    // spilling from the same allocation `pay_more` already does for an
    // immediately-confirmed method - just held back until this order's own
    // claim is settled, so it is not banked as a credit before the seller has
    // said the money arrived at all.
    if (claim?.excessMinor) {
      order.credits = [
        ...(order.credits ?? []),
        {
          id: `crd_${randomUUID().slice(0, 12)}`,
          createdAt: now,
          amountMinor: claim.excessMinor,
          batchId: claim.batchId ?? null,
          refundedMinor: 0,
          refundedAt: null,
          refundedBy: null,
          status: 'open',
        },
      ];
      note(order, `💰 Extra payment / credit — ${rupees(claim.excessMinor)}`, user.id);
    }
  } else {
    statusFromMoney(order);
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
  const now = new Date().toISOString();
  const reference = body.reference?.trim() || null;
  const holderId = plan.lines.at(-1)?.orderId ?? first.id;

  // Direct money is exactly the claim this order already asks for on the
  // first payment: the buyer's account of having sent it, put in front of the
  // seller before it counts as paid. A further instalment is no different -
  // it went outside the app the same way the first one did, so it gets the
  // same "did this arrive?" before it is recorded.
  if (method === 'direct') {
    for (const line of plan.lines) {
      const order = byId.get(line.orderId)!;
      order.paymentStatus = 'claimed';
      order.paymentClaim = {
        claimedAt: now, reference, screenshot: null, decision: null, decidedAt: null, decidedReason: null,
        plan: 'additional', amountMinor: line.amountMinor, batchId, batchTotalMinor: amountMinor,
        excessMinor: line.orderId === holderId ? plan.extraMinor : undefined,
      };
      note(order, reference ? `Buyer paid directly — reference ${reference}.` : 'Buyer paid directly.', user.id);
      touched.set(order.id, order);
    }
    // Everything owing was covered and there is still money left over: it
    // has nowhere to land but the group's own last order, claimed on its own.
    if (plan.extraMinor > 0 && !touched.has(holderId)) {
      const holder = byId.get(holderId)!;
      holder.paymentStatus = 'claimed';
      holder.paymentClaim = {
        claimedAt: now, reference, screenshot: null, decision: null, decidedAt: null, decidedReason: null,
        plan: 'additional', amountMinor: 0, batchId, batchTotalMinor: amountMinor, excessMinor: plan.extraMinor,
      };
      note(holder, reference ? `Buyer paid directly — reference ${reference}.` : 'Buyer paid directly.', user.id);
      touched.set(holder.id, holder);
    }
    const saved: Order[] = [];
    for (const order of touched.values()) saved.push(await repository.updateOrder({ ...order, updatedAt: now }));

    await notify(repository, [first.sellerId], {
      kind: 'payment_claimed',
      title: `A buyer says they paid ${rupees(amountMinor)}`,
      body: saved.map((o) => o.itemName).join(', '),
      link: `/order/${first.id}`,
    });

    return json(200, { allocation: plan, method, orders: saved, awaiting: 'seller', simulatedPayment: false });
  }

  for (const line of plan.lines) {
    const order = byId.get(line.orderId)!;
    record(order, {
      kind: 'additional', method, amountMinor: line.amountMinor, batchId, batchTotalMinor: amountMinor,
      reference, recordedBy: user.id,
    });
    statusFromMoney(order);
    if (order.escrow.state === 'held') {
      order.escrow = { ...order.escrow, amountMinor: order.escrow.amountMinor + line.amountMinor };
    }
    touched.set(order.id, order);
  }

  // Over the balance: kept against the last item it reached, never dropped.
  if (plan.extraMinor > 0) {
    const holder = byId.get(holderId)!;
    holder.credits = [
      ...(holder.credits ?? []),
      {
        id: `crd_${randomUUID().slice(0, 12)}`,
        createdAt: now,
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

/** The request body, or an empty one: every credit route has sensible defaults. */
async function bodyOf<T>(request: HttpRequest): Promise<Partial<T>> {
  try {
    return ((await request.json()) ?? {}) as Partial<T>;
  } catch {
    return {};
  }
}

/**
 * POST /api/orders/{id}/refund-credit - the seller says they sent an extra payment back.
 *
 * The same shape as every other money claim on this marketplace: one side
 * says the money moved, the other side - the one whose account it landed in -
 * says whether it did. So this does not mark the credit refunded; it marks it
 * `refund_pending`, tells the buyer in a notification and in their messages,
 * and waits for their answer. Only a yes writes the refund into the payments.
 */
async function refundCredit(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;
  if (!actionsFor(order, user.id).includes('refund_credit')) {
    return error(409, 'nothing_to_refund', 'There is no extra payment waiting to be returned.');
  }

  const body = await bodyOf<{
    creditId: string; reference: string; screenshotUrl: string; message: string; amountMinor: number;
  }>(request);
  const reference = body.reference?.trim() || null;
  const proof = refundProof(reference, body.screenshotUrl);
  if ('refusal' in proof) return proof.refusal;
  const screenshotUrl = proof.screenshotUrl;
  const blocked = await refundBlocked(repository, order);
  if (blocked) return blocked;
  // A part-refund is one refund, named: returning "some" of everything on the
  // order at once would leave no way to say which balance is left where.
  const partial = body.amountMinor !== undefined && body.amountMinor !== null;
  if (partial && !body.creditId) return error(400, 'invalid_request', 'Say which refund this part-payment is for.');
  const now = new Date().toISOString();
  let total = 0;
  let refusal: ReturnType<typeof error> | null = null;
  order.credits = (order.credits ?? []).map((credit) => {
    if (!creditIsLive(credit) || (body.creditId && credit.id !== body.creditId)) return credit;
    const left = creditLeft(credit);
    const amount = partial ? Math.round(Number(body.amountMinor)) : left;
    if (!(amount > 0)) { refusal = error(400, 'invalid_amount', 'Enter an amount above zero.'); return credit; }
    if (amount > left) { refusal = error(400, 'too_much', `Only ${rupees(left)} is left to refund here.`); return credit; }
    total += amount;
    return startReturn(credit, amount, reference, screenshotUrl, now, user.id);
  });
  if (refusal) return refusal;
  if (total === 0) return error(404, 'not_found', 'No such refund on this order.');

  note(order, `↩️ Seller refunded ${rupees(total)}${reference ? ` (reference ${reference})` : ''}. Waiting for the buyer to confirm it arrived.`, user.id);
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);

  await tellBuyerRefunded(repository, order, total, reference, body.message);
  return json(200, { order: saved, sentMinor: total });
}

/**
 * Every refund carries proof of the transfer: the transaction id, a
 * screenshot of it, or both - never neither, because the buyer is about to be
 * asked whether it arrived and needs something to look for. The screenshot
 * is uploaded to the photo store first and arrives here as its address.
 */
function refundProof(
  reference: string | null, rawUrl: string | undefined,
): { screenshotUrl: string | null } | { refusal: ReturnType<typeof error> } {
  const screenshotUrl = rawUrl?.trim() || null;
  if (screenshotUrl && !screenshotUrl.startsWith('/api/photos/') && !screenshotUrl.startsWith('https://')) {
    return { refusal: error(400, 'invalid_screenshot', 'That screenshot did not upload properly. Try attaching it again.') };
  }
  if (!reference && !screenshotUrl) {
    return { refusal: error(400, 'no_proof', 'Add the transaction id or attach a screenshot of the transfer.') };
  }
  return { screenshotUrl };
}

/**
 * A refund has to have somewhere to go. Refused while the buyer has no
 * Payment Reversal Details, and while the seller has asked them to check
 * those details and they have not answered - the seller asked because they
 * were not sure, so the refund waits until they are.
 */
async function refundBlocked(repository: Repo, order: Order): Promise<ReturnType<typeof error> | null> {
  const buyer = await repository.getUserById(order.buyerId);
  if (!buyer?.reversalDetails) {
    return error(409, 'buyer_details_missing', 'The buyer has not added Payment Reversal Details yet. Ask them from the refund window.');
  }
  if (order.detailsCheck?.requestedAt && !order.detailsCheck.confirmedAt) {
    return error(409, 'awaiting_buyer_details', 'You asked the buyer to check their details. Refund once they have confirmed or updated them.');
  }
  return null;
}

/** A credit with one more return on its way, logged, waiting on the buyer. */
function startReturn(
  credit: CreditRecord, amountMinor: number, reference: string | null, screenshotUrl: string | null, at: string, by: string,
): CreditRecord {
  return {
    ...credit,
    status: 'refund_pending',
    pendingRefund: { amountMinor, reference, screenshotUrl, sentAt: at, sentBy: by },
    refundLog: [...(credit.refundLog ?? []), {
      id: `rfd_${randomUUID().slice(0, 12)}`, amountMinor, reference, screenshotUrl, sentAt: at, sentBy: by,
      status: 'awaiting', answeredAt: null,
    }],
  };
}

/** The buyer hears about a refund twice: a notification, and a message in the thread they already have. */
async function tellBuyerRefunded(
  repository: Repo, order: Order, amountMinor: number, reference: string | null, message?: string,
): Promise<void> {
  await notify(repository, [order.buyerId], {
    kind: 'credit_refund_sent',
    title: `The seller says they refunded ${rupees(amountMinor)} to you`,
    body: `${order.itemName} — tell them whether it arrived.`,
    link: '/refunds',
  });
  const [seller, buyer] = await Promise.all([repository.getUserById(order.sellerId), repository.getUserById(order.buyerId)]);
  if (seller && buyer) {
    await systemMessage(repository, seller, buyer, message?.trim()
      || `I have refunded ${rupees(amountMinor)} for "${order.itemName}"${reference ? ` (reference ${reference})` : ''}. Please confirm under My refunds once it reaches you.`);
  }
}

/**
 * POST /api/orders/{id}/refund-new - the seller starts a refund nobody asked the app for.
 *
 * A dispute settled between the two of them, a goodwill part-refund, a
 * damaged box: the money owed back exists only because the seller says so,
 * so the amount is whatever they type - never pre-filled - and never more
 * than the buyer actually paid on this order less what has already gone back.
 * It is sent at once and, like every refund, waits on the buyer to confirm.
 */
async function startRefund(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;
  if (order.sellerId !== user.id) return error(403, 'not_the_seller', 'Only the seller can refund this order.');

  const body = await bodyOf<{ amountMinor: number; reason: string; reference: string; screenshotUrl: string; message: string }>(request);
  const amountMinor = Math.round(Number(body.amountMinor) || 0);
  const reason = body.reason?.trim() ?? '';
  const reference = body.reference?.trim() || null;
  if (amountMinor <= 0) return error(400, 'invalid_amount', 'Enter the amount you are refunding.');
  if (reason.length < 3) return error(400, 'no_reason', 'Say what this refund is for, so the buyer knows.');
  const proof = refundProof(reference, body.screenshotUrl);
  if ('refusal' in proof) return proof.refusal;
  const blocked = await refundBlocked(repository, order);
  if (blocked) return blocked;

  // An overpayment was never part of what was paid for the item, so it does
  // not use any of it up. A cancellation or an earlier refund of this kind
  // does, whole, whether or not it has gone back yet.
  const alreadyBack = (order.credits ?? [])
    .filter((credit) => credit.origin === 'cancelled' || credit.origin === 'manual')
    .reduce((sum, credit) => sum + credit.amountMinor, 0);
  const ceiling = orderMoney(order).paidMinor - alreadyBack;
  if (amountMinor > ceiling) {
    return error(400, 'too_much', ceiling > 0
      ? `The buyer has paid ${rupees(ceiling)} on this order that has not already been refunded.`
      : 'Nothing paid on this order is left to refund.');
  }

  const now = new Date().toISOString();
  const credit = startReturn({
    id: `crd_${randomUUID().slice(0, 12)}`, createdAt: now, amountMinor, batchId: null,
    refundedMinor: 0, refundedAt: null, refundedBy: null, status: 'open', origin: 'manual', reason,
  }, amountMinor, reference, proof.screenshotUrl, now, user.id);
  order.credits = [...(order.credits ?? []), credit];
  note(order, `↩️ Seller refunded ${rupees(amountMinor)} — ${reason}${reference ? ` (reference ${reference})` : ''}. Waiting for the buyer to confirm it arrived.`, user.id);
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);

  await tellBuyerRefunded(repository, order, amountMinor, reference, body.message);
  return json(201, { order: saved, credit });
}

/**
 * GET /api/me/refunds - every refund owed to or sent to this buyer.
 *
 * Their side of the Refunds screen: what each one is for, what has come
 * back and when, what is still owed, and anything waiting on them to say
 * whether it arrived.
 */
async function myRefunds(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const everything = await repository.listOrdersForBuyer(user.id);
  const orders = everything.filter((order) => (order.credits ?? []).length > 0);
  const asking = everything.filter((order) => order.detailsCheck?.requestedAt && !order.detailsCheck.confirmedAt);
  const sellers = new Map((await repository.listUsersByIds([...new Set([...orders, ...asking].map((order) => order.sellerId))]))
    .map((seller) => [seller.id, seller]));
  const refunds = orders.flatMap((order) => (order.credits ?? []).map((credit) => {
    const seller = sellers.get(order.sellerId);
    return {
      orderId: order.id,
      itemName: order.itemName,
      currency: order.currency,
      sellerName: seller?.sellerProfile?.storefrontName ?? seller?.displayName ?? 'Seller',
      creditId: credit.id,
      origin: credit.origin ?? 'overpaid',
      reason: credit.reason ?? null,
      createdAt: credit.createdAt,
      amountMinor: credit.amountMinor,
      refundedMinor: credit.refundedMinor,
      leftMinor: creditLeft(credit),
      status: credit.status,
      pendingRefund: credit.pendingRefund ?? null,
      log: credit.refundLog ?? [],
      applications: credit.applications ?? [],
    };
  })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const me = await repository.getUserById(user.id);
  return json(200, {
    refunds,
    hasDetails: Boolean(me?.reversalDetails),
    /** Sellers waiting on this buyer to add or confirm their details before they can refund. */
    detailsRequests: asking.map((order) => {
      const seller = sellers.get(order.sellerId);
      return {
        orderId: order.id,
        itemName: order.itemName,
        sellerName: seller?.sellerProfile?.storefrontName ?? seller?.displayName ?? 'Seller',
        requestedAt: order.detailsCheck!.requestedAt,
      };
    }),
  });
}

/**
 * A cancelled order's reversal is done once its refund has all come back.
 *
 * The same ending `submitReversal` writes - `Cancelled + Reversed`, with the
 * buyer's answer already recorded because it is the answer that finished it -
 * just reached through Refunds instead, possibly in several part-payments.
 */
function finishReversalIfRefunded(order: Order, reference: string | null, at: string): void {
  if (order.status !== 'payment_reversal_pending') return;
  const cancelled = (order.credits ?? []).find((credit) => credit.origin === 'cancelled');
  if (!cancelled || creditLeft(cancelled) > 0 || cancelled.status === 'refund_pending') return;
  order.status = 'cancelled_reversed';
  order.paymentStatus = 'refunded';
  if (order.reversal) {
    order.reversal = {
      ...order.reversal,
      reference: order.reversal.reference ?? reference,
      reversedAt: at,
      reversedBy: cancelled.refundedBy,
      amountMinor: cancelled.refundedMinor,
      buyerResponse: 'received',
      buyerRespondedAt: at,
    };
  }
  note(order, `Payment reversed — ${rupees(cancelled.refundedMinor)}`, order.buyerId);
}

/**
 * POST /api/orders/{id}/credit-ack - the buyer answers whether the returned money arrived.
 *
 * Yes writes the refund into the payments and closes the credit. No puts it
 * back in the seller's hands, keeps a record that this return was denied, and
 * tells the seller - the extra payment is still theirs to send again.
 */
async function ackCreditRefund(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;
  if (!actionsFor(order, user.id).includes('ack_credit_refund')) {
    return error(409, 'nothing_to_confirm', 'No returned payment is waiting on you.');
  }
  const body = await bodyOf<{ creditId: string; received: boolean }>(request);
  if (typeof body.received !== 'boolean') return error(400, 'invalid_request', 'Say whether it arrived.');

  const now = new Date().toISOString();
  let total = 0;
  let reference: string | null = null;
  order.credits = (order.credits ?? []).map((credit) => {
    if (credit.status !== 'refund_pending' || !credit.pendingRefund) return credit;
    if (body.creditId && credit.id !== body.creditId) return credit;
    const sent = credit.pendingRefund;
    total += sent.amountMinor;
    reference = reference ?? sent.reference;
    const refundLog = (credit.refundLog ?? []).map((entry) => (entry.status === 'awaiting'
      ? { ...entry, status: body.received ? 'received' as const : 'not_received' as const, answeredAt: now }
      : entry));
    if (!body.received) {
      return {
        ...credit, status: 'open', pendingRefund: null, refundLog,
        refundDenials: [...(credit.refundDenials ?? []), { at: now, amountMinor: sent.amountMinor }],
      };
    }
    const next = { ...credit, refundedMinor: credit.refundedMinor + sent.amountMinor, refundedAt: now, refundedBy: sent.sentBy, pendingRefund: null, refundLog };
    return { ...next, status: creditLeft(next) > 0 ? 'open' : 'refunded' };
  });
  if (total === 0) return error(404, 'not_found', 'No such returned payment on this order.');

  if (body.received) {
    record(order, { kind: 'refund', method: methodOf(order), amountMinor: total, reference, recordedBy: user.id });
    note(order, 'Buyer confirmed the refund arrived.', user.id);
    finishReversalIfRefunded(order, reference, now);
  } else {
    note(order, `Buyer says the refunded ${rupees(total)} has not arrived.`, user.id);
  }
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);

  await notify(repository, [order.sellerId], {
    kind: 'credit_refund_answered',
    title: body.received ? `The buyer got the ${rupees(total)} you returned` : `The buyer says the ${rupees(total)} you returned has not arrived`,
    body: order.itemName,
    link: `/order/${order.id}`,
  });
  if (!body.received) {
    const [buyer, seller] = await Promise.all([repository.getUserById(order.buyerId), repository.getUserById(order.sellerId)]);
    if (buyer && seller) {
      await systemMessage(repository, buyer, seller,
        `The ${rupees(total)} you said you returned for "${order.itemName}" has not reached me yet. Could you check and send it again?`);
    }
  }

  return json(200, { order: saved, answeredMinor: total, received: body.received });
}

/**
 * POST /api/orders/{id}/credit-apply - move an extra payment onto another of the buyer's orders.
 *
 * The money never left the seller, so nothing needs confirming: it is written
 * as a dated `credit` payment on the order it pays towards, and as a moved
 * amount on the credit it came from. Only onto the same buyer's orders from
 * the same shop, and never more than that order still owes.
 */
async function applyCredit(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const source = found.order;
  if (!actionsFor(source, user.id).includes('refund_credit')) {
    return error(409, 'nothing_to_apply', 'There is no extra payment on this order to move.');
  }
  const body = await bodyOf<{ creditId: string; targetOrderId: string; amountMinor: number }>(request);
  const credit = (source.credits ?? []).find((entry) => creditIsLive(entry) && (!body.creditId || entry.id === body.creditId));
  if (!credit) return error(404, 'not_found', 'No such extra payment on this order.');

  if (!body.targetOrderId || body.targetOrderId === source.id) {
    return error(400, 'invalid_target', 'Choose another of this buyer\'s orders to put it towards.');
  }
  const target = await repository.getOrder(body.targetOrderId);
  if (!target || target.sellerId !== source.sellerId || target.buyerId !== source.buyerId) {
    return error(404, 'not_found', 'That order is not one of this buyer\'s from your shop.');
  }
  if (isCancelledLike(target.status) || target.paymentStatus === 'claimed') {
    return error(409, 'not_payable', `${target.itemName} cannot take a payment right now.`);
  }
  const owing = orderMoney(target).outstandingMinor;
  const available = creditLeft(credit);
  const amount = Math.min(available, owing, Math.round(Number(body.amountMinor) || available));
  if (amount <= 0) return error(409, 'nothing_owed', `${target.itemName} has nothing left to pay.`);

  const now = new Date().toISOString();
  target.paymentMethod = target.paymentMethod ?? methodOf(source);
  record(target, { kind: 'credit', method: methodOf(target), amountMinor: amount, recordedBy: user.id });
  statusFromMoney(target);
  if (target.status === 'pending_payment') {
    target.status = 'confirmed';
    target.accepted = true;
    target.acceptedAt = target.acceptedAt ?? now;
  }
  target.updatedAt = now;

  source.credits = (source.credits ?? []).map((entry) => {
    if (entry.id !== credit.id) return entry;
    const next = {
      ...entry,
      appliedMinor: (entry.appliedMinor ?? 0) + amount,
      applications: [...(entry.applications ?? []), { orderId: target.id, itemName: target.itemName, amountMinor: amount, at: now }],
    };
    return { ...next, status: creditLeft(next) > 0 ? entry.status : 'applied' };
  });
  note(source, `💰 ${rupees(amount)} of the refund moved to "${target.itemName}".`, user.id);
  // A cancelled order whose money has all gone somewhere - back, or onto
  // another order - has nothing left to reverse.
  const cancelledLeft = (source.credits ?? []).find((entry) => entry.origin === 'cancelled');
  if (source.status === 'payment_reversal_pending' && cancelledLeft && creditLeft(cancelledLeft) === 0
    && cancelledLeft.status !== 'refund_pending') {
    if (cancelledLeft.refundedMinor > 0) finishReversalIfRefunded(source, null, now);
    else {
      source.status = 'cancelled';
      note(source, 'Cancelled — the payment was moved to another order instead of being reversed.', user.id);
    }
  }
  source.updatedAt = now;

  const [savedSource, savedTarget] = [await repository.updateOrder(source), await repository.updateOrder(target)];

  await notify(repository, [source.buyerId], {
    kind: 'credit_applied',
    title: `${rupees(amount)} of your extra payment went towards ${target.itemName}`,
    body: `From ${source.itemName}`,
    link: `/order/${target.id}`,
  });

  return json(200, { source: savedSource, target: savedTarget, appliedMinor: amount });
}

/**
 * POST /api/orders/{id}/credit-hold - keep an extra payment as credit for the buyer's future orders.
 *
 * Nothing moves. It only records the seller's decision, so the buyer knows
 * their money is being kept rather than forgotten, and so the Extra payments
 * list can tell a considered hold from one nobody has looked at yet.
 */
async function holdCredit(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;
  if (!actionsFor(order, user.id).includes('refund_credit')) {
    return error(409, 'nothing_to_hold', 'There is no extra payment on this order.');
  }
  const body = await bodyOf<{ creditId: string }>(request);
  let total = 0;
  order.credits = (order.credits ?? []).map((credit) => {
    if (credit.status !== 'open' || (body.creditId && credit.id !== body.creditId)) return credit;
    total += creditLeft(credit);
    return { ...credit, status: 'held' };
  });
  if (total === 0) return error(404, 'not_found', 'No undecided extra payment on this order.');

  note(order, `💰 Extra payment of ${rupees(total)} kept as credit for the buyer's future orders.`, user.id);
  order.updatedAt = new Date().toISOString();
  const saved = await repository.updateOrder(order);

  await notify(repository, [order.buyerId], {
    kind: 'credit_applied',
    title: `Your extra ${rupees(total)} is kept as credit`,
    body: `The seller will put it towards your next order with them. (${order.itemName})`,
    link: `/order/${order.id}`,
  });

  return json(200, { order: saved, heldMinor: total });
}


/**
 * POST /api/orders/{id}/flag-dispute - either side raises a dispute from the order.
 *
 * Two ways in. With a `subject`: the side that paid disputes the other side
 * saying the money never came - the subject has to be one `disputeSubjects`
 * offers them, so a rejection can only be disputed by the person who paid,
 * and only once. Without one: a dispute about anything else, which needs a
 * reason because otherwise there is nothing on record to work from.
 *
 * Either way it becomes an ordinary dispute record - the same one an escrow
 * dispute is - with its own page to talk it through, withdraw it, or ask
 * Figmark to step in. Only an escrow dispute can settle by moving money.
 */
async function flagDispute(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;
  const side = sideOf(order, user.id)!;

  const body = await bodyOf<{ subject: string; reason: string }>(request);
  const typed = body.reason?.trim() || null;
  if (typed && typed.length > 2000) return error(400, 'too_long', 'Keep it under 2000 characters.');

  let topic: DisputeTopic = 'general';
  let subject: string | undefined;
  let amountMinor: number | null = null;
  let reason: string;
  if (body.subject) {
    const offered = disputeSubjects(order, user.id).find((entry) => entry.subject === body.subject);
    if (!offered) return error(409, 'not_disputable', 'There is nothing of yours to dispute there, or it is already disputed.');
    ({ kind: topic, subject, amountMinor } = offered);
    reason = typed ? `${offered.label}. ${typed}` : `${offered.label}.`;
  } else {
    if (!typed || typed.length < 4) return error(400, 'no_reason', 'Say what the dispute is about.');
    reason = typed;
  }

  const dispute = await openDisputeRecord(repository, order, {
    raisedBy: user.id, side, topic, subject, reasonCode: 'other', reason, amountMinor,
  });
  note(order, `⚖️ Dispute raised by the ${side} — ${DISPUTE_TOPIC_LABELS[topic]}${typed ? `: ${typed}` : ''}`, user.id);
  const saved = await repository.updateOrder(order);

  return json(201, { order: saved, dispute });
}

/**
 * GET /api/me/disputes - every dispute on this person's orders, from both sides.
 *
 * Split the way they will be worked: the ones on things they bought, and the
 * ones on their store's sales. Read from the dispute records themselves, so
 * the status shown is the dispute's own, and every row opens the one page
 * where it is worked.
 */
async function myDisputes(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const bought = await repository.listOrdersForBuyer(user.id);
  const sold = await repository.listOrdersForSeller(user.id);
  const people = new Map((await repository.listUsersByIds([
    ...new Set([...bought.map((order) => order.sellerId), ...sold.map((order) => order.buyerId)]),
  ])).map((person) => [person.id, person]));
  const nameOf = (id: string) => {
    const person = people.get(id);
    return person?.sellerProfile?.storefrontName ?? person?.displayName ?? 'Someone';
  };

  const rows = async (order: Order, side: 'buyer' | 'seller') => {
    // An escrow dispute opened before orders indexed their disputes is still
    // found through the one pointer it did leave.
    const ids = new Set((order.disputeLinks ?? []).map((link) => link.id));
    if (order.escrow.disputeId) ids.add(order.escrow.disputeId);
    const out = [];
    for (const id of ids) {
      const dispute = await repository.getDispute(order.id, id);
      if (!dispute) continue;
      const topic = dispute.topic ?? 'escrow';
      out.push({
        id: dispute.id,
        orderId: order.id,
        itemName: order.itemName,
        currency: order.currency,
        counterpartyName: nameOf(side === 'buyer' ? order.sellerId : order.buyerId),
        topic,
        label: DISPUTE_TOPIC_LABELS[topic],
        amountMinor: dispute.amountMinor ?? (topic === 'escrow' ? order.escrow.amountMinor : null),
        reason: dispute.reason,
        raisedAt: dispute.createdAt,
        raisedByMe: dispute.raisedBy === user.id,
        raisedBySide: dispute.raisedSide,
        status: dispute.status,
      });
    }
    return out;
  };
  const collect = async (orders: Order[], side: 'buyer' | 'seller') =>
    (await Promise.all(orders.map((order) => rows(order, side)))).flat()
      .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));

  // What a new dispute could be raised on: their recent orders, either side.
  const orders = [
    ...bought.map((order) => ({ id: order.id, itemName: order.itemName, side: 'buyer' as const, counterpartyName: nameOf(order.sellerId), createdAt: order.createdAt })),
    ...sold.map((order) => ({ id: order.id, itemName: order.itemName, side: 'seller' as const, counterpartyName: nameOf(order.buyerId), createdAt: order.createdAt })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80);

  return json(200, { asBuyer: await collect(bought, 'buyer'), asStore: await collect(sold, 'seller'), orders });
}

export const payRoute = handler(pay);
export const payMoreRoute = handler(payMore);
export const refundCreditRoute = handler(refundCredit);
export const ackCreditRefundRoute = handler(ackCreditRefund);
export const applyCreditRoute = handler(applyCredit);
export const holdCreditRoute = handler(holdCredit);
export const startRefundRoute = handler(startRefund);
export const flagDisputeRoute = handler(flagDispute);
export const myDisputesRoute = handler(myDisputes);
export const myRefundsRoute = handler(myRefunds);
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
  order.status = 'rejected';
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

/**
 * Sends one message as the platform speaking for `from`, to `to`.
 *
 * The same `Message` shape the ordinary inbox writes, so it shows up in the
 * same thread a person would message this counterparty from by hand - a
 * cancellation notice is not a different kind of conversation, it is one more
 * message in the one they already have (or the start of it, if they do not).
 * Falls back to the account id as a handle for whichever side has not
 * claimed a username yet, so a system message never fails to send for want
 * of one.
 */
async function systemMessage(repository: Repo, from: User, to: User, body: string): Promise<void> {
  const fromParty: MessageParty = {
    handle: from.username ?? from.id, userId: from.id, isStore: false, displayName: from.displayName,
  };
  const toParty: MessageParty = {
    handle: to.username ?? to.id, userId: to.id, isStore: false, displayName: to.displayName,
  };
  const now = new Date().toISOString();
  const message: Message = {
    id: `msg_${randomUUID().slice(0, 12)}`,
    threadId: threadIdFor(fromParty.handle, toParty.handle),
    from: fromParty,
    to: toParty,
    body,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await repository.sendMessage(message);
}

/**
 * POST /api/orders/{id}/accept - the seller says yes to a fresh order or booking.
 *
 * The line the X button's meaning turns on: before this, calling the order
 * off is `reject`; after it, `cancel`. For a booking specifically, saying yes
 * does not move any money - it only opens the door for the buyer to pay,
 * which they are told to do.
 */
async function acceptOrder(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('accept')) {
    return error(409, 'cannot_accept', 'There is nothing new on this order to accept.');
  }

  const now = new Date().toISOString();
  order.accepted = true;
  order.acceptedAt = now;
  order.updatedAt = now;
  note(order, order.bookingOnly ? 'Booking accepted by seller.' : 'Order accepted by seller.', user.id);
  await repository.updateOrder(order);

  await notify(repository, [order.buyerId], order.bookingOnly
    ? {
        kind: 'booking_accepted',
        title: 'Your booking has been accepted',
        body: 'Please make the payment.',
        link: `/order/${order.id}`,
      }
    : {
        kind: 'order_accepted',
        title: `${order.itemName} was accepted`,
        body: 'The seller has accepted your order.',
        link: `/order/${order.id}`,
      });

  return json(200, { order });
}

/**
 * POST /api/orders/{id}/cancel - the seller calls off an order already
 * accepted or placed.
 *
 * Two very different endings, decided by whether any money has moved. Nothing
 * paid: the order is simply `cancelled`, once the seller has said why and
 * been prompted to tell the buyer directly. Something paid: cancelling alone
 * would leave the buyer's money with nobody accountable for it, so instead the
 * order becomes `payment_reversal_pending` and stays there until the reversal
 * is recorded - see `submitReversal`.
 */
async function cancelOrder(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('cancel')) {
    return error(409, 'cannot_cancel', 'This order cannot be cancelled here.');
  }

  let body: { reason?: string; message?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const reason = (body.reason ?? '').trim();
  if (reason.length < 4) return error(400, 'no_reason', 'Say why, so the buyer knows where they stand.');

  const money = orderMoney(order);
  const now = new Date().toISOString();
  order.cancelReason = reason;
  order.updatedAt = now;

  const buyer = await repository.getUserById(order.buyerId);
  const seller = await repository.getUserById(order.sellerId);

  if (money.paidMinor <= 0) {
    order.status = 'cancelled';
    note(order, `Order cancelled by seller: ${reason}`, user.id);
    await repository.updateOrder(order);

    await notify(repository, [order.buyerId], {
      kind: 'order_cancelled',
      title: `${order.itemName} was cancelled`,
      body: reason,
      link: `/order/${order.id}`,
    });
    if (buyer && seller) {
      const text = (body.message ?? '').trim()
        || `Your order for ${order.itemName} has been cancelled: ${reason}`;
      await systemMessage(repository, seller, buyer, text);
    }
    return json(200, { order });
  }

  order.status = 'payment_reversal_pending';
  order.reversal = {
    reasonForCancel: reason,
    initiatedAt: now,
    amountMinor: money.paidMinor,
    buyerConfirmedDetailsAt: null,
    reference: null,
    screenshot: null,
    reversedAt: null,
    reversedBy: null,
    buyerResponse: null,
    buyerRespondedAt: null,
    disputeRaisedAt: null,
  };
  // What was paid is now owed back, and it goes where every refund goes: onto
  // the seller's Refunds list, to return in one go or in parts, or to put
  // towards another of this buyer's orders.
  order.credits = [...(order.credits ?? []), {
    id: `crd_${randomUUID().slice(0, 12)}`, createdAt: now, amountMinor: money.paidMinor, batchId: null,
    refundedMinor: 0, refundedAt: null, refundedBy: null, status: 'open', origin: 'cancelled', reason,
  }];
  note(order, `Order cancelled by seller, payment reversal pending: ${reason}`, user.id);
  note(order, `Payment reversal initiated — ${rupees(money.paidMinor)}`, user.id);
  await repository.updateOrder(order);

  await notify(repository, [order.buyerId], {
    kind: 'payment_reversal_pending',
    title: `${order.itemName} was cancelled — reversing your payment`,
    body: reason,
    link: `/order/${order.id}`,
  });

  if (buyer && !buyer.reversalDetails) {
    await notify(repository, [order.buyerId], {
      kind: 'reversal_details_needed',
      title: 'Add your payment reversal details',
      body: `${order.itemName} was cancelled and needs somewhere to send your ${rupees(money.paidMinor)} back.`,
      link: '/refunds?tab=details',
    });
    if (seller) {
      const text = (body.message ?? '').trim()
        || `Your order for ${order.itemName} is being cancelled and your payment of ${rupees(money.paidMinor)} `
          + `will be reversed. Please update your Payment Reversal Details so we can send it back.`;
      await systemMessage(repository, seller, buyer, text);
    }
  }

  return json(200, { order });
}

/**
 * POST /api/orders/{id}/reversal/request-details - the seller nudges a buyer
 * who has not filled in where to send a reversal.
 *
 * Notify-only: it changes nothing about the order, because the order is
 * already `payment_reversal_pending` and stays there until the buyer's
 * details actually exist. Separate from `cancelOrder` so the seller can ask
 * again without cancelling twice.
 */
async function requestReversalDetails(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('request_reversal_details')) {
    return error(409, 'not_applicable', 'Nothing on this order is owed back to the buyer.');
  }

  const body = await bodyOf<{ message: string }>(request);
  const buyer = await repository.getUserById(order.buyerId);
  const seller = await repository.getUserById(order.sellerId);
  if (!buyer || !seller) return error(404, 'not_found', 'Could not find both sides of this order.');

  const has = Boolean(buyer.reversalDetails);
  const text = body.message?.trim()
    || (has
      ? `Before I refund you for "${order.itemName}", please check your Payment Reversal Details are up to date `
        + '(My refunds → Payment reversal details) and confirm them, or update them if anything has changed.'
      : `I need to refund you for "${order.itemName}". Please add your Payment Reversal Details `
        + '(My refunds → Payment reversal details) so I know where to send it.');
  await systemMessage(repository, seller, buyer, text);

  const now = new Date().toISOString();
  order.detailsCheck = { requestedAt: now, requestedBy: user.id, confirmedAt: null };
  note(order, has ? 'Seller asked the buyer to confirm their payment reversal details.'
    : 'Seller asked the buyer to add their payment reversal details.', user.id);
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);

  await notify(repository, [order.buyerId], {
    kind: 'reversal_details_needed',
    title: has ? 'Please confirm your payment reversal details' : 'Add your payment reversal details',
    body: `${seller.sellerProfile?.storefrontName ?? seller.displayName} needs them to refund you for ${order.itemName}.`,
    link: '/refunds?tab=details',
  });

  return json(200, { sent: true, order: saved });
}

/**
 * POST /api/orders/{id}/reversal/confirm-details - the buyer says "I've
 * updated my payment details".
 *
 * Just a fact recorded and a notice sent - the seller reads it on the order
 * and decides for themselves whether to retry `submitReversal`.
 */
async function confirmReversalDetails(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('confirm_reversal_details')) {
    return error(409, 'not_applicable', 'Nobody has asked you to confirm your details on this order.');
  }

  const buyer = await repository.getUserById(user.id);
  if (!buyer?.reversalDetails) {
    return error(400, 'no_details', 'Add your Payment Reversal Details first.');
  }

  const saved = await confirmDetailsOn(repository, order, buyer, new Date().toISOString());
  return json(200, { order: saved });
}

/**
 * The buyer's details are confirmed for this order - by the button, or by
 * saving them. Recorded on the order, on the timeline, and told to the
 * seller in a notification and a message, so they know they can refund now.
 */
export async function confirmDetailsOn(repository: Repo, order: Order, buyer: User, at: string): Promise<Order> {
  if (order.reversal) order.reversal = { ...order.reversal, buyerConfirmedDetailsAt: at };
  if (order.detailsCheck) order.detailsCheck = { ...order.detailsCheck, confirmedAt: at };
  order.updatedAt = at;
  note(order, 'Buyer confirmed their payment reversal details.', buyer.id);
  const saved = await repository.updateOrder(order);

  await notify(repository, [order.sellerId], {
    kind: 'reversal_details_updated',
    title: 'The buyer confirmed their payment reversal details',
    body: `${order.itemName} — you can refund them now.`,
    link: '/shop?tab=refunds',
  });
  const seller = await repository.getUserById(order.sellerId);
  if (seller) {
    await systemMessage(repository, buyer, seller,
      `My payment reversal details are up to date for "${order.itemName}" — you can send the refund now.`);
  }
  return saved;
}

/**
 * POST /api/orders/{id}/reversal/submit - the seller records the reversal
 * and marks it done.
 *
 * Refused until the buyer has somewhere to send the money: `Payment Reversal
 * Pending` must not silently become `Cancelled + Reversed` while there is
 * nowhere the reversal actually went. Combines what the spec calls out as
 * separate steps - entering the transaction details and confirming "Payment
 * Reversed" - into one action, because by the time the seller has typed the
 * proof in they have already done the work; a second button asking them to
 * confirm what they just entered adds a click without adding a check.
 */
async function submitReversal(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('submit_reversal')) {
    return error(409, 'not_applicable', 'This order is not waiting on a payment reversal.');
  }

  const buyer = await repository.getUserById(order.buyerId);
  if (!buyer?.reversalDetails) {
    return error(409, 'buyer_details_missing', 'The buyer has not added Payment Reversal Details yet.');
  }

  let body: { reference?: string; screenshot?: string; amountMinor?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const reference = (body.reference ?? '').trim();
  const screenshot = (body.screenshot ?? '').trim();
  if (!reference && !screenshot) {
    return error(400, 'no_proof', 'Add the reversal transaction reference or a screenshot of it.');
  }
  if (screenshot && !screenshot.startsWith('data:image/')) {
    return error(400, 'invalid_screenshot', 'That does not look like an image.');
  }
  if (screenshot.length > MAX_SCREENSHOT_BYTES) {
    return error(413, 'screenshot_too_large', 'That screenshot is too large. A smaller crop is enough.');
  }

  const reversal = order.reversal as NonNullable<Order['reversal']>;
  // Whatever Refunds has not already sent back - a reversal finished here
  // after a part-refund there must not pay the first part twice.
  const cancelled = (order.credits ?? []).find((credit) => credit.origin === 'cancelled');
  const owed = cancelled ? creditLeft(cancelled) : reversal.amountMinor;
  if (cancelled?.status === 'refund_pending') {
    return error(409, 'refund_pending', 'A refund on this order is waiting on the buyer. Let them answer first.');
  }
  const amountMinor = Math.round(Number(body.amountMinor) || owed);
  const now = new Date().toISOString();
  if (cancelled) {
    order.credits = (order.credits ?? []).map((credit) => (credit.id !== cancelled.id ? credit : {
      ...credit,
      refundedMinor: credit.refundedMinor + amountMinor,
      refundedAt: now,
      refundedBy: user.id,
      status: 'refunded',
      refundLog: [...(credit.refundLog ?? []), {
        id: `rfd_${randomUUID().slice(0, 12)}`, amountMinor, reference: reference || null,
        sentAt: now, sentBy: user.id, status: 'awaiting', answeredAt: null,
      }],
    }));
  }

  // The refund itself goes through the same ledger every other payment does,
  // so `Total Paid` and the payment history never disagree with what this
  // screen says happened. The original payments stay exactly as they were.
  record(order, { kind: 'refund', method: methodOf(order), amountMinor, reference: reference || null, recordedBy: user.id });

  order.reversal = {
    ...reversal, reference: reference || null, screenshot: screenshot || null, reversedAt: now, reversedBy: user.id,
    amountMinor,
  };
  order.status = 'cancelled_reversed';
  order.paymentStatus = 'refunded';
  order.updatedAt = now;
  note(order, `Payment reversed — ${rupees(amountMinor)}`, user.id);
  await repository.updateOrder(order);

  await notify(repository, [order.buyerId], {
    kind: 'payment_reversed',
    title: `${rupees(amountMinor)} has been marked reversed`,
    body: 'Please confirm whether you have received it.',
    link: `/order/${order.id}`,
  });

  const seller = await repository.getUserById(order.sellerId);
  if (seller && buyer) {
    await systemMessage(repository, seller, buyer,
      'Your payment has been reversed. Please confirm whether you have received the payment.');
  }

  return json(200, { order });
}

/**
 * POST /api/orders/{id}/reversal/ack - the buyer says whether a marked
 * reversal actually arrived.
 */
async function ackReversal(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('ack_reversal')) {
    return error(409, 'not_applicable', 'There is no reversal waiting on your confirmation.');
  }

  let body: { received?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_request', 'Say whether the reversed payment arrived.');
  }
  if (typeof body.received !== 'boolean') {
    return error(400, 'invalid_request', 'Say whether the reversed payment arrived.');
  }

  const now = new Date().toISOString();
  order.reversal = {
    ...(order.reversal as NonNullable<Order['reversal']>),
    buyerResponse: body.received ? 'received' : 'not_received',
    buyerRespondedAt: now,
  };
  // The same answer on the Refunds history, so both screens tell one story.
  order.credits = (order.credits ?? []).map((credit) => (credit.origin !== 'cancelled' ? credit : {
    ...credit,
    refundLog: (credit.refundLog ?? []).map((entry) => (entry.status !== 'awaiting' ? entry
      : { ...entry, status: body.received ? 'received' : 'not_received', answeredAt: now })),
  }));
  order.updatedAt = now;
  note(order, body.received ? 'Buyer confirmed payment received.' : 'Buyer says payment not received.', user.id);
  await repository.updateOrder(order);

  await notify(repository, [order.sellerId], {
    kind: 'reversal_ack',
    title: body.received ? 'The buyer confirmed the reversal arrived' : 'The buyer says the reversal has not arrived',
    body: order.itemName,
    link: `/order/${order.id}`,
  });

  return json(200, { order });
}

/**
 * POST /api/orders/{id}/reversal/dispute - the buyer says a marked reversal
 * never turned up.
 *
 * Deliberately thin: it records the state and preserves everything already on
 * the order - the payments, the reversal, the messages, the timeline - rather
 * than opening the full negotiated-dispute flow that a delivery dispute gets.
 * The spec is explicit that the resolution workflow comes later; this is the
 * provision for it.
 */
async function raiseDispute(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (!actionsFor(order, user.id).includes('raise_dispute')) {
    return error(409, 'not_applicable', 'There is no reversal to dispute here.');
  }

  const now = new Date().toISOString();
  const reversal = order.reversal as NonNullable<Order['reversal']>;
  // The same dispute record every other dispute is, so it is worked on the
  // same page and listed in the same place.
  const dispute = await openDisputeRecord(repository, order, {
    raisedBy: user.id, side: 'buyer', topic: 'reversal_rejected', subject: `reversal-buyer:${reversal.reversedAt}`,
    reasonCode: 'other', reason: 'The reversed payment never arrived.', amountMinor: reversal.amountMinor,
  });
  order.status = 'dispute_raised';
  order.reversal = { ...reversal, disputeRaisedAt: now };
  note(order, 'Dispute raised: buyer reports payment not received.', user.id);
  await repository.updateOrder(order);

  await notify(repository, [order.sellerId], {
    kind: 'dispute_raised_reversal',
    title: `Dispute raised on ${order.itemName}`,
    body: 'The buyer says the reversed payment never arrived.',
    link: `/dispute/${dispute.id}`,
  });

  return json(200, { order, dispute });
}

/**
 * POST /api/orders/{id}/book - the buyer chooses Book instead of paying now.
 *
 * Booking is not a payment: it turns a fresh, unpaid order into a pledge that
 * asks the seller to confirm availability first. Only available while the
 * order is still exactly what `pay` would otherwise apply to.
 */
async function bookOrder(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownOrder(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const order = found.order;

  if (order.buyerId !== user.id || !actionsFor(order, user.id).includes('pay') || order.bookingOnly) {
    return error(409, 'cannot_book', 'This order cannot be booked.');
  }

  const refusal = await placeOrder(repository, order, 'booked', user.id);
  if (refusal) return error(409, 'unavailable', refusal);

  order.bookingOnly = true;
  order.updatedAt = new Date().toISOString();
  note(order, 'Buyer chose to book — payment is due once the seller confirms availability.', user.id);
  await repository.updateOrder(order);

  return json(200, { order });
}

export const bookOrderRoute = handler(bookOrder);
export const acceptOrderRoute = handler(acceptOrder);
export const cancelOrderRoute = handler(cancelOrder);
export const requestReversalDetailsRoute = handler(requestReversalDetails);
export const confirmReversalDetailsRoute = handler(confirmReversalDetails);
export const submitReversalRoute = handler(submitReversal);
export const ackReversalRoute = handler(ackReversal);
export const raiseDisputeRoute = handler(raiseDispute);

const anon = { authLevel: 'anonymous' } as const;

app.http('purchases-pay', { ...anon, methods: ['POST'], route: 'me/purchases/pay', handler: payMoreRoute });
app.http('order-refund-credit', { ...anon, methods: ['POST'], route: 'orders/{id}/refund-credit', handler: refundCreditRoute });
app.http('order-credit-ack', { ...anon, methods: ['POST'], route: 'orders/{id}/credit-ack', handler: ackCreditRefundRoute });
app.http('order-credit-apply', { ...anon, methods: ['POST'], route: 'orders/{id}/credit-apply', handler: applyCreditRoute });
app.http('order-refund-new', { ...anon, methods: ['POST'], route: 'orders/{id}/refund-new', handler: startRefundRoute });
app.http('order-flag-dispute', { ...anon, methods: ['POST'], route: 'orders/{id}/flag-dispute', handler: flagDisputeRoute });
app.http('my-disputes', { ...anon, methods: ['GET'], route: 'me/disputes', handler: myDisputesRoute });
app.http('my-refunds', { ...anon, methods: ['GET'], route: 'me/refunds', handler: myRefundsRoute });
app.http('order-credit-hold', { ...anon, methods: ['POST'], route: 'orders/{id}/credit-hold', handler: holdCreditRoute });
app.http('order-pay', { ...anon, methods: ['POST'], route: 'orders/{id}/pay', handler: payRoute });
app.http('order-claim-payment', { ...anon, methods: ['POST'], route: 'orders/{id}/claim-payment', handler: claimPaymentRoute });
app.http('order-settle-claim', { ...anon, methods: ['POST'], route: 'orders/{id}/settle-claim', handler: settleClaimRoute });
app.http('order-reject', { ...anon, methods: ['POST'], route: 'orders/{id}/reject', handler: rejectOrderRoute });
app.http('order-confirm', { ...anon, methods: ['POST'], route: 'orders/{id}/confirm', handler: confirmRoute });
app.http('order-review', { ...anon, methods: ['POST'], route: 'orders/{id}/review', handler: reviewRoute });
app.http('order-state', { ...anon, methods: ['GET'], route: 'orders/{id}/state', handler: orderStateRoute });
app.http('order-checkout', { ...anon, methods: ['GET'], route: 'orders/{id}/checkout', handler: checkoutRoute });
app.http('order-book', { ...anon, methods: ['POST'], route: 'orders/{id}/book', handler: bookOrderRoute });
app.http('order-accept', { ...anon, methods: ['POST'], route: 'orders/{id}/accept', handler: acceptOrderRoute });
app.http('order-cancel', { ...anon, methods: ['POST'], route: 'orders/{id}/cancel', handler: cancelOrderRoute });
app.http('order-reversal-request-details', { ...anon, methods: ['POST'], route: 'orders/{id}/reversal/request-details', handler: requestReversalDetailsRoute });
app.http('order-reversal-confirm-details', { ...anon, methods: ['POST'], route: 'orders/{id}/reversal/confirm-details', handler: confirmReversalDetailsRoute });
app.http('order-reversal-submit', { ...anon, methods: ['POST'], route: 'orders/{id}/reversal/submit', handler: submitReversalRoute });
app.http('order-reversal-ack', { ...anon, methods: ['POST'], route: 'orders/{id}/reversal/ack', handler: ackReversalRoute });
app.http('order-reversal-dispute', { ...anon, methods: ['POST'], route: 'orders/{id}/reversal/dispute', handler: raiseDisputeRoute });
