import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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
  /**
   * When the person actually signed in, epoch seconds. A refreshed token keeps
   * it, so a session that is kept alive still ends `SESSION_MAX_AGE_SECONDS`
   * after the password was typed. Absent on tokens older than refresh, which
   * count from `iat`.
   */
  aut?: number;
  /**
   * Random per token. Without it two sign-ins to one account in the same
   * second produced the very same token, so signing out on one device
   * revoked the other as well.
   */
  jti?: string;
  /**
   * A snapshot of the principal, carried in the token itself.
   *
   * Only populated when the store behind the API is not durable. The host runs
   * several workers, each with its own in-memory store, so an account created
   * on one worker does not exist on the others: the token verifies, the lookup
   * finds nobody, and the user is thrown out mid-session. The snapshot lets any
   * worker answer from the signed token when its own store has never heard of
   * the account.
   *
   * Safe because the whole payload is HMAC-signed - a client cannot edit it -
   * but it is a snapshot, so it is only ever a fallback. A real store is always
   * consulted first, and stays authoritative.
   */
  usr?: unknown;
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
  /** Snapshot to embed; pass only when the store cannot be relied on. */
  snapshot?: unknown,
  /** When the person signed in, for a refreshed token; now for a new sign-in. */
  authTime?: number,
): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const signedInAt = authTime ?? issuedAt;
  // A refresh never stretches a session past its absolute limit.
  const expiry = Math.min(issuedAt + ttlSeconds, signedInAt + SESSION_MAX_AGE_SECONDS);
  const payload: SessionPayload = {
    sub: userId, iat: issuedAt, exp: expiry, aut: signedInAt, jti: randomBytes(9).toString('base64url'),
  };
  if (snapshot !== undefined) payload.usr = snapshot;
  const encoded = base64url(JSON.stringify(payload));
  return {
    token: `${encoded}.${sign(encoded, secret)}`,
    expiresAt: new Date(expiry * 1000),
  };
}

/** Why a token was not accepted. Expiry is ordinary; the rest are not. */
export type TokenFailure = 'malformed' | 'bad_signature' | 'expired';

export type TokenInspection =
  | { ok: true; payload: SessionPayload }
  | { ok: false; failure: TokenFailure };

/**
 * Check a token and say what was wrong with it.
 *
 * Expiry and a bad signature both mean "not signed in", and they are wildly
 * different problems: one is a session that ran its course, the other a token
 * this server did not issue - which in practice means the signing key changed
 * under it. Collapsing them into null hid that distinction exactly when it
 * mattered.
 */
export function inspectSessionToken(token: string, secret: string): TokenInspection {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, failure: 'malformed' };
  const [encoded, signature] = parts as [string, string];

  const expected = Buffer.from(sign(encoded, secret));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, failure: 'bad_signature' };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return { ok: false, failure: 'malformed' };
  }

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, failure: 'malformed' };
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) return { ok: false, failure: 'expired' };
  return { ok: true, payload };
}

/** Returns the payload when the signature is valid and unexpired, else null. */
export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const result = inspectSessionToken(token, secret);
  return result.ok ? result.payload : null;
}

export const SESSION_COOKIE_NAME = 'figmark_session';

/**
 * The longest one sign-in lasts, however often it is refreshed.
 *
 * A session is 12 hours from its last refresh, and it is refreshed while it is
 * in use (see `MockAuthProvider.refreshCookies`), so someone using the app
 * every day is not signed out in the middle of it. Past this, the password is
 * asked for again whatever happened in between.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

/** How old a token gets before using it earns a fresh one. */
export const SESSION_REFRESH_AFTER_SECONDS = 60 * 60;

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

/* ── Device cookies ────────────────────────────────────────────────────── */

/**
 * Proof that this browser has signed in to an account before.
 *
 * Wrong passwords are capped per account so nobody can guess one by spreading
 * attempts over many addresses - but a cap per account alone is a way to lock
 * its owner out. So the cap applies only to devices without this cookie: the
 * owner's own browser, which has signed in before, is never held back by
 * somebody else's guessing. Set on every successful sign-in; one entry per
 * account, the newest few kept. "Sign out everywhere" ends them too: an entry
 * from before `sessionsValidAfter` is not honoured.
 */
export const DEVICE_COOKIE_NAME = 'figmark_device';
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const DEVICE_ENTRIES_KEPT = 5;

function deviceSignature(userId: string, issuedAt: number, secret: string): string {
  return createHmac('sha256', secret).update(`device-v1:${userId}:${issuedAt}`).digest('base64url').slice(0, 27);
}

/** The accounts this cookie value vouches for, each with when it was issued (epoch seconds). */
export function readDeviceEntries(value: string | null | undefined, secret: string): Map<string, number> {
  const entries = new Map<string, number>();
  if (!value || !secret) return entries;
  const now = Math.floor(Date.now() / 1000);
  for (const part of value.split('~').slice(0, DEVICE_ENTRIES_KEPT)) {
    const [userId, issued, signature] = part.split('!');
    const issuedAt = Number(issued);
    if (!userId || !signature || !Number.isInteger(issuedAt) || now - issuedAt > DEVICE_MAX_AGE_SECONDS) continue;
    const expected = Buffer.from(deviceSignature(userId, issuedAt, secret));
    const provided = Buffer.from(signature);
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) entries.set(userId, issuedAt);
  }
  return entries;
}

/** The cookie with this account (re)added at the front. */
export function buildDeviceCookie(userId: string, existing: string | null | undefined, secret: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const kept = [...readDeviceEntries(existing, secret)]
    .filter(([id]) => id !== userId)
    .slice(0, DEVICE_ENTRIES_KEPT - 1)
    .map(([id, at]) => `${id}!${at}!${deviceSignature(id, at, secret)}`);
  const value = [`${userId}!${issuedAt}!${deviceSignature(userId, issuedAt, secret)}`, ...kept].join('~');
  return [
    `${DEVICE_COOKIE_NAME}=${value}`,
    // Only sign-in ever reads it.
    'Path=/api/auth',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${DEVICE_MAX_AGE_SECONDS}`,
  ].join('; ');
}

/** The device cookie's value from a Cookie header, if there is one. */
export function deviceCookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === DEVICE_COOKIE_NAME) return rest.join('=').trim() || null;
  }
  return null;
}
