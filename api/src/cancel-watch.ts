import { cancelStats, directPaused, type CancelFlag, type CancelStats } from '../../shared/billing.js';
import type { User } from '../../shared/models.js';
import type { getRepository } from './data/index.js';
import { mapLimit } from './data/lot-view.js';
import { loadFeeIndex, loadPricing } from './billing.js';
import { notify } from './functions/notify.js';

/**
 * Sellers who call off too many of their own orders.
 *
 * Every seller cancellation is stamped on the order (`sellerCancelledAt`) and
 * checked here at once: a seller over the operators' limit is flagged, told,
 * and - when the operators say so - can only be paid through the gateway
 * until an operator clears them. They can appeal from their shop.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

export async function statsFor(repository: Repo, sellerId: string, now = Date.now()): Promise<CancelStats> {
  const [orders, pricing] = await Promise.all([repository.listOrdersForSeller(sellerId), loadPricing(repository)]);
  return cancelStats(orders, pricing.cancels, now);
}

/** Whether this seller may take direct payments right now. */
export async function directRefusal(repository: Repo, sellerId: string): Promise<string | null> {
  const seller = await repository.getUserById(sellerId);
  if (!directPaused(seller?.cancelFlag)) return null;
  return 'This shop takes payments through Figmark only right now. Pay with the gateway to place your order.';
}

/** After a seller calls off an order: flag them if they are now over the limit. */
export async function noteSellerCancel(repository: Repo, sellerId: string, now = Date.now()): Promise<CancelFlag | null> {
  const [seller, pricing] = await Promise.all([repository.getUserById(sellerId), loadPricing(repository)]);
  if (!seller) return null;
  const stats = cancelStats(await repository.listOrdersForSeller(sellerId), pricing.cancels, now);
  const flag = seller.cancelFlag ?? null;
  // Already flagged, or cleared after this cancellation was counted: nothing new.
  if (!stats.over || (flag && flag.status !== 'cleared')) return flag;
  // Cleared by an operator: only a fresh cancellation since then reopens it.
  if (flag?.status === 'cleared' && flag.decidedAt) {
    const since = (await repository.listOrdersForSeller(sellerId))
      .some((order) => order.sellerCancelledAt && order.sellerCancelledAt > flag.decidedAt!);
    if (!since) return flag;
  }
  const at = new Date(now).toISOString();
  const next: CancelFlag = {
    status: 'flagged', at, ratePct: stats.ratePct, cancelled: stats.cancelled, orders: stats.orders,
    directPaused: pricing.cancels.pauseDirect, appeal: null, decidedAt: null, decidedBy: null, note: null,
  };
  await repository.updateUser({ ...seller, cancelFlag: next });
  await notify(repository, [sellerId], {
    kind: 'cancel_flag',
    title: next.directPaused
      ? `Direct buying is paused: you cancelled ${stats.cancelled} of ${stats.orders} orders`
      : `You have cancelled ${stats.cancelled} of ${stats.orders} orders`,
    body: `${stats.ratePct}% in the last ${pricing.cancels.windowDays} days is over Figmark's ${pricing.cancels.maxPct}% limit. `
      + (next.directPaused ? 'Buyers can still pay you through Figmark. ' : '')
      + 'If there is a good reason, appeal from your shop.',
    link: '/shop?tab=payments',
  });
  return next;
}

export interface CancelRow extends CancelStats {
  userId: string;
  name: string;
  flag: CancelFlag | null;
}

/**
 * Every seller with sales, with their cancellation rate: the operators' list.
 * Flagged ones first, then by rate.
 */
export async function cancelReport(repository: Repo, now = Date.now()): Promise<CancelRow[]> {
  const [index, pricing] = await Promise.all([loadFeeIndex(repository), loadPricing(repository)]);
  const rows = await mapLimit(Object.entries(index), 6, async ([userId, entry]): Promise<CancelRow | null> => {
    const [owner, orders] = await Promise.all([repository.getUserById(userId), repository.listOrdersForSeller(userId)]);
    if (!owner) return null;
    return { userId, name: entry.name, flag: owner.cancelFlag ?? null, ...cancelStats(orders, pricing.cancels, now) };
  });
  const rank = (row: CancelRow) => (row.flag?.status === 'appealed' ? 0 : row.flag?.status === 'flagged' ? 1 : row.over ? 2 : 3);
  return rows.filter((row): row is CancelRow => row !== null)
    .sort((a, b) => rank(a) - rank(b) || b.ratePct - a.ratePct || b.orders - a.orders);
}

/** An operator's decision on a flag: clear it (direct buying back on), keep it, or pause by hand. */
export async function decideFlag(
  repository: Repo, seller: User, decision: 'clear' | 'keep' | 'pause', by: string, note: string | null,
): Promise<CancelFlag> {
  const at = new Date().toISOString();
  const pricing = await loadPricing(repository);
  const stats = cancelStats(await repository.listOrdersForSeller(seller.id), pricing.cancels);
  const was = seller.cancelFlag;
  const flag: CancelFlag = decision === 'pause'
    ? {
      status: 'flagged', at, ratePct: stats.ratePct, cancelled: stats.cancelled, orders: stats.orders,
      directPaused: true, appeal: null, decidedAt: at, decidedBy: by, note,
    }
    : {
      ...(was ?? { at, ratePct: stats.ratePct, cancelled: stats.cancelled, orders: stats.orders, directPaused: false, appeal: null }),
      status: decision === 'clear' ? 'cleared' : 'flagged',
      decidedAt: at, decidedBy: by, note,
    };
  await repository.updateUser({ ...seller, cancelFlag: flag });
  await notify(repository, [seller.id], decision === 'clear'
    ? { kind: 'cancel_flag', title: 'Your appeal was accepted: direct buying is back on', body: note || 'Buyers can pay you directly again.', link: '/shop' }
    : decision === 'keep'
      ? { kind: 'cancel_flag', title: 'Your appeal was turned down', body: note || 'Direct buying stays paused for now. Buyers can still pay you through Figmark.', link: '/shop' }
      : { kind: 'cancel_flag', title: 'Direct buying is paused on your shop', body: note || 'Buyers can still pay you through Figmark.', link: '/shop' });
  return flag;
}
