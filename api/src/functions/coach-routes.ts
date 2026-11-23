import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { StorePermission } from '../../../shared/enums.js';
import type { Listing } from '../../../shared/models.js';
import { awaitingLot } from '../../../shared/fulfilment.js';
import { actionsFor, awaitingAcceptance, isCancelledLike, isPlaced } from '../../../shared/orders.js';
import { expiresSoon, isExpired, isLowStock } from '../../../shared/payments.js';
import { can } from '../../../shared/stores.js';
import { isProActive } from '../../../shared/billing.js';
import { dayKey, viewsBetween } from '../../../shared/seller-data.js';
import { coachPlan, orderTiming, type CoachItem, type CoachSignals } from '../../../shared/coach.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * GET /api/me/coach - what the shop coach suggests, and the counts it read.
 *
 * Assembly only: the rules live in shared/coach.ts so the panel, the AI brief
 * and the tests read one set. Read-only, like the dashboard it sits beside,
 * and gated the same way - the order book only for those who may see it, the
 * money only for those who may see the numbers.
 */

const DAY_MS = 86_400_000;
/** Opened at least this often in 30 days with no sale: people want it and are not buying. */
const BROWSED_VIEWS = 15;
/** On sale at least this long before "nobody has opened it" means anything. */
const UNSEEN_AGE_DAYS = 7;
/** A description shorter than this cannot say condition, contents and shipping. */
const THIN_DESCRIPTION = 60;
const THIN_PHOTOS = 3;

async function coach(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const storeId = request.query.get('store') ?? user.id;

  const owner = await repository.getUserById(storeId);
  if (!owner?.sellerProfile) return error(404, 'not_found', 'No such store.');
  const may = (permission: StorePermission) => storeId === user.id || can(owner, user.id, permission);
  const seesOrders = may('admin');
  const seesMoney = may('analytics');
  if (!may('listings') && !seesOrders && !seesMoney) {
    return error(403, 'forbidden', 'You cannot see that store’s work.');
  }

  const [all, figures, drafts, posts] = await Promise.all([
    repository.listListings({ sellerId: storeId, limit: 10_000, includeHidden: true })
      .then((rows) => rows.filter((listing) => listing.status !== 'archived')),
    repository.listOrderFiguresForSeller(storeId),
    repository.listListingDrafts(storeId),
    repository.listPosts(storeId, 50).catch(() => []),
  ]);

  const nowDate = new Date();
  const now = nowDate.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const today = dayKey(nowDate);
  const monthAgo = iso(now - 30 * DAY_MS);
  const twoMonthsAgo = iso(now - 60 * DAY_MS);
  const quarterAgo = iso(now - 90 * DAY_MS);
  const weekAgo = iso(now - 7 * DAY_MS);

  const placed = figures.filter(isPlaced);
  const sold = placed.filter((order) => !isCancelledLike(order.status) && order.status !== 'cancelled_reversed'
    && !awaitingAcceptance(order));
  const recent = sold.filter((order) => order.createdAt >= monthAgo);
  const soldBy = new Map<string, number>();
  for (const order of recent) soldBy.set(order.listingId, (soldBy.get(order.listingId) ?? 0) + order.quantity);

  const item = (listing: Listing): CoachItem => {
    const pre = listing.preOrder && listing.preOrder.fillThreshold > 0 ? listing.preOrder : null;
    return {
      id: listing.id,
      title: listing.title,
      priceMinor: listing.priceMinor,
      currency: listing.currency,
      photo: listing.photos[0]?.thumbUrl ?? listing.photos[0]?.url ?? null,
      views30: viewsBetween(listing.viewLog, dayKey(now - 29 * DAY_MS), today),
      saves: listing.likeCount,
      sold30: soldBy.get(listing.id) ?? 0,
      ageDays: Math.max(0, Math.floor((now - Date.parse(listing.createdAt)) / DAY_MS)),
      expiresAt: listing.expiresAt ?? null,
      quantityAvailable: listing.quantityAvailable,
      fill: pre ? Math.min(1, (pre.filledCount + (pre.pledgedCount ?? 0)) / pre.fillThreshold) : null,
    };
  };

  const shelf = all.filter((listing) => !listing.unlisted);
  const onSale = all.filter((listing) => listing.status === 'active' && !listing.unlisted && !isExpired(listing, nowDate));
  const live = onSale.map((listing) => ({ listing, coach: item(listing) }));
  const byViews = (a: CoachItem, b: CoachItem) => b.views30 - a.views30;

  const bestEntry = [...soldBy.entries()].sort((a, b) => b[1] - a[1])[0];
  const bestListing = bestEntry ? all.find((listing) => listing.id === bestEntry[0]) : undefined;
  const listed = all.filter((listing) => listing.status !== 'draft').map((listing) => listing.createdAt).sort();

  const waiting = figures.filter((order) => !isDone(order) && (
    ((order.paymentStatus === 'claimed' || order.status === 'payment_reversal_pending') && !isCancelledLike(order.status))
    || actionsFor(order, storeId).includes('accept')));
  const active = placed.filter((order) => !isDone(order));
  const value = (order: (typeof figures)[number]) => order.quantity * order.unitPriceMinor;
  const shares = owner.sellerProfile.growth?.shares ?? [];
  const profile = owner.sellerProfile;

  const signals: CoachSignals = {
    now: nowDate.toISOString(),
    shop: {
      name: profile.storefrontName,
      handle: profile.username ?? null,
      photoUrl: profile.photoUrl ?? null,
      followers: profile.followerCount ?? 0,
      pro: isProActive(owner.pro, now),
      setup: {
        photo: Boolean(profile.photoUrl),
        cover: Boolean(profile.coverUrl),
        bio: Boolean(profile.bio?.trim()),
        payment: Boolean(profile.payment?.upiId || profile.payment?.accountNumber),
      },
    },
    listings: {
      onSale: onSale.length,
      drafts: drafts.length + shelf.filter((listing) => listing.status === 'draft').length,
      soldOut: shelf.filter((listing) => listing.status === 'sold_out' && !isExpired(listing, nowDate)).length,
      expired: shelf.filter((listing) => listing.status !== 'draft' && isExpired(listing, nowDate)).length,
      endingSoon: live.filter(({ listing }) => expiresSoon(listing, nowDate)).map((entry) => entry.coach)
        .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? '')),
      lowStock: live.filter(({ listing }) => isLowStock(listing)).map((entry) => entry.coach)
        .sort((a, b) => b.sold30 - a.sold30),
      // A listing from before view logs has no log to read: it is not called unseen on no evidence.
      unseen: live.filter(({ listing, coach: c }) => listing.viewLog && c.ageDays >= UNSEEN_AGE_DAYS
        && viewsBetween(listing.viewLog, dayKey(now - 13 * DAY_MS), today) === 0)
        .map((entry) => entry.coach).sort((a, b) => b.ageDays - a.ageDays),
      browsedNotBought: live.filter(({ coach: c }) => c.views30 >= BROWSED_VIEWS && c.sold30 === 0)
        .map((entry) => entry.coach).sort(byViews),
      thin: live.filter(({ listing }) => listing.photos.length < THIN_PHOTOS
        || (listing.description ?? '').trim().length < THIN_DESCRIPTION)
        .map((entry) => entry.coach).sort(byViews),
      noCommission: onSale.filter((listing) => !listing.affiliate?.amountMinor && !listing.affiliate?.percent).length,
      noOffer: onSale.filter((listing) => (listing.offers ?? []).length === 0).length,
      importsNoLot: onSale.filter((listing) => !listing.lotId && listing.sourcing === 'import').length,
      best: bestListing ? item(bestListing) : null,
      lastListedAt: listed[listed.length - 1] ?? null,
    },
    orders: seesOrders ? {
      toAnswer: waiting.length,
      unpaid: active.filter((order) => order.paymentStatus === 'unpaid' || order.paymentStatus === 'partially_paid').length,
      noLot: figures.filter((order) => !isDone(order) && awaitingLot(order)).length,
      inTransit: active.filter((order) => order.status === 'shipped' || Boolean(order.checkpoints?.dispatched)).length,
      delivered30: placed.filter((order) => (order.status === 'delivered' || Boolean(order.checkpoints?.delivered))
        && order.updatedAt >= monthAgo).length,
      cancelled30: placed.filter((order) => (isCancelledLike(order.status) || order.status === 'cancelled_reversed')
        && order.updatedAt >= monthAgo).length,
    } : null,
    money: seesMoney ? {
      currency: all[0]?.currency ?? 'INR',
      revenue30Minor: recent.reduce((sum, order) => sum + value(order), 0),
      revenuePrev30Minor: sold.filter((order) => order.createdAt >= twoMonthsAgo && order.createdAt < monthAgo)
        .reduce((sum, order) => sum + value(order), 0),
      orders30: recent.length,
    } : null,
    activity: {
      posts7: posts.filter((post) => post.createdAt >= weekAgo).length,
      shares7: shares.filter((share) => share.at >= weekAgo).length,
      lastPostAt: posts.map((post) => post.createdAt).sort().pop() ?? null,
    },
    timing: orderTiming(sold.map((order) => order.placedAt ?? order.createdAt).filter((at) => at >= quarterAgo)),
  };

  return json(200, { signals, plan: coachPlan(signals) });
}

/** Delivered, or called off for good: nothing left for the seller to do on it. */
function isDone(order: { status: string; checkpoints?: { delivered?: string | null } | null }): boolean {
  return order.status === 'rejected' || order.status === 'cancelled' || order.status === 'cancelled_reversed'
    || order.status === 'delivered' || Boolean(order.checkpoints?.delivered);
}

export const coachRoute = handler(coach);

app.http('me-coach', {
  authLevel: 'anonymous',
  methods: ['GET'],
  route: 'me/coach',
  handler: coachRoute,
});
