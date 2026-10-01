import type { Order } from './models.js';
import { isStopped } from './orders.js';

/**
 * Affiliate selling: a shop pays a commission to whoever brought the buyer.
 *
 * The shop turns it on per item and names the rate. Anybody else who opens
 * that item gets their own link to it; a sale made through the link credits
 * them, and the commission sits in their wallet. The link is signed by the
 * server, so it cannot be edited to credit somebody else - see
 * api/src/affiliate.ts.
 */

/** The most a shop may offer, and the least. Whole percent. */
export const AFFILIATE_MIN_PERCENT = 1;
export const AFFILIATE_MAX_PERCENT = 50;

/** A rate as the API takes it: rounded and inside the range, or null for off. */
export function cleanAffiliatePercent(value: unknown): number | null {
  const percent = Math.round(Number(value));
  if (!Number.isFinite(percent) || percent < AFFILIATE_MIN_PERCENT) return null;
  return Math.min(AFFILIATE_MAX_PERCENT, percent);
}

/** The query parameter the signed link travels in. */
export const AFFILIATE_PARAM = 'ref';

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
  return Math.round((order.unitPriceMinor * order.quantity * order.affiliate.percent) / 100);
}

export function affiliateStatus(
  order: Pick<Order, 'affiliate' | 'status' | 'completedAt' | 'receivedAt' | 'placedAt'>,
): AffiliateEarningStatus {
  if (!order.affiliate || order.placedAt === null || isStopped(order.status)) return 'void';
  if (order.affiliate.paidAt) return 'paid';
  if (order.completedAt || order.receivedAt || order.status === 'delivered') return 'earned';
  return 'pending';
}
