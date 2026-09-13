import {
  DIRECT_STAGES,
  DIRECT_STAGE_LABELS,
  LOT_STAGES,
  LOT_STAGE_LABELS,
  type DirectStage,
  type FulfilmentStage,
  type LotStage,
  type Sourcing,
} from './enums.js';
import type { Order } from './models.js';

/**
 * Partition key for an order with no shipment batch behind it.
 *
 * `orders` is partitioned by `/lotId`, so a direct domestic sale still needs a
 * value. A single shared sentinel keeps those orders in one partition, which is
 * fine because nothing ever asks for "the manifest of all direct sales".
 */
export const DIRECT_LOT_ID = 'direct';

/**
 * An import that has been sold and has no batch behind it yet.
 *
 * Distinct from `direct`, and the distinction is the whole point: a direct sale
 * ships off a shelf and will never be in a batch, while this one is waiting for
 * the next run to be opened. Filed under `direct` - which is what happened
 * before this existed - the buyer was shown a three-step domestic timeline for
 * something crossing an ocean, and the item was invisible to the screen where
 * a shop fills a batch.
 */
export const AWAITING_LOT_ID = 'awaiting_lot';

export function isDirect(order: Pick<Order, 'lotId'>): boolean {
  return order.lotId === DIRECT_LOT_ID;
}

/** Sold, bound for a batch, not yet in one. */
export function awaitingLot(order: Pick<Order, 'lotId'>): boolean {
  return order.lotId === AWAITING_LOT_ID;
}

/** In a real batch, as opposed to either sentinel. */
export function inLot(order: Pick<Order, 'lotId'>): boolean {
  return !isDirect(order) && !awaitingLot(order);
}

/**
 * How far an item with no batch can honestly be tracked.
 *
 * Two steps, and then it stops. Everything after "received at the warehouse"
 * is a fact about a consignment, and this item is not in one - so the timeline
 * ends here and the screen says why, rather than drawing five hollow circles
 * that imply a journey nobody has booked.
 */
export const PRE_LOT_STAGES: readonly LotStage[] = ['ordering', 'china_wh_received'];

/** The stage vocabulary an order is tracked against. */
export function stagesFor(order: Pick<Order, 'lotId'>): readonly FulfilmentStage[] {
  if (isDirect(order)) return DIRECT_STAGES;
  return awaitingLot(order) ? PRE_LOT_STAGES : LOT_STAGES;
}

export function labelFor(stage: FulfilmentStage): string {
  return (
    (LOT_STAGE_LABELS as Record<string, string>)[stage] ??
    (DIRECT_STAGE_LABELS as Record<string, string>)[stage] ??
    stage
  );
}

/**
 * How far through its pipeline an order is, 0-1.
 *
 * Read from the order's own history rather than its current stage, so an item
 * moved into a later shipment does not appear to go backwards: progress is the
 * furthest stage it has ever reached.
 */
export function progressOf(order: Pick<Order, 'lotId' | 'stage' | 'stageHistory'>): number {
  const stages = stagesFor(order);
  const reached = [order.stage, ...order.stageHistory.map((event) => event.stage)]
    .map((stage) => stages.indexOf(stage))
    .filter((index) => index >= 0);
  if (reached.length === 0) return 0;
  return (Math.max(...reached) + 1) / stages.length;
}

/** The furthest stage the order has reached, for rendering the timeline. */
export function furthestStage(
  order: Pick<Order, 'lotId' | 'stage' | 'stageHistory'>,
): FulfilmentStage {
  const stages = stagesFor(order);
  const best = [order.stage, ...order.stageHistory.map((event) => event.stage)].reduce(
    (furthest, stage) => (stages.indexOf(stage) > stages.indexOf(furthest) ? stage : furthest),
    stages[0]!,
  );
  return best;
}

/** The next stage a seller can advance a lot to, or null at the end. */
export function nextStage(stage: LotStage): LotStage | null {
  const index = LOT_STAGES.indexOf(stage);
  return index >= 0 && index < LOT_STAGES.length - 1 ? LOT_STAGES[index + 1]! : null;
}

/** Whether a pre-order is still accepting bookings. */
export function preOrderOpen(preOrder: { cutoffAt: string } | null): boolean {
  return preOrder !== null && Date.parse(preOrder.cutoffAt) > Date.now();
}

export type { DirectStage, FulfilmentStage, LotStage };

/**
 * How a listing is sourced.
 *
 * A batch settles it: an item in one is an import, whatever anybody typed. With
 * no batch the stored answer stands, because filing an item into a batch is
 * bookkeeping a shop does weeks after the item went up - the listing route has
 * allowed an import to wait for its batch for some time, and reading that back
 * as "in hand" was this function telling the buyer the opposite of what the
 * seller said, on a screen the seller could not correct.
 */
export function sourcingOf(listing: { sourcing?: Sourcing; lotId: string | null }): Sourcing {
  if (listing.lotId) return 'import';
  return listing.sourcing === 'import' ? 'import' : 'in_hand';
}
