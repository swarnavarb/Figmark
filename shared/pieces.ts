/**
 * One photo, many things for sale.
 *
 * A reseller's sale post is a shelf photo and a price list: forty figures,
 * each with its own price, any of which a buyer may take. Figmark sells such
 * a photo one of two ways, which the seller picks when the photo shows more
 * than one thing:
 *
 * - **Separately** - the listing carries `pieces`, each marked where it sits
 *   in the lead photo with its own title and price. A buyer ticks the ones
 *   they want and checks out once; the order carries the pieces it bought,
 *   and each one sold is crossed out on the photo for everybody else.
 * - **All together** - an ordinary listing marked `bundle`, one price for
 *   the lot, with `bundleCount` saying how many items are in it.
 *
 * Figmark's platform fee follows the number of things sold either way, so
 * putting forty figures in one photo costs what listing them one by one
 * would: per piece when sold separately, and per item in the lot when sold
 * together. The seller says how many are in a lot; Figmark counts them too
 * and charges on whichever is more. The same thing shown twice in a photo -
 * its front and its back - is one thing, one fee.
 *
 * Pure: read by the API and the app alike, so the fee a seller is shown
 * while listing is the fee they are charged.
 */

import { MAX_PRICE_MINOR, MIN_PRICE_MINOR } from './catalog.js';
import type { RegionBox } from './models.js';

/** One thing in a photo sold on its own. */
export interface ListingPiece {
  id: string;
  title: string;
  priceMinor: number;
  /**
   * Where it sits in the lead photo, as fractions of its width and height:
   * left, top, width, height. More than one when the photo shows the same
   * thing more than once - front and back, boxed and loose - which is still
   * one thing to buy and one fee to pay.
   */
  boxes: RegionBox[];
  /** When it sold; null while it is for sale. Public: it is what crosses it out. */
  soldAt?: string | null;
  /** The order holding it. The shop's business: never sent to anybody else. */
  soldOrderId?: string | null;
  /**
   * How many different things Figmark sees in its places, for the fee: one,
   * unless the seller put different things in one row. Worked out from the
   * picture when the listing is saved; absent means one.
   */
  units?: number;
}

/** A piece as an order remembers it: what was bought, at what price, and where it was in the photo. */
export interface OrderPiece {
  id: string;
  title: string;
  priceMinor: number;
  box: RegionBox | null;
  /** Different things in it, for the fee; absent means one. */
  units?: number;
}

/**
 * How many things a set sold all together holds.
 *
 * `declared` is how many rows the seller listed, `detected` how many
 * different things Figmark found in the photo, and `charged` the count the
 * fee is worked out on - Figmark's, from the picture: rows that show the
 * same thing count once, different things count apiece, and taking most of
 * what was found off the list does not lower it.
 */
export interface BundleCount {
  declared: number;
  detected: number;
  charged: number;
}

/** Pieces one listing may carry: a shelf photo, not a warehouse. */
export const MAX_PIECES = 60;
/** Views of one piece: front, back and a detail is plenty. */
export const MAX_VIEWS = 4;
/** Items a lot may be declared to hold. */
export const MAX_BUNDLE_COUNT = 500;
const MAX_TITLE = 120;

/** Whether a listing is sold piece by piece. */
export function hasPieces(listing: { pieces?: readonly ListingPiece[] | null }): boolean {
  return Array.isArray(listing.pieces) && listing.pieces.length > 0;
}

export function isPieceSold(piece: Pick<ListingPiece, 'soldAt' | 'soldOrderId'>): boolean {
  return Boolean(piece.soldAt || piece.soldOrderId);
}

/** The pieces still for sale. */
export function piecesLeft<T extends Pick<ListingPiece, 'soldAt' | 'soldOrderId'>>(pieces: readonly T[] | null | undefined): T[] {
  return (pieces ?? []).filter((piece) => !isPieceSold(piece));
}

/** The cheapest piece still for sale - what "from ₹…" says - or of all of them once every one is gone. */
export function fromPriceMinor(pieces: readonly ListingPiece[]): number {
  const left = piecesLeft(pieces);
  const pool = left.length > 0 ? left : pieces;
  return pool.length > 0 ? Math.min(...pool.map((piece) => piece.priceMinor)) : 0;
}

/** The fee is worked out on the larger of what the seller said and what Figmark counted. */
export function chargedUnits(declared: number, detected: number): number {
  return Math.max(1, Math.round(declared) || 1, Math.round(detected) || 0);
}

/** A box sent by a client, made safe; null when it is not one. */
export function cleanBox(value: unknown): RegionBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
  const [x, y, w, h] = value as number[];
  const left = Math.min(1, Math.max(0, x!));
  const top = Math.min(1, Math.max(0, y!));
  const width = Math.min(1 - left, Math.max(0, w!));
  const height = Math.min(1 - top, Math.max(0, h!));
  // Smaller than this is a tap, not a thing.
  if (width < 0.015 || height < 0.015) return null;
  const round = (part: number) => Math.round(part * 1000) / 1000;
  return [round(left), round(top), round(width), round(height)];
}

/**
 * The pieces a seller sent, checked: each with a title, a price Figmark can
 * list and at least one place in the photo. A string says what is wrong.
 * Ids are kept when they look like ours, so an edit keeps what was sold.
 */
export function cleanPieces(value: unknown): { pieces: ListingPiece[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'The items in the photo did not come through.' };
  if (value.length < 2) return { error: 'Mark at least two items to sell them separately.' };
  if (value.length > MAX_PIECES) return { error: `At most ${MAX_PIECES} items can be sold from one listing.` };
  const seen = new Set<string>();
  const pieces: ListingPiece[] = [];
  for (const [index, raw] of (value as Record<string, unknown>[]).entries()) {
    const number = index + 1;
    const title = typeof raw?.title === 'string' ? raw.title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE) : '';
    if (title.length < 2) return { error: `Item ${number} needs a title.` };
    const price = Math.round(Number(raw?.priceMinor));
    if (!Number.isFinite(price) || price < MIN_PRICE_MINOR || price > MAX_PRICE_MINOR) {
      return { error: `Item ${number} (${title}) needs a price of at least ₹${MIN_PRICE_MINOR / 100}.` };
    }
    const boxes = (Array.isArray(raw?.boxes) ? raw.boxes : [])
      .map(cleanBox)
      .filter((box): box is RegionBox => box !== null)
      .slice(0, MAX_VIEWS);
    if (boxes.length === 0) return { error: `Mark where item ${number} (${title}) is in the photo.` };
    let id = typeof raw?.id === 'string' && /^pz_[a-z0-9]{4,16}$/.test(raw.id) ? raw.id : '';
    if (!id || seen.has(id)) id = `pz_${randomId()}`;
    seen.add(id);
    pieces.push({ id, title, priceMinor: price, boxes, soldAt: null, soldOrderId: null });
  }
  return { pieces };
}

function randomId(): string {
  let out = '';
  for (let i = 0; i < 10; i += 1) out += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)];
  return out;
}

/** What the order is called: its pieces' names, shortened past three. */
export function piecesName(pieces: readonly Pick<OrderPiece, 'title'>[]): string {
  const names = pieces.map((piece) => piece.title);
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 2).join(', ')} + ${names.length - 2} more`;
}

/**
 * What a set sold all together holds, checked: each with a place in the
 * photo, a title when the seller gave one ("Item 3" when not), and its share
 * of the set's price - the price spread evenly, the odd paise on the first.
 */
export function cleanSetItems(value: unknown, priceMinor: number): { items: ListingPiece[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'The items in the set did not come through.' };
  if (value.length < 2) return { error: 'A set needs at least two items marked on the photo.' };
  if (value.length > MAX_PIECES) return { error: `At most ${MAX_PIECES} items can be in one set.` };
  const items: ListingPiece[] = [];
  const share = Math.floor(priceMinor / value.length);
  const odd = priceMinor - share * value.length;
  for (const [index, raw] of (value as Record<string, unknown>[]).entries()) {
    const title = typeof raw?.title === 'string' ? raw.title.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE) : '';
    const boxes = (Array.isArray(raw?.boxes) ? raw.boxes : []).map(cleanBox).filter((box): box is RegionBox => box !== null).slice(0, MAX_VIEWS);
    if (boxes.length === 0) return { error: `Mark where item ${index + 1} is in the photo.` };
    items.push({ id: `pz_${randomId()}`, title: title.length >= 2 ? title : `Item ${index + 1}`, priceMinor: share + (index === 0 ? odd : 0), boxes });
  }
  return { items };
}

/**
 * A seller's edit of the pieces on a published listing, laid over what is
 * stored. A sold piece stays exactly as it sold - its title, price and place
 * are part of an order - whether or not the edit still lists it. Pieces
 * still for sale take the edit; one left out is taken down; one with no id
 * of ours is new.
 */
export function mergePieces(current: readonly ListingPiece[], edited: readonly ListingPiece[], sentIds: readonly (string | null)[]): ListingPiece[] {
  const byId = new Map(current.map((piece) => [piece.id, piece]));
  const out: ListingPiece[] = [];
  const used = new Set<string>();
  edited.forEach((piece, index) => {
    const id = sentIds[index];
    const was = id ? byId.get(id) : undefined;
    if (was && isPieceSold(was)) { out.push(was); used.add(was.id); return; }
    if (was) { out.push({ ...piece, id: was.id, soldAt: null, soldOrderId: null }); used.add(was.id); return; }
    out.push(piece);
  });
  // Sold pieces the edit left out are kept: an order is still about them.
  for (const piece of current) if (isPieceSold(piece) && !used.has(piece.id)) out.push(piece);
  return out;
}

/* ── Reading a price list ──────────────────────────────────────────────── */

export interface PriceLine {
  title: string;
  priceMinor: number;
}

/** A price on its own, as people write one: 1750, ₹1,750, Rs. 1750/-, 1.7k. */
const PRICE_ALONE = /^(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d+(?:\.\d+)?)\s*(k)?\s*(?:\/-|rs\.?|inr|₹)?\s*$/i;
/** A name with its price at the end of the same line: "Wasp - 1850", "Thing ₹3,000/-". */
const PRICE_AFTER = /^(.*?\S)\s*(?:[-–—:=@|]+\s*)?(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})+|\d{3,}(?:\.\d+)?|\d+(?:\.\d+)?\s*k)\s*(?:\/-|rs\.?|inr|₹)?\s*$/i;

function rupeesOf(digits: string, thousands?: string): number | null {
  const value = Number(digits.replace(/,/g, '').replace(/\s*k$/i, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  const k = Boolean(thousands) || /k$/i.test(digits.trim());
  return Math.round((k ? value * 1000 : value) * 100);
}

/** Words a sale post uses that are not an item: headings, "sale post", "DM to buy". */
const NOT_AN_ITEM = /^(sale post|sale|for sale|price list|prices|dm (?:me|to buy)|first come.*|shipping.*|lot.*starting.*|.*starting from.*)$/i;

/**
 * Item names and prices from a pasted price list, in order.
 *
 * Takes either shape a sale post comes in: a name and its price on one line,
 * or a name with its price on the line after. Headings and lines with no
 * price are left out.
 */
export function parsePriceList(text: string): PriceLine[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim().replace(/^(?:[•*\-–]+|\d{1,2}[.)])\s+/, '').trim()).filter(Boolean);
  const out: PriceLine[] = [];
  let pendingTitle: string | null = null;
  for (const line of lines) {
    const alone = PRICE_ALONE.exec(line);
    if (alone) {
      const price = rupeesOf(alone[1]!, alone[2]);
      if (pendingTitle && price) out.push({ title: tidyTitle(pendingTitle), priceMinor: price });
      pendingTitle = null;
      continue;
    }
    const after = PRICE_AFTER.exec(line);
    if (after) {
      const price = rupeesOf(after[2]!);
      const title = tidyTitle(after[1]!);
      if (price && title.length >= 2 && !NOT_AN_ITEM.test(title)) {
        out.push({ title, priceMinor: price });
        pendingTitle = null;
        continue;
      }
    }
    pendingTitle = NOT_AN_ITEM.test(line) ? null : line;
  }
  return out.slice(0, MAX_PIECES);
}

/** "MARVEL LEGENDS WOLVERINE CLASSIC YELLOW" reads as a title, not a shout. */
function tidyTitle(raw: string): string {
  const title = raw.replace(/[\s\-–—:=@|]+$/, '').trim().slice(0, MAX_TITLE);
  const letters = title.replace(/[^a-z]/gi, '');
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    return title.toLowerCase().replace(/\b([a-z])/g, (_, first: string) => first.toUpperCase());
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/* ── Stock ─────────────────────────────────────────────────────────────── */

interface PieceStock {
  pieces?: ListingPiece[] | null;
  priceMinor: number;
  quantityAvailable: number;
  status: string;
}

/** Price and count follow the pieces: the cheapest left, and how many are. */
function settle<T extends PieceStock>(listing: T, pieces: ListingPiece[]): T {
  const left = piecesLeft(pieces).length;
  return {
    ...listing,
    pieces,
    priceMinor: fromPriceMinor(pieces) || listing.priceMinor,
    quantityAvailable: left,
    status: left === 0 && listing.status === 'active' ? 'sold_out'
      : left > 0 && listing.status === 'sold_out' ? 'active' : listing.status,
  };
}

/**
 * The listing with an order's pieces marked sold to it, or null when any of
 * them is already somebody else's - all of them or none, so a buyer never
 * pays for half of what they ticked.
 */
export function takePieces<T extends PieceStock>(listing: T, order: { id: string; pieces?: readonly OrderPiece[] | null }, now: string): T | null {
  const wanted = new Set((order.pieces ?? []).map((piece) => piece.id));
  if (wanted.size === 0) return null;
  const pieces = listing.pieces ?? [];
  for (const id of wanted) {
    const piece = pieces.find((entry) => entry.id === id);
    if (!piece || (isPieceSold(piece) && piece.soldOrderId !== order.id)) return null;
  }
  return settle(listing, pieces.map((piece) =>
    wanted.has(piece.id) ? { ...piece, soldAt: piece.soldAt ?? now, soldOrderId: order.id } : piece));
}

/** The listing with an order's pieces back on sale: the order was called off or given back. */
export function releasePieces<T extends PieceStock>(listing: T, orderId: string): T {
  const pieces = (listing.pieces ?? []).map((piece) =>
    piece.soldOrderId === orderId ? { ...piece, soldAt: null, soldOrderId: null } : piece);
  return settle(listing, pieces);
}

/** Pieces as anybody but the shop sees them: sold or not, never to which order. */
export function publicPieces(pieces: readonly ListingPiece[]): ListingPiece[] {
  return pieces.map(({ soldOrderId, ...piece }) => ({ ...piece, soldAt: piece.soldAt ?? (soldOrderId ? 'sold' : null) }));
}

/**
 * The fee units each row carries when what is listed is fewer than the count
 * the fee may not go under - most of what was found in the photo. Each row
 * keeps the things it holds; the rest are spread one at a time over the
 * rows, so taking items off the list does not lower the fee.
 */
export function spreadUnits(perRow: readonly number[], charged: number): number[] {
  const units = perRow.map((count) => Math.max(1, Math.floor(count)));
  if (units.length === 0) return units;
  let extra = Math.max(0, Math.floor(charged) - units.reduce((sum, count) => sum + count, 0));
  for (let index = 0; extra > 0; index = (index + 1) % units.length, extra -= 1) units[index] = units[index]! + 1;
  return units;
}

/* ── What a sale photo holds: one item, copies of one, or different items ── */

/** What the title says about how many things are for sale, and whether they are alike. */
export interface TitleHint {
  /** A count the title names ("x5", "lot of 12", "pair"), or null. */
  count: number | null;
  /** It names more than one thing: a lot, a set, "and". */
  several: boolean;
  /** Alike or not, as the title says: copies ("x5", "5 pcs") true, assorted ("lot", "mixed") false, null when it does not say. */
  same: boolean | null;
}

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12 };

/**
 * A reading of a listing's title for how many things it sells. A hint, not a
 * fact: it decides nothing on its own and is never what a fee is counted on,
 * but where the photo leaves it open it tips the choice offered first.
 * Scales ("1/6", "1:12") and model numbers are not counts.
 */
export function titleHint(title: string): TitleHint {
  const text = ` ${title.toLowerCase().replace(/\b\d+\s*[/:]\s*\d+\b/g, ' ')} `;
  const num = (word: string) => NUMBER_WORDS[word] ?? Number(word);
  let count: number | null = null;
  let same: boolean | null = null;
  const take = (value: number, alike: boolean | null) => {
    if (Number.isFinite(value) && value >= 2 && value <= 500 && count === null) { count = value; if (alike !== null) same = alike; }
  };
  // Copies: "x5", "5x", "5 pcs", "pack of 3", "3 copies", "qty 4".
  for (const match of text.matchAll(/\b(?:x\s?(\d{1,3})|(\d{1,3})\s?x)\b/g)) take(num(match[1] ?? match[2]!), true);
  for (const match of text.matchAll(/\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|twelve)\s*(?:pcs|pc|pieces|nos|units|copies|qty)\b/g)) take(num(match[1]!), true);
  for (const match of text.matchAll(/\b(?:qty|quantity|pack of)\s*:?\s*(\d{1,3}|two|three|four|five|six|ten|twelve|dozen)\b/g)) take(num(match[1]!), true);
  if (/\bpair\b/.test(text)) take(2, true);
  // Different things: "lot of 12", "set of 6", "12 figures", "bundle".
  for (const match of text.matchAll(/\b(?:lot|set|bundle|combo|collection|bunch) of (\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|twelve|dozen)\b/g)) take(num(match[1]!), false);
  for (const match of text.matchAll(/\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:figures|figurines|items|toys|statues|cards|sets|boxes|funkos|pops|lots)\b/g)) take(num(match[1]!), null);
  const assorted = /\b(lot|lots|bundle|combo|collection|assorted|mixed|various|clearance|bulk|different)\b/.test(text);
  if (assorted && same === null) same = false;
  const joined = /\s(?:and|&|\+)\s/.test(text) || /\w,\s*\w/.test(text);
  return { count, several: count !== null || assorted || joined, same };
}

/** What the photo was read as, by the server (api/src/pieces.ts analyseThings). */
export interface PhotoAnalysis {
  /** Things found, each place once. */
  found: number;
  /** Of them, how many different ones: things that may be the same are one. */
  kinds: number;
  /** How many of the commonest one. */
  largest: number;
  /** Views of one thing side by side: a product's collage. */
  lineup: boolean;
  /**
   * The photo clearly shows several things: three or more separate subjects,
   * in focus, spread across it (shared/photo-things.ts clearlySeveral).
   * Anything less is one item, as the seller says. Absent from older readings.
   */
  several?: boolean;
}

export type PhotoVerdict =
  | { kind: 'one' }
  | { kind: 'copies'; count: number }
  | { kind: 'different'; count: number };

/**
 * One item, copies of one, or different items: what the sell form offers
 * first. The photo decides; the title tips it only where the photo cannot
 * tell - two things that may or may not be alike, a count the title names.
 */
export function photoVerdict(photo: PhotoAnalysis, hint: TitleHint): PhotoVerdict {
  // Trust the seller unless the photo clearly shows several things: in doubt, one item.
  if (photo.found <= 1 || photo.lineup || photo.several === false) return { kind: 'one' };
  if (photo.kinds === 1) return hint.same === false && hint.count === null ? { kind: 'different', count: photo.found } : { kind: 'copies', count: photo.found };
  // Mostly one thing, a few others: copies where the title says copies of that many.
  if (hint.same === true && hint.count !== null && (hint.count === photo.found || hint.count === photo.largest)) return { kind: 'copies', count: hint.count };
  return { kind: 'different', count: photo.kinds };
}
