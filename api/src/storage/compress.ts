import { decode, encode } from 'jpeg-js';

/**
 * What every stored photo is brought down to: 70-90 KB.
 *
 * The browser does the heavy lifting before upload (`app/src/imageCompress.ts`),
 * but the API cannot trust that it did - a script or an old client sends
 * whatever it likes - so this is the check that actually holds. It is plain
 * JavaScript on purpose, like the share-card renderer: nothing native, so the
 * Functions host needs no binaries.
 *
 * It can only recompress JPEG. Decoding PNG, WebP and GIF would each need
 * another library, and the browser already turns every picture into a JPEG, so
 * the server's rule for the rest is simple: small enough as sent, or refused.
 */
export const PHOTO_MAX_BYTES = 90 * 1024;
export const PHOTO_MIN_BYTES = 70 * 1024;

/** Quality never goes below this: under it a photo stops being a photo. */
const FLOOR_QUALITY = 35;
const CEILING_QUALITY = 92;
/** How far a photo is shrunk, one step at a time, when quality alone cannot do it. */
const SCALES = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.35, 0.3];

export interface CompressedPhoto {
  bytes: Uint8Array;
  contentType: string;
  /** What was uploaded, and what is being kept; the smaller of the two. */
  originalBytes: number;
  /** True when the recompressed picture was the smaller one and is the one kept. */
  recompressed: boolean;
}

interface Raw {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Average the source pixels under each destination pixel: right for shrinking. */
function shrinkRaw(source: Raw, scale: number): Raw {
  if (scale >= 1) return source;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor((y * source.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * source.height) / height));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor((x * source.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * source.width) / width));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const at = (sy * source.width + sx) * 4;
          r += source.data[at]!; g += source.data[at + 1]!; b += source.data[at + 2]!;
          n += 1;
        }
      }
      const out = (y * width + x) * 4;
      data[out] = r / n; data[out + 1] = g / n; data[out + 2] = b / n; data[out + 3] = 255;
    }
  }
  return { data, width, height };
}

const encodeAt = (raw: Raw, quality: number): Uint8Array =>
  new Uint8Array(encode({ data: raw.data, width: raw.width, height: raw.height }, quality).data);

/**
 * The highest quality that still fits `limit` at this size, or the smallest
 * encoding there is when none does. Highest, not lowest: stopping as soon as it
 * fits is what keeps a photo near 90 KB instead of far under it.
 */
function bestFit(raw: Raw, limit: number): { bytes: Uint8Array; fits: boolean } {
  let low = FLOOR_QUALITY;
  let high = CEILING_QUALITY;
  let best: Uint8Array | null = null;
  let smallest = encodeAt(raw, low);
  if (smallest.byteLength > limit) return { bytes: smallest, fits: false };
  best = smallest;
  // Quality is monotonic enough in size that a binary search finds the edge.
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const tried = encodeAt(raw, mid);
    if (tried.byteLength <= limit) { best = tried; low = mid; } else { high = mid; }
  }
  smallest = best;
  return { bytes: smallest, fits: true };
}

/**
 * Compress a photo and keep whichever is smaller: what was sent, or the
 * recompressed picture.
 *
 * Anything that is not a JPEG, or is one the decoder cannot read, comes back
 * untouched for the caller to size-check.
 */
export function compressPhoto(input: Uint8Array, contentType: string): CompressedPhoto {
  const untouched: CompressedPhoto = {
    bytes: input, contentType, originalBytes: input.byteLength, recompressed: false,
  };
  if (contentType !== 'image/jpeg') return untouched;

  let raw: Raw;
  try {
    const decoded = decode(Buffer.from(input), {
      useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40, maxMemoryUsageInMB: 256,
    });
    raw = { data: decoded.data as unknown as Uint8Array, width: decoded.width, height: decoded.height };
  } catch {
    return untouched;
  }

  let candidate: Uint8Array | null = null;
  if (input.byteLength <= PHOTO_MAX_BYTES) {
    // Already small enough: one gentle pass, kept only if it really is smaller.
    candidate = encodeAt(raw, 75);
  } else {
    for (const scale of SCALES) {
      const { bytes, fits } = bestFit(shrinkRaw(raw, scale), PHOTO_MAX_BYTES);
      if (!candidate || bytes.byteLength < candidate.byteLength) candidate = bytes;
      if (fits) { candidate = bytes; break; }
    }
  }

  if (candidate && candidate.byteLength < input.byteLength) {
    return { bytes: candidate, contentType: 'image/jpeg', originalBytes: input.byteLength, recompressed: true };
  }
  return untouched;
}
