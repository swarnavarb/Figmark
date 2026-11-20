/**
 * Things a person keeps for a while and then lets go of: a hunt on the Wanted
 * board, a follow on a Product DNA. The person picks how long, up to three
 * months, and once that time is up the thing is deleted - not hidden, deleted,
 * with whatever hangs off it.
 */

/** The longest anything timed may run. */
export const MAX_TIMED_DAYS = 90;

/** What a picker offers. */
export const TIMED_CHOICES: readonly { days: number; label: string }[] = [
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 60, label: '2 months' },
  { days: 90, label: '3 months' },
];

export const DEFAULT_TIMED_DAYS = 30;

/** A whole number of days from 1 to the maximum, or null when it is not one. */
export function timedDays(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= 1 && value <= MAX_TIMED_DAYS ? value : null;
}

/** When something started now and kept `days` days ends. */
export function timedUntil(days: number, now = Date.now()): string {
  return new Date(now + days * 86_400_000).toISOString();
}

/** "ends today", "1 day left", "12 days left". */
export function timeLeft(untilIso: string, now = Date.now()): string {
  const days = Math.ceil((Date.parse(untilIso) - now) / 86_400_000);
  if (days <= 0) return 'ends today';
  return days === 1 ? '1 day left' : `${days} days left`;
}
