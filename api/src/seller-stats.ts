/**
 * The shop's public record, worked out from its orders.
 *
 * Two numbers on the seller card that nobody types: the share of orders that
 * reached the buyer inside the delivery time the listing promised, and the
 * share of buyers who came back. Both are read off the orders as they are
 * (shared/delivery-eta.ts) and written to `sellerTrust`, so a card that shows
 * them is one read, not a walk through every order.
 *
 * Refreshed when an order is delivered or confirmed, when the shop opens its
 * own numbers, by the daily clock, and on a card read once the last count is a
 * day old - the last because an overdue parcel turns late with nobody pressing
 * anything, and the number has to notice.
 */
import { onTimeStats, repeatCustomerRate, type OnTimeStats } from '../../shared/delivery-eta.js';
import type { User } from '../../shared/models.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** A day: after this a stored count is refreshed on the next card read. */
const STALE_MS = 86_400_000;

/** Seller ids being refreshed right now, so twenty card reads start one count, not twenty. */
const running = new Map<string, Promise<OnTimeStats | null>>();

/**
 * Counts the shop's orders and stores the two rates on its owner.
 * Returns the on-time breakdown, or null when there is no such shop.
 */
export function refreshSellerStats(repository: Repo, sellerId: string, now = new Date()): Promise<OnTimeStats | null> {
  const already = running.get(sellerId);
  if (already) return already;
  const work = (async () => {
    const orders = await repository.listOrdersForSeller(sellerId);
    const stats = onTimeStats(orders, now);
    const repeat = repeatCustomerRate(orders);
    const owner = await repository.getUserById(sellerId);
    if (!owner?.sellerProfile) return null;
    const trust = owner.sellerTrust;
    const unchanged = trust.onTimeDispatchRate === stats.rate
      && trust.onTimeMeasured === stats.measured
      && trust.repeatCustomerRate === repeat
      && trust.computedAt && now.getTime() - Date.parse(trust.computedAt) < STALE_MS / 2;
    if (!unchanged) {
      owner.sellerTrust = {
        ...trust,
        onTimeDispatchRate: stats.rate,
        onTimeMeasured: stats.measured,
        repeatCustomerRate: repeat,
        computedAt: now.toISOString(),
      };
      // A count is never the reason a request fails: a write that loses a race
      // is simply counted again next time.
      await repository.updateUser(owner).catch(() => null);
    }
    return stats;
  })().finally(() => running.delete(sellerId));
  running.set(sellerId, work);
  return work;
}

/** Whether a shop's stored count is old enough to redo. */
export function statsStale(user: Pick<User, 'sellerTrust'>, now = new Date()): boolean {
  const at = user.sellerTrust?.computedAt;
  return !at || now.getTime() - Date.parse(at) > STALE_MS;
}

/** Refreshes in the background when stale; never waited on and never throws. */
export function refreshIfStale(repository: Repo, user: Pick<User, 'id' | 'sellerTrust' | 'sellerProfile'>): void {
  if (!user.sellerProfile || !statsStale(user)) return;
  void refreshSellerStats(repository, user.id).catch(() => null);
}

/** The daily pass: every shop's numbers, so a parcel that went overdue overnight counts. */
export async function refreshAllSellerStats(repository: Repo): Promise<number> {
  const users = await repository.listAllUsers();
  let count = 0;
  for (const user of users) {
    if (!user.sellerProfile) continue;
    await refreshSellerStats(repository, user.id).catch(() => null);
    count += 1;
  }
  return count;
}
