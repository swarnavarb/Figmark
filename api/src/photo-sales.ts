import type { Listing } from '../../shared/models.js';
import { isExpired } from '../../shared/payments.js';
import { storedFingerprint } from './image-hash.js';
import { describedScore, pictureMatches, pictureScore, type PictureMatch } from './photo-search.js';
import { getPhotoStore } from './storage/index.js';
import { describeItems, type PhotoDescription } from './vision.js';

/**
 * Where the things in a photo are, or were, for sale.
 *
 * Photo search starts from a picture the shopper brings; this starts from one
 * already on Figmark - a post, a channel message, a listing, an order photo -
 * and answers the question a collector has looking at somebody's shelf: can I
 * buy that, and who has sold it before?
 *
 * The photo is split into the items in it when vision is on, each matched by
 * the words Claude read for it; the picture itself is matched by fingerprint
 * either way, so a reposted listing photo finds its listing with no key at all.
 * Unlike photo search the pool reaches back past what is buyable now: an item
 * sold out or taken down is still evidence of who sells that thing.
 */
export interface SalesGroup {
  /** What Claude named the item, or null for listings found by the picture alone. */
  label: string | null;
  /** Best match first. */
  listings: Listing[];
}

export interface PastSeller {
  sellerId: string;
  /** Units sold across the matching items, as their counts have it. */
  unitsSold: number;
  /** How many of the matching items were this shop's and have sold. */
  items: number;
}

export interface PhotoSales {
  items: SalesGroup[];
  sellers: PastSeller[];
}

/** Under this, a few shared words are coincidence: one telling word in the title is the least that counts. */
const MIN_WORDS = 4;
const PER_ITEM = 24;
const SELLERS = 12;

/** Listed for sale at some point and seen by the public: drafts, private deals and members' windows are not. */
export function everListed(listing: Listing): boolean {
  return listing.status !== 'draft' && !listing.privateFor && !listing.unlisted;
}

/** Buyable right now. */
export function onSale(listing: Listing): boolean {
  return listing.status === 'active' && !isExpired(listing);
}

/** Has sold, at least once, by its count or by running out. */
function hasSold(listing: Listing): boolean {
  return (listing.soldCount ?? 0) > 0 || listing.status === 'sold_out';
}

/**
 * What Claude read in each stored photo, by blob name.
 *
 * Blob names are never reused and the bytes behind one never change, so a
 * reading is good for as long as it is kept: a photo opened by a hundred
 * people is read once per host instance. Readings that failed are not kept, so
 * the next look tries again. In-flight readings are shared, so a burst of
 * viewers opening the same new post costs one call.
 */
const readings = new Map<string, Promise<PhotoDescription[] | null>>();
const READINGS_MAX = 5_000;

/** Whether looking at this photo again would cost nothing - nothing to read, or already read. */
export function alreadyRead(blobName: string, vision: boolean): boolean {
  return !vision || readings.has(blobName);
}

function readItems(blobName: string, bytes: Uint8Array, contentType: string): Promise<PhotoDescription[] | null> {
  const known = readings.get(blobName);
  if (known) return known;
  const reading = describeItems(bytes, contentType).then((items) => {
    if (items === null) readings.delete(blobName);
    return items;
  });
  if (readings.size >= READINGS_MAX) readings.delete(readings.keys().next().value!);
  readings.set(blobName, reading);
  return reading;
}

/** For tests: forget every reading. */
export function forgetReadings(): void {
  readings.clear();
}

/**
 * The listings a stored photo's items are or were for sale under, and the
 * shops that have sold them. Null when the photo is not in the store.
 */
export async function findSales(blobName: string, catalogue: Listing[]): Promise<PhotoSales | null> {
  const store = await getPhotoStore();
  const photo = await store.read(blobName);
  if (!photo) return null;

  const pool = catalogue.filter(everListed);
  const [hash, described] = await Promise.all([
    storedFingerprint(blobName),
    readItems(blobName, photo.bytes, photo.contentType),
  ]);
  const pictures = hash ? await pictureMatches(pool, hash) : new Map<string, PictureMatch>();
  const items = described ?? [];

  // Each listing goes to the one item it matches best. A listing that uses this
  // very picture is about the photo's main item, so it counts toward the first.
  const best = new Map<string, { group: number; score: number }>();
  pool.forEach((listing) => {
    const picture = pictureScore(pictures.get(listing.id));
    items.forEach((item, group) => {
      const words = describedScore(listing, item);
      const score = (words >= MIN_WORDS ? words : 0) + (group === 0 ? picture : 0);
      if (score > 0 && score > (best.get(listing.id)?.score ?? 0)) best.set(listing.id, { group, score });
    });
    // Nothing named in the photo: the picture is all there is to go on.
    if (items.length === 0 && picture > 0) best.set(listing.id, { group: 0, score: picture });
  });

  const labels: (string | null)[] = items.length > 0
    ? items.map((item) => item.query || item.keywords.join(' '))
    : [null];
  const groups: SalesGroup[] = labels.map((label, group) => ({
    label,
    listings: pool
      .filter((listing) => best.get(listing.id)?.group === group)
      .sort((a, b) => Number(onSale(b)) - Number(onSale(a))
        || best.get(b.id)!.score - best.get(a.id)!.score
        || b.createdAt.localeCompare(a.createdAt))
      .slice(0, PER_ITEM),
  })).filter((group) => group.listings.length > 0);

  const bySeller = new Map<string, PastSeller>();
  for (const listing of groups.flatMap((group) => group.listings)) {
    if (!hasSold(listing)) continue;
    const seller = bySeller.get(listing.sellerId) ?? { sellerId: listing.sellerId, unitsSold: 0, items: 0 };
    seller.unitsSold += listing.soldCount ?? 0;
    seller.items += 1;
    bySeller.set(listing.sellerId, seller);
  }
  const sellers = [...bySeller.values()]
    .sort((a, b) => b.unitsSold - a.unitsSold || b.items - a.items)
    .slice(0, SELLERS);

  return { items: groups, sellers };
}
