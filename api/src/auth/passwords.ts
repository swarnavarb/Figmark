import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
  return timingSafeEqual(actual, expected);
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
