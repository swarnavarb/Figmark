import type { Listing } from '../../shared/models.js';
import { isFingerprinted, likeness, storedFingerprint } from './image-hash.js';
import { ownPhotoName } from './storage/index.js';
import type { PhotoDescription } from './vision.js';

/**
 * Rank the catalogue against a photo.
 *
 * Two kinds of evidence, scored apart and then put together:
 *
 * - the picture itself, against every stored photo of every item - a match
 *   here is the same photo, or one that looks very like it;
 * - what Claude read in it, when vision is on, as words matched against the
 *   item's title, tags, description and category - the same item in a
 *   different picture.
 *
 * The same photo always comes first: it is close to certain, and it is what a
 * reseller who saved a supplier's picture is looking for.
 */
export type PhotoMatch = 'same_photo' | 'looks_alike' | 'described';

export interface RankedListing {
  listing: Listing;
  match: PhotoMatch;
  score: number;
}

/** Look-alike scores under this are colour coincidences, not resemblance. */
const LOOKS_ALIKE = 0.78;
/** Photos fingerprinted for the first time per search, at most: bounds a cold start. */
const FRESH_PER_SEARCH = 150;
const RESULTS = 24;

/** The blob names of a listing's own stored photos, lead photo first. */
async function storedPhotos(listing: Listing): Promise<string[]> {
  const names: string[] = [];
  const ordered = [...listing.photos].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  for (const photo of ordered) {
    // A pasted link to somebody else's server is never fetched: see ownPhotoName.
    const name = photo.blobName || (photo.url ? await ownPhotoName(photo.url) : null);
    if (name) names.push(name);
  }
  return names;
}

/** 0 when nothing matches; higher the more of the description the item carries. */
export function describedScore(listing: Listing, description: PhotoDescription): number {
  const title = listing.title.toLowerCase();
  const rest = [listing.description, ...listing.tags].join(' ').toLowerCase();
  const words = description.keywords.length > 0
    ? description.keywords
    : description.query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  let score = 0;
  let hits = 0;
  words.forEach((word, index) => {
    // Earlier keywords are the more telling ones.
    const weight = 1 + (words.length - index) / words.length;
    if (title.includes(word)) { score += 2 * weight; hits += 1; } else if (rest.includes(word)) { score += weight; hits += 1; }
  });
  // The category alone is a weak hint: never enough to be a result by itself.
  if (hits === 0) return 0;
  if (description.category && listing.category === description.category) score += 2;
  return score;
}

export async function rankByPhoto(
  pool: Listing[],
  hash: string | null,
  description: PhotoDescription | null,
): Promise<RankedListing[]> {
  let fresh = 0;
  const ranked: RankedListing[] = [];

  for (const listing of pool) {
    let visual = 0;
    let same = false;
    if (hash) {
      for (const name of await storedPhotos(listing)) {
        // Stored hashes first; then whatever this instance has already
        // worked out; then, up to a budget, read the photo and work it out.
        const stored = listing.photos.find((photo) => photo.blobName === name)?.imageHash ?? null;
        if (!stored && !isFingerprinted(name)) {
          if (fresh >= FRESH_PER_SEARCH) continue;
          fresh += 1;
        }
        const theirs = stored ?? await storedFingerprint(name);
        const alike = theirs ? likeness(hash, theirs) : null;
        if (!alike) continue;
        same ||= alike.samePhoto;
        visual = Math.max(visual, alike.score);
      }
    }
    const words = description ? describedScore(listing, description) : 0;

    if (same) {
      ranked.push({ listing, match: 'same_photo', score: 100 + visual * 10 + words });
    } else if (words > 0) {
      ranked.push({ listing, match: 'described', score: words + (visual >= LOOKS_ALIKE ? visual * 6 : 0) });
    } else if (visual >= LOOKS_ALIKE) {
      ranked.push({ listing, match: 'looks_alike', score: visual * 6 });
    }
  }

  return ranked
    .sort((a, b) => b.score - a.score || b.listing.createdAt.localeCompare(a.listing.createdAt))
    .slice(0, RESULTS);
}
