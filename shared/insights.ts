import { countCheckpoints, type CheckpointCount } from './board.js';
import { ORDER_CHECKPOINTS, type OrderCheckpoint } from './enums.js';
import type { Lot, Order } from './models.js';
import { isCancelledLike } from './orders.js';

/**
 * What a shop's consignments have actually been doing.
 *
 * Ported from AxisTwelve, which is a manifest tool for exactly this trade: you
 * paste a spreadsheet, it gives you a lot, and you tick items through China →
 * India → ready → packed → dispatched. Its analytics are the best part of it,
 * and they turn out to need nothing that is not already here - its six
 * per-item flags are these six order checkpoints, one for one, and Figmark
 * already stores each as a timestamp rather than a boolean. So every number
 * below is the packing board's own rows read a different way. Nothing new is
 * written to produce any of it.
 *
 * Two things deliberately did not come across. AxisTwelve guesses a customer's
 * city out of free-text address; there is no address here at all, so that is
 * absent rather than invented. And its courier figures are per parcel, where a
 * forwarder here belongs to the consignment - so that stays per consignment
 * until a parcel has its own.
 *
 * What it could never do, this can: AxisTwelve has no prices. It counts
 * parcels and never value.
 *
 * Pure and shared so the console and the tests compute the same numbers from
 * the same rows, and so a figure on a card can never disagree with the list it
 * opens.
 */

const DAY_MS = 86_400_000;

/** Orders that still count. A cancelled one is not demand, stock or money. */
export function live(orders: readonly Order[]): Order[] {
  return orders.filter((order) => !isCancelledLike(order.status));
}

function ticked(order: Order, checkpoint: OrderCheckpoint): string | null {
  return order.checkpoints?.[checkpoint] ?? null;
}

/* ── Boxes ─────────────────────────────────────────────────────────────── */

export type BoxClass = 'small' | 'medium' | 'large';

/**
 * Keyword lists carried over from AxisTwelve unchanged.
 *
 * They come from somebody actually packing this stuff rather than from a
 * measurement table: a Nendoroid goes in a small box, a 1/6 scale does not.
 * Wrong sometimes, and useful every week, which is the right trade for a
 * number whose job is "roughly how much cardboard do I need".
 */
const MINI_WORDS = ['blokees', 'funko', 'pop!', ' pop ', 'nendoroid', 'minifig', 'lego'];
const LARGE_WORDS = [
  'hot toys', 'hottoys', 'sideshow', '1/6', '1:6', 'statue', 'diorama', 'playset',
  'vehicle', 'set of',
];

/** The box one order would need on its own. */
export function boxClassFor(order: Pick<Order, 'itemName' | 'condition'>): BoxClass {
  const text = ` ${(order.itemName ?? '').toLowerCase()} `;
  const loose = order.condition === 'LOOSE';
  const mini = MINI_WORDS.some((word) => text.includes(word));
  const large = !mini && LARGE_WORDS.some((word) => text.includes(word));

  if (mini) return 'small';
  if (large) return loose ? 'medium' : 'large';
  return loose ? 'small' : 'medium';
}

/**
 * The one box a customer's whole order goes in.
 *
 * A parcel goes to a person, so several items become one box - a bigger one.
 */
export function aggregateBox(orders: readonly Pick<Order, 'itemName' | 'condition'>[]): BoxClass {
  const classes = orders.map(boxClassFor);
  if (classes.includes('large')) return 'large';
  if (classes.includes('medium')) return classes.length >= 5 ? 'large' : 'medium';
  return classes.length > 3 ? 'medium' : 'small';
}

export interface BoxEstimate {
  small: number;
  medium: number;
  large: number;
  openLots: number;
  byLot: { lotId: string; lotName: string; total: number; small: number; medium: number; large: number }[];
}

/**
 * How many boxes of each size are still to be packed.
 *
 * One per customer per lot, and a customer drops out once their orders are
 * packed - so the number shrinks as the work is done rather than describing a
 * job already finished.
 */
export function packingEstimate(lots: readonly Lot[], ordersByLot: Map<string, Order[]>): BoxEstimate {
  const estimate: BoxEstimate = { small: 0, medium: 0, large: 0, openLots: 0, byLot: [] };

  for (const lot of [...lots].reverse()) {
    const orders = live(ordersByLot.get(lot.id) ?? []);
    if (orders.length === 0) continue;
    const dispatched = orders.filter((order) => ticked(order, 'dispatched')).length;
    // Nothing to pack for a lot that has entirely gone.
    if (dispatched === orders.length) continue;

    const counts = { small: 0, medium: 0, large: 0 };
    for (const [, theirs] of groupByBuyer(orders)) {
      const waiting = theirs.filter((order) => !ticked(order, 'dispatched') && !ticked(order, 'packed'));
      if (waiting.length === 0) continue;
      counts[aggregateBox(waiting)] += 1;
    }

    estimate.small += counts.small;
    estimate.medium += counts.medium;
    estimate.large += counts.large;
    estimate.openLots += 1;
    estimate.byLot.push({
      lotId: lot.id,
      lotName: lot.name,
      total: counts.small + counts.medium + counts.large,
      ...counts,
    });
  }

  return estimate;
}

/** Orders grouped by who placed them. */
export function groupByBuyer(orders: readonly Order[]): Map<string, Order[]> {
  const grouped = new Map<string, Order[]>();
  for (const order of orders) {
    const existing = grouped.get(order.buyerId);
    if (existing) existing.push(order);
    else grouped.set(order.buyerId, [order]);
  }
  return grouped;
}

/* ── Time in stage ─────────────────────────────────────────────────────── */

/** The four segments of the journey, in the order they happen. */
export const SEGMENTS = ['toChinaPacked', 'chinaToIndia', 'indiaToReady', 'readyToDispatch'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  toChinaPacked: 'Opened → packed in China',
  chinaToIndia: 'China → India',
  indiaToReady: 'India → ready',
  readyToDispatch: 'Ready → dispatched',
};

export type Timings = Record<Segment, number | null>;

/**
 * Average days across each segment, for these orders.
 *
 * A segment only counts when its end is genuinely after its start: checkpoints
 * are not forced to be ticked in order, so somebody catching up out of
 * sequence would otherwise contribute a negative duration and drag an average
 * below zero.
 */
export function timingsOf(orders: readonly Order[], lotOpenedAt: string | null): Timings {
  const buckets: Record<Segment, number[]> = {
    toChinaPacked: [], chinaToIndia: [], indiaToReady: [], readyToDispatch: [],
  };

  const add = (segment: Segment, from: string | null, to: string | null) => {
    if (!from || !to) return;
    const ms = Date.parse(to) - Date.parse(from);
    if (Number.isFinite(ms) && ms > 0) buckets[segment].push(ms);
  };

  for (const order of orders) {
    // The first leg is measured from when the consignment opened, because that
    // is when the shop started waiting - not from when the order was placed,
    // which may be weeks later into a lot already filling.
    add('toChinaPacked', lotOpenedAt ?? order.createdAt, ticked(order, 'china_packed'));
    add('chinaToIndia', ticked(order, 'china_packed'), ticked(order, 'india_received'));
    add('indiaToReady', ticked(order, 'india_received'), ticked(order, 'ready_to_dispatch'));
    add('readyToDispatch', ticked(order, 'ready_to_dispatch'), ticked(order, 'dispatched'));
  }

  const mean = (values: number[]) =>
    values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length / DAY_MS;

  return {
    toChinaPacked: mean(buckets.toChinaPacked),
    chinaToIndia: mean(buckets.chinaToIndia),
    indiaToReady: mean(buckets.indiaToReady),
    readyToDispatch: mean(buckets.readyToDispatch),
  };
}

/** Door to door, when every segment has a number. Null when any is missing. */
export function doorToDoor(timings: Timings): number | null {
  const parts = SEGMENTS.map((segment) => timings[segment]);
  return parts.every((part) => part !== null) ? parts.reduce((sum, part) => sum! + part!, 0) : null;
}

/* ── Progress ──────────────────────────────────────────────────────────── */

/**
 * How far one order has come, as a fraction.
 *
 * Weighted across every checkpoint rather than counting only the last one, so
 * a lot that has cleared customs reads as two-thirds done instead of sitting
 * at zero until the final parcel goes out. The weights are AxisTwelve's, and
 * they are judgement rather than arithmetic: the long wait is the water.
 *
 * Distinct from `progressOf` in fulfilment, which reads the order's stage
 * history. That answers "how far along the timeline is this buyer's order";
 * this answers "how much of the physical work is done", and the two genuinely
 * differ - a lot can be at `india_received` as a stage while two thirds of the
 * parcels in it are still in Guangzhou.
 */
const PROGRESS: Record<OrderCheckpoint, number> = {
  china_received: 0.15,
  china_packed: 0.3,
  india_received: 0.5,
  ready_to_dispatch: 0.65,
  packed: 0.8,
  dispatched: 0.95,
  delivered: 1,
};

export function checkpointProgress(order: Order): number {
  let best = 0;
  for (const checkpoint of ORDER_CHECKPOINTS) {
    if (ticked(order, checkpoint)) best = Math.max(best, PROGRESS[checkpoint]);
  }
  return best;
}

/* ── The status line ───────────────────────────────────────────────────── */

export type LotPhase = 'empty' | 'filling' | 'prepping' | 'china_done' | 'india' | 'domestic' | 'completed';

export const PHASE_LABELS: Record<LotPhase, string> = {
  empty: 'Empty — nothing in it yet',
  filling: 'Getting filled',
  prepping: 'Prepping for China dispatch',
  china_done: 'Dispatched from China',
  india: 'Received in India',
  domestic: 'Domestic dispatch in progress',
  completed: 'Completed',
};

/**
 * Where a consignment is, in words.
 *
 * Not the stage stored on the lot: that is what the shop last ticked, and what
 * a shop wants to read is what the parcels are actually doing. Thirty-three of
 * thirty-four in the warehouse is "prepping", whatever the lot record says.
 *
 * No counts in the text - the chip that leads here already carries the number,
 * and a line that repeats it is a line nobody reads twice.
 */
export function phaseOf(orders: readonly Order[]): LotPhase {
  return phaseOfCounts(countCheckpoints(live(orders)));
}

/**
 * The same sentence, from the counts a card already holds.
 *
 * A lot card charts a tally and nothing else, and re-deriving the phase from
 * a second fetch of the orders is how a line ends up disagreeing with the bars
 * directly beneath it. Reading both off one tally makes that impossible.
 */
export function phaseOfCounts(counts: readonly CheckpointCount[]): LotPhase {
  const total = counts[0]?.total ?? 0;
  if (total === 0) return 'empty';

  const done = (checkpoint: OrderCheckpoint) =>
    counts.find((entry) => entry.checkpoint === checkpoint)?.done ?? 0;

  if (done('delivered') === total) return 'completed';
  if (done('packed') >= 1 || done('dispatched') >= 1) return 'domestic';
  if (done('india_received') >= 1) return 'india';
  if (done('china_packed') === total) return 'china_done';
  if (done('china_received') / total >= 0.6) return 'prepping';
  return 'filling';
}
