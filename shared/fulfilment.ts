import {
  DIRECT_STAGES,
  DIRECT_STAGE_LABELS,
  LOT_STAGES,
  LOT_STAGE_LABELS,
  type DirectStage,
  type FulfilmentStage,
  type LotStage,
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

export function isDirect(order: Pick<Order, 'lotId'>): boolean {
  return order.lotId === DIRECT_LOT_ID;
}

/** The stage vocabulary an order is tracked against. */
export function stagesFor(order: Pick<Order, 'lotId'>): readonly FulfilmentStage[] {
  return isDirect(order) ? DIRECT_STAGES : LOT_STAGES;
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
