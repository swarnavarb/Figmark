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

/**
 * Every first path segment the app itself answers, from the router in
 * app/src/main.tsx and the static web app's own routes.
 *
 * A username equal to one of these gets a profile nobody can open: the router
 * matches the page first. `scripts/check-handles.mjs` reads the router back and
 * fails the build if a top-level path is added without being listed here.
 *
 * `batch` and `batches` stay reserved after the rename to lots: they were live
 * paths, they may be bookmarked, and a username that shadows an old route is
 * the kind of thing that only breaks for the one person who kept the link.
 */
export const APP_ROUTE_SEGMENTS: readonly string[] = [
  'admin', 'api', 'batches', 'boot', 'buyer-settings', 'cart', 'community-service', 'dispute', 'disputes',
  'forwarders', 'i', 'index.html', 'learn', 'listing', 'lot', 'lots', 'me', 'messages', 'order', 'packing',
  'purchases', 'quests', 'r', 'refunds', 'routes', 's', 'sell', 'services', 'shop', 'social', 'sw.js',
  'verify', 'wallet',
];

/** Reserved because they are routes, would be mistaken for one, or soon will be. */
const TAKEN = new Set([
  ...APP_ROUTE_SEGMENTS,
  'app', 'about', 'auth', 'login', 'logout', 'signup', 'signin', 'register', 'account', 'accounts',
  'listings', 'orders', 'my', 'batch', 'settings', 'help', 'support', 'terms', 'privacy', 'search',
  'new', 'edit', 'static', 'assets', 'figmark', 'escrow', 'payments', 'pay', 'checkout', 'notifications',
  'inbox', 'feed', 'home', 'explore', 'store', 'stores', 'profile', 'user', 'users', 'wanted', 'wants',
  'insights', 'dashboard', 'billing', 'security', 'status', 'blog', 'news', 'docs', 'legal', 'contact',
  'refund', 'quest', 'message', 'service', 'route', 'purchase', 'packages', 'growth', 'invite', 'share',
]);

/** Digits and letters people swap in to look like somebody else. */
const LOOK_ALIKE: Record<string, string> = { '0': 'o', '1': 'i', l: 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g' };
const unconfuse = (value: string) => value.replace(/[0134578l9]/g, (char) => LOOK_ALIKE[char] ?? char);
const BRAND = unconfuse('figmark');

/**
 * Words that make a handle read as Figmark speaking.
 *
 * Matched as a whole part of the handle (split on dots and underscores), with
 * look-alike digits read as letters on both sides, so `figmark_support`,
 * `0fficial` and `support.team` are caught while `badminton`, `team_rocket`
 * and `supportive_mum` are not.
 */
const STAFF_PARTS = new Set([
  'official', 'officials', 'support', 'admin', 'admins', 'administrator', 'staff', 'moderator', 'moderators',
  'helpdesk', 'security', 'verified', 'customercare', 'escrow',
].map(unconfuse));

/** Fine inside a handle, not as all of it: `help`, `mod` or `team` alone reads as the platform. */
const STAFF_WHOLE = new Set([
  'help', 'mod', 'mods', 'team', 'care', 'trust', 'safety', 'system', 'root', 'billing', 'payments', 'refunds',
  'service', 'services', 'verification', 'supportteam', 'helpcentre', 'helpcenter', 'customerservice',
].map(unconfuse));

/** True when a handle would pass for the platform or its staff. */
function impersonates(value: string): boolean {
  const plain = unconfuse(value);
  const joined = plain.replace(/[._]/g, '');
  // The brand anywhere in it, dots and underscores ignored: f1gmark, fig.mark, thefigmark.
  if (joined.includes(BRAND)) return true;
  if (STAFF_WHOLE.has(joined) || STAFF_PARTS.has(joined)) return true;
  return plain.split(/[._]+/).some((part) => STAFF_PARTS.has(part));
}

export type UsernameProblem = 'too_short' | 'too_long' | 'shape' | 'reserved';

/**
 * Null when a string could be somebody's handle at all.
 *
 * For looking one up: a handle claimed before a word was reserved still
 * belongs to its owner, and their page must keep opening.
 */
export function handleShapeProblem(raw: string): UsernameProblem | null {
  const value = raw.trim().toLowerCase();
  if (value.length < 3) return 'too_short';
  if (value.length > 30) return 'too_long';
  if (!USERNAME_PATTERN.test(value)) return 'shape';
  return null;
}

/** Null when the username is fine to claim, otherwise why it is not. */
export function checkUsername(raw: string): UsernameProblem | null {
  const value = raw.trim().toLowerCase();
  if (TAKEN.has(value)) return 'reserved';
  const shape = handleShapeProblem(value);
  if (shape) return shape;
  if (impersonates(value)) return 'reserved';
  return null;
}

export const USERNAME_PROBLEMS: Record<UsernameProblem, string> = {
  too_short: 'A username needs at least 3 characters.',
  too_long: 'A username can be at most 30 characters.',
  shape: 'Use lowercase letters, numbers, dots and underscores, starting and ending with a letter or number.',
  reserved: 'That username is reserved, or could be mistaken for Figmark or its staff.',
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
