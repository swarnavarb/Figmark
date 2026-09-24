import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Sourcing } from '../../../shared/enums.js';
import { CATEGORIES, categoriesIn } from '../../../shared/catalog.js';
import { can } from '../../../shared/stores.js';
import { AWAITING_LOT_ID, DIRECT_LOT_ID, sourcingOf } from '../../../shared/fulfilment.js';
import { lotNumberFrom, normaliseSteps } from '../../../shared/routes.js';
import type { Listing, ListingComment, Order, StageEvent, User } from '../../../shared/models.js';
import { personRef } from '../../../shared/parties.js';
import { isExpired, isMultiple } from '../../../shared/payments.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { placeOrder } from './placement.js';
import { reconcilePreOrder, referrer, rosterOf } from './preorder.js';

/** Public seller summary attached to feed cards and listing pages. */
function toSellerCard(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    storefrontName: user.sellerProfile?.storefrontName ?? user.displayName,
    storefrontSlug: user.sellerProfile?.storefrontSlug ?? null,
    // The shop's own handle: where its page is, and where a message to it goes.
    username: user.sellerProfile?.username ?? null,
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

  // A heading is shorthand for the categories under it, resolved here rather
  // than stored on the row, so re-housing a category is an edit to one file
  // instead of a migration.
  const group = request.query.get('group')?.trim();
  const listings = (await repository.listListings({
    search: request.query.get('q') ?? undefined,
    category: request.query.get('category') ?? undefined,
    categories: group ? categoriesIn(group) : undefined,
    condition: request.query.get('condition') ?? undefined,
    kind: request.query.get('kind') ?? undefined,
    sort: request.query.get('sort') ?? undefined,
    maxPriceMinor: numeric(request.query.get('maxPrice')),
    followedSellerIds,
  // Expired is read off the clock, so it is filtered here rather than stored.
  })).filter((listing) => !isExpired(listing));

  const [sellers, lots] = await Promise.all([
    repository.listUsersByIds([...new Set(listings.map((l) => l.sellerId))]),
    repository.listLots(),
  ]);
  const sellerById = new Map(sellers.map((s) => [s.id, toSellerCard(s)]));
  // The lot contributes exactly one buyer-visible fact: when it ships.
  const dispatchByLot = new Map(lots.map((l) => [l.id, l.estimatedDispatchAt]));

  return json(200, {
    listings: listings.map((listing) => ({
      ...listing,
      liked: likedIds.has(listing.id),
      seller: sellerById.get(listing.sellerId) ?? null,
      estimatedDispatchAt: listing.lotId ? (dispatchByLot.get(listing.lotId) ?? null) : null,
    })),
    // Facets are derived from the live catalog so the filter chips can never
    // offer a category that has nothing behind it. Note that this narrows with
    // the filters, which is the point: it answers "what else is in here", not
    // "what exists somewhere".
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
  const [sellers, rawComments, likedIds, followed] = await Promise.all([
    repository.listUsersByIds([listing.sellerId]),
    repository.listComments(id),
    viewer ? repository.listLikedListingIds(viewer.id) : Promise.resolve([]),
    viewer ? repository.listFollowedSellerIds(viewer.id) : Promise.resolve([]),
  ]);

  // A comment keeps the name it was written under, which is right, but the
  // address has to be current - so it is resolved now rather than frozen into
  // the row. A commenter is a person, so it opens their page, not a shop.
  const commenters = await repository.listUsersByIds([
    ...new Set(rawComments.map((comment) => comment.authorId)),
  ]);
  const commenterOf = new Map(commenters.map((person) => [person.id, person]));
  const comments = rawComments.map((comment) => ({
    ...comment,
    author: personRef(commenterOf.get(comment.authorId), comment.authorName),
  }));

  // Deliberately not returning the lot: which consignment an item rides in,
  // who else is in it and what stage it is at are the seller's business. The
  // buyer gets the dispatch estimate, and their own order's tracking later.
  const lot = listing.lotId ? await repository.getLot(listing.sellerId, listing.lotId) : null;

  // A campaign whose cutoff has passed is noticed by somebody opening it -
  // there is no scheduler here - and the page needs the roster anyway, so the
  // read that draws it is the read that settles it.
  const settled = listing.preOrder
    ? await reconcilePreOrder(repository, listing)
    : { listing, pledges: [], orders: [] };
  const preOrder = listing.preOrder
    ? await rosterOf(repository, settled.listing, settled.pledges, settled.orders, viewer?.id ?? null)
    : null;

  return json(200, {
    listing: settled.listing,
    /** The group behind the meter: counts, roster, and the reader's own place. */
    preOrder,
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

  let body: Partial<Listing> & {
    preOrder?: { fillThreshold: number; cutoffAt: string };
    /** The store to list into; absent means the caller's own. */
    storeId?: string;
    quantityMode?: 'fixed' | 'multiple';
    expiresAt?: string | null;
    advancePercent?: number | null;
    /** Announce it in the shop's channel, to its followers. */
    shareToChannel?: boolean;
    /** Announce it in the feed, to everyone. */
    shareToFeed?: boolean;
    /** The before-lot ladder from the Quick Post template, if it had one. */
    preLotSteps?: { id?: string; name?: string; description?: string }[];
    preLotName?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  // A manager lists into the store they were given rights in, not into their
  // own: the seller id is the store's owner, which is also the partition every
  // one of its items already sits in. Absent, it is the caller's own store.
  // Everything is sold by a shop. A listing with no storefront behind it has
  // no name for a buyer to follow, no lot to travel in and nowhere for the
  // tracking to come from - so opening one is a step, not an afterthought.
  let sellerId = user.id;
  if (body.storeId && body.storeId !== user.id) {
    const owner = await repository.getUserById(body.storeId);
    if (!owner?.sellerProfile) return error(404, 'not_found', 'No such store.');
    if (!can(owner, user.id, 'listings')) {
      return error(403, 'forbidden', 'You cannot list items in that store.');
    }
    sellerId = owner.id;
  } else {
    const mine = await repository.getUserById(user.id);
    if (!mine?.sellerProfile) {
      return error(
        409,
        'no_storefront',
        'Open a storefront first — every item is listed from one.',
      );
    }
  }

  const title = body.title?.trim();
  if (!title) return error(400, 'invalid_listing', 'A title is required.');
  if (!body.priceMinor || body.priceMinor <= 0) {
    return error(400, 'invalid_listing', 'A price above zero is required.');
  }

  // A lot can be chosen while listing rather than only afterwards, so the
  // seller is not made to publish and then go and file it. It has to be one of
  // theirs: the lookup is scoped to their partition, so another seller's lot
  // id simply does not resolve.
  let lotId: string | null = null;
  if (body.lotId) {
    const lot = await repository.getLot(sellerId, body.lotId);
    if (!lot) return error(404, 'not_found', 'No such lot of yours to add this to.');
    lotId = lot.id;
  }

  // An import travels in a consignment, and the consignment is what carries the
  // stages a buyer waits on - but it does not have to exist yet. Filing an item
  // into a lot is bookkeeping the shop does when the lot is actually being
  // packed, often weeks after the item went up, and refusing the listing until
  // then meant the shop either lied about sourcing or did not list at all.
  //
  // So an import may wait for its lot. What it must not do is hide that: the
  // item says "import" with no dispatch estimate until it is filed, which is
  // the truth, rather than a date nothing can keep.
  const sourcing: Sourcing = lotId ? 'import' : (body.sourcing === 'import' ? 'import' : 'in_hand');

  /* A template's before-lot ladder, snapshotted onto the listing so editing the
     template later cannot rewrite what a buyer of this item reads. Two steps or
     none: one step before the wall says nothing. */
  const preLotSteps = normaliseSteps(body.preLotSteps ?? []);
  const preLot = preLotSteps.length >= 2
    ? { routeId: null, name: body.preLotName?.trim() || 'Before the lot', steps: preLotSteps }
    : null;

  const now = new Date().toISOString();
  const listing: Listing = {
    id: `lst_${randomUUID().slice(0, 12)}`,
    sellerId,
    title,
    description: body.description?.trim() ?? '',
    // An unknown category would be a heading nothing can reach and a chip that
    // never matches, so it falls back rather than being stored as typed.
    category: body.category && (CATEGORIES as readonly string[]).includes(body.category)
      ? body.category
      : 'Collectibles',
    condition: body.condition ?? 'LOOSE',
    status: 'active',
    priceMinor: Math.round(body.priceMinor),
    currency: 'INR',
    quantityAvailable: Math.max(1, Math.round(body.quantityAvailable ?? 1)),
    ...listingTerms(body),
    // Pre-order and shipment lot are independent: a listing opts into demand
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
    lotId,
    sourcing,
    /** Sold as one assorted lot rather than as a single named item. */
    bundle: body.bundle === true,
    /* Photos as the manager arranged them: at most six, first one primary
       unless the seller said otherwise. The cap is here rather than in the
       browser because a document with forty images in it is the kind of thing
       that only fails in production. */
    photos: (body.photos ?? [])
      .slice(0, 6)
      .map((photo, index, all) => ({
        blobName: photo.blobName ?? '',
        url: photo.url,
        imageHash: null,
        isPrimary: all.some((row) => row.isPrimary) ? photo.isPrimary === true : index === 0,
      }))
      .filter((photo) => photo.blobName || photo.url),
    /* The two ladders, from the Quick Post template the seller listed with.
       The before-lot one is copied because a buyer will read it; the after-lot
       one is a pointer, because nothing is travelling it yet. */
    preLotRoute: preLot,
    lotRouteId: body.lotRouteId ?? null,
    tags: body.tags ?? [],
    likeCount: 0,
    viewCount: 0,
    bumpedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  const created = await repository.createListing(listing);

  // Telling people is part of listing, not a second job to remember. The
  // channel is where a shop's followers already are; the feed is everybody.
  // Both are opt-in per listing, because a shop that posts every item to
  // everything is a shop people mute.
  if (body.shareToChannel || body.shareToFeed) {
    const shop = await repository.getUserById(sellerId);
    const name = shop?.sellerProfile?.storefrontName ?? user.displayName;
    const now2 = new Date().toISOString();
    try {
      await repository.createPost({
        id: `pst_${randomUUID().slice(0, 12)}`,
        channelId: sellerId,
        channel: 'seller',
        kind: 'sale',
        authorId: user.id,
        authorName: name,
        body: listing.title,
        listingId: created.id,
        photoUrl: null,
        likeCount: 0,
        replyCount: 0,
        voice: 'store',
        // One post, not two. A shop's channel is the record of everything it
        // said, so a post that reaches the feed is already in the channel -
        // writing both would put the same item in the room twice.
        reach: body.shareToFeed ? 'feed' : 'channel',
        // A new item is news to the people who follow the shop for exactly
        // this.
        announcement: true,
        createdAt: now2,
        updatedAt: now2,
      });
    } catch {
      // The item is listed either way. Losing the listing because a post
      // failed would be the worse half of the trade.
    }
  }

  return json(201, { listing: created });
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
  // Returned in the shape the read path uses, so the page can append it as-is:
  // a comment that came back without its author's address rendered nameless.
  const saved = await (await getRepository()).addComment(comment);
  return json(201, { comment: { ...saved, author: personRef(user) } });
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

  let body: { listingId?: string; quantity?: number; via?: string; plan?: 'book' };
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

  // Enforced here, not only by hiding the button: an expired or withdrawn item
  // is not for sale whatever the client sends.
  if (isExpired(listing)) return error(409, 'expired', 'This item has expired and cannot be bought.');
  if (listing.status !== 'active') return error(409, 'unavailable', 'This item is not for sale.');

  const quantity = Math.max(1, Math.round(body.quantity ?? 1));
  if (!isMultiple(listing) && quantity > listing.quantityAvailable) {
    return error(409, 'insufficient_stock', `Only ${listing.quantityAvailable} left.`);
  }

  // Pressing Buy again on an item already at the checkout goes back to that
  // checkout rather than opening a second one nobody asked for.
  if (body.plan !== 'book') {
    const open = (await repository.listOrdersForBuyer(user.id)).find((entry) =>
      entry.listingId === listing.id && entry.placedAt === null && entry.status === 'pending_payment');
    if (open) {
      open.quantity = quantity;
      open.buyClicks = (open.buyClicks ?? 1) + 1;
      open.updatedAt = new Date().toISOString();
      return json(200, { order: await repository.updateOrder(open) });
    }
  }

  const now = new Date().toISOString();
  const amountMinor = listing.priceMinor * quantity;
  const now2 = new Date().toISOString();

  /*
   * An item can already be in a lot before anybody buys it - the shop opened
   * the run first and listed against it - and then the very first thing its
   * buyer should read is which shipment it is travelling with, before the
   * order was even placed. So the join is recorded as the opening event, not
   * inferred from `lotId` by whoever draws the timeline later.
   */
  const bornInLot = listing.lotId ? await repository.getLot(listing.sellerId, listing.lotId) : null;
  const joined: StageEvent[] = bornInLot
    ? [{
        stage: 'ordering',
        enteredAt: now2,
        kind: 'joined',
        lot: {
          id: bornInLot.id,
          name: bornInLot.name,
          number: bornInLot.lotNumber ?? lotNumberFrom(bornInLot.id, bornInLot.createdAt),
        },
        note: null,
        recordedBy: user.id,
      }]
    : [];

  const order: Order = {
    id: `ord_${randomUUID().slice(0, 12)}`,
    // Inherits the item's lot if it has one. Otherwise it depends on what
    // the item is: a domestic sale tracks against the short vocabulary and
    // never joins a lot, while an import sold before its run is opened waits
    // for one - and has to be findable on the screen where a shop fills it.
    lotId: listing.lotId
      ?? (sourcingOf(listing) === 'import' ? AWAITING_LOT_ID : DIRECT_LOT_ID),
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
    advancePercent: listing.advancePercent ?? null,
    payments: [],
    credits: [],
    stage: listing.lotId ? 'ordering' : 'preparing',
    // Copied from the listing, for the same reason a lot copies its route:
    // the template is a template, and editing it must not rewrite a timeline
    // somebody is already reading.
    preLotRoute: listing.preLotRoute ?? null,
    stageHistory: [
      ...joined,
      {
        stage: listing.lotId ? 'ordering' : 'preparing',
        enteredAt: now2,
        kind: 'step',
        note: 'Order placed.',
        recordedBy: user.id,
      },
    ],
    escrow: {
      state: 'none',
      amountMinor,
      heldAt: null,
      releasedAt: null,
      autoReleaseAt: null,
      disputeId: null,
    },
    // Whoever brought them in, if they arrived through a share link - or
    // whoever brought them in when they first pledged, because the credit
    // belongs to that moment rather than to the click that finally paid.
    broughtBy: referrer(body.via, user.id, listing.sellerId),
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    // Book: a pledge to buy with no payment yet. Payment is asked for once
    // the seller has accepted - see acceptOrder in order-routes.ts.
    bookingOnly: body.plan === 'book',
    accepted: false,
    // A checkout until the buyer picks pay, advance or book - see placement.ts.
    placedAt: null,
    buyClicks: 1,
  };

  const placed = await repository.createOrder(order);

  // Book straight from the item page: the choice is made, so it is an order.
  if (body.plan === 'book') {
    const refusal = await placeOrder(repository, placed, 'booked', user.id);
    if (refusal) return error(409, 'unavailable', refusal);
  }

  return json(201, { order: placed });
}

/** GET /api/me/activity - the signed-in account's listings and purchases. */
async function myActivity(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const [listings, orders, sales, likedIds, followedIds] = await Promise.all([
    // Hidden ones too - sold out and expired are tabs of the seller's own
    // stock - but not what was withdrawn or is waiting in a scheduled sale.
    repository.listListings({ sellerId: user.id, includeHidden: true })
      .then((rows) => rows.filter((row) => row.status !== 'archived' && !row.unlisted)),
    repository.listOrdersForBuyer(user.id),
    // Sales as well as purchases: a dispute is raised against the seller, and a
    // refund button nobody can reach is not a resolution path. One account is
    // both sides of this marketplace, so its own page shows both.
    repository.listOrdersForSeller(user.id),
    repository.listLikedListingIds(user.id),
    repository.listFollowedSellerIds(user.id),
  ]);

  const followed = await repository.listUsersByIds(followedIds);
  return json(200, {
    listings,
    orders,
    sales,
    likedListingIds: likedIds,
    following: followed.map(toSellerCard),
  });
}

/**
 * The seller-set terms shared by create and edit: stock mode, expiry, advance.
 *
 * Only fields present in the body are returned, so an edit that does not
 * mention one leaves it alone.
 */
function listingTerms(body: {
  quantityMode?: 'fixed' | 'multiple';
  expiresAt?: string | null;
  advancePercent?: number | null;
}): Partial<Pick<Listing, 'quantityMode' | 'expiresAt' | 'advancePercent'>> {
  const terms: Partial<Pick<Listing, 'quantityMode' | 'expiresAt' | 'advancePercent'>> = {};
  if (body.quantityMode !== undefined) {
    terms.quantityMode = body.quantityMode === 'multiple' ? 'multiple' : 'fixed';
  }
  if (body.expiresAt !== undefined) {
    const at = body.expiresAt ? new Date(body.expiresAt) : null;
    terms.expiresAt = at && !Number.isNaN(at.getTime()) ? at.toISOString() : null;
  }
  if (body.advancePercent !== undefined) {
    const percent = Math.round(Number(body.advancePercent) || 0);
    terms.advancePercent = percent > 0 && percent < 100 ? percent : null;
  }
  return terms;
}

/** The listing, if the caller may manage the store it is in. */
async function manageable(request: HttpRequest): Promise<
  { refusal: ReturnType<typeof error> }
  | { listing: Listing; repository: Awaited<ReturnType<typeof getRepository>> }
> {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const id = request.params.id;
  if (!id) return { refusal: error(400, 'invalid_request', 'A listing id is required.') };
  const listing = await repository.getListing(id);
  if (!listing || listing.status === 'archived') return { refusal: error(404, 'not_found', 'No such listing.') };
  if (listing.sellerId !== user.id) {
    const owner = await repository.getUserById(listing.sellerId);
    if (!owner || !can(owner, user.id, 'listings')) {
      return { refusal: error(403, 'forbidden', 'That item is not in a store you manage.') };
    }
  }
  return { listing, repository };
}

/**
 * POST /api/listings/{id}/edit - change an item's details, stock or expiry.
 *
 * Also how an expired item is made available again: a new expiry in the future
 * (or none) puts it straight back in the catalog. Orders already placed are
 * untouched - they carry their own snapshot of what was bought.
 */
async function editListing(request: HttpRequest, _context: InvocationContext) {
  const found = await manageable(request);
  if ('refusal' in found) return found.refusal;
  const { listing, repository } = found;

  let body: {
    title?: string; description?: string; priceMinor?: number; quantityAvailable?: number;
    quantityMode?: 'fixed' | 'multiple'; expiresAt?: string | null; advancePercent?: number | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const next: Listing = { ...listing, ...listingTerms(body), updatedAt: new Date().toISOString() };
  if (body.title !== undefined) {
    if (!body.title.trim()) return error(400, 'invalid_listing', 'A title is required.');
    next.title = body.title.trim();
  }
  if (body.description !== undefined) next.description = body.description.trim();
  if (body.priceMinor !== undefined) {
    if (!(body.priceMinor > 0)) return error(400, 'invalid_listing', 'A price above zero is required.');
    next.priceMinor = Math.round(body.priceMinor);
    // Kept so Insights can say what a price change did to demand.
    if (next.priceMinor !== listing.priceMinor) {
      const history = listing.priceHistory?.length
        ? listing.priceHistory
        : [{ priceMinor: listing.priceMinor, at: listing.createdAt }];
      next.priceHistory = [...history, { priceMinor: next.priceMinor, at: next.updatedAt }].slice(-20);
    }
  }
  if (body.quantityAvailable !== undefined) {
    next.quantityAvailable = Math.max(0, Math.round(body.quantityAvailable));
  }
  if (next.expiresAt && isExpired(next) && body.expiresAt !== undefined) {
    return error(400, 'invalid_expiry', 'Pick an expiry in the future, or none.');
  }
  // Stock decides whether it is on the shelf; a multiple is never sold out.
  if (next.status === 'active' || next.status === 'sold_out') {
    next.status = isMultiple(next) || next.quantityAvailable > 0 ? 'active' : 'sold_out';
    // Back on the shelf: the people who saved it while it was gone are worth telling.
    if (listing.status === 'sold_out' && next.status === 'active') next.restockedAt = next.updatedAt;
  }

  return json(200, { listing: await repository.updateListing(next) });
}

/**
 * POST /api/listings/{id}/delete - take an item down.
 *
 * Expired, never erased: a listing is withdrawn by the same clock a listing
 * expiring on its own already uses, so it leaves the shelf the same way and
 * the seller can always put it back with a new expiry. Nothing is deleted -
 * an order can point at this listing long after the seller stops selling it.
 */
async function deleteListing(request: HttpRequest, _context: InvocationContext) {
  const found = await manageable(request);
  if ('refusal' in found) return found.refusal;
  const { listing, repository } = found;

  const now = new Date().toISOString();
  await repository.updateListing({ ...listing, expiresAt: now, updatedAt: now });
  return json(200, { expired: true });
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
export const editListingRoute = handler(editListing);
export const deleteListingRoute = handler(deleteListing);
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
app.http('listing-edit', { ...anon, methods: ['POST'], route: 'listings/{id}/edit', handler: editListingRoute });
app.http('listing-delete', { ...anon, methods: ['POST'], route: 'listings/{id}/delete', handler: deleteListingRoute });
app.http('order-create', { ...anon, methods: ['POST'], route: 'orders', handler: createOrderRoute });
app.http('me-activity', { ...anon, methods: ['GET'], route: 'me/activity', handler: myActivityRoute });
app.http('forwarders', { ...anon, methods: ['GET'], route: 'forwarders', handler: forwardersRoute });
