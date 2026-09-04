import type { HttpRequest } from '@azure/functions';
import type {
  AuthMode,
  AuthUser,
  DemoAccount,
  LoginRequest,
  LoginResponse,
} from '../../../shared/contracts.js';
import type { Capability } from '../../../shared/enums.js';

/**
 * The single seam between the application and whatever issues identities.
 *
 * Rule for the whole codebase: no feature code reads cookies, headers or
 * principal claims directly. It calls `getCurrentUser` / `requireAuth` /
 * `requireCapability` and receives an `AuthUser`. Replacing the mock provider with
 * Microsoft Entra External ID (or Auth0/Clerk) then means writing one new
 * implementation of this interface and changing the `AUTH_MODE` setting -
 * not touching any handler.
 */
export interface AuthService {
  readonly mode: AuthMode;

  /** The signed-in user, or null when the request carries no valid session. */
  getCurrentUser(request: HttpRequest): Promise<AuthUser | null>;

  /** As `getCurrentUser`, but throws `AuthError` 401 instead of returning null. */
  requireAuth(request: HttpRequest): Promise<AuthUser>;

  /**
   * As `requireAuth`, and additionally throws `AuthError` 403 unless the user
   * holds at least one of the listed capabilities.
   *
   * Capability, not role: an account is both buyer and seller, so "may this
   * account sell?" is a different question from "what kind of account is this?"
   * - and only the first one has an answer. Holding a capability is never
   * ownership: a check that the user owns the resource is separate, and both
   * are required for seller-scoped routes.
   */
  requireCapability(request: HttpRequest, capabilities: readonly Capability[]): Promise<AuthUser>;

  /**
   * Exchange credentials for a session. Providers that authenticate out of band
   * (a hosted login page, an OIDC redirect) throw `AuthError.notImplemented`
   * and the frontend routes to their login endpoint instead.
   */
  login(credentials: LoginRequest): Promise<LoginResponse>;

  /** Invalidate the current session. Safe to call when not signed in. */
  logout(request: HttpRequest): Promise<void>;

  /**
   * Sign-in hints to surface in the UI. The mock provider returns its seeded
   * accounts; a real provider returns an empty list.
   */
  listDemoAccounts(): DemoAccount[];

  /** Set-Cookie values to attach to a login response, if the provider uses cookies. */
  loginCookies(token: string): string[];

  /** Set-Cookie values to attach to a logout response. */
  logoutCookies(): string[];
}
