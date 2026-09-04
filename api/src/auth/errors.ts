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

  static forbidden(message = 'You do not have access to this resource.'): AuthError {
    return new AuthError(403, 'forbidden', message);
  }

  static invalidCredentials(): AuthError {
    return new AuthError(401, 'invalid_credentials', 'Username or password is incorrect.');
  }

  static suspended(): AuthError {
    return new AuthError(403, 'account_suspended', 'This account is suspended.');
  }

  static notImplemented(message: string): AuthError {
    return new AuthError(501, 'not_implemented', message);
  }
}
