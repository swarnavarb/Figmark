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
}

/** A piece as an order remembers it: what was bought, at what price, and where it was in the photo. */
export interface OrderPiece {
  id: string;
  title: string;
  priceMinor: number;
  box: RegionBox | null;
}

/**
 * How many things a lot sold all together holds.
 *
 * `declared` is the seller's word, `detected` Figmark's own count from the
 * photos, and `charged` the one the fee is worked out on: whichever is more,
 * so saying fewer than the photo shows does not lower the fee.
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
