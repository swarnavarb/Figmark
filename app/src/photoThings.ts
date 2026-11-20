import type { PhotoBox } from './api';

/**
 * Which of an object detector's boxes are things a shopper would buy.
 *
 * The detector (photoDetect.ts) knows everyday things, not toys: a figure it
 * reads as a person, and a boxed or carded toy - flat, printed, rectangular -
 * as a book. Both are what a collector's photo is full of. From its raw boxes
 * this keeps:
 *
 * - each package, once: the card a blister sits on, not the blister and the
 *   card as two, and never a box drawn round several packages at once;
 * - each loose figure, but not the figures inside a package or printed on it
 *   - the package is the thing for sale - while a figure standing in front of
 *   a box, its feet past the box's edge, is its own thing;
 * - anything else it draws a box round, whatever it calls it: a figure
 *   standing straight is often skis to it, Mickey a dog;
 *
 * and drops what covers most of the photo (the shelf, the wall) or is a speck.
 * Pure, so it can be tried on detections without a browser.
 */
export interface Detected {
  /** What the detector called it: "person", "book", "teddy bear"... */
  label: string;
  score: number;
  /** Left, top, width, height, as fractions of the photo. */
  box: PhotoBox;
}

/** Likely enough for a figure or a package; anything else has to be surer. */
const MIN_LIKELY = 0.1;
const MIN_OTHER = 0.12;
const FIGURE = new Set(['person', 'teddy bear']);
const PACKAGE = new Set(['book']);
/**
 * What the detector names a toy is often wrong - a figure standing straight
 * is skis or a tie to it, Mickey a dog - but where it is is right. So any
 * name will do, except the things a photo of a shelf is taken in front of.
 */
const SCENERY = new Set(['dining table', 'bed', 'couch', 'chair', 'bench', 'tv', 'refrigerator', 'oven', 'sink', 'toilet', 'car', 'bus', 'truck', 'train', 'airplane', 'boat', 'traffic light', 'stop sign', 'parking meter', 'fire hydrant']);
/** A box over this much of the photo is the shelf or the wall, not a thing on it. */
const MAX_AREA = 0.5;
/** Under this much of it, a speck. */
const MIN_AREA = 0.004;
/** At most this many things are offered. */
export const MAX_THINGS = 20;

const areaOf = (box: PhotoBox) => box[2] * box[3];

/** How much of `inner` lies inside `outer`, 0 to 1. */
function inside(inner: PhotoBox, outer: PhotoBox): number {
  const w = Math.min(inner[0] + inner[2], outer[0] + outer[2]) - Math.max(inner[0], outer[0]);
  const h = Math.min(inner[1] + inner[3], outer[1] + outer[3]) - Math.max(inner[1], outer[1]);
  return w > 0 && h > 0 ? (w * h) / areaOf(inner) : 0;
}

/** Shared area over combined area, 0 to 1. */
function sameness(a: PhotoBox, b: PhotoBox): number {
  const shared = inside(a, b) * areaOf(a);
  return shared / (areaOf(a) + areaOf(b) - shared);
}

export function thingsIn(detections: Detected[]): PhotoBox[] {
  const usable = detections.filter(({ label, score, box }) =>
    !SCENERY.has(label)
    && score >= (FIGURE.has(label) || PACKAGE.has(label) ? MIN_LIKELY : MIN_OTHER)
    && areaOf(box) <= MAX_AREA && areaOf(box) >= MIN_AREA);

  // Packages, smallest first, so a card is seen after the blister on it.
  const packages: Detected[] = [];
  for (const candidate of usable.filter((d) => PACKAGE.has(d.label)).sort((a, b) => areaOf(a.box) - areaOf(b.box))) {
    const within = packages.filter((kept) => inside(kept.box, candidate.box) >= 0.8);
    // Round several packages at once: a group, not a thing.
    if (within.length >= 2) continue;
    // Round one: the blister was found first; the card it sits on is the package.
    if (within.length === 1) packages.splice(packages.indexOf(within[0]!), 1);
    packages.push(candidate);
  }

  // Figures not inside a package: in it, or printed on it, they are the package.
  const figures = usable
    .filter((d) => !PACKAGE.has(d.label))
    .filter((d) => !packages.some((pack) => inside(d.box, pack.box) >= 0.95))
    .sort((a, b) => b.score - a.score);
  const loose: Detected[] = [];
  for (const figure of figures) {
    // A torso found inside its own whole figure is that figure found twice;
    // a figure standing behind another shares less of its box, and stays.
    // Two boxes round mostly the same pixels are one figure seen from two views.
    if (loose.some((kept) => inside(figure.box, kept.box) >= 0.8 || inside(kept.box, figure.box) >= 0.8
      || sameness(figure.box, kept.box) >= 0.5)) continue;
    loose.push(figure);
  }

  // Most prominent first - sure of, and large - which is the order the strip
  // shows them in, and the first is the one searched with when the photo
  // comes in: the big box or the figure in front, not a face printed on a box.
  const prominence = ({ score, box }: Detected) => score * Math.sqrt(areaOf(box));
  return [...packages, ...loose]
    .sort((a, b) => prominence(b) - prominence(a))
    .slice(0, MAX_THINGS)
    .map(({ box }) => box.map((part) => Math.round(part * 1000) / 1000) as PhotoBox);
}
