/**
 * The shop's customers, and the Data tab's overview.
 *
 *   GET  /api/me/customers             - everybody who bought, with the shop's
 *                                        summary and the deeper (Pro) readings
 *   GET  /api/me/customers/{buyerId}   - one customer, everything they did here
 *   POST /api/me/customers/message     - one short message to a chosen group
 *   GET  /api/me/data/overview         - this period against the last, on-time,
 *                                        reply times, cancellations, views and
 *                                        what buyers search for
 *
 * Pro screens are open to every shop for now and marked as Pro on the page;
 * nothing here checks the tier. A customer is somebody who did something
 * toward the shop - ordered, saved, checked out, pledged, followed, voted,
 * commented. Browsing is counted (views), never named.
 */
import { proRefusal } from '../billing.js';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing, Order, Post, User } from '../../../shared/models.js';
import type { PartyRef } from '../../../shared/parties.js';
import {
  GONE_STATUSES, ORDER_SOURCES, PATH_STEPS, VALUE_LABELS, furthestStep, interestOf, matchScore, nextOrderDue, orderSource,
  owedBy, placedOf, reliabilityOf, reliabilityWord, replyTimes, valueLabel, valueOf, vipCutoff,
  type OrderSource, type PathStep, type Spend, type ValueLabel,
} from '../../../shared/customers.js';
import { daysAgainstPromise, dueBy, onTimeStats, punctuality } from '../../../shared/delivery-eta.js';
import {
  VIEW_SOURCES, dayKey, lastDays, shopWords, termMatches, viewsBetween, viewsBySource, type ViewSource,
} from '../../../shared/seller-data.js';
import { orderMoney } from '../../../shared/payments.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { readSearches } from '../search-log.js';
import { refreshSellerStats } from '../seller-stats.js';
import { error, handler, json } from './http.js';
import { names, shopFor } from './insight-routes.js';
import { notify } from './notify.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

const DAY = 86_400_000;
/** Most customers one list carries; a shop past this pages by search. */
const MAX_ROWS = 500;
/** Most people one group message may reach. */
export const GROUP_MESSAGE_MAX = 100;
/** Most group messages a shop may send in a day. */
export const GROUP_MESSAGES_PER_DAY = 3;

async function open(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const shopId = await shopFor(request, repository, user);
  return { user, repository, shopId };
}

/** The reporting window, in days: 7, 30 or 90. */
function periodDays(request: HttpRequest): number {
  const asked = Number(request.query.get('days'));
  return asked === 7 || asked === 90 ? asked : 30;
}

const photoOf = (listing: Listing | undefined) =>
  (listing?.photos.find((photo) => photo.isPrimary) ?? listing?.photos[0])?.url || null;

/** Everybody who works the shop: their own clicks are not customers. */
function staffOf(shop: User | null, shopId: string): Set<string> {
  return new Set([shopId, ...(shop?.sellerProfile?.managers ?? []).map((entry) => entry.userId)]);
}

/** Who took part in the shop's own posts - votes, entries, guesses, comments, reactions - by person. */
function participation(posts: readonly Post[], staff: ReadonlySet<string>) {
  const acts = new Map<string, { votes: number; comments: number; entries: number; guesses: number; reactions: number; firstAt: string }>();
  const touch = (userId: string, kind: 'votes' | 'comments' | 'entries' | 'guesses' | 'reactions', at: string) => {
    if (!userId || staff.has(userId)) return;
    const entry = acts.get(userId) ?? { votes: 0, comments: 0, entries: 0, guesses: 0, reactions: 0, firstAt: at };
    entry[kind] += 1;
    if (at < entry.firstAt) entry.firstAt = at;
    acts.set(userId, entry);
  };
  for (const post of posts) {
    for (const option of post.poll?.options ?? []) for (const voter of option.voterIds) touch(voter, 'votes', post.createdAt);
    for (const entry of post.contest?.entries ?? []) touch(entry.userId, 'entries', entry.at);
    for (const guess of post.guess?.guesses ?? []) touch(guess.userId, 'guesses', guess.at);
    for (const comment of post.comments ?? []) touch(comment.authorId, 'comments', (comment as { at?: string }).at ?? post.createdAt);
    for (const reaction of post.reactions ?? []) touch(reaction.userId, 'reactions', reaction.at);
  }
  return acts;
}

/** What the shop's customers screens read, gathered once. */
async function gather(repository: Repo, shopId: string) {
  const [shop, orders, drafts, listings, follows, posts] = await Promise.all([
    repository.getUserById(shopId),
    repository.listOrdersForSeller(shopId),
    repository.listCheckoutDrafts(shopId),
    repository.listListings({ sellerId: shopId, includeHidden: true }),
    repository.listFollowsOf(shopId),
    repository.listPosts(shopId, 200).catch(() => [] as Post[]),
  ]);
  const staff = staffOf(shop, shopId);
  const likes = (await repository.listLikesForListings(listings.map((listing) => listing.id)))
    .filter((like) => !staff.has(like.userId));
  const preOrders = listings.filter((listing) => listing.preOrder);
  const pledges = (await Promise.all(preOrders.map((listing) => repository.listPledges(listing.id)))).flat()
    .filter((pledge) => !staff.has(pledge.userId));
  const powerSales = await repository.listPowerSales(shopId).catch(() => []);
  const saleListings = new Set(powerSales.flatMap((sale) => sale.items.map((item) => item.listingId)).filter((id): id is string => Boolean(id)));
  const preOrderListings = new Set(preOrders.map((listing) => listing.id));
  return {
    shop, staff, listings, likes, pledges, posts,
    orders: orders.filter((order) => !staff.has(order.buyerId) && order.placedAt !== null),
    drafts: drafts.filter((order) => !staff.has(order.buyerId) && order.placedAt === null && order.status === 'pending_payment'),
    follows: follows.filter((follow) => !staff.has(follow.followerId)),
    sourceFacts: { saleListings, preOrderListings },
  };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/** Each buyer's orders here, oldest first, kept ones only. */
function ordersByBuyer(orders: readonly Order[]): Map<string, Order[]> {
  const byBuyer = new Map<string, Order[]>();
  for (const order of [...orders].sort((a, b) => placedOf(a).localeCompare(placedOf(b)))) {
    byBuyer.set(order.buyerId, [...(byBuyer.get(order.buyerId) ?? []), order]);
  }
  return byBuyer;
}

function spendOf(buyerId: string, rows: readonly Order[]): Spend | null {
  const kept = rows.filter((order) => !GONE_STATUSES.has(order.status));
  if (kept.length === 0) return null;
  return {
    buyerId,
    orders: kept.length,
    spentMinor: kept.reduce((sum, order) => sum + valueOf(order), 0),
    firstAt: placedOf(kept[0]!),
    lastAt: placedOf(kept[kept.length - 1]!),
  };
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

/* ── GET /api/me/customers ─────────────────────────────────────────────── */

async function customers(request: HttpRequest, _context: InvocationContext) {
  const { repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot read the customers of that shop.');
  const days = periodDays(request);
  const now = Date.now();
  const since = now - days * DAY;
  const data = await gather(repository, shopId);
  const listingById = new Map(data.listings.map((listing) => [listing.id, listing]));
  const byBuyer = ordersByBuyer(data.orders);

  const spends = [...byBuyer].flatMap(([buyerId, rows]) => {
    const spend = spendOf(buyerId, rows);
    return spend ? [spend] : [];
  });
  const vipCut = vipCutoff(spends);
  const spendBy = new Map(spends.map((row) => [row.buyerId, row]));
  const followers = new Set(data.follows.map((follow) => follow.followerId));
  const savesBy = new Map<string, number>();
  for (const like of data.likes) savesBy.set(like.userId, (savesBy.get(like.userId) ?? 0) + 1);
  const checkoutsBy = new Map<string, number>();
  for (const draft of data.drafts) checkoutsBy.set(draft.buyerId, (checkoutsBy.get(draft.buyerId) ?? 0) + 1);

  /* Each buyer, with what they did here. Anybody who ordered at all is listed,
     cancelled-only buyers too: their record is part of the answer to "who are they". */
  const who = await names(repository, [...byBuyer.keys()].slice(0, MAX_ROWS));
  const rows = [...byBuyer].map(([buyerId, rows]) => {
    const spend = spendBy.get(buyerId) ?? null;
    const first = rows[0]!;
    const bought = rows.flatMap((order) => {
      const listing = listingById.get(order.listingId);
      return listing ? [{ category: listing.category, tags: listing.tags, priceMinor: order.unitPriceMinor }] : [];
    });
    const savedItems = data.likes.filter((like) => like.userId === buyerId).flatMap((like) => {
      const listing = listingById.get(like.listingId);
      return listing ? [{ category: listing.category, tags: listing.tags, priceMinor: listing.priceMinor }] : [];
    });
    const record = reliabilityOf(rows, now);
    return {
      id: buyerId,
      who: who.get(buyerId) ?? { name: 'Customer', handle: null },
      orders: spend?.orders ?? 0,
      spentMinor: spend?.spentMinor ?? 0,
      firstAt: placedOf(first),
      lastAt: spend?.lastAt ?? placedOf(rows[rows.length - 1]!),
      owedMinor: owedBy(rows),
      label: spend ? valueLabel(spend, vipCut, now) : 'one_time' as ValueLabel,
      isNew: Date.parse(placedOf(first)) >= since,
      firstSource: orderSource(first, data.sourceFacts),
      reliability: reliabilityWord(record),
      saves: savesBy.get(buyerId) ?? 0,
      openCheckouts: checkoutsBy.get(buyerId) ?? 0,
      follows: followers.has(buyerId),
      nextDueAt: spend ? nextOrderDue(spend) : null,
      topics: interestOf(bought, savedItems).topics.slice(0, 3).map((topic) => topic.name),
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, MAX_ROWS);

  /* The summary: this period's customers, and the shop's standing figures. */
  const inPeriod = data.orders.filter((order) => Date.parse(placedOf(order)) >= since && !GONE_STATUSES.has(order.status));
  const periodBuyers = new Set(inPeriod.map((order) => order.buyerId));
  const newInPeriod = [...periodBuyers].filter((id) => Date.parse(placedOf(byBuyer.get(id)![0]!)) >= since).length;
  const repeaters = spends.filter((row) => row.orders > 1).length;
  const summary = {
    days,
    customers: spends.length,
    activeInPeriod: periodBuyers.size,
    newInPeriod,
    returningInPeriod: periodBuyers.size - newInPeriod,
    repeatRate: spends.length ? Math.round((repeaters / spends.length) * 100) : null,
    averageOrderMinor: inPeriod.length ? Math.round(inPeriod.reduce((sum, order) => sum + valueOf(order), 0) / inPeriod.length) : 0,
    followers: followers.size,
    followersInPeriod: data.follows.filter((follow) => Date.parse(follow.createdAt) >= since).length,
    owedMinor: rows.reduce((sum, row) => sum + row.owedMinor, 0),
    valueCounts: Object.fromEntries(VALUE_LABELS.map((label) => [label, rows.filter((row) => row.orders > 0 && row.label === label).length])) as Record<ValueLabel, number>,
  };

  return json(200, { summary, customers: rows, pro: await proReadings(repository, shopId, data, byBuyer, spendBy, vipCut, now) });
}

/** The deeper readings: how customers arrived, where they stop, who to reach, and how the shop compares. */
async function proReadings(
  repository: Repo, shopId: string, data: Gathered, byBuyer: Map<string, Order[]>, spendBy: Map<string, Spend>, vipCut: number, now: number,
) {
  const listingById = new Map(data.listings.map((listing) => [listing.id, listing]));

  /* How customers first arrived, and what they have been worth since. */
  const sources = ORDER_SOURCES.map((source) => ({ source, customers: 0, spentMinor: 0 }));
  for (const [buyerId, rows] of byBuyer) {
    const spend = spendBy.get(buyerId);
    if (!spend) continue;
    const entry = sources.find((row) => row.source === orderSource(rows[0]!, data.sourceFacts))!;
    entry.customers += 1;
    entry.spentMinor += spend.spentMinor;
  }

  /* Where people stop: for every person and item they touched, the furthest step. */
  const reviews = await repository.listReviewsAbout(shopId).catch(() => []);
  const reviewedOrders = new Set(reviews.filter((review) => review.direction === 'buyer_to_seller').map((review) => review.orderId));
  const pairs = new Map<string, { saved: boolean; checkout: boolean; order: Order | null; reviewed: boolean }>();
  const pair = (userId: string, listingId: string) => {
    const key = `${userId}:${listingId}`;
    const entry = pairs.get(key) ?? { saved: false, checkout: false, order: null, reviewed: false };
    pairs.set(key, entry);
    return entry;
  };
  for (const like of data.likes) pair(like.userId, like.listingId).saved = true;
  for (const draft of data.drafts) pair(draft.buyerId, draft.listingId).checkout = true;
  for (const order of data.orders) {
    const entry = pair(order.buyerId, order.listingId);
    entry.checkout = true;
    // The order that went furthest stands for the pair.
    if (!entry.order || (order.completedAt && !entry.order.completedAt) || (order.paymentStatus === 'paid' && entry.order.paymentStatus !== 'paid')) entry.order = order;
    if (reviewedOrders.has(order.id)) entry.reviewed = true;
  }
  const reached: Record<PathStep, number> = Object.fromEntries(PATH_STEPS.map((step) => [step, 0])) as Record<PathStep, number>;
  const stoppedAt: Record<PathStep, number> = Object.fromEntries(PATH_STEPS.map((step) => [step, 0])) as Record<PathStep, number>;
  for (const facts of pairs.values()) {
    const furthest = furthestStep(facts);
    if (!furthest) continue;
    stoppedAt[furthest] += 1;
    // Saving is a step of its own, not one every buyer takes: it counts only
    // when they saved. From pressing Buy on, each step implies the ones before.
    if (facts.saved) reached.saved += 1;
    for (const step of PATH_STEPS.slice(1, PATH_STEPS.indexOf(furthest) + 1)) reached[step] += 1;
  }

  /* People worth reaching: saved and not bought, stopped at Buy, pledged and not booked. */
  const bought = new Set(data.orders.map((order) => `${order.buyerId}:${order.listingId}`));
  const savedNotBought = data.likes
    .filter((like) => !bought.has(`${like.userId}:${like.listingId}`) && listingById.get(like.listingId)?.status === 'active')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 40);
  const stalled = [...data.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40);
  const pledgedOpen = data.pledges.filter((pledge) => !bought.has(`${pledge.userId}:${pledge.listingId}`)).slice(0, 40);
  const words = shopWords(data.listings.filter((listing) => listing.status === 'active'));
  const wants = (await repository.listOpenWants({ limit: 200 }).catch(() => []))
    .filter((want) => !data.staff.has(want.buyerId) && termMatches(`${want.title} ${want.category}`.toLowerCase(), words))
    .slice(0, 20);

  /* Engagement and what it led to. */
  const acts = participation(data.posts, data.staff);
  const engaged = [...acts.keys()];
  const engagedBuyers = engaged.filter((id) => byBuyer.has(id));
  const boughtAfter = engaged.filter((id) => (byBuyer.get(id) ?? []).some((order) => placedOf(order) >= acts.get(id)!.firstAt));
  const kinds = (['votes', 'comments', 'entries', 'guesses', 'reactions'] as const).map((kind) => {
    const people = engaged.filter((id) => acts.get(id)![kind] > 0);
    return {
      kind,
      people: people.length,
      buyers: people.filter((id) => byBuyer.has(id)).length,
      spentMinor: people.reduce((sum, id) => sum + (spendBy.get(id)?.spentMinor ?? 0), 0),
    };
  });

  /* Who would want what: for each live item, the customers it suits best who have not bought it. */
  const interests = new Map([...byBuyer].map(([buyerId, rows]) => [buyerId, interestOf(
    rows.flatMap((order) => {
      const listing = listingById.get(order.listingId);
      return listing ? [{ category: listing.category, tags: listing.tags, priceMinor: order.unitPriceMinor }] : [];
    }),
    data.likes.filter((like) => like.userId === buyerId).flatMap((like) => {
      const listing = listingById.get(like.listingId);
      return listing ? [{ category: listing.category, tags: listing.tags, priceMinor: listing.priceMinor }] : [];
    }),
  )]));
  const live = data.listings.filter((listing) => listing.status === 'active' && !listing.privateFor).slice(0, 30);
  const matches = live.map((listing) => {
    const fits = [...interests]
      .filter(([buyerId]) => !bought.has(`${buyerId}:${listing.id}`))
      .map(([buyerId, interest]) => ({ buyerId, score: matchScore(interest, listing) }))
      .filter((row) => row.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return { listingId: listing.id, title: listing.title, photo: photoOf(listing), priceMinor: listing.priceMinor, fits };
  }).filter((row) => row.fits.length > 0).sort((a, b) => b.fits.length - a.fits.length).slice(0, 10);

  /* How the shop compares: the median of shops with the same figures, unnamed. */
  const shops = (await repository.listStoreOwners().catch(() => [] as User[])).filter((owner) => owner.id !== shopId);
  const own = data.shop?.sellerTrust;
  const benchmark = {
    shops: shops.length,
    onTime: { you: own?.onTimeDispatchRate ?? null, median: median(shops.map((owner) => owner.sellerTrust.onTimeDispatchRate).filter((rate): rate is number => rate != null)) },
    repeat: { you: own?.repeatCustomerRate ?? null, median: median(shops.map((owner) => owner.sellerTrust.repeatCustomerRate).filter((rate): rate is number => rate != null)) },
    completed: { you: own?.completedTransactions ?? 0, median: median(shops.map((owner) => owner.sellerTrust.completedTransactions)) },
    followers: { you: data.shop?.sellerProfile?.followerCount ?? 0, median: median(shops.map((owner) => owner.sellerProfile?.followerCount ?? 0)) },
  };

  /* Everybody named below, in one read. */
  const named = await names(repository, [
    ...savedNotBought.map((like) => like.userId), ...stalled.map((order) => order.buyerId),
    ...pledgedOpen.map((pledge) => pledge.userId), ...matches.flatMap((row) => row.fits.map((fit) => fit.buyerId)),
    ...[...acts].sort((a, b) => total(b[1]) - total(a[1])).slice(0, 12).map(([id]) => id),
  ]);
  const party = (id: string): { id: string; who: PartyRef } => ({ id, who: named.get(id) ?? { name: 'Customer', handle: null } });
  const item = (listingId: string) => {
    const listing = listingById.get(listingId);
    return { listingId, title: listing?.title ?? 'Item', photo: photoOf(listing), priceMinor: listing?.priceMinor ?? 0 };
  };

  return {
    sources: sources.filter((row) => row.customers > 0).map((row) => ({
      ...row, averageMinor: row.customers ? Math.round(row.spentMinor / row.customers) : 0,
    })),
    path: PATH_STEPS.map((step) => ({ step, reached: reached[step], stopped: stoppedAt[step] })),
    signals: {
      saved: savedNotBought.map((like) => ({ ...party(like.userId), ...item(like.listingId), at: like.createdAt })),
      checkout: stalled.map((order) => ({ ...party(order.buyerId), ...item(order.listingId), at: order.updatedAt, orderId: order.id, clicks: order.buyClicks ?? 1 })),
      pledged: pledgedOpen.map((pledge) => ({ ...party(pledge.userId), ...item(pledge.listingId), at: pledge.createdAt, units: pledge.units })),
      wants: wants.map((want) => ({
        id: want.buyerId, who: { name: want.buyerName, handle: want.buyerHandle }, wantId: want.id, title: want.title,
        budgetMinor: want.budgetMinor, at: want.createdAt,
      })),
    },
    engagement: {
      people: engaged.length,
      buyers: engagedBuyers.length,
      boughtAfter: boughtAfter.length,
      kinds,
      top: [...acts].sort((a, b) => total(b[1]) - total(a[1])).slice(0, 12).map(([id, entry]) => ({
        ...party(id), acts: total(entry), orders: spendBy.get(id)?.orders ?? 0, spentMinor: spendBy.get(id)?.spentMinor ?? 0,
      })),
    },
    matches: matches.map((row) => ({ ...row, fits: row.fits.map((fit) => ({ ...party(fit.buyerId), score: fit.score })) })),
    benchmark,
    vipCutMinor: Number.isFinite(vipCut) ? vipCut : null,
    now: new Date(now).toISOString(),
  };
}

const total = (entry: { votes: number; comments: number; entries: number; guesses: number; reactions: number }) =>
  entry.votes + entry.comments + entry.entries + entry.guesses + entry.reactions;

/* ── GET /api/me/customers/{buyerId} ───────────────────────────────────── */

async function customer(request: HttpRequest, _context: InvocationContext) {
  const { repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot read the customers of that shop.');
  const buyerId = request.params.buyerId;
  if (!buyerId) return error(400, 'invalid_request', 'Say which customer.');
  const now = Date.now();
  const data = await gather(repository, shopId);
  if (data.staff.has(buyerId)) return error(404, 'not_found', 'That is somebody who works this shop.');
  const listingById = new Map(data.listings.map((listing) => [listing.id, listing]));
  const rows = data.orders.filter((order) => order.buyerId === buyerId).sort((a, b) => placedOf(b).localeCompare(placedOf(a)));
  const saves = data.likes.filter((like) => like.userId === buyerId);
  const checkouts = data.drafts.filter((order) => order.buyerId === buyerId);
  const pledges = data.pledges.filter((pledge) => pledge.userId === buyerId);
  const follows = data.follows.some((follow) => follow.followerId === buyerId);
  const acts = participation(data.posts, data.staff).get(buyerId) ?? null;
  // Only somebody who did something toward the shop is a customer of it.
  if (rows.length === 0 && saves.length === 0 && checkouts.length === 0 && pledges.length === 0 && !follows && !acts) {
    return error(404, 'not_found', 'They have not ordered, saved, followed or taken part here.');
  }

  const person = await repository.getUserById(buyerId);
  const who = (await names(repository, [buyerId])).get(buyerId) ?? { name: 'Customer', handle: null };
  const spends = [...ordersByBuyer(data.orders)].flatMap(([id, list]) => {
    const spend = spendOf(id, list);
    return spend ? [spend] : [];
  });
  const spend = spends.find((row) => row.buyerId === buyerId) ?? null;
  const vipCut = vipCutoff(spends);
  const bought = rows.flatMap((order) => {
    const listing = listingById.get(order.listingId);
    return listing ? [{ category: listing.category, tags: listing.tags, priceMinor: order.unitPriceMinor }] : [];
  });
  const savedItems = saves.flatMap((like) => {
    const listing = listingById.get(like.listingId);
    return listing ? [{ category: listing.category, tags: listing.tags, priceMinor: listing.priceMinor }] : [];
  });
  const interest = interestOf(bought, savedItems);
  const boughtIds = new Set(rows.map((order) => order.listingId));
  const suggestions = data.listings
    .filter((listing) => listing.status === 'active' && !listing.privateFor && !boughtIds.has(listing.id))
    .map((listing) => ({ listing, score: matchScore(interest, listing) }))
    .filter((row) => row.score >= 0.4)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ listing, score }) => ({ listingId: listing.id, title: listing.title, photo: photoOf(listing), priceMinor: listing.priceMinor, score }));

  // Reviews both ways on this customer's orders here, once revealed.
  const orderIds = new Set(rows.map((order) => order.id));
  const [aboutShop, aboutThem] = await Promise.all([
    repository.listReviewsAbout(shopId).catch(() => []),
    repository.listReviewsAbout(buyerId).catch(() => []),
  ]);
  const review = (row: { orderId: string; rating: number; body: string; createdAt: string; revealed: boolean }) =>
    ({ orderId: row.orderId, rating: row.rating, body: row.body, at: row.createdAt });

  return json(200, {
    id: buyerId,
    who,
    memberSince: person?.createdAt ?? null,
    follows,
    label: spend ? valueLabel(spend, vipCut, now) : null,
    orders: spend?.orders ?? 0,
    spentMinor: spend?.spentMinor ?? 0,
    owedMinor: owedBy(rows),
    firstAt: spend?.firstAt ?? null,
    lastAt: spend?.lastAt ?? null,
    nextDueAt: spend ? nextOrderDue(spend) : null,
    firstSource: rows.length ? orderSource(rows[rows.length - 1]!, data.sourceFacts) : null,
    reliability: { ...reliabilityOf(rows, now), ...reliabilityWord(reliabilityOf(rows, now)) },
    interest,
    history: rows.slice(0, 50).map((order) => ({
      orderId: order.id,
      itemName: order.itemName,
      photo: photoOf(listingById.get(order.listingId)),
      placedAt: placedOf(order),
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalMinor: orderMoney(order).totalMinor,
      owedMinor: GONE_STATUSES.has(order.status) ? 0 : orderMoney(order).outstandingMinor,
      punctuality: punctuality(order, new Date(now)),
      source: orderSource(order, data.sourceFacts),
    })),
    saves: saves.map((like) => ({
      listingId: like.listingId, title: listingById.get(like.listingId)?.title ?? 'Item', photo: photoOf(listingById.get(like.listingId)),
      priceMinor: listingById.get(like.listingId)?.priceMinor ?? 0, at: like.createdAt, bought: boughtIds.has(like.listingId),
      live: listingById.get(like.listingId)?.status === 'active',
    })),
    checkouts: checkouts.map((order) => ({ orderId: order.id, listingId: order.listingId, itemName: order.itemName, at: order.updatedAt, clicks: order.buyClicks ?? 1 })),
    pledges: pledges.map((pledge) => ({ listingId: pledge.listingId, title: listingById.get(pledge.listingId)?.title ?? 'Item', units: pledge.units, at: pledge.createdAt })),
    engagement: acts,
    reviews: {
      aboutShop: aboutShop.filter((row) => row.revealed && orderIds.has(row.orderId) && row.authorId === buyerId).map(review),
      aboutThem: aboutThem.filter((row) => row.revealed && orderIds.has(row.orderId)).map(review),
    },
    suggestions,
  });
}

/* ── POST /api/me/customers/message ────────────────────────────────────── */

/**
 * One short message from the shop to a group it picked - a new drop for its
 * VIPs, early access to a sale. Reaches only people who bought, saved,
 * followed or took part here; skips anybody who turned shop messages off;
 * at most GROUP_MESSAGE_MAX people, GROUP_MESSAGES_PER_DAY times a day, and
 * one a day to the same person from this shop.
 */
async function messageGroup(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot message the customers of that shop.');
  const locked = await proRefusal(repository, shopId, 'customers');
  if (locked) return locked;
  let body: { buyerIds?: unknown; text?: unknown; listingId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 3) return error(400, 'invalid_message', 'Write the message first.');
  if (text.length > 300) return error(400, 'invalid_message', 'Keep it under 300 characters.');
  const ids = [...new Set((Array.isArray(body.buyerIds) ? body.buyerIds : []).filter((id): id is string => typeof id === 'string'))];
  if (ids.length === 0) return error(400, 'invalid_message', 'Pick who it goes to.');
  if (ids.length > GROUP_MESSAGE_MAX) return error(400, 'too_many', `A message reaches at most ${GROUP_MESSAGE_MAX} people.`);

  const data = await gather(repository, shopId);
  const known = new Set([
    ...data.orders.map((order) => order.buyerId), ...data.likes.map((like) => like.userId),
    ...data.follows.map((follow) => follow.followerId), ...data.pledges.map((pledge) => pledge.userId),
    ...participation(data.posts, data.staff).keys(),
  ]);
  const shopName = data.shop?.sellerProfile?.storefrontName || data.shop?.displayName || 'A shop';
  let link = `/${data.shop?.sellerProfile?.username ?? ''}`;
  if (typeof body.listingId === 'string' && body.listingId) {
    const listing = data.listings.find((row) => row.id === body.listingId && row.status === 'active' && !row.privateFor);
    if (!listing) return error(404, 'not_found', 'That item is not on sale in this shop.');
    link = `/listing/${listing.id}`;
  }

  // A day's allowance, counted on the shop's own record of what it sent.
  const logId = `shop-messages-${shopId}`;
  const log = (await repository.getSiteContent(logId))?.data as { sent?: { at: string; count: number }[] } | undefined;
  const today = (log?.sent ?? []).filter((row) => now() - Date.parse(row.at) < DAY);
  if (today.length >= GROUP_MESSAGES_PER_DAY) {
    return error(429, 'too_many_today', `A shop can send ${GROUP_MESSAGES_PER_DAY} group messages a day. Try again tomorrow.`);
  }

  const people = await repository.listUsersByIds(ids.filter((id) => known.has(id) && !data.staff.has(id)));
  let sent = 0;
  let optedOut = 0;
  let recent = 0;
  for (const person of people) {
    if (person.notificationPrefs?.shopMessagesOff) { optedOut += 1; continue; }
    const notices = await repository.listNotifications(person.id, 30);
    if (notices.some((row) => row.kind === 'shop_message' && row.title.startsWith(shopName) && now() - Date.parse(row.createdAt) < DAY)) {
      recent += 1;
      continue;
    }
    await notify(repository, [person.id], { kind: 'shop_message', title: `${shopName} says`, body: text, link }, { except: user.id });
    sent += 1;
  }
  await repository.mutateSiteContent(logId, (current) => {
    const at = new Date().toISOString();
    const kept = ((current?.data as typeof log)?.sent ?? []).filter((row) => now() - Date.parse(row.at) < 7 * DAY);
    return { id: logId, data: { sent: [...kept, { at, count: sent }] }, updatedBy: user.id, ttl: 8 * 86_400, createdAt: current?.createdAt ?? at, updatedAt: at };
  });
  return json(200, { sent, optedOut, recent, skipped: ids.length - people.length, left: GROUP_MESSAGES_PER_DAY - today.length - 1 });
}

const now = () => Date.now();

/* ── GET /api/me/data/overview ─────────────────────────────────────────── */

async function overview(request: HttpRequest, _context: InvocationContext) {
  const { repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot read the numbers for that shop.');
  const days = periodDays(request);
  const at = new Date();
  const since = at.getTime() - days * DAY;
  const before = since - days * DAY;
  const data = await gather(repository, shopId);
  // Opening the numbers is a moment to recount the shop's public ones.
  const onTimeNow = await refreshSellerStats(repository, shopId, at).catch(() => null);

  const within = (order: Order, from: number, to: number) => {
    const time = Date.parse(placedOf(order));
    return time >= from && time < to;
  };
  const figures = (from: number, to: number, fromDay: string, toDay: string) => {
    const orders = data.orders.filter((order) => within(order, from, to) && !GONE_STATUSES.has(order.status));
    const buyers = new Set(orders.map((order) => order.buyerId));
    const firstOrder = new Map<string, string>();
    for (const order of data.orders) {
      const time = placedOf(order);
      if (!firstOrder.has(order.buyerId) || time < firstOrder.get(order.buyerId)!) firstOrder.set(order.buyerId, time);
    }
    const views = data.listings.reduce((sum, listing) => sum + viewsBetween(listing.viewLog, fromDay, toDay), 0);
    const revenueMinor = orders.reduce((sum, order) => sum + valueOf(order), 0);
    return {
      revenueMinor,
      orders: orders.length,
      customers: buyers.size,
      newCustomers: [...buyers].filter((id) => Date.parse(firstOrder.get(id)!) >= from).length,
      views,
      saves: data.likes.filter((like) => { const time = Date.parse(like.createdAt); return time >= from && time < to; }).length,
      conversion: views > 0 ? Math.round((orders.length / views) * 1000) / 10 : null,
      averageOrderMinor: orders.length ? Math.round(revenueMinor / orders.length) : 0,
    };
  };
  const dayList = lastDays(days, at);
  const prevDays = lastDays(days * 2, at).slice(0, days);
  const current = figures(since, at.getTime() + 1, dayList[0]!, dayList[dayList.length - 1]!);
  const previous = figures(before, since, prevDays[0]!, prevDays[prevDays.length - 1]!);

  /* On time: the record and the orders behind it that went wrong. */
  const stats = onTimeNow ?? onTimeStats(data.orders, at);
  const lateRows = data.orders
    .map((order) => ({ order, state: punctuality(order, at) }))
    .filter(({ state }) => state === 'late' || state === 'overdue')
    .filter(({ order }) => Date.parse(dueBy(order)!) >= at.getTime() - 90 * DAY)
    .sort((a, b) => (dueBy(b.order) ?? '').localeCompare(dueBy(a.order) ?? ''))
    .slice(0, 25);
  const pending = data.orders
    .map((order) => ({ order, state: punctuality(order, at), off: daysAgainstPromise(order, at) }))
    .filter(({ state, off }) => state === 'pending' && off != null && off >= -5)
    .sort((a, b) => (a.off ?? 0) - (b.off ?? 0))
    .reverse()
    .slice(0, 15);
  const named = await names(repository, [...lateRows, ...pending].map(({ order }) => order.buyerId));
  const orderRow = (order: Order) => ({
    orderId: order.id, itemName: order.itemName, buyerId: order.buyerId,
    who: named.get(order.buyerId) ?? { name: 'Customer', handle: null },
    placedAt: placedOf(order), dueBy: dueBy(order), days: daysAgainstPromise(order, at),
    eta: order.deliveryEta ?? null,
  });
  const noEta = data.listings.filter((listing) => listing.status === 'active' && !listing.deliveryEta)
    .map((listing) => ({ listingId: listing.id, title: listing.title }));

  /* Cancellations in the period, and why. */
  const periodAll = data.orders.filter((order) => within(order, since, at.getTime() + 1));
  const calledOff = periodAll.filter((order) => order.status === 'rejected' || order.status === 'cancelled' || order.status === 'cancelled_reversed' || order.status === 'payment_reversal_pending');
  const reasons = new Map<string, number>();
  for (const order of calledOff) {
    const reason = (order.cancelReason ?? '').trim() || (order.status === 'rejected' ? 'Turned down' : 'No reason given');
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  /* Views: by day, by where they came from, and what each item turned them into. */
  const daily = dayList.map((day) => ({ day, views: data.listings.reduce((sum, listing) => sum + viewsBetween(listing.viewLog, day, day), 0) }));
  const bySource = new Map<ViewSource, number>();
  for (const listing of data.listings) {
    for (const [source, count] of Object.entries(viewsBySource(listing.viewLog, dayList[0]!, dayList[dayList.length - 1]!))) {
      bySource.set(source as ViewSource, (bySource.get(source as ViewSource) ?? 0) + (count ?? 0));
    }
  }
  const items = data.listings
    .filter((listing) => listing.status !== 'archived' && !listing.privateFor)
    .map((listing) => {
      const views = viewsBetween(listing.viewLog, dayList[0]!, dayList[dayList.length - 1]!);
      const orders = data.orders.filter((order) => order.listingId === listing.id && within(order, since, at.getTime() + 1) && !GONE_STATUSES.has(order.status)).length;
      const saves = data.likes.filter((like) => like.listingId === listing.id && Date.parse(like.createdAt) >= since).length;
      return {
        listingId: listing.id, title: listing.title, photo: photoOf(listing), views, saves, orders,
        conversion: views > 0 ? Math.round((orders / views) * 1000) / 10 : null,
        topSource: [...Object.entries(viewsBySource(listing.viewLog, dayList[0]!, dayList[dayList.length - 1]!))]
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? null,
      };
    })
    .filter((row) => row.views + row.saves + row.orders > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 30);

  /* What buyers search for that touches this shop, and what nobody had. */
  const searches = await readSearches(repository, days, at).catch(() => ({}));
  const words = shopWords(data.listings.filter((listing) => listing.status === 'active'));
  const terms = Object.entries(searches).sort((a, b) => b[1].n - a[1].n);
  const matching = terms.filter(([term]) => termMatches(term, words)).slice(0, 15).map(([term, count]) => ({ term, ...count }));
  const unmet = terms.filter(([, count]) => count.empty > 0).sort((a, b) => b[1].empty - a[1].empty).slice(0, 15)
    .map(([term, count]) => ({ term, ...count }));

  return json(200, {
    days,
    today: dayKey(at),
    current,
    previous,
    onTime: {
      ...stats,
      lateOrders: lateRows.map(({ order, state }) => ({ ...orderRow(order), state })),
      dueSoon: pending.map(({ order }) => orderRow(order)),
      listingsWithoutEta: noEta,
    },
    reply: replyTimes(data.orders, at.getTime()),
    cancellations: {
      orders: periodAll.length,
      calledOff: calledOff.length,
      rate: periodAll.length ? Math.round((calledOff.length / periodAll.length) * 100) : null,
      turnedDown: calledOff.filter((order) => order.status === 'rejected').length,
      reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, count]) => ({ reason, count })),
    },
    views: {
      daily,
      bySource: VIEW_SOURCES.map((source) => ({ source, views: bySource.get(source) ?? 0 })).filter((row) => row.views > 0)
        .sort((a, b) => b.views - a.views),
      items,
    },
    searches: { matching, unmet },
    listingsLive: data.listings.filter((listing) => listing.status === 'active').length,
  });
}

export const customersRoute = handler(customers);
export const customerRoute = handler(customer);
export const messageGroupRoute = handler(messageGroup);
export const dataOverviewRoute = handler(overview);

const anon = { authLevel: 'anonymous' } as const;
app.http('me-customers', { ...anon, methods: ['GET'], route: 'me/customers', handler: customersRoute });
app.http('me-customers-message', { ...anon, methods: ['POST'], route: 'me/customers/message', handler: messageGroupRoute });
app.http('me-customer', { ...anon, methods: ['GET'], route: 'me/customers/{buyerId}', handler: customerRoute });
app.http('me-data-overview', { ...anon, methods: ['GET'], route: 'me/data/overview', handler: dataOverviewRoute });
