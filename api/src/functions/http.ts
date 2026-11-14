import { AsyncLocalStorage } from 'node:async_hooks';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ApiError } from '../../../shared/contracts.js';
import { AuthError } from '../auth/errors.js';
import { StaleWriteError } from '../data/concurrency.js';
import { getRepository } from '../data/index.js';
import { writeBackstop } from '../rate-limit.js';
import { syncRouteWords } from '../route-library.js';

/**
 * JSON response with optional Set-Cookie values.
 *
 * The cookies go out as real Set-Cookie headers rather than through the
 * runtime's structured `cookies` collection. The collection is a convenience
 * the host translates for us, and depending on it put the entire session on one
 * runtime feature: the local dev server implemented it by hand, so every test
 * passed while the deployed host emitted no cookie at all and every
 * authenticated request arrived anonymous. A header is what reaches the browser
 * either way.
 *
 * One cookie per response, at most. The Functions runtime copies response
 * headers into a plain object (`headers[key] = value` in @azure/functions), so
 * of two Set-Cookie headers only the last reaches the browser. When sign-in
 * started sending a device cookie after the session cookie, the session was
 * the one dropped: sign-in answered 200 and the very next request was
 * anonymous. So only the last is sent here too, and every test sees exactly
 * what the browser on Azure would get.
 */
export function json(status: number, body: unknown, cookies: string[] = []): HttpResponseInit {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies.slice(-1)) headers.append('Set-Cookie', cookie);
  return { status, headers, jsonBody: withoutStoreFields(body) };
}

/**
 * Fields no response ever carries, at any depth: what Cosmos adds to every
 * document it hands back (how it is stored, which no reader needs), and what
 * an account keeps for the server alone - its password hash and its search
 * words. Routes map accounts to what each screen shows; this is the net under
 * that, so a route that forgets cannot send a hash to the browser.
 */
const STORE_FIELDS = new Set(['_rid', '_self', '_etag', '_attachments', '_ts', '_parts', 'passwordHash', 'searchKey', 'mfa', 'challenges', 'viewLog']);

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

/**
 * A response the browser may reuse for a while without asking again. For the
 * few reads every page load makes whose answer rarely changes.
 */
export function cached(response: HttpResponseInit, cacheControl: string): HttpResponseInit {
  (response.headers as Headers).set('Cache-Control', cacheControl);
  return response;
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

  // Two requests changed the same thing at once and this one lost. Nothing
  // was written, so trying again against what won is all it takes.
  if (err instanceof StaleWriteError || storeStatus(err) === 412) {
    return error(409, 'changed_meanwhile', err instanceof StaleWriteError
      ? err.message
      : 'Someone else changed this at the same moment. Reload and try again.');
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
      'This feature is temporarily unavailable. Please try again later.',
    );
  }

  return error(500, 'internal_error', 'Something went wrong. Please try again.');
}

/**
 * The largest request body any route reads.
 *
 * Every route parses its whole body before it can say "too long", so without
 * a cap here a 60 MB post cost a second of CPU and 150 MB of memory before
 * being refused - a few at once could take a worker down. The biggest real
 * body is one photo sent as a data URL (900 KB of image, a third more as
 * base64) with room to spare.
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** A refusal for a body declared larger than any route accepts, before it is read. */
function oversized(request: unknown): HttpResponseInit | null {
  const headers = (request as { headers?: { get?: (name: string) => string | null } } | undefined)?.headers;
  if (typeof headers?.get !== 'function') return null;
  const declared = Number(headers.get('content-length'));
  if (!Number.isFinite(declared) || declared <= MAX_BODY_BYTES) return null;
  return error(413, 'body_too_large', 'That is more than Figmark accepts in one go. Send something smaller.');
}

/**
 * A write sent the way only a cross-site form or a no-CORS request could.
 *
 * Browsers let another page post a form - urlencoded, multipart or plain text
 * - anywhere, cookies and all where SameSite allows it (a sibling subdomain
 * counts as the same site). This app never sends those: its writes are JSON,
 * or a photo's own image type. So a write in one of them is refused before it
 * is read, which closes form-based CSRF whatever the cookie's scope.
 */
function crossSiteForm(request: unknown): HttpResponseInit | null {
  const req = request as { method?: string; headers?: { get?: (name: string) => string | null } } | undefined;
  if (typeof req?.headers?.get !== 'function') return null;
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  // What the browser itself says about where the request came from (Fetch
  // Metadata), which no page can set. The app's own writes are same-origin;
  // one from another site - or a sibling subdomain, which SameSite=Lax lets
  // carry the cookie - is somebody else's page acting as the visitor. Absent,
  // as from a server (WhatsApp's webhook) or an older browser, the content
  // type check below still stands.
  const site = (req.headers.get('sec-fetch-site') ?? '').trim().toLowerCase();
  if (site === 'cross-site' || site === 'same-site') {
    return error(403, 'cross_site_request', 'This request did not come from Figmark. Open Figmark and try again.');
  }
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data' && type !== 'text/plain') return null;
  return error(415, 'unsupported_media_type', 'Send this as JSON.');
}

/** The write backstop (rate-limit.ts), for anything shaped like a request. */
function backstop(request: unknown): HttpResponseInit | null {
  const req = request as { headers?: { get?: unknown } } | undefined;
  if (typeof req?.headers?.get !== 'function') return null;
  return writeBackstop(request as HttpRequest);
}

/**
 * Set while a route is answering, so a route another route calls in-process
 * (the bootstrap's nine reads, a batch's one item at a time) knows it is not
 * answering the browser: its caller reads its jsonBody, so it must keep one.
 */
const answering = new AsyncLocalStorage<true>();

/** Smaller than this, a JSON answer goes as it is: compressing would barely save a packet. */
const COMPRESS_MIN_BYTES = 1024;

/** The encodings this request accepts, of the two the API speaks. */
function acceptedEncoding(request: unknown): 'br' | 'gzip' | null {
  const headers = (request as { headers?: { get?: (name: string) => string | null } } | undefined)?.headers;
  if (typeof headers?.get !== 'function') return null;
  const accepted = new Set(
    (headers.get('accept-encoding') ?? '')
      .split(',')
      .map((part) => part.trim().toLowerCase().split(';'))
      .filter(([, q]) => !q || !/^q=0(\.0*)?$/.test(q.trim()))
      .map(([name]) => name),
  );
  if (accepted.has('br')) return 'br';
  if (accepted.has('gzip')) return 'gzip';
  return null;
}

/**
 * A JSON answer compressed, when the browser accepts it and it is worth it.
 *
 * The catalogue, Discover's lists and the bootstrap run to tens or hundreds of
 * kilobytes of JSON, and Static Web Apps compresses the static files but sends
 * what a Function answers as it is. Brotli at a low quality: most of the
 * saving, for a few milliseconds of a worker's time.
 */
function compressed(request: unknown, response: HttpResponseInit): HttpResponseInit {
  if (response.jsonBody === undefined || response.body !== undefined) return response;
  const encoding = acceptedEncoding(request);
  if (!encoding) return response;
  const text = JSON.stringify(response.jsonBody);
  if (text === undefined || Buffer.byteLength(text) < COMPRESS_MIN_BYTES) return response;
  const body = encoding === 'br'
    ? brotliCompressSync(text, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: text.length } })
    : gzipSync(text, { level: 6 });
  const headers = new Headers(response.headers as ConstructorParameters<typeof Headers>[0]);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Content-Encoding', encoding);
  headers.append('Vary', 'Accept-Encoding');
  const { jsonBody: _sent, ...rest } = response;
  return { ...rest, headers, body };
}

/** Wrap a handler so every route gets uniform error translation. */
export function handler<Args extends unknown[]>(
  fn: (...args: [...Args, InvocationContext]) => Promise<HttpResponseInit>,
): (...args: [...Args, InvocationContext]) => Promise<HttpResponseInit> {
  const answer = async (...args: [...Args, InvocationContext]) => {
    const context = args[args.length - 1] as InvocationContext;
    const refused = oversized(args[0]) ?? crossSiteForm(args[0]) ?? backstop(args[0]);
    if (refused) return refused;
    try {
      /* The route short forms every label is drawn with: read at most once a
         minute per worker, and never the reason a request fails. */
      await getRepository().then((repository) => syncRouteWords(repository)).catch(() => {});
      return await fn(...args);
    } catch (err) {
      return toErrorResponse(err, context);
    }
  };
  return async (...args) => {
    // Called from inside another route: answer as before, for that route to read.
    if (answering.getStore()) return answer(...args);
    const response = await answering.run(true, () => answer(...args));
    return compressed(args[0], response);
  };
}
