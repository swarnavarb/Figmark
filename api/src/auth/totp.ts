import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time codes (RFC 6238), as every authenticator app makes them:
 * HMAC-SHA1 over the 30-second step, six digits.
 *
 * Written out rather than taken from a library because it is forty lines and
 * the whole of what sign-in trusts it with; a dependency would be more code to
 * review than this is.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
/** One step either side, for a phone clock a little off and a code typed slowly. */
const DRIFT_STEPS = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 as authenticator apps take it. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one step. */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * The step a code matches, within the drift window, or null. A step at or
 * before `lastStep` is refused, so a code seen over somebody's shoulder cannot
 * be used again after its owner has.
 */
export function matchStep(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const current = stepAt(now);
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(typed))) return step;
  }
  return null;
}

/** The link authenticator apps open to add the account. */
export function otpauthUri(secret: string, account: string): string {
  const label = encodeURIComponent(`Figmark:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Figmark&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ── Recovery codes ────────────────────────────────────────────────────── */

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Ten one-time codes for a lost phone, shown once; only their hashes are kept. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export const hashRecovery = (code: string) =>
  createHash('sha256').update(code.trim().toLowerCase().replace(/\s/g, '')).digest('hex');
