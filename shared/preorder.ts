import type { PreOrder } from './models.js';

/**
 * Where a pre-order has got to, from the two counts it keeps.
 *
 * One definition, used by the API when it answers and by the app when it draws
 * a feed card from the counters denormalised onto the listing. Two copies of
 * this rule would drift, and the symptom would be a card that says "going
 * ahead" opening a page that says "2 to go".
 */

export type PreOrderState = 'open' | 'nearly' | 'called' | 'going' | 'closed';

/** How full it has to get before everyone in it is told it nearly made it. */
export const NEARLY_FRACTION = 0.9;

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
}

/**
 * The five states, in the order they exclude each other.
 *
 * `going` before `called` because enough money has actually arrived, which is a
 * stronger claim than enough people having promised - and the difference is the
 * whole reason the two counts are kept apart.
 */
export function stateOf(preOrder: PreOrder, filledCount: number, committed: number): PreOrderState {
  if (preOrder.closedAt) return 'closed';
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
  counts?: { filledCount: number; pledgedCount: number },
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
  };
}
