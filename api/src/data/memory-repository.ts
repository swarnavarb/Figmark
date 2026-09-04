import { randomUUID } from 'node:crypto';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import type { Follow, Like, Listing, ListingComment, Lot, Order, User } from '../../../shared/models.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { BUMP_COOLDOWN_MS, sessionDigest } from './repository.js';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PHONE,
  seedComments,
  seedFollows,
  seedLikes,
  seedListings,
  seedLots,
  seedOrders,
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
  private readonly listings = new Map<string, Listing>();
  private readonly orders = new Map<string, Order>();
  private readonly comments = new Map<string, ListingComment>();
  private readonly likes = new Map<string, Like>();
  private readonly follows = new Map<string, Follow>();
  private readonly revokedSessions = new Map<string, number>();

  async init(): Promise<void> {
    for (const user of seedUsers()) this.indexUser(user);
    for (const lot of seedLots()) this.lots.set(lot.id, lot);
    for (const listing of seedListings()) this.listings.set(listing.id, listing);
    for (const order of seedOrders()) this.orders.set(order.id, order);
    for (const comment of seedComments()) this.comments.set(comment.id, comment);
    for (const like of seedLikes()) this.likes.set(likeKey(like.userId, like.listingId), like);
    for (const follow of seedFollows()) {
      this.follows.set(followKey(follow.followerId, follow.sellerId), follow);
    }
  }

  private indexUser(user: User): void {
    this.users.set(user.id, user);
    for (const identifier of identifiersOf(user)) this.identifiers.set(identifier, user.id);
  }

  status(): BackendStatus {
    const signInAccounts = [...this.users.values()].filter((u) => u.passwordHash !== null).length;
    return {
      connected: true,
      database: null,
      detail: `In-memory store: ${signInAccounts} sign-in account, ${this.listings.size} listings, ${this.lots.size} lots. Set COSMOS_ENDPOINT to use Cosmos DB.`,
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

  listDemoAccounts(): DemoAccount[] {
    // Only the one account that can actually be signed into.
    return [{ identifier: DEMO_EMAIL, label: `${DEMO_PHONE} · ${DEMO_PASSWORD}` }];
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
    let items = [...this.listings.values()].filter((l) => l.status === 'active');

    if (query.sellerId) items = items.filter((l) => l.sellerId === query.sellerId);
    if (query.category) items = items.filter((l) => l.category === query.category);
    if (query.condition) items = items.filter((l) => l.condition === query.condition);
    // "pre-order" and "in stock" are now derived, not a stored kind.
    if (query.kind === 'pre_order') items = items.filter((l) => l.preOrder !== null);
    if (query.kind === 'in_stock') items = items.filter((l) => l.preOrder === null);
    if (query.maxPriceMinor !== undefined) {
      items = items.filter((l) => l.priceMinor <= query.maxPriceMinor!);
    }
    if (query.search) items = items.filter((l) => matchesSearch(l, query.search!));

    const followed = new Set(query.followedSellerIds ?? []);
    items.sort((a, b) => {
      // Followed sellers first - the seed of the personalised feed. Everything
      // else falls back to recency, with a bump counting as recency.
      const followRank = Number(followed.has(b.sellerId)) - Number(followed.has(a.sellerId));
      if (followRank !== 0) return followRank;
      return freshness(b).localeCompare(freshness(a));
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

  async listOrdersForBuyer(buyerId: string): Promise<Order[]> {
    return [...this.orders.values()]
      .filter((o) => o.buyerId === buyerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      // whole batch: the route has already checked the lot's owner.
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
}

/** A bump counts as recency without rewriting createdAt. */
function freshness(listing: Listing): string {
  return listing.bumpedAt && listing.bumpedAt > listing.createdAt ? listing.bumpedAt : listing.createdAt;
}

function matchesSearch(listing: Listing, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [listing.title, listing.description, listing.category, ...listing.tags]
    .join(' ')
    .toLowerCase();
  // Every word must appear somewhere, so extra words narrow rather than widen.
  return needle.split(/\s+/).every((word) => haystack.includes(word));
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

export { DEMO_EMAIL, DEMO_PASSWORD, DEMO_PHONE };
