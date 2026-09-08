/**
 * Usernames, and the namespace they share.
 *
 * A person and a storefront are both addressable, both get a username, and both
 * live at `/<username>` - so the two cannot be allowed to collide. They are
 * reserved in the same container as emails and phones, prefixed with `@`, which
 * keeps a username of "9876543210" from colliding with somebody's phone number
 * while still costing one point read to resolve.
 */

/** Reservation key for a username. The `@` is what separates the namespaces. */
export const handleKey = (username: string) => `@${username.trim().toLowerCase()}`;

/**
 * Usernames are lowercase, and the characters people can actually type into a
 * URL bar without thinking about it.
 */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.]{1,28}[a-z0-9])$/;

/** Reserved because they are already routes, or would be mistaken for one. */
const TAKEN = new Set([
  'api', 'app', 'admin', 'about', 'auth', 'login', 'logout', 'signup', 'signin',
  'sell', 'shop', 'social', 'lot', 'lots', 'listing', 'listings', 'order', 'orders',
  'me', 'my', 'batches', 'forwarders', 'settings', 'help', 'support', 'terms',
  'privacy', 'search', 'new', 'edit', 'static', 'assets', 'figmark',
]);

export type UsernameProblem = 'too_short' | 'too_long' | 'shape' | 'reserved';

/** Null when the username is fine, otherwise why it is not. */
export function checkUsername(raw: string): UsernameProblem | null {
  const value = raw.trim().toLowerCase();
  if (value.length < 3) return 'too_short';
  if (value.length > 30) return 'too_long';
  if (!USERNAME_PATTERN.test(value)) return 'shape';
  if (TAKEN.has(value)) return 'reserved';
  return null;
}

export const USERNAME_PROBLEMS: Record<UsernameProblem, string> = {
  too_short: 'A username needs at least 3 characters.',
  too_long: 'A username can be at most 30 characters.',
  shape: 'Use lowercase letters, numbers, dots and underscores, starting and ending with a letter or number.',
  reserved: 'That username is reserved.',
};

/**
 * Turn a display name into a username worth suggesting.
 *
 * Only a suggestion: it is offered in the field and can be typed over, because
 * a handle someone did not choose is one they will want to change immediately.
 */
export function suggestUsername(from: string): string {
  const base = from
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  if (base.length >= 3 && checkUsername(base) === null) return base;
  return `${base || 'user'}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 30);
}

/**
 * The thread two handles share.
 *
 * Derived from the pair rather than allocated, so either side computes the same
 * id without a conversation having to exist first - and a whole thread is one
 * partition. Sorted so the order the two people started in cannot produce two
 * threads for one conversation.
 */
export function threadIdFor(a: string, b: string): string {
  return [a.trim().toLowerCase(), b.trim().toLowerCase()].sort().join('|');
}
