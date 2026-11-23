import { MIN_SHOPS, type CoachLog, type CoachStats } from './coach-log.js';

/**
 * The coach getting better on its own, from what it has measured.
 *
 * Two things move, and both only on evidence:
 *
 * - **Tip order.** A kind of tip that shops act on and that is followed by
 *   more orders, or by the problem being sorted, climbs; one that is not,
 *   sinks. Read only from the anonymous staff totals (coach-log.ts), only for
 *   kinds with at least `MIN_SHOPS` shops behind them, and the nudge grows with
 *   the evidence, so a few lucky weeks cannot reorder anybody's coach. Money
 *   waiting on a shop always stays on top.
 * - **Which answer Figgy gives.** When a question matches several guides, the
 *   ones sellers marked helpful win. Questions Figgy could not answer are
 *   counted by word, for staff to see what guide to write next.
 *
 * And for one shop, from its own log only: a kind of tip it keeps skipping
 * drops down its list, so the coach stops nagging and the next thing gets a
 * turn. It comes back up as soon as it is acted on.
 *
 * Nothing here is shown to a seller as a number. A seller sees the order of
 * their own tips, never another shop's figures.
 */

/** Never moved: money waiting on the shop, and a shop that cannot sell at all. */
export const PROTECTED_RULES: readonly string[] = ['answer', 'payment', 'first'];
/** No learned order may lift a tip above this: the protected ones sit at 92 and over. */
export const LEARNED_CEILING = 89;
/** The most the shared evidence moves a kind of tip, either way. */
export const MAX_NUDGE = 15;
/** Weeks of results at which a kind's nudge reaches its full size. */
export const FULL_WEIGHT_EPISODES = 200;
/** Each side - acted on, skipped - needs at least this many results before its comparison counts. */
export const MIN_SIDE = 10;
/** How far back a shop's own skips count. */
export const FATIGUE_DAYS = 60;
/** How far one skip after the first moves a tip down for that shop, and the most it can. */
export const FATIGUE_STEP = 8;
export const FATIGUE_MAX = 24;

const DAY_MS = 86_400_000;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** How far each kind of tip moves for every shop, from the shared totals. */
export function ruleNudges(stats: CoachStats | null): Record<string, number> {
  const nudges: Record<string, number> = {};
  if (!stats) return nudges;
  for (const [rule, totals] of Object.entries(stats.rules)) {
    if (PROTECTED_RULES.includes(rule) || totals.shops < MIN_SHOPS) continue;
    const pressed = totals.pressed;
    const ignored = totals.episodes - pressed;
    if (pressed < MIN_SIDE || ignored < MIN_SIDE) continue;
    // Orders a week, the week after against the week before: acted on minus skipped.
    const lift = (totals.pressedSalesAfter - totals.pressedSalesBefore) / pressed
      - (totals.ignoredSalesAfter - totals.ignoredSalesBefore) / ignored;
    // How much more often the thing it pointed at got sorted when it was acted on.
    const sorted = totals.pressedCleared / pressed - (totals.cleared - totals.pressedCleared) / ignored;
    const score = 0.6 * clamp(lift / 2, -1, 1) + 0.4 * clamp(sorted * 2, -1, 1);
    const confidence = Math.min(1, totals.episodes / FULL_WEIGHT_EPISODES);
    const nudge = Math.round(score * confidence * MAX_NUDGE);
    if (nudge !== 0) nudges[rule] = nudge;
  }
  return nudges;
}

/** How far each kind of tip moves down for this shop, from the times it was shown and skipped. */
export function shopFatigue(log: CoachLog | null | undefined, now: Date): Record<string, number> {
  const since = now.getTime() - FATIGUE_DAYS * DAY_MS;
  const skips: Record<string, number> = {};
  const acted = new Set<string>();
  for (const entry of log?.episodes ?? []) {
    if (!entry.outcome || Date.parse(entry.firstSeen) < since) continue;
    if (entry.outcome.pressed) acted.add(entry.rule);
    else if (!entry.outcome.cleared) skips[entry.rule] = (skips[entry.rule] ?? 0) + 1;
  }
  const fatigue: Record<string, number> = {};
  for (const [rule, count] of Object.entries(skips)) {
    // Acting on it lately says it is still wanted; the first skip is free.
    if (acted.has(rule) || PROTECTED_RULES.includes(rule) || count < 2) continue;
    fatigue[rule] = Math.min(FATIGUE_MAX, FATIGUE_STEP * (count - 1));
  }
  return fatigue;
}

/** The tips with what has been learned applied, best first. Protected tips keep their place. */
export function applyLearning<T extends { id: string; priority: number }>(
  tips: readonly T[], nudges: Record<string, number>, fatigue: Record<string, number>,
): T[] {
  return tips
    .map((tip, index) => {
      const rule = tip.id.split(':')[0]!;
      if (PROTECTED_RULES.includes(rule)) return { tip, index };
      const moved = tip.priority + (nudges[rule] ?? 0) - (fatigue[rule] ?? 0);
      return { tip: { ...tip, priority: Math.min(LEARNED_CEILING, Math.max(1, moved)) }, index };
    })
    .sort((a, b) => b.tip.priority - a.tip.priority || a.index - b.index)
    .map((entry) => entry.tip);
}

/* ── Figgy's answers ───────────────────────────────────────────────────── */

export interface AnswerTotals {
  /** Different shops that rated this kind of answer. */
  shops: number;
  up: number;
  down: number;
}

export interface MissTotals {
  shops: number;
  asked: number;
}

/** Ratings per kind of answer, and the words of questions nobody had an answer for. Totals only. */
export interface AnswerStats {
  since: string;
  sources: Record<string, AnswerTotals>;
  misses: Record<string, MissTotals>;
}

export const ANSWER_STATS_ID = 'coach-answers';
/** Ratings a kind of answer needs before they change which guide wins. */
export const MIN_RATINGS = 10;
/** Most ratings one shop can give in a day: enough for honest use, too few to steer anything alone. */
export const DAILY_RATINGS = 30;
const MISS_WORDS = 6;
const COUNTED_MAX = 400;

/** How much each guide's match counts, 0.6-1.4, from how helpful sellers found it. */
export function guideWeights(stats: AnswerStats | null): Record<string, number> {
  const weights: Record<string, number> = {};
  if (!stats) return weights;
  for (const [source, totals] of Object.entries(stats.sources)) {
    if (totals.shops < MIN_SHOPS || totals.up + totals.down < MIN_RATINGS) continue;
    // Pulled toward even until there are plenty of ratings.
    const rate = (totals.up + 2) / (totals.up + totals.down + 4);
    weights[source] = Math.round((0.6 + 0.8 * rate) * 100) / 100;
  }
  return weights;
}

const STOP = new Set(('the and for are but not you your yours with this that what when where which who whom how why can could '
  + 'should would will shall may might must have has had does did doing done from into onto about over under than then them they '
  + 'their there here our ours its it\'s i\'m im ive dont cant wont been being some any all more most much many very just also only '
  + 'get got make made want need like know tell help please thanks thank shop item items sell selling seller figmark').split(' '));

/** The words of an unanswered question worth counting: no numbers, no short words, no filler. The question itself is not kept. */
export function missWords(question: string): string[] {
  const words = question.toLowerCase().replace(/[^a-z\s]+/g, ' ').split(/\s+/)
    .filter((word) => word.length >= 3 && word.length <= 20 && !STOP.has(word));
  return [...new Set(words)].slice(0, MISS_WORDS);
}

export interface AnswerLog {
  /** Kinds of answer this shop is already counted in among `shops`. */
  rated: string[];
  /** Words this shop is already counted in among a miss's `shops`. */
  missed: string[];
  /** Ratings given today, to cap them. */
  day: string;
  today: number;
}

export const emptyAnswerLog = (): AnswerLog => ({ rated: [], missed: [], day: '', today: 0 });

/** Adds one rating to the totals. Null when the shop has used up today's ratings. */
export function addRating(
  stats: AnswerStats | null, log: AnswerLog, source: string, helpful: boolean, now: Date,
): { stats: AnswerStats; log: AnswerLog } | null {
  const day = now.toISOString().slice(0, 10);
  const today = log.day === day ? log.today : 0;
  if (today >= DAILY_RATINGS) return null;
  const next = copy(stats, now);
  const totals = next.sources[source] ??= { shops: 0, up: 0, down: 0 };
  const rated = new Set(log.rated);
  if (!rated.has(source)) { totals.shops += 1; rated.add(source); }
  if (helpful) totals.up += 1; else totals.down += 1;
  return { stats: next, log: { ...log, rated: [...rated].slice(-COUNTED_MAX), day, today: today + 1 } };
}

/** Adds an unanswered question's words to the totals. */
export function addMiss(stats: AnswerStats | null, log: AnswerLog, words: readonly string[], now: Date): { stats: AnswerStats; log: AnswerLog } {
  const next = copy(stats, now);
  const missed = new Set(log.missed);
  for (const word of words) {
    const totals = next.misses[word] ??= { shops: 0, asked: 0 };
    if (!missed.has(word)) { totals.shops += 1; missed.add(word); }
    totals.asked += 1;
  }
  return { stats: next, log: { ...log, missed: [...missed].slice(-COUNTED_MAX) } };
}

function copy(stats: AnswerStats | null, now: Date): AnswerStats {
  return stats
    ? {
      since: stats.since,
      sources: Object.fromEntries(Object.entries(stats.sources).map(([key, value]) => [key, { ...value }])),
      misses: Object.fromEntries(Object.entries(stats.misses).map(([key, value]) => [key, { ...value }])),
    }
    : { since: now.toISOString(), sources: {}, misses: {} };
}

export interface AnswerView {
  /** `label` is added by the staff route: the answer's name. */
  rows: { source: string; label?: string; shops: number; ratings: number; helpful: number; weight: number | null }[];
  /** Words from questions Figgy could not answer, asked by enough shops to show. */
  misses: { word: string; shops: number; asked: number }[];
  withheld: number;
}

/** The answer totals as staff see them: rounded, and only where enough shops stand behind them. */
export function answerView(stats: AnswerStats | null): AnswerView {
  if (!stats) return { rows: [], misses: [], withheld: 0 };
  const weights = guideWeights(stats);
  let withheld = 0;
  const rows: AnswerView['rows'] = [];
  for (const [source, totals] of Object.entries(stats.sources)) {
    if (totals.shops < MIN_SHOPS) { withheld += 1; continue; }
    const ratings = totals.up + totals.down;
    rows.push({ source, shops: totals.shops, ratings, helpful: Math.round((totals.up / ratings) * 100), weight: weights[source] ?? null });
  }
  const misses = Object.entries(stats.misses)
    .filter(([, totals]) => totals.shops >= MIN_SHOPS)
    .map(([word, totals]) => ({ word, shops: totals.shops, asked: totals.asked }))
    .sort((a, b) => b.shops - a.shops || b.asked - a.asked)
    .slice(0, 30);
  return { rows: rows.sort((a, b) => b.ratings - a.ratings), misses, withheld };
}
