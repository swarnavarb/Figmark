import { areaOf, insideOf, overlapArea, shrinkPixels, type Box } from './photo-things.js';

/*
 * The scanning model: what a photo of things for sale holds - one item,
 * copies of one, or different items - read from the boxes a detector found
 * in it (shared/photo-things.ts finds them; this understands them).
 *
 * Kept apart from detection, and pure, so it runs the same on the phone, on
 * the server and in tests, and can be put to other uses: photo search, a
 * listing check, a moderation flag. Its rules are tuned against real sale
 * photos in test-fixtures/scan/ (scripts/check-scan.mjs): a change that reads
 * one of them wrong fails the tests. Add every photo it gets wrong there.
 *
 * The rule throughout is the seller's benefit of the doubt: a photo is one
 * item unless it is very sure there are several - three or more separate,
 * sharp subjects of comparable size, spread across it, that are not views of
 * one thing side by side. A figure in its blister with its spare heads and
 * guns, a figure held up in front of a cluttered room, a product's collage:
 * one item.
 */

/** Which version of the rules read a photo: bumped whenever they change, kept with what they read. */
export const SCAN_MODEL = 'figmark-scan-4';

/* ── Views of one thing ──────────────────────────────────────────────── */

/** A subject at least this much of the photo's height (or width, stacked) is a whole view, not a thing on a shelf. */
const VIEW_SPAN = 0.45;
/** A collage of views holds a few, not a shelf's worth. */
const MAX_VIEWS = 6;

/**
 * Whether a photo is views of one thing laid side by side - a product's
 * collage: the same figure up close, full length, from the back - rather
 * than different things together. Two to six big subjects in a row (or a
 * column), each filling most of the photo's height (width), of a size, not
 * overlapping; anything smaller is part of the view it stands in. The
 * picture alone cannot always tell such views of one thing from as many
 * different things posed alike, and in that doubt the fee counts one.
 */
export function viewsLineup(boxes: readonly Box[]): boolean {
  for (const across of [true, false]) {
    const span = (box: Box) => (across ? box[3] : box[2]);
    const start = (box: Box) => (across ? box[0] : box[1]);
    const size = (box: Box) => (across ? box[2] : box[3]);
    const shared = (a: Box, b: Box) => Math.max(0, Math.min(start(a) + size(a), start(b) + size(b)) - Math.max(start(a), start(b)));
    // The views: big subjects side by side, the narrowest first, so one box
    // the detector drew across two panels does not stand for either.
    const views: Box[] = [];
    for (const box of boxes.filter((one) => span(one) >= VIEW_SPAN).sort((p, q) => size(p) - size(q))) {
      if (views.every((view) => shared(view, box) <= 0.35 * Math.min(size(view), size(box)))) views.push(box);
    }
    if (views.length < 2 || views.length > MAX_VIEWS) continue;
    const spans = views.map(span);
    if (Math.min(...spans) < 0.6 * Math.max(...spans)) continue;
    // Every other thing sits within one of the views.
    const lane = (box: Box) => { const middle = start(box) + size(box) / 2; return views.some((view) => middle >= start(view) - 0.05 && middle <= start(view) + size(view) + 0.05); };
    if (boxes.every((box) => views.includes(box) || lane(box))) return true;
  }
  return false;
}

/**
 * Whether the things found are one subject: every box touches the next, in
 * one cluster no bigger than most of the photo - one figure the detector saw
 * as a head, a jacket and a pair of legs. A shelf of figures spreads over the
 * whole photo, or falls into several clusters.
 */
export function oneSubject(found: readonly Box[]): boolean {
  // Specks beside a subject - a glove, a glint, a hand - are not things of their own.
  const largest = Math.max(0, ...found.map(areaOf));
  const boxes = found.filter((box) => areaOf(box) >= SPECK * largest);
  if (boxes.length < 2) return boxes.length === 1;
  const parent = boxes.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  // Pieces of one figure - a head, a glove - often stop just short of each other.
  const near = (a: Box, b: Box) => a[0] - TOUCH <= b[0] + b[2] && b[0] - TOUCH <= a[0] + a[2] && a[1] - TOUCH <= b[1] + b[3] && b[1] - TOUCH <= a[1] + a[3];
  boxes.forEach((a, i) => boxes.forEach((b, j) => { if (j > i && near(a, b)) parent[root(i)] = root(j); }));
  if (new Set(boxes.map((_, index) => root(index))).size !== 1) return false;
  const x0 = Math.min(...boxes.map((box) => box[0])); const y0 = Math.min(...boxes.map((box) => box[1]));
  const x1 = Math.max(...boxes.map((box) => box[0] + box[2])); const y1 = Math.max(...boxes.map((box) => box[1] + box[3]));
  if ((x1 - x0) * (y1 - y0) > ONE_SUBJECT_AREA) return false;
  // Two whole figures side by side are two things, not the pieces of one.
  const whole = boxes.filter((box) => box[3] >= 0.75 * (y1 - y0) || box[2] >= 0.75 * (x1 - x0));
  return !whole.some((a, i) => whole.some((b, j) => j > i && insideOf(a, b) < 0.5 && insideOf(b, a) < 0.5));
}

/** A box under this share of the largest one's area is a speck beside it, for telling one subject. */
const SPECK = 0.15;
/** Boxes this close count as touching: the pieces of one thing seen apart. */
const TOUCH = 0.05;

/**
 * The separate subjects in a photo: boxes mostly inside one another - a
 * figure's head, its jacket, the figure - are one subject; boxes that only
 * touch, as packed boxes or figures on a shelf do, are each their own.
 * Specks too small to be a thing for sale are left out.
 */
export function subjectsOf(boxes: readonly Box[]): Box[] {
  const parent = boxes.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  boxes.forEach((a, i) => boxes.forEach((b, j) => {
    if (j > i && Math.max(insideOf(a, b), insideOf(b, a)) >= SAME_SUBJECT) parent[root(i)] = root(j);
  }));
  const groups = new Map<number, Box[]>();
  boxes.forEach((box, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), box]));
  return [...groups.values()].map((group) => {
    const x0 = Math.min(...group.map((box) => box[0])); const y0 = Math.min(...group.map((box) => box[1]));
    const x1 = Math.max(...group.map((box) => box[0] + box[2])); const y1 = Math.max(...group.map((box) => box[1] + box[3]));
    return [x0, y0, x1 - x0, y1 - y0] as Box;
  }).filter((subject) => areaOf(subject) >= MIN_SUBJECT);
}

/**
 * Whether a photo clearly shows several things: three or more separate
 * subjects of comparable size, spread across the photo, and not views of one thing side by
 * side. Anything less is one item, as the seller says - in doubt, one fee.
 * `boxes` are those in focus.
 */
export function clearlySeveral(boxes: readonly Box[], all: readonly Box[] = boxes): boolean {
  // A collage is read from everything in it: a softer panel is still one of its views.
  if (viewsLineup(all) || viewsLineup(boxes)) return false;
  // Comparable in size: a figure's spare heads and guns beside it in its
  // blister are accessories of one item, not things of their own.
  const found = subjectsOf(boxes);
  const largest = Math.max(0, ...found.map(areaOf));
  const subjects = found.filter((subject) => areaOf(subject) >= COMPARABLE * largest);
  if (subjects.length < SEVERAL) return false;
  const xs = subjects.map((box) => box[0] + box[2] / 2); const ys = subjects.map((box) => box[1] + box[3] / 2);
  return Math.max(...xs) - Math.min(...xs) >= SPREAD || Math.max(...ys) - Math.min(...ys) >= SPREAD;
}

/** A subject under this share of the largest one's area is an accessory beside it, not a thing of its own. */
const COMPARABLE = 0.25;
/** Once sure there are several, a subject this much of the largest one's area or more is one of them. */
const COUNTED = 0.1;
/** Subjects a photo must show, at least, to be charged as several things. */
export const SEVERAL = 3;
/** How far apart their middles must spread, across or down, as a share of the photo. */
const SPREAD = 0.4;
/** A box this much inside another is part of the same subject. */
const SAME_SUBJECT = 0.3;
/** A subject smaller than this share of the photo is a speck, not a thing for sale. */
const MIN_SUBJECT = 0.005;

/** One subject covers no more than this much of the photo: more is a shelf of things touching. */
const ONE_SUBJECT_AREA = 0.5;
/** A thing this much less sharp than the sharpest is the blurred background, not for sale. */
const BLUR_RATIO = 0.22;

/**
 * How sharp each box is: the strong end of the edges inside it. What is for
 * sale is what the camera focused on; a shelf, bags or a room behind it,
 * thrown out of focus, is soft.
 */
export function focusOf(rgba: ArrayLike<number>, width: number, height: number, boxes: readonly Box[]): number[] {
  const small = shrinkPixels(rgba, width, height, 640);
  const W = small.width; const H = small.height;
  const gray = new Float32Array(W * H);
  for (let i = 0; i < gray.length; i += 1) gray[i] = 0.299 * small.data[i * 4]! + 0.587 * small.data[i * 4 + 1]! + 0.114 * small.data[i * 4 + 2]!;
  return boxes.map(([bx, by, bw, bh]) => {
    const x0 = Math.max(1, Math.floor(bx * W)); const x1 = Math.min(W - 1, Math.ceil((bx + bw) * W));
    const y0 = Math.max(1, Math.floor(by * H)); const y1 = Math.min(H - 1, Math.ceil((by + bh) * H));
    const counts = new Uint32Array(256); let total = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * W + x;
        const lap = Math.abs(4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - W]! - gray[i + W]!);
        counts[Math.min(255, Math.round(lap))]! += 1; total += 1;
      }
    }
    // The 90th percentile: the box's sharpest tenth, so a sharp thing on a plain backdrop still counts sharp.
    let seen = 0;
    for (let level = 0; level < 256; level += 1) { seen += counts[level]!; if (seen >= total * 0.9) return level; }
    return 0;
  });
}

/** The boxes in focus: those not far softer than the sharpest. */
export function inFocus<T extends Box>(boxes: readonly T[], focus: readonly number[], ratio = BLUR_RATIO): T[] {
  const sharpest = Math.max(0, ...focus);
  if (sharpest <= 0) return [...boxes];
  return boxes.filter((_, index) => (focus[index] ?? 0) >= ratio * sharpest);
}

/**
 * Sharp enough to be charged for: near as sharp as what the camera focused
 * on. Stricter than `inFocus` - a half-blurred bag behind a figure held up to
 * the camera is not clearly a thing for sale.
 */
export const SHARP_RATIO = 0.4;


/* ── The title, and the verdict ──────────────────────────────────────── */

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


/* ── One reading ──────────────────────────────────────────────────────── */

export interface ScanInput {
  /** Every place found in the photo, by any detector, as boxes over it. */
  boxes: readonly Box[];
  /** How sharp each box is (focusOf), when the pixels could be read. */
  focus?: readonly number[] | null;
  /** Whether two places show the same thing - copies, or one thing twice - when the pixels can tell. */
  sameKind?: ((a: Box, b: Box) => boolean) | null;
}

export interface PhotoScan {
  analysis: PhotoAnalysis;
  /** The separate subjects it is sure of, when it is sure there are several. */
  subjects: Box[];
  model: string;
}

/**
 * Read a photo: what it holds, from the places found in it. The one entry
 * point - the sell form, the fee and anything else that needs to know what a
 * photo shows ask this.
 */
export function scanPhoto({ boxes, focus = null, sameKind = null }: ScanInput): PhotoScan {
  const unique: Box[] = [];
  for (const box of boxes) if (!unique.some((other) => samePlace(other, box))) unique.push(box);
  // The blurred background - a room, a shelf behind - is not what is for sale;
  // and only what is near as sharp as the subject counts towards several things.
  const places = focus ? inFocus(unique, focus) : unique;
  const sharp = focus ? inFocus(unique, focus, SHARP_RATIO) : unique;
  if (!clearlySeveral(sharp, places)) {
    const one = Math.min(1, places.length);
    return { analysis: { found: one, kinds: one, largest: one, lineup: viewsLineup(places), several: false }, subjects: [], model: SCAN_MODEL };
  }
  // Sure there are several: each subject counts, but for specks beside the largest.
  const found = subjectsOf(sharp);
  const largest = Math.max(0, ...found.map(areaOf));
  const subjects = found.filter((subject) => areaOf(subject) >= COUNTED * largest);
  // Grouped by what they show, each against the first of each group, so likeness does not chain across a shelf.
  const groups: Box[][] = [];
  for (const subject of subjects) {
    const home = sameKind ? groups.find((group) => sameKind(group[0]!, subject)) : undefined;
    if (home) home.push(subject); else groups.push([subject]);
  }
  return {
    analysis: { found: subjects.length, kinds: groups.length, largest: Math.max(0, ...groups.map((group) => group.length)), lineup: false, several: true },
    subjects,
    model: SCAN_MODEL,
  };
}

/** Two boxes round the same place. */
function samePlace(a: Box, b: Box): boolean {
  const shared = overlapArea(a, b);
  return shared / (areaOf(a) + areaOf(b) - shared || 1) >= 0.5;
}
