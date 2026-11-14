import { IN_DEMAND_SCORE, popularity } from './catalog.js';

/**
 * Discover's finds: items worth surfacing to somebody who is not searching,
 * and the one word that says why.
 *
 * Ranked on the server, over the whole live catalogue, so a rare item is never
 * missed because it fell outside the first page of a popular list.
 */

export type FindKind = 'rare' | 'filling' | 'drop' | 'restock' | 'hot' | 'yours';

export interface FindWhy {
  kind: FindKind;
  label: string;
}

/** What ranking a find reads of a listing. */
export interface FindShape {
  id: string;
  sellerId: string;
  category: string;
  priceMinor: number;
  quantityMode?: string;
  quantityAvailable: number;
  preOrder?: { fillThreshold: number; filledCount: number } | null;
  viewCount?: number;
  likeCount?: number;
  priceHistory?: { priceMinor: number; at: string }[];
  restockedAt?: string | null;
}

/** Most finds Discover carries, so it stays a stream and not the catalogue. */
export const MAX_FINDS = 36;
/** A restock this recent still counts as news. */
const RESTOCK_FRESH_MS = 7 * 86_400_000;
/** A cut smaller than this is not worth a label. */
const DROP_MIN_SHARE = 0.05;

/** The highest price it has been on sale at, when that is above today's. */
export function wasPrice(listing: FindShape): number | null {
  const highest = Math.max(0, ...(listing.priceHistory ?? []).map((entry) => entry.priceMinor));
  return highest > listing.priceMinor && (highest - listing.priceMinor) / highest >= DROP_MIN_SHARE ? highest : null;
}

/**
 * Why a listing is worth a look, and how much: scarcity first - the last one
 * or two, or a group pre-order past halfway - then a price cut or a fresh
 * restock, then demand, lifted for the categories this person collects.
 */
export function findOf(listing: FindShape, hobbies: ReadonlySet<string>, now: number): { why: FindWhy; score: number } | null {
  const left = listing.quantityMode === 'multiple' ? null : listing.quantityAvailable;
  const rare = left !== null && left > 0 && left <= 2;
  const pre = listing.preOrder;
  const filling = Boolean(pre && pre.fillThreshold > 0 && pre.filledCount / pre.fillThreshold >= 0.5
    && pre.filledCount < pre.fillThreshold);
  const was = wasPrice(listing);
  const restocked = Boolean(listing.restockedAt && now - Date.parse(listing.restockedAt) < RESTOCK_FRESH_MS);
  const hot = popularity(listing) >= IN_DEMAND_SCORE;
  const yours = hobbies.has(listing.category);
  const why: FindWhy | null = rare ? { kind: 'rare', label: left === 1 ? 'Last one' : `Last ${left}` }
    : filling ? { kind: 'filling', label: `Pre-order ${pre!.filledCount}/${pre!.fillThreshold}` }
      : was ? { kind: 'drop', label: `Price drop · ${Math.round(((was - listing.priceMinor) / was) * 100)}% off` }
        : restocked ? { kind: 'restock', label: 'Back in stock' }
          : hot ? { kind: 'hot', label: 'High demand' }
            : yours ? { kind: 'yours', label: `For your ${listing.category}` }
              : null;
  if (!why) return null;
  const score = popularity(listing) + (yours ? 400 : 0) + (rare ? 300 : 0) + (filling ? 200 : 0)
    + (was ? 250 : 0) + (restocked ? 150 : 0);
  return { why, score };
}

/** The catalogue's finds for this person, best first, never their own. */
export function rankFinds<T extends FindShape>(
  listings: readonly T[], hobbies: ReadonlySet<string>, me: string | null, now: number, max = MAX_FINDS,
): { listing: T; why: FindWhy }[] {
  const seen = new Set<string>();
  return listings
    .filter((listing) => listing.sellerId !== me && !seen.has(listing.id) && seen.add(listing.id))
    .map((listing) => ({ listing, found: findOf(listing, hobbies, now) }))
    .filter((entry): entry is { listing: T; found: { why: FindWhy; score: number } } => entry.found !== null)
    .sort((a, b) => b.found.score - a.found.score)
    .slice(0, max)
    .map(({ listing, found }) => ({ listing, why: found.why }));
}
