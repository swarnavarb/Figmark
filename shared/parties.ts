import type { User } from './models.js';

/**
 * Somebody named on a screen, and the page that name opens.
 *
 * Every reference to a person or a shop is an address, so it is rendered as a
 * link — and which page it opens is not a detail. An account has two of them:
 * the shop it runs and the person who runs it, each with its own handle and its
 * own record. A seller's name has to open the shop, because that is where the
 * seller rating lives; a buyer's name has to open the person, because that is
 * where the buyer rating lives. Pointing either at the other shows a stranger a
 * record that says nothing about the thing they are deciding.
 *
 * The handle is null on accounts that predate handles, and for catalog fixtures
 * that were never sign-in accounts. Those render as plain text rather than as a
 * link to nowhere.
 */
export interface PartyRef {
  name: string;
  handle: string | null;
}

/** How they are named and addressed as a seller: the shop, not the person. */
export function sellerRef(
  user: { displayName: string; username?: string | null; sellerProfile: User['sellerProfile'] } | null | undefined,
  fallback = 'the seller',
): PartyRef {
  if (!user) return { name: fallback, handle: null };
  return {
    name: user.sellerProfile?.storefrontName ?? user.displayName,
    // A shop without its own handle is still reachable through its owner's,
    // which is a worse address but a real one.
    handle: user.sellerProfile?.username ?? user.username ?? null,
  };
}

/**
 * How they are named and addressed as a buyer, a commenter, or an author.
 *
 * Takes the handle as either absent or null because the stored user and the
 * session user disagree about which they use, and a helper that only accepts
 * one of them pushes that disagreement out to every call site.
 */
export function personRef(
  user: { displayName: string; username?: string | null } | null | undefined,
  fallback = 'Someone',
): PartyRef {
  if (!user) return { name: fallback, handle: null };
  return { name: user.displayName, handle: user.username ?? null };
}
