import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import { affiliateUnitMinor } from '../../shared/affiliate.js';
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
export function offersAffiliate(listing: Pick<Listing, 'affiliate' | 'privateFor' | 'priceMinor'>): boolean {
  return affiliateUnitMinor(listing.affiliate, listing.priceMinor) > 0 && !listing.privateFor;
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
    amountMinor: affiliateUnitMinor(listing.affiliate, listing.priceMinor),
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

/* ── Short links ──────────────────────────────────────────────────────────
 *
 * `/r/<code>`: seven characters, nothing to trim off. The code is a pointer
 * kept in the site-content store (`ref:<code>`), so the link itself carries
 * no item, person or signature for anybody to edit - an edited code simply
 * points nowhere. Opening one remembers the referral twice over: on the
 * account if they are signed in, and in a cookie the server reads back when
 * they sign up or sign in, so deleting the address afterwards loses nothing.
 */

const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;
export const REFERRAL_COOKIE = 'fm_ref';
const REFERRAL_COOKIE_DAYS = 30;

function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** This person's short code for this item, made the first time they share it. */
export async function shortCodeFor(repository: Repo, user: User, listing: Listing): Promise<string> {
  const existing = user.affiliateLinks?.[listing.id];
  if (existing) return existing;
  let code = newCode();
  // A clash is a one-in-trillions event; checking costs one point read.
  for (let tries = 0; tries < 5 && (await repository.getSiteContent(`ref:${code}`)); tries += 1) code = newCode();
  const now = new Date().toISOString();
  await repository.saveSiteContent({
    id: `ref:${code}`,
    data: { listingId: listing.id, referrerId: user.id },
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  user.affiliateLinks = { ...(user.affiliateLinks ?? {}), [listing.id]: code };
  await repository.updateUser(user);
  return code;
}

/** Where a short code points, or null for one that was never issued. */
export async function resolveShortCode(repository: Repo, code: string): Promise<{ listingId: string; referrerId: string } | null> {
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return null;
  const row = await repository.getSiteContent(`ref:${code}`);
  const data = row?.data as { listingId?: string; referrerId?: string } | undefined;
  return data?.listingId && data.referrerId ? { listingId: data.listingId, referrerId: data.referrerId } : null;
}

/** The signed referrals a browser is carrying, newest last. */
export function referralsInCookie(request: HttpRequest): { listingId: string; referrerId: string }[] {
  const header = request.headers.get('cookie');
  if (!header) return [];
  const raw = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${REFERRAL_COOKIE}=`));
  if (!raw) return [];
  return decodeURIComponent(raw.slice(REFERRAL_COOKIE.length + 1)).split(',').flatMap((entry) => {
    const [listingId, token] = entry.split('~');
    const referrerId = listingId && token ? verifyAffiliateToken(listingId, token) : null;
    return listingId && referrerId ? [{ listingId, referrerId }] : [];
  });
}

/** The cookie that remembers this referral, alongside any others already held. */
export function referralCookie(request: HttpRequest, listingId: string, referrerId: string): string {
  const kept = referralsInCookie(request).filter((entry) => entry.listingId !== listingId).slice(-9);
  const value = [...kept, { listingId, referrerId }]
    .map((entry) => `${entry.listingId}~${affiliateToken(entry.listingId, entry.referrerId)}`)
    .join(',');
  return [
    `${REFERRAL_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${REFERRAL_COOKIE_DAYS * 24 * 60 * 60}`,
  ].join('; ');
}

/**
 * Moves the referrals a browser carries onto the account now using it.
 *
 * Called when somebody signs up or signs in, and whenever they open an item or
 * a checkout, so a referral made while signed out is never lost.
 */
export async function claimCookieReferrals(repository: Repo, request: HttpRequest, userId: string): Promise<void> {
  const held = referralsInCookie(request);
  if (held.length === 0) return;
  const user = await repository.getUserById(userId);
  if (!user) return;
  for (const entry of held) {
    if (user.referrals?.some((known) => known.listingId === entry.listingId && known.referrerId === entry.referrerId)) continue;
    const listing = await repository.getListing(entry.listingId);
    if (listing) await recordReferral(repository, user, listing, entry.referrerId);
  }
}
