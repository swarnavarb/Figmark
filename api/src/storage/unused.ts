import type { Repository } from '../data/repository.js';
import type { BlobEntry, PhotoScope, PhotoStore } from './types.js';

/**
 * Finding the stored photos nothing uses any more.
 *
 * A photo is only ever deleted here, on an operator's say-so, and only after
 * checking every record. Deleting a blob when the thing it was uploaded for goes
 * would be wrong far more often than it sounds: a post that shares an item
 * reuses the item's photo, an order and a collection card keep their own copy
 * of the listing's, and a listing is expired rather than removed so its history
 * still shows. So a photo is "unused" when no record anywhere mentions its name,
 * which is a fact about the whole database and not about the thing being deleted.
 */

/** A name the stores give out: a uuid and an image extension. */
const PHOTO_NAME = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)/gi;

/** Every photo name mentioned in a piece of text, lower-cased. */
export function photoNamesIn(text: string): string[] {
  return (text.match(PHOTO_NAME) ?? []).map((name) => name.toLowerCase());
}

/**
 * A photo uploaded a moment ago has no record yet: it is in the browser's hands
 * between being chosen and being saved. Anything younger than this is never
 * called unused, however it looks.
 */
export const DEFAULT_GRACE_HOURS = 24;
export const MIN_GRACE_HOURS = 1;
/** How many are named in a result; the totals always cover all of them. */
const LISTED = 500;

export interface UnusedScan {
  /** How many photos are stored in all. */
  stored: number;
  /** How many of those some record still mentions. */
  inUse: number;
  /** Not mentioned anywhere, but too recent to call unused. */
  tooNew: number;
  graceHours: number;
  unusedCount: number;
  unusedBytes: number;
  /** The first of them, oldest first. */
  unused: BlobEntry[];
}

async function unusedBlobs(
  store: PhotoStore,
  repository: Repository,
  graceHours: number,
): Promise<{ stored: BlobEntry[]; unused: BlobEntry[]; tooNew: number }> {
  const [stored, referenced] = await Promise.all([store.list(), repository.blobReferences()]);
  const cutoff = Date.now() - graceHours * 3_600_000;
  const unused: BlobEntry[] = [];
  let tooNew = 0;
  for (const blob of stored) {
    if (referenced.has(blob.name.toLowerCase())) continue;
    if (Date.parse(blob.uploadedAt) > cutoff) { tooNew += 1; continue; }
    unused.push(blob);
  }
  unused.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  return { stored, unused, tooNew };
}

/** Whole hours, at least the minimum: a typo cannot turn the grace into nothing. */
export function graceFrom(value: unknown): number {
  const hours = Math.round(Number(value));
  return Number.isFinite(hours) ? Math.max(MIN_GRACE_HOURS, Math.min(24 * 365, hours)) : DEFAULT_GRACE_HOURS;
}

/** Look, without touching anything. */
export async function scanUnused(store: PhotoStore, repository: Repository, graceHours: number): Promise<UnusedScan> {
  const { stored, unused, tooNew } = await unusedBlobs(store, repository, graceHours);
  return {
    stored: stored.length,
    inUse: stored.length - unused.length - tooNew,
    tooNew,
    graceHours,
    unusedCount: unused.length,
    unusedBytes: unused.reduce((sum, blob) => sum + blob.size, 0),
    unused: unused.slice(0, LISTED),
  };
}

export interface CleanupResult {
  deleted: number;
  bytes: number;
  failed: number;
}

/**
 * Delete the unused photos. The scan is done again here, not trusted from the
 * last one: a photo can have been used since it was listed, and the list on an
 * operator's screen may be an hour old. `only` narrows it to named photos, and
 * a name that is no longer unused is simply skipped.
 */
export async function deleteUnused(
  store: PhotoStore,
  repository: Repository,
  graceHours: number,
  only?: { scope: PhotoScope; name: string }[],
): Promise<CleanupResult> {
  const { unused } = await unusedBlobs(store, repository, graceHours);
  const wanted = only ? new Set(only.map((entry) => `${entry.scope}:${entry.name.toLowerCase()}`)) : null;
  const result: CleanupResult = { deleted: 0, bytes: 0, failed: 0 };
  for (const blob of unused) {
    if (wanted && !wanted.has(`${blob.scope}:${blob.name.toLowerCase()}`)) continue;
    try {
      if (await store.remove(blob.scope, blob.name)) {
        result.deleted += 1;
        result.bytes += blob.size;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
