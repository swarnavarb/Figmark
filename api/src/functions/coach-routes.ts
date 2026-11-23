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
import {
  COACH_STATS_ID, addToStats, emptyCoachLog, notePressed, noteSeen, ownResults, settle, statsView, tidyCoachLog,
  type CoachLog, type CoachStats, type Measure,
} from '../../../shared/coach-log.js';
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

/** The shop's signals and plan, and what the log needs to measure outcomes - or the refusal. */
async function buildCoach(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const storeId = request.query.get('store') ?? user.id;

  const owner = await repository.getUserById(storeId);
  if (!owner?.sellerProfile) return { refusal: error(404, 'not_found', 'No such store.') } as const;
  const may = (permission: StorePermission) => storeId === user.id || can(owner, user.id, permission);
  const seesOrders = may('admin');
  const seesMoney = may('analytics');
  if (!may('listings') && !seesOrders && !seesMoney) {
    return { refusal: error(403, 'forbidden', 'You cannot see that store’s work.') } as const;
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

  /* What an episode's week did, from the shop's own timestamped rows. */
  const soldAt = sold.map((order) => ({ at: Date.parse(order.placedAt ?? order.createdAt), listingId: order.listingId, quantity: order.quantity }));
  const byId = new Map(all.map((listing) => [listing.id, listing]));
  const measure: Measure = (episode, from, to) => {
    const inWindow = soldAt.filter((order) => order.at >= from && order.at < to);
    const listing = episode.itemId ? byId.get(episode.itemId) : undefined;
    return {
      sales: inWindow.length,
      itemViews: listing ? viewsBetween(listing.viewLog, dayKey(from), dayKey(to - 1)) : null,
      itemSold: listing ? inWindow.filter((order) => order.listingId === listing.id).reduce((sum, order) => sum + order.quantity, 0) : null,
    };
  };

  return { ok: true, repository, owner, signals, plan: coachPlan(signals), measure, seesOrders, nowDate } as const;
}

type Built = Extract<Awaited<ReturnType<typeof buildCoach>>, { ok: true }>;

/**
 * Settles every episode whose week is over, adds them to the staff totals
 * (sums only), and saves the shop's log when anything changed. A failure
 * here never costs the seller their coach: the log is a record, not the
 * screen.
 */
async function saveLog(built: Built, log: CoachLog, changed: boolean): Promise<CoachLog> {
  const { repository, owner, measure, nowDate } = built;
  const { log: settledLog, settled } = settle(log, nowDate, measure);
  let next = settledLog;
  if (settled.length > 0) {
    let counted = next;
    await repository.mutateSiteContent(COACH_STATS_ID, (current) => {
      const added = addToStats((current?.data as CoachStats | undefined) ?? null, settled, next, nowDate);
      counted = added.log;
      const at = nowDate.toISOString();
      return { id: COACH_STATS_ID, data: added.stats, updatedBy: null, createdAt: current?.createdAt ?? at, updatedAt: at };
    });
    next = counted;
  }
  if (!changed && settled.length === 0) return next;
  owner.coachLog = tidyCoachLog(next, nowDate);
  await repository.updateUser(owner);
  return owner.coachLog;
}

/** The shop's own results, for those who may see its order book. */
function resultsFor(built: Built, log: CoachLog) {
  return built.seesOrders ? ownResults(log, built.nowDate) : null;
}

async function coach(request: HttpRequest, _context: InvocationContext) {
  const built = await buildCoach(request);
  if (built.refusal) return built.refusal;
  const log = await saveLog(built, built.owner.coachLog ?? emptyCoachLog(), false)
    .catch(() => built.owner.coachLog ?? emptyCoachLog());
  return json(200, { signals: built.signals, plan: built.plan, results: resultsFor(built, log) });
}

/**
 * POST /api/me/coach/events - `{ seen: [tipId...] }` when tips were on the
 * screen, `{ pressed: tipId }` when somebody pressed one.
 *
 * Only tips the coach would show this shop right now are taken, so the log
 * (and the staff totals behind it) cannot be filled with made-up ones.
 */
async function events(request: HttpRequest, _context: InvocationContext) {
  let body: { seen?: unknown; pressed?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const built = await buildCoach(request);
  if (built.refusal) return built.refusal;
  const current = new Map(built.plan.tips.map((tip) => [tip.id, tip]));
  const seen = (Array.isArray(body.seen) ? body.seen : []).filter((id): id is string => typeof id === 'string')
    .slice(0, 40).map((id) => current.get(id)).filter((tip) => tip !== undefined);
  const pressed = typeof body.pressed === 'string' ? current.get(body.pressed) : undefined;
  if (seen.length === 0 && !pressed) return json(200, { ok: true, recorded: 0 });

  let log = built.owner.coachLog ?? emptyCoachLog();
  let changed = false;
  if (seen.length > 0) ({ log, changed } = noteSeen(log, seen, built.nowDate));
  if (pressed) {
    const result = notePressed(log, pressed, built.nowDate);
    log = result.log;
    changed = changed || result.changed;
  }
  await saveLog(built, log, changed);
  return json(200, { ok: true, recorded: seen.length + (pressed ? 1 : 0) });
}

/**
 * GET /api/ops/coach - how each kind of tip is doing across every shop, for
 * staff. Totals only, rounded, and a kind of tip is withheld until enough
 * shops stand behind it that no one shop can be read out of it.
 */
async function opsCoach(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireCapability(request, ['admin']);
  const repository = await getRepository();
  const saved = await repository.getSiteContent(COACH_STATS_ID);
  return json(200, statsView((saved?.data as CoachStats | undefined) ?? null));
}

/** Delivered, or called off for good: nothing left for the seller to do on it. */
function isDone(order: { status: string; checkpoints?: { delivered?: string | null } | null }): boolean {
  return order.status === 'rejected' || order.status === 'cancelled' || order.status === 'cancelled_reversed'
    || order.status === 'delivered' || Boolean(order.checkpoints?.delivered);
}

export const coachRoute = handler(coach);
export const coachEventsRoute = handler(events);
export const opsCoachRoute = handler(opsCoach);

app.http('me-coach', {
  authLevel: 'anonymous',
  methods: ['GET'],
  route: 'me/coach',
  handler: coachRoute,
});

app.http('me-coach-events', {
  authLevel: 'anonymous',
  methods: ['POST'],
  route: 'me/coach/events',
  handler: coachEventsRoute,
});

app.http('ops-coach', {
  authLevel: 'anonymous',
  methods: ['GET'],
  route: 'ops/coach',
  handler: opsCoachRoute,
});
