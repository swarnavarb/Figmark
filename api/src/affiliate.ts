import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Listing, Order, OrderAffiliate, User } from '../../shared/models.js';
import { config } from './config.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Affiliate links, signed so they cannot be edited to credit somebody else.
 *
 * A link is `/listing/<id>?ref=<referrerId>.<signature>`. The signature covers
 * both the item and the person, so a link for one item does not work on
 * another, and changing the person breaks it. Nothing is stored to issue one:
 * the server can re-sign and compare whenever a link comes back.
 */

function signature(listingId: string, referrerId: string): string {
  return createHmac('sha256', config.sessionSecret)
    .update(`affiliate:${listingId}:${referrerId}`)
    .digest('base64url')
    .slice(0, 22);
}

/** The `ref` value for this person's link to this item. */
export function affiliateToken(listingId: string, referrerId: string): string {
  return `${referrerId}.${signature(listingId, referrerId)}`;
}

/** Who a `ref` value credits, or null when it was not issued for this item. */
export function verifyAffiliateToken(listingId: string, token: string | null | undefined): string | null {
  if (!token) return null;
  const cut = token.lastIndexOf('.');
  if (cut <= 0) return null;
  const referrerId = token.slice(0, cut);
  const given = Buffer.from(token.slice(cut + 1));
  const expected = Buffer.from(signature(listingId, referrerId));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return referrerId;
}

/** Whether this item pays a commission, and so whether links to it mean anything. */
export function offersAffiliate(listing: Pick<Listing, 'affiliate' | 'privateFor'>): boolean {
  return Boolean(listing.affiliate && listing.affiliate.percent > 0 && !listing.privateFor);
}

/**
 * Remembers that `user` arrived at this item through `referrerId`'s link.
 *
 * The latest link wins, the way a shop assistant who actually made the sale
 * is the one who gets the commission. A person cannot refer themselves, and a
 * shop cannot earn commission from its own item. Saves the user.
 */
export async function recordReferral(repository: Repo, user: User, listing: Listing, referrerId: string): Promise<boolean> {
  if (!offersAffiliate(listing)) return false;
  if (referrerId === user.id || referrerId === listing.sellerId) return false;
  const referrer = await repository.getUserById(referrerId);
  if (!referrer || referrer.suspended) return false;

  const others = (user.referrals ?? []).filter((entry) => entry.listingId !== listing.id);
  const existing = (user.referrals ?? []).find((entry) => entry.listingId === listing.id);
  if (existing?.referrerId === referrerId) return true;
  user.referrals = [...others, { listingId: listing.id, referrerId, at: new Date().toISOString() }].slice(-200);
  await repository.updateUser(user);
  return true;
}

/** The affiliate this buyer's purchase of this item credits, if any. */
export async function affiliateFor(repository: Repo, buyerId: string, listing: Listing): Promise<OrderAffiliate | null> {
  if (!offersAffiliate(listing) || !listing.affiliate) return null;
  const buyer = await repository.getUserById(buyerId);
  const referral = buyer?.referrals?.find((entry) => entry.listingId === listing.id);
  if (!referral || referral.referrerId === buyerId || referral.referrerId === listing.sellerId) return null;
  const referrer = await repository.getUserById(referral.referrerId);
  if (!referrer || referrer.suspended) return null;
  return {
    referrerId: referrer.id,
    referrerName: referrer.displayName,
    referrerHandle: referrer.username ?? null,
    percent: listing.affiliate.percent,
    paidAt: null,
    paidReference: null,
  };
}

/**
 * Files an order under the affiliate who brought it, once it is placed.
 *
 * A checkout is not a sale, so nothing shows in the affiliate's wallet until
 * the buyer chose to pay, pay an advance, or book.
 */
export async function creditAffiliate(repository: Repo, order: Order): Promise<void> {
  if (!order.affiliate) return;
  const referrer = await repository.getUserById(order.affiliate.referrerId);
  if (!referrer) return;
  const ids = referrer.affiliateOrderIds ?? [];
  if (ids.includes(order.id)) return;
  referrer.affiliateOrderIds = [...ids, order.id];
  await repository.updateUser(referrer);
}
