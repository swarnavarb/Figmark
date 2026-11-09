import type { User } from '../../shared/models.js';
import { PERSON_FOLLOW } from '../../shared/storefront.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * How many people really follow a shop or a person, counted from the follows
 * themselves rather than read off the counter kept beside the profile.
 *
 * The counter is what every card and list reads, and it drifts: seeded
 * numbers, a follower who was suspended or deleted, a write that landed on
 * one side only. So a page view counts the real follows (the same people the
 * Followers list shows), and when the counter disagrees it is put right, so
 * every other screen agrees from then on.
 *
 * Counting is a cross-partition read, so a count is held for a short while:
 * a shop page polling for live numbers does not rerun it every few seconds.
 */
const HOLD_MS = 20_000;
const held = new Map<string, { at: number; count: Promise<number> }>();

export function realFollowerCount(repository: Repo, user: User, asStore: boolean): Promise<number> {
  const key = asStore ? user.id : `${PERSON_FOLLOW}${user.id}`;
  const was = held.get(key);
  if (was && Date.now() - was.at < HOLD_MS) return was.count;
  const count = (async () => {
    const ids = [...new Set(await repository.listFollowerIds(key))];
    const people = await repository.listUsersByIds(ids);
    const real = people.filter((person) => !person.suspended).length;
    const stored = asStore ? (user.sellerProfile?.followerCount ?? 0) : (user.followerCount ?? 0);
    if (real !== stored) {
      // Put right from a fresh read, so nothing written in between is lost.
      const fresh = await repository.getUserById(user.id).catch(() => null);
      if (fresh && (!asStore || fresh.sellerProfile)) {
        if (asStore) fresh.sellerProfile!.followerCount = real;
        else fresh.followerCount = real;
        await repository.updateUser(fresh).catch(() => undefined);
      }
    }
    return real;
  })();
  held.set(key, { at: Date.now(), count });
  // A failed count is not kept; the caller falls back to the stored number.
  count.catch(() => { if (held.get(key)?.count === count) held.delete(key); });
  if (held.size > 2000) held.delete(held.keys().next().value!);
  return count;
}

/** A follow or unfollow just happened: the next read counts afresh. */
export function forgetFollowerCount(id: string) {
  held.delete(id);
}
