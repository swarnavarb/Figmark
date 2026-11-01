/**
 * How long an item takes to reach the buyer, and whether shops keep to it.
 *
 * The shop says one thing: a range of days from the order being placed to
 * the parcel being in the buyer's hands - "45-50 days". It is asked on every
 * listing because it is the first question every buyer asks. Everything else
 * is worked out: each order keeps the range it was bought with, and the shop's
 * on-time rate is read off when those orders actually arrived. The shop never
 * types a date it could quietly move.
 */
import type { Order } from './models.js';
import { isStopped } from './orders.js';

/** Days from the order being placed to the buyer receiving it in hand. */
export interface DeliveryEta {
  minDays: number;
  maxDays: number;
}

/** The longest promise the form takes: a year is already a pre-order, not an ETA. */
export const ETA_MAX_DAYS = 365;

/** A day's grace before an arrival counts as late: a parcel at 9 am on day 51 is not news. */
export const ON_TIME_GRACE_DAYS = 1;

/** How far back the public rate looks. */
export const ON_TIME_WINDOW_DAYS = 90;

/** Orders needed before a rate is shown at all: two late parcels out of three is not a record. */
export const ON_TIME_MIN_ORDERS = 5;

const DAY_MS = 86_400_000;

/** What is wrong with an ETA as typed, or null when it can be saved. */
export function etaProblem(eta: Partial<DeliveryEta> | null | undefined): string | null {
  if (!eta || eta.minDays == null || eta.maxDays == null) {
    return 'Say how many days it takes to reach the buyer, from order to delivery.';
  }
  const { minDays, maxDays } = eta;
  if (!Number.isInteger(minDays) || !Number.isInteger(maxDays)) return 'Delivery days must be whole numbers.';
  if (minDays < 1) return 'Delivery takes at least 1 day.';
  if (maxDays < minDays) return 'The longest delivery time cannot be shorter than the quickest.';
  if (maxDays > ETA_MAX_DAYS) return `Keep the delivery time under ${ETA_MAX_DAYS} days.`;
  return null;
}

/** An ETA as stored, or null for anything that is not one. */
export function cleanEta(raw: unknown): DeliveryEta | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const eta = { minDays: Number(value.minDays), maxDays: Number(value.maxDays) };
  return etaProblem(eta) ? null : eta;
}

/** "45-50 days", or "7 days" when both ends agree. */
export function etaLabel(eta: DeliveryEta | null | undefined): string | null {
  if (!eta) return null;
  return eta.minDays === eta.maxDays ? `${eta.maxDays} days` : `${eta.minDays}–${eta.maxDays} days`;
}

/** When the order was placed: the checkout's own time for orders from before placing was recorded. */
export function placedAtOf(order: Pick<Order, 'placedAt' | 'createdAt'>): string | null {
  if (order.placedAt === null) return null;
  return order.placedAt ?? order.createdAt;
}

/** When it reached the buyer: the first of the seller's delivered tick, completion and the buyer's word. */
export function deliveredAtOf(order: Pick<Order, 'checkpoints' | 'completedAt' | 'receivedAt'>): string | null {
  const times = [order.checkpoints?.delivered, order.completedAt, order.receivedAt]
    .filter((at): at is string => Boolean(at))
    .sort();
  return times[0] ?? null;
}

/** The last day an order can arrive and still be on time, or null without a promise to measure. */
export function dueBy(order: Pick<Order, 'deliveryEta' | 'placedAt' | 'createdAt'>): string | null {
  const placed = placedAtOf(order);
  if (!order.deliveryEta || !placed) return null;
  return new Date(Date.parse(placed) + order.deliveryEta.maxDays * DAY_MS).toISOString();
}

export type Punctuality = 'on_time' | 'late' | 'overdue' | 'pending' | 'none';

/**
 * Where one order stands against its promise.
 *
 * - `on_time`: arrived by the last promised day (plus the grace day).
 * - `late`: arrived after it.
 * - `overdue`: not arrived, and the last day has passed. Counts as late: an
 *   order nobody marks delivered must not be a way out of the number.
 * - `pending`: not arrived, still inside the promise.
 * - `none`: nothing to measure - no promise, never placed, or called off.
 */
export function punctuality(
  order: Pick<Order, 'deliveryEta' | 'placedAt' | 'createdAt' | 'checkpoints' | 'completedAt' | 'receivedAt' | 'status'>,
  now = new Date(),
): Punctuality {
  const due = dueBy(order);
  if (!due) return 'none';
  const delivered = deliveredAtOf(order);
  const limit = Date.parse(due) + ON_TIME_GRACE_DAYS * DAY_MS;
  if (delivered) return Date.parse(delivered) <= limit ? 'on_time' : 'late';
  if (isStopped(order.status)) return 'none';
  return now.getTime() > limit ? 'overdue' : 'pending';
}

/** Days late (positive) or early (negative) against the last promised day, for an arrived order. */
export function daysAgainstPromise(order: Parameters<typeof punctuality>[0], now = new Date()): number | null {
  const due = dueBy(order);
  if (!due) return null;
  const end = deliveredAtOf(order) ?? now.toISOString();
  return Math.round((Date.parse(end) - Date.parse(due)) / DAY_MS);
}

export interface OnTimeStats {
  /** Share of measured orders that arrived on time, 0-1; null below the minimum. */
  rate: number | null;
  onTime: number;
  late: number;
  overdue: number;
  pending: number;
  /** Measured orders: on time + late + overdue. */
  measured: number;
}

/**
 * The shop's on-time record over the last `ON_TIME_WINDOW_DAYS`.
 *
 * An order counts in the window by the day it was due, so a parcel promised
 * for last week is measured now whether or not it has turned up.
 */
export function onTimeStats(orders: readonly Parameters<typeof punctuality>[0][], now = new Date()): OnTimeStats {
  const from = now.getTime() - ON_TIME_WINDOW_DAYS * DAY_MS;
  const stats: OnTimeStats = { rate: null, onTime: 0, late: 0, overdue: 0, pending: 0, measured: 0 };
  for (const order of orders) {
    const due = dueBy(order);
    if (!due || Date.parse(due) < from) continue;
    const state = punctuality(order, now);
    if (state === 'on_time') stats.onTime += 1;
    else if (state === 'late') stats.late += 1;
    else if (state === 'overdue') stats.overdue += 1;
    else if (state === 'pending') stats.pending += 1;
  }
  stats.measured = stats.onTime + stats.late + stats.overdue;
  stats.rate = stats.measured >= ON_TIME_MIN_ORDERS ? stats.onTime / stats.measured : null;
  return stats;
}

/**
 * Share of a shop's buyers who ordered more than once, 0-1, or null with too
 * few buyers to say. Only placed orders that were not turned down count.
 */
export function repeatCustomerRate(
  orders: readonly Pick<Order, 'buyerId' | 'status' | 'placedAt'>[],
  minimumBuyers = ON_TIME_MIN_ORDERS,
): number | null {
  const counts = new Map<string, number>();
  for (const order of orders) {
    if (order.placedAt === null || order.status === 'rejected' || order.status === 'cancelled') continue;
    counts.set(order.buyerId, (counts.get(order.buyerId) ?? 0) + 1);
  }
  if (counts.size < minimumBuyers) return null;
  let repeat = 0;
  for (const count of counts.values()) if (count > 1) repeat += 1;
  return repeat / counts.size;
}
