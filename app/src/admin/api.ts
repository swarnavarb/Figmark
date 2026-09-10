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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiRequestError(response.status, body?.error ?? 'error', body?.message ?? response.statusText);
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

  disputes: () => request<{ disputes: AdminDisputeRow[] }>('/admin/disputes'),
  resolve: (id: string, body: { outcome: string; refundMinor: number; note: string }) =>
    post<{ dispute: Dispute }>(`/admin/disputes/${encodeURIComponent(id)}/resolve`, body),
};

export { ApiRequestError };
