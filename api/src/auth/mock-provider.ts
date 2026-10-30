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
import { USERNAME_PROBLEMS, checkUsername, handleShapeProblem, suggestUsername } from '../../../shared/handles.js';
import { PASSWORD_MAX_LENGTH, hashPasswordAsync, passwordProblem, verifyPasswordAsync } from './passwords.js';
import { normalizeIndianMobile, verifiedChecks } from '../../../shared/verification.js';
import { LEGAL_VERSION } from '../../../shared/legal.js';
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
import { hashRecovery, matchStep, newRecoveryCodes, newSecret, otpauthUri } from './totp.js';
import { VerificationError, consumePasswordResetCode, startPasswordReset } from '../verification/index.js';

/** Who a request turned out to be, and the session and account record that said so. */
interface Resolution {
  user: AuthUser | null;
  token?: string;
  /** The account as read; null when the answer came from the token's snapshot. */
  record?: User | null;
}

/**
 * The password provider: username + password against the accounts in the store.
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

  /**
   * Who a request is, worked out once per request.
   *
   * Every route asks, and /api/auth/me then asks twice more - to renew the
   * cookie and to hand out the device cookie - and each answer is a revocation
   * read, an account read and its parts. Held against the request object, the
   * second and third ask cost nothing; the next request starts afresh.
   */
  private readonly resolved = new WeakMap<object, Promise<Resolution>>();

  private resolve(request: HttpRequest): Promise<Resolution> {
    let found = this.resolved.get(request);
    if (!found) {
      found = this.lookUp(request);
      this.resolved.set(request, found);
      // A failed read is not an answer: the next ask in this request tries again.
      found.catch(() => this.resolved.delete(request));
    }
    return found;
  }

  private async lookUp(request: HttpRequest): Promise<Resolution> {
    if (!this.sessionSecret) return { user: null };
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
        return { user: user.suspended ? null : toAuthUser(user), token, record: user };
      }

      // It found nobody. With a real database that means the account is gone
      // and the session is over. With the per-worker store it far more likely
      // means this worker simply never saw the sign-up, so fall back to the
      // snapshot the token carries rather than throwing the user out.
      if (this.storeIsEphemeral && payload.usr) return { user: fromSnapshot(payload.usr as AuthUser), token, record: null };
    }
    return { user: null };
  }

  async getCurrentUser(request: HttpRequest): Promise<AuthUser | null> {
    return (await this.resolve(request)).user;
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
    // Operating the marketplace moves other people's money: not on a password alone.
    if (capabilities.includes('admin') && user.capabilities.isAdmin && user.mfaRequired) throw staffMfaMissing();
    if (!hasAnyCapability(user.capabilities, capabilities)) {
      // Buying and selling are closed until verification is done, and the
      // person needs to be told what to do rather than that they may not.
      if (capabilities.includes('buy') || capabilities.includes('sell')) throw AuthError.verificationRequired(capabilities, verifiedChecks(user));
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

    // An email or phone first; failing that, a username - with or without its @.
    const user = await this.accountFor(identifier);

    // Guessing spread over many addresses is capped per account - but only for
    // devices that have never signed in to it. The owner's browser carries the
    // device cookie and is never refused for somebody else's guessing.
    const accountKey = user ? `acct:${user.id}` : `acct:${identifier.toLowerCase()}`;
    const trusted = user ? this.trustsDevice(user, client.device) : false;
    if (!trusted && await limited(accountKey, 'login_fail_account', { count: false, force: true })) {
      throw new AuthError(
        429,
        'too_many_attempts',
        'Too many failed sign-in attempts on this account. Try again later, from a device you have signed in on before, ' +
          'or reset your password with "Forgot your password?" - that lifts this hold.',
      );
    }

    // Compare regardless of whether the user exists so a missing account and a
    // wrong password take the same time to answer.
    const ok = await verifyPasswordAsync(credentials.password, user?.passwordHash ?? null);

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
          'Nobody has an account here yet: this deployment is connected to a database that holds none. ' +
            `${status.detail} Sign up to create the first one.`,
        );
      }
    }

    if (!user || !ok) {
      await limited(key, 'login_fail', { force: true });
      if (!trusted) await limited(accountKey, 'login_fail_account', { force: true });
      throw AuthError.invalidCredentials();
    }
    if (user.suspended) throw AuthError.suspended();

    // The second factor, for an account that has one. A wrong code counts as
    // a failed sign-in like a wrong password does.
    if (mfaOn(user)) {
      if (!credentials.otp?.trim()) {
        throw new AuthError(401, 'mfa_required', 'Enter the 6-digit code from your authenticator app.');
      }
      if (!(await this.spendSecondFactor(user, credentials.otp))) {
        await limited(key, 'login_fail', { force: true });
        if (!trusted) await limited(accountKey, 'login_fail_account', { force: true });
        throw new AuthError(401, 'mfa_invalid', 'That code is not right. Use the newest code in your app, or a recovery code.');
      }
    }

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
   * The device cookie for a signed-in browser that does not yet carry a valid one.
   *
   * Not sent with the sign-in itself: a response gets through Azure with only
   * one Set-Cookie (see `json`), and there it must be the session. The app asks
   * /api/auth/me straight after signing in, and this is handed out there.
   */
  async missingDeviceCookies(userId: string, request: HttpRequest): Promise<string[]> {
    if (!this.sessionSecret) return [];
    const known = await this.resolve(request);
    const user = known.record?.id === userId ? known.record : await this.repository.getUserById(userId);
    if (!user || this.trustsDevice(user, deviceCookieValue(request.headers.get('cookie')))) return [];
    return this.deviceCookies(userId, request);
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
    // To the millisecond: tokens carry their issue time that finely (`iam`),
    // so signing in again a moment later, in the same second, is not undone.
    // One past now, so a device that signed in this very millisecond - a fast
    // host manages it - is signed out too; signing in again takes a password
    // check, which is never that quick.
    user.sessionsValidAfter = new Date(Date.now() + 1).toISOString();
    await this.repository.updateUser(user);
    await this.logout(request);
  }

  /** Whether this is the account's password, for an action that asks for it again. */
  async passwordMatches(userId: string, password: string): Promise<boolean> {
    if (!password || password.length > PASSWORD_MAX_LENGTH) return false;
    const user = await this.repository.getUserById(userId);
    return verifyPasswordAsync(password, user?.passwordHash ?? null);
  }

  /**
   * Checks an authenticator or recovery code and spends it: the step is
   * recorded so the same code cannot sign in twice, a recovery code is struck.
   */
  private async spendSecondFactor(user: User, code: string): Promise<boolean> {
    const mfa = user.mfa;
    if (!mfa?.secret) return false;
    const step = matchStep(mfa.secret, code, mfa.lastStep ?? null);
    if (step !== null) {
      user.mfa = { ...mfa, lastStep: step };
      await this.repository.updateUser(user);
      return true;
    }
    const hash = hashRecovery(code);
    if (mfa.recovery.includes(hash)) {
      user.mfa = { ...mfa, recovery: mfa.recovery.filter((entry) => entry !== hash) };
      await this.repository.updateUser(user);
      return true;
    }
    return false;
  }

  /** Starts setting up two-factor: a fresh key, held until a code from it comes back. */
  async startMfaSetup(userId: string, password: string): Promise<{ secret: string; uri: string }> {
    const user = await this.repository.getUserById(userId);
    if (!user) throw AuthError.accountMissing();
    if (!(await this.passwordMatches(userId, password))) throw new AuthError(403, 'wrong_password', 'That is not your password.');
    if (mfaOn(user)) throw new AuthError(409, 'mfa_on', 'Two-factor sign-in is already on.');
    const secret = newSecret();
    user.mfa = { secret: null, enabledAt: null, lastStep: null, recovery: [], ...user.mfa, pending: { secret, createdAt: new Date().toISOString() } };
    await this.repository.updateUser(user);
    return { secret, uri: otpauthUri(secret, user.email) };
  }

  /** Turns two-factor on with the first code from the new key. Returns the recovery codes, shown once. */
  async enableMfa(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.repository.getUserById(userId);
    if (!user) throw AuthError.accountMissing();
    const pending = user.mfa?.pending;
    if (!pending || Date.now() - Date.parse(pending.createdAt) > 30 * 60_000) {
      throw new AuthError(410, 'setup_expired', 'Setting up took too long. Start again.');
    }
    const step = matchStep(pending.secret, code, null);
    if (step === null) throw new AuthError(400, 'wrong_code', 'That code is not right. Check the time on your phone and try the newest code.');
    const recoveryCodes = newRecoveryCodes();
    user.mfa = {
      secret: pending.secret, enabledAt: new Date().toISOString(), lastStep: step,
      recovery: recoveryCodes.map(hashRecovery), pending: null,
    };
    await this.repository.updateUser(user);
    return { recoveryCodes };
  }

  /** Turns two-factor off, with the password and a current code (or a recovery code). */
  async disableMfa(userId: string, password: string, code: string): Promise<void> {
    const user = await this.repository.getUserById(userId);
    if (!user) throw AuthError.accountMissing();
    if (!mfaOn(user)) return;
    if (!(await this.passwordMatches(userId, password))) throw new AuthError(403, 'wrong_password', 'That is not your password.');
    if (!(await this.spendSecondFactor(user, code))) throw new AuthError(400, 'wrong_code', 'That code is not right.');
    user.mfa = null;
    await this.repository.updateUser(user);
  }

  /** The account an email, phone or username names, as sign-in finds it. */
  private async accountFor(identifier: string): Promise<User | null> {
    const handle = identifier.replace(/^@/, '');
    // A mobile number however it is typed - 98765 43210, 09876543210, +91… -
    // is the one sign-up stored, which is always +91 and ten digits.
    const mobile = identifier.includes('@') ? null : normalizeIndianMobile(identifier);
    return (mobile ? await this.repository.getUserByIdentifier(mobile) : null)
      ?? (await this.repository.getUserByIdentifier(identifier))
      ?? (handleShapeProblem(handle) === null ? (await this.repository.getByHandle(handle))?.user ?? null : null);
  }

  /**
   * Emails a password reset code, when the identifier names an account with a
   * confirmed email. Answers alike whether or not it does, so the form cannot
   * be used to find out who has an account here.
   */
  async requestPasswordReset(identifier: string): Promise<{ devCode?: string }> {
    this.requireSigningKey();
    const named = identifier.trim();
    if (!named) throw new AuthError(400, 'invalid_request', 'Enter the email, phone or username you sign in with.');
    const user = await this.accountFor(named);
    if (!user) return {};
    if (await limited(`acct:${user.id}`, 'reset_account')) return {};
    const sent = await startPasswordReset(this.repository, user);
    return sent.devCode ? { devCode: sent.devCode } : {};
  }

  /**
   * Sets a new password with an emailed code, and signs in with it.
   *
   * Every other session ends: whoever made the reset necessary may be signed
   * in somewhere. Failed sign-ins counted against the account are cleared, so
   * the owner is not held back by the guessing that may have led here.
   */
  async resetPassword(body: { identifier?: string; code?: string; password?: string; otp?: string }, client: ClientContext = {}): Promise<LoginResponse> {
    this.requireSigningKey();
    const named = body.identifier?.trim() ?? '';
    const password = body.password ?? '';
    const user = named ? await this.accountFor(named) : null;
    if (!user || user.suspended) throw new AuthError(410, 'code_expired', 'That code has expired, or none was sent. Ask for a new one.');

    const weak = await passwordProblem(password, {
      email: user.email, username: user.username ?? undefined, displayName: user.displayName,
    }, { breachCheck: config.passwordBreachCheck });
    if (weak) throw new AuthError(400, 'invalid_password', weak);

    // An emailed code alone must not undo two-factor: whoever holds the inbox
    // still needs the app, or a recovery code.
    if (mfaOn(user)) {
      if (!body.otp?.trim()) throw new AuthError(401, 'mfa_required', 'Enter the 6-digit code from your authenticator app too.');
      if (!(await this.spendSecondFactor(user, body.otp))) {
        throw new AuthError(401, 'mfa_invalid', 'That authenticator code is not right. Use the newest code, or a recovery code.');
      }
    }
    try {
      await consumePasswordResetCode(this.repository, user, body.code ?? '');
    } catch (err) {
      if (err instanceof VerificationError) throw new AuthError(err.status, err.code, err.message);
      throw err;
    }
    user.passwordHash = await hashPasswordAsync(password);
    user.sessionsValidAfter = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
    await this.repository.updateUser(user);
    await forget(`acct:${user.id}`, 'login_fail_account');
    await forget(`${named.toLowerCase()}|${client.ip ?? 'unknown'}`, 'login_fail');

    const principal = toAuthUser(user);
    const { token, expiresAt } = createSessionToken(
      user.id,
      this.sessionSecret,
      this.sessionTtlSeconds,
      this.storeIsEphemeral ? principal : undefined,
    );
    return { user: principal, token, expiresAt: expiresAt.toISOString() };
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
      // The token this request was already recognised by needs no second look.
      const known = await this.resolve(request);
      if (known.token !== token && await this.repository.isSessionRevoked(token)) continue;
      const user = known.token === token ? known.record ?? null : await this.repository.getUserById(payload.sub);
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
    // Whoever this request was, it is nobody once signed out.
    this.resolved.delete(request);
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
    if (request.acceptTerms !== true) {
      throw new AuthError(400, 'terms_required', 'Agree to the Terms and the Privacy Policy to create an account.');
    }
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
    const typed = request.username?.trim().toLowerCase() || null;
    // A suggestion the form checked and showed is still ours, not theirs.
    const chosen = request.usernameSuggested ? null : typed;
    let username = typed ?? suggestUsername(displayName).toLowerCase();
    const problem = checkUsername(username);
    if (problem) throw new AuthError(400, 'invalid_signup', USERNAME_PROBLEMS[problem]);
    // Reserved once, against the account's real id. It used to be reserved
    // against a shared 'pending' placeholder, released and claimed again -
    // and two sign-ups both holding 'pending' each read the other's claim as
    // their own, while the gap between release and re-claim let a third take it.
    const userId = `usr_${randomUUID().slice(0, 12)}`;
    let reserved = await this.repository.reserveHandle(username, userId, false);
    // A handle somebody typed is theirs to change. One we made from their name
    // is ours: the sign-up form keeps it folded away, so a clash with another
    // Arjun Mehta is settled here with a short tail rather than sent back as
    // an error about a field they never opened.
    const base = username.slice(0, 25);
    for (let attempt = 0; !reserved && !chosen && attempt < 5; attempt += 1) {
      username = `${base}_${randomUUID().replace(/-/g, '').slice(0, 4)}`;
      reserved = checkUsername(username) === null && await this.repository.reserveHandle(username, userId, false);
    }
    if (!reserved) {
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

    let created: User;
    try {
      created = await this.repository.createUser({
        id: userId,
        email,
        phone,
        displayName,
        username,
        isAdmin: false,
        passwordHash: await hashPasswordAsync(request.password),
        verification: blank,
        buyerTrust: { score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null },
        sellerTrust: {
          score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null,
          onTimeDispatchRate: null, repeatCustomerRate: null,
        },
        // No storefront yet: it appears the first time they list something.
        sellerProfile: null,
        forwarderProfile: null,
        consent: { terms: LEGAL_VERSION, at: now },
        suspended: false,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      // No account came of it, so the handle goes back.
      await this.repository.releaseHandle(username).catch(() => undefined);
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
              'This server keeps accounts in memory, so this one will be lost when it restarts, and on a host with several workers some of them will not know it. The demo account is re-created each time.',
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
  if (!Number.isFinite(after)) return false;
  // A token from before `iam` existed only knows its second, so any token from
  // the second of the sign-out could have been the one in use: refused.
  return typeof payload.iam === 'number'
    ? payload.iam < after
    : payload.iat * 1000 < Math.ceil(after / 1000) * 1000;
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
  return { ...user, capabilities: { ...user.capabilities, isAdmin: isOperator(user) } };
}

/**
 * An operator: an address listed in ADMIN_EMAILS that this account has proved
 * it holds. The proof matters - without it, whoever signed up first with a
 * listed address that its owner had not yet registered was an operator.
 */
function isOperator(user: { email: string; verification: VerificationState }): boolean {
  if (!config.adminEmails.includes(user.email.trim().toLowerCase())) return false;
  const proof = user.verification.proofs?.email;
  return verifiedChecks(user).email && (proof?.address === 'seed' || proof?.address?.toLowerCase() === user.email.trim().toLowerCase());
}

export function toAuthUser(user: User): AuthUser {
  const operator = isOperator(user);
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
    mfaEnabled: mfaOn(user),
    mfaRequired: config.staffMfa && !mfaOn(user) && (operator || Boolean(user.managerRights)),
    bio: user.bio ?? '',
    photoUrl: user.photoUrl ?? null,
    coverUrl: user.coverUrl ?? null,
    tags: user.tags ?? [],
  };
}

/** Whether sign-in asks this account for a second factor. */
export function mfaOn(user: Pick<User, 'mfa'>): boolean {
  return Boolean(user.mfa?.secret && user.mfa.enabledAt);
}

/** Refusal for staff who have not turned two-factor on yet. */
export function staffMfaMissing(): AuthError {
  return new AuthError(
    403,
    'mfa_required_for_staff',
    'Turn on two-factor sign-in first (Profile → Settings → Two-factor sign-in). Operators and community managers need it to act.',
  );
}
