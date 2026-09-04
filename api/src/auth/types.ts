import type { HttpRequest } from '@azure/functions';
import type { AuthMode, AuthUser, LoginRequest, LoginResponse } from '../../../shared/contracts.js';
import type { UserRole } from '../../../shared/enums.js';

/**
 * The single seam between the application and whatever issues identities.
 *
 * Rule for the whole codebase: no feature code reads cookies, headers or
 * principal claims directly. It calls `getCurrentUser` / `requireAuth` /
 * `requireRole` and receives an `AuthUser`. Replacing the mock provider with
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

  /** As `requireAuth`, and additionally throws `AuthError` 403 on role mismatch. */
  requireRole(request: HttpRequest, roles: readonly UserRole[]): Promise<AuthUser>;

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
  listDemoAccounts(): Array<{ username: string; role: UserRole }>;

  /** Set-Cookie values to attach to a login response, if the provider uses cookies. */
  loginCookies(token: string): string[];

  /** Set-Cookie values to attach to a logout response. */
  logoutCookies(): string[];
}
