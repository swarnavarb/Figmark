import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext, type Timer } from '@azure/functions';
import { DISPUTE_REASONS, type DisputeReason } from '../../../shared/enums.js';
import type {
  Dispute, DisputeEvidence, DisputeMessage, DisputeSanction, DisputeSanctionKind, DisputeSubjectRef,
  DisputeSubjectType, DisputeTopic, Order, User,
} from '../../../shared/models.js';
import {
  DISPUTE_SUBJECT_LABELS, MAX_ROUNDS, communityActionsFor, currentRound, decisionOverdue, escalationOpen,
  holdsMoney, inDays, isClosed, isParty, reasonsFor, roundsOf, standingDecision, subjectPartition,
} from '../../../shared/disputes.js';
import { REASON_MIN, REPORT_TARGETS, type ReportTarget } from '../../../shared/moderation.js';
import { actionsFor, sideOf } from '../../../shared/orders.js';
import { personRef, sellerRef } from '../../../shared/parties.js';
import { roundFeeMinor } from '../../../shared/settings.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { countCompleted, dropFromCollection } from '../delivery.js';
import {
  Refusal, activeAlert, activeNotices, availableManagers, bringUpToDate, chargeFee, excludedFrom, favouredName, finalizeDecided,
  isManager, loadLedger, managerName, newRound, openCaseCount, orderOf, payoutRef, personName, pickManager,
  recordSettled,
} from '../community.js';
import { marketSettings } from '../settings.js';
import { capital, notify, notifySides, type OrderNames } from './notify.js';
import { whose } from '../../../shared/notifications.js';
import { findTarget } from './report-routes.js';
import { error, handler, json } from './http.js';

/**
 * Disputes, decided by community managers.
 *
 * Anything can be disputed: a purchase, a review, a comment, a post in the
 * feed or a forum, or a person. Raising one opens a three-way thread - the
 * person raising it, the person it is against, and a community manager - and
 * the manager decides the round. The side the decision went against may
 * escalate twice, each time to a manager the system picks by availability;
 * the best of the decisions given is the result (see shared/disputes.ts).
 *
 * Money. Every round is paid through the gateway, by whoever raised or
 * escalated it, and nothing is refunded. A purchase made with buyer protection
 * is the exception for round one: the protection fee already bought it, and
 * the manager holding the payment hears it. That is also the only kind of
 * dispute that can move money - the payment is held until the result is final
 * and the holder asks for its release. A dispute over a purchase paid
 * directly can only flag and warn: the money has already gone.
 *
 * The two parties can settle between themselves at any point before it is
 * final. A settlement has no winner and no loser.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Both sides told a dispute ended, each in their own words. */
async function tellSettled(
  repository: Repo,
  order: Order,
  disputeId: string,
  how: 'settled' | 'withdrawn',
  decidedBy: string,
): Promise<void> {
  const settled = (title: string) => ({ kind: 'dispute_settled' as const, title, body: order.itemName, link: `/dispute/${disputeId}` });
  await notifySides(repository, order, {
    buyer: (n) => settled(`Your dispute with ${n.shop} was ${how}`),
    seller: (n) => settled(`${capital(whose(n.forShop))} dispute with ${n.buyer} was ${how}`),
  }, { except: decidedBy });
}

type Role = 'raiser' | 'respondent' | 'manager' | 'holder' | 'past_manager';

/** Who this viewer is to the dispute, or null when they have no business reading it. */
function roleOf(dispute: Dispute, order: Order | null, viewerId: string): Role | null {
  if (dispute.raisedBy === viewerId) return 'raiser';
  if (dispute.againstUserId === viewerId) return 'respondent';
  if (currentRound(dispute)?.managerId === viewerId) return 'manager';
  if (order?.protection?.escrowAgentId === viewerId) return 'holder';
  if (dispute.managerIds?.includes(viewerId)) return 'past_manager';
  return null;
}

/**
 * The dispute, its order if it has one, and who is asking - or the refusal.
 *
 * Brought up to date with the clock first, so a decision whose window has
 * closed is final and a slow manager has been replaced before anybody acts.
 */
async function loadDispute(
  request: HttpRequest,
  repository: Repo,
  viewerId: string,
): Promise<{ dispute: Dispute; order: Order | null; role: Role } | { refusal: ReturnType<typeof error> }> {
  const id = request.params.id;
  if (!id) return { refusal: error(400, 'invalid_request', 'A dispute id is required.') };

  const found = await repository.getDisputeById(id);
  if (!found) return { refusal: error(404, 'not_found', 'No such dispute.') };
  const order = await orderOf(repository, found);
  if (!found.subjectRef && !order) return { refusal: error(404, 'not_found', 'That dispute has no order behind it.') };

  const role = roleOf(found, order, viewerId);
  if (!role) return { refusal: error(403, 'forbidden', 'That dispute is not yours.') };
  const dispute = await bringUpToDate(repository, found);
  return { dispute, order: order ? (await repository.getOrder(order.id)) ?? order : null, role };
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
    // that is not plainly an http(s) link - or a screenshot uploaded here - is
    // refused at the door rather than sanitised at the point of display.
    if (!/^https?:\/\/\S+$/i.test(url) && !/^\/api\/photos\/[\w.%-]+$/.test(url)) return null;
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

/** The role a message is written in. */
function voiceOf(dispute: Dispute, order: Order | null, userId: string): DisputeMessage['authorRole'] {
  if (!isParty(dispute, userId)) return 'manager';
  if (!order) return 'member';
  return sideOf(order, userId) ?? 'member';
}

/** Appends to the order's timeline, so the dispute shows up where the order is read. */
function note(order: Order, text: string, by: string): void {
  order.stageHistory = [
    ...order.stageHistory,
    { stage: order.stage, enteredAt: new Date().toISOString(), note: text, recordedBy: by },
  ];
}

async function bodyOf<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Moves money held under buyer protection: some or all to the buyer, the rest
 * to the seller. Through the gateway, and only ever on a protected purchase.
 *
 * One function for a settlement, a withdrawal and a release after a final
 * decision, because the three have to leave identical state behind.
 */
async function moveHeld(
  repository: Repo,
  dispute: Dispute,
  order: Order,
  toBuyerMinor: number,
  noteText: string,
  by: string,
): Promise<Order> {
  const now = new Date().toISOString();
  const held = order.escrow.amountMinor;
  const toBuyer = Math.max(0, Math.min(held, Math.round(toBuyerMinor)));

  // Nothing back to the buyer means the seller keeps it, which is a release
  // like any other; anything back means the order ends refunded, whole or in
  // part. A part refund is still a completed sale for the seller.
  order.escrow = {
    ...order.escrow,
    state: toBuyer >= held ? 'refunded' : 'released',
    releasedAt: now,
    disputeId: dispute.id,
  };
  order.status = toBuyer >= held ? 'refunded' : 'delivered';
  order.paymentStatus = toBuyer >= held ? 'refunded' : toBuyer > 0 ? 'partially_paid' : 'paid';
  if (toBuyer < held) {
    order.stage = 'delivered';
    order.completedAt = order.completedAt ?? now;
  }
  order.updatedAt = now;
  note(order, noteText, by);

  // A refunded purchase is not something the buyer has; a card for it comes
  // off their collection. A seller-kept or split outcome is a finished trade.
  if (order.status === 'refunded') await dropFromCollection(repository, order.buyerId, order.id);
  else await countCompleted(order, repository);

  dispute.release = {
    toBuyerMinor: toBuyer,
    toSellerMinor: held - toBuyer,
    requestedBy: by,
    requestedAt: now,
    gatewayRef: payoutRef(),
  };
  return repository.updateOrder(order);
}

/** A manager the raiser picked, checked: appointed, taking cases, and neither party. */
async function chosenManager(repository: Repo, managerId: string, parties: readonly string[]): Promise<User> {
  const manager = await repository.getUserById(managerId);
  if (!isManager(manager)) throw new Refusal(409, 'invalid_manager', 'That person is not a community manager.');
  if (parties.includes(manager.id)) throw new Refusal(400, 'invalid_manager', 'A party to a dispute cannot decide it.');
  const open = (await availableManagers(repository, parties)).some((entry) => entry.user.id === manager.id);
  if (!open) throw new Refusal(409, 'manager_unavailable', `${managerName(manager)} is not taking new disputes right now. Pick someone else.`);
  return manager;
}

/** Whether this order's protection is still holding its payment - the only time round one is free. */
function protectionActive(order: Order): boolean {
  return Boolean(order.protection && (order.escrow.state === 'held' || order.escrow.state === 'disputed'));
}

/**
 * Every dispute on an order starts here, whatever it is about.
 *
 * Creates the one record all three then work on the same page, with its first
 * round: the manager holding a protected payment, free; otherwise the manager
 * the raiser picked (or, if they left it, the system's choice), paid through
 * the gateway. Indexes it on the order so it is never raised twice, and tells
 * the other side and the manager. The caller saves the order.
 */
export async function openDisputeRecord(
  repository: Repo,
  order: Order,
  input: {
    raisedBy: string;
    side: 'buyer' | 'seller';
    topic: DisputeTopic;
    subject?: string;
    reasonCode: DisputeReason;
    reason: string;
    evidence?: DisputeEvidence[];
    amountMinor?: number | null;
    managerId?: string | null;
  },
): Promise<Dispute> {
  // One matter, one dispute: nobody - either side - opens a second one on an
  // order while one is still being worked.
  const open = (await repository.listDisputesForOrder(order.id)).filter((entry) => !isClosed(entry));
  if (open.length > 0) {
    throw new Refusal(409, 'already_disputed', 'This order already has a dispute open. Add to that one instead.');
  }

  const settings = await marketSettings(repository);
  const parties = [order.buyerId, order.sellerId];
  const now = new Date().toISOString();
  const id = `dsp_${randomUUID().slice(0, 12)}`;

  let round;
  if (protectionActive(order)) {
    // Bought with the protection: the manager holding it hears it, and the
    // fee for that was paid at checkout.
    const holder = await repository.getUserById(order.protection!.escrowAgentId);
    const manager = isManager(holder) ? holder : await pickManager(repository, parties);
    if (!manager) throw new Refusal(409, 'no_manager', 'No community manager is available to take this right now.');
    round = newRound(1, manager, isManager(holder) ? 'protection' : 'system', settings, null, null);
  } else {
    const manager = input.managerId
      ? await chosenManager(repository, input.managerId, parties)
      : await pickManager(repository, parties);
    if (!manager) throw new Refusal(409, 'no_manager', 'No community manager is available to take this right now.');
    const payment = await chargeFee(repository, {
      kind: 'dispute', payerId: input.raisedBy, amountMinor: settings.disputeFeeMinor, currency: order.currency,
      reference: id, managerId: manager.id,
    }, settings);
    round = newRound(1, manager, input.managerId ? 'raiser' : 'system', settings, payment, null);
  }

  const record: Dispute = {
    id,
    orderId: order.id,
    topic: input.topic,
    subject: input.subject ?? id,
    amountMinor: input.amountMinor ?? null,
    raisedBy: input.raisedBy,
    againstUserId: input.side === 'buyer' ? order.sellerId : order.buyerId,
    raisedSide: input.side,
    reasonCode: input.reasonCode,
    reason: input.reason,
    status: 'awaiting_response',
    messages: [message(input.raisedBy, input.side, input.reason, input.evidence ?? [])],
    offer: null,
    respondByAt: inDays(settings.responseDays),
    escalatedAt: null,
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    rounds: [round],
    managerIds: [round.managerId],
    escalateBy: null,
    result: null,
    release: null,
    createdAt: now,
    updatedAt: now,
  };
  await repository.createDispute(record);

  order.disputeLinks = [...(order.disputeLinks ?? []), {
    id, topic: input.topic, subject: record.subject!, raisedBy: input.raisedBy, raisedSide: input.side, raisedAt: now,
  }];
  order.updatedAt = now;

  // The other end of the trade, and the manager deciding it: a dispute nobody
  // was told about is one that runs down its clock unanswered.
  const opened = (title: string) => ({ kind: 'dispute_opened' as const, title, body: `${order.itemName}: ${input.reason}`, link: `/dispute/${id}` });
  await notifySides(repository, order, {
    ...(record.againstUserId === order.sellerId
      ? { seller: (n: OrderNames) => opened(`${n.buyer} opened a dispute with ${n.forShop}`) }
      : { buyer: (n: OrderNames) => opened(`${n.shop} opened a dispute with you`) }),
  }, { except: input.raisedBy });
  await notify(repository, [round.managerId], {
    kind: 'dispute_assigned',
    title: 'You have a dispute to decide',
    body: `${order.itemName}: ${input.reason}`.slice(0, 160),
    link: `/dispute/${id}`,
  });

  return record;
}

/* ── Raising ─────────────────────────────────────────────────────────────── */

/** POST /api/orders/{id}/dispute - a claim on a protected purchase, from either side. Free: protection paid for it. */
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

  const body = await bodyOf<{ reasonCode?: string; reason?: string; evidence?: unknown }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');

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
        : 'This order was paid without buyer protection, so there is nothing held to settle. You can still raise a dispute with a community manager.',
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
  if (evidence === null) return error(400, 'invalid_evidence', 'Evidence must be http(s) links or uploaded screenshots.');

  const record = await openDisputeRecord(repository, order, {
    raisedBy: user.id, side, topic: 'escrow', reasonCode, reason, evidence, amountMinor: order.escrow.amountMinor,
  });

  // The hold freezes: no auto-release can run while this is open, whichever
  // side opened it.
  order.escrow = { ...order.escrow, state: 'disputed', disputeId: record.id, autoReleaseAt: null };
  note(order, `${side === 'buyer' ? 'Buyer' : 'Seller'} opened a dispute.`, user.id);
  await repository.updateOrder(order);

  return json(201, { dispute: record });
}

const SUBJECT_TYPES: readonly DisputeSubjectType[] = [...REPORT_TARGETS, 'user'];

/** Where a piece of content is opened, as the app routes it. */
async function linkFor(repository: Repo, type: DisputeSubjectType, id: string, parentId: string): Promise<string | null> {
  switch (type) {
    case 'comment': return `/listing/${parentId}`;
    case 'post': case 'forum_post': return `/social/p/${parentId}/${id}`;
    case 'post_comment': {
      const [channelId, postId] = parentId.split(':');
      return channelId && postId ? `/social/p/${channelId}/${postId}` : null;
    }
    default: {
      // A person, or a review on somebody's page: their page, by handle.
      const owner = await repository.getUserById(type === 'user' ? id : parentId);
      const handle = owner?.sellerProfile?.username ?? owner?.username;
      return handle ? `/${handle}` : null;
    }
  }
}

/**
 * POST /api/disputes - raise one about anything that is not an order.
 *
 * The popup behind every "Raise a dispute": a review, a comment, a post in
 * the feed or a forum, or a person. The raiser says what happened, attaches
 * screenshots, picks a community manager and pays the fee through the
 * gateway. One open dispute per matter - nobody, either party included, opens
 * a second while one is being worked.
 */
async function raise(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const body = await bodyOf<{
    subject?: { type?: string; id?: string; parentId?: string };
    reason?: string; evidence?: unknown; managerId?: string;
  }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');

  const type = body.subject?.type as DisputeSubjectType | undefined;
  const targetId = body.subject?.id?.trim();
  const parentId = body.subject?.parentId?.trim() ?? '';
  if (!type || !SUBJECT_TYPES.includes(type) || !targetId || (type !== 'user' && !parentId)) {
    return error(400, 'invalid_subject', 'Say what the dispute is about.');
  }

  const reason = body.reason?.trim() ?? '';
  if (reason.length < REASON_MIN) return error(400, 'invalid_dispute', `Say what happened (at least ${REASON_MIN} characters).`);
  if (reason.length > 2000) return error(400, 'invalid_dispute', 'Keep it under 2000 characters.');
  const evidence = evidenceFrom(body.evidence, user.id);
  if (evidence === null) return error(400, 'invalid_evidence', 'Evidence must be http(s) links or uploaded screenshots.');
  if (!body.managerId) return error(400, 'no_manager', 'Pick a community manager to hear it.');

  // What it is about, read fresh: whose it is, and what it said.
  let ownerId: string;
  let excerpt: string;
  if (type === 'user') {
    const person = await repository.getUserById(targetId);
    if (!person || person.suspended) return error(404, 'not_found', 'That member is not here.');
    ownerId = person.id;
    excerpt = personName(person);
  } else {
    const target = await findTarget(repository, type as ReportTarget, targetId, parentId);
    if (!target || !target.visible) return error(404, 'not_found', 'That is not there any more.');
    ownerId = target.authorId;
    excerpt = target.body.slice(0, 600);
  }
  if (ownerId === user.id) {
    return error(400, 'own_content', type === 'user' ? 'You cannot raise a dispute against yourself.' : 'That is yours. Ask for it to be validated instead.');
  }

  const partition = subjectPartition(type, targetId);
  const already = (await repository.listDisputesForOrder(partition)).filter((entry) => !isClosed(entry));
  if (already.length > 0) {
    return error(409, 'already_disputed', 'This is already under dispute. Only one can be open at a time.');
  }

  const settings = await marketSettings(repository);
  const manager = await chosenManager(repository, body.managerId, [user.id, ownerId]);
  const now = new Date().toISOString();
  const id = `dsp_${randomUUID().slice(0, 12)}`;
  const payment = await chargeFee(repository, {
    kind: 'dispute', payerId: user.id, amountMinor: settings.disputeFeeMinor, currency: 'INR', reference: id, managerId: manager.id,
  }, settings);
  const round = newRound(1, manager, 'raiser', settings, payment, null);

  const subjectRef: DisputeSubjectRef = {
    type, id: targetId, parentId: type === 'user' ? targetId : parentId, ownerId, excerpt,
    link: await linkFor(repository, type, targetId, parentId),
  };
  const record: Dispute = {
    id,
    orderId: partition,
    topic: 'general',
    subject: partition,
    amountMinor: null,
    raisedBy: user.id,
    againstUserId: ownerId,
    raisedSide: 'member',
    reasonCode: 'other',
    reason,
    status: 'awaiting_response',
    messages: [message(user.id, 'member', reason, evidence)],
    offer: null,
    respondByAt: inDays(settings.responseDays),
    escalatedAt: null,
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    subjectRef,
    rounds: [round],
    managerIds: [manager.id],
    escalateBy: null,
    result: null,
    release: null,
    createdAt: now,
    updatedAt: now,
  };
  await repository.createDispute(record);

  const what = DISPUTE_SUBJECT_LABELS[type].toLowerCase();
  await notify(repository, [ownerId], {
    kind: 'dispute_opened',
    title: `${user.displayName ?? 'Someone'} raised a dispute about your ${type === 'user' ? 'account' : what}`,
    body: reason.slice(0, 160),
    link: `/dispute/${id}`,
  });
  await notify(repository, [manager.id], {
    kind: 'dispute_assigned',
    title: `You have a dispute to decide: ${what}`,
    body: reason.slice(0, 160),
    link: `/dispute/${id}`,
  });

  return json(201, { dispute: record, payment, simulatedPayment: true });
}

/* ── Reading and talking ─────────────────────────────────────────────────── */

/** GET /api/disputes/{id} - the whole thread, as any of the three sees it. */
async function read(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order, role } = found;

  const settings = await marketSettings(repository);
  const people = await repository.listUsersByIds([dispute.raisedBy, dispute.againstUserId]);
  const named = new Map(people.map((person) => [person.id, person]));
  const [buyer, seller] = order
    ? await Promise.all([repository.getUserById(order.buyerId), repository.getUserById(order.sellerId)])
    : [null, null];
  const money = order ? holdsMoney(dispute) : false;
  const nextRound = roundsOf(dispute).length + 1;

  return json(200, {
    dispute,
    order,
    side: order ? sideOf(order, user.id) : null,
    role,
    actions: communityActionsFor(dispute, user.id, {
      holdsMoney: money, isHolder: order?.protection?.escrowAgentId === user.id,
    }),
    overdue: decisionOverdue(currentRound(dispute)),
    standing: standingDecision(dispute),
    escalation: {
      open: escalationOpen(dispute),
      nextRound: nextRound <= MAX_ROUNDS ? nextRound : null,
      feeMinor: nextRound <= MAX_ROUNDS ? roundFeeMinor(settings, nextRound) : null,
      by: dispute.escalateBy ?? null,
    },
    holdsMoney: money,
    heldMinor: money ? order!.escrow.amountMinor : null,
    currency: order?.currency ?? 'INR',
    parties: {
      raiser: { id: dispute.raisedBy, name: personName(named.get(dispute.raisedBy)) },
      respondent: { id: dispute.againstUserId, name: personName(named.get(dispute.againstUserId)) },
      ...(order ? { buyer: personRef(buyer, 'the buyer'), seller: sellerRef(seller) } : {}),
    },
  });
}

/** POST /api/disputes/{id}/reply - say something, with what backs it up. Any of the three. */
async function reply(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  const body = await bodyOf<{ body?: string; evidence?: unknown }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');

  if (!communityActionsFor(dispute, user.id).includes('reply')) {
    return error(409, 'closed', isClosed(dispute) ? 'This dispute is settled.' : 'Only the two parties and the manager deciding it can write here.');
  }

  const text = body.body?.trim();
  const evidence = evidenceFrom(body.evidence, user.id);
  if (evidence === null) return error(400, 'invalid_evidence', 'Evidence must be http(s) links or uploaded screenshots.');
  if (!text && evidence.length === 0) return error(400, 'invalid_reply', 'Write something, or attach something.');
  if ((text ?? '').length > 2000) return error(400, 'invalid_reply', 'Keep it under 2000 characters.');

  dispute.messages = [...dispute.messages, message(user.id, voiceOf(dispute, order, user.id), text ?? '', evidence)];

  // Answering is what turns a demand into a conversation.
  if (dispute.status === 'awaiting_response' && user.id === dispute.againstUserId) {
    dispute.status = 'in_discussion';
    dispute.respondByAt = null;
  }
  dispute.updatedAt = new Date().toISOString();
  const saved = await repository.updateDispute(dispute);

  const audience = [dispute.raisedBy, dispute.againstUserId, currentRound(dispute)?.managerId];
  await notify(repository, audience, {
    kind: 'dispute_replied',
    title: `${isParty(dispute, user.id) ? personName(await repository.getUserById(user.id)) : 'The community manager'} wrote on a dispute`,
    body: `${order?.itemName ?? dispute.subjectRef?.excerpt ?? ''}: ${text || 'Added evidence'}`.slice(0, 160),
    link: `/dispute/${dispute.id}`,
  }, { except: user.id });

  return json(200, { dispute: saved });
}

/* ── Settling between themselves ─────────────────────────────────────────── */

/** POST /api/disputes/{id}/offer - propose a settlement the other side can take. */
async function offer(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  const body = await bodyOf<{ refundMinor?: number; note?: string; terms?: string }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');

  if (!communityActionsFor(dispute, user.id).includes('propose_settlement')) {
    return error(409, 'cannot_offer', 'This dispute is not open to an offer.');
  }

  const money = Boolean(order) && holdsMoney(dispute) && order!.escrow.state === 'disputed';
  let refundMinor = 0;
  if (money) {
    refundMinor = Math.round(Number(body.refundMinor));
    if (!Number.isFinite(refundMinor) || refundMinor < 0 || refundMinor > order!.escrow.amountMinor) {
      return error(400, 'invalid_offer', 'Offer between nothing and the full amount held.');
    }
  }
  const terms = (body.terms ?? body.note ?? '').trim().slice(0, 500);
  if (!money && terms.length < 4) return error(400, 'invalid_offer', 'Write the terms you are proposing.');

  const now = new Date().toISOString();
  dispute.offer = { fromUserId: user.id, refundMinor, note: terms, terms, createdAt: now };
  if (dispute.status === 'awaiting_response') dispute.status = 'in_discussion';
  dispute.respondByAt = null;
  dispute.messages = [
    ...dispute.messages,
    message(user.id, voiceOf(dispute, order, user.id),
      `Proposed a settlement${money ? ` with ${refundMinor} back to the buyer` : ''}. ${terms}`.trim(), []),
  ];
  dispute.updatedAt = now;

  return json(200, { dispute: await repository.updateDispute(dispute) });
}

/**
 * POST /api/disputes/{id}/accept - take the other side's settlement, and it is over.
 *
 * No manager confirms it: two people who agree do not need a third to agree
 * with them. Nobody won and nobody lost, every decision before it is void, and
 * no sanction from one is carried out. On a protected purchase the agreed
 * split is paid out through the gateway at once.
 */
async function accept(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute } = found;
  let { order } = found;

  if (!communityActionsFor(dispute, user.id).includes('accept_settlement')) {
    return error(409, 'nothing_to_accept', 'There is no offer from the other side to accept.');
  }

  const proposed = dispute.offer!;
  const now = new Date().toISOString();
  const terms = proposed.terms ?? proposed.note ?? '';
  dispute.status = 'resolved';
  dispute.resolvedAt = now;
  dispute.escalateBy = null;
  dispute.respondByAt = null;
  dispute.resolutionNote = 'Both sides agreed a settlement.';
  dispute.result = { how: 'settled', winnerId: null, loserId: null, favour: null, finalRound: null, terms, at: now };
  dispute.messages = [...dispute.messages, message(user.id, voiceOf(dispute, order, user.id), 'Accepted the settlement.', [])];

  if (order && holdsMoney(dispute) && order.escrow.state === 'disputed') {
    const held = order.escrow.amountMinor;
    dispute.resolution = {
      outcome: proposed.refundMinor >= held ? 'refund_buyer' : proposed.refundMinor === 0 ? 'release_seller' : 'split',
      refundMinor: proposed.refundMinor, note: 'Both sides agreed a settlement.', decidedBy: user.id, byCompany: false, decidedAt: now,
    };
    order = await moveHeld(repository, dispute, order, proposed.refundMinor, 'Dispute settled: both sides agreed a settlement.', user.id);
  }
  dispute.offer = null;
  dispute.updatedAt = now;
  const saved = await repository.updateDispute(dispute);
  await recordSettled(repository, saved, order);

  if (order) await tellSettled(repository, order, dispute.id, 'settled', user.id);
  await notify(repository, [currentRound(dispute)?.managerId, dispute.raisedBy, dispute.againstUserId], {
    kind: 'dispute_settled',
    title: 'A dispute was settled between the parties',
    body: terms.slice(0, 160) || 'Nobody won or lost.',
    link: `/dispute/${dispute.id}`,
  }, { except: user.id });

  return json(200, { dispute: saved, order });
}

/** POST /api/disputes/{id}/withdraw - the person who raised it drops it, before anyone has decided. */
async function withdraw(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute } = found;
  let { order } = found;

  if (!communityActionsFor(dispute, user.id).includes('withdraw')) {
    return error(409, 'cannot_withdraw', dispute.raisedBy === user.id
      ? 'A decision has been given, so it can no longer be withdrawn.'
      : 'Only whoever raised this may withdraw it.');
  }

  // Dropping it puts everything back where it was: the hold goes to the seller
  // and the order carries on. A withdrawal is not a finding against anyone,
  // and the fee paid for it is not refunded.
  const now = new Date().toISOString();
  dispute.status = 'withdrawn';
  dispute.resolvedAt = now;
  dispute.respondByAt = null;
  dispute.offer = null;
  dispute.resolutionNote = 'Withdrawn by whoever raised it.';
  dispute.result = { how: 'withdrawn', winnerId: null, loserId: null, favour: null, finalRound: null, terms: null, at: now };
  dispute.resolution = { outcome: 'withdrawn', refundMinor: 0, note: 'Withdrawn by whoever raised it.', decidedBy: user.id, byCompany: false, decidedAt: now };
  if (order && holdsMoney(dispute) && order.escrow.state === 'disputed') {
    order = await moveHeld(repository, dispute, order, 0, 'Dispute withdrawn: Withdrawn by whoever raised it.', user.id);
  }
  dispute.updatedAt = now;
  const saved = await repository.updateDispute(dispute);
  if (order) await tellSettled(repository, order, dispute.id, 'withdrawn', user.id);
  await notify(repository, [currentRound(dispute)?.managerId, dispute.againstUserId], {
    kind: 'dispute_settled', title: 'A dispute was withdrawn', body: dispute.reason.slice(0, 160), link: `/dispute/${dispute.id}`,
  }, { except: user.id });

  return json(200, { dispute: saved, order });
}

/* ── Deciding and escalating ─────────────────────────────────────────────── */

const SANCTION_KINDS: readonly DisputeSanctionKind[] = [
  'remove_content', 'warning_post', 'flag', 'rating_reduction', 'alert_banner', 'xp_deduction',
];

/** Sanctions off the wire, each checked against what this dispute can do. */
async function sanctionsFrom(raw: unknown, dispute: Dispute, repository: Repo): Promise<DisputeSanction[] | string> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return 'Sanctions must be a list.';
  const out: DisputeSanction[] = [];
  for (const entry of raw.slice(0, 8) as Record<string, unknown>[]) {
    const kind = entry.kind as DisputeSanctionKind;
    if (!SANCTION_KINDS.includes(kind)) return 'That is not an action a community manager can take.';
    const targetUserId = String(entry.targetUserId ?? '');
    if (!isParty(dispute, targetUserId)) return 'An action can only be taken against one of the two parties.';
    const messageText = String(entry.message ?? '').trim().slice(0, 300);
    const sanction: DisputeSanction = { kind, targetUserId, message: messageText };

    if (kind === 'remove_content') {
      const subject = dispute.subjectRef;
      if (!subject || subject.type === 'user' || subject.ownerId !== targetUserId) {
        return 'Only the disputed content can be removed, and only its author\'s.';
      }
    }
    if (['warning_post', 'alert_banner', 'flag'].includes(kind) && messageText.length < 4) {
      return 'Write what the warning, alert or flag should say.';
    }
    if (kind === 'warning_post' || kind === 'alert_banner') {
      const days = Number(entry.days ?? 7);
      if (!Number.isInteger(days) || days < 1 || days > 60) return 'Show it for between 1 and 60 days.';
      sanction.days = days;
    }
    if (kind === 'warning_post' && entry.forumId) {
      const forum = await repository.getForum(String(entry.forumId));
      if (!forum) return 'No such forum.';
      sanction.forumId = forum.id;
    }
    if (kind === 'xp_deduction') {
      if (entry.severity !== 'light' && entry.severity !== 'severe') return 'Say how severe the XP deduction is.';
      sanction.severity = entry.severity;
    }
    if (kind === 'rating_reduction') {
      const points = Number(entry.points ?? 5);
      if (!Number.isInteger(points) || points < 1 || points > 50) return 'Take between 1 and 50 rating points.';
      sanction.points = points;
    }
    out.push(sanction);
  }
  return out;
}

/**
 * POST /api/disputes/{id}/decide - the manager on the current round decides.
 *
 * In favour of the person who raised it, or against them, with the reasoning
 * all three read and whatever actions the manager wants carried out if this
 * decision ends up standing. On held money, how much goes back to the buyer.
 *
 * Round one waits for the other side to answer or for their days to run out:
 * a manager who rules the moment a dispute opens has heard one side.
 */
async function decide(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;
  const round = currentRound(dispute);

  if (isClosed(dispute)) return error(409, 'already_resolved', 'That dispute is already closed.');
  if (!round || round.managerId !== user.id) {
    return error(403, 'forbidden', 'Only the community manager on the current round decides it.');
  }
  if (round.decision) return error(409, 'already_decided', 'You have already decided this round.');
  if (round.n === 1 && dispute.status === 'awaiting_response'
    && !(dispute.respondByAt && Date.parse(dispute.respondByAt) <= Date.now())) {
    return error(409, 'too_early', 'Let the other side answer first, or wait for their response window to run out.');
  }

  const body = await bodyOf<{ favour?: string; reasoning?: string; note?: string; refundMinor?: number; sanctions?: unknown }>(request);
  if (!body) return error(400, 'invalid_body', 'Request body must be JSON.');
  if (body.favour !== 'raiser' && body.favour !== 'respondent') {
    return error(400, 'invalid_decision', 'Decide in favour of whoever raised it, or against them.');
  }
  const reasoning = (body.reasoning ?? body.note ?? '').trim();
  if (!reasoning) return error(400, 'invalid_decision', 'Write the reasoning. Both parties read it.');

  let refundMinor: number | null = null;
  if (order && holdsMoney(dispute)) {
    const held = order.escrow.amountMinor;
    const buyerWins = (body.favour === 'raiser') === (dispute.raisedBy === order.buyerId);
    refundMinor = body.refundMinor === undefined || body.refundMinor === null
      ? (buyerWins ? held : 0)
      : Math.round(Number(body.refundMinor));
    if (!Number.isFinite(refundMinor) || refundMinor < 0 || refundMinor > held) {
      return error(400, 'invalid_decision', 'What goes back to the buyer is between nothing and the full amount held.');
    }
  }

  const sanctions = await sanctionsFrom(body.sanctions, dispute, repository);
  if (typeof sanctions === 'string') return error(400, 'invalid_sanction', sanctions);

  const settings = await marketSettings(repository);
  const now = new Date().toISOString();
  round.decision = { favour: body.favour, reasoning: reasoning.slice(0, 2000), refundMinor, sanctions, decidedAt: now };
  dispute.status = 'decided';
  dispute.respondByAt = null;
  dispute.escalateBy = inDays(settings.escalationWindowDays);
  const favoured = await favouredName(repository, dispute, body.favour);
  dispute.messages = [...dispute.messages, message(user.id, 'manager',
    `Decision (round ${round.n}): in favour of ${favoured}. ${reasoning}`, [])];
  dispute.updatedAt = now;

  // Final at once when nothing further could change it: three rounds given,
  // or the first two agreeing.
  let saved: Dispute;
  if (!escalationOpen(dispute)) {
    saved = await finalizeDecided(repository, dispute);
  } else {
    saved = await repository.updateDispute(dispute);
    await notify(repository, [dispute.raisedBy, dispute.againstUserId], {
      kind: 'dispute_decided',
      title: `Round ${round.n} decided in favour of ${favoured}`,
      body: reasoning.slice(0, 160),
      link: `/dispute/${dispute.id}`,
    });
  }

  return json(200, { dispute: saved, order: order ? await repository.getOrder(order.id) : null });
}

/**
 * POST /api/disputes/{id}/escalate - the side a decision went against asks
 * for another round, and pays for it.
 *
 * The system picks the next manager by availability - never one who already
 * held a round, never a party. Two escalations at most, and none once the
 * first two decisions agree.
 */
async function escalate(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  if (!communityActionsFor(dispute, user.id).includes('escalate')) {
    const decided = dispute.status === 'decided';
    return error(409, 'cannot_escalate', !decided
      ? 'There is no decision to escalate yet. A community manager decides first.'
      : 'Only the side the decision went against can escalate it, inside the escalation window.');
  }

  const settings = await marketSettings(repository);
  const n = roundsOf(dispute).length + 1;
  const manager = await pickManager(repository, excludedFrom(dispute));
  if (!manager) return error(409, 'no_manager', 'No other community manager is available right now. Try again soon.');

  const payment = await chargeFee(repository, {
    kind: 'escalation', payerId: user.id, amountMinor: roundFeeMinor(settings, n),
    currency: order?.currency ?? 'INR', reference: dispute.id, managerId: manager.id,
  }, settings);
  const round = newRound(n, manager, 'system', settings, payment, user.id);

  const now = new Date().toISOString();
  dispute.rounds = [...roundsOf(dispute), round];
  dispute.managerIds = [...new Set([...(dispute.managerIds ?? []), manager.id])];
  dispute.status = 'in_discussion';
  dispute.escalateBy = null;
  dispute.escalatedAt = now;
  dispute.messages = [...dispute.messages,
    message(user.id, voiceOf(dispute, order, user.id), `Escalated to round ${n}. ${round.managerName} will decide it.`, [])];
  dispute.updatedAt = now;
  const saved = await repository.updateDispute(dispute);

  await notify(repository, [manager.id], {
    kind: 'dispute_assigned', title: `You have an escalated dispute to decide (round ${n})`,
    body: dispute.reason.slice(0, 160), link: `/dispute/${dispute.id}`,
  });
  await notify(repository, [dispute.raisedBy, dispute.againstUserId], {
    kind: 'dispute_escalated', title: `A dispute you are in was escalated to round ${n}`,
    body: `${round.managerName} will decide it.`, link: `/dispute/${dispute.id}`,
  }, { except: user.id });

  return json(200, { dispute: saved, payment, simulatedPayment: true });
}

/**
 * POST /api/disputes/{id}/release - the manager holding a protected payment
 * pays it out as the final result says.
 *
 * Straight to the gateway: no operator approves it. Only once the result is
 * final, and only once.
 */
async function release(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const found = await loadDispute(request, repository, user.id);
  if ('refusal' in found) return found.refusal;
  const { dispute, order } = found;

  if (!order || order.protection?.escrowAgentId !== user.id) {
    return error(403, 'forbidden', 'Only the community manager holding this payment can release it.');
  }
  if (!communityActionsFor(dispute, user.id, { holdsMoney: holdsMoney(dispute), isHolder: true }).includes('request_release')
    || dispute.result?.how !== 'decided' || order.escrow.state !== 'disputed') {
    return error(409, 'not_releasable', dispute.release
      ? 'This payment has already been released.'
      : 'The result is not final yet, so the payment stays held.');
  }

  const toBuyer = dispute.resolution?.refundMinor ?? 0;
  const saved = await moveHeld(repository, dispute, order, toBuyer,
    `Dispute settled: ${dispute.resolutionNote ?? 'released on the final decision.'}`, user.id);
  dispute.updatedAt = new Date().toISOString();
  const updated = await repository.updateDispute(dispute);
  await notify(repository, [order.buyerId, order.sellerId], {
    kind: 'payment_released',
    title: 'The held payment was released on the final decision',
    body: order.itemName,
    link: `/dispute/${dispute.id}`,
  });
  return json(200, { dispute: updated, order: saved });
}

/* ── The community manager's workspace ───────────────────────────────────── */

/** The person asking, if they are an appointed community manager. */
async function asManager(request: HttpRequest, repository: Repo) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const me = await repository.getUserById(user.id);
  return me?.escrowRights ? me : null;
}

/**
 * GET /api/escrow/holdings - the protected payments in this manager's name,
 * and the disputes over them.
 */
async function holdings(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const me = await asManager(request, repository);
  if (!me) return error(403, 'not_an_escrow', 'You are not a community manager.');

  // Held or contested, both sides of the ledger. Bounded by what one person is
  // holding, which is the size that makes a scan the right answer.
  const all = await repository.listOrdersHeldBy(me.id);
  const rows = await Promise.all(
    all.map(async (order) => {
      const [buyer, seller] = await Promise.all([
        repository.getUserById(order.buyerId),
        repository.getUserById(order.sellerId),
      ]);
      const found = order.escrow.disputeId ? await repository.getDisputeById(order.escrow.disputeId) : null;
      const dispute = found ? await bringUpToDate(repository, found) : null;
      return {
        order: {
          id: order.id, itemName: order.itemName, currency: order.currency,
          lotId: order.lotId, status: order.status,
          escrow: order.escrow, protection: order.protection ?? null,
        },
        buyer: personRef(buyer, 'the buyer'),
        seller: sellerRef(seller),
        dispute,
        decidable: Boolean(dispute && !isClosed(dispute) && currentRound(dispute)?.managerId === me.id && !currentRound(dispute)?.decision),
        releasable: Boolean(dispute && dispute.result?.how === 'decided' && !dispute.release && order.escrow.state === 'disputed'),
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

/**
 * GET /api/community/cases - Services → My Job → Community Service.
 *
 * Every dispute this manager has held a round of, with the ones waiting on
 * them first; what they have earned; and how their decisions have stood up.
 */
async function cases(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const me = await asManager(request, repository);
  if (!me) return error(403, 'not_a_manager', 'Only community managers have a Community Service desk.');

  const all = await Promise.all((await repository.listDisputesForManager(me.id)).map((entry) => bringUpToDate(repository, entry)));
  const people = new Map((await repository.listUsersByIds([
    ...new Set(all.flatMap((dispute) => [dispute.raisedBy, dispute.againstUserId])),
  ])).map((person) => [person.id, person]));

  const rows = all.map((dispute) => {
    const round = currentRound(dispute);
    const mine = roundsOf(dispute).filter((entry) => entry.managerId === me.id);
    const waiting = !isClosed(dispute) && round?.managerId === me.id && !round.decision;
    return {
      id: dispute.id,
      reason: dispute.reason,
      status: dispute.status,
      about: dispute.subjectRef ? DISPUTE_SUBJECT_LABELS[dispute.subjectRef.type] : 'Purchase',
      protected: holdsMoney(dispute) && !dispute.subjectRef,
      raiser: personName(people.get(dispute.raisedBy)),
      respondent: personName(people.get(dispute.againstUserId)),
      round: round?.n ?? 1,
      myRounds: mine.map((entry) => entry.n),
      waitingOnMe: waiting,
      decideBy: waiting ? round!.decideBy : null,
      overdue: waiting && decisionOverdue(round),
      result: dispute.result ?? null,
      releasable: dispute.result?.how === 'decided' && !dispute.release && holdsMoney(dispute) && !dispute.subjectRef,
      updatedAt: dispute.updatedAt,
    };
  }).sort((a, b) => Number(b.waitingOnMe) - Number(a.waitingOnMe) || b.updatedAt.localeCompare(a.updatedAt));

  // Overturned: a round they decided whose decision did not end up standing.
  let decided = 0;
  let overturned = 0;
  let totalHours = 0;
  for (const dispute of all) {
    const standing = dispute.result?.how === 'decided' ? standingDecision(dispute) : null;
    for (const round of roundsOf(dispute)) {
      if (round.managerId !== me.id || !round.decision) continue;
      decided += 1;
      totalHours += (Date.parse(round.decision.decidedAt) - Date.parse(round.assignedAt)) / 3_600_000;
      if (standing && round.decision.favour !== standing.favour) overturned += 1;
    }
  }
  const earned = (await loadLedger(repository)).filter((entry) => entry.managerId === me.id);

  return json(200, {
    manager: { id: me.id, name: managerName(me), available: me.escrowRights!.available !== false, since: me.escrowRights!.grantedAt },
    openCases: await openCaseCount(repository, me.id),
    cases: rows,
    stats: {
      decided,
      overturned,
      averageHoursToDecide: decided ? Math.round(totalHours / decided) : null,
    },
    earnings: {
      totalMinor: earned.reduce((sum, entry) => sum + entry.managerShareMinor, 0),
      payments: earned.slice(-50).reverse().map((entry) => ({
        id: entry.id, kind: entry.kind, amountMinor: entry.amountMinor, shareMinor: entry.managerShareMinor,
        reference: entry.reference, paidAt: entry.paidAt, currency: entry.currency,
      })),
    },
  });
}

/** POST /api/community/availability - a manager switches themselves on or off for new cases. */
async function availability(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const me = await asManager(request, repository);
  if (!me) return error(403, 'not_a_manager', 'Only community managers set their availability.');
  const body = await bodyOf<{ available?: boolean }>(request);
  if (!body || typeof body.available !== 'boolean') return error(400, 'invalid_request', 'Say whether you are available.');
  me.escrowRights = { ...me.escrowRights!, available: body.available };
  me.updatedAt = new Date().toISOString();
  await repository.updateUser(me);
  return json(200, { available: body.available });
}

/**
 * GET /api/community/managers - who could hear a new dispute, for the picker.
 *
 * `against` leaves out the person it would be against, as well as the asker:
 * neither party can decide it.
 */
async function managers(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const against = request.query.get('against');
  const settings = await marketSettings(repository);
  const open = await availableManagers(repository, [user.id, ...(against ? [against] : [])]);
  return json(200, {
    feeMinor: settings.disputeFeeMinor,
    currency: 'INR',
    managers: open.map(({ user: manager, open: openNow }) => ({
      id: manager.id,
      name: managerName(manager),
      since: manager.escrowRights!.grantedAt,
      openCases: openNow,
    })),
  });
}

/** GET /api/community/notices?forum= - the warnings managers have put in front of everybody. */
async function notices(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  return json(200, { notices: await activeNotices(repository, request.query.get('forum') || null) });
}

/** GET /api/community/standing/{id} - the alert on a page, and its "dispute lost" flags. Public. */
async function standing(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const id = request.params.id;
  const person = id ? await repository.getUserById(id) : null;
  if (!person) return error(404, 'not_found', 'No such member.');
  return json(200, {
    alert: activeAlert(person),
    flags: person.standing?.flags ?? [],
    disputes: {
      won: (person.buyerTrust.disputesWon ?? 0) + (person.sellerTrust.disputesWon ?? 0),
      lost: person.buyerTrust.disputesLost + person.sellerTrust.disputesLost,
      settled: (person.buyerTrust.disputesSettled ?? 0) + (person.sellerTrust.disputesSettled ?? 0),
    },
  });
}

/**
 * Every hour, every open dispute is brought up to date: a manager two days
 * past their deadline loses the round to the next available one, and a
 * decision whose escalation window closed becomes final. Reads do the same,
 * so this only matters for disputes nobody opens.
 */
async function clock(_timer: Timer, context: InvocationContext): Promise<void> {
  try {
    const repository = await getRepository();
    for (const status of ['awaiting_response', 'in_discussion', 'decided']) {
      for (const dispute of await repository.listDisputes(status)) await bringUpToDate(repository, dispute);
    }
  } catch (err) {
    context.error('dispute clock failed', err);
  }
}

export const openDisputeRoute = handler(open);
export const raiseSubjectDisputeRoute = handler(raise);
export const readDisputeRoute = handler(read);
export const replyDisputeRoute = handler(reply);
export const offerDisputeRoute = handler(offer);
export const acceptDisputeRoute = handler(accept);
export const withdrawDisputeRoute = handler(withdraw);
export const escalateDisputeRoute = handler(escalate);
export const decideDisputeRoute = handler(decide);
export const releaseDisputeRoute = handler(release);
export const escrowHoldingsRoute = handler(holdings);
export const communityCasesRoute = handler(cases);
export const communityAvailabilityRoute = handler(availability);
export const communityManagersRoute = handler(managers);
export const communityNoticesRoute = handler(notices);
export const communityStandingRoute = handler(standing);
export const disputeClock = clock;

const anon = { authLevel: 'anonymous' } as const;

app.http('order-dispute', { ...anon, methods: ['POST'], route: 'orders/{id}/dispute', handler: openDisputeRoute });
app.http('dispute-raise', { ...anon, methods: ['POST'], route: 'disputes', handler: raiseSubjectDisputeRoute });
app.http('dispute-read', { ...anon, methods: ['GET'], route: 'disputes/{id}', handler: readDisputeRoute });
app.http('dispute-reply', { ...anon, methods: ['POST'], route: 'disputes/{id}/reply', handler: replyDisputeRoute });
app.http('dispute-offer', { ...anon, methods: ['POST'], route: 'disputes/{id}/offer', handler: offerDisputeRoute });
app.http('dispute-accept', { ...anon, methods: ['POST'], route: 'disputes/{id}/accept', handler: acceptDisputeRoute });
app.http('dispute-withdraw', { ...anon, methods: ['POST'], route: 'disputes/{id}/withdraw', handler: withdrawDisputeRoute });
app.http('dispute-escalate', { ...anon, methods: ['POST'], route: 'disputes/{id}/escalate', handler: escalateDisputeRoute });
app.http('dispute-decide', { ...anon, methods: ['POST'], route: 'disputes/{id}/decide', handler: decideDisputeRoute });
app.http('dispute-release', { ...anon, methods: ['POST'], route: 'disputes/{id}/release', handler: releaseDisputeRoute });
app.http('escrow-holdings', { ...anon, methods: ['GET'], route: 'escrow/holdings', handler: escrowHoldingsRoute });
app.http('community-cases', { ...anon, methods: ['GET'], route: 'community/cases', handler: communityCasesRoute });
app.http('community-availability', { ...anon, methods: ['POST'], route: 'community/availability', handler: communityAvailabilityRoute });
app.http('community-managers', { ...anon, methods: ['GET'], route: 'community/managers', handler: communityManagersRoute });
app.http('community-notices', { ...anon, methods: ['GET'], route: 'community/notices', handler: communityNoticesRoute });
app.http('community-standing', { ...anon, methods: ['GET'], route: 'community/standing/{id}', handler: communityStandingRoute });
app.timer('dispute-clock', { schedule: '0 7 * * * *', handler: disputeClock });
