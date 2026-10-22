import type { PreOrder, PreOrderFullRule, PreOrderShortRule } from './models.js';

/**
 * Where a pre-order has got to, from the two counts it keeps.
 *
 * One definition, used by the API when it answers and by the app when it draws
 * a feed card from the counters denormalised onto the listing. Two copies of
 * this rule would drift, and the symptom would be a card that says "going
 * ahead" opening a page that says "2 to go".
 */

/**
 * `deciding` is the pause between coming up short and the seller saying what
 * happens next - only under `whenShort: 'ask'`.
 */
export type PreOrderState = 'open' | 'nearly' | 'called' | 'going' | 'deciding' | 'closed';

/** How full it has to get before everyone in it is told it nearly made it. */
export const NEARLY_FRACTION = 0.9;

/** How long a seller has to decide about a short campaign before it cancels itself. */
export const DECISION_HOURS = 72;

/** The most a campaign can ask for, and the furthest out its cutoff can be. */
export const MAX_THRESHOLD = 10_000;
export const MAX_CUTOFF_DAYS = 365;

export const SHORT_RULES: readonly PreOrderShortRule[] = ['cancel', 'proceed', 'ask'];
export const FULL_RULES: readonly PreOrderFullRule[] = ['keep_open', 'waitlist', 'close'];

export const SHORT_RULE_LABELS: Record<PreOrderShortRule, string> = {
  cancel: 'Cancel and refund everyone',
  proceed: 'Go ahead with whoever is in',
  ask: 'Ask me first',
};

export const FULL_RULE_LABELS: Record<PreOrderFullRule, string> = {
  keep_open: 'Keep taking bookings',
  waitlist: 'Put them on a waitlist',
  close: 'Stop taking anyone',
};

export interface PreOrderView {
  fillThreshold: number;
  /** Units somebody has actually ordered. */
  filledCount: number;
  /** Units somebody said they would take if enough others did. */
  pledgedCount: number;
  /** The two together, which is what the threshold is measured against. */
  committed: number;
  /** How many more units it needs. Never negative. */
  toGo: number;
  cutoffAt: string;
  state: PreOrderState;
  pledgeDueAt: string | null;
  closedAt: string | null;
  /** Units queued behind a full campaign. Never part of `committed`. */
  waitlistCount: number;
  whenShort: PreOrderShortRule;
  whenFull: PreOrderFullRule;
  decisionDueAt: string | null;
  /** The seller chose to go ahead below the threshold. */
  proceededShort: boolean;
}

export const shortRuleOf = (preOrder: Pick<PreOrder, 'whenShort'>): PreOrderShortRule => preOrder.whenShort ?? 'cancel';
export const fullRuleOf = (preOrder: Pick<PreOrder, 'whenFull'>): PreOrderFullRule => preOrder.whenFull ?? 'keep_open';

/** The seller has said it goes ahead - by filling, or by choosing to with fewer. */
export const isGoingAhead = (preOrder: PreOrder): boolean =>
  !preOrder.closedAt && Boolean(preOrder.filledAt || preOrder.proceededShortAt);

/**
 * Still taking bookings, as far as a card can tell from the stored campaign.
 *
 * Closing at the cutoff is done by the API when it next reconciles the
 * campaign, so a stored copy can still say open for a while after it is not.
 * Badges ask this rather than whether there is a pre-order at all, so a card
 * stops advertising one the moment its cutoff passes.
 */
export const isTakingBookings = (preOrder: PreOrder | null | undefined, now = Date.now()): boolean => {
  if (!preOrder || preOrder.closedAt || preOrder.decisionDueAt) return false;
  // The same rule booking is refused by (preOrderRefusal), seen by a stranger:
  // once it has gone ahead a waitlist still takes names past the cutoff.
  if (isGoingAhead(preOrder)) {
    const rule = fullRuleOf(preOrder);
    if (rule === 'close') return false;
    if (rule === 'waitlist') return true;
  }
  return Date.parse(preOrder.cutoffAt) > now;
};

/**
 * The states, in the order they exclude each other.
 *
 * `going` before `called` because enough money has actually arrived, which is a
 * stronger claim than enough people having promised - and the difference is the
 * whole reason the two counts are kept apart. A campaign the seller took ahead
 * short is measured against what is in it rather than the threshold it missed.
 */
export function stateOf(preOrder: PreOrder, filledCount: number, committed: number): PreOrderState {
  if (preOrder.closedAt) return 'closed';
  if (preOrder.decisionDueAt) return 'deciding';
  if (preOrder.proceededShortAt) return filledCount >= committed ? 'going' : 'called';
  if (filledCount >= preOrder.fillThreshold) return 'going';
  if (committed >= preOrder.fillThreshold) return 'called';
  if (committed >= Math.ceil(preOrder.fillThreshold * NEARLY_FRACTION)) return 'nearly';
  return 'open';
}

/**
 * The view, from the counters as stored.
 *
 * `counts` overrides them where something authoritative is to hand - the API
 * counts the pledges and orders themselves rather than trusting a denormalised
 * number it is about to rewrite.
 */
export function preOrderView(
  preOrder: PreOrder,
  counts?: { filledCount: number; pledgedCount: number; waitlistCount?: number },
): PreOrderView {
  const filledCount = counts?.filledCount ?? preOrder.filledCount;
  const pledgedCount = counts?.pledgedCount ?? preOrder.pledgedCount ?? 0;
  const committed = filledCount + pledgedCount;

  return {
    fillThreshold: preOrder.fillThreshold,
    filledCount,
    pledgedCount,
    committed,
    toGo: Math.max(0, preOrder.fillThreshold - committed),
    cutoffAt: preOrder.cutoffAt,
    state: stateOf(preOrder, filledCount, committed),
    pledgeDueAt: preOrder.pledgeDueAt ?? null,
    closedAt: preOrder.closedAt ?? null,
    waitlistCount: counts?.waitlistCount ?? preOrder.waitlistCount ?? 0,
    whenShort: shortRuleOf(preOrder),
    whenFull: fullRuleOf(preOrder),
    decisionDueAt: preOrder.decisionDueAt ?? null,
    proceededShort: Boolean(preOrder.proceededShortAt),
  };
}

/**
 * Why a cutoff cannot be this, or null when it can: a real date, in the
 * future, and within a year. Shared so the sell form says the same thing the
 * API refuses with.
 */
export function cutoffProblem(cutoffAt: unknown, now = Date.now()): string | null {
  const at = typeof cutoffAt === 'string' ? Date.parse(cutoffAt) : NaN;
  if (!Number.isFinite(at)) return 'Pick a date for bookings to close.';
  if (at <= now) return 'Bookings have to close in the future.';
  if (at > now + MAX_CUTOFF_DAYS * 86_400_000) return `Bookings can stay open for at most ${MAX_CUTOFF_DAYS} days.`;
  return null;
}

/** Why a threshold cannot be this, or null when it can. */
export function thresholdProblem(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Bookings needed must be a number.';
  const n = Math.round(value);
  if (n < 2) return 'A pre-order needs at least 2 bookings.';
  if (n > MAX_THRESHOLD) return `A pre-order can ask for at most ${MAX_THRESHOLD.toLocaleString('en-IN')} bookings.`;
  return null;
}
