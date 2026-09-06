/**
 * Auth failures carry an HTTP status so route handlers can translate them
 * uniformly without knowing which provider raised them.
 */
export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
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

  /** A token arrived, but this server could not verify its signature. */
  static sessionUnverified(): AuthError {
    return new AuthError(
      401,
      'session_unverified',
      'This session could not be verified by the server. Sign in again.',
    );
  }

  /** A valid token whose session was explicitly ended. */
  static sessionEnded(): AuthError {
    return new AuthError(401, 'session_ended', 'This session was signed out. Sign in again.');
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
  static accountMissing(): AuthError {
    return new AuthError(
      401,
      'account_unavailable',
      'Your account is no longer available on this server. Accounts are not durable until a database is configured.',
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
