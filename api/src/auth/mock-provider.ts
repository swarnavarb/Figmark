import type { HttpRequest } from '@azure/functions';
import type {
  AuthMode,
  AuthUser,
  DemoAccount,
  LoginRequest,
  LoginResponse,
} from '../../../shared/contracts.js';
import type { Capability } from '../../../shared/enums.js';
import { deriveCapabilities, hasAnyCapability } from '../../../shared/capabilities.js';
import { randomUUID } from 'node:crypto';
import type { SignupRequest } from '../../../shared/contracts.js';
import type { User, VerificationState } from '../../../shared/models.js';
import type { Repository } from '../data/repository.js';
import { AuthError } from './errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
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

  async requireCapability(
    request: HttpRequest,
    capabilities: readonly Capability[],
  ): Promise<AuthUser> {
    const user = await this.requireAuth(request);
    if (!hasAnyCapability(user.capabilities, capabilities)) {
      throw AuthError.forbidden(
        `This action requires one of: ${capabilities.join(', ')}.`,
      );
    }
    return user;
  }

  async login(credentials: LoginRequest): Promise<LoginResponse> {
    const identifier = credentials.identifier?.trim();
    if (!identifier || !credentials.password) throw AuthError.invalidCredentials();

    const user = await this.repository.getUserByIdentifier(identifier);
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

  /**
   * Creates an account and signs it straight in.
   *
   * Only the mock provider implements this: a real identity provider owns
   * registration, so `AuthService` does not require it.
   */
  async signup(request: SignupRequest): Promise<LoginResponse> {
    const displayName = request.displayName?.trim();
    const email = request.email?.trim().toLowerCase();
    const phone = request.phone?.trim();

    if (!displayName) throw new AuthError(400, 'invalid_signup', 'Please enter your name.');
    if (!email || !email.includes('@')) {
      throw new AuthError(400, 'invalid_signup', 'Please enter a valid email address.');
    }
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      throw new AuthError(400, 'invalid_signup', 'Please enter a valid phone number.');
    }
    if (!request.password || request.password.length < 8) {
      throw new AuthError(400, 'invalid_signup', 'Password must be at least 8 characters.');
    }

    const now = new Date().toISOString();
    const blank: VerificationState = {
      // Signup collects the minimum. Phone and email are treated as verified
      // here because the mock has no way to send a code; a real provider marks
      // them pending until the code round-trips.
      phone: 'verified',
      email: 'verified',
      governmentId: 'unverified',
      address: 'unverified',
      paymentMethod: 'unverified',
      bankAccountMatch: 'unverified',
      businessRegistration: 'unverified',
      lastReviewedAt: null,
      lastReviewedBy: null,
    };

    let created: User;
    try {
      created = await this.repository.createUser({
        id: `usr_${randomUUID().slice(0, 12)}`,
        email,
        phone,
        displayName,
        isAdmin: false,
        passwordHash: hashPassword(request.password),
        verification: blank,
        buyerTrust: { score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null },
        sellerTrust: {
          score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null,
          onTimeDispatchRate: null, repeatCustomerRate: null,
        },
        // No storefront yet: it appears the first time they list something.
        sellerProfile: null,
        forwarderProfile: null,
        suspended: false,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      throw new AuthError(409, 'identifier_taken', error instanceof Error ? error.message : 'That account already exists.');
    }

    const { token, expiresAt } = createSessionToken(created.id, this.sessionSecret, this.sessionTtlSeconds);
    return { user: toAuthUser(created), token, expiresAt: expiresAt.toISOString() };
  }

  listDemoAccounts(): DemoAccount[] {
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
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    capabilities: deriveCapabilities(user),
    verification: user.verification,
    buyerTrust: user.buyerTrust,
    sellerTrust: user.sellerTrust,
    sellerProfile: user.sellerProfile,
    forwarderProfile: user.forwarderProfile,
  };
}
