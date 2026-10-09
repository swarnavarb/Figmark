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
import { config } from '../config.js';
import { AuthError } from './errors.js';
import { USERNAME_PROBLEMS, checkUsername, suggestUsername } from '../../../shared/handles.js';
import { PASSWORD_MAX_LENGTH, hashPassword, passwordProblem, verifyPassword } from './passwords.js';
import { normalizeIndianMobile } from '../../../shared/verification.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_REFRESH_AFTER_SECONDS,
  buildDeviceCookie,
  deviceCookieValue,
  readDeviceEntries,
  type SessionPayload,
  type TokenFailure,
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  inspectSessionToken,
  verifySessionToken,
} from './tokens.js';
import type { AuthService, ClientContext } from './types.js';
import { forget, limited } from '../rate-limit.js';

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

  /**
   * No key, no sessions. An empty secret would make every token's signature
   * something anyone can compute, so nothing is issued or accepted until
   * AUTH_SESSION_SECRET is set - see `resolveSessionSecret` in config.ts.
   */
  private requireSigningKey(): void {
    if (this.sessionSecret) return;
    throw AuthError.signInUnavailable(
      'Sign-in is switched off: this deployment has no session signing key. Set AUTH_SESSION_SECRET ' +
        '(any long random string) in the app settings and restart.',
    );
  }

  /**
   * True when the store cannot be trusted to hold an account.
   *
   * The in-memory store is per-worker, so an account created on one worker is
   * invisible to the rest. Tokens issued while that is the case carry their own
   * copy of the principal.
   */
  private get storeIsEphemeral(): boolean {
    return this.repository.backend === 'memory';
  }

  async getCurrentUser(request: HttpRequest): Promise<AuthUser | null> {
    if (!this.sessionSecret) return null;
    // Any one of the tokens presented may be the live one, so a dead cookie
    // sitting alongside a good one must not decide the answer.
    for (const token of readTokens(request)) {
      const payload = verifySessionToken(token, this.sessionSecret);
      if (!payload) continue;

      if (await this.repository.isSessionRevoked(token)) continue;

      // The store is authoritative whenever it can be.
      const user = await this.repository.getUserById(payload.sub);
      if (user) {
        if (signedOutEverywhere(user, payload)) continue;
        return user.suspended ? null : toAuthUser(user);
      }

      // It found nobody. With a real database that means the account is gone
      // and the session is over. With the per-worker store it far more likely
      // means this worker simply never saw the sign-up, so fall back to the
      // snapshot the token carries rather than throwing the user out.
      if (this.storeIsEphemeral && payload.usr) return fromSnapshot(payload.usr as AuthUser);
    }
    return null;
  }

  async requireAuth(request: HttpRequest): Promise<AuthUser> {
    this.requireSigningKey();
    const user = await this.getCurrentUser(request);
    if (user) return user;

    // Every one of these reaches the user as "logged out", and they need
    // completely different fixes - so say which it was. Three rounds of this bug
    // were spent guessing between them from the outside.
    const tokens = readTokens(request);
    if (tokens.length === 0) throw AuthError.noSession();

    // A cookie this server cannot verify or that has expired is dead weight:
    // the browser will keep sending it on every request forever, and while it
    // does, signing in again cannot help. Clear it along with the refusal so
    // the next sign-in is the one that counts.
    const clearing = hasSessionCookie(request) ? [buildClearedSessionCookie()] : [];

    let best: TokenFailure = 'malformed';
    for (const token of tokens) {
      const result = inspectSessionToken(token, this.sessionSecret);
      if (!result.ok) {
        // Expiry is the most informative failure, so let it win the report.
        if (result.failure === 'expired') best = 'expired';
        else if (best !== 'expired') best = result.failure;
        continue;
      }

      if (await this.repository.isSessionRevoked(token)) throw AuthError.sessionEnded(clearing);

      // The account behind a valid session is gone - what an ephemeral store
      // produces after a restart, and worth saying rather than looking like a
      // logout.
      const owner = await this.repository.getUserById(result.payload.sub);
      if (!owner) throw AuthError.accountMissing(clearing);
      // Ended by "sign out everywhere", from this device or another.
      if (signedOutEverywhere(owner, result.payload)) throw AuthError.sessionEnded(clearing);

      // A valid session for an account that exists, refused anyway: suspended.
      throw AuthError.suspended();
    }

    if (best === 'expired') throw AuthError.sessionExpired(clearing);
    throw AuthError.sessionUnverified(clearing);
  }

  /**
   * Cookies to clear because the request carried a session nothing could use.
   *
   * Lets an endpoint that answers "nobody" rather than refusing - /api/auth/me -
   * still get rid of a dead cookie, so simply loading the page recovers instead
   * of waiting for the first authenticated call to fail.
   */
  async staleCookies(request: HttpRequest): Promise<string[]> {
    if (!hasSessionCookie(request)) return [];
    if (await this.getCurrentUser(request)) return [];
    return [buildClearedSessionCookie()];
  }

  async requireCapability(
    request: HttpRequest,
    capabilities: readonly Capability[],
  ): Promise<AuthUser> {
    const user = await this.requireAuth(request);
    if (!hasAnyCapability(user.capabilities, capabilities)) {
      // Buying and selling are closed until verification is done, and the
      // person needs to be told what to do rather than that they may not.
      if (capabilities.includes('buy') || capabilities.includes('sell')) throw AuthError.verificationRequired(capabilities);
      throw AuthError.forbidden(
        `This action requires one of: ${capabilities.join(', ')}.`,
      );
    }
    return user;
  }

  async login(credentials: LoginRequest, client: ClientContext = {}): Promise<LoginResponse> {
    this.requireSigningKey();
    const identifier = credentials.identifier?.trim();
    if (!identifier || !credentials.password) throw AuthError.invalidCredentials();
    // No password this long was ever accepted, and hashing one costs real CPU.
    if (credentials.password.length > PASSWORD_MAX_LENGTH) throw AuthError.invalidCredentials();

    // Failed attempts are counted per account *and* per address. Per account
    // alone, anyone could lock somebody out by typing their email with a wrong
    // password eight times; per address, all they lock out is themselves. The
    // address's own limit across every account is the route's (`login`).
    // Counted in the store, so it holds across instances and restarts.
    const key = `${identifier.toLowerCase()}|${client.ip ?? 'unknown'}`;
    if (await limited(key, 'login_fail', { count: false, force: true })) {
      throw new AuthError(
        429,
        'too_many_attempts',
        'Too many failed sign-in attempts. Try again in a few minutes.',
      );
    }

    const user = await this.repository.getUserByIdentifier(identifier);

    // Guessing spread over many addresses is capped per account - but only for
    // devices that have never signed in to it. The owner's browser carries the
    // device cookie and is never refused for somebody else's guessing.
    const accountKey = user ? `acct:${user.id}` : `acct:${identifier.toLowerCase()}`;
    const trusted = user ? this.trustsDevice(user, client.device) : false;
    if (!trusted && await limited(accountKey, 'login_fail_account', { count: false, force: true })) {
      throw new AuthError(
        429,
        'too_many_attempts',
        'Too many failed sign-in attempts on this account. Try again later, or from a device you have signed in on before.',
      );
    }

    // Compare regardless of whether the user exists so a missing account and a
    // wrong password take the same time to answer.
    const ok = verifyPassword(credentials.password, user?.passwordHash ?? null);

    // Before blaming the credentials, rule out the case where nothing could
    // have matched them. A store that is unreachable, unprovisioned or empty
    // answers every sign-in with "no such account", which reaches the user as
    // "your password is wrong" for a password that is right - and no amount of
    // retyping fixes a database that has no accounts in it.
    if (!user) {
      const status = this.repository.status();
      if (!status.connected) {
        throw AuthError.signInUnavailable(
          `Sign-in is unavailable: the ${this.repository.backend} store is not reachable. ${status.detail}`,
        );
      }
      if (status.signInAccounts === 0) {
        throw AuthError.signInUnavailable(
          'Sign-in is unavailable: this deployment is connected to a database that holds no accounts. ' +
            `${status.detail} Seed it with "npm run build:api && npm run azure:provision -- --seed".`,
        );
      }
    }

    if (!user || !ok) {
      await limited(key, 'login_fail', { force: true });
      if (!trusted) await limited(accountKey, 'login_fail_account', { force: true });
      throw AuthError.invalidCredentials();
    }
    if (user.suspended) throw AuthError.suspended();
    // A good password clears the record, so a legitimate user who mistyped
    // twice is not held back by it.
    await forget(key, 'login_fail');

    const principal = toAuthUser(user);
    const { token, expiresAt } = createSessionToken(
      user.id,
      this.sessionSecret,
      this.sessionTtlSeconds,
      this.storeIsEphemeral ? principal : undefined,
    );
    return { user: principal, token, expiresAt: expiresAt.toISOString() };
  }

  /** True when the device cookie shows this browser signed in to `user` since it last signed out everywhere. */
  private trustsDevice(user: User, device: string | null | undefined): boolean {
    const issuedAt = readDeviceEntries(device, this.sessionSecret).get(user.id);
    if (issuedAt === undefined) return false;
    const after = user.sessionsValidAfter ? Date.parse(user.sessionsValidAfter) : NaN;
    return !Number.isFinite(after) || issuedAt * 1000 >= after;
  }

  /** The device cookie to set after a successful sign-in, keeping the accounts it already names. */
  deviceCookies(userId: string, request: { headers: { get(name: string): string | null } }): string[] {
    if (!this.sessionSecret) return [];
    return [buildDeviceCookie(userId, deviceCookieValue(request.headers.get('cookie')), this.sessionSecret)];
  }

  /**
   * "Sign out everywhere": ends every session this account has, on every
   * device, this one included.
   *
   * Tokens are stateless, so they cannot be listed and revoked one by one;
   * instead the account records the moment, and any token issued before it is
   * refused from then on.
   */
  async logoutEverywhere(request: HttpRequest): Promise<void> {
    const principal = await this.requireAuth(request);
    const user = await this.repository.getUserById(principal.id);
    if (!user) throw AuthError.accountMissing();
    // Rounded up to the second, as token times are: a token from this same
    // second is one this request could have been carrying.
    const at = Math.ceil(Date.now() / 1000) * 1000;
    user.sessionsValidAfter = new Date(at).toISOString();
    await this.repository.updateUser(user);
    await this.logout(request);
  }

  /**
   * A fresh session cookie for a session in use, when it is old enough to earn one.
   *
   * Sessions are 12 hours, which used to mean being signed out mid-afternoon
   * by a sign-in from breakfast. Now a session in use is renewed - at most
   * hourly, and never past `SESSION_MAX_AGE_SECONDS` from the sign-in itself -
   * and one left alone still ends 12 hours after it was last used. Only the
   * cookie is renewed: a bearer token's holder manages its own.
   */
  async refreshCookies(request: HttpRequest): Promise<string[]> {
    if (!this.sessionSecret) return [];
    const cookieTokens = readCookieTokens(request);
    for (const token of cookieTokens) {
      const payload = verifySessionToken(token, this.sessionSecret);
      if (!payload) continue;
      const now = Math.floor(Date.now() / 1000);
      if (now - payload.iat < SESSION_REFRESH_AFTER_SECONDS) return [];
      if (await this.repository.isSessionRevoked(token)) continue;
      const user = await this.repository.getUserById(payload.sub);
      if (user ? user.suspended || signedOutEverywhere(user, payload) : !this.storeIsEphemeral) continue;
      const principal = user ? toAuthUser(user) : payload.usr ? fromSnapshot(payload.usr as AuthUser) : null;
      if (!principal) continue;
      const fresh = createSessionToken(
        payload.sub,
        this.sessionSecret,
        this.sessionTtlSeconds,
        this.storeIsEphemeral ? principal : undefined,
        payload.aut ?? payload.iat,
      );
      // Nothing to gain once the absolute limit is what decides the expiry.
      if (fresh.expiresAt.getTime() / 1000 <= payload.exp) return [];
      return [buildSessionCookie(fresh.token, Math.max(1, Math.floor(fresh.expiresAt.getTime() / 1000) - now))];
    }
    return [];
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
    this.requireSigningKey();
    const displayName = request.displayName?.trim();
    const email = request.email?.trim().toLowerCase();
    // One canonical form, so the WhatsApp sender and the Aadhaar hash can be
    // compared with it exactly.
    const phone = normalizeIndianMobile(request.phone);

    if (!displayName) throw new AuthError(400, 'invalid_signup', 'Please enter your name.');
    if (!email || !email.includes('@')) {
      throw new AuthError(400, 'invalid_signup', 'Please enter a valid email address.');
    }
    if (!phone) {
      throw new AuthError(
        400,
        'invalid_signup',
        'Please enter a valid Indian mobile number (10 digits) - the one linked to your Aadhaar and on WhatsApp.',
      );
    }
    const weak = await passwordProblem(request.password ?? '', {
      email, username: request.username, displayName,
    }, { breachCheck: config.passwordBreachCheck });
    if (weak) throw new AuthError(400, 'invalid_signup', weak);

    // A handle is how this account is addressed and messaged, so it is picked
    // at sign-up rather than bolted on later. Offered as a suggestion from the
    // name, and typed over if they would rather.
    const username = (request.username?.trim() || suggestUsername(displayName)).toLowerCase();
    const problem = checkUsername(username);
    if (problem) throw new AuthError(400, 'invalid_signup', USERNAME_PROBLEMS[problem]);
    if (!(await this.repository.reserveHandle(username, 'pending', false))) {
      throw new AuthError(409, 'username_taken', `@${username} is already taken.`);
    }

    const now = new Date().toISOString();
    const blank: VerificationState = {
      // Nothing is verified by being typed in. Email is confirmed by a code
      // straight after sign-up, the phone over WhatsApp and the Aadhaar by its
      // signed QR - see api/src/verification.
      phone: 'unverified',
      email: 'pending',
      governmentId: 'unverified',
      address: 'unverified',
      paymentMethod: 'unverified',
      bankAccountMatch: 'unverified',
      businessRegistration: 'unverified',
      lastReviewedAt: null,
      lastReviewedBy: null,
    };

    const userId = `usr_${randomUUID().slice(0, 12)}`;
    // The handle was reserved against a placeholder to close the race; now that
    // the id exists, point it at the account it actually belongs to.
    await this.repository.releaseHandle(username);
    await this.repository.reserveHandle(username, userId, false);

    let created: User;
    try {
      created = await this.repository.createUser({
        id: userId,
        email,
        phone,
        displayName,
        username,
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

    const principal = toAuthUser(created);
    const { token, expiresAt } = createSessionToken(
      created.id,
      this.sessionSecret,
      this.sessionTtlSeconds,
      this.storeIsEphemeral ? principal : undefined,
    );
    return {
      user: principal,
      token,
      expiresAt: expiresAt.toISOString(),
      // Told at the moment it matters, rather than discovered later when the
      // account has silently gone.
      ...(this.storeIsEphemeral
        ? {
            warning:
              'This server keeps accounts in memory, so this one will be lost when it restarts. The demo account is re-created each time.',
          }
        : {}),
    };
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

/**
 * Every session token the request carries, best first.
 *
 * Plural, deliberately. A browser can hold more than one cookie of the same
 * name - they are keyed by name *and* domain and path, so a cookie written
 * under one scope sits alongside one written under another and both are sent.
 * Taking the first meant a stale cookie could shadow a good one permanently:
 * signing in again wrote a fresh cookie that was never the one read, so the
 * session appeared broken in a way no amount of signing in could fix.
 *
 * The bearer header still wins, so an API client can override a cookie outright.
 */
function readTokens(request: HttpRequest): string[] {
  const tokens: string[] = [];

  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const value = header.slice(7).trim();
    if (value) tokens.push(value);
  }

  tokens.push(...readCookieTokens(request));
  return tokens;
}

/** The session tokens carried in cookies only - the ones this server may renew. */
function readCookieTokens(request: HttpRequest): string[] {
  const tokens: string[] = [];
  const cookie = request.headers.get('cookie');
  if (!cookie) return tokens;
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = rest.join('=').trim();
    if (value) tokens.push(value);
  }
  return tokens;
}

/** True when the account signed out everywhere after this token was issued. */
function signedOutEverywhere(user: User, payload: SessionPayload): boolean {
  if (!user.sessionsValidAfter) return false;
  const after = Date.parse(user.sessionsValidAfter);
  return Number.isFinite(after) && payload.iat * 1000 < after;
}

/** True when the request presented a session cookie, whatever its state. */
function hasSessionCookie(request: HttpRequest): boolean {
  const cookie = request.headers.get('cookie');
  if (!cookie) return false;
  return cookie.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

function readToken(request: HttpRequest): string | null {
  return readTokens(request)[0] ?? null;
}

/**
 * Strip credentials and internal bookkeeping before a user crosses the wire.
 *
 * `isAdmin` is taken from configuration rather than from the row. Operating the
 * marketplace means deleting accounts and handing out the right to hold other
 * people's money, so it has to be something a deployment is configured with -
 * never something a row can acquire through a bug in a write path, and never
 * something that survives being copied between databases.
 */
/**
 * The forwarder's directory line, without the store behind it.
 *
 * This object rides in the session cookie, and a store's lanes, cover terms
 * and review history pushed a real one past the 4 KB a browser will keep -
 * the forwarder signed in, and was signed straight back out. Nothing in the
 * app reads the store from the session; the console fetches it.
 */
function forwarderSummary(profile: User['forwarderProfile']): AuthUser['forwarderProfile'] {
  if (!profile) return null;
  return {
    companyName: profile.companyName,
    directorySlug: profile.directorySlug,
    description: profile.description.slice(0, 200),
    routes: [],
    contactEmail: profile.contactEmail,
    contactPhone: profile.contactPhone,
    claimedMonthlyCapacityKg: profile.claimedMonthlyCapacityKg,
    trust: profile.trust,
    listedInDirectory: profile.listedInDirectory,
    status: profile.status,
  };
}

/**
 * A principal carried in a token, with the operator flag re-derived.
 *
 * Only the in-memory store uses these, but whatever a token carries is only as
 * trustworthy as its signature - and admin is never taken on a token's word.
 */
function fromSnapshot(user: AuthUser): AuthUser {
  const operator = config.adminEmails.includes(user.email.trim().toLowerCase());
  return { ...user, capabilities: { ...user.capabilities, isAdmin: operator } };
}

export function toAuthUser(user: User): AuthUser {
  const operator = config.adminEmails.includes(user.email.trim().toLowerCase());
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username ?? null,
    email: user.email,
    phone: user.phone,
    capabilities: { ...deriveCapabilities(user), isAdmin: operator },
    verification: user.verification,
    buyerTrust: user.buyerTrust,
    sellerTrust: user.sellerTrust,
    sellerProfile: user.sellerProfile,
    forwarderProfile: forwarderSummary(user.forwarderProfile),
    managerRights: user.managerRights ?? null,
    bio: user.bio ?? '',
    coverUrl: user.coverUrl ?? null,
    tags: user.tags ?? [],
  };
}
