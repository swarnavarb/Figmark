import type { HealthResponse } from '@shared/contracts';
import type { Dispute, DisputeDecision, DisputeSanction, EscrowRights, FeePayment, SellerTrustSignals, TrustSignals } from '@shared/models';
import type { LearnDoc, LearnTab } from '@shared/learn';
import type { ContentReport } from '@shared/moderation';
import type { MarketSettings } from '@shared/settings';
import type { DeviceFigures } from '@shared/devices';
import { ApiRequestError, api as marketplace, type OpsStoreRow } from '../api';
import type { StoreStatus } from '@shared/models';
import type { StoreKind } from '@shared/service-stores';

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
  raiser: { id: string; name: string } | null;
  respondent: { id: string; name: string } | null;
  buyer: { id: string; name: string; trust: TrustSignals } | null;
  seller: { id: string; name: string; trust: SellerTrustSignals } | null;
  /** The current round: who holds it and by when they decide. */
  round: { n: number; managerId: string; managerName: string; decideBy: string; decided: boolean } | null;
  rounds: number;
  /** The manager on the current round is past their deadline. */
  overdue: boolean;
  standing: { favour: DisputeDecision['favour']; finalRound: number; decision: DisputeDecision } | null;
}

/** A sanction a community manager decided that waits for an operator. */
export interface PendingAction {
  id: string;
  disputeId: string;
  sanction: DisputeSanction;
  targetName: string;
  managerId: string;
  managerName: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface LedgerEntry extends FeePayment {
  reference: string;
  managerId: string | null;
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

export interface PhotoScan {
  stored: number;
  inUse: number;
  tooNew: number;
  graceHours: number;
  unusedCount: number;
  unusedBytes: number;
  unused: { scope: 'public' | 'private'; name: string; size: number; uploadedAt: string }[];
  storage: { backend: 'azure_blob' | 'memory'; connected: boolean; detail: string };
}

export const admin = {
  me: marketplace.me,
  signIn: marketplace.login,
  signOut: marketplace.logout,

  users: (query: string) =>
    request<{ users: AdminUserRow[]; total: number }>(
      `/ops/users${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    ),
  user: (id: string) => request<AdminUserDetail>(`/ops/users/${encodeURIComponent(id)}`),
  suspend: (id: string, suspended: boolean) =>
    post<{ user: AdminUserRow }>(`/ops/users/${encodeURIComponent(id)}/suspend`, { suspended }),
  deleteUser: (id: string) =>
    post<{ deleted: Record<string, unknown> }>(`/ops/users/${encodeURIComponent(id)}/delete`),
  deleteResource: (kind: string, id: string, ownerId: string) =>
    post<{ deleted: Record<string, unknown> }>('/ops/resources/delete', { kind, id, ownerId }),
  /** Which stored photos nothing uses. Read-only; slow on a big database. */
  scanPhotos: (graceHours: number) => post<PhotoScan>('/ops/photos/scan', { graceHours }),
  /** Delete them. Looks again first; `only` narrows it to named photos. */
  cleanupPhotos: (graceHours: number, only?: { scope: 'public' | 'private'; name: string }[]) =>
    post<{ deleted: number; bytes: number; failed: number }>('/ops/photos/cleanup', { graceHours, ...(only ? { only } : {}) }),
  /** Appoint or remove a community manager. Fees are not theirs to set. */
  setEscrow: (id: string, body: { enabled: boolean; displayName?: string; note?: string }) =>
    post<{ user: AdminUserRow }>(`/ops/users/${encodeURIComponent(id)}/escrow`, body),

  /** Service stores: applications waiting first, then every store. */
  stores: () => request<{ stores: OpsStoreRow[] }>('/ops/stores'),
  reviewStore: (kind: StoreKind, ownerId: string, body: { decision: StoreStatus; note: string }) =>
    post<{ ok: true; status: StoreStatus }>(`/ops/stores/${kind}/${encodeURIComponent(ownerId)}/review`, body),

  /** What the API is actually running on, for the status line. */
  health: () => request<HealthResponse>('/health'),

  disputes: () => request<{ disputes: AdminDisputeRow[] }>('/ops/disputes'),
  /** Hand the current round to another manager: named, or the system's pick by availability. */
  reassign: (id: string, managerId?: string) =>
    post<{ dispute: Dispute }>(`/ops/disputes/${encodeURIComponent(id)}/reassign`, managerId ? { managerId } : {}),
  /** Alert banners and XP deductions waiting for approval. */
  actions: () => request<{ actions: PendingAction[] }>('/ops/actions'),
  decideAction: (id: string, body: { approve: boolean; days?: number; severity?: 'light' | 'severe'; note?: string }) =>
    post<{ action: PendingAction }>(`/ops/actions/${encodeURIComponent(id)}/decide`, body),
  /** Every fee paid through the gateway, with Figmark's commission. */
  ledger: () => request<{ entries: LedgerEntry[]; totals: { collectedMinor: number; commissionMinor: number; managerShareMinor: number } }>('/ops/ledger'),

  /** The Learn guide, hidden tabs included, and whether it differs from the one that ships. */
  learn: () => request<LearnDoc & { customised: boolean }>('/ops/learn'),
  saveLearn: (tabs: LearnTab[]) => post<LearnDoc & { customised: boolean }>('/ops/learn/save', { tabs }),
  resetLearn: () => post<LearnDoc & { customised: boolean }>('/ops/learn/reset'),
  /** Upload a picture for a guide step; the same store listing photos use. */
  uploadImage: (dataUrl: string) => marketplace.uploadPhoto(dataUrl),

  devices: () => request<DeviceFigures>('/ops/devices'),
  /** Marketplace-wide rules and every fee: protection, disputes, escalations, commission. */
  settings: () => request<MarketSettings>('/ops/settings'),
  saveSettings: (settings: Partial<Omit<MarketSettings, 'updatedAt' | 'updatedBy'>>) =>
    post<MarketSettings>('/ops/settings/save', settings),

  /** Disputed reviews and comments, and authors asking for theirs to be validated. */
  reports: () => request<{ reports: (ContentReport & { authorName: string })[] }>('/ops/reports'),
  resolveReport: (id: string, body: { decision: string; note: string }) =>
    post<{ report: ContentReport }>(`/ops/reports/${encodeURIComponent(id)}/resolve`, body),
};

export { ApiRequestError };
