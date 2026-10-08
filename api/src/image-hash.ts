import { decode } from 'jpeg-js';
import { getPhotoStore } from './storage/index.js';

/**
 * What a photo looks like, in 80 hex characters: the reverse-image search key.
 *
 * Two parts, because they answer different questions:
 *
 * - a difference hash (dHash) of the picture's shape - 64 bits, one per pair of
 *   neighbouring cells on a 9x8 grey thumbnail. It survives recompression,
 *   resizing and a screenshot of a screenshot, which is what a reseller's
 *   picture goes through between a supplier page, a channel and here. A few
 *   bits apart is the same photo.
 * - a coarse colour histogram, 4 levels per channel, each bin scaled to one hex
 *   digit. It knows nothing about shape, so it never decides a match alone;
 *   it is what makes "the red one" rank above "the blue one" among look-alikes.
 *
 * Plain JavaScript like the compressor, and for the same reason: nothing
 * native for the Functions host to carry. It only reads JPEG, which is what
 * the browser turns every upload into.
 */
export const HASH_VERSION = 'v1';

interface Raw {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Average the source pixels under each destination cell, as grey. */
function greyGrid(raw: Raw, width: number, height: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * raw.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * raw.height) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * raw.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * raw.width) / width));
      let sum = 0; let n = 0;
      // Every pixel of a 4000px photo is more than a 9x8 grid needs.
      const stepY = Math.max(1, Math.floor((y1 - y0) / 16));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 16));
      for (let sy = y0; sy < y1; sy += stepY) {
        for (let sx = x0; sx < x1; sx += stepX) {
          const at = (sy * raw.width + sx) * 4;
          sum += 0.299 * raw.data[at]! + 0.587 * raw.data[at + 1]! + 0.114 * raw.data[at + 2]!;
          n += 1;
        }
      }
      out.push(sum / n);
    }
  }
  return out;
}

function dHash(raw: Raw): string {
  const grid = greyGrid(raw, 9, 8);
  let hex = '';
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) {
      byte = (byte << 1) | (grid[row * 9 + col]! > grid[row * 9 + col + 1]! ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function colourHistogram(raw: Raw): string {
  const bins = new Array<number>(64).fill(0);
  const pixels = raw.width * raw.height;
  // A sample of a few thousand pixels says as much about colour as all of them.
  const step = Math.max(1, Math.floor(pixels / 4096));
  let counted = 0;
  for (let index = 0; index < pixels; index += step) {
    const at = index * 4;
    const bin = ((raw.data[at]! >> 6) << 4) | ((raw.data[at + 1]! >> 6) << 2) | (raw.data[at + 2]! >> 6);
    bins[bin]! += 1;
    counted += 1;
  }
  // Scaled against the fullest bin rather than the total, so one hex digit per
  // bin keeps the shape of the histogram instead of rounding most of it to 0.
  const top = Math.max(1, ...bins);
  return bins.map((count) => Math.round((count / top) * 15).toString(16)).join('');
}

/** The fingerprint of a JPEG, or null for anything this cannot decode. */
export function fingerprint(bytes: Uint8Array, contentType: string): string | null {
  if (contentType !== 'image/jpeg') return null;
  try {
    const decoded = decode(Buffer.from(bytes), {
      useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256,
    });
    const raw = { data: decoded.data as unknown as Uint8Array, width: decoded.width, height: decoded.height };
    if (raw.width < 2 || raw.height < 2) return null;
    return `${HASH_VERSION}:${dHash(raw)}:${colourHistogram(raw)}`;
  } catch {
    return null;
  }
}

function parse(hash: string): { shape: bigint; colour: number[] } | null {
  const [version, shape, colour] = hash.split(':');
  if (version !== HASH_VERSION || !shape || !colour || shape.length !== 16 || colour.length !== 64) return null;
  return { shape: BigInt(`0x${shape}`), colour: [...colour].map((digit) => parseInt(digit, 16)) };
}

function bitsApart(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let count = 0;
  while (diff) { count += Number(diff & 1n); diff >>= 1n; }
  return count;
}

/** Bits apart at or under which two shapes are the same picture. */
export const SAME_PHOTO_BITS = 10;

export interface Likeness {
  /** The same picture, recompressed, resized or screenshotted. */
  samePhoto: boolean;
  /** 0 to 1: how alike they look, shape and colour together. */
  score: number;
}

/** How alike two fingerprints are; null when either is unreadable. */
export function likeness(a: string, b: string): Likeness | null {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  const bits = bitsApart(left.shape, right.shape);
  // Unrelated photos sit around 32 bits apart; anything past that is noise.
  const shape = Math.max(0, 1 - bits / 32);
  let shared = 0; let total = 0;
  for (let index = 0; index < 64; index += 1) {
    shared += Math.min(left.colour[index]!, right.colour[index]!);
    total += Math.max(left.colour[index]!, right.colour[index]!);
  }
  const colour = total ? shared / total : 0;
  return { samePhoto: bits <= SAME_PHOTO_BITS, score: 0.65 * shape + 0.35 * colour };
}

/**
 * Fingerprints of stored photos, by blob name.
 *
 * Blob names are uuids and the bytes behind one never change, so an entry is
 * never stale - it is only dropped to bound memory. Kept per host instance;
 * a cold instance pays for each photo once.
 */
const known = new Map<string, string | null>();
const KNOWN_MAX = 20_000;

/** The fingerprint of one of our stored photos, read and computed on first ask. */
export async function storedFingerprint(blobName: string): Promise<string | null> {
  if (known.has(blobName)) return known.get(blobName) ?? null;
  const store = await getPhotoStore();
  const found = await store.read(blobName);
  const hash = found ? fingerprint(found.bytes, found.contentType) : null;
  // A photo that could not be read may be there next time; one that could not
  // be decoded never will be.
  if (found) {
    if (known.size >= KNOWN_MAX) known.delete(known.keys().next().value!);
    known.set(blobName, hash);
  }
  return hash;
}

/** Whether this blob's fingerprint is already to hand, so costs nothing to ask. */
export function isFingerprinted(blobName: string): boolean {
  return known.has(blobName);
}
