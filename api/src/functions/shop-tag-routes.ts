import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing } from '../../../shared/models.js';
import { isExpired } from '../../../shared/payments.js';
import { isCancelledLike } from '../../../shared/orders.js';
import { affinity, shopMatchScore, tagFromSlug, tagKey } from '../../../shared/shop-tags.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { shopCard, shopIndex, type IndexedShop } from '../shop-identity.js';
import { shopFor } from './insight-routes.js';
import { error, handler, json } from './http.js';

/**
 * Shops found by what they are about.
 *
 * Every answer here is read from each shop's identity (shared/shop-tags.ts):
 * search, a tag's own page, similar shops, shops for you, the tags offered
 * when listing, and the Data tab's view of how each tag does.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** The keys a listing stands for: its tags and its category. */
const keysOf = (listing: Pick<Listing, 'tags' | 'category'>) =>
  new Set([...listing.tags, listing.category].filter(Boolean).map(tagKey));

/** GET /api/shops/search?q= - shops whose name or tags match. */
async function searchShops(request: HttpRequest, _context: InvocationContext) {
  const q = (request.query.get('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return json(200, { shops: [] });
  const shops = await shopIndex(await getRepository());
  const hits = shops
    .map((shop) => ({ shop, ...shopMatchScore(q, shop) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.shop.followerCount - a.shop.followerCount)
    .slice(0, 8);
  return json(200, { shops: hits.map((row) => shopCard(row.shop, row.matched)) });
}

/** GET /api/shop-tags/{slug} - every shop carrying one tag, the most devoted first. */
async function shopsByTag(request: HttpRequest, _context: InvocationContext) {
  const key = tagFromSlug(request.params.slug ?? '');
  if (key.length < 2) return error(404, 'not_found', 'No such tag.');
  const shops = await shopIndex(await getRepository());
  const rows = shops
    .flatMap((shop) => {
      const tag = shop.identity.find((row) => row.k === key);
      return tag ? [{ shop, tag }] : [];
    })
    .sort((a, b) => (b.tag.own ?? 0) - (a.tag.own ?? 0) || b.tag.n - a.tag.n || b.shop.followerCount - a.shop.followerCount);
  // The commonest spelling among the shops that use it.
  const labels = new Map<string, number>();
  for (const { tag } of rows) labels.set(tag.l, (labels.get(tag.l) ?? 0) + 1);
  const label = [...labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? key;
  return json(200, { tag: { key, label }, shops: rows.slice(0, 40).map(({ shop }) => shopCard(shop)) });
}

/** Shops ranked against a set of interests, leaving some out. */
function rank(shops: IndexedShop[], interest: Map<string, number>, skip: Set<string>, limit: number) {
  return shops
    .filter((shop) => !skip.has(shop.id))
    .map((shop) => ({ shop, score: affinity(interest, shop.identity) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.shop.followerCount - a.shop.followerCount)
    .slice(0, limit)
    .map((row) => shopCard(row.shop, row.shop.identity.filter((tag) => interest.has(tag.k)).slice(0, 2).map((tag) => tag.l)));
}

/** GET /api/shops/{id}/similar - shops about the same things as this one. */
async function similarShops(request: HttpRequest, _context: InvocationContext) {
  const shops = await shopIndex(await getRepository());
  const me = shops.find((shop) => shop.id === request.params.id);
  if (!me) return json(200, { shops: [] });
  const interest = new Map(me.identity.map((tag) => [tag.k, Math.log2(1 + tag.n) + (tag.own ? 1 : 0)]));
  return json(200, { shops: rank(shops, interest, new Set([me.id]), 8) });
}

/**
 * GET /api/shops/for-you - shops to follow, from what this buyer likes and buys.
 *
 * Read from their recent likes and purchases and the shops they already
 * follow; nothing about them is stored for it. Signed out, or with nothing to
 * go on, it is the most followed shops.
 */
async function shopsForYou(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request);
  const repository = await getRepository();
  const shops = await shopIndex(repository);
  const interest = new Map<string, number>();
  const skip = new Set<string>();
  if (viewer) {
    skip.add(viewer.id);
    const [likes, orders, followed] = await Promise.all([
      repository.listLikesBy(viewer.id).catch(() => []),
      repository.listOrdersForBuyer(viewer.id).catch(() => []),
      repository.listFollowedSellerIds(viewer.id).catch(() => []),
    ]);
    const bump = (key: string, by: number) => interest.set(key, (interest.get(key) ?? 0) + by);
    const recent = <T extends { createdAt: string }>(rows: T[], n: number) =>
      [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, n);
    const ids = [
      ...recent(likes, 30).map((like) => ({ id: like.listingId, by: 1 })),
      ...recent(orders.filter((order) => !isCancelledLike(order.status)), 20).map((order) => ({ id: order.listingId, by: 2 })),
    ];
    const listings = await Promise.all(ids.map((row) => repository.getListing(row.id).catch(() => null)));
    listings.forEach((listing, at) => {
      if (listing) for (const key of keysOf(listing)) bump(key, ids[at]!.by);
    });
    for (const id of followed) {
      skip.add(id);
      const shop = shops.find((row) => row.id === id);
      for (const tag of shop?.identity.slice(0, 5) ?? []) bump(tag.k, 1);
    }
  }
  const basis = [...interest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => key);
  let picks = interest.size > 0 ? rank(shops, interest, skip, 10) : [];
  if (picks.length < 4) {
    const taken = new Set([...skip, ...picks.map((row) => row.id)]);
    picks = [...picks, ...shops
      .filter((shop) => !taken.has(shop.id) && shop.handle)
      .sort((a, b) => b.followerCount - a.followerCount)
      .slice(0, 10 - picks.length)
      .map((shop) => shopCard(shop))];
  }
  return json(200, { shops: picks, basis });
}

/** GET /api/shops/{id}/tags - the shop's own tags, most used first, for filling in a listing. */
async function shopTags(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const owner = await repository.getUserById(request.params.id ?? '');
  const identity = owner?.sellerProfile?.identity ?? [];
  return json(200, { tags: identity.map((tag) => tag.l) });
}

/**
 * GET /api/me/tag-insights?store= - how each of the shop's tags does.
 *
 * For every tag the shop is known by: how many of its items carry it, the
 * likes they draw against the same tag across the marketplace, what sold,
 * and how many shops compete on it. Then tags that do well on items like
 * this shop's that it never uses.
 */
async function tagInsights(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const sellerId = await shopFor(request, repository, user);
  if (!sellerId) return error(403, 'forbidden', 'You cannot read the numbers for that shop.');

  const [owner, mine, market, orders, shops] = await Promise.all([
    repository.getUserById(sellerId),
    repository.listListings({ sellerId, includeHidden: true }),
    repository.listListings({}),
    repository.listOrdersForSeller(sellerId),
    shopIndex(repository),
  ]);
  const identity = owner?.sellerProfile?.identity ?? [];
  const live = (rows: Listing[]) => rows.filter((row) => !row.privateFor && !isExpired(row) && row.status !== 'archived');
  const ours = live(mine);
  const others = live(market).filter((row) => row.sellerId !== sellerId);
  const sold = new Map<string, number>();
  for (const order of orders) {
    if (!isCancelledLike(order.status)) sold.set(order.listingId, (sold.get(order.listingId) ?? 0) + 1);
  }
  const byKey = (rows: Listing[], key: string) => rows.filter((row) => keysOf(row).has(key));
  const likesPer = (rows: Listing[]) => (rows.length ? rows.reduce((sum, row) => sum + (row.likeCount ?? 0), 0) / rows.length : 0);
  const round = (value: number) => Math.round(value * 10) / 10;

  const tags = identity.map((tag) => {
    const yours = byKey(ours, tag.k);
    const theirs = byKey(others, tag.k);
    const yourLikes = likesPer(yours);
    const marketLikes = likesPer(theirs);
    const verdict = yours.length === 0
      ? 'none_live'
      : theirs.length < 3 ? 'open'
        : yourLikes >= marketLikes * 1.2 ? 'ahead'
          : yourLikes <= marketLikes * 0.8 ? 'behind' : 'level';
    return {
      key: tag.k,
      label: tag.l,
      own: Boolean(tag.own),
      yourItems: yours.length,
      yourLikesPerItem: round(yourLikes),
      sold: mine.filter((row) => keysOf(row).has(tag.k)).reduce((sum, row) => sum + (sold.get(row.id) ?? 0), 0),
      marketItems: theirs.length,
      marketLikesPerItem: round(marketLikes),
      shopsSharing: shops.filter((shop) => shop.id !== sellerId && shop.identity.some((row) => row.k === tag.k)).length,
      verdict,
    };
  });

  /* Tags that draw likes on items that share a tag with this shop's, and
     that the shop itself never uses. */
  const mineKeys = new Set(identity.map((tag) => tag.k));
  const near = others.filter((row) => [...keysOf(row)].some((key) => mineKeys.has(key)));
  const pool = new Map<string, { label: string; items: number; likes: number }>();
  for (const row of near) {
    for (const raw of row.tags) {
      const key = tagKey(raw);
      if (key.length < 2 || mineKeys.has(key)) continue;
      const entry = pool.get(key) ?? { label: raw.trim(), items: 0, likes: 0 };
      entry.items += 1;
      entry.likes += row.likeCount ?? 0;
      pool.set(key, entry);
    }
  }
  const nearLikes = likesPer(near);
  const ideas = [...pool.entries()]
    .filter(([, entry]) => entry.items >= 2 && entry.likes / entry.items >= nearLikes)
    .sort((a, b) => b[1].likes / b[1].items - a[1].likes / a[1].items)
    .slice(0, 5)
    .map(([key, entry]) => ({ key, label: entry.label, items: entry.items, likesPerItem: round(entry.likes / entry.items) }));

  return json(200, { tags, ideas });
}

export const searchShopsRoute = handler(searchShops);
export const shopsByTagRoute = handler(shopsByTag);
export const similarShopsRoute = handler(similarShops);
export const shopsForYouRoute = handler(shopsForYou);
export const shopTagsRoute = handler(shopTags);
export const tagInsightsRoute = handler(tagInsights);

const anon = { authLevel: 'anonymous' } as const;

app.http('shops-search', { ...anon, methods: ['GET'], route: 'shops/search', handler: searchShopsRoute });
app.http('shops-for-you', { ...anon, methods: ['GET'], route: 'shops/for-you', handler: shopsForYouRoute });
app.http('shops-similar', { ...anon, methods: ['GET'], route: 'shops/{id}/similar', handler: similarShopsRoute });
app.http('shops-tags', { ...anon, methods: ['GET'], route: 'shops/{id}/tags', handler: shopTagsRoute });
app.http('shop-tag', { ...anon, methods: ['GET'], route: 'shop-tags/{slug}', handler: shopsByTagRoute });
app.http('me-tag-insights', { ...anon, methods: ['GET'], route: 'me/tag-insights', handler: tagInsightsRoute });
