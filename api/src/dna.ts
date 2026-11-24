import { randomUUID } from 'node:crypto';
import type { Listing, Post, RegionBox, SiteContent, Want } from '../../shared/models.js';
import {
  DNA_PREFIX, DNA_TAGS_PER_POST, HUNT_COVERED, SAME_WITH_PHOTO, otherModel, sameProductWords, covered, dnaDocId, heatOf, lineOf,
  linkKey, nameFrom, pieceKey, productWords, sameCategory, wordLikeness,
  type DnaLine, type DnaLink, type DnaLinkKind, type DnaSummary, type ProductDna,
} from '../../shared/dna.js';
import { getRepository } from './data/index.js';
import { hasPieces, isPieceSold, MAX_PIECES } from '../../shared/pieces.js';
import { cropPixels, overlapOfBoxes, printsOfPixels } from './image-hash.js';
import { decodeJpeg, encodeJpeg } from './storage/compress.js';
import { sameProductInPhotos, visionAvailable } from './vision.js';
import { everListed, findSales, onSale, textSales } from './photo-sales.js';
import { listingHashes, pictureLooks, type PictureLook } from './photo-search.js';
import { getPhotoStore, ownPhotoName } from './storage/index.js';

/**
 * Product DNA on the server: where each DNA is kept, how things are linked to
 * one, and the small summary cards are worked out from.
 *
 * Every DNA is a `siteContent` row, `dna:<id>`: the database is at its
 * container ceiling, and that container is already read whole by id or as a
 * range of ids, which is exactly how DNAs are read. Each host instance keeps
 * all of them in memory for a minute, with a reverse index from each linked
 * thing to its DNAs, so a listing page asking "which DNA is this?" is a map
 * lookup.
 *
 * Linking is automatic and lazy. A listing is linked when it is listed, and
 * any listing that somehow is not is linked the first time anyone asks about
 * it or a sweep finds it; a post or a hunt is linked when it is first asked
 * about. Only listings start a DNA - a post or a hunt joins one that exists.
 * A listing whose photo holds several named things - a lot sold piece by
 * piece, a set with each thing listed - is on one DNA per thing, each under
 * the name its seller gave it and matched on its own against every other
 * listing, and every other listing's things.
 * An owner's own choice - a listing moved, a post tagged or untagged - is
 * kept, and the matcher never puts back what an owner took off.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

interface DnaIndex {
  at: number;
  byId: Map<string, ProductDna>;
  /** `kind:id` -> the DNAs it is linked to. */
  byLink: Map<string, string[]>;
}

const INDEX_MS = 60_000;
let held: { at: number; index: Promise<DnaIndex> } | null = null;

function indexOf(rows: SiteContent[]): DnaIndex {
  const index: DnaIndex = { at: Date.now(), byId: new Map(), byLink: new Map() };
  for (const row of rows) {
    const dna = row.data as ProductDna | null;
    if (dna && typeof dna === 'object' && typeof dna.id === 'string') place(index, dna);
  }
  return index;
}

function place(index: DnaIndex, dna: ProductDna): void {
  const before = index.byId.get(dna.id);
  if (before) {
    for (const link of before.links) {
      const key = linkKey(link.kind, link.id);
      const left = (index.byLink.get(key) ?? []).filter((id) => id !== dna.id);
      if (left.length) index.byLink.set(key, left); else index.byLink.delete(key);
    }
  }
  dna = withNameWords(dna);
  index.byId.set(dna.id, dna);
  if (dna.mergedInto) return;
  for (const link of dna.links) {
    const key = linkKey(link.kind, link.id);
    const ids = index.byLink.get(key) ?? [];
    if (!ids.includes(dna.id)) index.byLink.set(key, [...ids, dna.id]);
  }
}

/**
 * A DNA's words with its name's: DNAs started before model numbers were kept
 * ("Mark 85") stored words without them, and their names still have them.
 */
function withNameWords(dna: ProductDna): ProductDna {
  const extra = productWords(dna.name).filter((word) => !dna.words.includes(word));
  return extra.length > 0 ? { ...dna, words: [...dna.words, ...extra] } : dna;
}

/** Every DNA, from this instance's copy when it is under a minute old. */
export function dnaIndex(repository: Repo): Promise<DnaIndex> {
  if (!held || Date.now() - held.at > INDEX_MS) {
    const index = repository.listSiteContentRange(DNA_PREFIX, 'dna;').then(indexOf);
    const entry = { at: Date.now(), index };
    held = entry;
    index.catch(() => { if (held === entry) held = null; });
  }
  return held.index;
}

/** For tests: read every DNA afresh next time. */
export function forgetDnaIndex(): void {
  held = null;
}

/** A DNA by id, following merges to the one it now lives in. */
export async function getDna(repository: Repo, id: string): Promise<ProductDna | null> {
  const index = await dnaIndex(repository);
  let dna = index.byId.get(id) ?? null;
  for (let hop = 0; dna?.mergedInto && hop < 4; hop += 1) dna = index.byId.get(dna.mergedInto) ?? null;
  return dna;
}

/** The live DNAs a thing is linked to. */
export async function dnasLinked(repository: Repo, kind: DnaLinkKind, id: string): Promise<ProductDna[]> {
  const index = await dnaIndex(repository);
  return (index.byLink.get(linkKey(kind, id)) ?? [])
    .map((dnaId) => index.byId.get(dnaId))
    .filter((dna): dna is ProductDna => Boolean(dna && !dna.mergedInto));
}

/** Change one DNA and keep this instance's copy in step. */
export async function saveDna(
  repository: Repo, id: string, change: (current: ProductDna | null) => ProductDna | null,
): Promise<ProductDna | null> {
  const index = await dnaIndex(repository);
  const known = index.byId.get(id) ?? null;
  // Nothing would change against what this instance holds: no write at all.
  if (known && change(known) === null) return known;
  let result: ProductDna | null = null;
  const now = new Date().toISOString();
  await repository.mutateSiteContent(dnaDocId(id), (row) => {
    const next = change((row?.data as ProductDna | undefined) ?? null);
    result = next ? { ...next, updatedAt: now } : null;
    // Nothing to change: the row is written back as it was.
    if (!result) return row ?? { id: dnaDocId(id), data: null, updatedBy: null, createdAt: now, updatedAt: now };
    return { id: dnaDocId(id), data: result, updatedBy: null, createdAt: row?.createdAt ?? now, updatedAt: now };
  });
  if (result) place(index, result);
  return result ?? known;
}

function newDna(name: string, category: string, line: DnaLine, words: string[], cover: string | null): ProductDna {
  const now = new Date().toISOString();
  return {
    id: `p${randomUUID().replace(/-/g, '').slice(0, 11)}`,
    name, category, line, words, cover,
    links: [], blocked: [], mergedInto: null, background: null, backgroundTriedAt: null,
    createdAt: now, updatedAt: now,
  };
}

const link = (kind: DnaLinkKind, id: string, partition: string, by: DnaLink['by'], piece: string | null = null): DnaLink =>
  ({ kind, id, partition, by, at: new Date().toISOString(), ...(piece ? { piece } : {}) });

/** Whether a link is to this thing: the same kind and id, and the same piece of a listing of several. */
const sameThing = (entry: DnaLink, kind: DnaLinkKind, id: string, piece: string | null) =>
  entry.kind === kind && entry.id === id && (entry.piece ?? null) === piece;

/** The keys `blocked` may hold for a thing: the whole of it, and the one piece. */
const blockKeys = (kind: DnaLinkKind, id: string, piece: string | null) =>
  (piece && kind === 'listing' ? [linkKey(kind, id), pieceKey(id, piece)] : [linkKey(kind, id)]);

/** Add a link to a DNA, once. */
export async function addLink(repository: Repo, dnaId: string, entry: DnaLink): Promise<ProductDna | null> {
  return saveDna(repository, dnaId, (current) => {
    if (!current) return null;
    const piece = entry.piece ?? null;
    const keys = blockKeys(entry.kind, entry.id, piece);
    const blocked = entry.by === 'auto' ? current.blocked : current.blocked.filter((value) => !keys.includes(value));
    if (entry.by === 'auto' && keys.some((key) => current.blocked.includes(key))) return null;
    if (current.links.some((existing) => sameThing(existing, entry.kind, entry.id, piece))) {
      return blocked.length === current.blocked.length ? null : { ...current, blocked };
    }
    return { ...current, blocked, links: [...current.links, entry] };
  });
}

/**
 * Take a link off a DNA; `block` stops the matcher putting it back. `piece`
 * names one thing of a listing of several (null: the listing as a whole);
 * left out, every link of the thing goes.
 */
export async function removeLink(
  repository: Repo, dnaId: string, kind: DnaLinkKind, id: string, block: boolean, piece?: string | null,
): Promise<ProductDna | null> {
  return saveDna(repository, dnaId, (current) => {
    if (!current) return null;
    const key = piece ? pieceKey(id, piece) : linkKey(kind, id);
    const links = current.links.filter((entry) => (piece === undefined
      ? !(entry.kind === kind && entry.id === id) : !sameThing(entry, kind, id, piece)));
    const blocks = block && !current.blocked.includes(key);
    if (links.length === current.links.length && !blocks) return null;
    return { ...current, links, blocked: blocks ? [...current.blocked, key] : current.blocked };
  });
}

export const photoOf = (listing: Pick<Listing, 'photos'>): string | null => {
  const photo = listing.photos.find((entry) => entry.isPrimary) ?? listing.photos[0];
  return photo?.thumbUrl ?? photo?.url ?? null;
};

/* -------------------------------------------------------------------------- */
/* Listings, and the things in them                                           */
/* -------------------------------------------------------------------------- */

/** One thing a listing sells that a DNA can be about: the listing itself, or one of the things in its photo. */
export interface ListingItem {
  /** The piece, for a listing of several things; null for the listing as a whole. */
  piece: string | null;
  /** Its own name: the listing's title, or the one the seller gave the piece. */
  title: string;
  /** Its own price: the piece's, or its share of a set's. */
  priceMinor: number;
  line: DnaLine;
  /** Where it sits in the lead photo; empty for the listing as a whole. */
  boxes: RegionBox[];
  /** A piece bought on its own and gone. The things in a set sell with the set. */
  sold: boolean;
  /** One of the things in a set sold all together: buyers buy the set. */
  set: boolean;
}

const wholeOf = (listing: Listing): ListingItem => ({
  piece: null, title: listing.title, priceMinor: listing.priceMinor, line: lineOf(listing.category, listing.attributes),
  boxes: [], sold: false, set: false,
});

/**
 * The things a listing sells, each a product of its own: every named thing in
 * the photo of a lot sold piece by piece or of a set, or else the listing as
 * a whole. A piece is on the line its seller gave it, when the listing says
 * "some originals, some copies".
 */
export function itemsOf(listing: Listing): ListingItem[] {
  const set = !hasPieces(listing);
  const rows = (set ? listing.setItems : listing.pieces) ?? [];
  if (rows.length < 2) return [wholeOf(listing)];
  const items = rows
    .filter((row) => row.id && productWords(row.title).length > 0)
    .slice(0, MAX_PIECES)
    .map((row): ListingItem => ({
      piece: row.id,
      title: row.title,
      priceMinor: row.priceMinor,
      line: lineOf(listing.category, row.authenticity ? { ...listing.attributes, authenticity: row.authenticity } : listing.attributes),
      boxes: row.boxes ?? [],
      sold: !set && isPieceSold(row),
      set,
    }));
  return items.length > 0 ? items : [wholeOf(listing)];
}

/** One thing on a DNA, with the listing it is in. */
export interface LinkedItem extends ListingItem {
  listing: Listing;
}

/**
 * The things a DNA's listing links stand for, as the catalogue has them now:
 * each piece at its own price and name, each whole listing at its own. A link
 * to a piece the seller has since taken off the listing is skipped.
 */
export function linkedItems(dna: ProductDna, byId: Map<string, Listing>): LinkedItem[] {
  const items: LinkedItem[] = [];
  for (const entry of dna.links) {
    if (entry.kind !== 'listing') continue;
    const listing = byId.get(entry.id);
    if (!listing || !everListed(listing)) continue;
    const piece = entry.piece ?? null;
    const item = piece ? itemsOf(listing).find((each) => each.piece === piece) : wholeOf(listing);
    if (item) items.push({ ...item, listing });
  }
  return items;
}

/** Whether a thing can be bought now: its listing is on sale, and a piece is not gone. */
export const itemOnSale = (item: LinkedItem): boolean => onSale(item.listing) && !item.sold;

/** Each listing once, from a DNA's things: what counts saves, views and sales of the listing. */
export const listingsOf = (items: readonly LinkedItem[]): Listing[] =>
  [...new Map(items.map((item) => [item.listing.id, item.listing])).values()];

/** Whether a DNA has a link to this thing of this listing. */
export const holds = (dna: ProductDna, listingId: string, piece: string | null) =>
  dna.links.some((entry) => sameThing(entry, 'listing', listingId, piece));

/** The fingerprints of the part of the lead photo a piece sits in; every photo's, for the listing as a whole. */
function hashesOf(listing: Listing, item: ListingItem): string[] {
  if (!item.piece) return listing.photos.map((photo) => photo.imageHash).filter((hash): hash is string => Boolean(hash));
  const lead = listing.photos.find((photo) => photo.isPrimary) ?? listing.photos[0];
  return (lead?.regions ?? [])
    .filter((region) => item.boxes.some((box) => overlapOfBoxes(box, region.box) >= 0.5))
    .map((region) => region.imageHash);
}

/**
 * The DNAs a listing is on, linking it now where it is not yet: one for each
 * thing it sells (see `itemsOf`). Empty for a listing the public never sees -
 * a draft, a private deal, an unlisted item.
 *
 * A link the listing no longer fits - the whole of a listing since split into
 * pieces, a piece since taken off it - is taken off, so each DNA's prices
 * stay those of things that are for sale.
 */
export async function dnasForListing(repository: Repo, listing: Listing, catalogue: Listing[]): Promise<ProductDna[]> {
  if (!everListed(listing)) return [];
  const items = itemsOf(listing);
  const pieces = new Set(items.map((item) => item.piece));
  for (const dna of await dnasLinked(repository, 'listing', listing.id)) {
    for (const entry of dna.links) {
      if (entry.kind !== 'listing' || entry.id !== listing.id || pieces.has(entry.piece ?? null)) continue;
      await removeLink(repository, dna.id, 'listing', listing.id, false, entry.piece ?? null);
    }
  }
  // The matcher's own links that number the model differently from the thing
  // ("Mark III" on "Mark 85"): taken off, so the thing is matched again.
  for (const dna of await dnasLinked(repository, 'listing', listing.id)) {
    for (const entry of dna.links) {
      if (entry.kind !== 'listing' || entry.id !== listing.id || entry.by !== 'auto') continue;
      const item = items.find((each) => each.piece === (entry.piece ?? null));
      if (item && otherModel(productWords(item.title), dna.words)) {
        await removeLink(repository, dna.id, 'listing', listing.id, false, entry.piece ?? null);
      }
    }
  }
  const found: ProductDna[] = [];
  for (const item of items) {
    const dna = await dnaForItem(repository, listing, item, catalogue, false).catch(() => null);
    if (dna && !found.some((entry) => entry.id === dna.id)) found.push(dna);
  }
  return found;
}

/** The first DNA a listing is on, linking it if it is not yet. See `dnasForListing`. */
export async function dnaForListing(repository: Repo, listing: Listing, catalogue: Listing[]): Promise<ProductDna | null> {
  return (await dnasForListing(repository, listing, catalogue))[0] ?? null;
}

/**
 * The DNA one thing a listing sells belongs to, linking it now if it is not
 * yet: to the DNA of the same product, or to a new one it starts, under the
 * thing's own name.
 *
 * Same product means the same category, the same line as the seller said it,
 * and then: names that say the same thing; or the same photo, or a photo of
 * the same thing, with names alike enough to back it up. A piece of a lot is
 * matched by its own name and the part of the photo it sits in, so it joins a
 * listing of that thing alone, or the same thing in another shop's lot.
 * `fresh`: its seller said it is a product of its own.
 */
export async function dnaForItem(
  repository: Repo, listing: Listing, item: ListingItem, catalogue: Listing[], fresh = false,
): Promise<ProductDna | null> {
  if (!everListed(listing)) return null;
  const existing = (await dnasLinked(repository, 'listing', listing.id)).find((dna) => holds(dna, listing.id, item.piece));
  if (existing) return existing;

  const index = await dnaIndex(repository);
  const words = productWords(item.title);
  const keys = blockKeys('listing', listing.id, item.piece);
  const candidates = fresh ? [] : [...index.byId.values()].filter((dna) => !dna.mergedInto && dna.line === item.line
    && sameCategory(dna.category, listing.category) && !keys.some((key) => dna.blocked.includes(key)));

  // The image scan: the thing's own picture against the pictures of the
  // listings already on each DNA its name could be. The same picture, or the
  // same thing in another picture, makes a weaker name enough; and a match on
  // the name alone has to stand up to the pictures - another colourway of the
  // same mould, or a thing that looks nothing like it, is another product.
  const plausible = candidates.filter((dna) => !otherModel(words, dna.words) && wordLikeness(words, dna.words) >= PHOTO_WORDS);
  const scanned = await scanAgainst(listing, item, plausible, catalogue).catch(() => new Map<string, PictureLook>());

  const ranked = plausible.map((dna) => {
    const like = wordLikeness(words, dna.words);
    const look = scanned.get(dna.id);
    const photo = look?.same ? 2 : look?.sameItem ? 1 : 0;
    const score = photo === 2 ? 2 + like
      : photo === 1 && like >= SAME_WITH_PHOTO ? 1 + like
        : sameProductWords(words, dna.words) ? like : 0;
    return { dna, score, like, photo, look };
  }).filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.dna.links.length - a.dna.links.length);

  // A match on the name alone, the pictures not settling it, is looked at:
  // the same mould in other colours is another product, and so is whatever
  // Claude, seeing both pictures, says is another version.
  let best: { dna: ProductDna; score: number } | null = null;
  let looked = 0;
  for (const entry of ranked) {
    if (entry.photo === 0 && entry.like < 1) {
      if (entry.look?.variant) continue;
      if (looked < EYE_CHECKS) {
        looked += 1;
        const same = await sameByEye(listing, item, entry.dna, catalogue).catch(() => null);
        if (same === false) continue;
      }
    }
    best = entry;
    break;
  }

  const entry = link('listing', listing.id, listing.sellerId, fresh ? 'owner' : 'auto', item.piece);
  // A piece's picture is the whole lot: a listing of that thing alone gives its DNA a better one.
  const cover = item.piece ? null : photoOf(listing);
  if (best) {
    const joined = await addLink(repository, best.dna.id, entry);
    // A cover for a DNA that never had one.
    if (joined && !joined.cover && cover) {
      return saveDna(repository, joined.id, (current) => (current ? { ...current, cover } : null));
    }
    return joined ?? best.dna;
  }
  const started = newDna(nameFrom(item.title), listing.category, item.line, words, cover);
  // Other listings of the same product nobody has linked yet - listed before
  // DNAs existed - join it as it starts, so its first reader sees every shop.
  const siblings = fresh ? [] : catalogue.filter((other) => other.id !== listing.id && everListed(other)
    && !index.byLink.has(linkKey('listing', other.id)) && sameCategory(other.category, listing.category)
    && itemsOf(other)[0]!.piece === null
    && lineOf(other.category, other.attributes) === item.line && sameProductWords(words, productWords(other.title)))
    .slice(0, 60)
    .map((other) => link('listing', other.id, other.sellerId, 'auto'));
  return saveDna(repository, started.id, () => ({ ...started, links: [entry, ...siblings] }));
}

/** Names this alike are worth a look at the pictures; a picture of the same thing then needs no more. */
const PHOTO_WORDS = 0.34;
/** Matches looked at by eye per thing, at most: each is a call to Claude. */
const EYE_CHECKS = 3;
/** Listings compared per item, at most: the busiest DNAs' first. */
const SCAN_POOL = 120;

/**
 * The fingerprints of a thing: for a piece, the part of the lot's lead photo
 * it sits in, cut out as image search cuts out a thing it was pointed at;
 * for a whole listing, each of its stored photos and the items in them.
 */
const pieceScans = new Map<string, Promise<string[]>>();
async function scanOf(listing: Listing, item: ListingItem): Promise<string[]> {
  const known = hashesOf(listing, item);
  if (known.length > 0) return known;
  if (!item.piece) return listingHashes(listing);
  const lead = listing.photos.find((photo) => photo.isPrimary) ?? listing.photos[0];
  if (!lead?.blobName || item.boxes.length === 0) return [];
  const key = `${lead.blobName}|${JSON.stringify(item.boxes)}`;
  let scan = pieceScans.get(key);
  if (!scan) {
    scan = (async () => {
      const photo = await (await getPhotoStore()).read(lead.blobName);
      if (!photo || photo.contentType !== 'image/jpeg') return [];
      const prints = printsOfPixels(decodeJpeg(photo.bytes), item.boxes);
      return prints?.regions.map((region) => region.imageHash) ?? [];
    })().catch(() => []);
    if (pieceScans.size > 2_000) pieceScans.delete(pieceScans.keys().next().value!);
    pieceScans.set(key, scan);
  }
  return scan;
}

type Picture = { bytes: Uint8Array; contentType: string };

/** A thing's own picture: the listing's lead photo, or for a piece the part of it the piece sits in. */
async function pictureOf(listing: Listing, item: ListingItem): Promise<Picture | null> {
  const lead = listing.photos.find((photo) => photo.isPrimary) ?? listing.photos[0];
  if (!lead?.blobName) return null;
  const photo = await (await getPhotoStore()).read(lead.blobName);
  if (!photo) return null;
  if (!item.piece || item.boxes.length === 0) return { bytes: photo.bytes, contentType: photo.contentType };
  if (photo.contentType !== 'image/jpeg') return null;
  return { bytes: encodeJpeg(cropPixels(decodeJpeg(photo.bytes), item.boxes[0]!), 85), contentType: 'image/jpeg' };
}

/** Who looks at two pictures and says whether they are one product: Claude, unless a test says otherwise. */
let compareByEye: (a: Picture, b: Picture, titles: [string, string]) => Promise<boolean | null> = sameProductInPhotos;
/** For tests: look at pictures some other way (null puts Claude back). */
export function useEyeCheck(check: typeof compareByEye | null): void {
  compareByEye = check ?? sameProductInPhotos;
  verdicts.clear();
}

const verdicts = new Map<string, Promise<boolean | null>>();

/**
 * Whether a thing and a DNA, matched by name alone, look like one product:
 * the thing's picture beside the DNA's best one - a listing of the product
 * alone if it has one. Null when either has no picture, or nobody could say.
 */
async function sameByEye(listing: Listing, item: ListingItem, dna: ProductDna, catalogue: Listing[]): Promise<boolean | null> {
  if (compareByEye === sameProductInPhotos && !visionAvailable()) return null;
  const key = `${listing.id}#${item.piece ?? ''}|${dna.id}`;
  let verdict = verdicts.get(key);
  if (!verdict) {
    verdict = (async () => {
      const byId = new Map(catalogue.map((other) => [other.id, other]));
      const theirs = linkedItems(dna, byId).filter((other) => other.listing.id !== listing.id && other.listing.photos.length > 0)
        .sort((a, b) => Number(a.piece !== null) - Number(b.piece !== null))[0];
      if (!theirs) return null;
      const [mine, other] = await Promise.all([pictureOf(listing, item), pictureOf(theirs.listing, theirs)]);
      if (!mine || !other) return null;
      return compareByEye(mine, other, [item.title, theirs.title]);
    })().catch(() => null);
    if (verdicts.size > 5_000) verdicts.delete(verdicts.keys().next().value!);
    verdicts.set(key, verdict);
  }
  return verdict;
}

/** How a thing's picture compares with each DNA's listings: the closest look per DNA. */
async function scanAgainst(
  listing: Listing, item: ListingItem, dnas: ProductDna[], catalogue: Listing[],
): Promise<Map<string, PictureLook>> {
  const byDna = new Map<string, PictureLook>();
  if (dnas.length === 0) return byDna;
  const hashes = await scanOf(listing, item);
  if (hashes.length === 0) return byDna;
  const onDna = new Map<string, string[]>();
  for (const dna of [...dnas].sort((a, b) => b.links.length - a.links.length)) {
    for (const entry of dna.links) {
      if (entry.kind === 'listing' && entry.id !== listing.id) onDna.set(entry.id, [...(onDna.get(entry.id) ?? []), dna.id]);
    }
  }
  const byId = new Map(catalogue.map((other) => [other.id, other]));
  const pool = [...onDna.keys()].map((id) => byId.get(id)).filter((other): other is Listing => Boolean(other)).slice(0, SCAN_POOL);
  const looks = await pictureLooks(pool, hashes);
  // Per DNA: the same picture or the same thing if any of its listings shows it, and the closest look.
  for (const [listingId, look] of looks) {
    for (const dnaId of onDna.get(listingId) ?? []) {
      const held = byDna.get(dnaId);
      byDna.set(dnaId, held ? {
        ...held,
        same: held.same || look.same,
        sameItem: held.sameItem || look.sameItem,
        variant: held.variant || look.variant,
        visual: Math.max(held.visual, look.visual),
        look: Math.max(held.look, look.look),
      } : look);
    }
  }
  return byDna;
}

/** Whether every thing a listing sells is on a DNA. */
function linkedWhole(index: DnaIndex, listing: Listing): boolean {
  const dnas = (index.byLink.get(linkKey('listing', listing.id)) ?? []).map((id) => index.byId.get(id))
    .filter((dna): dna is ProductDna => Boolean(dna));
  if (dnas.length === 0) return false;
  // Most listings are one thing on one DNA: no need to look further.
  if (!hasPieces(listing) && (listing.setItems?.length ?? 0) < 2) return true;
  return itemsOf(listing).every((item) => dnas.some((dna) => holds(dna, listing.id, item.piece)));
}

let sweeping: Promise<number> | null = null;
/** Recent posts and open hunts looked at per sweep. */
const COMMUNITY_SWEEP = 60;

/**
 * Link listings nobody has asked about yet, newest first, a few at a time:
 * listings from before DNAs existed, or made while a link failed. One sweep
 * at a time per instance.
 */
export function sweepListings(repository: Repo, catalogue: Listing[], limit = 40): Promise<number> {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const index = await dnaIndex(repository);
    const waiting = catalogue
      .filter((listing) => everListed(listing) && !linkedWhole(index, listing))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    let linked = 0;
    for (const listing of waiting) {
      if ((await dnasForListing(repository, listing, catalogue).catch(() => [])).length > 0) linked += 1;
    }
    // Then what people said: recent posts and open hunts, so a product's page
    // has its community without waiting for somebody to open each post.
    const [posts, wants] = await Promise.all([
      repository.listRecentPosts(COMMUNITY_SWEEP).catch(() => [] as Post[]),
      repository.listOpenWants({ limit: COMMUNITY_SWEEP }).catch(() => [] as Want[]),
    ]);
    const now = new Date().toISOString();
    for (const post of posts) {
      if (post.visibleAt && post.visibleAt > now) continue;
      if (index.byLink.has(linkKey('post', post.id)) || looked.has(`${post.channelId}/${post.id}`)) continue;
      linked += (await dnasForPost(repository, post, catalogue).catch(() => [])).length;
    }
    for (const want of wants) {
      if (index.byLink.has(linkKey('want', want.id)) || looked.has(`want/${want.id}`)) continue;
      if (await dnaForWant(repository, want, catalogue).catch(() => null)) linked += 1;
    }
    return linked;
  })().finally(() => { sweeping = null; });
  return sweeping;
}

/* -------------------------------------------------------------------------- */
/* Posts and hunts                                                            */
/* -------------------------------------------------------------------------- */

/** Has this post been looked at for products: kept per instance, so a post with none is not looked at on every view. */
const looked = new Map<string, number>();
const LOOK_AGAIN_MS = 10 * 60_000;

/**
 * The DNAs a post is about, linking them the first time: the item a sale post
 * sells, each thing its photos are found to show - one photo of a shelf can
 * be several products - and the items its words name. Only sure matches; a
 * post nobody can be sure of is left for its author to tag.
 */
export async function dnasForPost(repository: Repo, post: Post, catalogue: Listing[]): Promise<ProductDna[]> {
  const linked = await dnasLinked(repository, 'post', post.id);
  const key = `${post.channelId}/${post.id}`;
  if (linked.length > 0 || Date.now() - (looked.get(key) ?? 0) < LOOK_AGAIN_MS) return linked;
  if (looked.size > 5_000) looked.delete(looked.keys().next().value!);
  looked.set(key, Date.now());

  const byId = new Map(catalogue.map((listing) => [listing.id, listing]));
  // Each listing found, with the words that found it: for a lot, they say which of its things.
  const found: { listing: Listing; hint: string | null }[] = [];
  const sold = post.listingId ? byId.get(post.listingId) : undefined;
  if (sold) found.push({ listing: sold, hint: null });
  // Words alone are held to more than a hint: the caption has to name what
  // identifies the item ("Dunk Low" is not "Dunk Low Setsubun"), and a
  // product only named is taken to be the original - a post about a copy is
  // on its DNA when it sells that copy, shows its photo, or its poster says so.
  const said = productWords(post.body.slice(0, 500));
  const named = (listing: Listing) => covered(productWords(listing.title), said) >= HUNT_COVERED
    && lineOf(listing.category, listing.attributes) === 'original';
  const photos = [...new Set([post.photoUrl, ...(post.photoUrls ?? [])].filter((url): url is string => Boolean(url)))].slice(0, 4);
  let read = 0;
  for (const url of photos) {
    const name = await ownPhotoName(url).catch(() => null);
    if (!name) continue;
    read += 1;
    const sales = await findSales(name, catalogue, post.body.slice(0, 500), post.authorId).catch(() => null);
    // A group with no label was found by the picture; a labelled one by the caption's words.
    for (const group of sales?.items ?? []) {
      found.push(...group.listings.filter((listing) => group.label === null || named(listing)).slice(0, 3)
        .map((listing) => ({ listing, hint: group.label })));
    }
  }
  // No photo this app stores (none at all, or only links elsewhere): the words are all there is.
  if (read === 0) found.push(...textSales(catalogue, post.body).filter(named).slice(0, 6).map((listing) => ({ listing, hint: null })));

  const dnas: ProductDna[] = [];
  for (const { listing, hint } of found) {
    if (dnas.length >= DNA_TAGS_PER_POST) break;
    const all = await dnasForListing(repository, listing, catalogue).catch(() => [] as ProductDna[]);
    for (const dna of thingsNamed(all, hint ?? post.body.slice(0, 500))) {
      if (dnas.length >= DNA_TAGS_PER_POST) break;
      if (dnas.some((entry) => entry.id === dna.id) || dna.blocked.includes(linkKey('post', post.id))) continue;
      dnas.push(dna);
    }
  }
  const saved: ProductDna[] = [];
  for (const dna of dnas) {
    const after = await addLink(repository, dna.id, link('post', post.id, post.channelId, 'auto'));
    saved.push(after ?? dna);
  }
  return saved;
}

/**
 * Of a listing's DNAs - one per thing, for a lot - those the words name; all
 * of them when the words name none, or the listing is one thing.
 */
export function thingsNamed(dnas: ProductDna[], words: string): ProductDna[] {
  if (dnas.length < 2) return dnas;
  const said = productWords(words);
  const named = dnas.filter((dna) => covered(dna.words, said) >= HUNT_COVERED);
  return named.length > 0 ? named : dnas;
}

/**
 * The DNA a hunt asks for, linking it the first time: one whose words cover
 * what the hunt says, and only when one stands out - "Nike Dunk" alone could
 * be any of a dozen, and is left for the hunter to point at. Failing that, a
 * photo the hunter added that matches a listing.
 */
export async function dnaForWant(repository: Repo, want: Want, catalogue: Listing[]): Promise<ProductDna | null> {
  const [linked] = await dnasLinked(repository, 'want', want.id);
  const key = `want/${want.id}`;
  if (linked || Date.now() - (looked.get(key) ?? 0) < LOOK_AGAIN_MS) return linked ?? null;
  looked.set(key, Date.now());

  const index = await dnaIndex(repository);
  const asked = productWords(want.title);
  const blockKey = linkKey('want', want.id);
  const scored = [...index.byId.values()]
    .filter((dna) => !dna.mergedInto && !dna.blocked.includes(blockKey)
      && (!want.category || sameCategory(dna.category, want.category)))
    .map((dna) => ({ dna, cover: covered(asked, dna.words), like: wordLikeness(asked, dna.words) }))
    .filter((entry) => entry.cover >= HUNT_COVERED && asked.length >= 2)
    .sort((a, b) => b.like - a.like || Number(b.dna.line === 'original') - Number(a.dna.line === 'original')
      || b.dna.links.length - a.dna.links.length);
  let chosen: ProductDna | null = null;
  const [first, second] = scored;
  if (first && (!second || first.like > second.like || second.dna.line !== first.dna.line)) chosen = first.dna;

  if (!chosen && want.photoUrls?.length) {
    const name = await ownPhotoName(want.photoUrls[0]!).catch(() => null);
    const sales = name ? await findSales(name, catalogue, want.title, null).catch(() => null) : null;
    const listing = sales?.items[0]?.listings[0];
    if (listing) {
      // A lot: the thing in it the hunt's words are most like.
      const all = await dnasForListing(repository, listing, catalogue).catch(() => [] as ProductDna[]);
      chosen = [...all].sort((a, b) => wordLikeness(asked, b.words) - wordLikeness(asked, a.words))[0] ?? null;
    }
  }
  if (!chosen) return null;
  return (await addLink(repository, chosen.id, link('want', want.id, want.buyerId, 'auto'))) ?? chosen;
}

/* -------------------------------------------------------------------------- */
/* Summaries                                                                  */
/* -------------------------------------------------------------------------- */

/** The small card for a DNA, from the catalogue alone: no database reads. */
export function summaryOf(dna: ProductDna, byId: Map<string, Listing>): DnaSummary {
  const items = linkedItems(dna, byId);
  const listings = listingsOf(items);
  const selling = items.filter(itemOnSale);
  const prices = selling.map((item) => item.priceMinor);
  const sellers = new Set(selling.map((item) => item.listing.sellerId));
  const { heat, label } = heatOf({
    hunting: dna.links.filter((entry) => entry.kind === 'want').length,
    saves: listings.reduce((sum, listing) => sum + (listing.likeCount ?? 0), 0),
    views: listings.reduce((sum, listing) => sum + (listing.viewCount ?? 0), 0),
    sold: listings.reduce((sum, listing) => sum + (listing.soldCount ?? 0), 0),
    pledged: listings.reduce((sum, listing) => sum + (listing.preOrder?.pledgedCount ?? 0), 0),
    waiting: listings.reduce((sum, listing) => sum + (listing.restockWatch?.length ?? 0), 0),
  });
  const { cover, coverBox } = coverOf(dna, items);
  return {
    id: dna.id,
    name: dna.name,
    category: dna.category,
    cover,
    coverBox,
    lowMinor: prices.length ? Math.min(...prices) : null,
    highMinor: prices.length ? Math.max(...prices) : null,
    currency: selling[0]?.listing.currency ?? listings[0]?.currency ?? 'INR',
    sellers: sellers.size,
    heat,
    heatLabel: label,
    rating: dna.score && dna.score.count > 0 ? Math.round((dna.score.total / dna.score.count) * 10) / 10 : null,
    ratings: dna.score?.count ?? 0,
    mentions: dna.links.filter((entry) => entry.kind !== 'listing').length,
  };
}

/**
 * The photo a DNA is shown by. A listing of the thing alone shows it best -
 * one on sale now first - so as soon as the matcher finds one, its photo is
 * used; until then the thing is cut out of a lot's photo, by where it sits.
 */
export function coverOf(dna: ProductDna, items: readonly LinkedItem[]): { cover: string | null; coverBox: RegionBox | null } {
  if (dna.cover) return { cover: dna.cover, coverBox: null };
  const alone = items.filter((item) => !item.piece && photoOf(item.listing));
  const best = alone.find(itemOnSale) ?? alone[0];
  if (best) return { cover: photoOf(best.listing), coverBox: null };
  const piece = items.find((item) => item.piece && item.boxes.length > 0 && photoOf(item.listing))
    ?? items.find((item) => photoOf(item.listing));
  if (!piece) return { cover: null, coverBox: null };
  return { cover: photoOf(piece.listing), coverBox: piece.piece ? piece.boxes[0] ?? null : null };
}

/** Whether a DNA has anything the public can see: a listing ever listed. */
export function isShown(dna: ProductDna, byId: Map<string, Listing>): boolean {
  return !dna.mergedInto && dna.links.some((entry) => {
    if (entry.kind !== 'listing') return false;
    const listing = byId.get(entry.id);
    return Boolean(listing && everListed(listing));
  });
}

/* -------------------------------------------------------------------------- */
/* Background                                                                 */
/* -------------------------------------------------------------------------- */

const BACKGROUND_AGAIN_MS = 30 * 24 * 3600_000;

/**
 * A few lines about the product from Wikipedia, kept on the DNA when the
 * article is plainly about it: every word of the article's title is in the
 * product's name, and it names at least two of them or most of the name.
 * Tried once a month per DNA; never linked out, credited as its licence asks.
 * `DNA_BACKGROUND=off` turns it off (the tests do).
 */
export async function findBackground(repository: Repo, dna: ProductDna): Promise<void> {
  if (process.env.DNA_BACKGROUND === 'off') return;
  if (dna.backgroundTriedAt && Date.now() - Date.parse(dna.backgroundTriedAt) < BACKGROUND_AGAIN_MS) return;
  const tried = new Date().toISOString();
  await saveDna(repository, dna.id, (current) => (current ? { ...current, backgroundTriedAt: tried } : null));

  const headers = { 'User-Agent': 'Figmark/1.0 (product pages; https://figmark.in)', Accept: 'application/json' };
  const ask = async (url: string) => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    return response.ok ? (await response.json()) as unknown : null;
  };
  try {
    const query = encodeURIComponent(dna.name.slice(0, 80));
    const search = await ask(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${query}&limit=5`) as
      { pages?: { title?: string }[] } | null;
    const fits = (title: string) => {
      const words = productWords(title);
      if (words.length === 0 || !words.every((word) => dna.words.includes(word))) return false;
      return words.length >= 2 || words.length / Math.max(1, dna.words.length) >= 0.6;
    };
    const title = (search?.pages ?? []).map((page) => page.title ?? '').find(fits);
    if (!title) return;
    const page = await ask(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`) as
      { type?: string; extract?: string } | null;
    if (page?.type !== 'standard' || !page.extract) return;
    const sentences = page.extract.match(/[^.!?]+[.!?]+/g) ?? [page.extract];
    let text = '';
    for (const sentence of sentences) {
      if ((text + sentence).length > 420) break;
      text += sentence;
    }
    text = (text || page.extract.slice(0, 400)).trim();
    await saveDna(repository, dna.id, (current) => (current
      ? { ...current, background: { text, source: 'Wikipedia', title } } : null));
  } catch {
    // Offline, slow or refused: there is simply no background this month.
  }
}
