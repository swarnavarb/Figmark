import type { HttpRequest } from '@azure/functions';
import type { AuthMode, AuthUser, LoginRequest, LoginResponse } from '../../../shared/contracts.js';
import type { UserRole } from '../../../shared/enums.js';
import type { User } from '../../../shared/models.js';
import type { Repository } from '../data/repository.js';
import { AuthError } from './errors.js';
import { verifyPassword } from './passwords.js';
import {
  SESSION_COOKIE_NAME,
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  verifySessionToken,
} from './tokens.js';
import type { AuthService } from './types.js';

/**
 * Development-only auth provider: username + password against seeded users.
 *
 * PLACEHOLDER. This exists so role-aware features can be built before a real
 * identity provider is chosen. It must not reach production with real users -
 * see docs/AUTH.md for the swap-in procedure.
 */
export class MockAuthProvider implements AuthService {
  readonly mode: AuthMode = 'mock';

  constructor(
    private readonly repository: Repository,
    private readonly sessionSecret: string,
    private readonly sessionTtlSeconds: number,
  ) {}

  async getCurrentUser(request: HttpRequest): Promise<AuthUser | null> {
    const token = readToken(request);
    if (!token) return null;

    const payload = verifySessionToken(token, this.sessionSecret);
    if (!payload) return null;

    if (await this.repository.isSessionRevoked(token)) return null;

    const user = await this.repository.getUserById(payload.sub);
    if (!user || user.suspended) return null;

    return toAuthUser(user);
  }

  async requireAuth(request: HttpRequest): Promise<AuthUser> {
    const user = await this.getCurrentUser(request);
    if (!user) throw AuthError.unauthenticated();
    return user;
  }

  async requireRole(request: HttpRequest, roles: readonly UserRole[]): Promise<AuthUser> {
    const user = await this.requireAuth(request);
    if (!roles.includes(user.role)) {
      throw AuthError.forbidden(
        `This action requires one of: ${roles.join(', ')}. Your role is ${user.role}.`,
      );
    }
    return user;
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const username = credentials.username?.trim().toLowerCase();
    if (!username || !credentials.password) throw AuthError.invalidCredentials();

    const user = await this.repository.getUserByUsername(username);
    // Compare regardless of whether the user exists so a missing account and a
    // wrong password take the same time to answer.
    const ok = verifyPassword(credentials.password, user?.passwordHash ?? null);
    if (!user || !ok) throw AuthError.invalidCredentials();
    if (user.suspended) throw AuthError.suspended();

    const { token, expiresAt } = createSessionToken(
      user.id,
      this.sessionSecret,
      this.sessionTtlSeconds,
    );
    return { user: toAuthUser(user), token, expiresAt: expiresAt.toISOString() };
  }

  async logout(request: HttpRequest): Promise<void> {
    const token = readToken(request);
    if (!token) return;
    const payload = verifySessionToken(token, this.sessionSecret);
    if (!payload) return;
    // Tokens are stateless, so an explicit logout is recorded until the token
    // would have expired anyway.
    await this.repository.revokeSession(token, new Date(payload.exp * 1000));
  }

  listDemoAccounts(): Array<{ username: string; role: UserRole }> {
    return this.repository.listDemoAccounts();
  }

  loginCookies(token: string): string[] {
    return [buildSessionCookie(token, this.sessionTtlSeconds)];
  }

  logoutCookies(): string[] {
    return [buildClearedSessionCookie()];
  }
}

/** Bearer header wins over the cookie, so API clients can override a stale cookie. */
function readToken(request: HttpRequest): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const value = header.slice(7).trim();
    if (value) return value;
  }

  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) {
      const value = rest.join('=').trim();
      if (value) return value;
    }
  }
  return null;
}

/** Strip credentials and internal bookkeeping before a user crosses the wire. */
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    verification: user.verification,
    trust: user.trust,
    sellerProfile: user.sellerProfile,
  };
}
