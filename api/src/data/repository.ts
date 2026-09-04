import { createHash } from 'node:crypto';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import type { Listing, ListingComment, Lot, Order, User } from '../../../shared/models.js';

export interface BackendStatus {
  connected: boolean;
  database: string | null;
  /** Human-readable explanation, surfaced on the status page. */
  detail: string;
}

export interface CatalogQuery {
  sellerId?: string;
  limit?: number;
  /** Free-text match over title, description and tags. */
  search?: string;
  category?: string;
  condition?: string;
  /** 'lot' for open group-buys, 'in_stock' for stock on hand. */
  kind?: string;
  maxPriceMinor?: number;
  /** Ranks listings from followed sellers first. */
  followedSellerIds?: readonly string[];
}

/**
 * Persistence seam.
 *
 * Two implementations exist: Cosmos DB, and an in-process store used when
 * Cosmos is not configured. Handlers depend on this interface so the app is
 * runnable and demonstrable with no cloud resources attached.
 */
export interface Repository {
  readonly backend: BackendKind;

  /** Establish connections and verify reachability. Never throws; sets status. */
  init(): Promise<void>;

  status(): BackendStatus;

  getUserById(id: string): Promise<User | null>;
  /** Resolves an email or phone to its account. */
  getUserByIdentifier(identifier: string): Promise<User | null>;

  /** Creates an account, reserving both identifiers. Throws on a duplicate. */
  createUser(user: User): Promise<User>;

  /** Sign-in hints for the mock provider; empty once real auth is in use. */
  listDemoAccounts(): DemoAccount[];

  revokeSession(token: string, expiresAt: Date): Promise<void>;
  isSessionRevoked(token: string): Promise<boolean>;

  listUsersByIds(ids: readonly string[]): Promise<User[]>;
  listForwarders(): Promise<User[]>;

  listLots(query?: CatalogQuery): Promise<Lot[]>;
  getLot(sellerId: string, lotId: string): Promise<Lot | null>;
  listListings(query?: CatalogQuery): Promise<Listing[]>;

  /* Shipment batches (seller-side). */
  createLot(lot: Lot): Promise<Lot>;
  updateLot(lot: Lot): Promise<Lot>;
  /** Every listing tagged into this lot. */
  listListingsInLot(lotId: string): Promise<Listing[]>;
  /** Tags listings into a lot, or clears the tag when lotId is null. */
  assignListingsToLot(sellerId: string, listingIds: readonly string[], lotId: string | null): Promise<number>;

  getOrder(id: string): Promise<Order | null>;
  updateOrder(order: Order): Promise<Order>;

  getListing(id: string): Promise<Listing | null>;
  createListing(listing: Listing): Promise<Listing>;
  /** Pushes a listing back up the feed. Returns false when rate-limited. */
  bumpListing(sellerId: string, listingId: string): Promise<boolean>;

  /** The lot manifest: every order line in one lot. */
  listOrdersForLot(lotId: string): Promise<Order[]>;
  listOrdersForBuyer(buyerId: string): Promise<Order[]>;
  createOrder(order: Order): Promise<Order>;

  listComments(listingId: string): Promise<ListingComment[]>;
  addComment(comment: ListingComment): Promise<ListingComment>;

  /** Toggles a bookmark. Returns the resulting state. */
  toggleLike(userId: string, listingId: string): Promise<boolean>;
  listLikedListingIds(userId: string): Promise<string[]>;

  /** Toggles a follow. Returns the resulting state. */
  toggleFollow(followerId: string, sellerId: string): Promise<boolean>;
  listFollowedSellerIds(followerId: string): Promise<string[]>;
}

/** How long a seller must wait between bumps on the same listing. */
export const BUMP_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Session tokens are stored as digests, never verbatim - a revocation list is
 * not a reason to keep live credentials at rest.
 */
export function sessionDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
