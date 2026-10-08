import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Sourcing } from '../../../shared/enums.js';
import { CATEGORIES, categoriesIn } from '../../../shared/catalog.js';
import { PERSON_FOLLOW, isPersonFollow, storeTag } from '../../../shared/storefront.js';
import { can } from '../../../shared/stores.js';
import { AWAITING_LOT_ID, DIRECT_LOT_ID, lotIsDone, sourcingOf } from '../../../shared/fulfilment.js';
import { lotNo, lotNumberFrom, normaliseSteps } from '../../../shared/routes.js';
import type { Listing, ListingComment, Order, StageEvent, User } from '../../../shared/models.js';
import { personRef } from '../../../shared/parties.js';
import { REACTIONS, REACTION_META, isReaction, type ReactionKind } from '../../../shared/social.js';
import { actorName, andOthers, gistOf, toWhom, whose } from '../../../shared/notifications.js';
import { notify, storeCrew } from './notify.js';
import { isExpired, isMultiple } from '../../../shared/payments.js';
import { dealEndsAt } from '../../../shared/deals.js';
import { cleanCostSheet } from '../../../shared/profit.js';
import { BUMP_GUARD_MS, emptyQuestState, tidyQuestState } from '../../../shared/quest.js';
import { emptyGrowth, tidyGrowth } from '../../../shared/store-growth.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { moderation } from '../moderation.js';
import { isLive } from '../../../shared/service-stores.js';
import { claimPhotos, releaseListingPhotos } from '../storage/release.js';
import { error, handler, json } from './http.js';
import { placeOrder } from './placement.js';
import {
  affiliateFor, claimCookieReferrals, offersAffiliate, recordReferral, referralCookie, referralsInCookie,
  resolveShortCode, shortCodeFor, verifyAffiliateToken,
} from '../affiliate.js';
import { recordOpen } from '../share.js';
import {
  AFFILIATE_PARAM, SHORT_LINK_PREFIX, affiliateUnitMinor, cleanAffiliateMinor, cleanBuyerOffMinor, linkDiscountMinor,
} from '../../../shared/affiliate.js';
import { reconcilePreOrder, rosterOf, verifiedReferrer } from './preorder.js';
import { ALLOWED_TYPES, MAX_PHOTO_BYTES } from './template-routes.js';
import { fingerprint } from '../image-hash.js';
import { rankByPhoto } from '../photo-search.js';
import { tooFast } from '../rate-limit.js';
import { describePhoto, visionAvailable } from '../vision.js';

/** Public seller summary attached to feed cards and listing pages. */
function toSellerCard(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    storefrontName: user.sellerProfile?.storefrontName ?? user.displayName,
    level: storeTag(user.sellerProfile?.levelCache),
    storefrontSlug: user.sellerProfile?.storefrontSlug ?? null,
    // The shop's own handle: where its page is, and where a message to it goes.
    username: user.sellerProfile?.username ?? null,
    tier: user.sellerProfile?.tier ?? 'unverified',
    dispatchRegion: user.sellerProfile?.dispatchRegion ?? null,
    followerCount: user.sellerProfile?.followerCount ?? 0,
    trustScore: user.sellerTrust.score,
    onTimeDispatchRate: user.sellerTrust.onTimeDispatchRate,
    // Orders delivered and not lost in a dispute, counted as each one lands.
    completedSales: user.sellerTrust.completedTransactions,
    memberSince: user.createdAt,
    // The shop's own picture and banner, so its card looks like its page.
    photoUrl: user.sellerProfile?.photoUrl ?? null,
    coverUrl: user.sellerProfile?.coverUrl ?? null,
  };
}

/**
 * GET /api/feed - the unified catalog.
 *
 * Public, because browsing is the default entry point and must render before
 * anyone signs in. The order is the same for everyone; when a session is
 * present the viewer's bookmarks are marked.
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
    // One shop's live stock, for its storefront.
    sellerId: request.query.get('seller') ?? undefined,
  // Expired is read off the clock, so it is filtered here rather than stored.
  })).filter((listing) => !isExpired(listing));

  // Only the lots these listings ride in, not every lot on the site.
  const lotKeys = [...new Map(listings.filter((l) => l.lotId).map((l) => [l.lotId!, l.sellerId])).entries()];
  const [sellers, lots] = await Promise.all([
    repository.listUsersByIds([...new Set(listings.map((l) => l.sellerId))]),
    Promise.all(lotKeys.map(([lotId, sellerId]) => repository.getLot(sellerId, lotId))),
  ]);
  const sellerById = new Map(sellers.map((s) => [s.id, toSellerCard(s)]));
  // The lot contributes exactly one buyer-visible fact: when it ships.
  const dispatchByLot = new Map(lots.filter((l) => l !== null).map((l) => [l.id, l.estimatedDispatchAt]));

  return json(200, {
    listings: listings.map((listing) => ({
      ...publicListing(listing),
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
/**
 * Whether this reader may see the listing at all. A private deal is the
 * buyer's it was made for and the shop's, and nobody else's - so nobody else
 * can save it, comment on it or buy it either.
 */
async function canSee(repository: Awaited<ReturnType<typeof getRepository>>, listing: Listing, viewerId: string | undefined) {
  return !listing.privateFor || viewerId === listing.privateFor || await mayManage(repository, listing, viewerId);
}

/**
 * A listing as anyone outside the shop may see it: without what it cost the
 * shop, and without its price history. A buyer is only ever shown "was" - the
 * highest price it has been on sale at, when it has come down since - so that
 * is all that leaves; every other change of price stays the shop's.
 */
function publicListing(listing: Listing): Listing {
  const { costSheet: _cost, costSheetPrevious: _history, priceHistory, ...rest } = listing;
  const highest = Math.max(0, ...(priceHistory ?? []).map((entry) => entry.priceMinor));
  return highest > listing.priceMinor
    ? { ...rest, priceHistory: [{ priceMinor: highest, at: listing.createdAt }] }
    : rest;
}

async function listingDetail(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A listing id is required.');

  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const listing = await repository.getListing(id);
  if (!listing) return error(404, 'not_found', 'No such listing.');

  const viewer = await auth.getCurrentUser(request);
  // A private deal is visible to the buyer it was made for and the shop that
  // made it, and to nobody else - not even as "sold".
  if (!(await canSee(repository, listing, viewer?.id))) return error(404, 'not_found', 'No such listing.');
  // The shop's own visits are not interest in it.
  if (viewer?.id !== listing.sellerId) void repository.countView(listing);
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
  // A comment an operator took down after a dispute is gone for every reader;
  // the rest carry what the button under them needs to say.
  const moderated = await moderation(repository);
  const comments = rawComments
    .filter((comment) => !moderated.isRemoved('comment', comment.id))
    .map((comment) => ({
      ...publicComment(comment, viewer?.id ?? null),
      author: personRef(commenterOf.get(comment.authorId), comment.authorName),
      moderation: moderated.mark('comment', comment.id, viewer?.id),
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

  // Affiliate links. Whoever is reading gets their own link to share; whoever
  // arrived through somebody else's is remembered against their account, so
  // the credit holds when they sign up first or come back days later to buy.
  const affiliateOn = offersAffiliate(listing);
  const linkFrom = affiliateOn ? verifyAffiliateToken(listing.id, request.query.get(AFFILIATE_PARAM)) : null;
  let referrerId = linkFrom && linkFrom !== viewer?.id && linkFrom !== listing.sellerId ? linkFrom : null;
  if (viewer && affiliateOn) {
    // A short link opened before signing in is held in a cookie until now.
    await claimCookieReferrals(repository, request, viewer.id);
    const account = await repository.getUserById(viewer.id);
    if (account && referrerId) await recordReferral(repository, account, listing, referrerId);
    referrerId ??= account?.referrals?.find((entry) => entry.listingId === listing.id)?.referrerId ?? null;
  }
  if (!viewer && affiliateOn) {
    referrerId ??= referralsInCookie(request).find((entry) => entry.listingId === listing.id)?.referrerId ?? null;
  }
  const referredBy = referrerId ? await repository.getUserById(referrerId) : null;

  return json(200, {
    affiliate: affiliateOn ? {
      /** What one sale through a link pays, in paise. */
      amountMinor: affiliateUnitMinor(listing.affiliate, listing.priceMinor),
      /** What a buyer through somebody's link saves per unit, in paise; 0 when the shop offers none. */
      buyerOffMinor: linkDiscountMinor(listing.affiliate),
      /** Whether the reader may have a link of their own: anybody signed in but the shop. */
      canShare: Boolean(viewer && viewer.id !== listing.sellerId),
      referredBy: referredBy && !referredBy.suspended ? personRef(referredBy) : null,
    } : null,
    // What the item cost the shop is the shop's own business.
    listing: (await mayManage(repository, listing, viewer?.id)) ? settled.listing : publicListing(settled.listing),
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

/**
 * GET /api/listings/{id}/similar - other things somebody looking at this
 * might want: the same category first, then whatever shares its tags, then
 * more from the same shop. Never the item itself, and never anything hidden.
 */
async function similarListings(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A listing id is required.');
  const repository = await getRepository();
  const listing = await repository.getListing(id);
  if (!listing) return error(404, 'not_found', 'No such listing.');

  const tags = new Set(listing.tags.map((tag) => tag.toLowerCase()));
  const pool = (await repository.listListings({})).filter((entry) =>
    entry.id !== listing.id && !isExpired(entry) && !entry.privateFor);
  const score = (entry: Listing) =>
    (entry.category === listing.category ? 10 : 0)
    + entry.tags.filter((tag) => tags.has(tag.toLowerCase())).length * 4
    + (entry.sellerId === listing.sellerId ? 2 : 0)
    + (entry.condition === listing.condition ? 1 : 0)
    // Close in price is closer in kind than the same price twice as far off.
    + Math.max(0, 2 - Math.abs(Math.log2(Math.max(1, entry.priceMinor) / Math.max(1, listing.priceMinor))));
  const picks = pool
    .map((entry) => ({ entry, score: score(entry) }))
    .filter((pick) => pick.score >= 2)
    .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
    .slice(0, 12)
    .map((pick) => pick.entry);

  const sellers = await repository.listUsersByIds([...new Set(picks.map((entry) => entry.sellerId))]);
  const sellerById = new Map(sellers.map((seller) => [seller.id, toSellerCard(seller)]));
  return json(200, {
    listings: picks.map((entry) => ({
      ...publicListing(entry),
      liked: false,
      seller: sellerById.get(entry.sellerId) ?? null,
      estimatedDispatchAt: null,
    })),
  });
}

/**
 * POST /api/search/photo - the catalogue, ranked against a photo.
 *
 * The photo arrives as a data URL, like an upload, and is never stored: it is
 * fingerprinted and, when vision is on, described by Claude, and then dropped.
 * Public like the catalogue itself, and limited per account - or per address
 * for a guest - because each search may be a paid call to Claude.
 */
async function photoSearch(request: HttpRequest, _context: InvocationContext) {
  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const viewer = await auth.getCurrentUser(request);
  const who = viewer?.id ?? `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'}`;
  const slow = tooFast(who, 'photosearch');
  if (slow) return slow;

  let body: { dataUrl?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const match = /^data:([a-z/+-]+);base64,(.+)$/i.exec(body.dataUrl ?? '');
  if (!match) return error(400, 'invalid_photo', 'Send the photo as a base64 data URL.');
  const contentType = match[1]!.toLowerCase();
  if (!ALLOWED_TYPES.includes(contentType)) {
    return error(400, 'invalid_photo', 'Photos must be JPEG, PNG, WebP or GIF.');
  }
  const bytes = new Uint8Array(Buffer.from(match[2]!, 'base64'));
  if (bytes.byteLength === 0) return error(400, 'invalid_photo', 'That photo is empty.');
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return error(413, 'photo_too_large', 'That photo is too large. Try a smaller one.');
  }

  const hash = fingerprint(bytes, contentType);
  const [description, all] = await Promise.all([
    describePhoto(bytes, contentType),
    repository.listListings({}),
  ]);
  if (!hash && !description) {
    return error(422, 'unreadable_photo', 'Could not read that photo. Try a JPEG, or a clearer picture.');
  }
  const pool = all.filter((listing) => !isExpired(listing) && !listing.privateFor);
  const ranked = await rankByPhoto(pool, hash, description);

  const likedIds = viewer ? new Set(await repository.listLikedListingIds(viewer.id)) : new Set<string>();
  const sellers = await repository.listUsersByIds([...new Set(ranked.map((entry) => entry.listing.sellerId))]);
  const sellerById = new Map(sellers.map((seller) => [seller.id, toSellerCard(seller)]));
  return json(200, {
    listings: ranked.map(({ listing, match }) => ({
      ...publicListing(listing),
      liked: likedIds.has(listing.id),
      seller: sellerById.get(listing.sellerId) ?? null,
      estimatedDispatchAt: null,
      photoMatch: match,
    })),
    described: description,
    vision: visionAvailable(),
  });
}

/**
 * POST /api/listings/{id}/affiliate-link - the reader's own short link to it.
 *
 * Made the first time they ask and the same ever after. Only for signed-in
 * people other than the shop, on items that pay a commission.
 */
async function affiliateLink(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const listing = request.params.id ? await repository.getListing(request.params.id) : null;
  if (!listing) return error(404, 'not_found', 'No such listing.');
  if (!offersAffiliate(listing)) return error(409, 'not_affiliate', 'This item does not pay a commission.');
  if (listing.sellerId === user.id) return error(409, 'own_item', 'You cannot earn a commission on your own item.');
  const account = await repository.getUserById(user.id);
  if (!account) return error(404, 'not_found', 'No such account.');
  const code = await shortCodeFor(repository, account, listing);
  return json(200, { code, path: `${SHORT_LINK_PREFIX}${code}` });
}

/**
 * GET /api/r/{code} - where a short link goes.
 *
 * Remembers the referral on the account of whoever opened it if they are
 * signed in, and in a cookie either way, then says which item to show.
 */
async function openShortLink(request: HttpRequest, _context: InvocationContext) {
  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const target = await resolveShortCode(repository, request.params.code ?? '');
  if (!target) return error(404, 'not_found', 'That link does not lead anywhere.');
  const listing = await repository.getListing(target.listingId);
  if (!listing) return error(404, 'not_found', 'That item is no longer here.');

  const viewer = await auth.getCurrentUser(request);
  const self = viewer?.id === target.referrerId;
  if (viewer && !self) {
    const account = await repository.getUserById(viewer.id);
    if (account) await recordReferral(repository, account, listing, target.referrerId);
  }
  const cookies = self || !offersAffiliate(listing) ? [] : [referralCookie(request, listing.id, target.referrerId)];
  // Somebody else opening the link is what the sharer's quests count.
  const counted = await recordOpen(repository, request, target.referrerId,
    { kind: 'item', target: listing.id, storeOwnerId: listing.sellerId }, viewer?.id ?? null);
  return json(200, { listingId: listing.id }, [...cookies, ...counted]);
}

/** Whether this person may manage the shop a listing belongs to. */
async function mayManage(repository: Awaited<ReturnType<typeof getRepository>>, listing: Listing, userId: string | undefined) {
  if (!userId) return false;
  if (userId === listing.sellerId) return true;
  const owner = await repository.getUserById(listing.sellerId);
  return Boolean(owner && can(owner, userId, 'listings'));
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
    affiliateMinor?: number | null;
    affiliateOffMinor?: number | null;
    /** Announce it in the shop's channel, to its followers. */
    shareToChannel?: boolean;
    /** Announce it in the feed, to everyone. */
    shareToFeed?: boolean;
    /** The before-lot ladder from the Quick Post template, if it had one. */
    preLotSteps?: { id?: string; name?: string; description?: string }[];
    preLotName?: string;
    /** A private deal made from one of the shop's items: which one. */
    dealFromId?: string | null;
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

  // A private deal is for one named buyer, never the shop itself.
  let privateFor: string | null = null;
  if (body.privateFor) {
    const buyer = await repository.getUserById(body.privateFor);
    if (!buyer || buyer.id === sellerId) return error(400, 'invalid_listing', 'Pick who this private deal is for.');
    privateFor = buyer.id;
  }
  // Made from one of this shop's own items: remembered with its price, so the
  // deal can show what it took off. Anybody else's item is simply not it.
  let dealFrom: Listing['dealFrom'] = null;
  if (privateFor && body.dealFromId) {
    const source = await repository.getListing(body.dealFromId);
    if (source && source.sellerId === sellerId) dealFrom = { listingId: source.id, priceMinor: source.priceMinor };
  }

  // What it cost to bring in (Pro), when the seller filled it in while listing.
  let costSheet: Listing['costSheet'] = null;
  try {
    costSheet = cleanCostSheet(body.costSheet, new Date().toISOString());
  } catch (err) {
    return error(400, 'invalid_listing', (err as Error).message);
  }
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
    ...listingTerms(body, Math.round(body.priceMinor)),
    // Pre-order and shipment lot are independent: a listing opts into demand
    // pooling here, and gets tagged into a lot separately, from the seller's
    // lot console.
    preOrder:
      !privateFor && body.preOrder && body.preOrder.fillThreshold > 0
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
    costSheet,
    // Private: out of the catalog, the shop's grid, channels and the feed.
    // Never an affiliate item - a price made for one buyer is not a price to
    // hand round for commission - and always on a clock of at most a day.
    ...(privateFor
      ? { privateFor, unlisted: true, affiliate: null, expiresAt: dealEndsAt(body.expiresAt), dealFrom }
      : {}),
    createdAt: now,
    updatedAt: now,
  };

  const created = await repository.createListing(listing);
  await claimPhotos(created.photos.map((photo) => photo.blobName || photo.url), `listing:${created.id}`);

  // Telling people is part of listing, not a second job to remember. The
  // channel is where a shop's followers already are; the feed is everybody.
  // Both are opt-in per listing, because a shop that posts every item to
  // everything is a shop people mute.
  if (!privateFor && (body.shareToChannel || body.shareToFeed)) {
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
  // Only a real listing this person can see: saves count towards quests and
  // stickers, so saving made-up ids must not be a way to farm them.
  const listing = await repository.getListing(id);
  if (!listing || !(await canSee(repository, listing, user.id))) return error(404, 'not_found', 'No such listing.');
  const liked = await repository.toggleLike(user.id, id);
  if (liked) {
    // A save is the clearest sign somebody wants the thing; the shop hears it.
    const seller = await itemSeller(listing, repository);
    const who = actorName(user.displayName);
    const what = `${whose(seller.store)} item`;
    await notify(repository, seller.audience, {
      kind: 'post_reacted',
      title: `${who} saved ${what}`,
      body: gistOf(listing.title),
      link: `/listing/${encodeURIComponent(listing.id)}`,
      group: {
        key: `save:${listing.id}`,
        actor: who,
        title: ({ actors }) => (actors.length > 1 ? `${andOthers(actors)} saved ${what}` : `${who} saved ${what}`),
      },
    }, { except: user.id });
  }
  return json(200, { liked });
}

/**
 * Who hears about an item: the shop's owner and whoever lists for it, said
 * as the shop's name; or the person, for something sold as themselves.
 */
async function itemSeller(listing: Listing, repository: Awaited<ReturnType<typeof getRepository>>) {
  const owner = await repository.getUserById(listing.sellerId);
  if (owner?.sellerProfile) return { audience: storeCrew(owner, 'listings'), store: owner.sellerProfile.storefrontName };
  return { audience: [listing.sellerId], store: null as string | null };
}

/**
 * POST /api/listings/{id}/bump - spend a bump point to put a live item back at
 * the top of the feed.
 *
 * Points come from quests. The shop's own, earned on its board by whoever runs
 * it, go first; then the points of the person pressing Bump, earned on their
 * own quests. With none left on either the answer is 409 `no_bumps`, and the
 * app sends the seller to the quests that earn more. A second Bump within the
 * hour is refused before it costs anything, since the item is still near the top.
 */
async function bumpListing(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const principal = await auth.requireCapability(request, ['sell']);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A listing id is required.');

  const repository = await getRepository();
  const listing = await repository.getListing(id);
  if (!listing) return error(404, 'not_found', 'No such listing.');
  const owner = await repository.getUserById(listing.sellerId);
  const allowed = owner && (owner.sellerProfile ? can(owner, principal.id, 'listings') : owner.id === principal.id);
  if (!owner || !allowed) return error(403, 'forbidden', 'Only the seller can bump this item.');
  if (listing.status !== 'active' || isExpired(listing)) return error(409, 'not_active', 'Only a live item can be bumped.');

  const presser = owner.id === principal.id ? owner : await repository.getUserById(principal.id);
  const shopLeft = owner.sellerProfile?.growth?.spotlights ?? 0;
  const ownLeft = presser?.quest?.bumps ?? 0;
  if (shopLeft + ownLeft < 1) {
    return error(409, 'no_bumps', 'No bump points left. Finish a weekly or monthly quest to earn more.');
  }
  const last = listing.bumpedAt ? Date.parse(listing.bumpedAt) : 0;
  if (Date.now() - last < BUMP_GUARD_MS) {
    return error(429, 'bump_rate_limited', 'This item was bumped in the last hour, so it is still near the top.');
  }

  const now = new Date().toISOString();
  listing.bumpedAt = now;
  listing.updatedAt = now;
  await repository.updateListing(listing);
  if (shopLeft > 0) {
    const growth = owner.sellerProfile!.growth ?? emptyGrowth();
    owner.sellerProfile!.growth = tidyGrowth({
      ...growth,
      spotlights: shopLeft - 1,
      spotlightLog: [...(growth.spotlightLog ?? []), { listingId: listing.id, at: now, by: principal.id }],
    });
    await repository.updateUser(owner);
  } else {
    const quest = presser!.quest ?? emptyQuestState();
    presser!.quest = tidyQuestState({ ...quest, bumps: ownLeft - 1, bumpLog: [...(quest.bumpLog ?? []), { listingId: listing.id, at: now }] });
    await repository.updateUser(presser!);
  }
  const shop = shopLeft > 0 ? shopLeft - 1 : 0;
  const own = shopLeft > 0 ? ownLeft : ownLeft - 1;
  return json(200, { bumped: true, bumpedAt: now, bumps: shop + own, shop, own, spent: shopLeft > 0 ? 'shop' : 'own' });
}

const COMMENT_MAX = 2000;
const COMMENTS_PER_MINUTE = 5;

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
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) return error(400, 'invalid_comment', 'Comment cannot be empty.');
  if (text.length > COMMENT_MAX) return error(400, 'invalid_comment', `Keep it under ${COMMENT_MAX} characters.`);
  if (body.replyToId !== undefined && typeof body.replyToId !== 'string') {
    return error(400, 'invalid_comment', 'Reply to a post by its id.');
  }

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
  const repository = await getRepository();
  const listing = await repository.getListing(id);
  if (!listing || !(await canSee(repository, listing, user.id))) return error(404, 'not_found', 'No such listing.');
  const existing = await repository.listComments(id);
  // A few a minute is a conversation; more is somebody flooding the page.
  const recent = existing.filter((c) => c.authorId === user.id && Date.parse(c.createdAt) > Date.now() - 60_000);
  if (recent.length >= COMMENTS_PER_MINUTE) {
    return error(429, 'too_many_comments', 'Slow down a little - try again in a minute.');
  }
  // A reply always hangs off the post that started the thread, so a reply to
  // a reply still lands in the right place and threads never nest deeper.
  if (comment.replyToId) {
    const parent = existing.find((c) => c.id === comment.replyToId);
    if (!parent) return error(404, 'not_found', 'That post is gone.');
    comment.replyToId = parent.replyToId ?? parent.id;
  }
  const saved = await repository.addComment(comment);

  // The shop hears about a question on its item; whoever was answered hears
  // about the answer. Somebody who is both hears once, as the answer.
  const who = actorName(user.displayName);
  const link = `/listing/${encodeURIComponent(listing.id)}`;
  const answered = body.replyToId ? existing.find((c) => c.id === body.replyToId) : null;
  if (answered) {
    await notify(repository, [answered.authorId], {
      kind: 'comment_replied',
      title: `${who} replied to your comment`,
      body: `On ${gistOf(listing.title, 'an item', 40)}: ${gistOf(text, '', 70)}`,
      link,
    }, { except: user.id });
  }
  const seller = await itemSeller(listing, repository);
  const what = `${whose(seller.store)} item`;
  await notify(repository, seller.audience.filter((id) => id !== answered?.authorId), {
    kind: 'post_commented',
    title: `${who} commented on ${what}`,
    body: `${gistOf(listing.title, 'An item', 40)}: ${gistOf(text, '', 70)}`,
    link,
    group: {
      key: `lcmt:${listing.id}`,
      actor: who,
      title: ({ count, actors }) => (actors.length > 1
        ? `${andOthers(actors)} commented on ${what}`
        : count > 1 ? `${who} left ${count} comments on ${what}` : `${who} commented on ${what}`),
    },
  }, { except: user.id });

  return json(201, { comment: { ...publicComment(saved, user.id), author: personRef(user) } });
}

/**
 * A comment as a reader sees it: how many of each reaction and which one is
 * theirs - never the list of who reacted.
 */
function publicComment(comment: ListingComment, viewerId: string | null) {
  const { reactions = [], ...rest } = comment;
  const reactionCounts: Partial<Record<ReactionKind, number>> = {};
  for (const entry of reactions) reactionCounts[entry.kind] = (reactionCounts[entry.kind] ?? 0) + 1;
  const myReaction = reactions.find((entry) => entry.userId === viewerId)?.kind ?? null;
  return { ...rest, reactionCounts, myReaction };
}

/** POST /api/listings/{id}/comments/{commentId}/react - one reaction per person; the same one again takes it back. */
async function reactToComment(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const { id, commentId } = request.params;
  if (!id || !commentId) return error(400, 'invalid_request', 'A listing and a post are required.');

  let body: { kind?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (body.kind !== null && !isReaction(body.kind)) {
    return error(400, 'invalid_reaction', `A reaction is one of ${REACTIONS.join(', ')}.`);
  }

  const repository = await getRepository();
  const comment = (await repository.listComments(id)).find((c) => c.id === commentId);
  if (!comment) return error(404, 'not_found', 'That post is gone.');
  const others = (comment.reactions ?? []).filter((entry) => entry.userId !== user.id);
  const had = (comment.reactions ?? []).some((entry) => entry.userId === user.id);
  comment.reactions = body.kind ? [...others, { userId: user.id, kind: body.kind }] : others;
  comment.updatedAt = new Date().toISOString();
  const saved = await repository.updateComment(comment);
  if (body.kind && !had) {
    const who = actorName(user.displayName);
    const emoji = REACTION_META[body.kind as ReactionKind].emoji;
    await notify(repository, [comment.authorId], {
      kind: 'comment_liked',
      title: `${who} reacted ${emoji} to your comment`,
      body: gistOf(comment.body),
      link: `/listing/${encodeURIComponent(id)}`,
      group: {
        key: `lclike:${comment.id}`,
        actor: who,
        title: ({ actors }) => (actors.length > 1
          ? `${andOthers(actors)} reacted to your comment`
          : `${who} reacted ${emoji} to your comment`),
      },
    }, { except: user.id });
  }
  const { reactionCounts, myReaction } = publicComment(saved, user.id);
  return json(200, { reactionCounts, myReaction });
}

/** POST /api/sellers/{id}/follow - toggle following a seller. */
async function toggleFollow(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const sellerId = request.params.id;
  if (!sellerId) return error(400, 'invalid_request', 'A seller id is required.');
  // People follow; shops do not. A shop has customers, not a reading list.
  if (request.query?.get('as')) {
    return error(403, 'people_only', 'Shops cannot follow. Switch to your profile to follow.');
  }

  // `person:<id>` follows the person's own page; a plain id follows their shop.
  const person = isPersonFollow(sellerId);
  const targetId = person ? sellerId.slice(PERSON_FOLLOW.length) : sellerId;
  if (targetId === user.id) return error(400, 'invalid_request', 'You cannot follow yourself.');

  const repository = await getRepository();
  const target = await repository.getUserById(targetId);
  if (!target || (!person && !target.sellerProfile)) return error(404, 'not_found', 'Nobody to follow there.');
  const following = await repository.toggleFollow(user.id, sellerId);
  // The count is kept here, once, for both kinds, so every store agrees on it.
  const step = following ? 1 : -1;
  if (person) target.followerCount = Math.max(0, (target.followerCount ?? 0) + step);
  else target.sellerProfile!.followerCount = Math.max(0, target.sellerProfile!.followerCount + step);
  target.updatedAt = new Date().toISOString();
  await repository.updateUser(target);

  if (following) {
    // "followed you" and "followed Kaiju Imports" are different news to
    // somebody who has both a page and a shop.
    const follower = await repository.getUserById(user.id);
    const who = actorName(user.displayName, follower?.username);
    const store = person ? null : target.sellerProfile!.storefrontName;
    const whom = toWhom(store);
    await notify(repository, person ? [target.id] : storeCrew(target, 'posts'), {
      kind: 'followed',
      title: `${who} followed ${whom}`,
      body: follower?.username ? `@${follower.username} · tap to see their page` : 'Tap to see who follows you',
      link: follower?.username ? `/${encodeURIComponent(follower.username)}` : '/social',
      group: {
        key: `follow:${sellerId}`,
        actor: who,
        title: ({ actors }) => (actors.length > 1 ? `${andOthers(actors)} followed ${whom}` : `${who} followed ${whom}`),
      },
    }, { except: user.id });
  }
  return json(200, { following, followerCount: person ? target.followerCount : target.sellerProfile!.followerCount });
}

const MAX_ORDER_QUANTITY = 100;

/**
 * The post a Buy came from, when the client names one and it really is a
 * post selling this item. Anything else is dropped rather than refused: the
 * order is the point, the credit to a post is not.
 */
async function postSelling(
  repository: Awaited<ReturnType<typeof getRepository>>, value: unknown, listingId: string,
): Promise<{ channelId: string; postId: string } | null> {
  if (!value || typeof value !== 'object') return null;
  const { channelId, postId } = value as { channelId?: unknown; postId?: unknown };
  if (typeof channelId !== 'string' || typeof postId !== 'string') return null;
  const post = await repository.getPost(channelId, postId).catch(() => null);
  return post?.listingId === listingId ? { channelId, postId } : null;
}

/** POST /api/orders - buy an in-stock item, or join a group-buy lot. */
async function createOrder(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['buy']);
  const repository = await getRepository();

  let body: { listingId?: string; quantity?: number; via?: string; plan?: 'book'; ref?: string; fromPost?: unknown };
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
  if (listing.privateFor && listing.privateFor !== user.id) return error(404, 'not_found', 'No such listing.');

  // Enforced here, not only by hiding the button: an expired or withdrawn item
  // is not for sale whatever the client sends.
  if (isExpired(listing)) return error(409, 'expired', 'This item has expired and cannot be bought.');
  if (listing.status !== 'active') return error(409, 'unavailable', 'This item is not for sale.');

  // A whole number from 1 up, or nothing at all - anything else is refused
  // rather than coerced, because NaN passes every comparison below it.
  const asked = body.quantity ?? 1;
  if (typeof asked !== 'number' || !Number.isInteger(asked) || asked < 1 || asked > MAX_ORDER_QUANTITY) {
    return error(400, 'invalid_quantity', `Quantity must be a whole number from 1 to ${MAX_ORDER_QUANTITY}.`);
  }
  const quantity = asked;
  if (!isMultiple(listing) && quantity > listing.quantityAvailable) {
    return error(409, 'insufficient_stock', `Only ${listing.quantityAvailable} left.`);
  }

  // A link followed straight into Buy is remembered like one opened first.
  // The credit itself is read back from the account, never from the request,
  // so a client cannot name its own affiliate.
  await claimCookieReferrals(repository, request, user.id);
  const referredBy = verifyAffiliateToken(listing.id, body.ref);
  if (referredBy) {
    const buyer = await repository.getUserById(user.id);
    if (buyer) await recordReferral(repository, buyer, listing, referredBy);
  }
  const affiliate = await affiliateFor(repository, user.id, listing);
  const fromPost = await postSelling(repository, body.fromPost, listing.id);

  // Pressing Buy again on an item already at the checkout goes back to that
  // checkout rather than opening a second one nobody asked for.
  if (body.plan !== 'book') {
    const open = (await repository.listOrdersForBuyer(user.id)).find((entry) =>
      entry.listingId === listing.id && entry.placedAt === null && entry.status === 'pending_payment');
    if (open) {
      if (affiliate && open.affiliate?.referrerId !== affiliate.referrerId) {
        // Nothing is paid at a checkout, so its price can still follow the
        // link that brought the buyer: the old link's discount back on, the new one's off.
        const base = open.unitPriceMinor + (open.affiliate?.buyerOffMinor ?? 0);
        open.affiliate = affiliate;
        open.unitPriceMinor = Math.max(100, base - (affiliate.buyerOffMinor ?? 0));
      }
      open.quantity = quantity;
      if (fromPost && !open.fromPost) open.fromPost = fromPost;
      open.escrow = { ...open.escrow, amountMinor: open.unitPriceMinor * quantity };
      open.buyClicks = (open.buyClicks ?? 1) + 1;
      open.updatedAt = new Date().toISOString();
      return json(200, { order: await repository.updateOrder(open) });
    }
  } else {
    // Booking again while the last booking still waits on the shop is the
    // same booking: the shop is not told twice.
    const waiting = (await repository.listOrdersForBuyer(user.id)).find((entry) =>
      entry.listingId === listing.id && entry.bookingOnly && !entry.accepted && entry.status === 'pending_payment');
    if (waiting) return json(200, { order: waiting });
  }

  const now = new Date().toISOString();
  // A buyer who came through somebody's link pays the shop's link price.
  const unitPriceMinor = Math.max(100, listing.priceMinor - (affiliate?.buyerOffMinor ?? 0));
  const amountMinor = unitPriceMinor * quantity;
  const now2 = new Date().toISOString();

  /*
   * An item can already be in a lot before anybody buys it - the shop opened
   * the run first and listed against it - and then the very first thing its
   * buyer should read is which shipment it is travelling with, before the
   * order was even placed. So the join is recorded as the opening event, not
   * inferred from `lotId` by whoever draws the timeline later.
   */
  /* A lot the seller has shut to new orders, or that is finished, cannot
     have this item put in it, so the order waits for the next lot like any
     import sold without one. */
  const listedLot = listing.lotId ? await repository.getLot(listing.sellerId, listing.lotId) : null;
  const bornInLot = listedLot && listedLot.status !== 'filled' && !lotIsDone(listedLot) ? listedLot : null;
  const joined: StageEvent[] = bornInLot
    ? [{
        stage: 'ordering',
        enteredAt: now2,
        kind: 'joined',
        lot: {
          id: bornInLot.id,
          name: bornInLot.name,
          number: lotNo(bornInLot.lotNumber) ?? lotNumberFrom(bornInLot.id, bornInLot.createdAt),
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
    lotId: bornInLot?.id
      ?? (listing.lotId || sourcingOf(listing) === 'import' ? AWAITING_LOT_ID : DIRECT_LOT_ID),
    sellerId: listing.sellerId,
    buyerId: user.id,
    listingId: listing.id,
    itemName: listing.title,
    condition: listing.condition,
    quantity,
    unitWeightGrams: 0,
    unitPriceMinor,
    currency: listing.currency,
    status: 'pending_payment',
    paymentStatus: 'unpaid',
    advancePercent: listing.advancePercent ?? null,
    payments: [],
    credits: [],
    stage: bornInLot || listing.lotId ? 'ordering' : 'preparing',
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
    broughtBy: await verifiedReferrer(repository, body.via, user.id, listing),
    affiliate,
    fromPost,
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

/** GET /api/me/saved - everything you saved, newest save first, as the feed shows it. */
async function mySaved(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const ids = await repository.listLikedListingIds(user.id);
  const listings = (await Promise.all(ids.map((id) => repository.getListing(id))))
    .filter((listing): listing is Listing => listing !== null && listing.status !== 'archived' && !listing.privateFor);
  const sellers = await repository.listUsersByIds([...new Set(listings.map((l) => l.sellerId))]);
  const sellerById = new Map(sellers.map((s) => [s.id, toSellerCard(s)]));
  return json(200, {
    listings: listings.map((listing) => ({
      ...publicListing(listing),
      liked: true,
      seller: sellerById.get(listing.sellerId) ?? null,
      estimatedDispatchAt: null,
      // Sold out or past its date: still yours to look back at, but not buyable.
      gone: listing.status !== 'active' || isExpired(listing),
    })),
  });
}

/**
 * GET /api/me/listings - the signed-in account's own stock, and nothing else.
 *
 * What the Sell tab's Items screen draws. It used to read `/me/activity`,
 * which also fetches every purchase, sale, like and follow on the account.
 */
async function myListings(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  // The same shelf as `/me/activity`: sold out and expired included, withdrawn
  // and scheduled-sale items not.
  const listings = (await repository.listListings({ sellerId: user.id, includeHidden: true, limit: 10_000 }))
    .filter((row) => row.status !== 'archived' && !row.unlisted);
  return json(200, { listings });
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
  /** Commission per unit sold, in paise; null or 0 turns it off. */
  affiliateMinor?: number | null;
  /** What a buyer through a link saves per unit, in paise; null or 0 turns it off. */
  affiliateOffMinor?: number | null;
}, priceMinor: number, previous?: Listing['affiliate']): Partial<Pick<Listing, 'quantityMode' | 'expiresAt' | 'advancePercent' | 'affiliate'>> {
  const terms: Partial<Pick<Listing, 'quantityMode' | 'expiresAt' | 'advancePercent' | 'affiliate'>> = {};
  if (body.affiliateMinor !== undefined || body.affiliateOffMinor !== undefined) {
    const amountMinor = body.affiliateMinor !== undefined
      ? cleanAffiliateMinor(body.affiliateMinor, priceMinor)
      : cleanAffiliateMinor(affiliateUnitMinor(previous, priceMinor), priceMinor);
    // The discount rides on the commission: with no link to earn from, there is no link to save through.
    const offAsked = body.affiliateOffMinor !== undefined ? body.affiliateOffMinor : previous?.buyerOffMinor;
    const buyerOffMinor = amountMinor ? cleanBuyerOffMinor(offAsked, priceMinor, amountMinor) : null;
    terms.affiliate = amountMinor ? { amountMinor, ...(buyerOffMinor ? { buyerOffMinor } : {}) } : null;
  }
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
    affiliateMinor?: number | null;
    affiliateOffMinor?: number | null;
    photos?: { blobName?: string; url: string; isPrimary?: boolean }[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const price = body.priceMinor !== undefined && body.priceMinor > 0 ? Math.round(body.priceMinor) : listing.priceMinor;
  const next: Listing = { ...listing, ...listingTerms(body, price, listing.affiliate), updatedAt: new Date().toISOString() };
  // A private deal stays one: no commission, and a new clock is at most a day from now.
  if (listing.privateFor) {
    next.affiliate = null;
    if (body.expiresAt !== undefined) next.expiresAt = dealEndsAt(body.expiresAt);
  }
  // A cheaper price can leave an old commission bigger than the item; it is
  // brought back under the new price rather than left owing more than it took.
  if (next.affiliate?.amountMinor && body.affiliateMinor === undefined && body.affiliateOffMinor === undefined) {
    const kept = cleanAffiliateMinor(next.affiliate.amountMinor, price);
    const off = kept ? cleanBuyerOffMinor(next.affiliate.buyerOffMinor, price, kept) : null;
    next.affiliate = kept ? { amountMinor: kept, ...(off ? { buyerOffMinor: off } : {}) } : null;
  }
  if (body.title !== undefined) {
    if (!body.title.trim()) return error(400, 'invalid_listing', 'A title is required.');
    next.title = body.title.trim();
  }
  if (body.description !== undefined) next.description = body.description.trim();
  if (Array.isArray(body.photos)) {
    // Same rules as a new listing: at most six, exactly one primary.
    const kept = body.photos
      .slice(0, 6)
      .map((photo) => ({ blobName: photo.blobName ?? '', url: photo.url, imageHash: null, isPrimary: photo.isPrimary === true }))
      .filter((photo) => photo.blobName || photo.url);
    const lead = Math.max(0, kept.findIndex((photo) => photo.isPrimary));
    next.photos = kept.map((photo, index) => ({ ...photo, isPrimary: index === lead }));
  }
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

  const updated = await repository.updateListing(next);
  await claimPhotos(updated.photos.map((photo) => photo.blobName || photo.url), `listing:${updated.id}`);
  if (Array.isArray(body.photos)) {
    // Photos taken off the listing leave the blob too, unless something else still names them.
    const names = new Set(updated.photos.flatMap((photo) => [photo.url, photo.blobName]));
    const dropped = listing.photos.filter((photo) => !names.has(photo.url) && !(photo.blobName && names.has(photo.blobName)));
    if (dropped.length > 0) await releaseListingPhotos([{ ...listing, photos: dropped }], repository);
  }
  return json(200, { listing: updated });
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
    .filter((user) => user.forwarderProfile !== null && isLive(user.forwarderProfile) && !user.suspended)
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
export const reactToCommentRoute = handler(reactToComment);
export const toggleFollowRoute = handler(toggleFollow);
export const createOrderRoute = handler(createOrder);
export const editListingRoute = handler(editListing);
export const deleteListingRoute = handler(deleteListing);
export const myActivityRoute = handler(myActivity);
export const myListingsRoute = handler(myListings);
export const forwardersRoute = handler(forwarders);

const anon = { authLevel: 'anonymous' } as const;
export const mySavedRoute = handler(mySaved);
app.http('feed', { ...anon, methods: ['GET'], route: 'feed', handler: feedRoute });
app.http('listing-detail', { ...anon, methods: ['GET'], route: 'listings/{id}', handler: listingDetailRoute });
export const similarListingsRoute = handler(similarListings);
export const photoSearchRoute = handler(photoSearch);
export const affiliateLinkRoute = handler(affiliateLink);
export const openShortLinkRoute = handler(openShortLink);
app.http('listing-affiliate-link', { ...anon, methods: ['POST'], route: 'listings/{id}/affiliate-link', handler: affiliateLinkRoute });
app.http('short-link', { ...anon, methods: ['GET'], route: 'r/{code}', handler: openShortLinkRoute });
app.http('photo-search', { ...anon, methods: ['POST'], route: 'search/photo', handler: photoSearchRoute });
app.http('listing-similar', { ...anon, methods: ['GET'], route: 'listings/{id}/similar', handler: similarListingsRoute });
app.http('listing-create', { ...anon, methods: ['POST'], route: 'listings', handler: createListingRoute });
app.http('listing-like', { ...anon, methods: ['POST'], route: 'listings/{id}/like', handler: toggleLikeRoute });
app.http('listing-bump', { ...anon, methods: ['POST'], route: 'listings/{id}/bump', handler: bumpListingRoute });
app.http('listing-comment', { ...anon, methods: ['POST'], route: 'listings/{id}/comments', handler: addCommentRoute });
app.http('listing-comment-react', { ...anon, methods: ['POST'], route: 'listings/{id}/comments/{commentId}/react', handler: reactToCommentRoute });
app.http('seller-follow', { ...anon, methods: ['POST'], route: 'sellers/{id}/follow', handler: toggleFollowRoute });
app.http('listing-edit', { ...anon, methods: ['POST'], route: 'listings/{id}/edit', handler: editListingRoute });
app.http('listing-delete', { ...anon, methods: ['POST'], route: 'listings/{id}/delete', handler: deleteListingRoute });
app.http('order-create', { ...anon, methods: ['POST'], route: 'orders', handler: createOrderRoute });
app.http('me-activity', { ...anon, methods: ['GET'], route: 'me/activity', handler: myActivityRoute });
app.http('me-saved', { ...anon, methods: ['GET'], route: 'me/saved', handler: mySavedRoute });
app.http('me-listings', { ...anon, methods: ['GET'], route: 'me/listings', handler: myListingsRoute });
app.http('forwarders', { ...anon, methods: ['GET'], route: 'forwarders', handler: forwardersRoute });
