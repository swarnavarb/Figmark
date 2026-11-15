/**
 * How long steps and whole deliveries really take, worked out by the system.
 *
 * Nobody types these. Each step's time is read off what actually happened -
 * the gap between reaching a step and reaching the next, on a shop's own lots
 * and orders - and said as a range, "3–5 days", because a single number
 * promises a precision no parcel keeps. A shop with no history of its own for
 * a step gets the market's: the same step across every shop, labelled
 * "Market trend" so nobody mistakes it for the shop's own record.
 *
 * Delays are left out. A lot stuck a month at customs is real, but it is not
 * what the step usually takes, and counting it would put every estimate a
 * week late. A time far beyond the rest (past the upper fence of the middle
 * half, or more than twice the middle value while there are too few to tell)
 * is dropped before the range is taken.
 */
import { DIRECT_LOT_ID } from './fulfilment.js';
import { stepNameKey } from './routes.js';
import type { Sourcing } from './enums.js';

/** Where a range came from: the shop's own history, or every shop's. */
export type DaySource = 'yours' | 'market';

export interface DayRange {
  low: number;
  high: number;
  source: DaySource;
  /** How many times it was measured, after the delays were left out. */
  samples: number;
}

/** Step name (as `stepNameKey` writes it) to its range. */
export type StepDayRanges = Record<string, DayRange>;

/** What the system knows for one shop: each step, and a whole delivery by how it is sourced. */
export interface ShopDays {
  steps: StepDayRanges;
  delivery: Partial<Record<Sourcing, DayRange>>;
}

/** Measurements needed before a shop's own history is trusted over the market's. */
export const OWN_MIN_SAMPLES = 2;

const DAY_MS = 86_400_000;

type HistoryEvent = { enteredAt: string; step?: string; kind?: string; undoUntil?: string; note?: string | null };

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const at = (sorted.length - 1) * q;
  const below = Math.floor(at);
  const above = Math.ceil(at);
  return sorted[below]! + (sorted[above]! - sorted[below]!) * (at - below);
}

/** The times left once the delays are taken out, smallest first. */
export function withoutDelays(values: readonly number[]): number[] {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (sorted.length < 2) return sorted;
  let limit: number;
  if (sorted.length >= 4) {
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    limit = q3 + 1.5 * (q3 - q1);
  } else {
    limit = Math.max(1, quantile(sorted, 0.5) * 2);
  }
  return sorted.filter((value) => value <= limit);
}

/** A whole-day range from the middle of what was measured: at least a day, and always two numbers. */
export function rangeOf(values: readonly number[], source: DaySource): DayRange | null {
  const kept = withoutDelays(values);
  if (kept.length === 0) return null;
  const low = Math.max(1, Math.floor(quantile(kept, 0.25)));
  const high = Math.max(low + 1, Math.ceil(quantile(kept, 0.75)));
  return { low, high, source, samples: kept.length };
}

/** "3–5 days". */
export function dayRangeLabel(range: Pick<DayRange, 'low' | 'high'>): string {
  return `${range.low}–${range.high} days`;
}

/**
 * Each step's measured times, in days, from timelines: the gap between one
 * step being reached and the next. A note is not a step, a move still inside
 * its undo window is not history yet, an undone tick is not a step reached,
 * and two events on the same step in a row are one arrival.
 */
export function stepSpans(histories: Iterable<readonly HistoryEvent[] | undefined>, now = Date.now()): Map<string, number[]> {
  const spans = new Map<string, number[]>();
  for (const history of histories) {
    const arrivals: { key: string; at: number }[] = [];
    const events = [...(history ?? [])]
      .filter((event) => event.step && (event.kind ?? 'step') === 'step'
        && !(event.undoUntil && Date.parse(event.undoUntil) > now)
        && !/undone\.?$/i.test(event.note ?? ''))
      .map((event) => ({ key: stepNameKey(event.step!), at: Date.parse(event.enteredAt) }))
      .filter((event) => Number.isFinite(event.at))
      .sort((a, b) => a.at - b.at);
    for (const event of events) {
      if (arrivals.length && arrivals[arrivals.length - 1]!.key === event.key) continue;
      arrivals.push(event);
    }
    for (let index = 0; index + 1 < arrivals.length; index += 1) {
      const days = (arrivals[index + 1]!.at - arrivals[index]!.at) / DAY_MS;
      const list = spans.get(arrivals[index]!.key);
      if (list) list.push(days);
      else spans.set(arrivals[index]!.key, [days]);
    }
  }
  return spans;
}

type DeliveredOrder = {
  lotId: string;
  placedAt?: string | null;
  createdAt: string;
  status: string;
  checkpoints?: Record<string, string | null | undefined> | null;
  completedAt?: string | null;
  receivedAt?: string | null;
};

/** Days from order to the buyer's hands, for every delivered order, by how it was sourced. */
export function deliverySpans(orders: Iterable<DeliveredOrder>): Record<Sourcing, number[]> {
  const out: Record<Sourcing, number[]> = { in_hand: [], import: [] } as Record<Sourcing, number[]>;
  for (const order of orders) {
    if (order.status !== 'delivered') continue;
    const placed = Date.parse(order.placedAt ?? order.createdAt);
    const reached = [order.checkpoints?.delivered, order.completedAt, order.receivedAt]
      .filter((at): at is string => Boolean(at)).sort()[0];
    const arrived = reached ? Date.parse(reached) : NaN;
    if (!Number.isFinite(placed) || !Number.isFinite(arrived) || arrived < placed) continue;
    (out[order.lotId === DIRECT_LOT_ID ? 'in_hand' : 'import'] ??= []).push((arrived - placed) / DAY_MS);
  }
  return out;
}

/** The shop's own range where it has enough of its own, the market's where it does not. */
export function pickRange(own: readonly number[] | undefined, market: readonly number[] | undefined): DayRange | null {
  if (own && own.length >= OWN_MIN_SAMPLES) {
    const mine = rangeOf(own, 'yours');
    if (mine) return mine;
  }
  if (market && market.length >= OWN_MIN_SAMPLES) {
    const theirs = rangeOf(market, 'market');
    if (theirs) return theirs;
  }
  return own && own.length ? rangeOf(own, 'yours') : null;
}

/** Every step either side has measured, each with the range it should show. */
export function mergeStepRanges(own: Map<string, number[]>, market: Map<string, number[]>): StepDayRanges {
  const out: StepDayRanges = {};
  for (const key of new Set([...own.keys(), ...market.keys()])) {
    const range = pickRange(own.get(key), market.get(key));
    if (range) out[key] = range;
  }
  return out;
}

/** A step's range, looked up by its name as written on the route. */
export function rangeForStep(ranges: StepDayRanges | null | undefined, name: string): DayRange | null {
  return ranges?.[stepNameKey(name)] ?? null;
}

/**
 * Roughly how many days are left once something is at step `at`: what is
 * left of that step, plus each later step's range. Null when any step still
 * to come has never been measured, since a total that quietly skipped one
 * would promise an arrival too early.
 */
export function daysLeftRange(
  steps: readonly { name: string }[],
  at: number,
  ranges: StepDayRanges | null | undefined,
  daysIntoStep = 0,
): { low: number; high: number; source: DaySource } | null {
  if (!ranges) return null;
  let low = 0;
  let high = 0;
  let market = false;
  for (let index = Math.max(0, at); index < steps.length - 1; index += 1) {
    const range = rangeForStep(ranges, steps[index]!.name);
    if (!range) return null;
    if (range.source === 'market') market = true;
    low += index === at ? Math.max(0, range.low - daysIntoStep) : range.low;
    high += index === at ? Math.max(0, range.high - daysIntoStep) : range.high;
  }
  return { low, high: Math.max(high, low), source: market ? 'market' : 'yours' };
}
