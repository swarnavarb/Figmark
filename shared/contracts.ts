/**
 * Wire contracts shared by the API and the browser app. Keeping them here means
 * a change to a response shape breaks the typecheck on both sides at once.
 */

import type { UserCapabilities } from './capabilities.js';
import type {
  ForwarderProfile,
  SellerProfile,
  SellerTrustSignals,
  TrustSignals,
  VerificationState,
} from './models.js';

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
  displayName: string;
  email: string;
  phone: string | null;
  /**
   * Derived server-side and sent down, so the client never re-implements the
   * rules. Authoritative checks still happen on the API - this is for deciding
   * what to render, not what to permit.
   */
  capabilities: UserCapabilities;
  verification: VerificationState;
  buyerTrust: TrustSignals;
  sellerTrust: SellerTrustSignals;
  /** Non-null once the account has listed something. */
  sellerProfile: SellerProfile | null;
  /** Non-null for accounts that also operate as freight forwarders. */
  forwarderProfile: ForwarderProfile | null;
}

export interface LoginRequest {
  /** Email or phone; the server normalises and resolves either. */
  identifier: string;
  password: string;
}

export interface SignupRequest {
  displayName: string;
  email: string;
  phone: string;
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
    demoAccounts: DemoAccount[];
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

/** A seeded sign-in hint, shown only while the mock provider is active. */
export interface DemoAccount {
  identifier: string;
  label: string;
}

export interface ApiError {
  error: string;
  message: string;
}
