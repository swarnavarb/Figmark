import type { Lot, User } from '../../shared/models.js';
import { hasRight, isLive } from '../../shared/service-stores.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Whether a forwarder has taken this lot on.
 *
 * A lot booked before stores asked anyone (no `acceptance` at all) was simply
 * named, and the forwarder has been working it since; only an explicit
 * request still waiting, or one turned down, keeps them out.
 */
export function forwarderTookLot(lot: Pick<Lot, 'forwarder'>): boolean {
  const acceptance = lot.forwarder?.acceptance;
  return Boolean(lot.forwarder?.forwarderUserId) && (acceptance === undefined || acceptance === 'accepted');
}

/**
 * Whether this person works this lot for the forwarder booked on it: the
 * store's owner, or a member granted the work. Only while the store is live,
 * and only once the lot has been taken.
 */
export async function forwarderWorks(repository: Repo, lot: Lot, userId: string): Promise<User | null> {
  const ownerId = lot.forwarder?.forwarderUserId;
  if (!ownerId || !forwarderTookLot(lot)) return null;
  const owner = await repository.getUserById(ownerId);
  if (!owner || owner.suspended || !isLive(owner.forwarderProfile)) return null;
  return hasRight(owner, 'forwarder', userId, 'work') ? owner : null;
}

/**
 * What naming this account as a lot's forwarder amounts to.
 *
 * A live store is booked the way the store says - taken at once on
 * auto-accept, a request otherwise. Anything else (an application still in
 * review, a store suspended, an account with no store) is not bookable, and
 * the name stays on the lot as typed text with no screen behind it.
 */
export async function bookingFor(
  repository: Repo,
  forwarderUserId: string | null | undefined,
): Promise<{ forwarderUserId: string | null; acceptance?: 'pending' | 'accepted'; respondedAt?: string | null }> {
  if (!forwarderUserId) return { forwarderUserId: null };
  const owner = await repository.getUserById(forwarderUserId);
  if (!owner || owner.suspended || !isLive(owner.forwarderProfile)) return { forwarderUserId: null };
  return owner.forwarderProfile!.autoAccept === false
    ? { forwarderUserId, acceptance: 'pending', respondedAt: null }
    : { forwarderUserId, acceptance: 'accepted', respondedAt: new Date().toISOString() };
}
