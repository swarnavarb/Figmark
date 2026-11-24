import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { factsOf } from '../../../shared/category-specs.js';
import {
  DNA_TAGS_PER_POST, dnaDocId, heatOf, linkKey, productWords,
  type DnaHuntCard, type DnaLinkKind, type DnaListingCard, type DnaPhoto, type DnaPostCard, type DnaReviewCard,
  type DnaShop, type DnaSummary, type DnaTimelineEntry, type DnaView, type ProductDna,
} from '../../../shared/dna.js';
import { REVIEW_PHOTO_MAX, type Listing, type Order, type Post, type StoreReview, type User, type Want } from '../../../shared/models.js';
import { reviewRevealed } from '../../../shared/orders.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import {
  addLink, dnaForItem, dnaForWant, dnaIndex, dnasForListing, dnasForPost, dnasLinked, findBackground, getDna, isShown,
  itemOnSale, itemsOf, linkedItems, listingsOf, photoOf, removeLink, saveDna, summaryOf, sweepListings, type LinkedItem,
} from '../dna.js';
import { moderation } from '../moderation.js';
import { everListed } from '../photo-sales.js';
import { ownPhotos } from '../storage/index.js';
import { claimPhotos } from '../storage/release.js';
import { everyListing } from './catalog-routes.js';
import { error, handler, json } from './http.js';
import { alertFollowers, followsOf, marketOf, setFollow } from '../dna-follow.js';
import { timedDays } from '../../../shared/timed.js';
import { createWant } from './want-routes.js';

/**
 * Product DNA over HTTP.
 *
 * Reading is open to everybody, like the catalogue. Writing is three things:
 * a review of the product, which anybody signed in may leave once; an owner
 * fixing what their own listing, post or hunt is linked to; and staff folding
 * one DNA into another when the matcher made two of one product.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Orders that mean somebody bought it: placed and not called off. */
const BOUGHT = new Set<Order['status']>(['confirmed', 'in_fulfilment', 'shipped', 'delivered']);
/** How much of a DNA a page reads, at most: enough to be the whole picture for nearly every product. */
const LISTINGS_READ = 40;
const POSTS_READ = 24;
const HUNTS_READ = 20;
const SHOPS_FOR_PHOTOS = 8;

const shopOf = (user: User | undefined): DnaShop | null => (user ? {
  id: user.id,
  name: user.sellerProfile?.storefrontName ?? user.displayName,
  handle: user.sellerProfile?.username ?? user.username ?? null,
  photoUrl: user.sellerProfile?.photoUrl ?? null,
} : null);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

/** Monday of the week a date falls in, as YYYY-MM-DD. */
function weekOf(iso: string): string {
  const day = new Date(iso);
  const back = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return day.toISOString().slice(0, 10);
}

/** All the reviews left on a DNA and on any DNA folded into it, one per person, newest kept. */
async function reviewsOf(repository: Repo, dna: ProductDna): Promise<StoreReview[]> {
  const index = await dnaIndex(repository);
  const ids = [dna.id, ...[...index.byId.values()].filter((other) => other.mergedInto === dna.id).map((other) => other.id)];
  const [moderated, ...lists] = await Promise.all([
    moderation(repository), ...ids.map((id) => repository.listStoreReviews(dnaDocId(id))),
  ]);
  const byAuthor = new Map<string, StoreReview>();
  for (const review of lists.flat()) {
    if (moderated.isRemoved('store_review', review.id)) continue;
    const kept = byAuthor.get(review.authorId);
    if (!kept || kept.updatedAt < review.updatedAt) byAuthor.set(review.authorId, review);
  }
  return [...byAuthor.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function buildView(repository: Repo, dna: ProductDna, viewerId: string | null, staff: boolean): Promise<DnaView> {
  const catalogue = await everyListing(repository);
  const byId = new Map(catalogue.map((listing) => [listing.id, listing]));
  // Each thing on it: a listing of it alone, or one of the things in a lot or a set, at its own name and price.
  const items = linkedItems(dna, byId).slice(0, LISTINGS_READ);
  const listings = listingsOf(items);
  const listingIds = new Set(listings.map((listing) => listing.id));

  const postLinks = dna.links.filter((entry) => entry.kind === 'post').slice(-POSTS_READ);
  const wantLinks = dna.links.filter((entry) => entry.kind === 'want').slice(-HUNTS_READ);
  const [orderLists, postsRead, wantsRead, reviews, moderated] = await Promise.all([
    Promise.all(listings.map((listing) => repository.listOrdersForListing(listing.id).catch(() => [] as Order[]))),
    Promise.all(postLinks.map((entry) => repository.getPost(entry.partition, entry.id).catch(() => null))),
    Promise.all(wantLinks.map((entry) => repository.getWant(entry.id, entry.partition).catch(() => null))),
    reviewsOf(repository, dna),
    moderation(repository),
  ]);
  const now = new Date().toISOString();
  // What sold of each thing: a piece bought out of a lot at the piece's price; a set at this thing's share of it.
  const ordersBy = new Map(listings.map((listing, at) => [listing.id, orderLists[at] ?? []]));
  const sales: Order[] = items.flatMap((item) => (ordersBy.get(item.listing.id) ?? []).flatMap((order): Order[] => {
    if (!BOUGHT.has(order.status)) return [];
    if (!item.piece) return [order];
    if (item.set) return [{ ...order, unitPriceMinor: item.priceMinor }];
    const bought = order.pieces?.find((piece) => piece.id === item.piece);
    return bought ? [{ ...order, unitPriceMinor: bought.priceMinor, quantity: 1 }] : [];
  }));
  const posts = postsRead.filter((post): post is Post => Boolean(post
    && (!post.visibleAt || post.visibleAt <= now) && !moderated.isRemoved('post', post.id)));
  const wants = wantsRead.filter((want): want is Want => Boolean(want));
  const openWants = wants.filter((want) => want.status === 'open');

  // Who bought it, and from whom: the owner mark on a review, never shown as a list.
  const boughtFrom = new Map<string, string>();
  for (const order of [...sales].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (!boughtFrom.has(order.buyerId)) boughtFrom.set(order.buyerId, order.sellerId);
  }

  const sellerIds = new Set(listings.map((listing) => listing.sellerId));
  const users = await repository.listUsersByIds([...sellerIds]);
  const userById = new Map(users.map((user) => [user.id, user]));

  // ---- price -------------------------------------------------------------
  const selling = items.filter(itemOnSale);
  const asks = selling.map((item) => item.priceMinor);
  const typical = asks.length ? median(asks) : null;
  const shipping = listingsOf(selling).map((listing) => listing.shippingMinor).filter((value): value is number => typeof value === 'number');
  const price = typical === null ? null : {
    currency: selling[0]!.listing.currency,
    lowMinor: Math.min(...asks),
    typicalMinor: typical,
    highMinor: Math.max(...asks),
    onSale: selling.length,
    shippingMinor: shipping.length ? median(shipping) : null,
  };
  const dealOf = (item: LinkedItem): DnaListingCard['deal'] => {
    if (typical === null || selling.length < 2 || !itemOnSale(item)) return null;
    if (item.priceMinor <= typical * 0.92) return 'low';
    if (item.priceMinor >= typical * 1.08) return 'high';
    return 'fair';
  };

  const weeks = new Map<string, number[]>();
  for (const order of sales) {
    const week = weekOf(order.createdAt);
    weeks.set(week, [...(weeks.get(week) ?? []), order.unitPriceMinor]);
  }
  const trend = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-26)
    .map(([at, prices]) => ({ at, minor: median(prices), sales: prices.length }));

  const budgets = openWants.map((want) => want.budgetMinor).filter((value): value is number => typeof value === 'number' && value > 0);
  const gap = typical !== null && budgets.length > 0 ? { askMinor: typical, offerMinor: median(budgets), hunts: budgets.length } : null;

  // ---- demand ------------------------------------------------------------
  const counts = {
    hunting: openWants.reduce((sum, want) => sum + Math.max(1, want.seekerCount ?? 1), 0),
    saves: listings.reduce((sum, listing) => sum + (listing.likeCount ?? 0), 0),
    views: listings.reduce((sum, listing) => sum + (listing.viewCount ?? 0), 0),
    sold: Math.max(sales.reduce((sum, order) => sum + order.quantity, 0),
      listings.reduce((sum, listing) => sum + (listing.soldCount ?? 0), 0)),
    pledged: listings.reduce((sum, listing) => sum + (listing.preOrder?.pledgedCount ?? 0), 0),
    waiting: listings.reduce((sum, listing) => sum + (listing.restockWatch?.length ?? 0), 0),
  };
  const demand = { ...counts, ...heatOf(counts) };

  // ---- shops -------------------------------------------------------------
  const card = (item: LinkedItem): DnaListingCard => {
    const { listing } = item;
    return {
      id: listing.id,
      title: item.title,
      piece: item.piece ? { id: item.piece, listingTitle: listing.title, set: item.set } : null,
      priceMinor: item.priceMinor,
      currency: listing.currency,
      shippingMinor: typeof listing.shippingMinor === 'number' ? listing.shippingMinor : null,
      photoUrl: photoOf(listing),
      onSale: itemOnSale(item),
      condition: factsOf(listing).condition,
      shop: shopOf(userById.get(listing.sellerId)),
      deal: dealOf(item),
    };
  };
  const sellingNow = selling.sort((a, b) => a.priceMinor - b.priceMinor).map(card);

  const unitsBy = new Map<string, number>();
  for (const order of sales) unitsBy.set(order.sellerId, (unitsBy.get(order.sellerId) ?? 0) + order.quantity);
  for (const item of items) {
    const { listing } = item;
    if (unitsBy.has(listing.sellerId)) continue;
    // A piece is sold when it is; a whole listing or a set by its count, or by being sold out.
    if (item.piece && !item.set) {
      if (item.sold) unitsBy.set(listing.sellerId, 1);
    } else if ((listing.soldCount ?? 0) > 0 || listing.status === 'sold_out') {
      unitsBy.set(listing.sellerId, listing.soldCount ?? 1);
    }
  }
  const soldBefore = [...unitsBy.entries()].sort(([, a], [, b]) => b - a).slice(0, 12)
    .flatMap(([sellerId, units]) => {
      const shop = shopOf(userById.get(sellerId));
      return shop ? [{ shop, units }] : [];
    });

  // Shops that list things sharing this product's telling words, but not this product.
  const telling = dna.words.filter((word) => word.length > 2);
  const near = new Map<string, { hits: number; words: Set<string> }>();
  for (const listing of catalogue) {
    if (sellerIds.has(listing.sellerId) || !everListed(listing)) continue;
    const shared = productWords(listing.title).filter((word) => telling.includes(word));
    if (shared.length < Math.min(2, telling.length)) continue;
    const entry = near.get(listing.sellerId) ?? { hits: 0, words: new Set<string>() };
    entry.hits += shared.length;
    shared.forEach((word) => entry.words.add(word));
    near.set(listing.sellerId, entry);
  }
  const nearIds = [...near.entries()].sort(([, a], [, b]) => b.hits - a.hits).slice(0, 6).map(([id]) => id);
  const nearUsers = nearIds.length ? await repository.listUsersByIds(nearIds) : [];
  const nearById = new Map(nearUsers.map((user) => [user.id, user]));
  const spell = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const couldGet = nearIds.flatMap((id) => {
    const shop = shopOf(nearById.get(id));
    return shop ? [{ shop, because: `Lists ${[...near.get(id)!.words].slice(0, 3).map(spell).join(' ')}` }] : [];
  });

  // ---- reviews -----------------------------------------------------------
  const reviewShops = await repository.listUsersByIds([...new Set(reviews
    .map((review) => boughtFrom.get(review.authorId)).filter((id): id is string => Boolean(id) && !userById.has(id!)))]);
  for (const user of reviewShops) userById.set(user.id, user);
  const ownerOf = (buyerId: string) => {
    const sellerId = boughtFrom.get(buyerId);
    const shop = sellerId ? shopOf(userById.get(sellerId)) : null;
    return shop ? { shop: shop.name, handle: shop.handle } : null;
  };
  const reviewCards: DnaReviewCard[] = reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    body: review.body,
    photoUrls: review.photoUrls ?? [],
    authorName: review.authorName,
    authorHandle: review.authorHandle,
    createdAt: review.createdAt,
    owner: ownerOf(review.authorId),
    mine: review.authorId === viewerId,
  }));
  const average = reviews.length
    ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10 : null;
  const yours = viewerId ? reviews.find((review) => review.authorId === viewerId) : undefined;

  // ---- community ---------------------------------------------------------
  const postCards: DnaPostCard[] = posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((post) => ({
    channelId: post.channelId,
    id: post.id,
    body: post.body.length > 220 ? `${post.body.slice(0, 217).trimEnd()}…` : post.body,
    photoUrl: post.photoUrl ?? post.photoUrls?.[0] ?? null,
    authorName: post.authorName,
    createdAt: post.createdAt,
    likeCount: post.likeCount,
    replyCount: post.replyCount,
  }));
  const hunts: DnaHuntCard[] = openWants.map((want) => ({
    id: want.id,
    buyerId: want.buyerId,
    title: want.title,
    budgetMinor: want.budgetMinor,
    currency: want.currency,
    hunters: Math.max(1, want.seekerCount ?? 1),
    createdAt: want.createdAt,
  }));

  // ---- photos ------------------------------------------------------------
  const gallery: DnaPhoto[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined, from: DnaPhoto['from'], href: string | null) => {
    if (!url || seen.has(url) || gallery.length >= 36) return;
    seen.add(url);
    gallery.push({ url, from, href });
  };
  // An owner's photo opens their review; every other photo opens what it came from.
  for (const review of reviews) for (const url of review.photoUrls ?? []) add(url, 'review', `#review-${review.id}`);
  const buyerReviews = await Promise.all([...sellerIds].slice(0, SHOPS_FOR_PHOTOS)
    .map((id) => repository.listReviewsAbout(id).catch(() => [])));
  for (const review of buyerReviews.flat()) {
    if (review.direction !== 'buyer_to_seller' || !review.item || !listingIds.has(review.item.listingId)) continue;
    if (!reviewRevealed(review, false)) continue;
    for (const url of review.photoUrls ?? []) add(url, 'buyer', `/listing/${encodeURIComponent(review.item.listingId)}`);
  }
  for (const post of posts) {
    for (const url of [post.photoUrl, ...(post.photoUrls ?? [])]) {
      add(url, 'post', `/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`);
    }
  }
  for (const listing of listings) {
    for (const photo of listing.photos.slice(0, 3)) add(photo.thumbUrl ?? photo.url, 'listing', `/listing/${encodeURIComponent(listing.id)}`);
  }
  for (const want of openWants) {
    for (const url of want.photoUrls ?? []) {
      add(url, 'hunt', `/social?view=wanted&want=${encodeURIComponent(want.id)}&buyer=${encodeURIComponent(want.buyerId)}`);
    }
  }

  // ---- facts -------------------------------------------------------------
  const values = new Map<string, Map<string, number>>();
  const conditions = new Map<string, number>();
  for (const listing of listings) {
    const facts = factsOf(listing);
    conditions.set(facts.condition, (conditions.get(facts.condition) ?? 0) + 1);
    for (const detail of facts.details) {
      const seenValues = values.get(detail.label) ?? new Map<string, number>();
      seenValues.set(detail.value, (seenValues.get(detail.value) ?? 0) + 1);
      values.set(detail.label, seenValues);
    }
  }
  const facts: DnaView['facts'] = [{ label: 'Category', value: dna.category }];
  for (const [label, seenValues] of values) {
    const ranked = [...seenValues.entries()].sort(([, a], [, b]) => b - a).map(([value]) => value);
    facts.push({ label, value: ranked.length > 4 ? `${ranked.slice(0, 4).join(' · ')} +${ranked.length - 4}` : ranked.join(' · ') });
  }
  if (conditions.size > 0) {
    facts.push({ label: 'Listed as', value: [...conditions.entries()].sort(([, a], [, b]) => b - a).map(([value]) => value).slice(0, 3).join(' · ') });
  }

  // ---- timeline ----------------------------------------------------------
  const timeline: DnaTimelineEntry[] = [];
  const firstListed = [...listings].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (firstListed) timeline.push({ at: firstListed.createdAt, label: 'First listed on Figmark', kind: 'listed' });
  const bySale = [...sales].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (bySale[0]) timeline.push({ at: bySale[0].createdAt, label: 'First sold', kind: 'sold' });
  if (bySale.length >= 3) {
    const low = bySale.reduce((a, b) => (b.unitPriceMinor < a.unitPriceMinor ? b : a));
    const high = bySale.reduce((a, b) => (b.unitPriceMinor > a.unitPriceMinor ? b : a));
    timeline.push({ at: low.createdAt, label: `Lowest sale · ${money(low.unitPriceMinor, low.currency)}`, kind: 'low' });
    if (high.id !== low.id) timeline.push({ at: high.createdAt, label: `Highest sale · ${money(high.unitPriceMinor, high.currency)}`, kind: 'high' });
  }
  const firstHunt = [...wants].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (firstHunt) timeline.push({ at: firstHunt.createdAt, label: 'First hunted', kind: 'hunt' });
  const firstPost = [...posts].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (firstPost) timeline.push({ at: firstPost.createdAt, label: 'First posted about', kind: 'post' });
  const firstReview = reviews[reviews.length - 1];
  if (firstReview) timeline.push({ at: firstReview.createdAt, label: 'First reviewed', kind: 'review' });
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  // ---- related -----------------------------------------------------------
  const index = await dnaIndex(repository);
  const related: DnaSummary[] = [...index.byId.values()]
    .filter((other) => other.id !== dna.id && other.line === dna.line && other.category === dna.category && isShown(other, byId))
    .map((other) => summaryOf(other, byId))
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 8);

  // ---- what this reader may fix -----------------------------------------
  const yourLinks: DnaView['yourLinks'] = [];
  if (viewerId) {
    for (const item of items) {
      if (item.listing.sellerId === viewerId) {
        yourLinks.push({ kind: 'listing', id: item.listing.id, partition: item.listing.sellerId, title: item.title, piece: item.piece });
      }
    }
    for (const post of posts) if (post.authorId === viewerId) yourLinks.push({ kind: 'post', id: post.id, partition: post.channelId, title: post.body.slice(0, 60) || 'Your post' });
    for (const want of wants) if (want.buyerId === viewerId) yourLinks.push({ kind: 'want', id: want.id, partition: want.buyerId, title: want.title });
  }

  const ownedFrom = viewerId ? ownerOf(viewerId) : null;
  // The reader's follow, how many follow it, and their own hunt for it.
  const [follows, theirWants] = await Promise.all([
    followsOf(repository, dna.id).catch(() => []),
    viewerId ? repository.listWantsBy(viewerId).catch(() => [] as Want[]) : Promise.resolve([] as Want[]),
  ]);
  const wantLinked = new Set(dna.links.filter((entry) => entry.kind === 'want').map((entry) => entry.id));
  const theirHunt = theirWants.find((want) => wantLinked.has(want.id) && want.status === 'open' && want.expiresAt > now);
  const theirFollow = viewerId ? follows.find((entry) => entry.userId === viewerId) : undefined;
  return {
    dna: { id: dna.id, name: dna.name, category: dna.category, cover: dna.cover ?? sellingNow[0]?.photoUrl ?? null, createdAt: dna.createdAt },
    price,
    trend,
    gap,
    demand,
    sellingNow,
    soldBefore,
    couldGet,
    rating: { average, count: reviews.length, owners: reviewCards.filter((review) => review.owner).length },
    reviews: reviewCards,
    yours: yours ? { rating: yours.rating, body: yours.body, photoUrls: yours.photoUrls ?? [] } : null,
    youOwn: ownedFrom ? { shop: ownedFrom.shop } : null,
    posts: postCards,
    hunts,
    gallery,
    facts,
    timeline,
    background: dna.background ? { text: dna.background.text, source: dna.background.source } : null,
    related,
    yourLinks,
    staff,
    follow: theirFollow ? { until: theirFollow.until } : null,
    watchers: follows.length,
    hunting: theirHunt ? { id: theirHunt.id, buyerId: theirHunt.buyerId, expiresAt: theirHunt.expiresAt } : null,
  };
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

async function viewer(request: HttpRequest) {
  return (await getAuthService()).getCurrentUser(request);
}

/** GET /api/dna/view/{id} - the whole DNA. A DNA folded into another answers with where it went. */
async function view(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const id = request.params.id ?? '';
  const dna = await getDna(repository, id);
  if (!dna) return error(404, 'not_found', 'No such product.');
  if (dna.id !== id) return json(200, { moved: dna.id });
  const catalogue = await everyListing(repository);
  // Whatever is not linked yet - posts, hunts, older listings - gets a moment
  // to join before the page is drawn; never long enough to keep it waiting.
  await Promise.race([sweepListings(repository, catalogue).catch(() => 0), new Promise((done) => setTimeout(done, 1500))]);
  const byId = new Map(catalogue.map((listing) => [listing.id, listing]));
  if (!isShown(dna, byId)) return error(404, 'not_found', 'Nothing about this product is public any more.');
  const user = await viewer(request);
  const fresh = (await getDna(repository, dna.id)) ?? dna;
  const built = await buildView(repository, fresh, user?.id ?? null, Boolean(user?.capabilities.isAdmin));
  // The background is looked for after answering: the page never waits on another site.
  void findBackground(repository, dna).catch(() => undefined);
  // Anyone following hears about a move the page shows, even with no clock running.
  void alertFollowers(repository, fresh, byId);
  return json(200, built);
}

/**
 * POST /api/dna/view/{id}/follow - `{ days }` to follow it for that long (one
 * day to three months), `{ days: null }` to stop. Following again sets a new
 * end and keeps what was last told.
 */
async function follow(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const dna = await getDna(repository, request.params.id ?? '');
  if (!dna) return error(404, 'not_found', 'No such product.');
  let body: { days?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const stop = body.days === null || body.days === 0;
  const days = stop ? null : timedDays(body.days);
  if (!stop && days === null) return error(400, 'invalid_days', 'Pick how long to follow it: from a day to three months.');
  const byId = new Map((await everyListing(repository)).map((listing) => [listing.id, listing]));
  const saved = await setFollow(repository, dna, user.id, days, marketOf(dna, byId));
  return json(200, { follow: saved ? { until: saved.until } : null });
}

/**
 * POST /api/dna/view/{id}/want - "I want this": a hunt on the Wanted board for
 * this product, in one tap. `{ days, budgetMinor? }`. Its title, category and
 * photo come from the DNA, and it is linked to the DNA at once. One open hunt
 * per person per product: asking again answers the one already running.
 */
async function wantIt(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const dna = await getDna(repository, request.params.id ?? '');
  if (!dna) return error(404, 'not_found', 'No such product.');
  let body: { days?: unknown; budgetMinor?: number | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const now = new Date().toISOString();
  const linked = new Set(dna.links.filter((entry) => entry.kind === 'want').map((entry) => entry.id));
  const running = (await repository.listWantsBy(user.id))
    .find((want) => linked.has(want.id) && want.status === 'open' && want.expiresAt > now);
  if (running) return json(200, { want: { id: running.id, buyerId: running.buyerId, expiresAt: running.expiresAt }, existing: true });

  const made = await createWant(repository, user, {
    title: dna.name.slice(0, 90),
    details: '',
    category: dna.category,
    budgetMinor: body.budgetMinor ?? null,
    condition: null,
    photoUrls: [],
    shownPhotos: dna.cover ? [dna.cover] : [],
    days: body.days,
  });
  if (typeof made === 'string') return error(400, 'invalid_want', made);
  if ('refusal' in made) return made.refusal;
  await addLink(repository, dna.id, { kind: 'want', id: made.want.id, partition: made.want.buyerId, by: 'owner', at: now });
  return json(201, { want: { id: made.want.id, buyerId: made.want.buyerId, expiresAt: made.want.expiresAt }, existing: false });
}

/**
 * GET /api/dna/of/listing/{id} - the DNAs a listing is on, linking it if it
 * is not yet: one, or one per thing for a lot or a set of named things, each
 * with the piece it is for. `dna` is the first, for callers that want one.
 */
async function ofListing(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const catalogue = await everyListing(repository);
  const listing = catalogue.find((entry) => entry.id === request.params.id)
    ?? await repository.getListing(request.params.id ?? '');
  if (!listing) return error(404, 'not_found', 'No such item.');
  const dnas = await dnasForListing(repository, listing, catalogue);
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  byId.set(listing.id, listing);
  const items = itemsOf(listing);
  const things = items.flatMap((item) => {
    const dna = dnas.find((entry) => entry.links.some((link) => link.kind === 'listing' && link.id === listing.id
      && (link.piece ?? null) === item.piece));
    return dna ? [{ piece: item.piece, title: item.title, dna: summaryOf(dna, byId) }] : [];
  });
  return json(200, { dna: things[0]?.dna ?? null, items: things });
}

/** GET /api/dna/of/post/{channel}/{id} - the products a post is about. */
async function ofPost(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const post = await repository.getPost(request.params.channel ?? '', request.params.id ?? '');
  if (!post) return error(404, 'not_found', 'No such post.');
  const catalogue = await everyListing(repository);
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const dnas = (await dnasForPost(repository, post, catalogue)).filter((dna) => isShown(dna, byId));
  const user = await viewer(request);
  return json(200, { dnas: dnas.map((dna) => summaryOf(dna, byId)), yours: user?.id === post.authorId });
}

/** GET /api/dna/of/want/{buyer}/{id} - the product a hunt is for. */
async function ofWant(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const want = await repository.getWant(request.params.id ?? '', request.params.buyer ?? '');
  if (!want) return error(404, 'not_found', 'No such hunt.');
  const catalogue = await everyListing(repository);
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const dna = await dnaForWant(repository, want, catalogue);
  const user = await viewer(request);
  return json(200, { dna: dna && isShown(dna, byId) ? summaryOf(dna, byId) : null, yours: user?.id === want.buyerId });
}

/** GET /api/dna/trending?category= - products for Discover, hottest first. */
async function trending(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const catalogue = await everyListing(repository);
  // Anything listed before DNAs existed is linked as Discover is read, a few at a time.
  await sweepListings(repository, catalogue).catch(() => 0);
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  const category = request.query.get('category');
  const index = await dnaIndex(repository);
  const products = [...index.byId.values()]
    .filter((dna) => isShown(dna, byId) && (!category || dna.category === category))
    .map((dna) => summaryOf(dna, byId))
    // Something on sale or talked about first, then heat, then how many places say so.
    .sort((a, b) => Number(b.sellers > 0 || b.mentions > 0) - Number(a.sellers > 0 || a.mentions > 0)
      || b.heat - a.heat || (b.sellers + b.mentions) - (a.sellers + a.mentions))
    .slice(0, 40);
  return json(200, { products });
}

/** GET /api/dna/search?q=&listing={id}&piece={piece} - products by name, for tagging a post or moving a listing. */
async function search(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const words = productWords(request.query.get('q') ?? '');
  if (words.length === 0) return json(200, { products: [] });
  const catalogue = await everyListing(repository);
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  // Moving a listing keeps it on the line its seller said it is on.
  const forListing = request.query.get('listing');
  const listing = forListing ? byId.get(forListing) : undefined;
  // One thing of a lot keeps to its own line, which may not be the listing's.
  const piece = request.query.get('piece');
  const line = listing ? (itemsOf(listing).find((item) => item.piece === piece) ?? itemsOf(listing)[0]!).line : null;
  const index = await dnaIndex(repository);
  const products = [...index.byId.values()]
    .filter((dna) => isShown(dna, byId) && (!line || dna.line === line))
    .map((dna) => ({ dna, hit: words.filter((word) => dna.words.some((have) => have.startsWith(word))).length }))
    .filter((entry) => entry.hit > 0)
    .sort((a, b) => b.hit - a.hit || b.dna.links.length - a.dna.links.length)
    .slice(0, 12)
    .map((entry) => summaryOf(entry.dna, byId));
  return json(200, { products });
}

/**
 * POST /api/dna/view/{id}/reviews - review the product, or replace your own.
 *
 * Anybody signed in may; one each. Whoever bought it here is shown as an owner,
 * with the shop they bought it from - worked out when it is read, from their
 * orders, never stored on the review.
 */
async function writeReview(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const dna = await getDna(repository, request.params.id ?? '');
  if (!dna) return error(404, 'not_found', 'No such product.');

  let body: { rating?: number; body?: string; photoUrls?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return error(400, 'invalid_rating', 'A rating is one to five stars.');
  const text = (body.body ?? '').trim();
  if (text.length < 4) return error(400, 'invalid_body', 'Say something about it, not just a number.');
  const photoUrls = await ownPhotos(body.photoUrls, REVIEW_PHOTO_MAX);
  if (!photoUrls) return error(400, 'invalid_body', `Up to ${REVIEW_PHOTO_MAX} photos, uploaded here.`);

  const subjectId = dnaDocId(dna.id);
  const existing = (await repository.listStoreReviews(subjectId)).find((entry) => entry.authorId === user.id);
  const author = await repository.getUserById(user.id);
  const now = new Date().toISOString();
  const review: StoreReview = {
    id: existing?.id ?? `dnr_${randomUUID().slice(0, 12)}`,
    subjectId,
    authorId: user.id,
    authorName: author?.displayName ?? user.displayName,
    authorHandle: author?.username ?? null,
    rating,
    body: text.slice(0, 800),
    ...(photoUrls.length ? { photoUrls } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await repository.saveStoreReview(review);
  await claimPhotos(photoUrls, `store_review:${review.id}`);

  // The stars a card shows, kept on the DNA.
  const all = await reviewsOf(repository, dna);
  await saveDna(repository, dna.id, (current) => (current
    ? { ...current, score: { total: all.reduce((sum, entry) => sum + entry.rating, 0), count: all.length } } : null));
  return json(200, { ok: true });
}

interface FixBody {
  kind?: DnaLinkKind;
  id?: string;
  partition?: string;
  /** 'remove' takes it off `from`; 'move' puts it on `to` instead; 'tag' adds `to` (posts only); 'new' starts its own (listings only). */
  action?: 'remove' | 'move' | 'tag' | 'new';
  from?: string;
  to?: string;
  /** For a listing of several things: which of them. */
  piece?: string | null;
}

/**
 * POST /api/dna/fix - an owner says what their own thing is about.
 *
 * A seller moves their listing to another product, or to one of its own; a
 * poster tags or untags the products in their post; a hunter points their
 * hunt at the right product, or off a wrong one. What they took off is never
 * put back by the matcher.
 */
async function fix(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  let body: FixBody;
  try {
    body = (await request.json()) as FixBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const { kind, id = '', partition = '', action } = body;
  const piece = typeof body.piece === 'string' && body.piece ? body.piece : null;
  if (!kind || !['listing', 'post', 'want'].includes(kind) || !id || !action) {
    return error(400, 'invalid_body', 'Say what to change.');
  }

  // Only the owner of the thing may say what it is about.
  const catalogue = await everyListing(repository);
  let listing: Listing | null = null;
  if (kind === 'listing') {
    listing = await repository.getListing(id);
    if (!listing || listing.sellerId !== user.id) return error(403, 'not_yours', 'Only the shop that listed it can change this.');
  } else if (kind === 'post') {
    const post = await repository.getPost(partition, id);
    if (!post || post.authorId !== user.id) return error(403, 'not_yours', 'Only whoever posted it can change this.');
  } else {
    const want = await repository.getWant(id, partition);
    if (!want || want.buyerId !== user.id) return error(403, 'not_yours', 'Only whoever is hunting it can change this.');
  }
  const linkPartition = listing?.sellerId ?? partition;
  // A listing of several things is on one product per thing: say which thing.
  const item = listing ? itemsOf(listing).find((each) => each.piece === piece) : null;
  if (listing && !item) return error(400, 'which_item', piece ? 'That item is not in this listing.' : 'Say which item in the photo.');
  const current = (await dnasLinked(repository, kind, id)).filter((dna) => kind !== 'listing'
    || dna.links.some((link) => link.kind === 'listing' && link.id === id && (link.piece ?? null) === piece));
  const target = body.to ? await getDna(repository, body.to) : null;
  if ((action === 'move' || action === 'tag') && !target) return error(404, 'not_found', 'No such product.');
  if (target && item && target.line !== item.line) {
    return error(400, 'other_line', 'That product is listed as something else. Check what your listing says it is.');
  }
  const entry = {
    kind, id, partition: linkPartition, by: 'owner' as const, at: new Date().toISOString(), ...(piece ? { piece } : {}),
  };
  const only = kind === 'listing' ? piece : undefined;

  if (action === 'remove') {
    const from = current.find((dna) => dna.id === body.from);
    if (!from) return error(404, 'not_found', 'It is not on that product.');
    if (kind === 'listing') return error(400, 'invalid_action', 'A listing is always on a product: move it, or start its own.');
    await removeLink(repository, from.id, kind, id, true);
  } else if (action === 'tag') {
    if (kind !== 'post') return error(400, 'invalid_action', 'Only a post can be about several products.');
    if (current.length >= DNA_TAGS_PER_POST && !current.some((dna) => dna.id === target!.id)) {
      return error(400, 'too_many', `A post can be about ${DNA_TAGS_PER_POST} products at most.`);
    }
    await addLink(repository, target!.id, entry);
  } else if (action === 'move') {
    for (const dna of current) if (dna.id !== target!.id) await removeLink(repository, dna.id, kind, id, true, only);
    await addLink(repository, target!.id, entry);
  } else {
    if (!listing || !item) return error(400, 'invalid_action', 'Only a listing starts a product of its own.');
    for (const dna of current) await removeLink(repository, dna.id, kind, id, true, only);
    // Blocked everywhere it was, so the matcher starts it a DNA of its own.
    const made = await dnaForItem(repository, listing, item, catalogue, true);
    if (made) await saveDna(repository, made.id, (dna) => (dna ? {
      ...dna,
      links: dna.links.map((link) => (link.kind === 'listing' && link.id === id && (link.piece ?? null) === piece
        ? { ...link, by: 'owner' } : link)),
    } : null));
    return json(200, { dna: made?.id ?? null });
  }
  return json(200, { dna: target?.id ?? null });
}

/** POST /api/dna/view/{id}/merge {into} - staff fold a duplicate into the product it is. */
async function merge(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireCapability(request, ['admin']);
  const repository = await getRepository();
  let body: { into?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const from = await getDna(repository, request.params.id ?? '');
  const into = body.into ? await getDna(repository, body.into) : null;
  if (!from || !into) return error(404, 'not_found', 'No such product.');
  if (from.id === into.id) return error(400, 'same', 'That is the same product.');
  await saveDna(repository, into.id, (current) => {
    if (!current) return null;
    // Two things of one lot are two links: kept apart by their piece.
    const keyOf = (link: ProductDna['links'][number]) => `${linkKey(link.kind, link.id)}#${link.piece ?? ''}`;
    const have = new Set(current.links.map(keyOf));
    const moved = from.links.filter((link) => !have.has(keyOf(link))).map((link) => ({ ...link, by: 'staff' as const }));
    const total = (current.score?.total ?? 0) + (from.score?.total ?? 0);
    const count = (current.score?.count ?? 0) + (from.score?.count ?? 0);
    return { ...current, links: [...current.links, ...moved], cover: current.cover ?? from.cover, score: { total, count } };
  });
  await saveDna(repository, from.id, (current) => (current ? { ...current, mergedInto: into.id } : null));
  return json(200, { dna: into.id });
}

export const dnaViewRoute = handler(view);
export const dnaOfListingRoute = handler(ofListing);
export const dnaOfPostRoute = handler(ofPost);
export const dnaOfWantRoute = handler(ofWant);
export const dnaTrendingRoute = handler(trending);
export const dnaSearchRoute = handler(search);
export const dnaReviewRoute = handler(writeReview);
export const dnaFixRoute = handler(fix);
export const dnaMergeRoute = handler(merge);
export const dnaFollowRoute = handler(follow);
export const dnaWantRoute = handler(wantIt);

const anon = { authLevel: 'anonymous' } as const;

app.http('dna-view', { ...anon, methods: ['GET'], route: 'dna/view/{id}', handler: dnaViewRoute });
app.http('dna-of-listing', { ...anon, methods: ['GET'], route: 'dna/of/listing/{id}', handler: dnaOfListingRoute });
app.http('dna-of-post', { ...anon, methods: ['GET'], route: 'dna/of/post/{channel}/{id}', handler: dnaOfPostRoute });
app.http('dna-of-want', { ...anon, methods: ['GET'], route: 'dna/of/want/{buyer}/{id}', handler: dnaOfWantRoute });
app.http('dna-trending', { ...anon, methods: ['GET'], route: 'dna/trending', handler: dnaTrendingRoute });
app.http('dna-search', { ...anon, methods: ['GET'], route: 'dna/search', handler: dnaSearchRoute });
app.http('dna-review', { ...anon, methods: ['POST'], route: 'dna/view/{id}/reviews', handler: dnaReviewRoute });
app.http('dna-fix', { ...anon, methods: ['POST'], route: 'dna/fix', handler: dnaFixRoute });
app.http('dna-follow', { ...anon, methods: ['POST'], route: 'dna/view/{id}/follow', handler: dnaFollowRoute });
app.http('dna-want', { ...anon, methods: ['POST'], route: 'dna/view/{id}/want', handler: dnaWantRoute });
app.http('dna-merge', { ...anon, methods: ['POST'], route: 'dna/view/{id}/merge', handler: dnaMergeRoute });

