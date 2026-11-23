import type { RegionBox } from '../../shared/models.js';
import { MAX_PIECES, type PhotoAnalysis } from '../../shared/pieces.js';
import { SHARP_RATIO, clearlySeveral, focusOf, inFocus, sameness, subjectsOf, viewsLineup } from '../../shared/photo-things.js';
import { distinctCount, groupThings, thingsInPhoto } from './photo-things.js';
import { decodeJpeg, type Raw } from './storage/compress.js';
import { getPhotoStore } from './storage/index.js';
import { visionAvailable } from './vision.js';

/**
 * A sale photo of several things, on the server: what is in it (the same
 * reading photo search makes, api/src/photo-things.ts), and how many
 * different things the seller is selling, for the platform fee.
 *
 * The count is Figmark's, never the seller's: it is worked out from the
 * picture, over every place the seller marked, every place their phone found
 * and every place Claude named. Places that show the same thing - a front and
 * a back view - count once; different things count apiece, however the
 * seller grouped them. A seller may take a few wrong finds off the list
 * (a stand, a bag of parts); taking most of them off does not lower the fee.
 */
export interface FoundPiece {
  label: string | null;
  boxes: RegionBox[];
}

export interface PieceReading {
  pieces: FoundPiece[];
  method: 'vision' | 'shape' | 'both' | 'none';
}

/** Of what was found, the share a seller may take off as wrong finds without it lowering the fee. */
export const FIND_SLACK = 0.15;

/** Readings already made, by photo: a stored photo never changes, and the seller's publish reads it again. */
const readings = new Map<string, Promise<{ reading: PieceReading; raw: Raw | null }>>();
const READINGS_MAX = 200;

async function read(blobName: string): Promise<{ reading: PieceReading; raw: Raw | null }> {
  const store = await getPhotoStore();
  const found = await store.read(blobName).catch(() => null);
  if (!found) return { reading: { pieces: [], method: 'none' }, raw: null };
  let raw: Raw | null = null;
  try {
    raw = decodeJpeg(found.bytes);
  } catch {
    raw = null;
  }
  const { things } = await thingsInPhoto(found.bytes, found.contentType, raw);
  const named = things.some((thing) => thing.source === 'named');
  const shaped = things.some((thing) => thing.source !== 'named');
  return {
    raw,
    reading: {
      pieces: things.slice(0, MAX_PIECES).map((thing) => ({ label: thing.label, boxes: thing.boxes })),
      method: named && shaped ? 'both' : named ? 'vision' : shaped ? 'shape' : 'none',
    },
  };
}

function stored(blobName: string) {
  const known = readings.get(blobName);
  if (known) return known;
  const work = read(blobName);
  if (readings.size >= READINGS_MAX) readings.delete(readings.keys().next().value!);
  readings.set(blobName, work);
  work.catch(() => readings.delete(blobName));
  return work;
}

/** The things in one of our stored photos; none when it cannot be read. */
export async function readStoredPieces(blobName: string): Promise<PieceReading> {
  return (await stored(blobName)).reading;
}

/**
 * How many different things a sale photo holds, for the fee.
 *
 * - `marked`: the places the seller kept, one list per row.
 * - `seen`: the places the seller's phone found, sent with the listing.
 *
 * Returns the count charged on, Figmark's own count of what it found, and
 * for each row how many different things it holds - a row the seller made
 * of two different figures is two.
 */
export async function countThings(blobName: string | null, marked: readonly RegionBox[][], seen: readonly RegionBox[] = []): Promise<{
  charged: number; found: number; perRow: number[];
}> {
  const { reading, raw } = blobName ? await stored(blobName) : { reading: { pieces: [], method: 'none' as const }, raw: null };
  const named = visionAvailable() ? reading.pieces.filter((piece) => piece.label).flatMap((piece) => piece.boxes) : [];
  const kept = marked.flat();
  // Everything found, by anybody, each place once.
  const everything: RegionBox[] = [];
  for (const box of [...kept, ...seen, ...named]) {
    if (!everything.some((other) => sameness(other, box) >= 0.5)) everything.push(box);
  }
  const keptCount = distinctCount(raw, [...kept, ...named.filter((box) => !kept.some((other) => sameness(other, box) >= 0.5))]);
  // The floor under the seller's count is the photo's only when it clearly
  // shows several things; anything less, the seller is trusted.
  const focus = raw ? focusOf(raw.data, raw.width, raw.height, everything) : null;
  const focused = focus ? inFocus(everything, focus, SHARP_RATIO) : everything;
  const found = clearlySeveral(focused, focus ? inFocus(everything, focus) : everything) ? distinctCount(raw, subjectsOf(focused)) : 0;
  const charged = Math.max(1, keptCount, Math.ceil(found * (1 - FIND_SLACK)));
  return { charged, found, perRow: marked.map((boxes) => Math.max(1, distinctCount(raw, boxes))) };
}

/**
 * What a sale photo holds, for the sell form to offer the right choices
 * first: how many things, how many different ones, and whether it is views
 * of one thing side by side. `boxes` are the places found on the phone and
 * here, put together.
 */
export async function analyseThings(blobName: string, boxes: readonly RegionBox[]): Promise<PhotoAnalysis> {
  const { raw } = await stored(blobName);
  const unique: RegionBox[] = [];
  for (const box of boxes) if (!unique.some((other) => sameness(other, box) >= 0.5)) unique.push(box);
  // The blurred background - a room, a shelf behind - is not what is for sale.
  const focus = raw ? focusOf(raw.data, raw.width, raw.height, unique) : null;
  const places = focus ? inFocus(unique, focus) : unique;
  // Only what is near as sharp as the subject counts towards several things.
  const sharp = focus ? inFocus(unique, focus, SHARP_RATIO) : unique;
  // Unless the photo clearly shows several things, it is one item, as the seller says.
  if (!clearlySeveral(sharp, places)) {
    return { found: Math.min(1, places.length), kinds: Math.min(1, places.length), largest: Math.min(1, places.length), lineup: viewsLineup(places), several: false };
  }
  const subjects = subjectsOf(sharp);
  if (!raw) return { found: subjects.length, kinds: subjects.length, largest: 1, lineup: false, several: true };
  const groups = groupThings(raw, subjects);
  return { found: subjects.length, kinds: groups.length, largest: Math.max(0, ...groups.map((group) => group.length)), lineup: false, several: true };
}
