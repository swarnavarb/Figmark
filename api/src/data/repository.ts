import { createHash } from 'node:crypto';
import type { TrackingRoute } from '../../../shared/routes.js';
import type { PostTemplate } from '../../../shared/templates.js';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import type {
  Dispute, Forum, Like, Listing, ListingComment, Lot, Message, Order, Pledge, Post, Notification, PowerSale, Review, StoreReview, User, Want, WantOffer, WantSeeker,
} from '../../../shared/models.js';

export interface BackendStatus {
  connected: boolean;
  database: string | null;
  /** Human-readable explanation, surfaced on the status page. */
  detail: string;
  /**
   * How many accounts in this store can be signed into.
   *
   * Zero is the difference between "that password is wrong" and "this database
   * has no accounts in it yet", which are the same answer to a user typing
   * correct credentials and a very different thing to fix. Null when the store
   * could not be asked.
   */
  signInAccounts: number | null;
  /**
   * Containers the schema declares that the store does not hold.
   *
   * Every feature reading one of these answers 500 and says nothing about why -
   * which is exactly how a missing `messages` container cost two rounds of
   * guessing from the outside. Empty is the healthy case; null means the store
   * has no such concept.
   */
  missingContainers: string[] | null;
}

export interface CatalogQuery {
  sellerId?: string;
  limit?: number;
  /** Free-text match over title, description and tags. */
  search?: string;
  category?: string;
  /**
   * Several categories at once, which is what a broad heading resolves to.
   *
   * Separate from `category` rather than replacing it because they answer
   * different questions - one chip is "sneakers", one heading is "sneakers and
   * streetwear" - and a caller that means one should not have to wrap it in an
   * array to say so.
   */
  categories?: readonly string[];
  condition?: string;
  /** See CATALOG_KINDS: how it is sold, not what it is. */
  kind?: string;
  /** See CATALOG_SORTS. Absent means newest first. */
  sort?: string;
  /**
   * Everything this seller has, whatever state it is in.
   *
   * For the operations console, which has to see what an account actually holds
   * before deleting it. Every other caller wants the catalog: active, and not
   * hidden behind a members' window. Deleting an account by way of a filtered
   * list is how a row outlives the account that made it.
   */
  includeHidden?: boolean;
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
  listHandlers(): Promise<User[]>;

  listLots(query?: CatalogQuery): Promise<Lot[]>;
  getLot(sellerId: string, lotId: string): Promise<Lot | null>;

  /** The Quick Post templates a shop lists from. */
  listTemplates(sellerId: string): Promise<PostTemplate[]>;
  getTemplate(sellerId: string, templateId: string): Promise<PostTemplate | null>;
  saveTemplate(template: PostTemplate): Promise<PostTemplate>;
  deleteTemplate(sellerId: string, templateId: string): Promise<boolean>;

  /** The route templates a shop has written. */
  listRoutes(sellerId: string): Promise<TrackingRoute[]>;
  getRoute(sellerId: string, routeId: string): Promise<TrackingRoute | null>;
  saveRoute(route: TrackingRoute): Promise<TrackingRoute>;
  deleteRoute(sellerId: string, routeId: string): Promise<boolean>;

  /** Sold, bound for a lot, not yet in one. */
  listOrdersAwaitingLot(sellerId: string): Promise<Order[]>;
  /**
   * Move an order into a lot.
   *
   * Its own method because `lotId` is the partition key: a replace would write
   * into a partition the document is not in, so this is a create in the new one
   * and a delete from the old.
   */
  moveOrderToLot(order: Order, fromLotId: string): Promise<Order>;
  listListings(query?: CatalogQuery): Promise<Listing[]>;

  /* Shipment lots (seller-side). */
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
  /**
   * Every order against one listing.
   *
   * Cross-partition - orders live under their shipment lot - and bounded by
   * how many people bought one item, not by how many orders exist. Read to
   * draw a pre-order's roster, which is the one place the buyers of a single
   * listing are shown as a group.
   */
  listOrdersForListing(listingId: string): Promise<Order[]>;
  /**
   * Writes an order. One already placed moves stock and pre-order fill at
   * once; a checkout (`placedAt: null`) moves nothing until `takeStock`.
   *
   * Every seller-facing list here - by seller, lot, listing, awaiting a lot,
   * held by an escrow - leaves checkouts out: pressing Buy is not an order.
   */
  createOrder(order: Order): Promise<Order>;
  /** Moves stock and pre-order fill for a checkout the buyer has just placed. */
  takeStock(order: Order): Promise<void>;
  /** A seller's checkouts nobody went ahead with - for insights, never for the order book. */
  listCheckoutDrafts(sellerId: string): Promise<Order[]>;
  /** Every save of any of these items. */
  listLikesForListings(listingIds: readonly string[]): Promise<Like[]>;

  /**
   * Reviews written about one person, newest first.
   *
   * Includes the hidden ones: whether a review may be shown is decided by the
   * caller from the pair, not stored per row, so the store hands over both and
   * the rule stays in one place.
   */
  listReviewsAbout(subjectId: string): Promise<Review[]>;
  /**
   * Opinions left on somebody's page, newest first.
   *
   * Never merged with `listReviewsAbout`: those are earned by a completed
   * trade, these are not, and the whole value of the first number is that the
   * second cannot move it.
   */
  /**
   * The board: open hunts, newest first.
   *
   * Cross-partition, like the catalog, and bounded - a seller scanning for
   * demand reads the recent end of it, not all of history.
   */
  listOpenWants(options?: { category?: string; limit?: number }): Promise<Want[]>;
  listWantsBy(buyerId: string): Promise<Want[]>;
  getWant(id: string, buyerId: string): Promise<Want | null>;
  saveWant(want: Want): Promise<Want>;
  listWantOffers(wantId: string): Promise<WantOffer[]>;
  /** Everybody who put their name to a hunt: to count them, and to tell them. */
  listWantSeekers(wantId: string): Promise<WantSeeker[]>;
  saveWantSeeker(seeker: WantSeeker): Promise<WantSeeker>;
  /**
   * Every hunt this person has put their name to.
   *
   * One query rather than a partition read per card: the board needs to know
   * which of fifty rows the reader is already on, and asking fifty times is
   * fifty times too many.
   */
  listWantIdsSeekingBy(userId: string): Promise<string[]>;
  deleteWantSeeker(id: string, wantId: string): Promise<void>;
  /**
   * Everyone who has pledged to one pre-order.
   *
   * Read to draw the meter, to name the roster, and to call the pledges in the
   * moment it fills - all three want the whole set, which is one partition.
   */
  listPledges(listingId: string): Promise<Pledge[]>;
  savePledge(pledge: Pledge): Promise<Pledge>;
  deletePledge(id: string, listingId: string): Promise<void>;
  /**
   * The listing ids this person has pledged to.
   *
   * One query rather than a partition read per card, for the same reason as
   * `listWantIdsSeekingBy`: the feed needs to know which of fifty cards the
   * reader is already in, and asking fifty times is fifty times too many.
   */
  listPledgedListingIds(userId: string): Promise<string[]>;
  /**
   * Rewrite one listing, whole.
   *
   * One way to write a listing after it exists, because several would drift:
   * this was `updatePreOrder` and the in-memory version copied only the
   * pre-order block across, so a price change made through it was written on
   * Cosmos and silently dropped in every test.
   */
  updateListing(listing: Listing): Promise<Listing>;
  /**
   * A shop's scheduled sales, newest first.
   *
   * One partition. The runner that posts them reads the same list, because
   * there is no scheduler here: a sale is advanced by somebody looking at it.
   */
  listPowerSales(sellerId: string): Promise<PowerSale[]>;
  getPowerSale(sellerId: string, id: string): Promise<PowerSale | null>;
  savePowerSale(sale: PowerSale): Promise<PowerSale>;
  /** Everything waiting for one person, newest first. */
  listNotifications(userId: string, limit?: number): Promise<Notification[]>;
  saveNotification(notification: Notification): Promise<Notification>;
  saveWantOffer(offer: WantOffer): Promise<WantOffer>;
  listStoreReviews(subjectId: string): Promise<StoreReview[]>;
  saveStoreReview(review: StoreReview): Promise<StoreReview>;
  /** Both sides' reviews of one order — at most two, and usually fewer. */
  listReviewsForOrder(orderId: string): Promise<Review[]>;
  createReview(review: Review): Promise<Review>;
  updateReview(review: Review): Promise<Review>;

  createDispute(dispute: Dispute): Promise<Dispute>;
  getDispute(orderId: string, id: string): Promise<Dispute | null>;
  /** By id alone, for a link into one: the order it belongs to is on the row. */
  getDisputeById(id: string): Promise<Dispute | null>;
  updateDispute(dispute: Dispute): Promise<Dispute>;
  /** The mediation queue: everything the company has been asked to settle. */
  listDisputes(status?: string): Promise<Dispute[]>;

  /* ── Operating the marketplace ───────────────────────────────────────── */

  /** Every account, for the admin list. Bounded by how many people signed up. */
  listAllUsers(): Promise<User[]>;
  /**
   * Everyone the company has approved to hold money.
   *
   * Read at checkout, so it is on the buyer's path: a handful of vetted people,
   * which is the size that makes a scan the right answer.
   */
  listEscrowAgents(): Promise<User[]>;
  /** Everything one account has made, for the admin's view of them. */
  listPostsByAuthor(authorId: string): Promise<Post[]>;
  deleteUser(id: string): Promise<void>;
  deleteListing(sellerId: string, id: string): Promise<void>;
  deletePost(channelId: string, id: string): Promise<void>;
  deleteLot(sellerId: string, id: string): Promise<void>;
  deleteReview(subjectId: string, id: string): Promise<void>;

  listComments(listingId: string): Promise<ListingComment[]>;
  addComment(comment: ListingComment): Promise<ListingComment>;

  /** Toggles a bookmark. Returns the resulting state. */
  toggleLike(userId: string, listingId: string): Promise<boolean>;
  listLikedListingIds(userId: string): Promise<string[]>;

  /** Toggles a follow. Returns the resulting state. */
  toggleFollow(followerId: string, sellerId: string): Promise<boolean>;
  listFollowedSellerIds(followerId: string): Promise<string[]>;
  /**
   * Who follows one shop.
   *
   * The reverse of the read `follows` is partitioned for, so it is
   * cross-partition and bounded by a shop's follower count rather than by how
   * many follows exist. Read when the shop has something to tell them, which is
   * rare and deliberate - not on any page render.
   */
  listFollowerIds(sellerId: string): Promise<string[]>;

  /** Saves an edited account - the storefront editor is the only caller. */
  updateUser(user: User): Promise<User>;

  /** Every account that has opened a store, for resolving who manages what. */
  listStoreOwners(): Promise<User[]>;

  /** Resolves a username to the account behind it, and whether it is a store. */
  getByHandle(username: string): Promise<{ user: User; isStore: boolean } | null>;
  /** Claims a username. Returns false when somebody already holds it. */
  reserveHandle(username: string, userId: string, isStore: boolean): Promise<boolean>;
  /** Gives one up, so a rename does not strand the old handle. */
  releaseHandle(username: string): Promise<void>;

  /* Messages. */

  listMessages(threadId: string, limit?: number): Promise<Message[]>;
  /** Every message touching any of these handles, for the inbox. */
  listMessagesForHandles(handles: readonly string[], limit?: number): Promise<Message[]>;
  sendMessage(message: Message): Promise<Message>;
  /** Marks everything addressed to `handle` in this thread as read. */
  markThreadRead(threadId: string, handle: string): Promise<number>;

  /** Every order a seller has taken, for the tracking and analytics views. */
  listOrdersForSeller(sellerId: string): Promise<Order[]>;
  /** Everything one escrow is holding, or has held. */
  listOrdersHeldBy(escrowAgentId: string): Promise<Order[]>;

  /* Social. */

  /** One channel or forum, newest first. */
  listPosts(channelId: string, limit?: number): Promise<Post[]>;
  /** The feed: posts across many channels, newest first. */
  listPostsForChannels(channelIds: readonly string[], limit?: number): Promise<Post[]>;
  createPost(post: Post): Promise<Post>;
  getPost(channelId: string, id: string): Promise<Post | null>;
  /**
   * Change one post in place: react, comment, vote, count a share.
   *
   * A read-change-write rather than a save, because two people reacting in
   * the same second are both reacting - the store retries the change against
   * whatever landed first instead of letting the second write erase the first.
   * `change` returns the new post, or null to leave it alone. Null back when
   * there is no such post.
   */
  mutatePost(channelId: string, id: string, change: (post: Post) => Post | null): Promise<Post | null>;

  listForums(): Promise<Forum[]>;
  getForum(id: string): Promise<Forum | null>;
  createForum(forum: Forum): Promise<Forum>;
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
