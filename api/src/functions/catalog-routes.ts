import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { DIRECT_LOT_ID } from '../../../shared/fulfilment.js';
import type { Listing, ListingComment, Order, User } from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/** Public seller summary attached to feed cards and listing pages. */
function toSellerCard(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    storefrontName: user.sellerProfile?.storefrontName ?? user.displayName,
    storefrontSlug: user.sellerProfile?.storefrontSlug ?? null,
    tier: user.sellerProfile?.tier ?? 'unverified',
    dispatchRegion: user.sellerProfile?.dispatchRegion ?? null,
    followerCount: user.sellerProfile?.followerCount ?? 0,
    trustScore: user.sellerTrust.score,
    onTimeDispatchRate: user.sellerTrust.onTimeDispatchRate,
  };
}

/**
 * GET /api/feed - the unified catalog.
 *
 * Public, because browsing is the default entry point and must render before
 * anyone signs in. When a session is present the results are personalised:
 * followed sellers rank first and the viewer's bookmarks are marked.
 */
async function feed(request: HttpRequest, _context: InvocationContext) {
  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const viewer = await auth.getCurrentUser(request);

  const followedSellerIds = viewer ? await repository.listFollowedSellerIds(viewer.id) : [];
  const likedIds = viewer ? new Set(await repository.listLikedListingIds(viewer.id)) : new Set<string>();

  const listings = await repository.listListings({
    search: request.query.get('q') ?? undefined,
    category: request.query.get('category') ?? undefined,
    condition: request.query.get('condition') ?? undefined,
    kind: request.query.get('kind') ?? undefined,
    maxPriceMinor: numeric(request.query.get('maxPrice')),
    followedSellerIds,
  });

  const [sellers, lots] = await Promise.all([
    repository.listUsersByIds([...new Set(listings.map((l) => l.sellerId))]),
    repository.listLots(),
  ]);
  const sellerById = new Map(sellers.map((s) => [s.id, toSellerCard(s)]));
  // The batch contributes exactly one buyer-visible fact: when it ships.
  const dispatchByLot = new Map(lots.map((l) => [l.id, l.estimatedDispatchAt]));

  return json(200, {
    listings: listings.map((listing) => ({
      ...listing,
      liked: likedIds.has(listing.id),
      seller: sellerById.get(listing.sellerId) ?? null,
      estimatedDispatchAt: listing.lotId ? (dispatchByLot.get(listing.lotId) ?? null) : null,
    })),
    // Facets are derived from the live catalog so the filter chips can never
    // offer a category that has nothing behind it.
    categories: [...new Set(listings.map((l) => l.category))].sort(),
    followedSellerIds,
  });
}

/** GET /api/listings/{id} - detail, with seller, lot, comments and like state. */
async function listingDetail(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A listing id is required.');

  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const listing = await repository.getListing(id);
  if (!listing) return error(404, 'not_found', 'No such listing.');

  const viewer = await auth.getCurrentUser(request);
  const [sellers, comments, likedIds, followed] = await Promise.all([
    repository.listUsersByIds([listing.sellerId]),
    repository.listComments(id),
    viewer ? repository.listLikedListingIds(viewer.id) : Promise.resolve([]),
    viewer ? repository.listFollowedSellerIds(viewer.id) : Promise.resolve([]),
  ]);

  // Deliberately not returning the lot: which consignment an item rides in,
  // who else is in it and what stage it is at are the seller's business. The
  // buyer gets the dispatch estimate, and their own order's tracking later.
  const lot = listing.lotId ? await repository.getLot(listing.sellerId, listing.lotId) : null;

  return json(200, {
    listing,
    seller: sellers[0] ? toSellerCard(sellers[0]) : null,
    estimatedDispatchAt: lot?.estimatedDispatchAt ?? null,
    comments,
    liked: likedIds.includes(id),
    following: followed.includes(listing.sellerId),
    isOwn: viewer?.id === listing.sellerId,
  });
}

/** POST /api/listings - publish a listing. Requires the `sell` capability. */
async function createListing(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  let body: Partial<Listing> & { preOrder?: { fillThreshold: number; cutoffAt: string } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const title = body.title?.trim();
  if (!title) return error(400, 'invalid_listing', 'A title is required.');
  if (!body.priceMinor || body.priceMinor <= 0) {
    return error(400, 'invalid_listing', 'A price above zero is required.');
  }

  const now = new Date().toISOString();
  const listing: Listing = {
    id: `lst_${randomUUID().slice(0, 12)}`,
    sellerId: user.id,
    title,
    description: body.description?.trim() ?? '',
    category: body.category ?? 'Collectibles',
    condition: body.condition ?? 'LOOSE',
    status: 'active',
    priceMinor: Math.round(body.priceMinor),
    currency: 'INR',
    quantityAvailable: Math.max(1, Math.round(body.quantityAvailable ?? 1)),
    // Pre-order and shipment batch are independent: a listing opts into demand
    // pooling here, and gets tagged into a lot separately, from the seller's
    // lot console.
    preOrder:
      body.preOrder && body.preOrder.fillThreshold > 0
        ? {
            fillThreshold: Math.round(body.preOrder.fillThreshold),
            filledCount: 0,
            cutoffAt: body.preOrder.cutoffAt,
          }
        : null,
    lotId: null,
    photos: [],
    tags: body.tags ?? [],
    likeCount: 0,
    viewCount: 0,
    bumpedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return json(201, { listing: await repository.createListing(listing) });
}

/** POST /api/listings/{id}/like - toggle a bookmark. */
async function toggleLike(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A listing id is required.');
  const repository = await getRepository();
  return json(200, { liked: await repository.toggleLike(user.id, id) });
}

/** POST /api/listings/{id}/bump - push a listing back up the feed. */
async function bumpListing(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A listing id is required.');

  const repository = await getRepository();
  const bumped = await repository.bumpListing(user.id, id);
  if (!bumped) {
    return error(429, 'bump_rate_limited', 'This listing was bumped recently. Try again later.');
  }
  return json(200, { bumped: true });
}

/** POST /api/listings/{id}/comments - public Q&A on a listing. */
async function addComment(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A listing id is required.');

  let body: { body?: string; replyToId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const text = body.body?.trim();
  if (!text) return error(400, 'invalid_comment', 'Comment cannot be empty.');

  const now = new Date().toISOString();
  const comment: ListingComment = {
    id: `cmt_${randomUUID().slice(0, 12)}`,
    listingId: id,
    authorId: user.id,
    authorName: user.displayName,
    body: text,
    replyToId: body.replyToId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  return json(201, { comment: await (await getRepository()).addComment(comment) });
}

/** POST /api/sellers/{id}/follow - toggle following a seller. */
async function toggleFollow(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const sellerId = request.params.id;
  if (!sellerId) return error(400, 'invalid_request', 'A seller id is required.');
  if (sellerId === user.id) return error(400, 'invalid_request', 'You cannot follow yourself.');

  const repository = await getRepository();
  return json(200, { following: await repository.toggleFollow(user.id, sellerId) });
}

/** POST /api/orders - buy an in-stock item, or join a group-buy lot. */
async function createOrder(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['buy']);
  const repository = await getRepository();

  let body: { listingId?: string; quantity?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (!body.listingId) return error(400, 'invalid_order', 'A listing id is required.');

  const listing = await repository.getListing(body.listingId);
  if (!listing) return error(404, 'not_found', 'No such listing.');
  if (listing.sellerId === user.id) {
    return error(400, 'invalid_order', 'You cannot buy your own listing.');
  }

  const quantity = Math.max(1, Math.round(body.quantity ?? 1));
  if (quantity > listing.quantityAvailable) {
    return error(409, 'insufficient_stock', `Only ${listing.quantityAvailable} left.`);
  }

  const now = new Date().toISOString();
  const amountMinor = listing.priceMinor * quantity;
  const now2 = new Date().toISOString();
  const order: Order = {
    id: `ord_${randomUUID().slice(0, 12)}`,
    // Inherits the item's shipment batch if it has one; otherwise it is a
    // direct domestic sale and tracks against the short vocabulary.
    lotId: listing.lotId ?? DIRECT_LOT_ID,
    sellerId: listing.sellerId,
    buyerId: user.id,
    listingId: listing.id,
    itemName: listing.title,
    condition: listing.condition,
    quantity,
    unitWeightGrams: 0,
    unitPriceMinor: listing.priceMinor,
    currency: listing.currency,
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    stage: listing.lotId ? 'ordering' : 'preparing',
    stageHistory: [
      { stage: listing.lotId ? 'ordering' : 'preparing', enteredAt: now2, note: 'Order placed.', recordedBy: user.id },
    ],
    escrow: {
      state: 'none',
      amountMinor,
      heldAt: null,
      releasedAt: null,
      autoReleaseAt: null,
      disputeId: null,
    },
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return json(201, { order: await repository.createOrder(order) });
}

/** GET /api/me/activity - the signed-in account's listings and purchases. */
async function myActivity(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const [listings, orders, likedIds, followedIds] = await Promise.all([
    repository.listListings({ sellerId: user.id }),
    repository.listOrdersForBuyer(user.id),
    repository.listLikedListingIds(user.id),
    repository.listFollowedSellerIds(user.id),
  ]);

  const followed = await repository.listUsersByIds(followedIds);
  return json(200, {
    listings,
    orders,
    likedListingIds: likedIds,
    following: followed.map(toSellerCard),
  });
}

/** GET /api/forwarders - the freight forwarder directory. */
async function forwarders(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const all = await repository.listForwarders();
  const route = request.query.get('route')?.trim().toLowerCase();

  const entries = all
    .filter((user) => user.forwarderProfile !== null)
    .map((user) => ({ id: user.id, ...user.forwarderProfile! }))
    .filter((entry) =>
      !route
        ? true
        : entry.routes.some((r) =>
            `${r.originCity} ${r.destinationCity}`.toLowerCase().includes(route),
          ),
    )
    .sort((a, b) => b.trust.score - a.trust.score);

  return json(200, { forwarders: entries });
}

function numeric(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const feedRoute = handler(feed);
export const listingDetailRoute = handler(listingDetail);
export const createListingRoute = handler(createListing);
export const toggleLikeRoute = handler(toggleLike);
export const bumpListingRoute = handler(bumpListing);
export const addCommentRoute = handler(addComment);
export const toggleFollowRoute = handler(toggleFollow);
export const createOrderRoute = handler(createOrder);
export const myActivityRoute = handler(myActivity);
export const forwardersRoute = handler(forwarders);

const anon = { authLevel: 'anonymous' } as const;
app.http('feed', { ...anon, methods: ['GET'], route: 'feed', handler: feedRoute });
app.http('listing-detail', { ...anon, methods: ['GET'], route: 'listings/{id}', handler: listingDetailRoute });
app.http('listing-create', { ...anon, methods: ['POST'], route: 'listings', handler: createListingRoute });
app.http('listing-like', { ...anon, methods: ['POST'], route: 'listings/{id}/like', handler: toggleLikeRoute });
app.http('listing-bump', { ...anon, methods: ['POST'], route: 'listings/{id}/bump', handler: bumpListingRoute });
app.http('listing-comment', { ...anon, methods: ['POST'], route: 'listings/{id}/comments', handler: addCommentRoute });
app.http('seller-follow', { ...anon, methods: ['POST'], route: 'sellers/{id}/follow', handler: toggleFollowRoute });
app.http('order-create', { ...anon, methods: ['POST'], route: 'orders', handler: createOrderRoute });
app.http('me-activity', { ...anon, methods: ['GET'], route: 'me/activity', handler: myActivityRoute });
app.http('forwarders', { ...anon, methods: ['GET'], route: 'forwarders', handler: forwardersRoute });
