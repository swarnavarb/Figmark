import {
  BUYER_DISPUTE_REASONS,
  SELLER_DISPUTE_REASONS,
  type DisputeOutcome,
  type DisputeReason,
} from './enums.js';
import type {
  Dispute, DisputeDecision, DisputeRound, DisputeSanctionKind, DisputeSubjectType, DisputeTopic, Order,
} from './models.js';
import { ACTION_XP } from './quest.js';
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

/** Every topic, in the words both sides read. */
export const DISPUTE_TOPIC_LABELS: Record<DisputeTopic, string> = {
  escrow: 'Held payment',
  payment_rejected: 'Payment not acknowledged',
  refund_rejected: 'Refund not acknowledged',
  reversal_rejected: 'Reversal not acknowledged',
  general: 'Dispute',
};

/** Only an escrow dispute is about money the marketplace is holding, so only it can settle by moving money. */
export function holdsMoney(dispute: Pick<Dispute, 'topic'>): boolean {
  return (dispute.topic ?? 'escrow') === 'escrow';
}

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
  dispute: Pick<Dispute, 'status' | 'raisedBy' | 'offer' | 'respondByAt' | 'topic'>,
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
  // Offers are a split of held money, so they exist only where money is held.
  const money = holdsMoney(dispute);
  if (money && dispute.offer && dispute.offer.fromUserId !== viewerId) actions.push('accept');

  // Under mediation the company holds the pen. The thread stays open, because
  // the mediator is reading it and both parties may still be asked things.
  if (dispute.status !== 'under_mediation') {
    if (money) actions.push('offer');
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

/* ── Community disputes: rounds, escalation and the final result ────────── */

/**
 * The rules every dispute now runs on, whatever it is about.
 *
 * A community manager decides each round, and there are at most three: the
 * dispute as raised, and two escalations. Every round is paid - raising by the
 * person raising it (free on a protected purchase, whose protection fee
 * already bought it), an escalation by whoever escalates - and nothing is
 * refunded, whatever the outcome.
 *
 * The final result is the best of the decisions given: two that agree stand,
 * whatever came before or after. When the first two agree a third round could
 * not change anything, so it is not offered. When nobody escalates in time,
 * the latest decision stands.
 *
 * Either party may settle with the other at any point before it is final,
 * without the manager. A settlement has no winner and no loser, and voids
 * every decision before it.
 */

export const MAX_ROUNDS = 3;
/** Days past a manager's deadline before the system reassigns, if no operator did. */
export const REASSIGN_GRACE_DAYS = 2;

const DAY_MS = 86_400_000;

export const DISPUTE_SUBJECT_LABELS: Record<DisputeSubjectType, string> = {
  review: 'Trade review',
  store_review: 'Page review',
  comment: 'Listing comment',
  post_comment: 'Post comment',
  post: 'Feed post',
  forum_post: 'Forum post',
  user: 'Member',
};

export const SANCTION_LABELS: Record<DisputeSanctionKind, string> = {
  remove_content: 'Remove the content',
  warning_post: 'Warning post in the feed or a forum',
  flag: 'Flag as "dispute lost"',
  rating_reduction: 'Reduce their rating',
  alert_banner: 'Alert banner on their page',
  xp_deduction: 'Take XP away',
};

/** The two that wait for an operator after the manager decides. */
export const NEEDS_ADMIN: readonly DisputeSanctionKind[] = ['alert_banner', 'xp_deduction'];

/** XP taken for each severity: lost disputes cost a store severely, as they should. */
export const XP_PENALTY = { light: ACTION_XP * 10, severe: ACTION_XP * 40 } as const;

/** Every round, old disputes included: one from before rounds existed reads as having none yet. */
export function roundsOf(dispute: Pick<Dispute, 'rounds'>): DisputeRound[] {
  return dispute.rounds ?? [];
}

export function currentRound(dispute: Pick<Dispute, 'rounds'>): DisputeRound | null {
  const rounds = roundsOf(dispute);
  return rounds[rounds.length - 1] ?? null;
}

export function isClosed(dispute: Pick<Dispute, 'status'>): boolean {
  return dispute.status === 'resolved' || dispute.status === 'withdrawn';
}

/** The decisions given so far, in round order. */
export function decisionsOf(dispute: Pick<Dispute, 'rounds'>): { round: number; decision: DisputeDecision }[] {
  return roundsOf(dispute)
    .filter((round) => round.decision)
    .map((round) => ({ round: round.n, decision: round.decision! }));
}

/**
 * Where the decisions point: two that agree, or else the latest.
 *
 * `finalRound` is the round whose decision stands - the latest of the two that
 * agree - so its sanctions and its refund are the ones carried out.
 */
export function standingDecision(dispute: Pick<Dispute, 'rounds'>): { favour: 'raiser' | 'respondent'; finalRound: number; decision: DisputeDecision } | null {
  const given = decisionsOf(dispute);
  if (given.length === 0) return null;
  for (const favour of ['raiser', 'respondent'] as const) {
    const agreeing = given.filter((entry) => entry.decision.favour === favour);
    if (agreeing.length >= 2) {
      const last = agreeing[agreeing.length - 1]!;
      return { favour, finalRound: last.round, decision: last.decision };
    }
  }
  const latest = given[given.length - 1]!;
  return { favour: latest.decision.favour, finalRound: latest.round, decision: latest.decision };
}

/** True once two decisions agree: nothing a further round decides could change it. */
export function majorityReached(dispute: Pick<Dispute, 'rounds'>): boolean {
  const given = decisionsOf(dispute);
  return (['raiser', 'respondent'] as const).some(
    (favour) => given.filter((entry) => entry.decision.favour === favour).length >= 2,
  );
}

/** The parties: who raised it, and who it is against. */
export function partiesOf(dispute: Pick<Dispute, 'raisedBy' | 'againstUserId'>): [string, string] {
  return [dispute.raisedBy, dispute.againstUserId];
}

export function isParty(dispute: Pick<Dispute, 'raisedBy' | 'againstUserId'>, userId: string): boolean {
  return dispute.raisedBy === userId || dispute.againstUserId === userId;
}

/** Who the latest decision went against - the only person who may escalate it. */
export function losingPartyOfLatest(dispute: Pick<Dispute, 'rounds' | 'raisedBy' | 'againstUserId'>): string | null {
  const latest = [...decisionsOf(dispute)].pop();
  if (!latest) return null;
  return latest.decision.favour === 'raiser' ? dispute.againstUserId : dispute.raisedBy;
}

/** Whether another round can be had at all, whoever asks. */
export function escalationOpen(
  dispute: Pick<Dispute, 'status' | 'rounds' | 'escalateBy'>,
  now = new Date(),
): boolean {
  if (dispute.status !== 'decided') return false;
  const rounds = roundsOf(dispute);
  if (rounds.length >= MAX_ROUNDS) return false;
  // The first two agreeing settles it: a third could not change the result.
  if (majorityReached(dispute)) return false;
  return Boolean(dispute.escalateBy && new Date(dispute.escalateBy).getTime() > now.getTime());
}

/**
 * Whether a decided dispute is now final: no further round can be had, or the
 * window to ask for one has closed. Read from the clock, the way auto-release
 * is, so no scheduler has to remember to do it.
 */
export function finalDue(dispute: Pick<Dispute, 'status' | 'rounds' | 'escalateBy'>, now = new Date()): boolean {
  if (dispute.status !== 'decided') return false;
  return !escalationOpen(dispute, now);
}

/** A manager past their deadline, waiting on an operator to reassign. */
export function decisionOverdue(round: Pick<DisputeRound, 'decideBy' | 'decision'> | null, now = new Date()): boolean {
  return Boolean(round && !round.decision && new Date(round.decideBy).getTime() <= now.getTime());
}

/** Two days past the deadline with no operator acting: the system reassigns. */
export function autoReassignDue(round: Pick<DisputeRound, 'decideBy' | 'decision'> | null, now = new Date()): boolean {
  return Boolean(round && !round.decision
    && new Date(round.decideBy).getTime() + REASSIGN_GRACE_DAYS * DAY_MS <= now.getTime());
}

export type CommunityAction = 'reply' | 'propose_settlement' | 'accept_settlement' | 'withdraw' | 'escalate' | 'decide' | 'request_release';

/**
 * What this person may do now, on the dispute page.
 *
 * The parties talk, settle and escalate; the manager on the current round
 * talks and decides; the manager who holds a protected purchase's money asks
 * for it to be released once the result is final.
 */
export function communityActionsFor(
  dispute: Pick<Dispute, 'status' | 'raisedBy' | 'againstUserId' | 'offer' | 'rounds' | 'escalateBy' | 'topic' | 'release'>
    & Partial<Pick<Dispute, 'respondByAt'>>,
  viewerId: string,
  options: { holdsMoney?: boolean; isHolder?: boolean } = {},
  now = new Date(),
): CommunityAction[] {
  const round = currentRound(dispute);
  const actions: CommunityAction[] = [];
  const party = isParty(dispute, viewerId);
  const managing = round?.managerId === viewerId;

  if (isClosed(dispute)) {
    if (options.holdsMoney && options.isHolder && dispute.status === 'resolved' && !dispute.release) {
      actions.push('request_release');
    }
    return actions;
  }

  if (party || managing) actions.push('reply');
  if (party) {
    actions.push('propose_settlement');
    if (dispute.offer && dispute.offer.fromUserId !== viewerId) actions.push('accept_settlement');
    // Withdrawing is for before anyone has decided anything: afterwards it
    // would be a way out of a decision that went against you.
    if (dispute.raisedBy === viewerId && decisionsOf(dispute).length === 0) actions.push('withdraw');
    if (escalationOpen(dispute, now) && losingPartyOfLatest(dispute) === viewerId) actions.push('escalate');
  }
  // Round one waits for the other side to answer, or for their days to run out.
  const heard = !(round?.n === 1 && dispute.status === 'awaiting_response'
    && dispute.respondByAt && new Date(dispute.respondByAt).getTime() > now.getTime());
  if (managing && round && !round.decision && heard) actions.push('decide');
  return actions;
}

/** The synthetic partition a dispute about something other than an order lives in. */
export function subjectPartition(type: DisputeSubjectType, id: string): string {
  return `subject:${type}:${id}`;
}

export function isSubjectDispute(dispute: Pick<Dispute, 'subjectRef'>): boolean {
  return Boolean(dispute.subjectRef);
}

/** Days from now, as an ISO date: deadlines are stored, never re-derived. */
export function inDays(days: number, from = new Date()): string {
  return new Date(from.getTime() + days * DAY_MS).toISOString();
}
