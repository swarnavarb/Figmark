import type { AnswerLog } from './coach-learn.js';

/**
 * Whether the coach's tips work.
 *
 * Each tip a shop is shown opens an episode: when it was first and last seen,
 * whether anybody on the shop pressed its button, and - a week later - what
 * happened. The outcome is read from rows the server already keeps with their
 * times (orders, and each item's daily views), so nothing is guessed and
 * nothing extra is asked of the seller.
 *
 * Two readers, kept apart on purpose:
 * - The shop sees its own episodes and nothing else (`ownResults`).
 * - Figmark's staff see totals per kind of tip across every shop
 *   (`CoachStats`), with no shop, person or item in them, and a kind of tip
 *   is only shown once enough different shops are in it that no one shop's
 *   figures can be read out of the total (`statsView`).
 *
 * Pure, so the route, the console and the tests count the same way.
 */

/** A week: long enough for a share or an offer to turn into orders, short enough to still be about the tip. */
export const OUTCOME_DAYS = 7;
/** Episodes kept per shop: about a quarter of tips, comfortably inside a document. */
export const LOG_MAX = 250;
/** Settled episodes older than this are dropped from the shop's own log. */
export const LOG_KEEP_DAYS = 120;
/** A kind of tip appears in the staff totals only once this many shops are in it. */
export const MIN_SHOPS = 5;
/** What the shop's own results look back over. */
export const RESULTS_DAYS = 90;

const DAY_MS = 86_400_000;

export interface CoachOutcome {
  at: string;
  pressed: boolean;
  /** The tip had stopped showing by the end of the week: what it pointed at was dealt with. */
  cleared: boolean;
  /** The shop's orders in the week before the tip was first seen, and the week after. */
  salesBefore: number;
  salesAfter: number;
  /** For a tip about one item: its views and units sold in the same two weeks. */
  itemViewsBefore: number | null;
  itemViewsAfter: number | null;
  itemSoldAfter: number | null;
}

export interface CoachEpisode {
  /** The kind of tip: `browsed`, `post`, `answer`... */
  rule: string;
  /** The item it was about, for a tip about one. */
  itemId: string | null;
  /** What the shop was shown, so its own results can name it. */
  title: string;
  firstSeen: string;
  lastSeen: string;
  pressedAt: string | null;
  outcome: CoachOutcome | null;
}

export interface CoachLog {
  episodes: CoachEpisode[];
  /** Kinds of tip this shop is already counted in among the staff totals' shops. */
  counted: string[];
  /** What this shop has rated of Figgy's answers, for counting shops once (coach-learn.ts). */
  answers?: AnswerLog;
}

export const emptyCoachLog = (): CoachLog => ({ episodes: [], counted: [] });

/** `browsed:l1` → `{ rule: 'browsed', itemId: 'l1' }`. */
export function splitTipId(tipId: string): { rule: string; itemId: string | null } {
  const at = tipId.indexOf(':');
  return at < 0 ? { rule: tipId, itemId: null } : { rule: tipId.slice(0, at), itemId: tipId.slice(at + 1) || null };
}

const day = (at: string) => at.slice(0, 10);

function openEpisode(log: CoachLog, rule: string, itemId: string | null): CoachEpisode | undefined {
  return log.episodes.find((entry) => !entry.outcome && entry.rule === rule && entry.itemId === itemId);
}

/**
 * The shop has been shown these tips. Opens an episode for each new one and
 * moves `lastSeen` on the rest - once a day at most, so looking at the coach
 * all afternoon is one write, not fifty.
 */
export function noteSeen(log: CoachLog, tips: readonly { id: string; title: string }[], now: Date): { log: CoachLog; changed: boolean } {
  const at = now.toISOString();
  let changed = false;
  const episodes = [...log.episodes];
  for (const tip of tips) {
    const { rule, itemId } = splitTipId(tip.id);
    const open = openEpisode({ ...log, episodes }, rule, itemId);
    if (!open) {
      episodes.push({ rule, itemId, title: tip.title.slice(0, 140), firstSeen: at, lastSeen: at, pressedAt: null, outcome: null });
      changed = true;
    } else if (day(open.lastSeen) !== day(at)) {
      episodes[episodes.indexOf(open)] = { ...open, lastSeen: at };
      changed = true;
    }
  }
  return { log: { ...log, episodes }, changed };
}

/** Somebody on the shop pressed the tip's button. The first press is the one that counts. */
export function notePressed(log: CoachLog, tip: { id: string; title: string }, now: Date): { log: CoachLog; changed: boolean } {
  const seen = noteSeen(log, [tip], now);
  const { rule, itemId } = splitTipId(tip.id);
  const open = openEpisode(seen.log, rule, itemId)!;
  if (open.pressedAt) return seen;
  const episodes = seen.log.episodes.map((entry) => (entry === open ? { ...entry, pressedAt: now.toISOString() } : entry));
  return { log: { ...seen.log, episodes }, changed: true };
}

/** What the route measures for an episode, from the shop's own timestamped rows. */
export type Measure = (episode: CoachEpisode, from: number, to: number) => {
  sales: number;
  itemViews: number | null;
  itemSold: number | null;
};

/**
 * Every episode whose week is over gets its outcome. Returns the episodes that
 * settled now, for the staff totals.
 */
export function settle(log: CoachLog, now: Date, measure: Measure): { log: CoachLog; settled: CoachEpisode[] } {
  const nowMs = now.getTime();
  const settled: CoachEpisode[] = [];
  const episodes = log.episodes.map((entry) => {
    if (entry.outcome) return entry;
    const start = Date.parse(entry.firstSeen);
    const end = start + OUTCOME_DAYS * DAY_MS;
    if (nowMs < end) return entry;
    const before = measure(entry, start - OUTCOME_DAYS * DAY_MS, start);
    const after = measure(entry, start, end);
    const done: CoachEpisode = {
      ...entry,
      outcome: {
        at: now.toISOString(),
        pressed: Boolean(entry.pressedAt && Date.parse(entry.pressedAt) < end),
        // Still showing on the last day of the week means it was not dealt with.
        cleared: Date.parse(entry.lastSeen) < end - DAY_MS,
        salesBefore: before.sales,
        salesAfter: after.sales,
        itemViewsBefore: before.itemViews,
        itemViewsAfter: after.itemViews,
        itemSoldAfter: after.itemSold,
      },
    };
    settled.push(done);
    return done;
  });
  return { log: { ...log, episodes }, settled };
}

/** The log trimmed to what is worth keeping. */
export function tidyCoachLog(log: CoachLog, now: Date): CoachLog {
  const cutoff = now.getTime() - LOG_KEEP_DAYS * DAY_MS;
  const kept = log.episodes.filter((entry) => !entry.outcome || Date.parse(entry.firstSeen) >= cutoff);
  return { ...log, episodes: kept.slice(-LOG_MAX), counted: [...new Set(log.counted)] };
}

/* ── The shop's own results ─────────────────────────────────────────────── */

export interface OwnResult {
  title: string;
  firstSeen: string;
  pressed: boolean;
  cleared: boolean;
  /** One plain sentence on what followed. */
  summary: string;
}

export interface OwnResults {
  /** Tips with a finished week in the window. */
  settled: number;
  /** Of those, how many the shop acted on. */
  acted: number;
  /** Orders in the week before and after the tips the shop acted on, summed. */
  actedSalesBefore: number;
  actedSalesAfter: number;
  /** The latest few, newest first. */
  recent: OwnResult[];
  /** Tips still inside their week. */
  watching: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summaryOf(episode: CoachEpisode): string {
  const outcome = episode.outcome!;
  const parts: string[] = [];
  if (outcome.itemViewsAfter !== null && outcome.itemViewsBefore !== null) {
    parts.push(`views ${outcome.itemViewsBefore} → ${outcome.itemViewsAfter}`);
  }
  if (outcome.itemSoldAfter !== null) parts.push(`${plural(outcome.itemSoldAfter, 'unit')} sold`);
  parts.push(`shop orders ${outcome.salesBefore} → ${outcome.salesAfter}`);
  return `One week later: ${parts.join(', ')}.`;
}

/** What the coach's tips did for this shop, from its own log only. */
export function ownResults(log: CoachLog, now: Date): OwnResults {
  const since = now.getTime() - RESULTS_DAYS * DAY_MS;
  const settled = log.episodes.filter((entry) => entry.outcome && Date.parse(entry.firstSeen) >= since);
  const acted = settled.filter((entry) => entry.outcome!.pressed);
  return {
    settled: settled.length,
    acted: acted.length,
    actedSalesBefore: acted.reduce((sum, entry) => sum + entry.outcome!.salesBefore, 0),
    actedSalesAfter: acted.reduce((sum, entry) => sum + entry.outcome!.salesAfter, 0),
    recent: [...settled].sort((a, b) => b.firstSeen.localeCompare(a.firstSeen)).slice(0, 6).map((entry) => ({
      title: entry.title,
      firstSeen: entry.firstSeen,
      pressed: entry.outcome!.pressed,
      cleared: entry.outcome!.cleared,
      summary: summaryOf(entry),
    })),
    watching: log.episodes.filter((entry) => !entry.outcome).length,
  };
}

/* ── Staff totals: per kind of tip, never per shop ─────────────────────── */

export interface RuleTotals {
  /** Different shops with at least one finished week of this tip. */
  shops: number;
  episodes: number;
  pressed: number;
  cleared: number;
  pressedCleared: number;
  /** Orders the week before and after, split by whether the tip was acted on. */
  pressedSalesBefore: number;
  pressedSalesAfter: number;
  ignoredSalesBefore: number;
  ignoredSalesAfter: number;
}

export interface CoachStats {
  since: string;
  rules: Record<string, RuleTotals>;
}

export const COACH_STATS_ID = 'coach-stats';

const emptyTotals = (): RuleTotals => ({
  shops: 0, episodes: 0, pressed: 0, cleared: 0, pressedCleared: 0,
  pressedSalesBefore: 0, pressedSalesAfter: 0, ignoredSalesBefore: 0, ignoredSalesAfter: 0,
});

/**
 * Adds a shop's newly settled episodes to the totals. Only sums go in: no
 * shop id, no item, no title. Returns the shop's log with the kinds it is now
 * counted in, so each shop adds to `shops` once per kind.
 */
export function addToStats(stats: CoachStats | null, settled: readonly CoachEpisode[], log: CoachLog, now: Date): { stats: CoachStats; log: CoachLog } {
  const next: CoachStats = stats
    ? { since: stats.since, rules: Object.fromEntries(Object.entries(stats.rules).map(([key, value]) => [key, { ...value }])) }
    : { since: now.toISOString(), rules: {} };
  const counted = new Set(log.counted);
  for (const episode of settled) {
    const outcome = episode.outcome;
    if (!outcome) continue;
    const totals = next.rules[episode.rule] ??= emptyTotals();
    if (!counted.has(episode.rule)) { totals.shops += 1; counted.add(episode.rule); }
    totals.episodes += 1;
    if (outcome.cleared) totals.cleared += 1;
    if (outcome.pressed) {
      totals.pressed += 1;
      if (outcome.cleared) totals.pressedCleared += 1;
      totals.pressedSalesBefore += outcome.salesBefore;
      totals.pressedSalesAfter += outcome.salesAfter;
    } else {
      totals.ignoredSalesBefore += outcome.salesBefore;
      totals.ignoredSalesAfter += outcome.salesAfter;
    }
  }
  return { stats: next, log: { ...log, counted: [...counted] } };
}

/** Plain names for the kinds of tip, for the staff screen. */
export const RULE_LABELS: Record<string, string> = {
  answer: 'Orders waiting for an answer',
  payment: 'Add payment details',
  first: 'Put the first item on sale',
  nolot: 'Import orders not in a shipment',
  importsnolot: 'Imports on sale with no shipment',
  ending: 'Item ending soon',
  browsed: 'Much-viewed item, no sale',
  slump: 'Sales down on last month',
  low: 'Item nearly out',
  unseen: 'Item nobody opens',
  drafts: 'Unfinished drafts',
  thin: 'Listing short on photos or words',
  post: 'No channel post this week',
  share: 'No share this week',
  fresh: 'No new item this week',
  affiliate: 'Pay sharers a commission',
  best: 'Share the best seller',
  engage: 'Run a poll or game',
  repeat: 'Bring delivered buyers back',
  cancels: 'Many cancellations',
  setup: 'Finish the shop page',
};

export interface StatsRow {
  rule: string;
  label: string;
  shops: number;
  episodes: number;
  /** Whole percentages. */
  pressRate: number;
  clearedIfPressed: number | null;
  clearedIfIgnored: number | null;
  /** Average change in a shop's weekly orders, one decimal, for acted-on and ignored tips. */
  liftIfPressed: number | null;
  liftIfIgnored: number | null;
}

export interface StatsView {
  since: string | null;
  rows: StatsRow[];
  /** Kinds of tip with some data but too few shops to show. */
  withheld: number;
  minShops: number;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);
const avg = (after: number, before: number, count: number) => (count > 0 ? Math.round(((after - before) / count) * 10) / 10 : null);

/** The totals as the staff screen shows them: rounded, and only where enough shops stand behind them. */
export function statsView(stats: CoachStats | null): StatsView {
  if (!stats) return { since: null, rows: [], withheld: 0, minShops: MIN_SHOPS };
  const rows: StatsRow[] = [];
  let withheld = 0;
  for (const [rule, totals] of Object.entries(stats.rules)) {
    if (totals.shops < MIN_SHOPS) { withheld += 1; continue; }
    const ignored = totals.episodes - totals.pressed;
    rows.push({
      rule,
      label: RULE_LABELS[rule] ?? rule,
      shops: totals.shops,
      episodes: totals.episodes,
      pressRate: pct(totals.pressed, totals.episodes) ?? 0,
      clearedIfPressed: pct(totals.pressedCleared, totals.pressed),
      clearedIfIgnored: pct(totals.cleared - totals.pressedCleared, ignored),
      liftIfPressed: avg(totals.pressedSalesAfter, totals.pressedSalesBefore, totals.pressed),
      liftIfIgnored: avg(totals.ignoredSalesAfter, totals.ignoredSalesBefore, ignored),
    });
  }
  rows.sort((a, b) => b.episodes - a.episodes);
  return { since: stats.since, rows, withheld, minShops: MIN_SHOPS };
}
