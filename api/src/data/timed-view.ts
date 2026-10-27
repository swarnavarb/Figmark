import type { Listing, Post } from '../../../shared/models.js';
import type { Repository } from './repository.js';

/**
 * Posts and listings written ahead of their time, read as of now.
 *
 * The clock runs every five minutes, so a power sale that only wrote what was
 * already due would land up to five minutes late whenever nobody was on the
 * site. Instead each pass writes what falls due in the next few minutes, each
 * with the moment it shows (`visibleAt`), and every read here leaves it out
 * until then. Same for the members' window: a drop's listing carries when its
 * window ends and the price after it (`memberWindow`), so from that moment
 * every read sees the public price - checkout included - whether or not the
 * runner has passed since.
 *
 * Done once, as a view over the store, rather than in each route: a route
 * that forgot would show tomorrow's drop today.
 */

/** True while a written-ahead post or listing is still waiting for its moment. */
export function notYet(row: { visibleAt?: string }, now = Date.now()): boolean {
  return Boolean(row.visibleAt && Date.parse(row.visibleAt) > now);
}

/**
 * A listing as it reads now: past its members' window, at the public price and
 * no longer unlisted. The catalog's query filters `unlisted` in the store, so
 * browsing finds it once the runner writes that down - within one clock run.
 */
export function listingNow(listing: Listing, now = Date.now()): Listing {
  const window = listing.memberWindow;
  if (!window || Date.parse(window.endsAt) > now) return listing;
  return {
    ...listing,
    priceMinor: window.publicPriceMinor,
    unlisted: false,
    expiresAt: window.publicExpiresAt ?? listing.expiresAt,
  };
}

/* Not listPostsByAuthor, nor listListings with includeHidden: those are the
   operators' whole view of an account, and what they delete with it. */
const POST_LISTS = ['listPosts', 'listPostsForChannels', 'listRecentPosts'] as const;
const LISTING_LISTS = ['listListingsInLot', 'listPreOrdersDue'] as const;

export function withTimedView(base: Repository): Repository {
  const shown = (listing: Listing | null) => (listing && !notYet(listing) ? listingNow(listing) : null);

  const overrides: Partial<Repository> = {
    async getPost(channelId, id) {
      const post = await base.getPost(channelId, id);
      return post && !notYet(post) ? post : null;
    },
    getListing: async (id) => shown(await base.getListing(id)),
    async listListings(query) {
      const rows = (await base.listListings(query)).map((listing) => listingNow(listing));
      return query?.includeHidden ? rows : rows.filter((listing) => !notYet(listing));
    },
    // An edit made after the window works on the item as it now is, so it
    // does not write the members' price back.
    changeListing: (id, sellerId, change) =>
      base.changeListing(id, sellerId, (current) => change(listingNow(current))),
  };
  for (const name of POST_LISTS) {
    const read = base[name].bind(base) as (...args: unknown[]) => Promise<Post[]>;
    (overrides as Record<string, unknown>)[name] = async (...args: unknown[]) =>
      (await read(...args)).filter((post) => !notYet(post));
  }
  for (const name of LISTING_LISTS) {
    const read = base[name].bind(base) as (...args: unknown[]) => Promise<Listing[]>;
    (overrides as Record<string, unknown>)[name] = async (...args: unknown[]) =>
      (await read(...args)).filter((listing) => !notYet(listing)).map((listing) => listingNow(listing));
  }

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in overrides) return (overrides as Record<string, unknown>)[prop];
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
