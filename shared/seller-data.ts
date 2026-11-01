/**
 * What the shop's Data tab is built from, beyond orders: where views come
 * from, and what buyers search for.
 *
 * Views are counted, never named. A buyer browsing is not something a shop
 * sees as a person; only what a buyer does toward the shop - save, follow,
 * check out, order, message - ever carries their name (see the customer
 * screens). So a view is a number on a day, under the place it came from.
 */

/** Where a buyer was just before opening an item. */
export const VIEW_SOURCES = [
  'feed', 'search', 'discover', 'shop', 'channel', 'similar', 'share', 'affiliate',
  'saved', 'wanted', 'messages', 'orders', 'other', 'direct', 'external',
] as const;
export type ViewSource = (typeof VIEW_SOURCES)[number];

export const VIEW_SOURCE_LABELS: Record<ViewSource, string> = {
  feed: 'Buy feed',
  search: 'Search',
  discover: 'Discover',
  shop: 'Your shop page',
  channel: 'Channels & social',
  similar: 'Another item',
  share: 'Shared link',
  affiliate: 'Affiliate link',
  saved: 'Saved items',
  wanted: 'Wanted posts',
  messages: 'Messages',
  orders: 'Their orders',
  other: 'Elsewhere in Figmark',
  direct: 'Opened directly',
  external: 'Another website or app',
};

export function isViewSource(value: unknown): value is ViewSource {
  return typeof value === 'string' && (VIEW_SOURCES as readonly string[]).includes(value);
}

/** Views per day, per source: `{ '2026-11-01': { feed: 4, search: 1 } }`. */
export type ViewLog = Record<string, Partial<Record<ViewSource, number>>>;

/** How many days of the view log a listing keeps. */
export const VIEW_LOG_DAYS = 90;

/** The day a moment falls on in India, as `YYYY-MM-DD`: a shop's "today" is an Indian day. */
export function dayKey(at: Date | string | number = new Date()): string {
  const ms = new Date(at).getTime() + 330 * 60_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** The day keys from `days` ago up to today, oldest first. */
export function lastDays(days: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let n = days - 1; n >= 0; n -= 1) keys.push(dayKey(now.getTime() - n * 86_400_000));
  return keys;
}

/** Views in a log between two day keys (inclusive), by source. */
export function viewsBySource(log: ViewLog | null | undefined, from: string, to: string): Partial<Record<ViewSource, number>> {
  const out: Partial<Record<ViewSource, number>> = {};
  for (const [day, sources] of Object.entries(log ?? {})) {
    if (day < from || day > to) continue;
    for (const [source, count] of Object.entries(sources)) {
      out[source as ViewSource] = (out[source as ViewSource] ?? 0) + (count ?? 0);
    }
  }
  return out;
}

/** Total views in a log between two day keys (inclusive). */
export function viewsBetween(log: ViewLog | null | undefined, from: string, to: string): number {
  return Object.values(viewsBySource(log, from, to)).reduce((sum, n) => sum + (n ?? 0), 0);
}

/* ── Searches ──────────────────────────────────────────────────────────── */

/** A month of catalog searches: `{ terms: { 'gogeta': { n: 12, empty: 3 } } }`. */
export interface SearchMonth {
  terms: Record<string, { n: number; empty: number }>;
}

/** The most distinct terms one month keeps; the rarest go first. */
export const SEARCH_TERMS_KEPT = 2_000;

/** A search as counted: lower case, single spaces, 2-40 characters; null for anything else. */
export function searchTerm(raw: string | null | undefined): string | null {
  const term = (raw ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s.'&+-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return term.length >= 2 && term.length <= 40 ? term : null;
}

/** The site-content id of a month's searches. */
export function searchMonthId(at: Date | string = new Date()): string {
  return `searches-${dayKey(at).slice(0, 7)}`;
}

/** Whether a search term is about this shop: it shares a word with one of the shop's tags, categories or titles. */
export function termMatches(term: string, words: ReadonlySet<string>): boolean {
  return term.split(' ').some((word) => word.length >= 3 && words.has(word));
}

/** The words a shop is about, from its items, for matching searches. */
export function shopWords(items: readonly { title: string; tags: readonly string[]; category: string }[]): Set<string> {
  const words = new Set<string>();
  for (const item of items) {
    for (const text of [item.title, item.category, ...item.tags]) {
      for (const word of (searchTerm(text) ?? '').split(' ')) if (word.length >= 3) words.add(word);
    }
  }
  for (const common of ['the', 'and', 'for', 'with', 'new', 'set']) words.delete(common);
  return words;
}
