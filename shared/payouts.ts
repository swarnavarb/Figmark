import type { Order } from './models.js';
import { isStopped } from './orders.js';
import { orderMoney } from './payments.js';

/**
 * Where a shop's money is: held, released, or paid to it directly.
 *
 * Buyer Protection means Figmark holds a protected payment until the buyer
 * confirms delivery or the auto-release date passes. That is safe for the
 * buyer and opaque for the seller, who sees "paid" on an order and nothing in
 * their account. This answers the question they actually ask - how much is
 * mine, how much is waiting, and when does the waiting money come.
 */

export interface PayoutRow {
  orderId: string;
  itemName: string;
  buyerId: string;
  amountMinor: number;
  currency: string;
  /** When it releases on its own unless the buyer disputes; null until the clock starts at delivery. */
  releasesAt: string | null;
  /** When it was released, for released rows. */
  releasedAt: string | null;
  delivered: boolean;
}

export interface PayoutSummary {
  currency: string;
  heldMinor: number;
  disputedMinor: number;
  /** Released in the window asked for. */
  releasedMinor: number;
  /** Paid straight to the shop, never held. */
  directMinor: number;
  /** Held money, by the day it releases on its own; undated last. */
  upcoming: { date: string | null; amountMinor: number; orders: number }[];
  held: PayoutRow[];
  disputed: PayoutRow[];
  released: PayoutRow[];
}

const dayOf = (iso: string) => iso.slice(0, 10);

export function payoutsOf(orders: readonly Order[], sinceIso: string): PayoutSummary {
  const row = (order: Order): PayoutRow => ({
    orderId: order.id,
    itemName: order.itemName,
    buyerId: order.buyerId,
    amountMinor: order.hold.amountMinor,
    currency: order.currency,
    releasesAt: order.hold.autoReleaseAt,
    releasedAt: order.hold.releasedAt,
    delivered: order.status === 'delivered',
  });
  const held = orders.filter((order) => order.hold.state === 'held' && order.hold.amountMinor > 0).map(row)
    .sort((a, b) => (a.releasesAt ?? '9999').localeCompare(b.releasesAt ?? '9999'));
  const disputed = orders.filter((order) => order.hold.state === 'disputed' && order.hold.amountMinor > 0).map(row);
  const released = orders
    .filter((order) => order.hold.state === 'released' && order.hold.releasedAt && order.hold.releasedAt >= sinceIso)
    .map(row)
    .sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  const directMinor = orders
    .filter((order) => order.hold.state === 'none' && !isStopped(order.status) && order.createdAt >= sinceIso)
    .reduce((sum, order) => sum + orderMoney(order).paidMinor, 0);

  const byDay = new Map<string | null, { amountMinor: number; orders: number }>();
  for (const entry of held) {
    const key = entry.releasesAt ? dayOf(entry.releasesAt) : null;
    const was = byDay.get(key) ?? { amountMinor: 0, orders: 0 };
    byDay.set(key, { amountMinor: was.amountMinor + entry.amountMinor, orders: was.orders + 1 });
  }
  const upcoming = [...byDay.entries()]
    .map(([date, value]) => ({ date, ...value }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));

  const sum = (rows: PayoutRow[]) => rows.reduce((total, entry) => total + entry.amountMinor, 0);
  return {
    currency: orders[0]?.currency ?? 'INR',
    heldMinor: sum(held),
    disputedMinor: sum(disputed),
    releasedMinor: sum(released),
    directMinor,
    upcoming,
    held,
    disputed,
    released,
  };
}
