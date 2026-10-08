import type { NotificationKind } from './models.js';

/**
 * How notices are sorted, said and grouped - shared so the bell, the phone
 * settings and the server agree on every one of them.
 */

/* ── Categories ─────────────────────────────────────────────────────────── */

/**
 * What a notice is about, for the bell's filter and for choosing what reaches
 * the phone. Six, because that is how people think about the noise: a chat
 * message and "your parcel moved" are different kinds of interruption, and
 * somebody who wants one on the lock screen may well not want the other.
 */
export const NOTIFICATION_CATEGORIES = ['messages', 'orders', 'payments', 'social', 'reviews', 'drops'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  messages: 'Messages & channels',
  orders: 'Orders & deliveries',
  payments: 'Payments & disputes',
  social: 'Likes, comments & follows',
  reviews: 'Reviews',
  drops: 'Drops, sales & wants',
};

/** A short word for each, for the bell's filter chips. */
export const CATEGORY_SHORT: Record<NotificationCategory, string> = {
  messages: 'Messages',
  orders: 'Orders',
  payments: 'Payments',
  social: 'Social',
  reviews: 'Reviews',
  drops: 'Drops',
};

/**
 * Every kind, filed once. A `Record` rather than a switch so a kind added to
 * the model without a home here is a type error, not a notice that falls into
 * no filter.
 */
const CATEGORY_OF: Record<NotificationKind, NotificationCategory> = {
  message: 'messages',
  message_reacted: 'messages',
  channel_message: 'messages',
  channel_announcement: 'messages',

  forum_moderation: 'social',
  post_reacted: 'social',
  post_commented: 'social',
  comment_replied: 'social',
  comment_liked: 'social',
  post_shared: 'social',
  followed: 'social',

  review_received: 'reviews',
  content_report_settled: 'reviews',

  want_answered: 'drops',
  preorder_nearly: 'drops',
  preorder_filled: 'drops',
  preorder_due: 'drops',
  preorder_closed: 'drops',
  sale_opened: 'drops',
  sale_item: 'drops',
  seller_nudge: 'drops',

  lot_moved: 'orders',
  order_delivered: 'orders',
  order_received: 'orders',
  order_placed: 'orders',
  order_rejected: 'orders',
  order_accepted: 'orders',
  booking_accepted: 'orders',
  order_cancelled: 'orders',
  service_store: 'orders',
  commission: 'orders',

  payment_claimed: 'payments',
  payment_received: 'payments',
  payment_released: 'payments',
  credit_refunded: 'payments',
  credit_refund_sent: 'payments',
  credit_refund_answered: 'payments',
  credit_applied: 'payments',
  refund_started: 'payments',
  payment_dispute: 'payments',
  payment_settled: 'payments',
  dispute_opened: 'payments',
  dispute_replied: 'payments',
  dispute_settled: 'payments',
  dispute_decided: 'payments',
  dispute_escalated: 'payments',
  dispute_assigned: 'payments',
  dispute_action: 'payments',
  payment_reversal_pending: 'payments',
  reversal_details_needed: 'payments',
  reversal_details_updated: 'payments',
  payment_reversed: 'payments',
  reversal_ack: 'payments',
  dispute_raised_reversal: 'payments',
};

export function categoryOf(kind: NotificationKind | string): NotificationCategory {
  return CATEGORY_OF[kind as NotificationKind] ?? 'orders';
}

export const isCategory = (value: unknown): value is NotificationCategory =>
  typeof value === 'string' && (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);

/* ── Saying who ─────────────────────────────────────────────────────────── */

/**
 * The longest name a notice spells out. A lock screen shows about forty
 * characters of title, and "Kaiju Imports International Trading Co. sent a
 * message to Hobby Haven Collectibles & More" is neither.
 */
export const NAME_MAX = 22;

/** The name, or the fallback when the name will not fit. */
export function fits(name: string | null | undefined, fallback: string): string {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  return trimmed && trimmed.length <= NAME_MAX ? trimmed : fallback;
}

/**
 * Whoever did it, short enough for a title: the name; for a long one their
 * @handle; failing that the name cut down.
 */
export function actorName(name: string, handle?: string | null): string {
  const trimmed = name.replace(/\s+/g, ' ').trim() || (handle ? `@${handle}` : 'Somebody');
  if (trimmed.length <= NAME_MAX) return trimmed;
  if (handle && handle.length < NAME_MAX) return `@${handle}`;
  return `${trimmed.slice(0, NAME_MAX - 1).trimEnd()}…`;
}

/**
 * Who a notice is for, as its reader reads it: "you", or the store it came
 * to - by name, or "your store" when the name is too long to fit.
 *
 * The point of saying it: somebody who runs a shop gets notices for both, and
 * "Arjun messaged you" and "Arjun messaged Kaiju Imports" are different
 * conversations to open.
 */
export function toWhom(store: string | null | undefined): string {
  return store ? fits(store, 'your store') : 'you';
}

/** The same, possessive: "your", "Kaiju Imports'" or "your store's". */
export function whose(store: string | null | undefined): string {
  if (!store) return 'your';
  return possessive(fits(store, 'your store'));
}

export function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/**
 * "Arjun", "Arjun and Sana", "Arjun and 3 others": the newest first, for a
 * notice that has collected several people doing the same thing.
 */
export function andOthers(actors: readonly string[]): string {
  const [first, second] = actors;
  if (!first) return 'Somebody';
  if (actors.length === 1) return first;
  if (actors.length === 2) return `${first} and ${second}`;
  const rest = actors.length - 1;
  return `${first} and ${rest} others`;
}

/** A rating as the stars it is: ★★★★☆. */
export function stars(rating: number): string {
  const whole = Math.max(0, Math.min(5, Math.round(rating)));
  return `${'★'.repeat(whole)}${'☆'.repeat(5 - whole)}`;
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A line of somebody's text, for a notice body: one line, cut short. */
export function gistOf(text: string | null | undefined, fallback = '', max = 90): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return fallback;
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/* ── Quiet hours ─────────────────────────────────────────────────────────── */

/** Pushes still arrive between these hours, without a sound or buzz. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 7;

/** Whether `at` falls in quiet hours where the person is. */
export function inQuietHours(at: Date, timeZone: string | null | undefined): boolean {
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric', hourCycle: 'h23', timeZone: timeZone || 'Asia/Kolkata',
    }).format(at));
  } catch {
    hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Kolkata' }).format(at));
  }
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}
