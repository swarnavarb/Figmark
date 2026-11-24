import type { Listing } from './models.js';
import { isPieceSold } from './pieces.js';

/**
 * Once somebody has bought an item, it stays the item they bought.
 *
 * Price, stock, shipping, offers, the description and tags can still change.
 * What says what the thing *is* cannot be swapped for something else: the
 * title can be corrected but not rewritten, the answers about it (condition,
 * original or copy, type, scale…) can be filled in but not changed, and its
 * photos can be added to but none taken away. Otherwise a listing with sales
 * and reviews behind it could be turned into a different product and borrow
 * that trust.
 */
export const LOCK_AFTER_SALE_NOTE =
  'Once someone buys this, it stays the item they bought: you can still change the price, stock, shipping, offers and description, '
  + 'and add photos, but the title can only be corrected, the condition and other details can’t be changed, and photos can’t be removed. '
  + 'Selling something different? List it as a new item.';

/** Whether anybody has bought this: units sold, or a piece of it gone. */
export function hasBeenBought(listing: Pick<Listing, 'soldCount' | 'pieces'>): boolean {
  return (listing.soldCount ?? 0) > 0 || (listing.pieces ?? []).some(isPieceSold);
}

const words = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Edit distance between two strings, by characters. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, n) => n);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * A corrected title, not a different one: a typo fixed, a detail added. At
 * most 30% of the old title may change, and anything added on the end - a
 * size, an edition - is free as long as the old title is still all there.
 */
export function titleStillSame(before: string, after: string): boolean {
  const a = words(before);
  const b = words(after);
  if (a === b || !a) return true;
  if (b.includes(a)) return true;
  return distance(a, b) <= Math.max(3, Math.round(a.length * 0.3));
}

/** Why this edit would turn a bought item into a different one, or null when it does not. */
export function lockedChange(
  listing: Pick<Listing, 'title' | 'attributes' | 'photos' | 'soldCount' | 'pieces'>,
  edit: { title?: string; attributes?: Record<string, string> | null; photos?: { url?: string | null; blobName?: string | null }[] | null },
): string | null {
  if (!hasBeenBought(listing)) return null;
  if (edit.title !== undefined && !titleStillSame(listing.title, edit.title)) {
    return 'People have bought this, so its title can be corrected but not changed to a different item. Selling something else? List it as a new item.';
  }
  if (edit.attributes) {
    const was = listing.attributes ?? {};
    const changed = Object.entries(was).find(([key, value]) => value && edit.attributes![key] !== value);
    if (changed) return 'People have bought this, so its condition and details can’t be changed - only the ones left blank can be filled in.';
  }
  if (edit.photos) {
    const kept = new Set(edit.photos.flatMap((photo) => [photo.url, photo.blobName].filter(Boolean)));
    const gone = (listing.photos ?? []).some((photo) => !(kept.has(photo.url) || (photo.blobName && kept.has(photo.blobName))));
    if (gone) return 'People have bought this, so its photos can’t be removed - you can add new ones.';
  }
  return null;
}
