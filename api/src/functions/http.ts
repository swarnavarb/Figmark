import type { HttpResponseInit, InvocationContext } from '@azure/functions';
import type { ApiError } from '../../../shared/contracts.js';
import { AuthError } from '../auth/errors.js';

/** JSON response with optional Set-Cookie values. */
export function json(status: number, body: unknown, cookies: string[] = []): HttpResponseInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const response: HttpResponseInit = { status, headers, jsonBody: body };
  if (cookies.length > 0) {
    // Multiple Set-Cookie headers need the cookies collection, not a header.
    response.cookies = cookies.map(parseSetCookie);
  }
  return response;
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
  if (err instanceof AuthError) return error(err.status, err.code, err.message);
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

interface ParsedCookie {
  name: string;
  value: string;
  path?: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** Turn a Set-Cookie string into the structured form the runtime expects. */
function parseSetCookie(raw: string): ParsedCookie {
  const [pair, ...attributes] = raw.split(';').map((part) => part.trim());
  const separator = (pair ?? '').indexOf('=');
  const cookie: ParsedCookie = {
    name: separator === -1 ? (pair ?? '') : (pair ?? '').slice(0, separator),
    value: separator === -1 ? '' : (pair ?? '').slice(separator + 1),
  };

  for (const attribute of attributes) {
    const [key, value] = attribute.split('=');
    switch (key?.toLowerCase()) {
      case 'path':
        cookie.path = value;
        break;
      case 'max-age':
        cookie.maxAge = Number(value);
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'samesite':
        cookie.sameSite = value as ParsedCookie['sameSite'];
        break;
      default:
        break;
    }
  }
  return cookie;
}
