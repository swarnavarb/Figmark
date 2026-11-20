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
/** Items told apart in one photo, at most: a shelf of figures is a dozen. */
export const MAX_REGIONS = 12;

/** Working copies already made, by the picture they were made from: a search reads one photo many times. */
const workingCopies = new WeakMap<Raw, Raw>();

/** The picture at a size worth fingerprinting. */
function workingCopy(raw: Raw): Raw {
  const edge = Math.max(raw.width, raw.height);
  if (edge <= WORK_EDGE) return raw;
  let copy = workingCopies.get(raw);
  if (!copy) {
    copy = shrinkRaw(raw, WORK_EDGE / edge);
    workingCopies.set(raw, copy);
  }
  return copy;
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
  // Twelve hues, each centred on its colour: red runs either side of 0.
  return (Math.floor(hue * 2 + 0.5) % 12) * 2 + (saturation < 0.55 ? 0 : 1);
}

type Colour = [number, number, number];

/**
 * How far a colour may be from the backdrop and still be backdrop, at most and
 * at least. Within that it follows how much the backdrop itself varies: a
 * clean studio sweep is held tight, so a cream panel or a pale face on it is
 * still the thing; a grainy desk is given more room.
 */
const REACH_MAX = 60;
const REACH_MIN = 30;
/** How much darker than the backdrop a shadow on it can be, as a share of its brightness. */
const SHADOW_DEPTH = 0.75;

/** Points read along each side of the frame, for a backdrop that shades from one side to another. */
const SIDE_POINTS = 24;

/**
 * The backdrop, two ways:
 *
 * - the colours the edge carries much of: a plain sweep is one, a shelf a few;
 * - the colour along each side, for a backdrop that shades across the frame -
 *   a desk lit from one side, a gradient sweep - where no one colour is much of
 *   the edge. A pixel is backdrop when it is close to the colour the sides
 *   say should be there, blended in from all four (a Coons patch). Only kept
 *   when the sides change smoothly: a busy edge says nothing about the middle.
 */
interface Backdrop {
  colours: Colour[];
  sides: { top: Colour[]; bottom: Colour[]; left: Colour[]; right: Colour[] } | null;
  /** How far from it a colour may be and still be it. */
  reach: number;
  /** The colour the sides say belongs across the frame, on a grid; null without sides. */
  field: Float32Array | null;
}

/** Whether anything is known about the backdrop at all. */
const knownBackdrop = (backdrop: Backdrop) => backdrop.colours.length > 0 || backdrop.sides !== null;

function backdropOf(raw: Raw): Backdrop {
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
  const colours: Colour[] = [];
  for (const group of coarse.values()) {
    if (group.length < edge.length * 0.08) continue;
    let r = 0; let g = 0; let b = 0;
    for (const i of group) { r += raw.data[i]!; g += raw.data[i + 1]!; b += raw.data[i + 2]!; }
    colours.push([r / group.length, g / group.length, b / group.length]);
  }
  // How much the backdrop varies from one point to the next along each side:
  // grain and noise, not the slow change of a gradient. Most of the edge is
  // backdrop, so a thing touching it here and there does not move this much.
  const steps: number[] = [];
  for (let k = 2; k < edge.length; k += 1) {
    const a = edge[k]!; const b = edge[k - 2]!;
    steps.push(Math.abs(raw.data[a]! - raw.data[b]!) + Math.abs(raw.data[a + 1]! - raw.data[b + 1]!) + Math.abs(raw.data[a + 2]! - raw.data[b + 2]!));
  }
  steps.sort((a, b) => a - b);
  const grain = steps.length > 0 ? steps[Math.floor(steps.length * 0.8)]! : REACH_MAX;
  const reach = Math.max(REACH_MIN, Math.min(REACH_MAX, 12 + 2.5 * grain));
  const sides = sidesOf(raw, inX, inY);
  return { colours, sides, reach, field: sides ? fieldOf(sides) : null };
}

/** The colour along each side, smoothed past small things that touch it; null when a side is busy. */
function sidesOf(raw: Raw, inX: number, inY: number): Backdrop['sides'] {
  if (raw.width < 8 || raw.height < 8) return null;
  const read = (x: number, y: number): Colour => {
    // A small patch, so one noisy pixel is not the side's colour.
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = Math.max(0, Math.min(raw.width - 1, x + dx));
        const py = Math.max(0, Math.min(raw.height - 1, y + dy));
        const i = (py * raw.width + px) * 4;
        r += raw.data[i]!; g += raw.data[i + 1]!; b += raw.data[i + 2]!; n += 1;
      }
    }
    return [r / n, g / n, b / n];
  };
  const along = (point: (t: number) => [number, number]) => {
    const raw = Array.from({ length: SIDE_POINTS }, (_, k) => read(...point(k / (SIDE_POINTS - 1))));
    // A running median: a thing that pokes into the side for a point or two is passed over.
    return raw.map((_, k) => {
      const near = raw.slice(Math.max(0, k - 2), k + 3);
      return [0, 1, 2].map((c) => near.map((colour) => colour[c]!).sort((a, b) => a - b)[Math.floor(near.length / 2)]!) as Colour;
    });
  };
  const right = raw.width - 1 - inX; const bottom = raw.height - 1 - inY;
  const sides = {
    top: along((t) => [Math.round(inX + t * (right - inX)), inY]),
    bottom: along((t) => [Math.round(inX + t * (right - inX)), bottom]),
    left: along((t) => [inX, Math.round(inY + t * (bottom - inY))]),
    right: along((t) => [right, Math.round(inY + t * (bottom - inY))]),
  };
  // Smooth means each point is close to the next: a gradient, not a cluttered shelf.
  const jumps = Object.values(sides).flatMap((side) => side.slice(1).map((colour, k) =>
    Math.abs(colour[0] - side[k]![0]) + Math.abs(colour[1] - side[k]![1]) + Math.abs(colour[2] - side[k]![2])));
  jumps.sort((a, b) => a - b);
  return jumps[Math.floor(jumps.length * 0.8)]! < 24 ? sides : null;
}

/** The colour a side says is at `t` along it, 0 to 1. */
function sideAt(side: Colour[], t: number): Colour {
  const at = Math.max(0, Math.min(1, t)) * (side.length - 1);
  const k = Math.min(side.length - 2, Math.floor(at));
  const f = at - k;
  return [0, 1, 2].map((c) => side[k]![c]! * (1 - f) + side[k + 1]![c]! * f) as Colour;
}

/** Nodes across and down the grid the sides' backdrop is worked out on, once per photo. */
const FIELD = 33;

/**
 * The colour the sides say belongs at every node of a grid over the frame,
 * blended in from all four (a Coons patch). Worked out once per photo; a
 * pixel then looks its colour up rather than blending the sides afresh.
 */
function fieldOf(sides: NonNullable<Backdrop['sides']>): Float32Array {
  const field = new Float32Array(FIELD * FIELD * 3);
  const first = (side: Colour[]) => side[0]!;
  const last = (side: Colour[]) => side[side.length - 1]!;
  for (let row = 0; row < FIELD; row += 1) {
    const v = row / (FIELD - 1);
    const left = sideAt(sides.left, v); const right = sideAt(sides.right, v);
    for (let col = 0; col < FIELD; col += 1) {
      const u = col / (FIELD - 1);
      const top = sideAt(sides.top, u); const bottom = sideAt(sides.bottom, u);
      for (let c = 0; c < 3; c += 1) {
        field[(row * FIELD + col) * 3 + c] = (1 - v) * top[c]! + v * bottom[c]! + (1 - u) * left[c]! + u * right[c]!
          - ((1 - u) * (1 - v) * first(sides.top)[c]! + u * (1 - v) * last(sides.top)[c]!
            + (1 - u) * v * first(sides.bottom)[c]! + u * v * last(sides.bottom)[c]!);
      }
    }
  }
  return field;
}

/** Whether (r, g, b) is the backdrop colour (br, bg, bb), or a shadow on it. */
function nearColour(r: number, g: number, b: number, br: number, bg: number, bb: number, reach: number): boolean {
  if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < reach) return true;
  // A shadow: the backdrop's own colour, a little darker. A thing is a
  // different colour, or a lot darker, so neither is taken for one.
  const shade = (r + g + b) / Math.max(1, br + bg + bb);
  if (shade < SHADOW_DEPTH || shade > 1) return false;
  // A shadow's edge is soft and its colour a little off, however clean the backdrop.
  return Math.abs(r / shade - br) + Math.abs(g / shade - bg) + Math.abs(b / shade - bb) < REACH_MAX * 0.6;
}

/**
 * Whether a colour at (u, v) - fractions across and down the frame - is the
 * backdrop: close to a colour the edge carries much of, or to the colour the
 * sides say belongs there. Called for most pixels of every photo, so it
 * allocates nothing.
 */
function isBackdrop(backdrop: Backdrop, u: number, v: number, r: number, g: number, b: number, reach = backdrop.reach): boolean {
  for (const colour of backdrop.colours) {
    if (nearColour(r, g, b, colour[0], colour[1], colour[2], reach)) return true;
  }
  const field = backdrop.field;
  if (!field) return false;
  // The colour the sides say belongs here, between the four nearest nodes.
  const x = Math.max(0, Math.min(1, u)) * (FIELD - 1); const y = Math.max(0, Math.min(1, v)) * (FIELD - 1);
  const x0 = Math.min(FIELD - 2, Math.floor(x)); const y0 = Math.min(FIELD - 2, Math.floor(y));
  const fx = x - x0; const fy = y - y0;
  const a = (y0 * FIELD + x0) * 3; const d = a + FIELD * 3;
  const w00 = (1 - fx) * (1 - fy); const w01 = fx * (1 - fy); const w10 = (1 - fx) * fy; const w11 = fx * fy;
  return nearColour(r, g, b,
    field[a]! * w00 + field[a + 3]! * w01 + field[d]! * w10 + field[d + 3]! * w11,
    field[a + 1]! * w00 + field[a + 4]! * w01 + field[d + 1]! * w10 + field[d + 4]! * w11,
    field[a + 2]! * w00 + field[a + 5]! * w01 + field[d + 2]! * w10 + field[d + 5]! * w11,
    reach);
}

/**
 * A backdrop, and where a picture sits within the frame it was read from. An
 * item cut out of a photo has little backdrop of its own round it; the whole
 * photo's, read at the item's place in it, is what tells item from backdrop.
 */
interface View {
  backdrop: Backdrop;
  /** Where the picture being read sits in the backdrop's frame. */
  frame: RegionBox;
}

const FULL: RegionBox = [0, 0, 1, 1];

/** A picture read against its own backdrop. */
const ownView = (raw: Raw): View => ({ backdrop: backdropOf(raw), frame: FULL });

/** The view of a part of a picture: the same backdrop, a smaller frame. */
const within = (view: View, box: RegionBox): View => ({
  backdrop: view.backdrop,
  frame: [
    view.frame[0] + box[0] * view.frame[2], view.frame[1] + box[1] * view.frame[3],
    box[2] * view.frame[2], box[3] * view.frame[3],
  ],
});

/**
 * Whether a colour at (u, v) of the picture in view is backdrop. For the
 * outline of a thing (`shape`) a little more room is given: a turned or
 * resized edge blends with the backdrop, and the outline should not wobble
 * with it. For its colours the backdrop's own reach is kept, so a pale face on
 * a pale desk is still the face.
 */
const SHAPE_REACH = 40;
const backdropAt = (view: View, u: number, v: number, r: number, g: number, b: number, shape = false) =>
  isBackdrop(view.backdrop, view.frame[0] + u * view.frame[2], view.frame[1] + v * view.frame[3], r, g, b,
    shape ? Math.max(view.backdrop.reach, SHAPE_REACH) : view.backdrop.reach);

/** A colour that stands for the backdrop, for filling corners a turn uncovers. */
function backdropFill(backdrop: Backdrop): Colour {
  if (backdrop.colours[0]) return backdrop.colours[0];
  const sides = backdrop.sides;
  if (!sides) return [255, 255, 255];
  const all = [...sides.top, ...sides.bottom, ...sides.left, ...sides.right];
  return [0, 1, 2].map((c) => all.reduce((sum, colour) => sum + colour[c]!, 0) / all.length) as Colour;
}

/** The colours of the subject: every pixel close to the backdrop is left out. */
function look(raw: Raw, view: View): string {
  const bins = new Array<number>(LOOK_BINS).fill(0);
  const pixels = raw.width * raw.height;
  const step = Math.max(1, Math.floor(pixels / 8192));
  for (let index = 0; index < pixels; index += step) {
    const i = index * 4;
    const r = raw.data[i]!; const g = raw.data[i + 1]!; const b = raw.data[i + 2]!;
    const u = (index % raw.width) / raw.width; const v = Math.floor(index / raw.width) / raw.height;
    if (backdropAt(view, u, v, r, g, b)) continue;
    bins[lookBin(r, g, b)]! += 1;
  }
  // Colours are scaled against the strongest colour, greys against everything:
  // a card that is mostly cream panel is still the pink and blue of its frame.
  const colours = bins.slice(0, 24);
  const greys = bins.slice(24);
  const all = Math.max(1e-9, ...bins);
  const colourTop = Math.max(...colours);
  // A few stray coloured pixels in a grey thing are noise, not its colour.
  const coloured = colourTop >= all * 0.08 ? colourTop : Infinity;
  const digit = (value: number, top: number) => Math.round(Math.min(1, value / top) * 15).toString(16);
  return [...colours.map((value) => digit(value, coloured)), ...greys.map((value) => digit(value, all))].join('');
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

/**
 * Kinds of colour the adjacency tells apart: black, grey, white, then six hues
 * each pale or vivid. Pale against vivid is what tells skin from a red jacket,
 * or a plush's belly from its fur; light against dark is mostly how the light
 * fell, so it is not told apart.
 */
const PARTS = 15;
const PAIRS = (PARTS * (PARTS - 1)) / 2;

function partOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const value = max / 255; const saturation = max ? (max - min) / max : 0;
  if (value < 0.2) return 0;
  if (saturation < 0.2) return value < 0.7 ? 1 : 2;
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  return 3 + (Math.floor(hue + 0.5) % 6) * 2 + (saturation >= 0.5 ? 1 : 0);
}

/** Where the pair (a, b), a < b, sits in the list of pairs. */
const pairIndex = (a: number, b: number) => a * PARTS - (a * (a + 1)) / 2 + (b - a - 1);



/**
 * Which colours of the thing touch which, and how much: hair against face,
 * face against a red jacket, a yellow belt between red and blue, blue legs
 * ending in black boots. An action figure posed another way, a plush lying on
 * its side or a box turned round moves its outline and its edges, but the same
 * parts still meet the same parts.
 */
function adjacency(thing: Raw, view: View): string {
  const grid = 48;
  const parts = new Int8Array(grid * grid).fill(-1);
  const votes = new Array<number>(PARTS);
  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      const x0 = Math.floor((col * thing.width) / grid);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * thing.width) / grid));
      const y0 = Math.floor((row * thing.height) / grid);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * thing.height) / grid));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 3));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 3));
      // Each cell is the part most of its pixels are, not the average of
      // them: red beside blue is red and blue, never a purple between.
      votes.fill(0);
      let ground = 0; let n = 0;
      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const at = (y * thing.width + x) * 4;
          const r = thing.data[at]!; const g = thing.data[at + 1]!; const b = thing.data[at + 2]!;
          n += 1;
          if (backdropAt(view, x / thing.width, y / thing.height, r, g, b)) ground += 1;
          else votes[partOf(r, g, b)]! += 1;
        }
      }
      if (ground * 2 >= n) continue;
      parts[row * grid + col] = votes.indexOf(Math.max(...votes));
    }
  }
  const bins = new Array<number>(PAIRS).fill(0);
  let things = 0;
  for (const part of parts) if (part >= 0) things += 1;
  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      const here = parts[row * grid + col]!;
      if (here < 0) continue;
      for (const next of [col + 1 < grid ? parts[row * grid + col + 1]! : -1, row + 1 < grid ? parts[(row + 1) * grid + col]! : -1]) {
        if (next < 0 || next === here) continue;
        bins[pairIndex(Math.min(here, next), Math.max(here, next))]! += 1;
      }
    }
  }
  // How much there is to go on, first: boundaries between parts per cell of
  // the thing. A plush that is one brown all over has next to none.
  const boundaries = bins.reduce((sum, count) => sum + count, 0);
  const strength = Math.min(15, Math.round((boundaries / Math.max(1, things)) * 60));
  return strength.toString(16) + hexBins(bins);
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
 * Where the things in the photo are: everything far from the backdrop, split
 * into the separate shapes it makes, with the pieces of one thing put back
 * together.
 */
function segment(raw: Raw, given?: View): Segmented {
  const scale = SEGMENT_CELLS / Math.max(raw.width, raw.height);
  const small = shrinkRaw(raw, Math.min(1, scale));
  const { width, height } = small;
  const view = given ?? ownView(small);
  if (!knownBackdrop(view.backdrop) || width < 4 || height < 4) return { subject: null, items: [] };

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    const at = i * 4;
    const u = ((i % width) + 0.5) / width; const v = (Math.floor(i / width) + 0.5) / height;
    mask[i] = backdropAt(view, u, v, small.data[at]!, small.data[at + 1]!, small.data[at + 2]!, true) ? 0 : 1;
  }
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
      // Side by side only, not corner to corner: two things a cell apart on a diagonal are two things.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        {
          const nx = cx + dx; const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && label[next]! < 0) { label[next] = boxes.length; queue.push(next); }
        }
      }
    }
    // A cell of margin each way, so the crop holds the whole outline. Small
    // pieces are kept for now: a head cut off from its body by a face the
    // colour of the desk is small, and goes back on the body below.
    if (cells >= 2) {
      boxes.push({ box: clampBox([(x0 - 1) / width, (y0 - 1) / height, (x1 - x0 + 3) / width, (y1 - y0 + 3) / height]), cells });
    }
  }
  if (boxes.length === 0) return { subject: null, items: [] };

  // Shapes that mostly sit inside one another are one thing: a box and the
  // figure printed on it. So is a small piece right beside a much larger one:
  // the dark sole under a white-soled shoe, a head over a body, cut off by a
  // band the colour of the backdrop. Two things of a size side by side stay two.
  const near = 4 / Math.max(width, height);
  const gap = (a: RegionBox, b: RegionBox) => Math.max(
    0, Math.max(a[0], b[0]) - Math.min(a[0] + a[2], b[0] + b[2]), Math.max(a[1], b[1]) - Math.min(a[1] + a[3], b[1] + b[3]),
  );
  const oneThing = (a: RegionBox, b: RegionBox) => overlapOfBoxes(a, b) >= 0.4
    || (gap(a, b) <= near && Math.min(area(a), area(b)) <= 0.3 * Math.max(area(a), area(b)));
  const pieces = boxes.map((entry) => ({ ...entry }));
  for (let again = true; again;) {
    again = false;
    outer: for (let i = 0; i < pieces.length; i += 1) {
      for (let j = i + 1; j < pieces.length; j += 1) {
        if (oneThing(pieces[i]!.box, pieces[j]!.box)) {
          pieces[i] = { box: clampBox(union(pieces[i]!.box, pieces[j]!.box)), cells: pieces[i]!.cells + pieces[j]!.cells };
          pieces.splice(j, 1);
          again = true;
          break outer;
        }
      }
    }
  }
  // What is still small on its own is a speck: noise, a crumb, a reflection.
  let merged = pieces.filter((piece) => piece.cells >= minCells).map((piece) => piece.box);
  if (merged.length === 0) return { subject: null, items: [] };
  const subject = clampBox(merged.reduce(union));
  // Nothing stands out from a backdrop that is barely there: the photo is all subject.
  if (area(subject) > 0.95) return { subject: null, items: [] };
  merged.sort((a, b) => area(b) - area(a));
  const largest = area(merged[0]!);
  // A speck beside the main thing - a logo, a price sticker - is not an item.
  merged = merged.filter((box) => area(box) >= largest * 0.08).slice(0, MAX_REGIONS);
  return { subject, items: merged.length >= 2 ? merged : [] };
}

/** Where the thing in a photo is - everything that is not backdrop - or null when that cannot be told. */
export function subjectBox(raw: Raw): RegionBox | null {
  return segment(workingCopy(raw)).subject;
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
function silhouette(thing: Raw, view: View): string {
  const cells: number[] = [];
  if (knownBackdrop(view.backdrop)) {
    // Read finer than the hash, so a hole can be told from the outside: a light
    // belly or a printed panel the colour of the backdrop is still the thing.
    const fine = 24;
    const on = new Uint8Array(fine * fine);
    for (let row = 0; row < fine; row += 1) {
      for (let col = 0; col < fine; col += 1) {
        const x0 = Math.floor((col * thing.width) / fine);
        const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * thing.width) / fine));
        const y0 = Math.floor((row * thing.height) / fine);
        const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * thing.height) / fine));
        const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
        const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
        let count = 0; let n = 0;
        for (let y = y0; y < y1; y += stepY) {
          for (let x = x0; x < x1; x += stepX) {
            const at = (y * thing.width + x) * 4;
            if (!backdropAt(view, x / thing.width, y / thing.height, thing.data[at]!, thing.data[at + 1]!, thing.data[at + 2]!)) count += 1;
            n += 1;
          }
        }
        on[row * fine + col] = count * 2 >= n ? 1 : 0;
      }
    }
    // Backdrop is what can be reached from the edge; anything else is the thing.
    const outside = new Uint8Array(fine * fine);
    const queue: number[] = [];
    for (let k = 0; k < fine; k += 1) {
      for (const cell of [k, (fine - 1) * fine + k, k * fine, k * fine + fine - 1]) {
        if (!on[cell] && !outside[cell]) { outside[cell] = 1; queue.push(cell); }
      }
    }
    while (queue.length > 0) {
      const cell = queue.pop()!;
      const cx = cell % fine; const cy = Math.floor(cell / fine);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx; const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= fine || ny >= fine) continue;
        const next = ny * fine + nx;
        if (!on[next] && !outside[next]) { outside[next] = 1; queue.push(next); }
      }
    }
    const per = fine / 8;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        let inside = 0;
        for (let y = 0; y < per; y += 1) for (let x = 0; x < per; x += 1) inside += outside[(row * per + y) * fine + col * per + x] ? 0 : 1;
        cells.push(inside / (per * per));
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
function tighten(raw: Raw, box: RegionBox, view: View): RegionBox {
  if (!knownBackdrop(view.backdrop)) return box;
  const x0 = Math.floor(box[0] * raw.width);
  const y0 = Math.floor(box[1] * raw.height);
  const x1 = Math.min(raw.width, Math.ceil((box[0] + box[2]) * raw.width));
  const y1 = Math.min(raw.height, Math.ceil((box[1] + box[3]) * raw.height));
  const step = Math.max(1, Math.floor(Math.max(x1 - x0, y1 - y0) / 160));
  let left = x1; let top = y1; let right = x0; let bottom = y0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const at = (y * raw.width + x) * 4;
      if (backdropAt(view, x / raw.width, y / raw.height, raw.data[at]!, raw.data[at + 1]!, raw.data[at + 2]!, true)) continue;
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
  const fill = backdropFill(backdropOf(work));
  return TILTS.flatMap((degrees) => hashWorking(turnPixels(work, (degrees * Math.PI) / 180, fill)) ?? []);
}

/**
 * The fingerprint of pixels already at working size, read against `view`: its
 * own backdrop for a whole photo, the photo's for an item cut from it.
 */
function hashWorking(raw: Raw, view: View = ownView(raw)): string | null {
  if (raw.width < 2 || raw.height < 2) return null;
  const [shape, mirror] = dHashes(raw);
  const { subject } = segment(raw, view);
  const frame: RegionBox = subject ? tighten(raw, subject, view) : FULL;
  const thing = subject ? cropPixels(raw, frame) : raw;
  const [subjectShape, subjectMirror] = dHashes(thing);
  return [
    HASH_VERSION, shape, colourHistogram(raw), look(raw, view), mirror, subjectShape, subjectMirror,
    edgeHistogram(thing), silhouette(thing, within(view, frame)), adjacency(thing, within(view, frame)),
  ].join(':');
}

/** One part of a photo's fingerprint, read against the whole photo's backdrop. */
export function regionFingerprint(raw: Raw, box: RegionBox): string | null {
  const work = workingCopy(raw);
  return hashWorking(cropPixels(work, box), within(ownView(work), box));
}

/**
 * One item lifted out of its photo onto a plain backdrop with a margin round
 * it: everything the photo's backdrop says is not the item - the desk, a slice
 * of the thing beside it - is painted over. A neighbour's edge cannot creep into
 * the item's fingerprint, and the item can be turned with nothing to drag in.
 */
function isolate(raw: Raw, box: RegionBox): Raw {
  const work = workingCopy(raw);
  const view = within(ownView(work), box);
  const crop = cropPixels(work, box);
  const fill = backdropFill(view.backdrop);
  const padX = Math.round(crop.width * 0.2); const padY = Math.round(crop.height * 0.2);
  const width = crop.width + 2 * padX; const height = crop.height + 2 * padY;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      const cx = x - padX; const cy = y - padY;
      let colour: Colour = fill;
      if (cx >= 0 && cy >= 0 && cx < crop.width && cy < crop.height) {
        const at = (cy * crop.width + cx) * 4;
        const here: Colour = [crop.data[at]!, crop.data[at + 1]!, crop.data[at + 2]!];
        if (!backdropAt(view, cx / crop.width, cy / crop.height, ...here)) colour = here;
      }
      data[out] = colour[0]; data[out + 1] = colour[1]; data[out + 2] = colour[2]; data[out + 3] = 255;
    }
  }
  // Only the shape the item makes is kept: a stray patch at the edge of the box is painted over too.
  const lifted = { data, width, height };
  const { items, subject } = segment(lifted);
  const keep = items[0] ?? subject;
  if (!keep) return lifted;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width; const v = y / height;
      if (u >= keep[0] && u <= keep[0] + keep[2] && v >= keep[1] && v <= keep[1] + keep[3]) continue;
      const out = (y * width + x) * 4;
      data[out] = fill[0]; data[out + 1] = fill[1]; data[out + 2] = fill[2];
    }
  }
  return lifted;
}

/**
 * Fingerprints of one item in a photo, to search with: lifted onto a plain
 * backdrop (`isolate`), as it is and turned a little each way.
 */
export function isolatedFingerprints(raw: Raw, box: RegionBox, tilted = true): string[] {
  const lifted = isolate(raw, box);
  return [hashWorking(lifted), ...(tilted ? tiltedFingerprints(lifted) : [])].filter((hash): hash is string => hash !== null);
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
  const view = ownView(work);
  const hash = hashWorking(work, view);
  if (!hash) return null;
  const regions: PhotoRegion[] = [];
  for (const box of (boxes ?? segment(work).items).slice(0, MAX_REGIONS)) {
    const imageHash = hashWorking(cropPixels(work, box), within(view, box));
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
  colour: Uint8Array;
  look: Uint8Array | null;
  /** Present on v2 and later. */
  mirror: Bits | null;
  subject: Bits | null;
  subjectMirror: Bits | null;
  edges: Uint8Array | null;
  /** The edges turned and mirrored, for comparing against without copying. */
  edgeReadings: Uint8Array[] | null;
  silhouette: Bits | null;
  silhouetteMirror: Bits | null;
  /** Which colours touch which; absent on hashes from before it was kept. */
  adjacency: Uint8Array | null;
  /** How many part boundaries the adjacency rests on, 0 to 15. */
  partsStrength: number;
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
const digits = (text: string) => Uint8Array.from(text, (digit) => parseInt(digit, 16));

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
  const [version, shape, colour, lookPart, mirror, subject, subjectMirror, edges, outline, touching] = hash.split(':');
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
      edgeReadings: v2 ? edgeReadings([...digits(edges!)]) : null,
      silhouette: v2 ? bitsOf(outline!) : null,
      silhouetteMirror: v2 ? bitsOf(mirrorRows(outline!)) : null,
      adjacency: v2 && touching?.length === PAIRS + 1 ? digits(touching.slice(1)) : null,
      partsStrength: v2 && touching?.length === PAIRS + 1 ? parseInt(touching[0]!, 16) : 0,
    };
  }
  if (parsed.size >= PARSED_MAX) parsed.delete(parsed.keys().next().value!);
  parsed.set(hash, value);
  return value;
}

/** Whether a stored hash is the current kind, or is worth working out again from the photo. */
export function isCurrent(hash: string): boolean {
  const known = parse(hash);
  return known?.version === HASH_VERSION && known.adjacency !== null;
}

/** Whether a stored hash carries the look, or predates it. */
export function hasLook(hash: string): boolean {
  return parse(hash)?.look != null;
}

/** Weighted overlap of two histograms, 0 to 1. */
/*
 * Comparison runs once per photo in the catalogue for every search, so these
 * loops allocate nothing: no closures, no copied arrays.
 */
function overlap(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let shared = 0; let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index]!; const y = b[index]!;
    if (x < y) { shared += x; total += y; } else { shared += y; total += x; }
  }
  return total ? shared / total : 0;
}

/** Black, grey and white are in most photos - text, shadow, packaging - so they say little. */
const GREY_LOOK = 24;
const GREY_WEIGHT = 0.25;

/** `overlap` with the greys of the look counted for a quarter. */
function lookOverlap(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let shared = 0; let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    const weight = index >= GREY_LOOK ? GREY_WEIGHT : 1;
    const x = a[index]!; const y = b[index]!;
    if (x < y) { shared += weight * x; total += weight * y; } else { shared += weight * y; total += weight * x; }
  }
  return total ? shared / total : 0;
}

/** An edge histogram as it reads turned a bin either way and mirrored: six readings, worked out once per hash. */
function edgeReadings(edges: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const mirrored of [false, true]) {
    for (const shift of [-1, 0, 1]) {
      const reading = new Uint8Array(EDGE_BINS);
      for (let index = 0; index < EDGE_BINS; index += 1) {
        const from = (index + shift + EDGE_BINS) % EDGE_BINS;
        reading[index] = edges[mirrored ? EDGE_BINS - 1 - from : from]!;
      }
      out.push(reading);
    }
  }
  return out;
}

/**
 * How alike two edge histograms are, allowing the camera a slant of up to a
 * bin either way (15 degrees), and the item facing the other way.
 */
function edgeLikeness(a: Uint8Array, readings: Uint8Array[]): number {
  let best = 0;
  for (const reading of readings) {
    const alike = overlap(a, reading);
    if (alike > best) best = alike;
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
/** Subject colours and colour adjacency at or over which a thing is the same thing posed another way. */
const POSED_LOOK = 0.7;
const POSED_PARTS = 0.45;
/** Part boundaries both things need before which colours touch which is evidence. */
const PARTS_STRENGTH = 3;
/** Colour adjacency under which two things are made differently, whatever their outlines say. */
const OTHER_PARTS = 0.4;
/** The most two things made differently can score: a look-alike, never a match. */
const LOOK_ALIKE_CAP = 0.7;
/** How alike two shapes must be, colours aside, for one to be another colourway of the other. */
const VARIANT_FORM = 0.78;
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
  /** 0 to 1: how alike which colours of the subjects touch which; null when either hash predates it. */
  parts: number | null;
  /** 0 to 1: how alike the subjects' shapes are, colours aside. */
  shape: number;
  /**
   * Not the same item, but the same shape in other colours: another colourway
   * of a shoe, a figure's repaint or variant. Worth suggesting, never a match.
   */
  variant: boolean;
}

/** How alike two fingerprints are; null when either is unreadable. */
export function likeness(a: string, b: string): Likeness | null {
  const left = parse(a);
  const right = parse(b);
  return left && right ? likenessOf(left, right) : null;
}

/** A fingerprint read once, to be compared many times without reading it again. */
export type Fingerprint = Parsed;

/** A fingerprint read for comparing, or null for one that is not. */
export function readFingerprint(hash: string): Fingerprint | null {
  return parse(hash);
}

/** `likeness` of two fingerprints already read: what a search over the catalogue runs. */
export function likenessOf(left: Fingerprint, right: Fingerprint): Likeness {
  const bits = closest(left.shape, right.shape, right.mirror);
  // Unrelated photos sit around 32 bits apart; anything past that is noise.
  const shape = Math.max(0, 1 - bits / 32);
  const colour = overlap(left.colour, right.colour);
  const look = left.look && right.look ? lookOverlap(left.look, right.look) : null;
  // A photo that is mostly plain backdrop has little shape to go on, and two of
  // them can share it; the same photo shares its colours as well.
  let samePhoto = bits <= SAME_PHOTO_BITS && colour >= 0.5;
  let score = 0.65 * shape + 0.35 * colour;
  let sameItem = samePhoto;
  // Shape alone, colours aside: what tells another colourway of the same thing.
  let form = shape;
  let sameForm = false;
  // A thing of one colour, or one shade of brown all over, has few parts that
  // meet: what it has is noise, and says nothing either way.
  const rich = left.adjacency && right.adjacency && Math.min(left.partsStrength, right.partsStrength) >= PARTS_STRENGTH;
  const parts = rich ? overlap(left.adjacency!, right.adjacency!) : null;

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
    const edges = edgeLikeness(left.edges, right.edgeReadings!);
    const hue = look ?? colour;
    form = 0.55 * outline + 0.3 * edges + 0.15 * subject;
    sameForm = form >= VARIANT_FORM;
    // The frame alike is not enough when what is in it is not: two product shots
    // on the same white sweep share almost all their shape.
    samePhoto &&= outlineBits <= SAME_OUTLINE_BITS;
    if (!samePhoto) score = Math.min(score, 0.5 * score + 0.5 * outline);
    // The shading inside counts for little: on a plain-coloured thing it is
    // mostly noise and which way the light fell.
    const item = 0.35 * outline + 0.1 * subject + 0.2 * edges + 0.35 * hue;
    score = Math.min(1, Math.max(score, item));
    // The same picture recoloured is the same photo, but a red one is not the blue one.
    // Or everything agrees well without the outline being exact: a white sole
    // vanishes on a white sweep and shows on a desk, and moves the outline.
    sameItem = (samePhoto && hue >= RECOLOURED)
      || (outlineBits <= SAME_OUTLINE_BITS && hue >= 0.45 && edges >= 0.7)
      || (item >= 0.68 && hue >= 0.7 && edges >= 0.75 && outlineBits <= 22);
    if (parts !== null) {
      // Posed another way: an action figure with its arms up, a plush on its
      // side. The outline and edges have moved, but the colours are the same
      // and the same parts meet the same parts.
      const posed = hue >= POSED_LOOK && parts >= POSED_PARTS;
      if (posed) score = Math.max(score, Math.min(1, 0.4 * hue + 0.6 * parts + 0.15));
      sameItem ||= posed;
      // And the other way: the same mould in another paint job has the same
      // outline, but its parts meet differently - it is not this one.
      if (parts < OTHER_PARTS) {
        sameItem = false;
        score = Math.min(score, LOOK_ALIKE_CAP);
      }
    }
  }
  return { samePhoto, sameItem, score, look, parts, shape: form, variant: !sameItem && sameForm };
}

/** A colour as a shopper would say it: "Red", "Brown", "Navy", "Silver". */
function colourWord(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const value = max / 255; const saturation = max ? (max - min) / max : 0;
  if (value < 0.18) return 'Black';
  if (saturation < 0.18) return value < 0.45 ? 'Grey' : value < 0.8 ? 'Silver' : 'White';
  let hue: number;
  if (max === r) hue = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  const degrees = hue * 60;
  if (degrees >= 15 && degrees < 50) {
    if (saturation < 0.4 && value > 0.7) return 'Beige';
    return value < 0.65 ? 'Brown' : 'Orange';
  }
  if (degrees < 15 || degrees >= 345) return value < 0.45 ? 'Maroon' : 'Red';
  if (degrees < 70) return value < 0.55 ? 'Olive' : 'Yellow';
  if (degrees < 165) return 'Green';
  if (degrees < 195) return 'Teal';
  if (degrees < 255) return value < 0.5 ? 'Navy' : 'Blue';
  if (degrees < 290) return 'Purple';
  return 'Pink';
}

/**
 * The colour an item in a photo mostly is, as a word - what it is called when
 * nothing else names it. Read off its own pixels, the photo's backdrop aside.
 */
export function itemColour(raw: Raw, box: RegionBox): string | null {
  const work = workingCopy(raw);
  const view = within(ownView(work), box);
  const crop = cropPixels(work, box);
  const votes = new Map<string, number>();
  const step = Math.max(1, Math.floor((crop.width * crop.height) / 4096));
  for (let index = 0; index < crop.width * crop.height; index += step) {
    const at = index * 4;
    const r = crop.data[at]!; const g = crop.data[at + 1]!; const b = crop.data[at + 2]!;
    if (backdropAt(view, (index % crop.width) / crop.width, Math.floor(index / crop.width) / crop.height, r, g, b)) continue;
    const word = colourWord(r, g, b);
    // A colour says more than a grey of the same size: the grey is often shadow, print or packaging.
    votes.set(word, (votes.get(word) ?? 0) + (['Black', 'Grey', 'Silver', 'White'].includes(word) ? 0.6 : 1));
  }
  let best: string | null = null; let most = 0;
  for (const [word, count] of votes) if (count > most) { best = word; most = count; }
  return best;
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
