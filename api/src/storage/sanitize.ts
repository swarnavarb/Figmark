/**
 * Checks that an uploaded picture is the picture it says it is, and keeps only
 * the picture.
 *
 * The declared type is the client's word, and photos are served from a
 * public-read container, so trusting it would let anything be stored and
 * handed out under an image's name. Here the bytes decide: the format is read
 * from the file's own signature, its structure is walked from start to end,
 * and what is kept is rebuilt from the parts a picture needs. Whatever was
 * appended after the end of the image - how a file is made to be an image and
 * something else at once - is dropped, as is metadata: the comments and text
 * chunks that can carry anything, and the EXIF block in which a phone writes
 * where the photo was taken.
 *
 * JPEG is recompressed afterwards (compress.ts); this runs first for every
 * format, so what is stored is always a picture whichever path it took.
 */

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export type Sanitized =
  | { ok: true; bytes: Uint8Array; contentType: ImageType }
  | { ok: false; problem: string };

const NOT_A_PICTURE = 'That file is not a JPEG, PNG, WebP or GIF picture.';
const MISMATCH = 'That file is not the kind of picture it says it is.';
const DAMAGED = 'That picture looks damaged. Try saving it again, or use a different one.';

/** The format the bytes themselves say they are, from the file signature. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const at = (index: number) => bytes[index];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => at(index) === value)) {
    return 'image/png';
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'image/gif';
  return null;
}

/** The picture in `bytes`, rebuilt from its own parts, if it is the `declared` kind. */
export function sanitizeImage(bytes: Uint8Array, declared: string): Sanitized {
  const actual = sniffImageType(bytes);
  if (!actual) return { ok: false, problem: NOT_A_PICTURE };
  if (actual !== declared) return { ok: false, problem: MISMATCH };
  try {
    const clean = actual === 'image/jpeg' ? cleanJpeg(bytes)
      : actual === 'image/png' ? cleanPng(bytes)
        : actual === 'image/webp' ? cleanWebp(bytes)
          : cleanGif(bytes);
    return clean ? { ok: true, bytes: clean, contentType: actual } : { ok: false, problem: DAMAGED };
  } catch {
    return { ok: false, problem: DAMAGED };
  }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/* ── JPEG ─────────────────────────────────────────────────────────────────── */

/** APP markers a decoder needs for the picture to look right: JFIF, the colour profile, Adobe's colour transform. */
const JPEG_KEEP_APP = new Set([0xe0, 0xe2, 0xee]);

/**
 * Segment by segment up to the start of scan; the entropy-coded data up to
 * the end-of-image marker; nothing after it. EXIF, XMP and comments go.
 */
function cleanJpeg(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) { offset += 1; continue; }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (length < 2 || offset + 2 + length > bytes.length) return null;
    const segment = bytes.subarray(offset, offset + 2 + length);
    offset += 2 + length;

    if (marker === 0xda) {
      // Start of scan: compressed data follows, ending at the first EOI that is
      // not a stuffed byte or a restart marker.
      parts.push(segment);
      for (let index = offset; index + 1 < bytes.length; index += 1) {
        if (bytes[index] !== 0xff) continue;
        const next = bytes[index + 1]!;
        if (next === 0xd9) {
          parts.push(bytes.subarray(offset, index + 2));
          return concat(parts);
        }
        // Progressive JPEGs carry several scans; their tables and headers sit
        // between them and are kept as they are.
      }
      return null;
    }
    if ((marker >= 0xe1 && marker <= 0xef && !JPEG_KEEP_APP.has(marker)) || marker === 0xfe) continue;
    parts.push(segment);
  }
  return null;
}

/* ── PNG ──────────────────────────────────────────────────────────────────── */

/**
 * Chunks a PNG needs to be drawn as intended, animated ones included. Text,
 * EXIF and anything private are left out.
 */
const PNG_KEEP = new Set([
  'IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD',
  'acTL', 'fcTL', 'fdAT',
]);

function cleanPng(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  let first = true;
  while (offset + 12 <= bytes.length) {
    const length = ((bytes[offset]! << 24) >>> 0) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!;
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    if (first && type !== 'IHDR') return null;
    first = false;
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') return concat(parts);
  }
  return null;
}

/* ── WebP ─────────────────────────────────────────────────────────────────── */

const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

function cleanWebp(bytes: Uint8Array): Uint8Array | null {
  const riffSize = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | ((bytes[7]! << 24) >>> 0);
  const end = 8 + riffSize;
  if (riffSize < 4 || end > bytes.length) return null;
  const chunks: Uint8Array[] = [];
  let offset = 12;
  let first = true;
  let hasImage = false;
  while (offset + 8 <= end) {
    const type = ascii(bytes, offset, 4);
    const size = bytes[offset + 4]! | (bytes[offset + 5]! << 8) | (bytes[offset + 6]! << 16) | ((bytes[offset + 7]! << 24) >>> 0);
    const chunkEnd = offset + 8 + size + (size % 2);
    if (chunkEnd > end + (size % 2)) return null;
    if (first && !['VP8 ', 'VP8L', 'VP8X'].includes(type)) return null;
    first = false;
    if (type === 'VP8 ' || type === 'VP8L' || type === 'ANMF') hasImage = true;
    if (WEBP_KEEP.has(type)) {
      const chunk = bytes.slice(offset, Math.min(chunkEnd, end));
      // An extended header advertises EXIF and XMP; they are gone, so it stops saying so.
      if (type === 'VP8X') chunk[8] = chunk[8]! & ~0x0c;
      chunks.push(chunk);
    }
    offset = chunkEnd;
  }
  if (!hasImage) return null;
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set([0x52, 0x49, 0x46, 0x46]);
  const size = body.length + 4;
  header.set([size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff], 4);
  header.set([0x57, 0x45, 0x42, 0x50], 8);
  return concat([header, body]);
}

/* ── GIF ──────────────────────────────────────────────────────────────────── */

/** Header to trailer, block by block; comment and plain-text extensions dropped. */
function cleanGif(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 13) return null;
  const flags = bytes[10]!;
  let offset = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 0x07) + 1)) : 0);
  if (offset > bytes.length) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, offset)];
  let images = 0;

  /** Past a run of data sub-blocks; -1 when it runs off the end. */
  const skipSubBlocks = (from: number): number => {
    let at = from;
    while (at < bytes.length) {
      const size = bytes[at]!;
      at += 1;
      if (size === 0) return at;
      at += size;
    }
    return -1;
  };

  while (offset < bytes.length) {
    const introducer = bytes[offset]!;
    if (introducer === 0x3b) {
      parts.push(bytes.subarray(offset, offset + 1));
      return images > 0 ? concat(parts) : null;
    }
    if (introducer === 0x21) {
      const label = bytes[offset + 1];
      const end = skipSubBlocks(offset + 2);
      if (label === undefined || end < 0) return null;
      if (label !== 0xfe && label !== 0x01) parts.push(bytes.subarray(offset, end));
      offset = end;
      continue;
    }
    if (introducer === 0x2c) {
      if (offset + 10 > bytes.length) return null;
      const local = bytes[offset + 9]!;
      const tableEnd = offset + 10 + (local & 0x80 ? 3 * (1 << ((local & 0x07) + 1)) : 0);
      const end = skipSubBlocks(tableEnd + 1);
      if (tableEnd + 1 > bytes.length || end < 0) return null;
      parts.push(bytes.subarray(offset, end));
      images += 1;
      offset = end;
      continue;
    }
    return null;
  }
  return null;
}
