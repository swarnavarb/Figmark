/**
 * Wire contracts shared by the API and the browser app. Keeping them here means
 * a change to a response shape breaks the typecheck on both sides at once.
 */

import type { UserRole } from './enums.js';
import type { SellerProfile, TrustSignals, VerificationState } from './models.js';

/**
 * The authenticated principal, as every part of the app sees it.
 *
 * This is deliberately provider-agnostic: the mock provider builds it from a
 * seeded user, and a real provider (Entra External ID, Auth0, Clerk) will build
 * the same shape from its own claims. Feature code depends on this type and
 * never on the provider.
 */
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  verification: VerificationState;
  trust: TrustSignals;
  sellerProfile: SellerProfile | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  /** Bearer token, for clients that cannot use the session cookie. */
  token: string;
  expiresAt: string;
}

export interface MeResponse {
  /** Null when no valid session is present, rather than a 401 - callers render a logged-out view. */
  user: AuthUser | null;
  authMode: AuthMode;
}

export type AuthMode = 'mock' | 'swa';

export type BackendKind = 'cosmos' | 'memory';

/** `/api/health` - proves the frontend -> API -> data/storage path end to end. */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  /** ISO-8601 server time. */
  time: string;
  auth: {
    mode: AuthMode;
    /** Seeded logins, exposed only while the mock provider is active. */
    demoAccounts: Array<{ username: string; role: UserRole }>;
  };
  data: {
    backend: BackendKind;
    connected: boolean;
    database: string | null;
    detail: string;
  };
  storage: {
    backend: 'azure_blob' | 'memory';
    connected: boolean;
    account: string | null;
    detail: string;
  };
}

export interface ApiError {
  error: string;
  message: string;
}
