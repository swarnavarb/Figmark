import type {
  ApiError,
  AuthUser,
  DemoAccount,
  HealthResponse,
  LoginResponse,
  MeResponse,
} from '@shared/contracts';
import type { FulfilmentStage } from '@shared/enums';
import type { ForwarderProfile, Listing, ListingComment, Lot, Order } from '@shared/models';

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
  orders: Order[];
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

export interface NewListing {
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMinor: number;
  quantityAvailable: number;
  preOrder: { fillThreshold: number; cutoffAt: string } | null;
  tags: string[];
}

export const api = {
  health: () => request<HealthResponse>('/health'),
  me: () => request<MeResponse>('/auth/me'),

  login: (identifier: string, password: string) =>
    post<LoginResponse>('/auth/login', { identifier, password }),

  signup: (body: { displayName: string; email: string; phone: string; password: string }) =>
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
  createLot: (body: { name: string; description?: string; estimatedDispatchAt?: string; forwarderUserId?: string; forwarderName?: string; forwarderContact?: string }) =>
    post<{ lot: Lot }>('/lots', body),
  lotContents: (id: string) => request<LotContents>(`/lots/${encodeURIComponent(id)}/contents`),
  assignToLot: (id: string, listingIds: string[], remove = false) =>
    post<{ changed: number }>(`/lots/${encodeURIComponent(id)}/assign`, { listingIds, remove }),
  advanceStage: (id: string, stage: string, note?: string) =>
    post<{ lot: Lot; ordersUpdated: number }>(`/lots/${encodeURIComponent(id)}/stage`, { stage, note }),
  setTracking: (id: string, body: { trackingReference?: string; forwarderName?: string; forwarderContact?: string; forwarderUserId?: string }) =>
    post<{ lot: Lot }>(`/lots/${encodeURIComponent(id)}/tracking`, body),

  orderTracking: (id: string) => request<OrderTracking>(`/orders/${encodeURIComponent(id)}`),
  forwarders: (route?: string) =>
    request<{ forwarders: DirectoryForwarder[] }>(`/forwarders${route ? `?route=${encodeURIComponent(route)}` : ''}`),
};

export type { AuthUser, DemoAccount, Listing, Lot, Order, ListingComment };
