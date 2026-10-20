import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for the mock auth provider only.
 *
 * A real provider owns credentials externally and never calls this. It exists
 * so seeded development accounts are not stored as plaintext, not because this
 * project intends to run its own credential store.
 */

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const actual = scryptSync(password, parsed.salt, KEY_LENGTH, parsed.params);
  return timingSafeEqual(actual, parsed.expected);
}

/**
 * The cost new hashes are made at: N=2^14, r=8, p=5, one of OWASP's
 * equivalent scrypt settings. It raises the work per guess fivefold over
 * Node's default (p=1) while keeping each hash to 16 MB of memory, so a burst
 * of sign-ins cannot exhaust a worker the way N=2^17 (128 MB each) would.
 * Stored as `s2:<salt>:<hash>`; a bare `<salt>:<hash>` is the older p=1 form,
 * still accepted and re-made at this cost on the next good sign-in.
 */
const CURRENT_PREFIX = 's2';
const CURRENT_PARAMS = { N: 16384, r: 8, p: 5 } as const;
const LEGACY_PARAMS = { N: 16384, r: 8, p: 1 } as const;

type Params = typeof CURRENT_PARAMS | typeof LEGACY_PARAMS;

/**
 * scrypt off the main thread. The sync form held the whole worker for the
 * length of every hash, so a burst of sign-ins queued every other request
 * behind them.
 */
function scryptAsync(password: string, salt: Buffer, params: Params = CURRENT_PARAMS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, params, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

/** `hashPassword`, without blocking the worker: for sign-up. */
export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt);
  return `${CURRENT_PREFIX}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Hashed against when there is no account, so "no such account" takes as long as "wrong password". */
const DECOY_SALT = randomBytes(16);

/** A stored hash's salt, digest and the cost it was made at; null when unreadable. */
function parseStored(stored: string | null): { salt: Buffer; expected: Buffer; params: Params } | null {
  const parts = (stored ?? '').split(':');
  const [saltHex, hashHex, params] = parts.length === 3 && parts[0] === CURRENT_PREFIX
    ? [parts[1], parts[2], CURRENT_PARAMS]
    : parts.length === 2 ? [parts[0], parts[1], LEGACY_PARAMS] : [undefined, undefined, LEGACY_PARAMS];
  if (!saltHex || !hashHex) return null;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LENGTH) return null;
  return { salt: Buffer.from(saltHex, 'hex'), expected, params };
}

/**
 * `verifyPassword`, without blocking the worker: for sign-in. An absent or
 * unreadable hash still costs one scrypt, so how long a sign-in takes does
 * not say whether the account exists.
 */
export async function verifyPasswordAsync(password: string, stored: string | null): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed) {
    await scryptAsync(password, DECOY_SALT);
    return false;
  }
  const actual = await scryptAsync(password, parsed.salt, parsed.params);
  return timingSafeEqual(actual, parsed.expected);
}

/** True for a hash made at less than today's cost, to be re-made once the password is known good. */
export function passwordNeedsRehash(stored: string | null): boolean {
  return !(stored ?? '').startsWith(`${CURRENT_PREFIX}:`);
}

/** Long enough to resist guessing once breached and common passwords are out. */
export const PASSWORD_MIN_LENGTH = 8;
/** scrypt runs over the whole password, so an unbounded one is a cheap way to burn CPU. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * The most used passwords that are long enough to pass a length rule - the
 * first ones any guessing script tries. The breach check catches far more;
 * this list is what still holds when that check is off or unreachable.
 */
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password@123', 'password!', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '0123456789', '87654321', '11111111', '00000000', '12341234', '11223344',
  '123123123', '1q2w3e4r', '1q2w3e4r5t', 'qwertyui', 'qwertyuiop', 'qwerty123', 'qwerty12', '1qaz2wsx', 'zaq12wsx',
  'asdfghjk', 'asdfghjkl', 'zxcvbnm1', 'abcd1234', 'abc12345', 'abcdefgh', 'iloveyou', 'iloveyou1', 'sunshine',
  'princess', 'football', 'baseball', 'welcome1', 'welcome123', 'letmein1', 'trustno1', 'superman', 'starwars',
  'whatever', 'computer', 'internet', 'michelle', 'jennifer', 'charlie1', 'india123', 'india@123', 'bharat123',
  'figmark1', 'figmark123', 'changeme', 'admin123', 'admin@123', 'administrator', 'monkey123', 'dragon12',
]);

/**
 * What is wrong with a new password, or null.
 *
 * Length, then the guessable: a common password, one character repeated, a
 * straight run of keys or digits, or the person's own email name, handle or
 * name. Then, where enabled, whether it has turned up in a known breach.
 */
export async function passwordProblem(
  password: string,
  about: { email?: string; username?: string; displayName?: string },
  options: { breachCheck: boolean },
): Promise<string | null> {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;

  const lower = password.toLowerCase();
  const guessable = 'That password is too easy to guess. Try a few unrelated words together.';
  if (COMMON.has(lower)) return guessable;
  if (/^(.)\1+$/.test(password)) return guessable;
  if ('abcdefghijklmnopqrstuvwxyz'.includes(lower) || '01234567890'.includes(lower) || '9876543210'.includes(lower)
    || 'qwertyuiopasdfghjklzxcvbnm'.includes(lower)) return guessable;
  const personal = [about.email?.split('@')[0], about.username, ...(about.displayName?.split(/\s+/) ?? [])]
    .map((part) => part?.trim().toLowerCase() ?? '')
    .filter((part) => part.length >= 4);
  if (personal.some((part) => lower.includes(part))) {
    return 'Your password should not contain your name, username or email.';
  }

  if (options.breachCheck && (await isBreached(password))) {
    return 'That password has appeared in a data breach, so it is on the lists attackers try first. Choose a different one.';
  }
  return null;
}

/**
 * True when Have I Been Pwned has seen this password in a breach.
 *
 * k-anonymity: only the first five characters of its SHA-1 leave the server,
 * and the answer is every suffix sharing them (padded, so its size says
 * nothing either). Unreachable or slow counts as not breached - the account
 * should not fail to open because a third party is down.
 */
export async function isBreached(password: string): Promise<boolean> {
  const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return false;
    const body = await response.text();
    for (const line of body.split('\n')) {
      const [hash, count] = line.trim().split(':');
      if (hash === suffix) return Number(count) > 0;
    }
    return false;
  } catch {
    return false;
  }
}
