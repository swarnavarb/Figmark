import type { Order } from './models.js';
import { isStopped } from './orders.js';

/**
 * Affiliate selling: a shop pays a commission to whoever brought the buyer.
 *
 * The shop turns it on per item and names a fixed amount in rupees. Anybody else who opens
 * that item gets their own link to it; a sale made through the link credits
 * them, and the commission sits in their wallet. The link is signed by the
 * server, so it cannot be edited to credit somebody else - see
 * api/src/affiliate.ts.
 */

/** The least a shop may offer per unit sold: ₹1, in paise. */
export const AFFILIATE_MIN_MINOR = 100;

/**
 * A commission as the API takes it: a whole amount in paise per unit, at
 * least ₹1 and less than the price. Null turns it off.
 */
export function cleanAffiliateMinor(value: unknown, priceMinor: number): number | null {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount < AFFILIATE_MIN_MINOR) return null;
  return Math.min(amount, Math.max(AFFILIATE_MIN_MINOR, priceMinor - 100));
}

/**
 * A discount for buyers who come through somebody's link, as the API takes
 * it: at least ₹1, and small enough that the commission and the discount
 * together leave the shop at least ₹1 of the price. Null turns it off.
 */
export function cleanBuyerOffMinor(value: unknown, priceMinor: number, commissionMinor: number): number | null {
  const amount = Math.round(Number(value));
  if (!Number.isFinite(amount) || amount < AFFILIATE_MIN_MINOR) return null;
  const room = priceMinor - commissionMinor - 100;
  if (room < AFFILIATE_MIN_MINOR) return null;
  return Math.min(amount, room);
}

/** What a buyer saves per unit through a link to this item, in paise. Zero when the shop offers none. */
export function linkDiscountMinor(terms: { buyerOffMinor?: number | null } | null | undefined): number {
  return terms?.buyerOffMinor && terms.buyerOffMinor > 0 ? terms.buyerOffMinor : 0;
}

/** What a shop's commission pays per unit, in paise. Older items stored a percentage. */
export function affiliateUnitMinor(
  terms: { amountMinor?: number | null; percent?: number | null } | null | undefined,
  unitPriceMinor: number,
): number {
  if (!terms) return 0;
  if (terms.amountMinor && terms.amountMinor > 0) return terms.amountMinor;
  if (terms.percent && terms.percent > 0) return Math.round((unitPriceMinor * terms.percent) / 100);
  return 0;
}

/** The query parameter the old, long signed link travels in. Still honoured. */
export const AFFILIATE_PARAM = 'ref';

/** Where a short link lives: `/r/<code>`. */
export const SHORT_LINK_PREFIX = '/r/';

/**
 * Where an earning stands.
 *
 * - `pending`: the order is going ahead but the item has not reached the buyer.
 * - `earned`: delivered, so the commission is owed by the shop.
 * - `paid`: the shop says it paid the commission out.
 * - `void`: the order was cancelled, rejected or refunded - nothing is owed.
 */
export type AffiliateEarningStatus = 'pending' | 'earned' | 'paid' | 'void';

export const AFFILIATE_STATUS_LABELS: Record<AffiliateEarningStatus, string> = {
  pending: 'Pending delivery',
  earned: 'Earned',
  paid: 'Paid out',
  void: 'Cancelled',
};

/** The commission on this order, in minor units. Zero when it carries none. */
export function affiliateCommissionMinor(order: Pick<Order, 'affiliate' | 'unitPriceMinor' | 'quantity'>): number {
  if (!order.affiliate) return 0;
  return affiliateUnitMinor(order.affiliate, order.unitPriceMinor) * order.quantity;
}

export function affiliateStatus(
  order: Pick<Order, 'affiliate' | 'status' | 'completedAt' | 'receivedAt' | 'placedAt'>,
): AffiliateEarningStatus {
  if (!order.affiliate || order.placedAt === null || isStopped(order.status)) return 'void';
  if (order.affiliate.paidAt) return 'paid';
  if (order.completedAt || order.receivedAt || order.status === 'delivered') return 'earned';
  return 'pending';
}
