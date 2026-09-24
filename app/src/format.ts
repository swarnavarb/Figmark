/** Money is stored in minor units throughout; only the UI converts. */
export function formatMoney(minor: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

export function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${grams} g`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "12th Sept 26" - the tracking timeline's own date, everywhere it appears. */
export function formatDateOrdinal(iso: string): string {
  const date = new Date(iso);
  const day = date.getDate();
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
    : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
  const month = date.toLocaleDateString('en-IN', { month: 'short' });
  const year = String(date.getFullYear()).slice(-2);
  return `${day}${suffix} ${month} ${year}`;
}

/** Whole days until `iso`, floored at zero. */
export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const steps: Array<[number, string]> = [
    [60, 'just now'],
    [3600, 'm'],
    [86400, 'h'],
    [2592000, 'd'],
  ];
  if (seconds < steps[0]![0]) return 'just now';
  if (seconds < steps[1]![0]) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < steps[2]![0]) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < steps[3]![0]) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(iso);
}

/**
 * A stable colour per id, so a listing or seller keeps the same placeholder
 * every time it renders.
 *
 * This used to be pinned to a 42-degree warm band on the theory that a grid of
 * unrelated hues reads as noise. In practice it meant every unphotographed
 * item in the catalogue was the same brown, so the one screen that is supposed
 * to sell looked like a wall of mud. The band is now the whole wheel, and what
 * keeps it from being noise is that saturation and lightness are fixed: the
 * hues differ, the weight does not, so the grid still reads as one set.
 */
/** FNV-1a. Cheap, and it actually avalanches, which the old `*31 % 4096` did not. */
function hash32(seed: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function hueFor(seed: string): number {
  // The fractional part of n times the golden ratio is equidistributed, so
  // ids land evenly right around the wheel. Multiplying by the golden angle
  // and taking it mod 360 instead - the obvious-looking version - clumps
  // badly: on the real catalogue it put four of eight items in green and
  // produced no warm hue at all.
  return ((hash32(seed) * 0.6180339887498949) % 1) * 360;
}

/**
 * The square an item without a photo gets.
 *
 * Two stops thirty degrees apart rather than one flat colour, lit from the
 * top left, so a grid of these reads as a set of objects under one light
 * rather than a set of swatches.
 */
export function gradientFor(seed: string): string {
  const hue = hueFor(seed);
  // Deep and saturated rather than bright. A placeholder is the backdrop an
  // item would have been photographed against, not the item: at full
  // brightness a grid of these is a wall of neon slabs competing with the
  // products, which is the opposite of the job. Dark enough that the
  // initials, the badge and the price all still read on top.
  return `linear-gradient(145deg, hsl(${hue} 58% 34%), hsl(${(hue + 34) % 360} 64% 19%))`;
}

/**
 * The six brand hues, for the places that should look like Figmark rather
 * than like a random colour: avatars, category nav, channel marks.
 *
 * Drawn from the palette instead of the wheel on purpose. An avatar in an
 * arbitrary hue is just a coloured circle; an avatar in one of six known hues
 * is part of an identity, and six is enough that a conversation list still
 * looks varied.
 */
export const BRAND_HUES = ['violet', 'coral', 'aqua', 'blue', 'pink', 'lime'] as const;
export type BrandHue = (typeof BRAND_HUES)[number];

export function brandHueFor(seed: string): BrandHue {
  return BRAND_HUES[hash32(seed) % BRAND_HUES.length]!;
}

export function initialsOf(name: string): string {
  // Punctuation-only words ("—", "·") are skipped: a title like
  // "Runner — UK 8.5" should read "RU", not "R—".
  const words = name.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  const initials = words.slice(0, 2).map((word) => word.replace(/[^a-z0-9]/gi, '')[0] ?? '');
  const joined = initials.join('').toUpperCase();
  // A single-word name gives one letter; take two from it so the tile balances.
  return joined.length === 1 ? (words[0] ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() : joined;
}
