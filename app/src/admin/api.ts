import type { HealthResponse } from '@shared/contracts';
import type { Dispute, EscrowRights, SellerTrustSignals, TrustSignals } from '@shared/models';
import { ApiRequestError, api as marketplace } from '../api';

/**
 * The operations API.
 *
 * Separate from the marketplace client on purpose. Everything here deletes
 * accounts, deletes what people made, or moves money — and a call that can do
 * that should not be one import away from a screen that renders a shop.
 */

export interface AdminUserRow {
  id: string;
  displayName: string;
  username: string | null;
  email: string;
  phone: string | null;
  suspended: boolean;
  createdAt: string;
  store: {
    name: string;
    username: string | null;
    tier: string;
    followerCount: number;
    managers: number;
  } | null;
  escrowRights: EscrowRights | null;
  buyerTrust: TrustSignals;
  sellerTrust: SellerTrustSignals;
  signInAccount: boolean;
}

export interface AdminUserDetail {
  user: AdminUserRow;
  listings: { id: string; title: string; status: string; priceMinor: number; currency: string; lotId: string | null; createdAt: string }[];
  lots: { id: string; name: string; stage: string; status: string }[];
  posts: { id: string; channelId: string; kind: string; body: string; createdAt: string }[];
  orders: { purchases: number; sales: number };
  reviews: { id: string; subjectId: string; rating: number; body: string; revealed: boolean; createdAt: string }[];
  /** Why this account cannot be deleted yet. Empty means it can. */
  blockers: string[];
}

export interface AdminDisputeRow {
  dispute: Dispute;
  itemName: string;
  heldMinor: number;
  currency: string;
  protectionFeeMinor: number;
  buyer: { id: string; name: string; trust: TrustSignals } | null;
  seller: { id: string; name: string; trust: SellerTrustSignals } | null;
}

/**
 * How long the console will wait before it says so.
 *
 * A cold worker on a serverless host can take seconds to answer, so this is
 * generous. What it must not be is absent: a request with no deadline that
 * never comes back leaves the screen on "Loading…" indefinitely, which reads as
 * a broken page and says nothing about what broke. That cost several rounds of
 * guessing at a fault nobody could see, so the wait is bounded and named.
 */
const TIMEOUT_MS = 20_000;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      ...init,
    });
  } catch (err) {
    if (abort.signal.aborted) {
      throw new ApiRequestError(
        0,
        'timeout',
        `The server did not answer /api${path} within ${TIMEOUT_MS / 1000} seconds.` +
          ' It may still be starting up — try again in a moment.',
      );
    }
    throw new ApiRequestError(0, 'network_error', `Could not reach the API at /api${path}.`);
  } finally {
    clearTimeout(deadline);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
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

export const admin = {
  me: marketplace.me,
  signIn: marketplace.login,
  signOut: marketplace.logout,

  users: (query: string) =>
    request<{ users: AdminUserRow[]; total: number }>(
      `/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    ),
  user: (id: string) => request<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`),
  suspend: (id: string, suspended: boolean) =>
    post<{ user: AdminUserRow }>(`/admin/users/${encodeURIComponent(id)}/suspend`, { suspended }),
  deleteUser: (id: string) =>
    post<{ deleted: Record<string, unknown> }>(`/admin/users/${encodeURIComponent(id)}/delete`),
  deleteResource: (kind: string, id: string, ownerId: string) =>
    post<{ deleted: Record<string, unknown> }>('/admin/resources/delete', { kind, id, ownerId }),
  setEscrow: (id: string, body: { enabled: boolean; feeBasisPoints?: number; displayName?: string; note?: string }) =>
    post<{ user: AdminUserRow }>(`/admin/users/${encodeURIComponent(id)}/escrow`, body),

  /** What the API is actually running on, for the status line. */
  health: () => request<HealthResponse>('/health'),

  disputes: () => request<{ disputes: AdminDisputeRow[] }>('/admin/disputes'),
  resolve: (id: string, body: { outcome: string; refundMinor: number; note: string }) =>
    post<{ dispute: Dispute }>(`/admin/disputes/${encodeURIComponent(id)}/resolve`, body),
};

export { ApiRequestError };
