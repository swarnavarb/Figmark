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
 * Constrained to a warm band around the accent rather than the full wheel:
 * a grid of unrelated hues reads as noise and fights the single-accent rule.
 * Saturation and lightness are fixed at the call site for the same reason.
 */
const HUE_START = 6;
const HUE_SPREAD = 42;

export function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 4096;
  return HUE_START + (hash % HUE_SPREAD);
}

export function gradientFor(seed: string): string {
  const hue = hueFor(seed);
  return `linear-gradient(140deg, hsl(${hue} 38% 30%), hsl(${hue + 14} 44% 17%))`;
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
