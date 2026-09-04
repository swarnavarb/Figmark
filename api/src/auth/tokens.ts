import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless session tokens for the mock auth provider.
 *
 * Deliberately a minimal signed envelope rather than a JWT library: the real
 * provider will issue its own tokens and this code is expected to be deleted,
 * so it should not accrete dependencies. Format is `<payload>.<signature>`,
 * both base64url.
 */

export interface SessionPayload {
  /** User id. */
  sub: string;
  /** Issued-at, epoch seconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(
  userId: string,
  secret: string,
  ttlSeconds: number,
): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiry = issuedAt + ttlSeconds;
  const payload: SessionPayload = { sub: userId, iat: issuedAt, exp: expiry };
  const encoded = base64url(JSON.stringify(payload));
  return {
    token: `${encoded}.${sign(encoded, secret)}`,
    expiresAt: new Date(expiry * 1000),
  };
}

/** Returns the payload when the signature is valid and unexpired, else null. */
export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];

  const expected = Buffer.from(sign(encoded, secret));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export const SESSION_COOKIE_NAME = 'figmark_session';

export function buildSessionCookie(token: string, maxAgeSeconds: number): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
