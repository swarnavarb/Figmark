import { randomUUID } from 'node:crypto';
import {
  NEEDS_ADMIN, XP_PENALTY, inDays, autoReassignDue, currentRound, decisionOverdue, finalDue, holdsMoney, isClosed,
  releaseOverdue, releaseReassignDue, roundsOf, standingDecision,
} from '../../shared/disputes.js';
import type { ContentReport, ReportTarget } from '../../shared/moderation.js';
import type {
  CommunityStanding, Dispute, DisputeRound, DisputeSanction, FeePayment, Order, User,
} from '../../shared/models.js';
import { splitFee, type MarketSettings } from '../../shared/settings.js';
import type { getRepository } from './data/index.js';
import { loadReports, saveReports } from './moderation.js';
import { marketSettings } from './settings.js';
import { notify } from './functions/notify.js';
import { AuthError } from './auth/errors.js';
import { config } from './config.js';

/** A refusal thrown from deep in a flow, answered like any other by the route's handler. */
export class Refusal extends AuthError {}

/**
 * Community managers, and what their decisions do.
 *
 * A community manager is an account an operator has appointed (the stored
 * grant is `managerRights`). The system assigns one to every purchase bought
 * with buyer protection; they decide disputes round by round and release the
 * held payment once a result is agreed - but never hold money themselves:
 * Figmark holds every protected payment. This module holds what every route
 * needs around that - who may be assigned, the gateway the fees go through,
 * the clock that tells the operators about a slow manager and then reassigns
 * them, the clock that makes a decision final, and the sanctions a final
 * decision carries out.
 *
 * The queues an operator works (sanctions awaiting approval, the fee ledger,
 * the warnings shown to everyone) are site-content documents, like content
 * reports: the database is at its container ceiling, and each is small and
 * read whole.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** How many open cases a manager carries before the system stops assigning them more. */
export const MAX_OPEN_CASES = 25;

/** A manager is shown by their profile name; there is no separate listing name. */
export function managerName(user: Pick<User, 'displayName'>): string {
  return user.displayName;
}

export function personName(user: Pick<User, 'displayName' | 'sellerProfile'> | null | undefined): string {
  return user?.sellerProfile?.storefrontName ?? user?.displayName ?? 'Someone';
}

/** The name of the side a decision favours, for messages and notifications. */
export async function favouredName(repository: Repo, dispute: Pick<Dispute, 'raisedBy' | 'againstUserId'>, favour: 'raiser' | 'respondent'): Promise<string> {
  const id = favour === 'raiser' ? dispute.raisedBy : dispute.againstUserId;
  return id ? personName(await repository.getUserById(id)) : 'the other side';
}

export function isManager(user: Pick<User, 'managerRights' | 'suspended'> | null | undefined): user is User {
  return Boolean(user?.managerRights && !user.suspended);
}

/** Someone else changed the dispute between reading it and writing it. */
export class Busy extends Refusal {
  constructor() {
    super(409, 'dispute_changed', 'This dispute just changed. Reload it and try again.');
  }
}

/**
 * Saves a dispute only if nobody wrote it since it was read, and moves its
 * version on. Every write that decides anything goes through here, so two
 * people pressing at once - two releases, two accepts, two escalations - get
 * one success and one "reload", never a double payout or a double count.
 */
export async function commit(repository: Repo, dispute: Dispute): Promise<Dispute> {
  const expected = dispute.version ?? 0;
  const saved = await repository.saveDisputeIfVersion({ ...dispute, version: expected + 1 }, expected);
  if (!saved) throw new Busy();
  dispute.version = expected + 1;
  return saved;
}

/* ── The gateway ─────────────────────────────────────────────────────────── */

/**
 * Every fee goes through the payment gateway; nothing is paid person to person.
 *
 * There is no live gateway wired yet, so a charge is simulated and recorded
 * with a reference, the way checkout's own payment is (`simulatedPayment`).
 * Swapping in a real one changes this function and nothing that calls it.
 */
export async function chargeFee(
  repository: Repo,
  input: FeeInput,
  settings?: MarketSettings,
): Promise<FeePayment> {
  const payment = quoteFee(input, settings ?? await marketSettings(repository));
  await recordFee(repository, input, payment);
  return payment;
}

export type FeeInput = { kind: FeePayment['kind']; payerId: string; amountMinor: number; currency: string; reference: string; managerId: string | null };

/**
 * A fee worked out and given its gateway reference, not yet charged.
 *
 * Split from the charge so a caller can first commit whatever the fee is for -
 * and lose that race cleanly - before any money moves: two `pay` calls at once
 * must not both charge for protection.
 */
export function quoteFee(input: FeeInput, settings: MarketSettings): FeePayment {
  const { commissionMinor, managerShareMinor } = splitFee(input.amountMinor, settings.commissionBasisPoints);
  return {
    id: `fee_${randomUUID().slice(0, 12)}`,
    kind: input.kind,
    payerId: input.payerId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    commissionMinor,
    managerShareMinor,
    gatewayRef: `gw_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    paidAt: new Date().toISOString(),
  };
}

/** Charges a fee quoted by `quoteFee`. */
export async function recordFee(repository: Repo, input: FeeInput, payment: FeePayment): Promise<void> {
  await recordLedger(repository, { ...payment, reference: input.reference, managerId: input.managerId });
}

/** A payout of held money, through the same gateway. */
export function payoutRef(): string {
  return `gw_out_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/* ── Site-content queues ─────────────────────────────────────────────────── */

export const LEDGER_ID = 'fee-ledger';
export const ACTIONS_ID = 'dispute-actions';
export const NOTICES_ID = 'community-notices';
const LEDGER_KEEP = 5_000;
const ACTIONS_KEEP = 2_000;
const NOTICES_KEEP = 500;

export interface LedgerEntry extends FeePayment {
  /** The dispute or order it was paid on. */
  reference: string;
  managerId: string | null;
}

/** A sanction waiting on an operator, or decided by one. */
export interface PendingAction {
  id: string;
  disputeId: string;
  sanction: DisputeSanction;
  targetName: string;
  managerId: string;
  managerName: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

/** A warning a manager put in front of everybody: in the feed, or in one forum. */
export interface CommunityNotice {
  id: string;
  disputeId: string;
  targetUserId: string;
  targetName: string;
  message: string;
  /** Null means the feed. */
  forumId: string | null;
  managerName: string;
  createdAt: string;
  until: string;
}

async function loadList<T>(repository: Repo, id: string, key: string): Promise<T[]> {
  const saved = await repository.getSiteContent(id);
  const list = (saved?.data as Record<string, unknown> | undefined)?.[key];
  return Array.isArray(list) ? (list as T[]) : [];
}

/**
 * Changes one of the lists against what is stored at that moment, so two fees
 * paid at once both reach the ledger and two decisions both queue their
 * actions. The change may refuse by throwing; nothing is written then.
 */
export async function mutateList<T>(
  repository: Repo, id: string, key: string, keep: number, by: string, change: (list: T[]) => T[],
): Promise<void> {
  await repository.mutateSiteContent(id, (current) => {
    const now = new Date().toISOString();
    const list = (current?.data as Record<string, unknown> | undefined)?.[key];
    return {
      id,
      data: { [key]: change(Array.isArray(list) ? (list as T[]) : []).slice(-keep) },
      updatedBy: by,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
  });
}

export const loadLedger = (repository: Repo) => loadList<LedgerEntry>(repository, LEDGER_ID, 'entries');
async function recordLedger(repository: Repo, entry: LedgerEntry): Promise<void> {
  await mutateList<LedgerEntry>(repository, LEDGER_ID, 'entries', LEDGER_KEEP, entry.payerId, (entries) => [...entries, entry]);
}

export const loadActions = (repository: Repo) => loadList<PendingAction>(repository, ACTIONS_ID, 'actions');
export const mutateActions = (repository: Repo, by: string, change: (actions: PendingAction[]) => PendingAction[]) =>
  mutateList<PendingAction>(repository, ACTIONS_ID, 'actions', ACTIONS_KEEP, by, change);

export const loadNotices = (repository: Repo) => loadList<CommunityNotice>(repository, NOTICES_ID, 'notices');

/** Warnings still showing, for the feed (no forum) or one forum. */
export async function activeNotices(repository: Repo, forumId: string | null, now = Date.now()): Promise<CommunityNotice[]> {
  return (await loadNotices(repository))
    .filter((notice) => Date.parse(notice.until) > now && notice.forumId === forumId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ── Who may be assigned ─────────────────────────────────────────────────── */

/** Cases a manager currently holds: open disputes whose current round is theirs. */
export async function openCaseCount(repository: Repo, managerId: string): Promise<number> {
  const mine = await repository.listDisputesForManager(managerId);
  return mine.filter((dispute) => !isClosed(dispute) && currentRound(dispute)?.managerId === managerId).length;
}

/**
 * Managers who could take a new case: appointed, not suspended, switched on,
 * under their case limit, and neither party nor anybody in `exclude`.
 */
export async function availableManagers(
  repository: Repo,
  exclude: readonly string[],
): Promise<{ user: User; open: number }[]> {
  const all = (await repository.listManagers()).filter(
    (user) => isManager(user) && user.managerRights!.available !== false && !exclude.includes(user.id),
  );
  const counted = await Promise.all(all.map(async (user) => ({ user, open: await openCaseCount(repository, user.id) })));
  return counted.filter((entry) => entry.open < MAX_OPEN_CASES);
}

/**
 * The system's choice, based on availability: whoever is carrying the fewest
 * open cases, the longest-serving first on a tie. Never anybody who has
 * already held a round of this dispute, and never a party.
 */
export async function pickManager(repository: Repo, exclude: readonly string[]): Promise<User | null> {
  const candidates = await availableManagers(repository, exclude);
  candidates.sort((a, b) => a.open - b.open
    || a.user.managerRights!.grantedAt.localeCompare(b.user.managerRights!.grantedAt)
    || a.user.id.localeCompare(b.user.id));
  return candidates[0]?.user ?? null;
}

/** Everybody who may never decide a round of this dispute: the parties, and every manager who already held one. */
export function excludedFrom(dispute: Pick<Dispute, 'raisedBy' | 'againstUserId' | 'rounds'>, extra: readonly string[] = []): string[] {
  const held = roundsOf(dispute).flatMap((round) => [round.managerId, ...(round.reassigned ?? []).map((entry) => entry.fromId)]);
  return [dispute.raisedBy, dispute.againstUserId, ...held, ...extra];
}

/**
 * The next manager for this dispute. First anybody who has never touched it;
 * if that leaves nobody, a manager who was only reassigned away for being
 * slow may come back - a dispute stuck with no possible manager helps nobody.
 * Never a party, never the one holding the round now, never one who decided.
 */
export async function pickManagerFor(repository: Repo, dispute: Dispute): Promise<User | null> {
  const strict = await pickManager(repository, excludedFrom(dispute));
  if (strict) return strict;
  const decided = roundsOf(dispute).filter((round) => round.decision).map((round) => round.managerId);
  return pickManager(repository, [dispute.raisedBy, dispute.againstUserId, ...decided, currentRound(dispute)?.managerId ?? '']);
}

export function newRound(
  n: number,
  manager: User,
  assignedBy: DisputeRound['assignedBy'],
  settings: MarketSettings,
  payment: FeePayment | null,
  escalatedBy: string | null,
): DisputeRound {
  return {
    n,
    managerId: manager.id,
    managerName: managerName(manager),
    assignedAt: new Date().toISOString(),
    assignedBy,
    decideBy: inDays(settings.decisionDays),
    payment,
    escalatedBy,
    decision: null,
    reassigned: [],
  };
}

/** Hands the current round to another manager: an operator's choice, or the system's after the grace days. */
export async function reassignRound(
  repository: Repo,
  dispute: Dispute,
  to: User,
  by: 'admin' | 'system',
): Promise<Dispute> {
  const settings = await marketSettings(repository);
  const round = currentRound(dispute)!;
  const now = new Date().toISOString();
  round.reassigned = [...(round.reassigned ?? []), { fromId: round.managerId, fromName: round.managerName, at: now, by }];
  round.managerId = to.id;
  round.managerName = managerName(to);
  round.assignedAt = now;
  round.assignedBy = by;
  round.decideBy = inDays(settings.decisionDays);
  round.adminNotifiedAt = null;
  dispute.managerIds = [...new Set([...(dispute.managerIds ?? []), to.id])];
  dispute.messages = [...dispute.messages, {
    id: `dmsg_${randomUUID().slice(0, 10)}`,
    authorId: by === 'admin' ? 'figmark' : 'system',
    authorRole: 'company',
    body: `Round ${round.n} was reassigned to ${round.managerName}${by === 'system' ? ' automatically, as the previous manager did not decide in time' : ' by Figmark'}.`,
    evidence: [],
    createdAt: now,
  }];
  dispute.updatedAt = now;
  await notify(repository, [to.id], {
    kind: 'dispute_assigned',
    title: `You have a dispute to decide (round ${round.n})`,
    body: dispute.reason.slice(0, 140),
    link: `/dispute/${dispute.id}`,
  });
  return dispute;
}

/**
 * Tells the operators something needs them: the accounts named in
 * ADMIN_EMAILS, resolved to whoever signs in with those addresses.
 */
export async function notifyOperators(
  repository: Repo,
  draft: { title: string; body: string; link: string },
): Promise<void> {
  const operators = await Promise.all(config.adminEmails.map((email) => repository.getUserByIdentifier(email)));
  const ids = operators.filter((user): user is User => Boolean(user)).map((user) => user.id);
  if (ids.length > 0) await notify(repository, ids, { kind: 'dispute_overdue', ...draft });
}

/* ── The clock ───────────────────────────────────────────────────────────── */

/**
 * Brings a dispute up to date with the clock before anybody reads or acts on it.
 *
 * Three things happen on their own. A manager past their deadline is reported
 * to the operators; two days later, if no operator has reassigned the round,
 * it goes to another available manager. A decision both parties agreed with,
 * whose escalation window has closed, or which no further round could change
 * becomes final, and its consequences run.
 */
export async function bringUpToDate(repository: Repo, dispute: Dispute, now = new Date()): Promise<Dispute> {
  if (isClosed(dispute)) return dispute;
  let changed = false;

  // Opened before disputes had rounds: give it its first one now, with the
  // system's choice. No fee - it was raised before there was one.
  if (roundsOf(dispute).length === 0) {
    const manager = await pickManager(repository, [dispute.raisedBy, dispute.againstUserId]);
    if (manager) {
      const settings = await marketSettings(repository);
      const round = newRound(1, manager, 'system', settings, null, null);
      if (dispute.status === 'under_mediation') dispute.status = 'in_discussion';
      dispute.rounds = [round];
      dispute.managerIds = [manager.id];
      dispute.updatedAt = now.toISOString();
      changed = true;
    }
  }

  const round = currentRound(dispute);
  // A manager whose appointment was taken away, or who was suspended, does not
  // keep the round until the grace days run out: it moves now.
  const gone = round && !round.decision && !isManager(await repository.getUserById(round.managerId));
  if (round && (gone || autoReassignDue(round, now))) {
    const next = await pickManagerFor(repository, dispute);
    if (next) {
      await reassignRound(repository, dispute, next, 'system');
      changed = true;
    }
  }
  // Past the deadline: the operators hear about it once, and have two days to
  // reassign it themselves before the system does.
  const late = currentRound(dispute);
  if (late && decisionOverdue(late, now) && !late.adminNotifiedAt) {
    late.adminNotifiedAt = now.toISOString();
    dispute.updatedAt = now.toISOString();
    await notifyOperators(repository, {
      title: `${late.managerName} has not decided a dispute in time`,
      body: `Round ${late.n} was due ${late.decideBy.slice(0, 10)}. Reassign it, or it moves to another manager in two days.`,
      link: `/dispute/${dispute.id}`,
    });
    changed = true;
  }

  try {
    if (finalDue(dispute, now)) return await finalizeDecided(repository, dispute);
    return changed ? await commit(repository, dispute) : dispute;
  } catch (error) {
    // Someone else brought it up to date first: theirs stands.
    if (error instanceof Busy) return (await repository.getDisputeById(dispute.id)) ?? dispute;
    throw error;
  }
}

/* ── Final results ───────────────────────────────────────────────────────── */

type Tally = 'disputesLost' | 'disputesWon' | 'disputesSettled';

/** Which of a person's two records a dispute counts on: the side of the trade they were on, or their shop if they have one. */
async function bump(repository: Repo, userId: string | null, field: Tally, order: Order | null): Promise<void> {
  if (!userId) return;
  const person = await repository.getUserById(userId);
  if (!person) return;
  const asSeller = order ? order.sellerId === userId : Boolean(person.sellerProfile);
  const signals = asSeller ? person.sellerTrust : person.buyerTrust;
  signals[field] = (signals[field] ?? 0) + 1;
  person.updatedAt = new Date().toISOString();
  await repository.updateUser(person);
}

export async function orderOf(repository: Repo, dispute: Dispute): Promise<Order | null> {
  return dispute.subjectRef ? null : repository.getOrder(dispute.orderId);
}

/**
 * Makes a decided dispute final, from the decision that stands.
 *
 * Counts the result on both records, carries out the standing decision's
 * sanctions (the two that need an operator are queued for one instead), and
 * tells everybody. Held money does not move here: the manager whose decision
 * stands is given the release, and releases it as decided.
 */
export async function finalizeDecided(repository: Repo, dispute: Dispute): Promise<Dispute> {
  const standing = standingDecision(dispute);
  if (!standing) return dispute;
  const now = new Date().toISOString();
  const winnerId = standing.favour === 'raiser' ? dispute.raisedBy : dispute.againstUserId;
  const loserId = standing.favour === 'raiser' ? dispute.againstUserId : dispute.raisedBy;

  dispute.status = 'resolved';
  dispute.escalateBy = null;
  dispute.offer = null;
  dispute.resolvedAt = now;
  dispute.resolutionNote = standing.decision.reasoning;
  dispute.result = {
    how: 'decided', winnerId, loserId, favour: standing.favour, finalRound: standing.finalRound, terms: null, at: now,
  };
  dispute.updatedAt = now;

  const order = await orderOf(repository, dispute);
  if (order) {
    // The record the order screens already read, so a finished dispute
    // reads the same wherever it is shown.
    const buyerWon = winnerId === order.buyerId;
    const refund = standing.decision.refundMinor;
    dispute.resolution = {
      outcome: refund !== null && refund > 0 && refund < order.hold.amountMinor ? 'split' : buyerWon ? 'refund_buyer' : 'release_seller',
      refundMinor: refund ?? (buyerWon ? order.hold.amountMinor : 0),
      note: standing.decision.reasoning,
      decidedBy: roundsOf(dispute).find((round) => round.n === standing.finalRound)?.managerId ?? 'system',
      byCompany: false,
      decidedAt: now,
    };
  }

  // Claimed before anything is counted or carried out, so a result is only
  // ever made final once, however many readers arrive at the same moment.
  const saved = await commit(repository, dispute);
  await bump(repository, loserId, 'disputesLost', order);
  // A win counts on a profile only if the other side took part. Otherwise a
  // second account that never answers would be a way to buy a record of wins.
  const contested = [dispute.raisedBy, dispute.againstUserId].every((party) =>
    dispute.messages.some((entry) => entry.authorId === party));
  if (contested) await bump(repository, winnerId, 'disputesWon', order);

  const finalRound = roundsOf(dispute).find((round) => round.n === standing.finalRound)!;
  await carryOut(repository, saved, standing.decision.sanctions, finalRound);

  await notify(repository, [dispute.raisedBy, dispute.againstUserId], {
    kind: 'dispute_settled',
    title: 'A dispute you are in is final',
    body: `Decided in favour of ${await favouredName(repository, dispute, standing.favour)}. ${standing.decision.reasoning}`.slice(0, 200),
    link: `/dispute/${dispute.id}`,
  });
  return saved;
}

/* ── Releasing held money ─────────────────────────────────────────────────── */

/**
 * Who releases a resolved dispute's held money: the manager whose decision
 * stands, or - for a settlement the parties agreed - the manager on the round
 * it was agreed in. Their release is the third agreement.
 */
function releaserOf(dispute: Dispute): string | null {
  if (dispute.result?.how === 'decided') {
    return roundsOf(dispute).find((round) => round.n === dispute.result!.finalRound)?.managerId ?? null;
  }
  return currentRound(dispute)?.managerId ?? null;
}

/** Hands the release to a manager, with the decision deadline to do it in. */
async function assignRelease(
  repository: Repo,
  dispute: Dispute,
  to: User,
  by: 'admin' | 'system' | null,
  now = new Date(),
): Promise<void> {
  const settings = await marketSettings(repository);
  const previous = dispute.releaseDuty ?? null;
  dispute.releaseDuty = {
    managerId: to.id,
    managerName: managerName(to),
    assignedAt: now.toISOString(),
    dueBy: inDays(settings.decisionDays, now),
    adminNotifiedAt: null,
    reassigned: previous && by
      ? [...(previous.reassigned ?? []), { fromId: previous.managerId, fromName: previous.managerName, at: now.toISOString(), by }]
      : previous?.reassigned ?? [],
  };
  dispute.managerIds = [...new Set([...(dispute.managerIds ?? []), to.id])];
  if (previous && by) {
    dispute.messages = [...dispute.messages, {
      id: `dmsg_${randomUUID().slice(0, 10)}`,
      authorId: by === 'admin' ? 'figmark' : 'system',
      authorRole: 'company',
      body: `Releasing the payment was handed to ${managerName(to)}${by === 'system' ? ' automatically, as the previous manager did not release it in time' : ' by Figmark'}.`,
      evidence: [],
      createdAt: now.toISOString(),
    }];
  }
  dispute.updatedAt = now.toISOString();
  await notify(repository, [to.id], {
    kind: 'dispute_assigned',
    title: 'The result is agreed - release the held payment',
    body: dispute.reason.slice(0, 140),
    link: `/dispute/${dispute.id}`,
  });
}

/** An operator hands a pending release to another manager. */
export async function reassignRelease(repository: Repo, dispute: Dispute, to: User): Promise<Dispute> {
  await assignRelease(repository, dispute, to, 'admin');
  return commit(repository, dispute);
}

/**
 * Brings the release of a resolved dispute's held money up to date.
 *
 * Once a result is agreed - both parties and the manager's decision, or a
 * settlement the parties made - the money is released by a community
 * manager, never on its own. The responsible manager is given the release
 * with the decision deadline; missed, the operators are told; two days later
 * it moves to another active manager.
 */
export async function bringReleaseUpToDate(repository: Repo, dispute: Dispute, now = new Date()): Promise<Dispute> {
  if (dispute.status !== 'resolved' || dispute.release || !holdsMoney(dispute)) return dispute;
  const order = await orderOf(repository, dispute);
  if (!order || order.hold.state !== 'disputed' || order.hold.disputeId !== dispute.id) return dispute;
  const parties = [dispute.raisedBy, dispute.againstUserId];
  let changed = false;

  const duty = dispute.releaseDuty ?? null;
  if (!duty) {
    const responsible = releaserOf(dispute);
    const holder = responsible ? await repository.getUserById(responsible) : null;
    const manager = isManager(holder) ? holder : await pickManager(repository, parties);
    if (!manager) return dispute;
    await assignRelease(repository, dispute, manager, null, now);
    changed = true;
  } else {
    const gone = !isManager(await repository.getUserById(duty.managerId));
    if (gone || releaseReassignDue(duty, now)) {
      const next = await pickManager(repository, [...parties, duty.managerId]);
      if (next) {
        await assignRelease(repository, dispute, next, 'system', now);
        changed = true;
      }
    }
    const current = dispute.releaseDuty!;
    if (releaseOverdue(current, now) && !current.adminNotifiedAt) {
      current.adminNotifiedAt = now.toISOString();
      dispute.updatedAt = now.toISOString();
      await notifyOperators(repository, {
        title: `${current.managerName} has not released a held payment in time`,
        body: `It was due ${current.dueBy.slice(0, 10)}. Reassign it, or it moves to another manager in two days.`,
        link: `/dispute/${dispute.id}`,
      });
      changed = true;
    }
  }

  if (!changed) return dispute;
  try {
    return await commit(repository, dispute);
  } catch (error) {
    if (error instanceof Busy) return (await repository.getDisputeById(dispute.id)) ?? dispute;
    throw error;
  }
}

/** The settlement both parties agreed: nobody won, nobody lost, and both records say so. */
export async function recordSettled(repository: Repo, dispute: Dispute, order: Order | null): Promise<void> {
  await bump(repository, dispute.raisedBy, 'disputesSettled', order);
  await bump(repository, dispute.againstUserId, 'disputesSettled', order);
}

/* ── Sanctions ───────────────────────────────────────────────────────────── */

function standingOf(user: User): CommunityStanding {
  return user.standing ?? { xpPenalty: 0, ratingPenalty: 0, alert: null, flags: [] };
}

/** Which report target a subject is, for hiding it through the moderation index. */
function reportTargetOf(type: string): ReportTarget | null {
  return (['review', 'store_review', 'comment', 'post_comment', 'post', 'forum_post'] as const)
    .find((target) => target === type) ?? null;
}

/** Runs the ones a manager may carry out alone; queues the two that wait for an operator. */
async function carryOut(repository: Repo, dispute: Dispute, sanctions: DisputeSanction[], round: DisputeRound): Promise<void> {
  if (sanctions.length === 0) return;
  const now = new Date().toISOString();
  const queued: PendingAction[] = [];
  for (const sanction of sanctions) {
    const target = await repository.getUserById(sanction.targetUserId);
    if (NEEDS_ADMIN.includes(sanction.kind)) {
      queued.push({
        id: `act_${randomUUID().slice(0, 12)}`,
        disputeId: dispute.id,
        sanction,
        targetName: personName(target),
        managerId: round.managerId,
        managerName: round.managerName,
        status: 'pending',
        createdAt: now,
        decidedAt: null,
        decidedBy: null,
        note: null,
      });
      continue;
    }
    await applySanction(repository, dispute, sanction, round.managerName, round.managerId);
  }
  if (queued.length > 0) {
    await mutateActions(repository, round.managerId, (actions) => [...actions, ...queued]);
  }
}

/**
 * Carries out one sanction. Called directly for the ones a manager decides
 * alone, and by the operator's approval for the other two.
 */
export async function applySanction(
  repository: Repo,
  dispute: Dispute,
  sanction: DisputeSanction,
  byName: string,
  byId: string,
): Promise<void> {
  const now = new Date();
  const target = await repository.getUserById(sanction.targetUserId);
  if (!target) return;
  const standing = standingOf(target);

  switch (sanction.kind) {
    case 'remove_content': {
      const subject = dispute.subjectRef;
      const reportTarget = subject ? reportTargetOf(subject.type) : null;
      if (!subject || !reportTarget) return;
      if (reportTarget === 'review') await repository.deleteReview(subject.parentId, subject.id);
      if (reportTarget === 'post' || reportTarget === 'forum_post') await repository.deletePost(subject.parentId, subject.id);
      // Recorded as a removal the moderation index reads, so whatever cannot
      // be deleted outright is hidden from every reader instead.
      const removal: ContentReport = {
        id: `rpt_${randomUUID().slice(0, 12)}`,
        kind: 'dispute',
        targetType: reportTarget,
        targetId: subject.id,
        parentId: subject.parentId,
        authorId: subject.ownerId,
        excerpt: subject.excerpt,
        reporterId: byId,
        reporterName: byName,
        reason: `Removed by a community manager's decision on dispute ${dispute.id}.`,
        status: 'removed',
        createdAt: now.toISOString(),
        resolvedAt: now.toISOString(),
        resolvedBy: byName,
        resolutionNote: sanction.message || null,
      };
      await saveReports(repository, [...await loadReports(repository), removal], byId);
      return;
    }
    case 'warning_post': {
      await mutateList<CommunityNotice>(repository, NOTICES_ID, 'notices', NOTICES_KEEP, byId, (notices) => [...notices, {
        id: `ntc_${randomUUID().slice(0, 12)}`,
        disputeId: dispute.id,
        targetUserId: target.id,
        targetName: personName(target),
        message: sanction.message,
        forumId: sanction.forumId ?? null,
        managerName: byName,
        createdAt: now.toISOString(),
        until: inDays(sanction.days ?? 7, now),
      }]);
      return;
    }
    case 'flag':
      standing.flags = [{ disputeId: dispute.id, message: sanction.message, at: now.toISOString() }, ...standing.flags].slice(0, 50);
      break;
    case 'rating_reduction':
      standing.ratingPenalty = Math.min(100, standing.ratingPenalty + (sanction.points ?? 5));
      break;
    case 'alert_banner':
      standing.alert = { message: sanction.message, until: inDays(sanction.days ?? 7, now), disputeId: dispute.id };
      break;
    case 'xp_deduction':
      standing.xpPenalty += XP_PENALTY[sanction.severity ?? 'light'];
      break;
  }
  target.standing = standing;
  target.updatedAt = now.toISOString();
  await repository.updateUser(target);
  await notify(repository, [target.id], {
    kind: 'dispute_action',
    title: 'A community manager\'s decision was applied to your account',
    body: sanction.message.slice(0, 160),
    link: `/dispute/${dispute.id}`,
  });
}

/** The alert on someone's page, if one is still showing. */
export function activeAlert(user: Pick<User, 'standing'>, now = Date.now()): CommunityStanding['alert'] {
  const alert = user.standing?.alert ?? null;
  return alert && Date.parse(alert.until) > now ? alert : null;
}
