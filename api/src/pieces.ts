import type { RegionBox } from '../../shared/models.js';
import { MAX_PIECES } from '../../shared/pieces.js';
import { sameness } from '../../shared/photo-things.js';
import { distinctCount, thingsInPhoto } from './photo-things.js';
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
  const found = distinctCount(raw, everything);
  const charged = Math.max(1, keptCount, Math.ceil(found * (1 - FIND_SLACK)));
  return { charged, found, perRow: marked.map((boxes) => Math.max(1, distinctCount(raw, boxes))) };
}
