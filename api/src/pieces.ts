import type { RegionBox } from '../../shared/models.js';
import { MAX_PIECES } from '../../shared/pieces.js';
import { detectItems, likeness, overlapOfBoxes, regionFingerprint } from './image-hash.js';
import { decodeJpeg, type Raw } from './storage/compress.js';
import { getPhotoStore } from './storage/index.js';
import { describePieces, visionAvailable } from './vision.js';

/**
 * The things for sale in a sale photo, each once.
 *
 * What the seller is shown when a photo looks like more than one thing -
 * "sell these separately, or all together?" - and what Figmark counts the
 * things in a lot by, for its fee. Two readers, as with photo search:
 *
 * - Claude, when vision is on, names each thing and says every place it
 *   appears, so a front and a back view of one figure come back as one.
 * - The backdrop, always: whatever stands off a plain backdrop is a thing,
 *   and two things that look the same by their fingerprints are taken to be
 *   one thing shown twice.
 *
 * Either may miss things - a cluttered shelf has no plain backdrop - which is
 * why the seller marks what was missed, and why the count only ever raises
 * the fee: what the seller says is never lowered by it.
 */
export interface FoundPiece {
  /** What Claude called it; null when only the backdrop found it. */
  label: string | null;
  /** Each place it appears, largest first. More than one when it is shown more than once. */
  boxes: RegionBox[];
}

export interface PieceReading {
  pieces: FoundPiece[];
  /** Which readers took part. */
  method: 'vision' | 'shape' | 'both' | 'none';
}

/** Two boxes this much the same are one thing found by both readers. */
const SAME_PLACE = 0.45;

/** Group boxes whose pictures say they are the same thing, so each is counted once. */
function groupAlike(raw: Raw, boxes: RegionBox[]): RegionBox[][] {
  const prints = boxes.map((box) => regionFingerprint(raw, box));
  const groups: { boxes: RegionBox[]; prints: (string | null)[] }[] = [];
  for (const [index, box] of boxes.entries()) {
    const print = prints[index] ?? null;
    const home = print
      ? groups.find((group) => group.prints.some((other) => other && likeness(print, other)?.sameItem))
      : undefined;
    if (home) {
      home.boxes.push(box);
      home.prints.push(print);
    } else {
      groups.push({ boxes: [box], prints: [print] });
    }
  }
  return groups.map((group) => group.boxes);
}

/** Read as a person reads a shelf: top row first, left to right. */
function readingOrder(a: FoundPiece, b: FoundPiece): number {
  const [ax, ay, , ah] = a.boxes[0]!;
  const [bx, by, , bh] = b.boxes[0]!;
  const row = Math.min(ah, bh) / 2;
  const acy = ay + ah / 2; const bcy = by + bh / 2;
  if (Math.abs(acy - bcy) > row) return acy - bcy;
  return ax - bx;
}

/** The things in one photo's bytes. */
export async function readPieces(bytes: Uint8Array, contentType: string): Promise<PieceReading> {
  let raw: Raw | null = null;
  try {
    raw = contentType === 'image/jpeg' || contentType === 'image/jpg' ? decodeJpeg(bytes) : null;
  } catch {
    raw = null;
  }
  const read = visionAvailable() ? await describePieces(bytes, contentType) : null;
  const pieces: FoundPiece[] = (read ?? []).map((piece) => ({ label: piece.name || null, boxes: piece.boxes }));
  const shapes = raw ? detectItems(raw, MAX_PIECES) : [];
  // What stands off the backdrop that Claude did not already name.
  const fresh = shapes.filter((box) => !pieces.some((piece) => piece.boxes.some((known) => overlapOfBoxes(known, box) >= SAME_PLACE)));
  if (raw && fresh.length > 0) {
    for (const group of groupAlike(raw, fresh)) pieces.push({ label: null, boxes: group });
  }
  pieces.sort(readingOrder);
  const method = read !== null && read.length > 0 ? (fresh.length > 0 ? 'both' : 'vision') : fresh.length > 0 ? 'shape' : 'none';
  return { pieces: pieces.slice(0, MAX_PIECES), method };
}

/** Readings already made, by photo: a stored photo never changes, and the seller's publish reads it again. */
const readings = new Map<string, Promise<PieceReading>>();
const READINGS_MAX = 200;

/** The things in one of our stored photos; none when it cannot be read. */
export function readStoredPieces(blobName: string): Promise<PieceReading> {
  const known = readings.get(blobName);
  if (known) return known;
  const work = (async () => {
    const store = await getPhotoStore();
    const found = await store.read(blobName).catch(() => null);
    if (!found) return { pieces: [], method: 'none' } as PieceReading;
    return readPieces(found.bytes, found.contentType);
  })();
  if (readings.size >= READINGS_MAX) readings.delete(readings.keys().next().value!);
  readings.set(blobName, work);
  work.catch(() => readings.delete(blobName));
  return work;
}

/**
 * How many separate things a lot's photos show, each counted once - across
 * photos as well, so a close-up of one figure in the second photo does not
 * count it twice. Zero when nothing could be told apart: the seller's count
 * stands alone then.
 */
export async function countLotItems(blobNames: readonly string[]): Promise<number> {
  const store = await getPhotoStore();
  const seen: string[] = [];
  let count = 0;
  for (const name of blobNames.slice(0, 6)) {
    const found = await store.read(name).catch(() => null);
    if (!found) continue;
    let raw: Raw | null = null;
    try {
      raw = decodeJpeg(found.bytes);
    } catch {
      continue;
    }
    const reading = await readStoredPieces(name);
    for (const piece of reading.pieces) {
      const print = regionFingerprint(raw, piece.boxes[0]!);
      if (print && seen.some((other) => likeness(print, other)?.sameItem)) continue;
      if (print) seen.push(print);
      count += 1;
    }
  }
  return count;
}
