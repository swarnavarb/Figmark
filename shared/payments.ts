import type { CreditRecord, Listing, Order } from './models.js';

/**
 * Stock, expiry and money-in-instalments, shared by the API and the app.
 *
 * The same discipline as `shared/orders.ts`: the screen and the server read one
 * rule, so a Buy button is never shown on something the server will refuse and
 * an allocation preview never differs from the allocation that is recorded.
 */

/* ── Stock ─────────────────────────────────────────────────────────────── */

/** A seller who cannot count the shelf says "multiple" rather than inventing a number. */
export function isMultiple(listing: Pick<Listing, 'quantityMode'>): boolean {
  return listing.quantityMode === 'multiple';
}

/** "10 available" or "Multiple available" - never a made-up figure. */
export function availabilityLabel(listing: Pick<Listing, 'quantityMode' | 'quantityAvailable'>): string {
  return isMultiple(listing) ? 'Multiple available' : `${listing.quantityAvailable} available`;
}

/* ── Expiry ────────────────────────────────────────────────────────────── */

/** Within this long of its expiry an item is flagged as closing soon. */
export const EXPIRY_WARNING_HOURS = 48;

/**
 * Expired is read from the clock rather than written by a job, for the same
 * reason escrow auto-release is: a deadline kept by a scheduler silently stops
 * the day the scheduler does.
 */
export function isExpired(listing: Pick<Listing, 'expiresAt'>, now = new Date()): boolean {
  return Boolean(listing.expiresAt && new Date(listing.expiresAt).getTime() <= now.getTime());
}

export function expiresSoon(listing: Pick<Listing, 'expiresAt'>, now = new Date()): boolean {
  if (!listing.expiresAt || isExpired(listing, now)) return false;
  return new Date(listing.expiresAt).getTime() - now.getTime() <= EXPIRY_WARNING_HOURS * 3_600_000;
}

/** "2d 4h left", "5h left", "40m left". */
export function timeLeft(expiresAt: string, now = new Date()): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 'Expired';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return `${Math.max(1, minutes)}m left`;
}

/* ── Advance ───────────────────────────────────────────────────────────── */

/** The advance on an order, rounded up so the balance is never the larger surprise. */
export function advanceMinor(totalMinor: number, percent: number | null | undefined): number {
  if (!percent || percent <= 0 || percent >= 100) return totalMinor;
  return Math.ceil((totalMinor * percent) / 100);
}

/* ── Money on an order ─────────────────────────────────────────────────── */

export interface OrderMoney {
  totalMinor: number;
  /** Sum of every payment allocated to this item. */
  paidMinor: number;
  outstandingMinor: number;
  /** Paid over the balance and not yet handed back. */
  creditMinor: number;
  refundedMinor: number;
}

type MoneyShape = Pick<Order, 'unitPriceMinor' | 'quantity' | 'paymentStatus' | 'payments' | 'credits'>;

/**
 * What an order is worth, what has come in and what is left.
 *
 * Summed from the individual dated payments rather than kept as a running
 * number, so the history and the balance can never disagree. Orders paid before
 * payment records existed are treated as paid in full when they say so.
 */
export function orderMoney(order: MoneyShape): OrderMoney {
  const totalMinor = order.unitPriceMinor * order.quantity;
  const records = order.payments ?? [];
  const paidMinor = records.length
    ? records.filter((p) => p.kind !== 'refund').reduce((sum, p) => sum + p.amountMinor, 0)
    : order.paymentStatus === 'paid' ? totalMinor : 0;
  const credits = order.credits ?? [];
  const creditMinor = credits.reduce((sum, c) => sum + creditLeft(c), 0);
  const refundedMinor = credits.reduce((sum, c) => sum + c.refundedMinor, 0);
  return {
    totalMinor,
    paidMinor,
    outstandingMinor: Math.max(0, totalMinor - paidMinor),
    creditMinor,
    refundedMinor,
  };
}

export interface AllocationLine {
  orderId: string;
  amountMinor: number;
  /** This payment clears the item. */
  completes: boolean;
  /** Not chosen by the buyer: the remainder spilled onto it. */
  spill: boolean;
}

export interface Allocation {
  lines: AllocationLine[];
  /** Left over once every eligible item is clear: kept as credit, never lost. */
  extraMinor: number;
}

/**
 * Splits one payment across items, in order.
 *
 * Each selected item is cleared before the next is touched. What is left then
 * spills onto the other outstanding items in the same group, and anything left
 * after that is extra - recorded as credit for the seller to refund.
 */
export function allocatePayment(
  amountMinor: number,
  selected: readonly { id: string; outstandingMinor: number }[],
  others: readonly { id: string; outstandingMinor: number }[] = [],
): Allocation {
  let left = Math.max(0, Math.round(amountMinor));
  const lines: AllocationLine[] = [];
  const walk = (items: readonly { id: string; outstandingMinor: number }[], spill: boolean) => {
    for (const item of items) {
      if (left <= 0) return;
      if (item.outstandingMinor <= 0) continue;
      const take = Math.min(left, item.outstandingMinor);
      left -= take;
      lines.push({ orderId: item.id, amountMinor: take, completes: take === item.outstandingMinor, spill });
    }
  };
  walk(selected, false);
  const chosen = new Set(selected.map((item) => item.id));
  walk(others.filter((item) => !chosen.has(item.id)), true);
  return { lines, extraMinor: left };
}

/** Rupees for timeline notes the server writes, matching the app's formatting. */
export function rupees(minor: number): string {
  return `₹${Math.round(minor / 100).toLocaleString('en-IN')}`;
}

/** The method an order was first paid by. Older orders are read from whether protection was bought. */
export function methodOf(order: Pick<Order, 'paymentMethod' | 'protection'>): 'direct' | 'protected' {
  return order.paymentMethod ?? (order.protection ? 'protected' : 'direct');
}

export const PAYMENT_KIND_LABELS = {
  full: 'Full payment',
  advance: 'Advance',
  additional: 'Additional payment',
  refund: 'Refund',
  credit: 'Extra payment applied',
} as const;

/** Why a refund is owed, in the words both screens use. */
export const REFUND_ORIGIN_LABELS = {
  overpaid: 'Extra payment',
  cancelled: 'Cancelled order',
  manual: 'Refund started by seller',
} as const;

/** What is still the buyer's on one credit: neither returned nor moved onto another order. */
export function creditLeft(credit: Pick<CreditRecord, 'amountMinor' | 'refundedMinor' | 'appliedMinor'>): number {
  return Math.max(0, credit.amountMinor - credit.refundedMinor - (credit.appliedMinor ?? 0));
}

/** Still the seller's to decide about: return it, move it, or keep holding it. */
export function creditIsLive(credit: Pick<CreditRecord, 'status'>): boolean {
  return credit.status === 'open' || credit.status === 'held';
}

export const PAYMENT_METHOD_LABELS = {
  direct: 'Direct to seller (UPI / bank)',
  protected: 'Buyer protection (escrow)',
} as const;
