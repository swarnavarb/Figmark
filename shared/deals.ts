/**
 * Private deals are short. A price made for one buyer in a chat is an answer
 * to that conversation, not a standing offer - so every deal has a clock,
 * two hours unless the shop says otherwise, and never more than a day.
 */
export const DEAL_DEFAULT_HOURS = 2;
export const DEAL_MAX_HOURS = 24;
/** The shortest clock worth setting: long enough to get to checkout. */
export const DEAL_MIN_MINUTES = 15;
/** What the deal form offers, in hours. */
export const DEAL_HOUR_CHOICES = [0.5, 1, 2, 4, 6, 12, 24] as const;

/**
 * When a deal made now ends: what was asked for, held between a quarter of an
 * hour and a day, or the default when nothing sensible was asked.
 */
export function dealEndsAt(asked: string | null | undefined, now = Date.now()): string {
  const at = asked ? Date.parse(asked) : Number.NaN;
  const end = Number.isNaN(at) ? now + DEAL_DEFAULT_HOURS * 3_600_000 : at;
  const clamped = Math.min(now + DEAL_MAX_HOURS * 3_600_000, Math.max(now + DEAL_MIN_MINUTES * 60_000, end));
  return new Date(clamped).toISOString();
}

/** Where a deal, or an item talked about in a chat, stands right now. */
export type DealState = 'live' | 'bought' | 'expired' | 'gone';
