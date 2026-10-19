import { createHash } from 'node:crypto';
import type { TrackingRoute } from '../../../shared/routes.js';
import type { StoreKind } from '../../../shared/service-stores.js';
import type { PostTemplate } from '../../../shared/templates.js';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import type {
  ClientDevice,
  Dispute, Follow, Forum, SiteContent, Like, Listing, ListingComment, Lot, Message, Order, Pledge, Post, Notification, PowerSale, Review, StoreReview, User, Want, WantOffer, WantSeeker,
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
  /** The most an item may cost, in paise. Absent, zero or less means no ceiling. */
  maxPriceMinor?: number;
}

/**
 * Persistence seam.
 *
 * Two implementations exist: Cosmos DB, and an in-process store used when
 * Cosmos is not configured. Handlers depend on this interface so the app is
 * runnable and demonstrable with no cloud resources attached.
 */
/** What `listOrderFiguresForSeller` reads of each order. */
export const ORDER_FIGURE_FIELDS = [
  'id', 'lotId', 'sellerId', 'buyerId', 'listingId', 'status', 'paymentStatus', 'hold', 'completedAt',
  'protection', 'credits', 'accepted', 'paymentClaim', 'reversal', 'bookingOnly', 'payments', 'detailsCheck',
  'placedAt', 'receivedAt', 'createdAt', 'updatedAt', 'quantity', 'unitPriceMinor', 'currency', 'checkpoints',
] as const;
export type OrderFigures = Pick<Order, (typeof ORDER_FIGURE_FIELDS)[number]>;

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
  /**
   * Adds `by` to a counter shared by every instance, which expires
   * `ttlSeconds` after it was first counted, and returns the new total. `by`
   * of 0 reads it without creating it. Null when the store keeps no shared
   * counters - the in-memory one, which is one instance anyway.
   */
  bumpCounter(id: string, by: number, ttlSeconds: number): Promise<number | null>;

  listUsersByIds(ids: readonly string[]): Promise<User[]>;
  /**
   * Only what a seller card shows, for many accounts at once. The feed draws a
   * card per listing, and the whole account - its sign-in, its game, its
   * settings - was read for each just to name the shop.
   */
  listSellerCardsByIds(ids: readonly string[]): Promise<SellerCardSource[]>;
  listForwarders(): Promise<User[]>;
  listHandlers(): Promise<User[]>;

  listLots(query?: CatalogQuery): Promise<Lot[]>;
  getLot(sellerId: string, lotId: string): Promise<Lot | null>;
  /**
   * Every lot, in any shop, that names this account as its forwarder, handler
   * or supplier. One query across shops, rather than reading each shop's lots
   * in turn - which grew with the whole platform on every crew page open.
   */
  listLotsNaming(userId: string): Promise<Lot[]>;

  /** The Quick Fill templates a shop lists from. */
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
  /**
   * Tags listings into a lot, or clears the tag when lotId is null. Sourcing
   * moves with it: into a lot is an import, out of one is back in hand.
   */
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
   * Every seller-facing list here - by seller, lot, listing, awaiting a lot -
   * leaves checkouts out: pressing Buy is not an order.
   */
  createOrder(order: Order): Promise<Order>;
  /**
   * Moves stock and pre-order fill for a checkout the buyer has just placed.
   * False when there is not enough left - checked in the same write, so two
   * buyers cannot both take the last one.
   */
  takeStock(order: Order): Promise<boolean>;
  /** Removes an order outright. Only for a cart item, which holds no stock. */
  deleteOrder(order: Order): Promise<void>;
  /** One more look at a listing's page. */
  countView(listing: Listing): Promise<void>;
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
   * Change one listing against what is stored at the moment of writing.
   *
   * `change` is handed the current listing and may be run more than once: if
   * somebody else (a buyer taking stock) wrote it in between, it is read again
   * and the change redone on top, so their write is never undone. Returning
   * null refuses, and nothing is written; null comes back for that or for a
   * listing that is gone.
   */
  changeListing(id: string, sellerId: string, change: (listing: Listing) => Listing | null): Promise<Listing | null>;
  /**
   * A shop's scheduled sales, newest first.
   *
   * One partition. Read by the shop's own console, which advances what it
   * reads, as well as by the clock below.
   */
  listPowerSales(sellerId: string): Promise<PowerSale[]>;
  /**
   * Every sale still to run or running, across all shops, for the clock that
   * advances them whether or not anybody has the console open.
   */
  listLivePowerSales(): Promise<PowerSale[]>;
  getPowerSale(sellerId: string, id: string): Promise<PowerSale | null>;
  savePowerSale(sale: PowerSale): Promise<PowerSale>;
  /** Everything waiting for one person, newest first. */
  /** Newest first; with `before`, only those written before that moment - the next page. */
  listNotifications(userId: string, limit?: number, before?: string): Promise<Notification[]>;
  saveNotification(notification: Notification): Promise<Notification>;
  deleteNotification(userId: string, id: string): Promise<void>;
  /**
   * How many notices one person has and when the newest write to any of them
   * landed, in whole seconds: enough for the bell to tell "nothing changed"
   * from one small read instead of filling a page.
   */
  notificationStamp(userId: string): Promise<{ count: number; lastWriteAt: number }>;
  /**
   * Held notices whose hold ended between `from` and `until`, not yet sent to
   * anybody's devices and not taken back - across everybody, for the clock
   * that sends them. Bounded below so a notice from before push existed is
   * never sent late.
   */
  listHeldNotificationsDue(from: string, until: string): Promise<Notification[]>;
  /** Accounts holding this push endpoint: a browser belongs to whoever signed in on it last. */
  listUsersByPushEndpoint(endpoint: string): Promise<User[]>;
  /** Every account's reported devices, for the operators' install figures. */
  listClientDevices(): Promise<Array<{ id: string; clientDevices: ClientDevice[] }>>;
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
  /**
   * Saves only if the stored copy is still at `expectedVersion`; null when
   * somebody else wrote in between. The caller sets the new version.
   */
  saveDisputeIfVersion(dispute: Dispute, expectedVersion: number): Promise<Dispute | null>;
  /** The mediation queue: everything the company has been asked to settle. */
  listDisputes(status?: string): Promise<Dispute[]>;
  /** Every dispute in one partition: one order's, or one subject's. */
  listDisputesForOrder(orderId: string): Promise<Dispute[]>;
  /** Every dispute a person is a party to, either end. */
  listDisputesForParty(userId: string): Promise<Dispute[]>;
  /** Every dispute a community manager has held a round of. */
  listDisputesForManager(managerId: string): Promise<Dispute[]>;

  /* ── Operating the marketplace ───────────────────────────────────────── */

  /**
   * Every account. Reads every user document whole, so nothing a visitor can
   * reach calls it: those use the narrower reads below.
   */
  listAllUsers(): Promise<User[]>;
  /** One page of accounts, newest first, optionally matching a search - the admin list. `total` is everyone. */
  pageUsers(options: { search?: string; limit: number; cursor?: string | null }): Promise<{ users: User[]; next: string | null; total: number }>;
  /** The account whose store of this kind lives at this directory slug, by index rather than by scan. */
  findStoreBySlug(kind: StoreKind, slug: string): Promise<User | null>;
  /** Accounts holding a service store of this kind - or of any kind - in whatever state it is. */
  listServiceStoreOwners(kind?: StoreKind): Promise<User[]>;
  /** The top collectors by cached XP, suspended accounts left out, and how many are ranked at all. */
  questLeaders(limit: number): Promise<{ top: User[]; total: number }>;
  /** How many ranked accounts have more XP than this. */
  questRankAbove(xp: number): Promise<number>;
  /** People and shops whose name or handle contains `needle` (lower case), at most `limit`. */
  searchUsers(needle: string, limit: number): Promise<User[]>;
  /**
   * Every photo name any record still mentions, lower-cased.
   *
   * Read as text across every container, so a photo counts as used wherever it
   * turns up - a listing, an order, a post, a collection card, a message -
   * without this having to know which field holds which. Slow, and meant to be:
   * only the operator's unused-photo scan calls it.
   */
  blobReferences(): Promise<Set<string>>;
  /**
   * Everyone the company has approved to hold money.
   *
   * Read at checkout, so it is on the buyer's path: a handful of vetted people,
   * which is the size that makes a scan the right answer.
   */
  listManagers(): Promise<User[]>;
  /** Everything one account has made, for the admin's view of them. */
  listPostsByAuthor(authorId: string): Promise<Post[]>;
  deleteUser(id: string): Promise<void>;
  deleteListing(sellerId: string, id: string): Promise<void>;
  deletePost(channelId: string, id: string): Promise<void>;
  deleteLot(sellerId: string, id: string): Promise<void>;
  deleteReview(subjectId: string, id: string): Promise<void>;

  listComments(listingId: string): Promise<ListingComment[]>;
  addComment(comment: ListingComment): Promise<ListingComment>;
  updateComment(comment: ListingComment): Promise<ListingComment>;

  /** Toggles a bookmark. Returns the resulting state. */
  toggleLike(userId: string, listingId: string): Promise<boolean>;
  listLikedListingIds(userId: string): Promise<string[]>;
  /** Every save one person has made, with when - one partition. */
  listLikesBy(userId: string): Promise<Like[]>;

  /** Toggles a follow. Returns the resulting state. */
  toggleFollow(followerId: string, sellerId: string): Promise<boolean>;
  listFollowedSellerIds(followerId: string): Promise<string[]>;
  /** Every follow one person has made, with when - one partition. */
  listFollowsBy(followerId: string): Promise<Follow[]>;
  /**
   * Who follows one shop.
   *
   * The reverse of the read `follows` is partitioned for, so it is
   * cross-partition and bounded by a shop's follower count rather than by how
   * many follows exist. Read when the shop has something to tell them, which is
   * rare and deliberate - not on any page render.
   */
  listFollowerIds(sellerId: string): Promise<string[]>;
  /**
   * Everybody who placed an order with this shop since a date, once each.
   * The ids alone: told when the shop starts a game, as its followers are.
   */
  listBuyerIdsForSeller(sellerId: string, since: string): Promise<string[]>;
  /** Who follows this shop or person, with when they started. */
  listFollowsOf(sellerId: string): Promise<Follow[]>;

  /** A page the operators write (the Learn guide), or null before anybody has saved one. */
  getSiteContent(id: string): Promise<SiteContent | null>;
  saveSiteContent(content: SiteContent): Promise<SiteContent>;
  /** Read, change and write back one document without losing a write made in between. */
  mutateSiteContent(id: string, change: (current: SiteContent | null) => SiteContent): Promise<SiteContent>;
  deleteSiteContent(id: string): Promise<void>;
  /** Every site-content document whose id falls in [from, to) - a log's periods, say. */
  listSiteContentRange(from: string, to: string): Promise<SiteContent[]>;

  /** Saves an edited account - the storefront editor is the only caller. */
  updateUser(user: User): Promise<User>;

  /** Every account that has opened a store, for resolving who manages what. */
  listStoreOwners(): Promise<User[]>;
  /**
   * The stores that name this account among their managers.
   *
   * Filtered by the database rather than by reading every store and checking
   * each one, which grew with the whole platform on every Sell tab open.
   */
  listStoresManagedBy(userId: string): Promise<User[]>;

  /** Resolves a username to the account behind it, and whether it is a store. */
  getByHandle(username: string): Promise<{ user: User; isStore: boolean } | null>;
  /** Claims a username. Returns false when somebody already holds it. */
  reserveHandle(username: string, userId: string, isStore: boolean): Promise<boolean>;
  /** Gives one up, so a rename does not strand the old handle. */
  releaseHandle(username: string): Promise<void>;
  /**
   * Moves an account to a new phone number, which is also a sign-in identifier.
   * Reserves the new one first, so a number somebody else holds is refused
   * (false) with nothing changed; the old one is released after.
   */
  changePhone(user: User, phone: string): Promise<boolean>;

  /* Messages. */

  /**
   * Oldest first. `before` pages back: messages written at or before that time -
   * at, so two sent in the same millisecond are not lost at a page edge; the
   * caller drops the ones it already has.
   */
  listMessages(threadId: string, limit?: number, before?: string): Promise<Message[]>;
  /** Every message touching any of these handles, for the inbox. */
  listMessagesForHandles(handles: readonly string[], limit?: number): Promise<Message[]>;
  sendMessage(message: Message): Promise<Message>;
  /** Writes a message back, for reactions. */
  updateMessage(message: Message): Promise<Message>;
  /** Removes one message from its thread. */
  deleteMessage(threadId: string, id: string): Promise<void>;
  /**
   * Removes every message whose two ends are one account - an owner and their
   * own shop. Returns how many went.
   */
  deleteSelfMessages(): Promise<number>;
  /** Marks everything addressed to `handle` in this thread as read. */
  markThreadRead(threadId: string, handle: string): Promise<number>;

  /** Every order a seller has taken, for the tracking and analytics views. */
  listOrdersForSeller(sellerId: string): Promise<Order[]>;
  /**
   * The same orders, as only the fields totals and to-do counts read - none
   * of the timeline, photos or shipment that make an order heavy. For screens
   * that count the book rather than draw it.
   */
  listOrderFiguresForSeller(sellerId: string): Promise<OrderFigures[]>;
  /**
   * One shop's placed orders filed under one lot id - a single partition. For
   * the sentinels (direct sales, awaiting a lot), which every shop shares, so
   * reading the whole partition would read everybody's.
   */
  listSellerOrdersIn(lotId: string, sellerId: string): Promise<Order[]>;
  /** Every order carrying a commission with this artist, newest first. */
  listOrdersCommissionedFrom(artistId: string): Promise<Order[]>;

  /* Social. */

  /** One channel or forum, newest first. */
  listPosts(channelId: string, limit?: number): Promise<Post[]>;
  /** The feed: posts across many channels, newest first. */
  /**
   * Newest first across several channels. `before` pages back; `feedOnly`
   * leaves out messages that stay in their room, so they cannot crowd a feed
   * page out.
   */
  listPostsForChannels(
    channelIds: readonly string[], limit?: number, options?: { before?: string; feedOnly?: boolean },
  ): Promise<Post[]>;
  createPost(post: Post): Promise<Post>;
  getPost(channelId: string, id: string): Promise<Post | null>;
  /**
   * The newest posts anywhere, for trending.
   *
   * Cross-partition by nature and bounded by `limit`: trending ranks a
   * recent window, it never needs the whole history.
   */
  listRecentPosts(limit: number): Promise<Post[]>;
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
  /** Writes a forum back, for joining and leaving. */
  saveForum(forum: Forum): Promise<Forum>;
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

/** The parts of an account a public seller card is drawn from. */
export type SellerCardSource = Pick<User, 'id' | 'displayName' | 'createdAt' | 'sellerProfile' | 'sellerTrust'>;
