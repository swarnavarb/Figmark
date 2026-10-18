import type { Listing } from '../../shared/models.js';
import { hasLook, isFingerprinted, likeness, storedFingerprint } from './image-hash.js';
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
 * reseller who saved a supplier's picture is looking for. After the matches
 * come related items - same kind, shared tags - so a photo of something not
 * listed yet still leads somewhere. The shopper sees one list, best first.
 */
interface Scored {
  listing: Listing;
  score: number;
}

/** Look-alike scores under this are colour coincidences, not resemblance. */
const LOOKS_ALIKE = 0.78;
/** Photos fingerprinted for the first time per search, at most: bounds a cold start. */
const FRESH_PER_SEARCH = 150;
const RESULTS = 24;
const RELATED = 24;

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

/** How a listing's own photos compare with the one searched with. */
export interface PictureMatch {
  /** One of its photos is the same picture. */
  same: boolean;
  /** 0 to 1: how alike its closest photo looks. */
  visual: number;
}

/** A picture match, with how alike the subjects' colours are as well. */
export interface PictureLook extends PictureMatch {
  /** 0 to 1, backdrop aside: the basis for a probable match. 0 when unknown. */
  look: number;
}

/**
 * How every listing in the pool compares with this photo, by id - including
 * those that look nothing like it, so a probable match can be ranked from them.
 */
export async function pictureLooks(pool: Listing[], hash: string): Promise<Map<string, PictureLook>> {
  let fresh = 0;
  const found = new Map<string, PictureLook>();
  for (const listing of pool) {
    let visual = 0;
    let look = 0;
    let same = false;
    for (const name of await storedPhotos(listing)) {
      // Stored hashes first; then whatever this instance has already
      // worked out; then, up to a budget, read the photo and work it out.
      // A stored hash from before the look is read again for it.
      let theirs = listing.photos.find((photo) => photo.blobName === name)?.imageHash ?? null;
      if ((!theirs || !hasLook(theirs)) && (isFingerprinted(name) || fresh < FRESH_PER_SEARCH)) {
        if (!isFingerprinted(name)) fresh += 1;
        theirs = (await storedFingerprint(name)) ?? theirs;
      }
      const alike = theirs ? likeness(hash, theirs) : null;
      if (!alike) continue;
      same ||= alike.samePhoto;
      visual = Math.max(visual, alike.score);
      look = Math.max(look, alike.look ?? 0);
    }
    if (visual > 0 || look > 0) found.set(listing.id, { same, visual, look });
  }
  return found;
}

/**
 * Every listing in the pool with a photo like this one, by id. Listings with
 * nothing that looks alike are left out.
 */
export async function pictureMatches(pool: Listing[], hash: string): Promise<Map<string, PictureMatch>> {
  return onlyAlike(await pictureLooks(pool, hash));
}

/** The looks that are close enough to be the picture itself, or very like it. */
export function onlyAlike(looks: Map<string, PictureLook>): Map<string, PictureMatch> {
  return new Map([...looks].filter(([, match]) => match.same || match.visual >= LOOKS_ALIKE));
}

/** The score a picture match is worth, on the same scale as `describedScore`. */
export function pictureScore(match: PictureMatch | undefined): number {
  if (!match) return 0;
  return match.same ? 100 + match.visual * 10 : match.visual * 6;
}

/** Matches for the photo, best first, then items related to them. */
export async function rankByPhoto(
  pool: Listing[],
  hash: string | null,
  description: PhotoDescription | null,
): Promise<Listing[]> {
  const pictures = hash ? await pictureMatches(pool, hash) : new Map<string, PictureMatch>();
  const ranked: Scored[] = [];

  for (const listing of pool) {
    const words = description ? describedScore(listing, description) : 0;
    const score = pictureScore(pictures.get(listing.id)) + words;
    if (score > 0) ranked.push({ listing, score });
  }

  const matches = ranked
    .sort((a, b) => b.score - a.score || b.listing.createdAt.localeCompare(a.listing.createdAt))
    .slice(0, RESULTS)
    .map((entry) => entry.listing);
  return [...matches, ...relatedTo(pool, matches, description)];
}

/**
 * Items like the matches: the same category and shared tags, weighted toward
 * the best matches. With no matches at all, the category the photo was read
 * as is all there is to go on.
 */
function relatedTo(pool: Listing[], matches: Listing[], description: PhotoDescription | null): Listing[] {
  const taken = new Set(matches.map((listing) => listing.id));
  const lead = matches.slice(0, 3);
  const categories = new Set(lead.map((listing) => listing.category));
  if (description?.category) categories.add(description.category);
  const tags = new Set(lead.flatMap((listing) => listing.tags.map((tag) => tag.toLowerCase())));
  if (categories.size === 0 && tags.size === 0) return [];

  return pool
    .filter((listing) => !taken.has(listing.id))
    .map((listing) => ({
      listing,
      score: (categories.has(listing.category) ? 10 : 0)
        + listing.tags.filter((tag) => tags.has(tag.toLowerCase())).length * 4,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.listing.createdAt.localeCompare(a.listing.createdAt))
    .slice(0, RELATED)
    .map((entry) => entry.listing);
}
