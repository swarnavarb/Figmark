import { AWAITING_LOT_ID } from '../../../shared/fulfilment.js';
import { ROUTE_TEMPLATES, normaliseSteps, stepForStage, type TrackingRoute } from '../../../shared/routes.js';
import type { PostTemplate } from '../../../shared/templates.js';
import { randomUUID } from 'node:crypto';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import type {
  Dispute, Follow, Forum, Like, Listing, ListingComment, Lot, Message, Order, Pledge, Post, Notification, PowerSale, Review, StoreReview, User, Want, WantOffer, WantSeeker,
} from '../../../shared/models.js';
import { handleKey } from '../../../shared/handles.js';
import { matchesKind, matchesSearch } from '../../../shared/catalog.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { BUMP_COOLDOWN_MS, sessionDigest } from './repository.js';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PHONE,
  ESCROW_EMAIL,
  HANDLER_EMAIL,
  PACKER_EMAIL,
  seedComments,
  seedFollows,
  seedForums,
  seedLikes,
  seedListings,
  seedLotBuyers,
  seedLotOrders,
  seedLots,
  seedOpenLot,
  seedShippedLot,
  seedLiveSale,
  seedOrders,
  seedPosts,
  seedReviews,
  seedDisputes,
  seedWants,
  seedWantOffers,
  seedPledges,
  seedUsers,
} from './seed.js';

/**
 * In-process store used when Cosmos DB is not configured.
 *
 * State lives for the lifetime of the function host, so writes are not durable
 * across restarts or shared between instances. Acceptable for its only job:
 * keeping the app fully usable before credentials are wired up.
 */
export class MemoryRepository implements Repository {
  readonly backend: BackendKind = 'memory';

  private readonly users = new Map<string, User>();
  /** Normalised email/phone -> user id. Mirrors the `identifiers` container. */
  private readonly identifiers = new Map<string, string>();
  private readonly lots = new Map<string, Lot>();
  private readonly routes = new Map<string, TrackingRoute>();
  private readonly templates = new Map<string, PostTemplate>();
  private readonly listings = new Map<string, Listing>();
  private readonly orders = new Map<string, Order>();
  private readonly comments = new Map<string, ListingComment>();
  private readonly likes = new Map<string, Like>();
  private readonly follows = new Map<string, Follow>();
  private readonly posts = new Map<string, Post>();
  private readonly forums = new Map<string, Forum>();
  private readonly messages = new Map<string, Message>();
  private readonly reviews = new Map<string, Review>();
  private readonly storeReviews = new Map<string, StoreReview>();
  private readonly wants = new Map<string, Want>();
  private readonly wantOffers = new Map<string, WantOffer>();
  private readonly wantSeekers = new Map<string, WantSeeker>();
  private readonly pledges = new Map<string, Pledge>();
  private readonly powerSales = new Map<string, PowerSale>();
  private readonly notifications = new Map<string, Notification>();
  private readonly disputes = new Map<string, Dispute>();
  /** `@username` -> who holds it. Mirrors the reservations in `identifiers`. */
  private readonly handles = new Map<string, { userId: string; isStore: boolean }>();
  private readonly revokedSessions = new Map<string, number>();

  async init(): Promise<void> {
    for (const user of [...seedUsers(), ...seedLotBuyers()]) this.indexUser(user);
    for (const lot of [...seedLots(), seedOpenLot(), seedShippedLot()].map((one) => this.withSampleRoute(one))) {
      this.lots.set(lot.id, lot);
    }
    for (const listing of seedListings()) this.listings.set(listing.id, listing);
    for (const order of [...seedOrders(), seedLiveSale(), ...seedLotOrders()]) this.orders.set(order.id, order);
    for (const comment of seedComments()) this.comments.set(comment.id, comment);
    for (const like of seedLikes()) this.likes.set(likeKey(like.userId, like.listingId), like);
    for (const follow of seedFollows()) {
      this.follows.set(followKey(follow.followerId, follow.sellerId), follow);
    }
    for (const forum of seedForums()) this.forums.set(forum.id, forum);
    for (const post of seedPosts()) this.posts.set(post.id, post);
    for (const review of seedReviews()) this.reviews.set(review.id, review);
    for (const record of seedDisputes()) this.disputes.set(record.id, record);
    for (const record of seedWants()) this.wants.set(record.id, record);
    for (const record of seedWantOffers()) this.wantOffers.set(record.id, record);
    for (const record of seedPledges()) this.pledges.set(record.id, record);
  }

  private indexUser(user: User): void {
    this.users.set(user.id, user);
    for (const identifier of identifiersOf(user)) this.identifiers.set(identifier, user.id);
    // Handles are indexed alongside, so a seeded account is addressable at
    // /<username> without a separate pass to register it.
    if (user.username) this.handles.set(handleKey(user.username), { userId: user.id, isStore: false });
    if (user.sellerProfile?.username) {
      this.handles.set(handleKey(user.sellerProfile.username), { userId: user.id, isStore: true });
    }
  }

  /**
   * One saved route per seller, standing in for the fixtures until each shop
   * writes its own. Cached per seller so every one of their lots snapshots the
   * same route rather than each getting its own copy of an identical ladder,
   * and saved into `this.routes` so `GET /api/routes` shows it as a real
   * template, not just something baked into a lot.
   */
  private sampleRoutes = new Map<string, TrackingRoute>();
  private sampleRouteFor(sellerId: string): TrackingRoute {
    const existing = this.sampleRoutes.get(sellerId);
    if (existing) return existing;
    const template = ROUTE_TEMPLATES.find((entry) => entry.id === 'supplier_accumulates') ?? ROUTE_TEMPLATES[0]!;
    const now = new Date().toISOString();
    const route: TrackingRoute = {
      id: `rt_${sellerId}_sample`,
      sellerId,
      name: `${template.name} (sample)`,
      steps: normaliseSteps(template.steps),
      createdAt: now,
      updatedAt: now,
    };
    this.sampleRoutes.set(sellerId, route);
    this.routes.set(route.id, route);
    return route;
  }

  /**
   * Every seeded lot travels the one sample route, so the fixtures show a
   * real route's ladder working uniformly across lots rather than each
   * falling back to the built-in seven stages by default.
   */
  private withSampleRoute(lot: Lot): Lot {
    const sample = this.sampleRouteFor(lot.sellerId);
    const route = { routeId: sample.id, name: sample.name, steps: sample.steps };
    return { ...lot, route, currentStep: stepForStage(route, lot.stage) };
  }

  status(): BackendStatus {
    const signInAccounts = [...this.users.values()].filter((u) => u.passwordHash !== null).length;
    return {
      connected: true,
      database: null,
      detail: `In-memory store: ${signInAccounts} sign-in account, ${this.listings.size} listings, ${this.lots.size} lots. Set COSMOS_ENDPOINT to use Cosmos DB.`,
      signInAccounts,
      // Maps, not containers: nothing can be missing here.
      missingContainers: [],
    };
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async getUserByIdentifier(identifier: string): Promise<User | null> {
    const id = this.identifiers.get(normaliseIdentifier(identifier));
    return id ? (this.users.get(id) ?? null) : null;
  }

  async createUser(user: User): Promise<User> {
    for (const identifier of identifiersOf(user)) {
      if (this.identifiers.has(identifier)) {
        throw new Error(`That ${identifier.includes('@') ? 'email' : 'phone number'} is already registered.`);
      }
    }
    this.indexUser(user);
    return user;
  }

  async listUsersByIds(ids: readonly string[]): Promise<User[]> {
    return ids.map((id) => this.users.get(id)).filter((u): u is User => u !== undefined);
  }

  async listForwarders(): Promise<User[]> {
    return [...this.users.values()].filter((u) => u.forwarderProfile?.listedInDirectory);
  }

  async listTemplates(sellerId: string): Promise<PostTemplate[]> {
    return [...this.templates.values()]
      .filter((template) => template.sellerId === sellerId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getTemplate(sellerId: string, templateId: string): Promise<PostTemplate | null> {
    const template = this.templates.get(templateId);
    return template && template.sellerId === sellerId ? template : null;
  }

  async saveTemplate(template: PostTemplate): Promise<PostTemplate> {
    this.templates.set(template.id, template);
    return template;
  }

  async deleteTemplate(sellerId: string, templateId: string): Promise<boolean> {
    const template = this.templates.get(templateId);
    if (!template || template.sellerId !== sellerId) return false;
    this.templates.delete(templateId);
    return true;
  }

  async listRoutes(sellerId: string): Promise<TrackingRoute[]> {
    return [...this.routes.values()]
      .filter((route) => route.sellerId === sellerId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getRoute(sellerId: string, routeId: string): Promise<TrackingRoute | null> {
    const route = this.routes.get(routeId);
    return route && route.sellerId === sellerId ? route : null;
  }

  async saveRoute(route: TrackingRoute): Promise<TrackingRoute> {
    this.routes.set(route.id, route);
    return route;
  }

  async deleteRoute(sellerId: string, routeId: string): Promise<boolean> {
    const route = this.routes.get(routeId);
    if (!route || route.sellerId !== sellerId) return false;
    this.routes.delete(routeId);
    return true;
  }

  async listOrdersAwaitingLot(sellerId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) =>
        order.sellerId === sellerId
        && order.lotId === AWAITING_LOT_ID
        && order.status !== 'cancelled')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async moveOrderToLot(order: Order, _fromLotId: string): Promise<Order> {
    // One map keyed by id here, so the partition move Cosmos has to perform is
    // a plain write - which is exactly why the two implementations need their
    // own version of this rather than sharing `updateOrder`.
    const moved = { ...order, updatedAt: new Date().toISOString() };
    this.orders.set(moved.id, moved);
    return moved;
  }

  async listHandlers(): Promise<User[]> {
    return [...this.users.values()]
      .filter((user) => user.handlerProfile?.listedInDirectory)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  listDemoAccounts(): DemoAccount[] {
    // The accounts that can actually be signed into: the shop, the two people
    // who work its lots at either end of the water, and the escrow between.
    return [
      { identifier: DEMO_EMAIL, label: `${DEMO_PHONE} · ${DEMO_PASSWORD}` },
      { identifier: PACKER_EMAIL, label: `the supplier's packing view · ${DEMO_PASSWORD}` },
      { identifier: ESCROW_EMAIL, label: `the escrow holding the money · ${DEMO_PASSWORD}` },
      { identifier: HANDLER_EMAIL, label: `the handler getting the parcels out · ${DEMO_PASSWORD}` },
    ];
  }

  async revokeSession(token: string, expiresAt: Date): Promise<void> {
    this.revokedSessions.set(sessionDigest(token), expiresAt.getTime());
  }

  async isSessionRevoked(token: string): Promise<boolean> {
    const digest = sessionDigest(token);
    const expiry = this.revokedSessions.get(digest);
    if (expiry === undefined) return false;
    if (expiry <= Date.now()) {
      this.revokedSessions.delete(digest);
      return false;
    }
    return true;
  }

  async listLots(query: CatalogQuery = {}): Promise<Lot[]> {
    const all = [...this.lots.values()];
    const filtered = query.sellerId ? all.filter((l) => l.sellerId === query.sellerId) : all;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getLot(sellerId: string, lotId: string): Promise<Lot | null> {
    const lot = this.lots.get(lotId);
    return lot && lot.sellerId === sellerId ? lot : null;
  }

  async listListings(query: CatalogQuery = {}): Promise<Listing[]> {
    // Unlisted items are reachable by id and absent from every list: a sale
    // item is buyable from the channel post that dropped it, and nowhere else,
    // until its members' window closes. The operations console is the one
    // caller that has to see them, because it deletes what an account made.
    let items = [...this.listings.values()].filter(
      (l) => query.includeHidden || (l.status === 'active' && !l.unlisted),
    );

    if (query.sellerId) items = items.filter((l) => l.sellerId === query.sellerId);
    if (query.category) items = items.filter((l) => l.category === query.category);
    // A provided list is authoritative even when it is empty: an unknown
    // heading resolves to no categories, and must then match nothing rather
    // than everything. Silently showing the whole catalog is how a broken
    // filter looks exactly like a working one.
    if (query.categories) {
      const wanted = new Set(query.categories);
      items = items.filter((l) => wanted.has(l.category));
    }
    if (query.condition) items = items.filter((l) => l.condition === query.condition);
    // How it is sold is derived from the listing rather than stored, and the
    // rule lives in shared/catalog so the SQL and this agree by construction.
    if (query.kind && query.kind !== 'all') items = items.filter((l) => matchesKind(l, query.kind));
    if (query.maxPriceMinor !== undefined) {
      items = items.filter((l) => l.priceMinor <= query.maxPriceMinor!);
    }
    if (query.search) items = items.filter((l) => matchesSearch(l, query.search!));

    const followed = new Set(query.followedSellerIds ?? []);
    items.sort((a, b) => {
      // Followed sellers first - the seed of the personalised feed - but only
      // while the reader has not asked for an order of their own. Someone who
      // picked "cheapest first" wants the cheapest, not the cheapest among the
      // people they follow.
      if (!query.sort || query.sort === 'newest') {
        const followRank = Number(followed.has(b.sellerId)) - Number(followed.has(a.sellerId));
        if (followRank !== 0) return followRank;
      }
      switch (query.sort) {
        case 'price_asc':
          return a.priceMinor - b.priceMinor;
        case 'price_desc':
          return b.priceMinor - a.priceMinor;
        case 'popular':
          return b.likeCount - a.likeCount;
        default:
          // Recency, with a bump counting as recency.
          return freshness(b).localeCompare(freshness(a));
      }
    });

    return query.limit ? items.slice(0, query.limit) : items;
  }

  async getListing(id: string): Promise<Listing | null> {
    const listing = this.listings.get(id);
    if (!listing) return null;
    listing.viewCount += 1;
    return listing;
  }

  async createListing(listing: Listing): Promise<Listing> {
    this.listings.set(listing.id, listing);
    return listing;
  }

  async bumpListing(sellerId: string, listingId: string): Promise<boolean> {
    const listing = this.listings.get(listingId);
    if (!listing || listing.sellerId !== sellerId) return false;
    const last = listing.bumpedAt ? Date.parse(listing.bumpedAt) : 0;
    // Rate-limited so bumping cannot be used to camp the top of the feed.
    if (Date.now() - last < BUMP_COOLDOWN_MS) return false;
    listing.bumpedAt = new Date().toISOString();
    return true;
  }

  async listOrdersForLot(lotId: string): Promise<Order[]> {
    return [...this.orders.values()].filter((o) => o.lotId === lotId);
  }

  async listOrdersHeldBy(escrowAgentId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) => order.protection?.escrowAgentId === escrowAgentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listOrdersForBuyer(buyerId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => o.buyerId === buyerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listOrdersForListing(listingId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((order) => order.listingId === listingId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createOrder(order: Order): Promise<Order> {
    this.orders.set(order.id, order);
    const listing = this.listings.get(order.listingId);
    if (listing) {
      listing.quantityAvailable = Math.max(0, listing.quantityAvailable - order.quantity);
      if (listing.quantityAvailable === 0) listing.status = 'sold_out';
      // Pre-order fill is denormalised onto the listing, so it moves with the
      // order rather than being counted at read time.
      if (listing.preOrder) listing.preOrder.filledCount += order.quantity;
    }
    return order;
  }

  async getOrder(id: string): Promise<Order | null> {
    return this.orders.get(id) ?? null;
  }

  async updateOrder(order: Order): Promise<Order> {
    this.orders.set(order.id, order);
    return order;
  }

  async createLot(lot: Lot): Promise<Lot> {
    this.lots.set(lot.id, lot);
    return lot;
  }

  async updateLot(lot: Lot): Promise<Lot> {
    this.lots.set(lot.id, lot);
    return lot;
  }

  async listListingsInLot(lotId: string): Promise<Listing[]> {
    return [...this.listings.values()].filter((listing) => listing.lotId === lotId);
  }

  async assignListingsToLot(
    sellerId: string,
    listingIds: readonly string[],
    lotId: string | null,
  ): Promise<number> {
    let changed = 0;
    for (const id of listingIds) {
      const listing = this.listings.get(id);
      // Silently skip anything the caller does not own, rather than failing the
      // whole lot: the route has already checked the lot's owner.
      if (!listing || listing.sellerId !== sellerId) continue;
      listing.lotId = lotId;
      listing.updatedAt = new Date().toISOString();
      changed += 1;
    }
    return changed;
  }

  async listComments(listingId: string): Promise<ListingComment[]> {
    return [...this.comments.values()]
      .filter((c) => c.listingId === listingId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async addComment(comment: ListingComment): Promise<ListingComment> {
    this.comments.set(comment.id, comment);
    return comment;
  }

  async toggleLike(userId: string, listingId: string): Promise<boolean> {
    const key = likeKey(userId, listingId);
    const listing = this.listings.get(listingId);
    if (this.likes.delete(key)) {
      if (listing) listing.likeCount = Math.max(0, listing.likeCount - 1);
      return false;
    }
    const now = new Date().toISOString();
    this.likes.set(key, { id: randomUUID(), userId, listingId, createdAt: now, updatedAt: now });
    if (listing) listing.likeCount += 1;
    return true;
  }

  async listLikedListingIds(userId: string): Promise<string[]> {
    return [...this.likes.values()].filter((l) => l.userId === userId).map((l) => l.listingId);
  }

  async toggleFollow(followerId: string, sellerId: string): Promise<boolean> {
    const key = followKey(followerId, sellerId);
    const seller = this.users.get(sellerId);
    if (this.follows.delete(key)) {
      if (seller?.sellerProfile) {
        seller.sellerProfile.followerCount = Math.max(0, seller.sellerProfile.followerCount - 1);
      }
      return false;
    }
    const now = new Date().toISOString();
    this.follows.set(key, { id: randomUUID(), followerId, sellerId, createdAt: now, updatedAt: now });
    if (seller?.sellerProfile) seller.sellerProfile.followerCount += 1;
    return true;
  }

  async listFollowedSellerIds(followerId: string): Promise<string[]> {
    return [...this.follows.values()].filter((f) => f.followerId === followerId).map((f) => f.sellerId);
  }

  async listFollowerIds(sellerId: string): Promise<string[]> {
    return [...this.follows.values()].filter((f) => f.sellerId === sellerId).map((f) => f.followerId);
  }

  async updateUser(user: User): Promise<User> {
    this.indexUser(user);
    return user;
  }

  async getByHandle(username: string): Promise<{ user: User; isStore: boolean } | null> {
    const entry = this.handles.get(handleKey(username));
    if (!entry) return null;
    const user = this.users.get(entry.userId);
    return user ? { user, isStore: entry.isStore } : null;
  }

  async reserveHandle(username: string, userId: string, isStore: boolean): Promise<boolean> {
    const key = handleKey(username);
    const existing = this.handles.get(key);
    // Re-claiming your own handle is not a clash; somebody else's is.
    if (existing && !(existing.userId === userId && existing.isStore === isStore)) return false;
    this.handles.set(key, { userId, isStore });
    return true;
  }

  async releaseHandle(username: string): Promise<void> {
    this.handles.delete(handleKey(username));
  }

  async listMessages(threadId: string, limit = 200): Promise<Message[]> {
    return [...this.messages.values()]
      .filter((message) => message.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit);
  }

  async listMessagesForHandles(handles: readonly string[], limit = 300): Promise<Message[]> {
    const mine = new Set(handles.map((handle) => handle.toLowerCase()));
    return [...this.messages.values()]
      .filter((message) => mine.has(message.from.handle) || mine.has(message.to.handle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async sendMessage(message: Message): Promise<Message> {
    this.messages.set(message.id, message);
    return message;
  }

  async listReviewsAbout(subjectId: string): Promise<Review[]> {
    return [...this.reviews.values()]
      .filter((review) => review.subjectId === subjectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listOpenWants(options: { category?: string; limit?: number } = {}): Promise<Want[]> {
    const now = new Date().toISOString();
    return [...this.wants.values()]
      .filter((want) => want.status === 'open' && want.expiresAt > now)
      .filter((want) => !options.category || want.category === options.category)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, options.limit ?? 50);
  }

  async listWantsBy(buyerId: string): Promise<Want[]> {
    return [...this.wants.values()]
      .filter((want) => want.buyerId === buyerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getWant(id: string, _buyerId?: string): Promise<Want | null> {
    return this.wants.get(id) ?? null;
  }

  async saveWant(want: Want): Promise<Want> {
    this.wants.set(want.id, want);
    return want;
  }

  async listWantOffers(wantId: string): Promise<WantOffer[]> {
    return [...this.wantOffers.values()]
      .filter((offer) => offer.wantId === wantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveWantOffer(offer: WantOffer): Promise<WantOffer> {
    this.wantOffers.set(offer.id, offer);
    return offer;
  }

  async listWantSeekers(wantId: string): Promise<WantSeeker[]> {
    return [...this.wantSeekers.values()].filter((seeker) => seeker.wantId === wantId);
  }

  async saveWantSeeker(seeker: WantSeeker): Promise<WantSeeker> {
    this.wantSeekers.set(seeker.id, seeker);
    return seeker;
  }

  async listWantIdsSeekingBy(userId: string): Promise<string[]> {
    return [...this.wantSeekers.values()]
      .filter((seeker) => seeker.userId === userId)
      .map((seeker) => seeker.wantId);
  }

  async deleteWantSeeker(id: string): Promise<void> {
    this.wantSeekers.delete(id);
  }

  async listPledges(listingId: string): Promise<Pledge[]> {
    return [...this.pledges.values()]
      .filter((pledge) => pledge.listingId === listingId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async savePledge(pledge: Pledge): Promise<Pledge> {
    this.pledges.set(pledge.id, pledge);
    return pledge;
  }

  async deletePledge(id: string): Promise<void> {
    this.pledges.delete(id);
  }

  async listPledgedListingIds(userId: string): Promise<string[]> {
    return [...this.pledges.values()]
      .filter((pledge) => pledge.userId === userId)
      .map((pledge) => pledge.listingId);
  }

  async updateListing(listing: Listing): Promise<Listing> {
    const updated = { ...listing, updatedAt: new Date().toISOString() };
    this.listings.set(listing.id, updated);
    return updated;
  }

  async listPowerSales(sellerId: string): Promise<PowerSale[]> {
    return [...this.powerSales.values()]
      .filter((sale) => sale.sellerId === sellerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getPowerSale(sellerId: string, id: string): Promise<PowerSale | null> {
    const sale = this.powerSales.get(id);
    return sale && sale.sellerId === sellerId ? sale : null;
  }

  async savePowerSale(sale: PowerSale): Promise<PowerSale> {
    this.powerSales.set(sale.id, sale);
    return sale;
  }

  async listNotifications(userId: string, limit = 40): Promise<Notification[]> {
    return [...this.notifications.values()]
      .filter((entry) => entry.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async saveNotification(notification: Notification): Promise<Notification> {
    this.notifications.set(notification.id, notification);
    return notification;
  }

  async listStoreReviews(subjectId: string): Promise<StoreReview[]> {
    return [...this.storeReviews.values()]
      .filter((review) => review.subjectId === subjectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveStoreReview(review: StoreReview): Promise<StoreReview> {
    this.storeReviews.set(review.id, review);
    return review;
  }

  async listReviewsForOrder(orderId: string): Promise<Review[]> {
    return [...this.reviews.values()].filter((review) => review.orderId === orderId);
  }

  async createReview(review: Review): Promise<Review> {
    this.reviews.set(review.id, review);
    return review;
  }

  async updateReview(review: Review): Promise<Review> {
    this.reviews.set(review.id, review);
    return review;
  }

  async createDispute(dispute: Dispute): Promise<Dispute> {
    this.disputes.set(dispute.id, dispute);
    return dispute;
  }

  async getDispute(_orderId: string, id: string): Promise<Dispute | null> {
    return this.disputes.get(id) ?? null;
  }

  async getDisputeById(id: string): Promise<Dispute | null> {
    return this.disputes.get(id) ?? null;
  }

  async listDisputes(status?: string): Promise<Dispute[]> {
    return [...this.disputes.values()]
      .filter((dispute) => !status || dispute.status === status)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /* ── Operating the marketplace ───────────────────────────────────────── */

  async listAllUsers(): Promise<User[]> {
    return [...this.users.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listEscrowAgents(): Promise<User[]> {
    return [...this.users.values()]
      .filter((user) => user.escrowRights)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async listPostsByAuthor(authorId: string): Promise<Post[]> {
    return [...this.posts.values()]
      .filter((post) => post.authorId === authorId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteUser(id: string): Promise<void> {
    const user = this.users.get(id);
    if (!user) return;
    // Every reservation this account held goes back into circulation with it:
    // an identifier left pointing at a deleted row locks that email or handle
    // out of the marketplace forever.
    for (const identifier of identifiersOf(user)) this.identifiers.delete(identifier);
    if (user.username) this.handles.delete(handleKey(user.username));
    if (user.sellerProfile?.username) this.handles.delete(handleKey(user.sellerProfile.username));
    this.users.delete(id);
  }

  async deleteListing(_sellerId: string, id: string): Promise<void> {
    this.listings.delete(id);
  }

  async deletePost(_channelId: string, id: string): Promise<void> {
    this.posts.delete(id);
  }

  async deleteLot(_sellerId: string, id: string): Promise<void> {
    this.lots.delete(id);
  }

  async deleteReview(_subjectId: string, id: string): Promise<void> {
    this.reviews.delete(id);
  }

  async updateDispute(dispute: Dispute): Promise<Dispute> {
    this.disputes.set(dispute.id, dispute);
    return dispute;
  }

  async markThreadRead(threadId: string, handle: string): Promise<number> {
    const now = new Date().toISOString();
    let changed = 0;
    for (const message of this.messages.values()) {
      if (message.threadId !== threadId) continue;
      if (message.to.handle !== handle.toLowerCase() || message.readAt) continue;
      message.readAt = now;
      changed += 1;
    }
    return changed;
  }

  async listStoreOwners(): Promise<User[]> {
    return [...this.users.values()].filter((user) => user.sellerProfile !== null);
  }

  async listOrdersForSeller(sellerId: string): Promise<Order[]> {
    return [...this.orders.values()].filter((order) => order.sellerId === sellerId);
  }

  async listPosts(channelId: string, limit = 50): Promise<Post[]> {
    return [...this.posts.values()]
      .filter((post) => post.channelId === channelId)
      .sort(newestFirst)
      .slice(0, limit);
  }

  async listPostsForChannels(channelIds: readonly string[], limit = 60): Promise<Post[]> {
    const wanted = new Set(channelIds);
    return [...this.posts.values()]
      .filter((post) => wanted.has(post.channelId))
      .sort(newestFirst)
      .slice(0, limit);
  }

  async createPost(post: Post): Promise<Post> {
    this.posts.set(post.id, post);
    const forum = this.forums.get(post.channelId);
    if (forum) forum.postCount += 1;
    return post;
  }

  async listForums(): Promise<Forum[]> {
    return [...this.forums.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getForum(id: string): Promise<Forum | null> {
    return this.forums.get(id) ?? null;
  }

  async createForum(forum: Forum): Promise<Forum> {
    this.forums.set(forum.id, forum);
    return forum;
  }
}

/** Newest first, by creation time. */
const newestFirst = (a: Post, b: Post) => (a.createdAt < b.createdAt ? 1 : -1);

/** A bump counts as recency without rewriting createdAt. */
function freshness(listing: Listing): string {
  return listing.bumpedAt && listing.bumpedAt > listing.createdAt ? listing.bumpedAt : listing.createdAt;
}

export function normaliseIdentifier(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  // Phone numbers are compared without spacing or punctuation.
  return trimmed.includes('@') ? trimmed : trimmed.replace(/[\s()-]/g, '');
}

export function identifiersOf(user: User): string[] {
  const values = [user.email, user.phone].filter((v): v is string => Boolean(v));
  return values.map(normaliseIdentifier);
}

const likeKey = (userId: string, listingId: string) => `${userId}::${listingId}`;
const followKey = (followerId: string, sellerId: string) => `${followerId}::${sellerId}`;

export { DEMO_EMAIL, DEMO_PASSWORD, DEMO_PHONE, ESCROW_EMAIL, HANDLER_EMAIL, PACKER_EMAIL };
