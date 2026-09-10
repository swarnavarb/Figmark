import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import {
  DISPUTE_OUTCOMES,
  DISPUTE_REASONS,
  type DisputeOutcome,
  type DisputeReason,
} from '../../../shared/enums.js';
import type { Dispute, DisputeEvidence, DisputeMessage, Order } from '../../../shared/models.js';
import {
  RESPONSE_DAYS,
  disputeActionsFor,
  feeRefunded,
  loserOf,
  reasonsFor,
  responseOverdue,
  splitFor,
} from '../../../shared/disputes.js';
import { actionsFor, daysFrom, sideOf } from '../../../shared/orders.js';
import { personRef, sellerRef } from '../../../shared/parties.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';

/**
 * Contested orders, worked by both sides.
 *
 * The shape of this follows from three things.
 *
 * Either side can open one. A seller whose buyer will not confirm delivery of a
 * parcel the courier says it delivered has their money held and no way to say
 * so; "wait for the clock" is not an answer, and a marketplace that only hears
 * from buyers eventually only has buyers.
 *
 * Most disputes are not contested. The seller often knows the corner was
 * crushed and would rather refund half than argue, so an offer the other side
 * accepts in one tap settles it with the company never hearing about it. That
 * path is the one to make easy.
 *
 * The company decides last. A missed deadline escalates to mediation; it never
 * decides. Auto-refunding on silence would be farmable by anyone patient enough
 * to say nothing, and auto-releasing on it would be farmable by every seller.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * The dispute and its order, or the refusal.
 *
 * Three parties may look: the two sides, and the escrow holding the money. The
 * escrow is not a spectator — they are the person who has to decide, and they
 * cannot decide on an argument they are not allowed to read.
 */
async function ownDispute(
  request: HttpRequest,
  repository: Repo,
  viewerId: string,
  { asEscrow = false } = {},
): Promise<{ dispute: Dispute; order: Order } | { refusal: ReturnType<typeof error> }> {
  const id = request.params.id;
  if (!id) return { refusal: error(400, 'invalid_request', 'A dispute id is required.') };

  const dispute = await repository.getDisputeById(id);
  if (!dispute) return { refusal: error(404, 'not_found', 'No such dispute.') };

  const order = await repository.getOrder(dispute.orderId);
  if (!order) return { refusal: error(404, 'not_found', 'That dispute has no order behind it.') };

  const party = sideOf(order, viewerId) !== null;
  const holding = order.protection?.escrowAgentId === viewerId;
  if (!party && !(asEscrow && holding)) {
    return { refusal: error(403, 'forbidden', 'That dispute is not yours.') };
  }
  return { dispute, order };
}

/** Evidence off the wire, with links checked before they are ever rendered. */
function evidenceFrom(raw: unknown, uploadedBy: string): DisputeEvidence[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;

  const now = new Date().toISOString();
  const items: DisputeEvidence[] = [];
  for (const entry of raw.slice(0, 8)) {
    const url = String((entry as { url?: unknown }).url ?? '').trim();
    // A dispute renders these as images on someone else's screen, so anything
    // that is not plainly an http(s) link is refused at the door rather than
    // sanitised at the point of display.
    if (!/^https?:\/\/\S+$/i.test(url)) return null;
    items.push({
      url,
      blobName: null,
      caption: String((entry as { caption?: unknown }).caption ?? '').trim().slice(0, 200),
      uploadedBy,
      uploadedAt: now,
    });
  }
  return items;
}

function message(
  authorId: string,
  role: DisputeMessage['authorRole'],
  body: string,
  evidence: DisputeEvidence[],
): DisputeMessage {
  return {
    id: `dmsg_${randomUUID().slice(0, 10)}`,
    authorId,
    authorRole: role,
    body,
    evidence,
    createdAt: new Date().toISOString(),
  };
}

/** Appends to the order's timeline, so the dispute shows up where the order is read. */
function note(order: Order, text: string, by: string): void {
  order.stageHistory = [
    ...order.stageHistory,
    { stage: order.stage, enteredAt: new Date().toISOString(), note: text, recordedBy: by },
  ];
}

/**
 * Ends a dispute and moves the money, whoever decided.
 *
 * One function for a settlement both sides agreed, a withdrawal, and a company
 * ruling, because the three have to leave identical state behind. The
 * differences are only who is recorded as deciding and whether the fee goes
 * back.
 */
export async function settleDispute(
  dispute: Dispute,
  order: Order,
  outcome: DisputeOutcome,
  refundMinor: number,
  noteText: string,
  decidedBy: string,
  byCompany: boolean,
  repository: Repo,
): Promise<{ dispute: Dispute; order: Order }> {
  const now = new Date().toISOString();
  const held = order.escrow.amountMinor;
  const { toBuyerMinor, toSellerMinor } = splitFor(outcome, held, refundMinor);

  dispute.status = outcome === 'withdrawn' ? 'withdrawn' : 'resolved';
  dispute.resolution = {
    outcome,
    refundMinor: toBuyerMinor,
    note: noteText,
    decidedBy,
    byCompany,
    decidedAt: now,
  };
  dispute.resolutionNote = noteText;
  dispute.resolvedAt = now;
  dispute.respondByAt = null;
  dispute.offer = null;
  dispute.updatedAt = now;

  // Nothing back to the buyer means the seller keeps it, which is a release
  // like any other; anything back means the order ends refunded, whole or in
  // part. A part refund is still a completed sale for the seller.
  order.escrow = {
    ...order.escrow,
    state: toBuyerMinor >= held ? 'refunded' : 'released',
    releasedAt: now,
    disputeId: dispute.id,
  };
  order.status = toBuyerMinor >= held ? 'refunded' : 'delivered';
  order.paymentStatus = toBuyerMinor >= held ? 'refunded' : toBuyerMinor > 0 ? 'partially_paid' : 'paid';
  if (toBuyerMinor < held) {
    order.stage = 'delivered';
    order.completedAt = order.completedAt ?? now;
  }
  if (order.protection && feeRefunded(outcome)) order.protection.refundedAt = now;
  order.updatedAt = now;
  note(order, `Dispute settled: ${noteText}`, decidedBy);

  // Only a wholly one-sided finding counts against a record. Marking both
  // parties down for reaching a sensible split teaches everyone to refuse one.
  const loser = loserOf(outcome, order);
  if (loser) {
    const person = await repository.getUserById(loser);
    if (person) {
      const signals = loser === order.buyerId ? person.buyerTrust : person.sellerTrust;
      signals.disputesLost += 1;
      person.updatedAt = now;
      await repository.updateUser(person);
    }
  }

  const settled = await repository.updateDispute(dispute);
  const saved = await repository.updateOrder(order);

  // Here rather than in each of the four routes that settle one, so a new way
  // to end a dispute cannot quietly end it without telling anybody.
  await notify(repository, [order.buyerId, order.sellerId], {
    kind: 'dispute_settled',
    title: 'A dispute was settled',
    body: order.itemName,
    link: `/dispute/${dispute.id}`,
  }, { except: decidedBy });

  return { dispute: settled, order: saved };
}

/** POST /api/orders/{id}/dispute - open one, from either side. */
async function open(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const orderId = request.params.id;
  if (!orderId) return error(400, 'invalid_request', 'An order id is required.');
  const order = await repository.getOrder(orderId);
  if (!order) return error(404, 'not_found', 'No such order.');

  const side = sideOf(order, user.id);
  if (!side) return error(403, 'forbidden', 'That order is not yours.');

  let body: { reasonCode?: string; reason?: string; evidence?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  // The specific refusal first: an order that already has one is not "not
  // disputable", it is one to go and read, and the message should say so.
  if (order.escrow.disputeId) {
    return error(409, 'already_disputed', 'This order already has a dispute open.');
  }
  if (!actionsFor(order, user.id).includes('dispute')) {
    return error(
      409,
      'not_disputable',
      order.protection
        ? 'There is no held payment on this order to dispute.'
        : 'This order was paid without buyer protection, so there is nothing held to settle.',
    );
  }

  const reasonCode = body.reasonCode as DisputeReason | undefined;
  if (!reasonCode || !DISPUTE_REASONS.includes(reasonCode)) {
    return error(400, 'invalid_dispute', 'Pick a reason for the dispute.');
  }
  // A seller cannot claim a parcel never arrived, and a buyer cannot claim the
  // buyer is unresponsive. The reason set is per side for a reason.
  if (!reasonsFor(side).includes(reasonCode)) {
    return error(400, 'invalid_dispute', 'That reason is not one your side can give.');
  }

  const reason = body.reason?.trim();
  if (!reason) return error(400, 'invalid_dispute', 'Say what happened, in your own words.');
  if (reason.length > 2000) return error(400, 'invalid_dispute', 'Keep it under 2000 characters.');

  const evidence = evidenceFrom(body.evidence, user.id);
  if (evidence === null) return error(400, 'invalid_evidence', 'Evidence must be http(s) links.');

  const now = new Date().toISOString();
  const record: Dispute = {
    id: `dsp_${randomUUID().slice(0, 12)}`,
    orderId: order.id,
    raisedBy: user.id,
    againstUserId: side === 'buyer' ? order.sellerId : order.buyerId,
    raisedSide: side,
    reasonCode,
    reason,
    status: 'awaiting_response',
    messages: [message(user.id, side, reason, evidence)],
    offer: null,
    respondByAt: daysFrom(RESPONSE_DAYS),
    escalatedAt: null,
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await repository.createDispute(record);

  // The hold freezes: no auto-release can run while this is open, whichever
  // side opened it.
  order.escrow = { ...order.escrow, state: 'disputed', disputeId: record.id, autoReleaseAt: null };
  order.updatedAt = now;
  note(order, `${side === 'buyer' ? 'Buyer' : 'Seller'} opened a dispute.`, user.id);
  await repository.updateOrder(order);

  // The other end of the trade, and whoever is holding the money: a dispute
  // nobody was told about is one that runs down its clock unanswered.
  await notify(repository, [record.againstUserId, order.protection?.escrowAgentId], {
    kind: 'dispute_opened',
    title: 'A dispute was opened on your order',
    body: order.itemName,
    link: `/dispute/${record.id}`,
  }, { except: user.id });

  return json(201, { dispute: record });
}

/** GET /api/disputes/{id} - the whole argument, as either party sees it. */
async function read(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  const [buyer, seller] = await Promise.all([
    repository.getUserById(order.buyerId),
    repository.getUserById(order.sellerId),
  ]);

  return json(200, {
    dispute,
    order,
    side: sideOf(order, user.id),
    actions: disputeActionsFor(dispute, order, user.id),
    overdue: responseOverdue(dispute),
    parties: {
      buyer: personRef(buyer, 'the buyer'),
      seller: sellerRef(seller),
    },
  });
}

/** POST /api/disputes/{id}/reply - say something, with what backs it up. */
async function reply(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  let body: { body?: string; evidence?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  if (!disputeActionsFor(dispute, order, user.id).includes('reply')) {
    return error(409, 'closed', 'This dispute is settled.');
  }

  const text = body.body?.trim();
  const evidence = evidenceFrom(body.evidence, user.id);
  if (evidence === null) return error(400, 'invalid_evidence', 'Evidence must be http(s) links.');
  if (!text && evidence.length === 0) return error(400, 'invalid_reply', 'Write something, or attach something.');
  if ((text ?? '').length > 2000) return error(400, 'invalid_reply', 'Keep it under 2000 characters.');

  const side = sideOf(order, user.id)!;
  dispute.messages = [...dispute.messages, message(user.id, side, text ?? '', evidence)];

  // Answering is what turns a demand into a conversation, and stops the clock
  // that would otherwise let the other side escalate on silence.
  if (dispute.status === 'awaiting_response' && user.id !== dispute.raisedBy) {
    dispute.status = 'in_discussion';
    dispute.respondByAt = null;
  }
  dispute.updatedAt = new Date().toISOString();
  const saved = await repository.updateDispute(dispute);

  await notify(repository, [order.buyerId, order.sellerId, order.protection?.escrowAgentId], {
    kind: 'dispute_replied',
    title: 'Somebody answered on a dispute',
    body: order.itemName,
    link: `/dispute/${dispute.id}`,
  }, { except: user.id });

  return json(200, { dispute: saved });
}

/** POST /api/disputes/{id}/offer - propose a settlement the other side can take. */
async function offer(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  let body: { refundMinor?: number; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  if (!disputeActionsFor(dispute, order, user.id).includes('offer')) {
    return error(409, 'cannot_offer', 'This dispute is not open to an offer.');
  }

  const refundMinor = Math.round(Number(body.refundMinor));
  if (!Number.isFinite(refundMinor) || refundMinor < 0 || refundMinor > order.escrow.amountMinor) {
    return error(400, 'invalid_offer', 'Offer between nothing and the full amount held.');
  }

  const side = sideOf(order, user.id)!;
  const now = new Date().toISOString();
  dispute.offer = { fromUserId: user.id, refundMinor, note: (body.note ?? '').trim().slice(0, 500), createdAt: now };
  dispute.status = dispute.status === 'under_mediation' ? dispute.status : 'in_discussion';
  dispute.respondByAt = null;
  dispute.messages = [
    ...dispute.messages,
    message(user.id, side, `Offered to settle with ${refundMinor} back to the buyer. ${body.note ?? ''}`.trim(), []),
  ];
  dispute.updatedAt = now;

  return json(200, { dispute: await repository.updateDispute(dispute) });
}

/** POST /api/disputes/{id}/accept - take the offer on the table, and it is over. */
async function accept(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  if (!disputeActionsFor(dispute, order, user.id).includes('accept')) {
    return error(409, 'nothing_to_accept', 'There is no offer from the other side to accept.');
  }

  const proposed = dispute.offer!;
  const held = order.escrow.amountMinor;
  const outcome: DisputeOutcome =
    proposed.refundMinor >= held ? 'refund_buyer' : proposed.refundMinor === 0 ? 'release_seller' : 'split';

  const settled = await settleDispute(
    dispute,
    order,
    outcome,
    proposed.refundMinor,
    'Both sides agreed a settlement.',
    user.id,
    false,
    repository,
  );
  return json(200, settled);
}

/** POST /api/disputes/{id}/withdraw - the person who raised it drops it. */
async function withdraw(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  if (!disputeActionsFor(dispute, order, user.id).includes('withdraw')) {
    return error(409, 'cannot_withdraw', 'Only whoever raised this may withdraw it.');
  }

  // Dropping it puts everything back where it was: the hold goes to the seller
  // and the order carries on. A withdrawal is not a finding against anyone.
  const settled = await settleDispute(
    dispute, order, 'withdrawn', 0, 'Withdrawn by whoever raised it.', user.id, false, repository,
  );
  return json(200, settled);
}

/** POST /api/disputes/{id}/escalate - hand it to the company. */
async function escalate(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  if (!disputeActionsFor(dispute, order, user.id).includes('escalate')) {
    return error(
      409,
      'cannot_escalate',
      'Give the other side their days to answer before asking us to step in.',
    );
  }

  const side = sideOf(order, user.id)!;
  const now = new Date().toISOString();
  dispute.status = 'under_mediation';
  dispute.escalatedAt = now;
  dispute.respondByAt = null;
  dispute.messages = [...dispute.messages, message(user.id, side, 'Asked Figmark to settle this.', [])];
  dispute.updatedAt = now;

  return json(200, { dispute: await repository.updateDispute(dispute) });
}

/**
 * POST /api/disputes/{id}/settle - the escrow decides.
 *
 * The reason a buyer chose this person rather than another. They hold the money
 * and they end the argument over it, so this is theirs and not the company's -
 * the company keeps its own route as a backstop for when the escrow itself is
 * the problem.
 *
 * They cannot settle before the two sides have had a chance to do it themselves:
 * an escrow that rules the moment a dispute opens is a worse version of the
 * conversation it interrupted.
 */
async function settleAsEscrow(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await ownDispute(request, repository, user.id, { asEscrow: true });
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  if (order.protection?.escrowAgentId !== user.id) {
    return error(403, 'forbidden', 'You are not the escrow on this order.');
  }
  if (dispute.resolvedAt) return error(409, 'already_resolved', 'That dispute is already settled.');
  if (dispute.status !== 'under_mediation' && !responseOverdue(dispute)) {
    return error(
      409,
      'too_early',
      'Let the two of them try to settle it first, or wait for the response window to run out.',
    );
  }

  let body: { outcome?: string; refundMinor?: number; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const outcome = body.outcome as DisputeOutcome | undefined;
  if (!outcome || outcome === 'withdrawn' || !DISPUTE_OUTCOMES.includes(outcome)) {
    return error(400, 'invalid_outcome', 'Say how it was decided.');
  }
  const noteText = (body.note ?? '').trim();
  if (!noteText) return error(400, 'invalid_outcome', 'Write the reasoning. Both parties read it.');

  const refundMinor = Math.round(Number(body.refundMinor ?? 0));
  if (outcome === 'split' && (!Number.isFinite(refundMinor) || refundMinor <= 0 || refundMinor >= order.escrow.amountMinor)) {
    return error(400, 'invalid_outcome', 'A split is between nothing and the full amount held.');
  }

  // Recorded as the escrow's, not the company's: the parties chose this person,
  // and the record should say it was them who decided.
  const settled = await settleDispute(
    dispute, order, outcome, refundMinor, noteText, user.id, false, repository,
  );
  return json(200, settled);
}

/**
 * GET /api/escrow/holdings - what this escrow is holding, and what needs them.
 *
 * Their whole job on one screen: the money in their name, and the arguments
 * waiting on a decision.
 */
async function holdings(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const me = await repository.getUserById(user.id);
  if (!me?.escrowRights) {
    return error(403, 'not_an_escrow', 'You are not approved to hold payments.');
  }

  // Held or contested, both sides of the ledger. Bounded by what one person is
  // holding, which is the size that makes a scan the right answer.
  const all = await repository.listOrdersHeldBy(user.id);
  const rows = await Promise.all(
    all.map(async (order) => {
      const [buyer, seller] = await Promise.all([
        repository.getUserById(order.buyerId),
        repository.getUserById(order.sellerId),
      ]);
      const dispute = order.escrow.disputeId
        ? await repository.getDisputeById(order.escrow.disputeId)
        : null;
      return {
        order: {
          id: order.id, itemName: order.itemName, currency: order.currency,
          lotId: order.lotId, status: order.status,
          escrow: order.escrow, protection: order.protection ?? null,
        },
        buyer: personRef(buyer, 'the buyer'),
        seller: sellerRef(seller),
        dispute,
        // Theirs to decide only once the two of them have had their go.
        decidable: Boolean(
          dispute && !dispute.resolvedAt &&
          (dispute.status === 'under_mediation' || responseOverdue(dispute)),
        ),
      };
    }),
  );

  const heldMinor = rows
    .filter((row) => row.order.escrow.state === 'held' || row.order.escrow.state === 'disputed')
    .reduce((sum, row) => sum + row.order.escrow.amountMinor, 0);

  return json(200, {
    rights: me.escrowRights,
    heldMinor,
    holdings: rows.sort((a, b) => Number(Boolean(b.dispute)) - Number(Boolean(a.dispute))),
  });
}

export const openDisputeRoute = handler(open);
export const settleAsEscrowRoute = handler(settleAsEscrow);
export const escrowHoldingsRoute = handler(holdings);
export const readDisputeRoute = handler(read);
export const replyDisputeRoute = handler(reply);
export const offerDisputeRoute = handler(offer);
export const acceptDisputeRoute = handler(accept);
export const withdrawDisputeRoute = handler(withdraw);
export const escalateDisputeRoute = handler(escalate);

const anon = { authLevel: 'anonymous' } as const;

app.http('order-dispute', { ...anon, methods: ['POST'], route: 'orders/{id}/dispute', handler: openDisputeRoute });
app.http('dispute-read', { ...anon, methods: ['GET'], route: 'disputes/{id}', handler: readDisputeRoute });
app.http('dispute-reply', { ...anon, methods: ['POST'], route: 'disputes/{id}/reply', handler: replyDisputeRoute });
app.http('dispute-offer', { ...anon, methods: ['POST'], route: 'disputes/{id}/offer', handler: offerDisputeRoute });
app.http('dispute-accept', { ...anon, methods: ['POST'], route: 'disputes/{id}/accept', handler: acceptDisputeRoute });
app.http('dispute-withdraw', { ...anon, methods: ['POST'], route: 'disputes/{id}/withdraw', handler: withdrawDisputeRoute });
app.http('dispute-escalate', { ...anon, methods: ['POST'], route: 'disputes/{id}/escalate', handler: escalateDisputeRoute });
app.http('dispute-settle', { ...anon, methods: ['POST'], route: 'disputes/{id}/settle', handler: settleAsEscrowRoute });
app.http('escrow-holdings', { ...anon, methods: ['GET'], route: 'escrow/holdings', handler: escrowHoldingsRoute });
