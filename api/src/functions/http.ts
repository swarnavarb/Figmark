import type { HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ApiError } from '../../../shared/contracts.js';
import { AuthError } from '../auth/errors.js';

/**
 * JSON response with optional Set-Cookie values.
 *
 * The cookies go out as real Set-Cookie headers rather than through the
 * runtime's structured `cookies` collection. The collection is a convenience
 * the host translates for us, and depending on it put the entire session on one
 * runtime feature: the local dev server implemented it by hand, so every test
 * passed while the deployed host emitted no cookie at all and every
 * authenticated request arrived anonymous. A header is what reaches the browser
 * either way. `Headers` is used rather than a plain object because Set-Cookie
 * is the one header that legitimately repeats.
 */
export function json(status: number, body: unknown, cookies: string[] = []): HttpResponseInit {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return { status, headers, jsonBody: body };
}

export function error(status: number, code: string, message: string): HttpResponseInit {
  const body: ApiError = { error: code, message };
  return json(status, body);
}

/**
 * Translate a thrown error into a response.
 *
 * `AuthError` carries its own status. Anything else is unexpected: it is logged
 * with detail and returned to the caller without it.
 */
export function toErrorResponse(err: unknown, context: InvocationContext): HttpResponseInit {
  if (err instanceof AuthError) {
    // Cookies on a refusal exist to clear a session the server just rejected,
    // so they have to reach the browser with it.
    return json(err.status, { error: err.code, message: err.message } satisfies ApiError, err.cookies);
  }
  context.error('Unhandled error in request handler', err);
  return error(500, 'internal_error', 'Something went wrong handling this request.');
}

/** Wrap a handler so every route gets uniform error translation. */
export function handler<Args extends unknown[]>(
  fn: (...args: [...Args, InvocationContext]) => Promise<HttpResponseInit>,
): (...args: [...Args, InvocationContext]) => Promise<HttpResponseInit> {
  return async (...args) => {
    const context = args[args.length - 1] as InvocationContext;
    try {
      return await fn(...args);
    } catch (err) {
      return toErrorResponse(err, context);
    }
  };
}
