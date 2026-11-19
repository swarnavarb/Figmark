import type { PhotoRegion, RegionBox } from '../../shared/models.js';
import { decodeJpeg, shrinkRaw, type Raw } from './storage/compress.js';
import { getPhotoStore } from './storage/index.js';

/**
 * What a photo looks like, as text: the reverse-image search key.
 *
 * Several parts, because they answer different questions:
 *
 * - a difference hash (dHash) of the picture's shape - 64 bits, one per pair of
 *   neighbouring cells on a 9x8 grey thumbnail. It survives recompression,
 *   resizing and a screenshot of a screenshot, which is what a reseller's
 *   picture goes through between a supplier page, a channel and here. A few
 *   bits apart is the same photo. Its mirror image is kept beside it, so a
 *   flipped repost is still the same photo.
 * - a coarse colour histogram, 4 levels per channel, each bin scaled to one hex
 *   digit. It knows nothing about shape, so it never decides a match alone;
 *   it is what makes "the red one" rank above "the blue one" among look-alikes.
 * - the look: the colours of the thing itself, with the backdrop taken out,
 *   by hue. Two different photos of the same figure - one on a white sweep,
 *   one on a shelf - share little shape, but the same blue, black and skin
 *   tones.
 * - the subject: the dHash of the thing itself, cut out of the picture by
 *   where the backdrop ends, and its mirror. The same item shot closer, further
 *   away, off to one side, or facing the other way crops to much the same
 *   picture, where the whole frame does not.
 * - the silhouette: which cells of an 8x8 grid over the subject are the thing
 *   rather than the backdrop. Light and shadow do not move it, and mirrored it
 *   is exact, so it tells a boot from a ball where the grey shape cannot.
 * - the edges: which way the subject's outlines run, as a histogram of 12
 *   directions. Colour and lighting do not move it, and it is compared with a
 *   little turn either way. A search photo is also fingerprinted turned a
 *   little each way (`tiltedFingerprints`), so a camera held at a slant still
 *   finds a listing shot level.
 *
 * A photo of several things - a lot, a bundle, a shelf - is told apart into
 * its items too (`detectItems`), each with a fingerprint of its own, so a
 * shopper can search with any one of them and a listing photo of several finds
 * a photo of one.
 *
 * Plain JavaScript like the compressor, and for the same reason: nothing
 * native for the Functions host to carry. It only reads JPEG, which is what
 * the browser turns every upload into.
 */
export const HASH_VERSION = 'v2';

/** Every fingerprint is worked out at this size at most: a 9x8 grid needs no more. */
const WORK_EDGE = 512;
/** Items told apart in one photo, at most. */
export const MAX_REGIONS = 6;

/** The picture at a size worth fingerprinting. */
function workingCopy(raw: Raw): Raw {
  const edge = Math.max(raw.width, raw.height);
  return edge > WORK_EDGE ? shrinkRaw(raw, WORK_EDGE / edge) : raw;
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

/** The dHash, and the dHash of the same picture mirrored left to right. */
function dHashes(raw: Raw): [string, string] {
  const grid = greyGrid(raw, 9, 8);
  let hex = '';
  let mirror = '';
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    let flipped = 0;
    for (let col = 0; col < 8; col += 1) {
      byte = (byte << 1) | (grid[row * 9 + col]! > grid[row * 9 + col + 1]! ? 1 : 0);
      // The mirrored row read left to right is this row read right to left.
      flipped = (flipped << 1) | (grid[row * 9 + 8 - col]! > grid[row * 9 + 7 - col]! ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, '0');
    mirror += flipped.toString(16).padStart(2, '0');
  }
  return [hex, mirror];
}

/** Bins scaled against the fullest, one hex digit each. */
function hexBins(bins: number[]): string {
  const top = Math.max(1e-9, ...bins);
  return bins.map((count) => Math.round((count / top) * 15).toString(16)).join('');
}

function colourHistogram(raw: Raw): string {
  const bins = new Array<number>(64).fill(0);
  const pixels = raw.width * raw.height;
  // A sample of a few thousand pixels says as much about colour as all of them.
  const step = Math.max(1, Math.floor(pixels / 4096));
  for (let index = 0; index < pixels; index += step) {
    const at = index * 4;
    const bin = ((raw.data[at]! >> 6) << 4) | ((raw.data[at + 1]! >> 6) << 2) | (raw.data[at + 2]! >> 6);
    bins[bin]! += 1;
  }
  // Scaled against the fullest bin rather than the total, so one hex digit per
  // bin keeps the shape of the histogram instead of rounding most of it to 0.
  return hexBins(bins);
}

/** Bins of the look: 12 hues at two strengths, then black, dark, light and white greys. */
const LOOK_BINS = 28;

function lookBin(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const value = max / 255;
  const saturation = max ? (max - min) / max : 0;
  if (value < 0.2) return 24;
  if (saturation < 0.2) return value < 0.45 ? 25 : value < 0.75 ? 26 : 27;
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  return Math.min(11, Math.floor(hue * 2)) * 2 + (saturation < 0.55 ? 0 : 1);
}

type Colour = [number, number, number];

/** How far a colour may be from the backdrop and still be backdrop. */
const BACKDROP_REACH = 60;

/**
 * The backdrop: whatever colours the edge carries much of. A plain sweep is
 * one, a shelf or a gradient a few. Empty when the edge is too busy to say.
 */
function backdropOf(raw: Raw): Colour[] {
  const at = (x: number, y: number) => (y * raw.width + x) * 4;
  const edge: number[] = [];
  const stepX = Math.max(1, Math.floor(raw.width / 64));
  const stepY = Math.max(1, Math.floor(raw.height / 64));
  // A little in from the edge, past any frame or letterbox line.
  const inX = Math.floor(raw.width * 0.03);
  const inY = Math.floor(raw.height * 0.03);
  for (let x = inX; x < raw.width - inX; x += stepX) edge.push(at(x, inY), at(x, raw.height - 1 - inY));
  for (let y = inY; y < raw.height - inY; y += stepY) edge.push(at(inX, y), at(raw.width - 1 - inX, y));
  const coarse = new Map<number, number[]>();
  for (const i of edge) {
    const key = ((raw.data[i]! >> 5) << 6) | ((raw.data[i + 1]! >> 5) << 3) | (raw.data[i + 2]! >> 5);
    const list = coarse.get(key) ?? [];
    list.push(i);
    coarse.set(key, list);
  }
  const backdrop: Colour[] = [];
  for (const group of coarse.values()) {
    if (group.length < edge.length * 0.08) continue;
    let r = 0; let g = 0; let b = 0;
    for (const i of group) { r += raw.data[i]!; g += raw.data[i + 1]!; b += raw.data[i + 2]!; }
    backdrop.push([r / group.length, g / group.length, b / group.length]);
  }
  return backdrop;
}

const isBackdrop = (backdrop: Colour[], r: number, g: number, b: number) =>
  backdrop.some(([br, bg, bb]) => Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < BACKDROP_REACH);

/** The colours of the subject: every pixel close to the backdrop is left out. */
function look(raw: Raw): string {
  const backdrop = backdropOf(raw);
  const bins = new Array<number>(LOOK_BINS).fill(0);
  const pixels = raw.width * raw.height;
  const step = Math.max(1, Math.floor(pixels / 8192));
  for (let index = 0; index < pixels; index += step) {
    const i = index * 4;
    const r = raw.data[i]!; const g = raw.data[i + 1]!; const b = raw.data[i + 2]!;
    if (isBackdrop(backdrop, r, g, b)) continue;
    bins[lookBin(r, g, b)]! += 1;
  }
  return hexBins(bins);
}

/** Directions an outline can run, over half a turn. */
const EDGE_BINS = 12;

/**
 * Which way the outlines run, weighted by how strong they are. Grey only, so
 * neither the colour of the light nor of the thing moves it.
 */
function edgeHistogram(raw: Raw): string {
  const size = 48;
  const grid = greyGrid(raw, size, size);
  const bins = new Array<number>(EDGE_BINS).fill(0);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const gx = grid[y * size + x + 1]! - grid[y * size + x - 1]!;
      const gy = grid[(y + 1) * size + x]! - grid[(y - 1) * size + x]!;
      const strength = Math.hypot(gx, gy);
      // Sensor noise and JPEG blocks, not outlines.
      if (strength < 12) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      // Bins centred on the axes, so a level shelf or an upright box edge falls in one bin, not two.
      bins[Math.round((angle / Math.PI) * EDGE_BINS) % EDGE_BINS]! += strength;
    }
  }
  return hexBins(bins);
}

/* ── Telling the items in a photo apart ─────────────────────────────────── */

/** Cells across the longer side of the grid items are found on. */
const SEGMENT_CELLS = 48;

interface Segmented {
  /** Around everything that is not backdrop; null when the backdrop could not be told. */
  subject: RegionBox | null;
  /** Each separate thing, largest first; one or none when the photo shows one thing. */
  items: RegionBox[];
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function clampBox([x, y, w, h]: RegionBox): RegionBox {
  const left = Math.max(0, Math.min(1, x));
  const top = Math.max(0, Math.min(1, y));
  return [round3(left), round3(top), round3(Math.max(0, Math.min(1 - left, w))), round3(Math.max(0, Math.min(1 - top, h)))];
}

const area = (box: RegionBox) => box[2] * box[3];

function intersection(a: RegionBox, b: RegionBox): number {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/** How much two boxes overlap, as a share of the smaller. */
export function overlapOfBoxes(a: RegionBox, b: RegionBox): number {
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 ? intersection(a, b) / smaller : 0;
}

function union(a: RegionBox, b: RegionBox): RegionBox {
  const left = Math.min(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  return [left, top, Math.max(a[0] + a[2], b[0] + b[2]) - left, Math.max(a[1] + a[3], b[1] + b[3]) - top];
}

/**
 * Where the things in the photo are: everything far from the backdrop's
 * colours, closed over small gaps so a figure's dark joints do not cut it in
 * two, then split into the separate shapes that are left.
 */
function segment(raw: Raw): Segmented {
  const scale = SEGMENT_CELLS / Math.max(raw.width, raw.height);
  const small = shrinkRaw(raw, Math.min(1, scale));
  const { width, height } = small;
  const backdrop = backdropOf(small);
  if (backdrop.length === 0 || width < 4 || height < 4) return { subject: null, items: [] };

  let mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    const at = i * 4;
    mask[i] = isBackdrop(backdrop, small.data[at]!, small.data[at + 1]!, small.data[at + 2]!) ? 0 : 1;
  }
  const morph = (source: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(source.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let any = false; let all = true;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx; const ny = y + dy;
            const on = nx >= 0 && ny >= 0 && nx < width && ny < height ? source[ny * width + nx] === 1 : false;
            any ||= on; all &&= on;
          }
        }
        out[y * width + x] = (grow ? any : all) ? 1 : 0;
      }
    }
    return out;
  };
  mask = morph(morph(mask, true), false);

  // The separate shapes, by flood fill.
  const label = new Int32Array(width * height).fill(-1);
  const boxes: { box: RegionBox; cells: number }[] = [];
  const minCells = Math.max(4, width * height * 0.008);
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || label[start]! >= 0) continue;
    const queue = [start];
    label[start] = boxes.length;
    let x0 = width; let y0 = height; let x1 = 0; let y1 = 0; let cells = 0;
    while (queue.length > 0) {
      const cell = queue.pop()!;
      const cx = cell % width; const cy = Math.floor(cell / width);
      cells += 1;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx; const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && label[next]! < 0) { label[next] = boxes.length; queue.push(next); }
        }
      }
    }
    // A cell of margin each way, so the crop holds the whole outline.
    if (cells >= minCells) {
      boxes.push({ box: clampBox([(x0 - 1) / width, (y0 - 1) / height, (x1 - x0 + 3) / width, (y1 - y0 + 3) / height]), cells });
    }
  }
  if (boxes.length === 0) return { subject: null, items: [] };

  // Shapes that mostly sit inside one another are one thing: a box and the figure printed on it.
  let merged = boxes.map((entry) => entry.box);
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < merged.length; i += 1) {
      for (let j = i + 1; j < merged.length; j += 1) {
        if (overlapOfBoxes(merged[i]!, merged[j]!) >= 0.4) {
          merged[i] = clampBox(union(merged[i]!, merged[j]!));
          merged.splice(j, 1);
          again = true;
          break outer;
        }
      }
    }
  }
  const subject = clampBox(merged.reduce(union));
  // Nothing stands out from a backdrop that is barely there: the photo is all subject.
  if (area(subject) > 0.95) return { subject: null, items: [] };
  merged.sort((a, b) => area(b) - area(a));
  const largest = area(merged[0]!);
  // A speck beside the main thing - a logo, a price sticker - is not an item.
  merged = merged.filter((box) => area(box) >= largest * 0.08).slice(0, MAX_REGIONS);
  return { subject, items: merged.length >= 2 ? merged : [] };
}

/** The separate items in a photo, largest first; empty when it shows one thing, or nothing can be told apart. */
export function detectItems(raw: Raw): RegionBox[] {
  return segment(workingCopy(raw)).items;
}

/** The pixels inside a box. */
export function cropPixels(raw: Raw, box: RegionBox): Raw {
  const x0 = Math.max(0, Math.min(raw.width - 1, Math.floor(box[0] * raw.width)));
  const y0 = Math.max(0, Math.min(raw.height - 1, Math.floor(box[1] * raw.height)));
  const width = Math.max(1, Math.min(raw.width - x0, Math.round(box[2] * raw.width)));
  const height = Math.max(1, Math.min(raw.height - y0, Math.round(box[3] * raw.height)));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((y0 + y) * raw.width + x0) * 4;
    data.set(raw.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { data, width, height };
}

/** A box the caller sent, made safe; null when it is not one. */
export function readBox(value: unknown): RegionBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  if (!value.every((part) => typeof part === 'number' && Number.isFinite(part))) return null;
  const box = clampBox(value as RegionBox);
  // Smaller than this is a tap, not an item.
  return box[2] >= 0.03 && box[3] >= 0.03 ? box : null;
}

/* ── Fingerprints ───────────────────────────────────────────────────────── */

/**
 * Which cells of an 8x8 grid over the subject are mostly the thing, as 64 bits.
 * With no backdrop to tell it from, the brighter-than-average cells stand in.
 */
function silhouette(thing: Raw, backdrop: Colour[]): string {
  const cells: number[] = [];
  if (backdrop.length > 0) {
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const x0 = Math.floor((col * thing.width) / 8);
        const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * thing.width) / 8));
        const y0 = Math.floor((row * thing.height) / 8);
        const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * thing.height) / 8));
        const stepX = Math.max(1, Math.floor((x1 - x0) / 8));
        const stepY = Math.max(1, Math.floor((y1 - y0) / 8));
        let on = 0; let n = 0;
        for (let y = y0; y < y1; y += stepY) {
          for (let x = x0; x < x1; x += stepX) {
            const at = (y * thing.width + x) * 4;
            if (!isBackdrop(backdrop, thing.data[at]!, thing.data[at + 1]!, thing.data[at + 2]!)) on += 1;
            n += 1;
          }
        }
        cells.push(on / n);
      }
    }
  } else {
    const grey = greyGrid(thing, 8, 8);
    const mean = grey.reduce((sum, value) => sum + value, 0) / 64;
    for (const value of grey) cells.push(value > mean ? 1 : 0);
  }
  let hex = '';
  for (let row = 0; row < 8; row += 1) {
    let byte = 0;
    for (let col = 0; col < 8; col += 1) byte = (byte << 1) | (cells[row * 8 + col]! >= 0.5 ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * The box drawn tight around what is not backdrop inside a rough one: the
 * coarse grid items are found on leaves a margin, and the same thing should
 * crop the same however large it was in its photo.
 */
function tighten(raw: Raw, box: RegionBox, backdrop: Colour[]): RegionBox {
  if (backdrop.length === 0) return box;
  const x0 = Math.floor(box[0] * raw.width);
  const y0 = Math.floor(box[1] * raw.height);
  const x1 = Math.min(raw.width, Math.ceil((box[0] + box[2]) * raw.width));
  const y1 = Math.min(raw.height, Math.ceil((box[1] + box[3]) * raw.height));
  const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 160));
  let left = x1; let top = y1; let right = x0; let bottom = y0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const at = (y * raw.width + x) * 4;
      if (isBackdrop(backdrop, raw.data[at]!, raw.data[at + 1]!, raw.data[at + 2]!)) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right - left < 4 || bottom - top < 4) return box;
  return [left / raw.width, top / raw.height, (right - left + step) / raw.width, (bottom - top + step) / raw.height];
}

/**
 * The picture turned by `angle` (radians) about its centre, on a canvas grown
 * to hold all of it; the corners it uncovers are filled with the backdrop.
 */
function turnPixels(raw: Raw, angle: number, fill: Colour): Raw {
  const cos = Math.cos(angle); const sin = Math.sin(angle);
  const width = Math.ceil(Math.abs(raw.width * cos) + Math.abs(raw.height * sin));
  const height = Math.ceil(Math.abs(raw.width * sin) + Math.abs(raw.height * cos));
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Each pixel of the turned picture, from where it was before the turn.
      const dx = x - width / 2; const dy = y - height / 2;
      const ox = Math.round(cos * dx + sin * dy + raw.width / 2);
      const oy = Math.round(-sin * dx + cos * dy + raw.height / 2);
      const out = (y * width + x) * 4;
      if (ox >= 0 && oy >= 0 && ox < raw.width && oy < raw.height) {
        const at = (oy * raw.width + ox) * 4;
        data[out] = raw.data[at]!; data[out + 1] = raw.data[at + 1]!; data[out + 2] = raw.data[at + 2]!;
      } else {
        [data[out], data[out + 1], data[out + 2]] = fill;
      }
      data[out + 3] = 255;
    }
  }
  return { data, width, height };
}

/** The slants a search photo is also tried at, in degrees: a camera is rarely held quite level. */
const TILTS = [-22.5, -15, -7.5, 7.5, 15, 22.5];

/**
 * Fingerprints of a search photo as if the camera had been held at a slant,
 * each way. Searching with these as well finds the thing in a listing photo
 * taken level, or the other way round. Worked out for the photo searched with
 * only - never stored - so the catalogue's fingerprints stay one per photo.
 */
export function tiltedFingerprints(raw: Raw): string[] {
  if (raw.width < 2 || raw.height < 2) return [];
  const work = workingCopy(raw);
  const fill = backdropOf(work)[0] ?? [255, 255, 255];
  return TILTS.flatMap((degrees) => hashWorking(turnPixels(work, (degrees * Math.PI) / 180, fill)) ?? []);
}

/** The fingerprint of pixels already at working size. */
function hashWorking(raw: Raw): string | null {
  if (raw.width < 2 || raw.height < 2) return null;
  const [shape, mirror] = dHashes(raw);
  const backdrop = backdropOf(raw);
  const { subject } = segment(raw);
  const thing = subject ? cropPixels(raw, tighten(raw, subject, backdrop)) : raw;
  const [subjectShape, subjectMirror] = dHashes(thing);
  return [
    HASH_VERSION, shape, colourHistogram(raw), look(raw), mirror, subjectShape, subjectMirror,
    edgeHistogram(thing), silhouette(thing, backdrop),
  ].join(':');
}

/** The fingerprint of a JPEG, or null for anything this cannot decode. */
export function fingerprint(bytes: Uint8Array, contentType: string): string | null {
  if (contentType !== 'image/jpeg') return null;
  try {
    return fingerprintPixels(decodeJpeg(bytes));
  } catch {
    return null;
  }
}

/** The fingerprint of pixels already decoded - an upload's, say - with no second decode. */
export function fingerprintPixels(raw: Raw): string | null {
  if (raw.width < 2 || raw.height < 2) return null;
  return hashWorking(workingCopy(raw));
}

/** A photo's fingerprint, and one for each item in it when it shows several. */
export interface Prints {
  hash: string;
  regions: PhotoRegion[];
}

/**
 * The whole picture's fingerprint and each item's. `boxes` names the items
 * when something else already found them (Claude, or the shopper); otherwise
 * they are found here.
 */
export function printsOfPixels(raw: Raw, boxes?: RegionBox[]): Prints | null {
  if (raw.width < 2 || raw.height < 2) return null;
  const work = workingCopy(raw);
  const hash = hashWorking(work);
  if (!hash) return null;
  const regions: PhotoRegion[] = [];
  for (const box of (boxes ?? segment(work).items).slice(0, MAX_REGIONS)) {
    const imageHash = hashWorking(cropPixels(work, box));
    if (imageHash) regions.push({ box, imageHash });
  }
  return { hash, regions };
}

/** `printsOfPixels` for a JPEG's bytes; null for anything this cannot decode. */
export function printsOf(bytes: Uint8Array, contentType: string): Prints | null {
  if (contentType !== 'image/jpeg') return null;
  try {
    return printsOfPixels(decodeJpeg(bytes));
  } catch {
    return null;
  }
}

/** Remember a just-stored photo's fingerprints, worked out from the pixels the upload decoded anyway. */
export function rememberFingerprint(blobName: string, pixels: Raw | undefined): void {
  if (pixels && !known.has(blobName)) remember(blobName, printsOfPixels(pixels));
}

interface Bits { high: number; low: number }

interface Parsed {
  version: string;
  shape: Bits;
  colour: number[];
  look: number[] | null;
  /** Present on v2 and later. */
  mirror: Bits | null;
  subject: Bits | null;
  subjectMirror: Bits | null;
  edges: number[] | null;
  silhouette: Bits | null;
  silhouetteMirror: Bits | null;
}

/**
 * Parsed hashes, by text. A search compares one hash with every photo in the
 * catalogue, and the catalogue's hashes are the same from one search to the
 * next, so each is parsed once per instance rather than once per comparison.
 */
const parsed = new Map<string, Parsed | null>();
const PARSED_MAX = 40_000;

const SHAPE = /^[0-9a-f]{16}$/i;
// The 64-bit shape as two 32-bit halves: counting bits apart on numbers is far cheaper than on a bigint.
const bitsOf = (text: string): Bits => ({ high: parseInt(text.slice(0, 8), 16), low: parseInt(text.slice(8), 16) });
const digits = (text: string) => [...text].map((digit) => parseInt(digit, 16));

/** Eight rows of eight bits, each read the other way: the same grid mirrored. */
function mirrorRows(hex: string): string {
  let out = '';
  for (let row = 0; row < 8; row += 1) {
    const byte = parseInt(hex.slice(row * 2, row * 2 + 2), 16);
    let flipped = 0;
    for (let bit = 0; bit < 8; bit += 1) flipped = (flipped << 1) | ((byte >> bit) & 1);
    out += flipped.toString(16).padStart(2, '0');
  }
  return out;
}

function parse(hash: string): Parsed | null {
  const kept = parsed.get(hash);
  if (kept !== undefined) return kept;
  const [version, shape, colour, lookPart, mirror, subject, subjectMirror, edges, outline] = hash.split(':');
  let value: Parsed | null = null;
  if ((version === 'v1' || version === 'v2') && shape && SHAPE.test(shape) && colour?.length === 64) {
    const v2 = version === 'v2' && SHAPE.test(mirror ?? '') && SHAPE.test(subject ?? '') && SHAPE.test(subjectMirror ?? '')
      && edges?.length === EDGE_BINS && SHAPE.test(outline ?? '');
    value = {
      version: v2 ? 'v2' : 'v1',
      shape: bitsOf(shape),
      colour: digits(colour),
      look: lookPart && lookPart.length === LOOK_BINS ? digits(lookPart) : null,
      mirror: v2 ? bitsOf(mirror!) : null,
      subject: v2 ? bitsOf(subject!) : null,
      subjectMirror: v2 ? bitsOf(subjectMirror!) : null,
      edges: v2 ? digits(edges!) : null,
      silhouette: v2 ? bitsOf(outline!) : null,
      silhouetteMirror: v2 ? bitsOf(mirrorRows(outline!)) : null,
    };
  }
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value!);
  parsed.set(hash, value);
  return value;
}

/** Whether a stored hash is the current kind, or is worth working out again from the photo. */
export function isCurrent(hash: string): boolean {
  return parse(hash)?.version === HASH_VERSION;
}

/** Whether a stored hash carries the look, or predates it. */
export function hasLook(hash: string): boolean {
  return parse(hash)?.look != null;
}

/** Weighted overlap of two histograms, 0 to 1. */
function overlap(a: number[], b: number[], weight: (index: number) => number = () => 1): number {
  let shared = 0; let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    shared += weight(index) * Math.min(a[index]!, b[index]!);
    total += weight(index) * Math.max(a[index]!, b[index]!);
  }
  return total ? shared / total : 0;
}

/** Black, grey and white are in most photos - text, shadow, packaging - so they say little. */
const lookWeight = (index: number) => (index >= 24 ? 0.25 : 1);

/**
 * How alike two edge histograms are, allowing the camera a slant of up to a
 * bin either way (15 degrees), and the item facing the other way.
 */
function edgeLikeness(a: number[], b: number[]): number {
  let best = 0;
  for (const mirrored of [false, true]) {
    const turned = mirrored ? b.map((_, index) => b[EDGE_BINS - 1 - index]!) : b;
    for (const shift of [-1, 0, 1]) {
      const moved = turned.map((_, index) => turned[(index + shift + EDGE_BINS) % EDGE_BINS]!);
      best = Math.max(best, overlap(a, moved));
    }
  }
  return best;
}

/** Set bits in a 32-bit number. */
function bitCount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function bitsApart(a: Bits, b: Bits): number {
  return bitCount((a.high ^ b.high) >>> 0) + bitCount((a.low ^ b.low) >>> 0);
}

/** Bits apart, the right way round or mirrored, whichever is closer. */
function closest(a: Bits, b: Bits, bMirror: Bits | null): number {
  return Math.min(bitsApart(a, b), bMirror ? bitsApart(a, bMirror) : 64);
}

/** Bits apart at or under which two shapes are the same picture. */
export const SAME_PHOTO_BITS = 10;
/** Under this much of the subject's colours in common, the same picture is a recoloured copy. */
export const RECOLOURED = 0.3;
/** Silhouette cells apart, of 64, at or under which two subjects have the same outline. */
const SAME_OUTLINE_BITS = 9;

export interface Likeness {
  /** The same picture, recompressed, resized, screenshotted, flipped or recoloured. */
  samePhoto: boolean;
  /**
   * The same thing, likely, in another picture: shot closer or further, off to
   * one side, against another backdrop, a little turned or facing the other way.
   */
  sameItem: boolean;
  /** 0 to 1: how alike they look, shape and colour together. */
  score: number;
  /** 0 to 1: how alike the subjects' colours are, backdrop aside; null when either hash predates it. */
  look: number | null;
}

/** How alike two fingerprints are; null when either is unreadable. */
export function likeness(a: string, b: string): Likeness | null {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  const bits = closest(left.shape, right.shape, right.mirror);
  // Unrelated photos sit around 32 bits apart; anything past that is noise.
  const shape = Math.max(0, 1 - bits / 32);
  const colour = overlap(left.colour, right.colour);
  const look = left.look && right.look ? overlap(left.look, right.look, lookWeight) : null;
  // A photo that is mostly plain backdrop has little shape to go on, and two of
  // them can share it; the same photo shares its colours as well.
  let samePhoto = bits <= SAME_PHOTO_BITS && colour >= 0.5;
  let score = 0.65 * shape + 0.35 * colour;
  let sameItem = samePhoto;

  if (left.subject && right.subject && left.edges && right.edges && left.silhouette && right.silhouette) {
    // The thing itself, wherever it sits in the frame and whichever way it faces.
    // The outline and the shading inside it are each taken the way round that
    // matches best, but the same way round for both.
    const straight = bitsApart(left.silhouette, right.silhouette) + bitsApart(left.subject, right.subject) / 2;
    const flipped = bitsApart(left.silhouette, right.silhouetteMirror!) + bitsApart(left.subject, right.subjectMirror!) / 2;
    const outlineBits = flipped < straight ? bitsApart(left.silhouette, right.silhouetteMirror!) : bitsApart(left.silhouette, right.silhouette);
    const subjectBits = flipped < straight ? bitsApart(left.subject, right.subjectMirror!) : bitsApart(left.subject, right.subject);
    const outline = Math.max(0, 1 - outlineBits / 24);
    const subject = Math.max(0, 1 - subjectBits / 32);
    const edges = edgeLikeness(left.edges, right.edges);
    const hue = look ?? colour;
    // The frame alike is not enough when what is in it is not: two product shots
    // on the same white sweep share almost all their shape.
    samePhoto &&= outlineBits <= SAME_OUTLINE_BITS;
    if (!samePhoto) score = Math.min(score, 0.5 * score + 0.5 * outline);
    // The shading inside counts for little: on a plain-coloured thing it is
    // mostly noise and which way the light fell.
    const item = 0.35 * outline + 0.1 * subject + 0.2 * edges + 0.35 * hue;
    score = Math.max(score, item);
    // The same picture recoloured is the same photo, but a red one is not the blue one.
    sameItem = (samePhoto && hue >= RECOLOURED) || (outlineBits <= SAME_OUTLINE_BITS && hue >= 0.45 && edges >= 0.7);
  }
  return { samePhoto, sameItem, score, look };
}

/* ── Stored photos ──────────────────────────────────────────────────────── */

/**
 * Fingerprints of stored photos, by blob name.
 *
 * Blob names are uuids and the bytes behind one never change, so an entry is
 * never stale - it is only dropped to bound memory. Kept per host instance;
 * a cold instance pays for each photo once.
 */
const known = new Map<string, Prints | null>();
const KNOWN_MAX = 20_000;

/** Fingerprints being worked out, so photos asked about together are read once. */
const working = new Map<string, Promise<Prints | null>>();

function remember(blobName: string, prints: Prints | null): void {
  if (known.size >= KNOWN_MAX) known.delete(known.keys().next().value!);
  known.set(blobName, prints);
}

/** The fingerprints of one of our stored photos - the whole and each item - read and worked out on first ask. */
export function storedPrints(blobName: string): Promise<Prints | null> {
  if (known.has(blobName)) return Promise.resolve(known.get(blobName) ?? null);
  const pending = working.get(blobName);
  if (pending) return pending;
  const work = (async () => {
    const store = await getPhotoStore();
    const found = await store.read(blobName);
    const prints = found ? printsOf(found.bytes, found.contentType) : null;
    // A photo that could not be read may be there next time; one that could not
    // be decoded never will be.
    if (found) remember(blobName, prints);
    return prints;
  })().finally(() => working.delete(blobName));
  working.set(blobName, work);
  return work;
}

/** The fingerprint of one of our stored photos, read and computed on first ask. */
export async function storedFingerprint(blobName: string): Promise<string | null> {
  return (await storedPrints(blobName))?.hash ?? null;
}

/** The fingerprints of a stored photo whose bytes are already to hand: worked out once, never read again. */
export function printsFor(blobName: string, bytes: Uint8Array, contentType: string): Prints | null {
  if (!known.has(blobName)) remember(blobName, printsOf(bytes, contentType));
  return known.get(blobName) ?? null;
}

/** The fingerprint of a stored photo whose bytes are already to hand. */
export function fingerprintOf(blobName: string, bytes: Uint8Array, contentType: string): string | null {
  return printsFor(blobName, bytes, contentType)?.hash ?? null;
}

/** Whether this blob's fingerprint is already to hand, so costs nothing to ask. */
export function isFingerprinted(blobName: string): boolean {
  return known.has(blobName);
}
