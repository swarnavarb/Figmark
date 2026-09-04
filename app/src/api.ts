import type {
  ApiError,
  AuthUser,
  HealthResponse,
  LoginResponse,
  MeResponse,
} from '@shared/contracts';
import type { Lot, Order } from '@shared/models';

/**
 * Typed client for the Functions API.
 *
 * Every response type is imported from the shared contracts, so a change to a
 * server response that this code does not handle fails the build.
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
      // The session cookie is HttpOnly, so it must be sent explicitly.
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (cause) {
    // A network-level failure usually means the Functions host is not running,
    // which is worth saying plainly rather than surfacing "Failed to fetch".
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

export const api = {
  health: () => request<HealthResponse>('/health'),

  me: () => request<MeResponse>('/auth/me'),

  login: (username: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),

  lots: () => request<{ lots: Lot[] }>('/lots'),

  manifest: (sellerId: string, lotId: string) =>
    request<{ lot: Lot; orders: Order[]; totals: ManifestTotals }>(
      `/lots/${encodeURIComponent(sellerId)}/${encodeURIComponent(lotId)}/manifest`,
    ),
};

export interface ManifestTotals {
  lines: number;
  units: number;
  weightGrams: number;
  valueMinor: number;
}

export type { AuthUser };
