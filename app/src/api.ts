import type {
  ApiError,
  AuthUser,
  DemoAccount,
  HealthResponse,
  LoginResponse,
  MeResponse,
} from '@shared/contracts';
import type { FulfilmentStage, OrderCheckpoint, Sourcing, StorePermission } from '@shared/enums';
import type { LotTally } from '@shared/board';
import type { StoreAccess } from '@shared/stores';
import type { OrderAction, OrderSide } from '@shared/orders';
import type { DisputeAction } from '@shared/disputes';

/** Somebody named on a screen, and the page their name opens. */
export interface PartyRef {
  name: string;
  handle: string | null;
}

/** Evidence as the form collects it: a link and a caption. */
export interface EvidenceDraft {
  url: string;
  caption: string;
}
import type {
  Dispute, EscrowRights, Forum, ForwarderProfile, Listing, ListingComment, Lot, Message, MessageParty,
  Order, PaymentClaim, Post, Review, SellerPaymentDetails, SellerProfile, StoreManager,
} from '@shared/models';

/**
 * Typed client for the Functions API. Response types come from the shared
 * contracts, so a server change this code does not handle fails the build.
 */

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Called when the server rejects our session on any authenticated call.
 *
 * A token the server will not accept is not an error to display on the page -
 * it means we are not signed in and did not notice. Left unhandled it strands
 * the user on a screen repeating "Authentication required" with no way out.
 */
let onSessionRejected: (() => void) | null = null;

export function setSessionRejectedHandler(handler: (() => void) | null): void {
  onSessionRejected = handler;
}

/** Endpoints where a 401 is a normal answer rather than a lost session. */
const EXPECTS_401 = ['/auth/me', '/auth/login', '/auth/signup'];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiRequestError(0, 'network_error', `Could not reach the API at /api${path}.`);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    if (response.status === 401 && !EXPECTS_401.some((prefix) => path.startsWith(prefix))) {
      onSessionRejected?.();
    }
    throw new ApiRequestError(
      response.status,
      body?.error ?? 'http_error',
      body?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export interface SellerCard {
  id: string;
  displayName: string;
  storefrontName: string;
  storefrontSlug: string | null;
  /** The shop's handle: its page at `/username`, and where a message lands. */
  username: string | null;
  tier: string;
  dispatchRegion: string | null;
  followerCount: number;
  trustScore: number;
  onTimeDispatchRate: number | null;
}

export interface FeedListing extends Listing {
  liked: boolean;
  seller: SellerCard | null;
  /** Inherited from the item's shipment batch; the batch itself stays private. */
  estimatedDispatchAt: string | null;
}

export interface FeedResponse {
  listings: FeedListing[];
  categories: string[];
  followedSellerIds: string[];
}

export interface ListingDetail {
  listing: Listing;
  seller: SellerCard | null;
  estimatedDispatchAt: string | null;
  comments: (ListingComment & { author: PartyRef })[];
  liked: boolean;
  following: boolean;
  isOwn: boolean;
}

export interface ActivityResponse {
  listings: Listing[];
  /** Orders this account placed. */
  orders: Order[];
  /** Orders placed with this account. */
  sales: Order[];
  likedListingIds: string[];
  following: SellerCard[];
}

export type DirectoryForwarder = ForwarderProfile & { id: string };

export interface LotSummary {
  lot: Lot;
  listingCount: number;
  orderCount: number;
  unitCount: number;
  weightGrams: number;
  valueMinor: number;
}

export interface LotsResponse {
  lots: LotSummary[];
  /** Listings not yet tagged into any batch. */
  unassigned: Listing[];
}

export interface LotContents {
  lot: Lot;
  listings: Listing[];
  orders: Order[];
  totals: { lines: number; units: number; weightGrams: number; valueMinor: number };
}

export interface OrderTracking {
  order: Order;
  stages: FulfilmentStage[];
  currentStage: FulfilmentStage;
  sellerName: string;
  trackingReference: string | null;
  estimatedDispatchAt: string | null;
}

/* ── The order lifecycle ───────────────────────────────────────────────── */

export interface PublicReview {
  id: string;
  rating: number;
  body: string;
  direction: string;
  author: PartyRef;
  createdAt: string;
  /** What it was written about. Null only where the order has since gone. */
  item: {
    orderId: string; listingId: string; name: string; totalMinor: number; currency: string;
  } | null;
}

/** An opinion left on somebody's page, which nothing had to be bought to write. */
export interface PageReview {
  id: string;
  rating: number;
  body: string;
  authorName: string;
  authorHandle: string | null;
  createdAt: string;
  mine: boolean;
}

export interface PageReviews {
  reviews: PageReview[];
  average: number | null;
  count: number;
  /** This viewer's own rating, if they have left one. */
  yours: number | null;
}

/** One side's record, counted from rows rather than stored. */
export interface CreditSide {
  praised: number;
  rated: number;
  goodRate: number | null;
  disputes: number;
  completed: number;
}

export interface Credit {
  memberSince: string;
  asSeller: CreditSide & { sold: number };
  asBuyer: CreditSide & { bought: number };
  seller: RatingSummary;
  buyer: RatingSummary;
  /** Opinions on the page, never mixed into the two above. */
  page: RatingSummary;
  verification: Record<string, string>;
  tier: string | null;
}

/** Someone approved to hold this payment, as the picker lists them. */
export interface EscrowOption {
  id: string;
  name: string;
  feeBasisPoints: number;
  feeMinor: number;
  heldBefore: number;
  since: string;
  /** Payments they have held, ever. */
  held: number;
  /** Of those, the ones that finished - released or refunded. */
  settled: number;
  /** What they are holding right now, including anything in dispute. */
  openNow: number;
  /** Out of five, from their own record. Null until they have settled one. */
  rating: number | null;
}

export interface Checkout {
  itemMinor: number;
  currency: string;
  seller: PartyRef;
  /** Where to send the money on a direct sale. Null when the seller has set none. */
  sellerPayment: SellerPaymentDetails | null;
  /** Empty when nobody approved can be neutral in this trade. */
  escrows: EscrowOption[];
  /** The one the rest of the batch already uses, and why. Never a default. */
  suggested: { agentId: string; name: string; because: string } | null;
}

/** One order waiting on the seller to say whether the money arrived. */
export interface SaleRow {
  id: string;
  itemName: string;
  quantity: number;
  totalMinor: number;
  currency: string;
  buyer: PartyRef;
  paymentStatus: string;
  claim: PaymentClaim | null;
  createdAt: string;
}

export interface EscrowHolding {
  order: {
    id: string; itemName: string; currency: string; lotId: string; status: string;
    escrow: Order['escrow']; protection: Order['protection'];
  };
  buyer: PartyRef;
  seller: PartyRef;
  dispute: Dispute | null;
  decidable: boolean;
}

export interface DisputeView {
  dispute: Dispute;
  order: Order;
  side: OrderSide | null;
  actions: DisputeAction[];
  overdue: boolean;
  parties: { buyer: PartyRef; seller: PartyRef };
}

export interface OrderState {
  order: Order;
  side: OrderSide | null;
  /** The other party, named from this viewer's side of the order. */
  counterparty: PartyRef;
  actions: OrderAction[];
  /** True while no payment provider is wired; the hold is recorded, not taken. */
  simulatedPayment: boolean;
  myReview: Review | null;
  /** Null while it is still hidden — which is the point of writing yours. */
  theirReview: Review | null;
  theirReviewPending: boolean;
  dispute: Dispute | null;
}

/** Out of 100, or null when nobody has rated that side of them yet. */
export interface RatingSummary {
  average: number | null;
  count: number;
}

export interface ReviewsAbout {
  reviews: PublicReview[];
  /** Split, because being a good seller and a good buyer are different claims. */
  asSeller: RatingSummary;
  asBuyer: RatingSummary;
  count: number;
  pending: number;
}

export interface NewListing {
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMinor: number;
  quantityAvailable: number;
  preOrder: { fillThreshold: number; cutoffAt: string } | null;
  /** Omitted when the item goes into a batch, which settles it. */
  sourcing?: Sourcing;
  /** The seller's own batch to file this into, chosen while listing. */
  lotId?: string | null;
  /** The store to list into; absent means your own. */
  storeId?: string;
  tags: string[];
}

/** Everything about a batch that can be set when opening it, and corrected later. */
export interface LotDetails {
  name: string;
  description?: string;
  origin?: string;
  estimatedDispatchAt?: string | null;
  supplierName?: string;
  supplierContact?: string;
  supplierReference?: string;
}

/* ── Social ────────────────────────────────────────────────────────────── */

export interface PostCard {
  post: Post;
  listing: { id: string; title: string; priceMinor: number; currency: string; condition: string } | null;
  /** Where the author's name goes. Resolved on read, not frozen into the post. */
  author: PartyRef;
}

export interface ChannelRow {
  sellerId: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
  tier: string | null;
  /** Whether you may speak for this shop. Yours sorts to the top. */
  mine: boolean;
  lastPost: string | null;
  lastPostAt: string | null;
  lastPostKind: string | null;
}

export interface ChannelThread {
  channel: {
    id: string;
    kind: 'seller' | 'forum';
    name: string;
    description: string;
    handle?: string | null;
    photoUrl?: string | null;
    /** Whether you may post as this shop rather than as a customer. */
    mine: boolean;
  };
  /** The shop's own items, for putting one in front of followers. Empty unless it is yours. */
  shareable: { id: string; title: string; priceMinor: number; currency: string }[];
  posts: PostCard[];
}

/* ── Wanted ────────────────────────────────────────────────────────────── */

export interface WantCard {
  id: string;
  buyerId: string;
  buyer: PartyRef;
  title: string;
  details: string;
  category: string;
  budgetMinor: number | null;
  currency: string;
  condition: string | null;
  status: 'open' | 'closed';
  offerCount: number;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
}

export interface WantOfferRow {
  id: string;
  seller: PartyRef;
  message: string;
  priceMinor: number | null;
  createdAt: string;
  listing: { id: string; title: string; priceMinor: number; currency: string; condition: string } | null;
}

export interface WantDetail {
  want: WantCard;
  mine: boolean;
  /** Your own answer, if you have already made one. */
  yours: { id: string; message: string; priceMinor: number | null; listingId: string | null } | null;
  offers: WantOfferRow[];
}

export interface ForumsResponse {
  forums: Forum[];
  cap: number;
  remaining: number;
}

/* ── Seller dashboards ─────────────────────────────────────────────────── */

export interface DashboardResponse {
  tracking: {
    openLots: number;
    inFlightOrders: number;
    byStage: { stage: string; label: string; lots: number }[];
    lots: {
      id: string;
      name: string;
      stage: FulfilmentStage;
      origin: string;
      estimatedDispatchAt: string | null;
      orderCount: number;
    }[];
  };
  analytics: {
    revenueMinor: number;
    unitsSold: number;
    orderCount: number;
    activeListings: number;
    views: number;
    saves: number;
    conversion: number;
    daily: { date: string; orders: number; revenueMinor: number }[];
    topListings: { id: string; title: string; viewCount: number; likeCount: number; unitsSold: number }[];
  };
}

export interface StorefrontDraft {
  storefrontName?: string;
  username?: string;
  bio?: string;
  dispatchRegion?: string;
  photoUrl?: string;
  coverUrl?: string;
  tags?: string[];
  link?: string;
  /** How a buyer pays this shop directly. Null clears it. */
  payment?: SellerPaymentDetails | null;
}

/* ── Lot board (tracking) ──────────────────────────────────────────────── */

export interface BoardLot {
  id: string;
  name: string;
  stage: FulfilmentStage;
  status: string;
  origin: string;
  estimatedDispatchAt: string | null;
  updatedAt?: string;
}

export interface BoardOrder {
  id: string;
  itemName: string;
  condition: string;
  quantity: number;
  unitWeightGrams: number;
  checkpoints: Partial<Record<OrderCheckpoint, string | null>>;
}

export interface BoardCustomer {
  buyerId: string;
  name: string;
  phone: string | null;
  orders: BoardOrder[];
  trackingReference: string | null;
}

export interface LotsBoard {
  lots: { lot: BoardLot; tally: LotTally }[];
}

export interface LotBoard {
  lot: BoardLot;
  tally: LotTally;
  customers: BoardCustomer[];
}

/* ── Messages ──────────────────────────────────────────────────────────── */

export interface ThreadRow {
  threadId: string;
  us: MessageParty;
  them: MessageParty;
  lastMessage: string;
  lastAt: string;
  lastFromUs: boolean;
  unread: number;
}

export interface Inbox {
  handles: MessageParty[];
  threads: ThreadRow[];
}

export interface Thread {
  us: MessageParty;
  them: MessageParty;
  /** Every handle the caller speaks as, so the thread can offer a switch. */
  handles: MessageParty[];
  threadId: string;
  messages: Message[];
}

export interface PublicProfile {
  handle: string;
  isStore: boolean;
  displayName: string;
  bio: string;
  photoUrl: string | null;
  coverUrl: string | null;
  tags: string[];
  link: string | null;
  dispatchRegion: string;
  followerCount: number;
  tier: string | null;
  ownerHandle: string | null;
  sellerId: string;
  memberSince: string;
  lastSeenAt: string | null;
  counts: { listings: number; onSale: number; sold: number };
  listings: {
    id: string; title: string; priceMinor: number; currency: string; condition: string;
    lotId: string | null; sourcing?: string; quantityAvailable: number; likeCount: number;
  }[];
}

/* ── Exporter ──────────────────────────────────────────────────────────── */

export interface ExporterItem {
  id: string;
  itemName: string;
  condition: string;
  quantity: number;
  unitWeightGrams: number;
  received: boolean;
  packed: boolean;
}

export interface ExporterStore {
  ownerId: string;
  name: string;
  /** The shop's handle, so the packer can tell it a crate has landed. */
  handle: string | null;
}

export interface ExporterLot {
  store: ExporterStore;
  lot: { id: string; name: string; stage: FulfilmentStage; origin: string };
  tally: LotTally;
  items: ExporterItem[];
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  me: () => request<MeResponse>('/auth/me'),

  login: (identifier: string, password: string) =>
    post<LoginResponse>('/auth/login', { identifier, password }),

  signup: (body: { displayName: string; username?: string; email: string; phone: string; password: string }) =>
    post<LoginResponse>('/auth/signup', body),

  logout: () => post<{ ok: true }>('/auth/logout'),

  feed: (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    const suffix = query.toString();
    return request<FeedResponse>(`/feed${suffix ? `?${suffix}` : ''}`);
  },

  listing: (id: string) => request<ListingDetail>(`/listings/${encodeURIComponent(id)}`),
  createListing: (body: NewListing) => post<{ listing: Listing }>('/listings', body),
  like: (id: string) => post<{ liked: boolean }>(`/listings/${encodeURIComponent(id)}/like`),
  bump: (id: string) => post<{ bumped: boolean }>(`/listings/${encodeURIComponent(id)}/bump`),
  comment: (id: string, body: string, replyToId?: string) =>
    post<{ comment: ListingComment & { author: PartyRef } }>(`/listings/${encodeURIComponent(id)}/comments`, { body, replyToId }),
  follow: (sellerId: string) =>
    post<{ following: boolean }>(`/sellers/${encodeURIComponent(sellerId)}/follow`),
  order: (listingId: string, quantity = 1) => post<{ order: Order }>('/orders', { listingId, quantity }),

  activity: () => request<ActivityResponse>('/me/activity'),

  myLots: () => request<LotsResponse>('/me/lots'),
  createLot: (
    body: LotDetails & { forwarderUserId?: string; forwarderName?: string; forwarderContact?: string },
  ) => post<{ lot: Lot }>('/lots', body),
  updateLotDetails: (id: string, body: Partial<LotDetails>) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/details`, body),
  lotContents: (id: string) => request<LotContents>(`/lots/${encodeURIComponent(id)}/contents`),
  assignToLot: (id: string, listingIds: string[], remove = false) =>
    post<{ changed: number }>(`/lots/${encodeURIComponent(id)}/assign`, { listingIds, remove }),
  advanceStage: (id: string, stage: string, note?: string) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/stage`, { stage, note }),
  setTracking: (id: string, body: { trackingReference?: string; forwarderName?: string; forwarderContact?: string; forwarderUserId?: string }) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/tracking`, body),

  orderTracking: (id: string) => request<OrderTracking>(`/orders/${encodeURIComponent(id)}`),
  orderState: (id: string) => request<OrderState>(`/orders/${encodeURIComponent(id)}/state`),
  checkout: (id: string) => request<Checkout>(`/orders/${encodeURIComponent(id)}/checkout`),
  claimPayment: (id: string, body: { reference: string; screenshot: string | null }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/claim-payment`, body),
  settleClaim: (id: string, body: { accept: boolean; reason?: string }) =>
    post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/settle-claim`, body),
  sales: (storeId?: string) =>
    request<{ waiting: SaleRow[]; answered: SaleRow[] }>(
      `/me/sales${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  payOrder: (id: string, protection: boolean, escrowAgentId?: string) =>
    post<{ order: Order; simulatedPayment: boolean }>(
      `/orders/${encodeURIComponent(id)}/pay`,
      { protection, escrowAgentId },
    ),
  confirmOrder: (id: string) => post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/confirm`),
  openDispute: (id: string, body: { reasonCode: string; reason: string; evidence: EvidenceDraft[] }) =>
    post<{ dispute: Dispute }>(`/orders/${encodeURIComponent(id)}/dispute`, body),
  dispute: (id: string) => request<DisputeView>(`/disputes/${encodeURIComponent(id)}`),
  disputeReply: (id: string, body: string, evidence: EvidenceDraft[]) =>
    post<{ dispute: Dispute }>(`/disputes/${encodeURIComponent(id)}/reply`, { body, evidence }),
  disputeOffer: (id: string, refundMinor: number, note: string) =>
    post<{ dispute: Dispute }>(`/disputes/${encodeURIComponent(id)}/offer`, { refundMinor, note }),
  disputeAccept: (id: string) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/accept`),
  disputeWithdraw: (id: string) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/withdraw`),
  disputeEscalate: (id: string) =>
    post<{ dispute: Dispute }>(`/disputes/${encodeURIComponent(id)}/escalate`),
  disputeSettle: (id: string, body: { outcome: string; refundMinor: number; note: string }) =>
    post<{ dispute: Dispute; order: Order }>(`/disputes/${encodeURIComponent(id)}/settle`, body),
  escrowHoldings: () =>
    request<{ rights: EscrowRights; heldMinor: number; holdings: EscrowHolding[] }>('/escrow/holdings'),
  reviewOrder: (id: string, rating: number, body: string) =>
    post<{ review: Review }>(`/orders/${encodeURIComponent(id)}/review`, { rating, body }),
  reviewsAbout: (userId: string) =>
    request<ReviewsAbout>(`/users/${encodeURIComponent(userId)}/reviews`),

  stores: () => request<{ stores: StoreAccess[] }>('/me/stores'),
  updateManager: (body: {
    storeId?: string;
    identifier: string;
    permissions?: StorePermission[];
    remove?: boolean;
  }) => post<{ managers: StoreManager[] }>('/me/storefront/managers', body),

  lotsBoard: (storeId?: string) =>
    request<LotsBoard>(`/me/lots/board${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`),
  lotBoard: (id: string, storeId?: string) =>
    request<LotBoard>(
      `/lots/${encodeURIComponent(id)}/board${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`,
    ),
  setCheckpoint: (orderId: string, checkpoint: OrderCheckpoint, on: boolean) =>
    post<{ order: { id: string; checkpoints: BoardOrder['checkpoints'] }; tally: LotTally }>(
      `/orders/${encodeURIComponent(orderId)}/checkpoint`,
      { checkpoint, on },
    ),

  inbox: () => request<Inbox>('/messages'),
  thread: (handle: string, as?: string) =>
    request<Thread>(`/messages/${encodeURIComponent(handle)}${as ? `?as=${encodeURIComponent(as)}` : ''}`),
  sendMessage: (handle: string, body: string, as?: string) =>
    post<{ message: Message }>(`/messages/${encodeURIComponent(handle)}/send`, { body, as }),
  profile: (handle: string) => request<PublicProfile>(`/u/${encodeURIComponent(handle)}`),
  credit: (userId: string) => request<Credit>(`/users/${encodeURIComponent(userId)}/credit`),
  pageReviews: (userId: string) => request<PageReviews>(`/users/${encodeURIComponent(userId)}/page-reviews`),
  writePageReview: (userId: string, body: { rating: number; body: string }) =>
    post<{ review: PageReview }>(`/users/${encodeURIComponent(userId)}/page-reviews/new`, body),
  saveProfile: (body: { bio?: string; coverUrl?: string; tags?: string[] }) =>
    post<{ profile: { bio: string; coverUrl: string | null; tags: string[] } }>('/me/profile', body),
  setUsername: (username: string) => post<{ username: string }>('/me/username', { username }),

  exporterLots: () =>
    request<{ lots: { store: ExporterStore; lot: ExporterLot['lot']; tally: LotTally }[] }>(
      '/exporter/lots',
    ),
  exporterLot: (id: string) => request<ExporterLot>(`/exporter/lots/${encodeURIComponent(id)}`),

  storefront: () =>
    request<{ storefront: SellerProfile | null; displayName: string }>('/me/storefront'),
  saveStorefront: (body: StorefrontDraft) =>
    post<{ storefront: SellerProfile }>('/me/storefront/save', body),
  dashboard: () => request<DashboardResponse>('/me/dashboard'),

  socialFeed: () => request<{ posts: PostCard[] }>('/social/feed'),
  channels: () => request<{ channels: ChannelRow[] }>('/social/channels'),
  channelThread: (id: string) => request<ChannelThread>(`/social/channels/${encodeURIComponent(id)}`),
  createPost: (body: {
    body: string; forumId?: string; listingId?: string; storeId?: string;
    channelId?: string; announcement?: boolean;
  }) =>
    post<{ post: Post }>('/social/posts', body),
  forums: () => request<ForumsResponse>('/social/forums'),

  wants: (options: { category?: string; q?: string } = {}) => {
    const query = new URLSearchParams();
    if (options.category) query.set('category', options.category);
    if (options.q) query.set('q', options.q);
    const suffix = query.toString();
    return request<{ wants: WantCard[]; mine: WantCard[] }>(`/wants${suffix ? `?${suffix}` : ''}`);
  },
  postWant: (body: {
    title: string; details: string; category: string;
    budgetMinor: number | null; condition: string | null;
  }) => post<{ want: WantCard }>('/wants/new', body),
  // The buyer is on the path because a want is stored under whoever posted it.
  want: (id: string, buyerId: string) =>
    request<WantDetail>(`/wants/${encodeURIComponent(id)}?buyer=${encodeURIComponent(buyerId)}`),
  offerOnWant: (id: string, buyerId: string, body: {
    message: string; listingId?: string | null; priceMinor?: number | null;
  }) => post<{ offerCount: number }>(
    `/wants/${encodeURIComponent(id)}/offers?buyer=${encodeURIComponent(buyerId)}`, body,
  ),
  closeWant: (id: string, buyerId: string) =>
    post<{ want: WantCard }>(`/wants/${encodeURIComponent(id)}/close?buyer=${encodeURIComponent(buyerId)}`),
  createForum: (body: { name: string; description?: string }) =>
    post<{ forum: Forum }>('/social/forums/new', body),
  forwarders: (route?: string) =>
    request<{ forwarders: DirectoryForwarder[] }>(`/forwarders${route ? `?route=${encodeURIComponent(route)}` : ''}`),
};

export type { AuthUser, DemoAccount, Listing, Lot, Order, ListingComment };
