import type {
  ApiError,
  AuthUser,
  DemoAccount,
  HealthResponse,
  LoginResponse,
  MeResponse,
} from '@shared/contracts';
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
  lot: Lot | null;
}

export interface FeedResponse {
  listings: FeedListing[];
  categories: string[];
  followedSellerIds: string[];
}

export interface ListingDetail {
  listing: Listing;
  seller: SellerCard | null;
  lot: Lot | null;
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

export interface NewListing {
  title: string;
  description: string;
  category: string;
  condition: string;
  priceMinor: number;
  quantityAvailable: number;
  lotMode: boolean;
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
  forwarders: (route?: string) =>
    request<{ forwarders: DirectoryForwarder[] }>(`/forwarders${route ? `?route=${encodeURIComponent(route)}` : ''}`),
};

export type { AuthUser, DemoAccount, Listing, Lot, Order, ListingComment };
