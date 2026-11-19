import type { Listing, PhotoRegion } from '../../shared/models.js';
import { isCurrent, isFingerprinted, likeness, storedPrints, type Prints } from './image-hash.js';
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
 * A listing photo of several things - a lot, a bundle - carries a fingerprint
 * for each of them, and a shopper's photo of several does too, so any one item
 * finds any listing that shows it, alone or among others.
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
/** Matches a photo search shows before the related items. */
export const PHOTO_RESULTS = RESULTS;
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
  /** One of its photos, or an item in one, is likely the same thing in another picture. */
  sameItem?: boolean;
  /** One of its photos as a whole - not an item among others in it - is the same thing. */
  wholeItem?: boolean;
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
  /** The fingerprint of each item in the photo, when it shows several. */
  regions: PhotoRegion[];
}

/** Every fingerprint a listing's photos carry - each whole photo, then each item in one. */
interface ListingPrints {
  listing: Listing;
  hashes: string[];
  /** Those of whole photos, rather than of items in one. */
  wholes: Set<string>;
}

/**
 * The fingerprints of every listing in the pool, whole photos and the items in
 * them. Stored ones, and whatever this instance has already worked out, cost
 * nothing. A photo with neither - or with a fingerprint of an older kind - is
 * read and worked out after, a few at a time, up to a budget, in pool order so
 * the likeliest go first. What is worked out along the way is pushed onto
 * `learned`, for the caller to store, so the next instance does not have to
 * read the photo again.
 */
async function catalogPrints(pool: Listing[], learned: LearnedHash[]): Promise<ListingPrints[]> {
  const entries = new Map<string, ListingPrints>();
  const add = (listing: Listing, hashes: string[]) => {
    const entry = entries.get(listing.id) ?? { listing, hashes: [], wholes: new Set<string>() };
    // The first of each photo's fingerprints is the whole photo's.
    if (hashes[0]) entry.wholes.add(hashes[0]);
    entry.hashes.push(...hashes);
    entries.set(listing.id, entry);
  };
  const settle = (listing: Listing, name: string, theirs: string | null, worked: Prints | null) => {
    if (worked && worked.hash !== theirs) learned.push({ listing, blobName: name, hash: worked.hash, regions: worked.regions });
    if (worked) add(listing, [worked.hash, ...worked.regions.map((region) => region.imageHash)]);
    else if (theirs) add(listing, [theirs]);
  };
  const toRead: { listing: Listing; name: string; theirs: string | null }[] = [];
  for (const listing of pool) {
    for (const name of await storedPhotos(listing)) {
      const photo = listing.photos.find((entry) => entry.blobName === name);
      const theirs = photo?.imageHash ?? null;
      if (theirs && isCurrent(theirs) && photo?.regions) add(listing, [theirs, ...photo.regions.map((region) => region.imageHash)]);
      else if (isFingerprinted(name)) settle(listing, name, theirs, await storedPrints(name));
      else if (toRead.length < FRESH_PER_SEARCH) toRead.push({ listing, name, theirs });
      else if (theirs) add(listing, [theirs]);
    }
  }
  await inBatches(toRead, async ({ listing, name, theirs }) =>
    settle(listing, name, theirs, await storedPrints(name).catch(() => null)));
  return [...entries.values()];
}

/** How each listing compares with any of the photo's fingerprints, by id, keeping the best of each. */
function compareAll(entries: ListingPrints[], hashes: string[]): Map<string, PictureLook> {
  const found = new Map<string, PictureLook>();
  for (const { listing, hashes: theirs, wholes } of entries) {
    let entry: PictureLook | null = null;
    for (const mine of hashes) {
      for (const their of theirs) {
        const alike = likeness(mine, their);
        if (!alike) continue;
        entry ??= { same: false, sameItem: false, wholeItem: false, visual: 0, look: 0 };
        // A recoloured copy is the same picture, but for a shopper it is another variant, not this one.
        entry.same ||= alike.samePhoto && alike.sameItem;
        entry.sameItem ||= alike.sameItem;
        entry.wholeItem ||= (alike.sameItem || alike.samePhoto) && wholes.has(their);
        entry.visual = Math.max(entry.visual, alike.score);
        entry.look = Math.max(entry.look, alike.look ?? 0);
      }
    }
    if (entry && (entry.visual > 0 || entry.look > 0)) found.set(listing.id, entry);
  }
  return found;
}

/**
 * How every listing in the pool compares with this photo, by id - including
 * those that look nothing like it, so a probable match can be ranked from them.
 * `hash` may be several: a photo and the items in it, any of which may match.
 */
export async function pictureLooks(
  pool: Listing[], hash: string | string[], learned: LearnedHash[] = [],
): Promise<Map<string, PictureLook>> {
  return compareAll(await catalogPrints(pool, learned), Array.isArray(hash) ? hash : [hash]);
}

/** `pictureLooks` for several photos at once - a whole and each item in it - reading the catalogue once. */
export async function pictureLooksEach(
  pool: Listing[], hashes: (string | string[])[], learned: LearnedHash[] = [],
): Promise<Map<string, PictureLook>[]> {
  const entries = await catalogPrints(pool, learned);
  return hashes.map((hash) => compareAll(entries, Array.isArray(hash) ? hash : [hash]));
}

/**
 * Every listing in the pool with a photo like this one, by id. Listings with
 * nothing that looks alike are left out.
 */
export async function pictureMatches(
  pool: Listing[], hash: string | string[], learned: LearnedHash[] = [],
): Promise<Map<string, PictureMatch>> {
  return onlyAlike(await pictureLooks(pool, hash, learned));
}

/** The looks that are close enough to be the picture itself, or very like it. */
export function onlyAlike(looks: Map<string, PictureLook>): Map<string, PictureMatch> {
  return new Map([...looks].filter(([, match]) => match.same || match.sameItem || match.visual >= LOOKS_ALIKE));
}

/**
 * The score a picture match is worth, on the same scale as `describedScore`:
 * the same photo far above all, then the same thing in another photo, then a
 * look-alike.
 */
export function pictureScore(match: PictureMatch | undefined): number {
  if (!match) return 0;
  if (match.same) return 100 + match.visual * 10;
  // A listing whose own photo is the thing comes before one where it is one of several.
  return match.sameItem ? 40 + match.visual * 10 + (match.wholeItem ? 5 : 0) : match.visual * 6;
}

/** How a listing scores against a photo: its best picture match and its best words. */
function photoScore(listing: Listing, pictures: Map<string, PictureMatch>, descriptions: PhotoDescription[]): number {
  const words = Math.max(0, ...descriptions.map((description) => describedScore(listing, description)));
  return pictureScore(pictures.get(listing.id)) + words;
}

/** Matches for the photo, best first, then items related to them. */
export async function rankByPhoto(
  pool: Listing[],
  hash: string | string[] | null,
  description: PhotoDescription | PhotoDescription[] | null,
  learned: LearnedHash[] = [],
): Promise<Listing[]> {
  const hashes = hash === null ? [] : Array.isArray(hash) ? hash : [hash];
  const descriptions = description === null ? [] : Array.isArray(description) ? description : [description];
  const pictures = hashes.length > 0 ? await pictureMatches(pool, hashes, learned) : new Map<string, PictureMatch>();
  const matches = rankMatches(pool, pictures, descriptions, RESULTS);
  return [...matches, ...relatedTo(pool, matches, descriptions[0] ?? null)];
}

/** The listings that match, best first, at most `limit`. */
export function rankMatches(
  pool: Listing[], pictures: Map<string, PictureMatch>, descriptions: PhotoDescription[], limit: number,
): Listing[] {
  const ranked: Scored[] = [];
  for (const listing of pool) {
    const score = photoScore(listing, pictures, descriptions);
    if (score > 0) ranked.push({ listing, score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || b.listing.createdAt.localeCompare(a.listing.createdAt))
    .slice(0, limit)
    .map((entry) => entry.listing);
}

/** Related items, for callers that rank matches themselves. */
export function relatedItems(pool: Listing[], matches: Listing[], description: PhotoDescription | null): Listing[] {
  return relatedTo(pool, matches, description);
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
