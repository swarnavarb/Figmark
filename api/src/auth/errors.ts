/**
 * Auth failures carry an HTTP status so route handlers can translate them
 * uniformly without knowing which provider raised them.
 */
export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * Set-Cookie values to send with the refusal.
   *
   * A refusal is the right moment to clear a cookie the server has just proved
   * it cannot use: left in place, the browser resends it on every request and
   * signing in again does not help.
   */
  readonly cookies: string[];

  constructor(status: number, code: string, message: string, cookies: string[] = []) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
    this.cookies = cookies;
  }

  static unauthenticated(message = 'Authentication required.'): AuthError {
    return new AuthError(401, 'unauthenticated', message);
  }

  /**
   * No session cookie or bearer token arrived with the request.
   *
   * Distinguished from the rest because it is not a problem with the session at
   * all - it is a request that carried none. Signed out is the ordinary reason;
   * a cookie the browser was never given is the other, and telling them apart
   * from the outside otherwise takes a packet capture.
   */
  static noSession(): AuthError {
    return new AuthError(
      401,
      'no_session',
      'No session was sent with this request. If you signed in just now, the browser was not given a session cookie.',
    );
  }

  /**
   * A token arrived that this server did not issue.
   *
   * Almost always means the signing key changed under it - configuring a
   * database rotates the derived key - so the cookie in the browser was signed
   * by a key that no longer exists. Clearing it is the whole fix.
   */
  static sessionUnverified(cookies: string[] = []): AuthError {
    return new AuthError(
      401,
      'session_unverified',
      'This session was not issued by this server, so it has been cleared. Sign in again.',
      cookies,
    );
  }

  /** An ordinary end of session: the token was ours, and its time ran out. */
  static sessionExpired(cookies: string[] = []): AuthError {
    return new AuthError(401, 'session_expired', 'This session has expired. Sign in again.', cookies);
  }

  /** A valid token whose session was explicitly ended. */
  static sessionEnded(cookies: string[] = []): AuthError {
    return new AuthError(
      401,
      'session_ended',
      'This session was signed out. Sign in again.',
      cookies,
    );
  }

  static forbidden(message = 'You do not have access to this resource.'): AuthError {
    return new AuthError(403, 'forbidden', message);
  }

  static invalidCredentials(): AuthError {
    return new AuthError(401, 'invalid_credentials', 'Username or password is incorrect.');
  }

  /**
   * The token is valid but the account behind it is gone.
   *
   * Worth its own code: on an ephemeral store this is the difference between
   * "you typed the wrong password" - which sends people round in circles
   * retyping a correct one - and "this server no longer has your account".
   */
  static accountMissing(cookies: string[] = []): AuthError {
    return new AuthError(
      401,
      'account_unavailable',
      'Your account is no longer available on this server. Accounts are not durable until a database is configured.',
      cookies,
    );
  }

  /**
   * Sign-in cannot be answered at all, because the store behind it is not
   * serving accounts.
   *
   * A store that is unreachable, unprovisioned or simply empty resolves every
   * identifier to nobody, which is indistinguishable from a wrong password
   * unless it is said out loud. It is a property of the deployment rather than
   * of the identifier typed in, so saying it enumerates nothing.
   */
  static signInUnavailable(detail: string): AuthError {
    return new AuthError(503, 'sign_in_unavailable', detail);
  }

  static suspended(): AuthError {
    return new AuthError(403, 'account_suspended', 'This account is suspended.');
  }

  static notImplemented(message: string): AuthError {
    return new AuthError(501, 'not_implemented', message);
  }
}
