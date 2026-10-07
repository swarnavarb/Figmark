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
  return { status, headers, jsonBody: withoutStoreFields(body) };
}

/** What Cosmos adds to every document it hands back: how it is stored, which no reader needs. */
const STORE_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts']);

/**
 * The body with Cosmos's own fields taken out, at any depth. Routes return
 * documents straight from the database often enough that this is done once,
 * here, rather than remembered in each of them.
 */
function withoutStoreFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutStoreFields);
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!STORE_FIELDS.has(key)) out[key] = withoutStoreFields(entry);
  }
  return out;
}

export function error(status: number, code: string, message: string): HttpResponseInit {
  const body: ApiError = { error: code, message };
  return json(status, body);
}

/**
 * A Cosmos status code, when the thrown thing carries one.
 *
 * The SDK's errors are plain objects with a numeric `code`, so this is a shape
 * check rather than an instanceof: nothing else in the stack throws that shape.
 */
function storeStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown; statusCode?: unknown }).code
    ?? (err as { statusCode?: unknown }).statusCode;
  return typeof code === 'number' ? code : null;
}

/**
 * Translate a thrown error into a response.
 *
 * `AuthError` carries its own status. Anything else is unexpected, and used to
 * become "something went wrong handling this request" - which cost two rounds
 * of guessing at a missing container from the outside. So the reply now names
 * the *kind* of failure: the error's class and, for the data store, its status
 * code. No message text crosses the wire, so nothing can leak; the detail stays
 * in the log.
 */
export function toErrorResponse(err: unknown, context: InvocationContext): HttpResponseInit {
  if (err instanceof AuthError) {
    // Cookies on a refusal exist to clear a session the server just rejected,
    // so they have to reach the browser with it.
    return json(err.status, { error: err.code, message: err.message } satisfies ApiError, err.cookies);
  }

  context.error('Unhandled error in request handler', err);

  // A 404 escaping to here came from a query, not a point read - those are
  // caught where they are made - so the container itself is absent. That is a
  // deployment gap rather than a bug in the request, and it has a known fix.
  const status = storeStatus(err);
  if (status === 404) {
    return error(
      503,
      'store_incomplete',
      'This feature\'s data container does not exist in the database yet. ' +
        'Open /api/health: it names which containers are missing and how to create them.',
    );
  }

  const kind = status !== null
    ? `data store error ${status}`
    : err instanceof Error
      ? err.constructor.name
      : typeof err;
  return error(500, 'internal_error', `Something went wrong handling this request (${kind}).`);
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
