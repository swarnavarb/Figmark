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

/** Photos read at once when fingerprints have to be worked out. */
const READ_AT_ONCE = 8;

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

/** Run `work` over every entry, a few at a time. */
async function inBatches<T>(entries: T[], work: (entry: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => { while (next < entries.length) await work(entries[next++]!); };
  await Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, entries.length) }, lane));
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

/** A fingerprint worked out from a listing's photo that the listing did not store. */
export interface LearnedHash {
  listing: Listing;
  blobName: string;
  hash: string;
}

/**
 * How every listing in the pool compares with this photo, by id - including
 * those that look nothing like it, so a probable match can be ranked from them.
 * Fingerprints worked out along the way are pushed onto `learned`, for the
 * caller to store, so the next instance does not have to read the photo again.
 */
export async function pictureLooks(
  pool: Listing[], hash: string, learned: LearnedHash[] = [],
): Promise<Map<string, PictureLook>> {
  const found = new Map<string, PictureLook>();
  const compare = (listing: Listing, theirs: string) => {
    const alike = likeness(hash, theirs);
    if (!alike) return;
    const was = found.get(listing.id) ?? { same: false, visual: 0, look: 0 };
    found.set(listing.id, {
      same: was.same || alike.samePhoto,
      visual: Math.max(was.visual, alike.score),
      look: Math.max(was.look, alike.look ?? 0),
    });
  };

  const settle = (listing: Listing, name: string, theirs: string | null, worked: string | null) => {
    if (worked && worked !== theirs) learned.push({ listing, blobName: name, hash: worked });
    const use = worked ?? theirs;
    if (use) compare(listing, use);
  };
  // Stored hashes, and whatever this instance has already worked out, cost
  // nothing: they are compared first. A photo with neither - or a stored hash
  // from before the look - is read and worked out after, a few at a time, up
  // to a budget, in pool order so the likeliest go first.
  const toRead: { listing: Listing; name: string; theirs: string | null }[] = [];
  for (const listing of pool) {
    for (const name of await storedPhotos(listing)) {
      const theirs = listing.photos.find((photo) => photo.blobName === name)?.imageHash ?? null;
      if (theirs && hasLook(theirs)) compare(listing, theirs);
      else if (isFingerprinted(name)) settle(listing, name, theirs, await storedFingerprint(name));
      else if (toRead.length < FRESH_PER_SEARCH) toRead.push({ listing, name, theirs });
      else if (theirs) compare(listing, theirs);
    }
  }
  await inBatches(toRead, async ({ listing, name, theirs }) =>
    settle(listing, name, theirs, await storedFingerprint(name).catch(() => null)));
  for (const [id, entry] of found) if (entry.visual <= 0 && entry.look <= 0) found.delete(id);
  return found;
}

/**
 * Every listing in the pool with a photo like this one, by id. Listings with
 * nothing that looks alike are left out.
 */
export async function pictureMatches(
  pool: Listing[], hash: string, learned: LearnedHash[] = [],
): Promise<Map<string, PictureMatch>> {
  return onlyAlike(await pictureLooks(pool, hash, learned));
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
  learned: LearnedHash[] = [],
): Promise<Listing[]> {
  const pictures = hash ? await pictureMatches(pool, hash, learned) : new Map<string, PictureMatch>();
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
