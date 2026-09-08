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
import type {
  Dispute, Forum, ForwarderProfile, Listing, ListingComment, Lot, Message, MessageParty, Order, Post,
  Review, SellerProfile, StoreManager,
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
  comments: ListingComment[];
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
  authorName: string;
  createdAt: string;
}

export interface OrderState {
  order: Order;
  side: OrderSide | null;
  /** The other party, named from this viewer's side of the order. */
  counterpartyName: string;
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
}

export interface ChannelRow {
  sellerId: string;
  name: string;
  photoUrl: string | null;
  tier: string | null;
  lastPost: string | null;
  lastPostAt: string | null;
  lastPostKind: string | null;
}

export interface ChannelThread {
  channel: { id: string; kind: 'seller' | 'forum'; name: string; description: string };
  posts: PostCard[];
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
  link?: string;
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
  link: string | null;
  dispatchRegion: string;
  followerCount: number;
  tier: string | null;
  ownerHandle: string | null;
  sellerId: string;
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
    post<{ comment: ListingComment }>(`/listings/${encodeURIComponent(id)}/comments`, { body, replyToId }),
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
  payOrder: (id: string) =>
    post<{ order: Order; simulatedPayment: boolean }>(`/orders/${encodeURIComponent(id)}/pay`),
  confirmOrder: (id: string) => post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/confirm`),
  disputeOrder: (id: string, reason: string) =>
    post<{ order: Order; dispute: Dispute }>(`/orders/${encodeURIComponent(id)}/dispute`, { reason }),
  refundOrder: (id: string) => post<{ order: Order }>(`/orders/${encodeURIComponent(id)}/refund`),
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
  createPost: (body: { body: string; forumId?: string; listingId?: string; storeId?: string }) =>
    post<{ post: Post }>('/social/posts', body),
  forums: () => request<ForumsResponse>('/social/forums'),
  createForum: (body: { name: string; description?: string }) =>
    post<{ forum: Forum }>('/social/forums/new', body),
  forwarders: (route?: string) =>
    request<{ forwarders: DirectoryForwarder[] }>(`/forwarders${route ? `?route=${encodeURIComponent(route)}` : ''}`),
};

export type { AuthUser, DemoAccount, Listing, Lot, Order, ListingComment };
