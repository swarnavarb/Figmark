import type { StoreGrowthState } from './models.js';
import { TASK_XP, monthKey, weekKey } from './quest.js';

/**
 * A shop's growth quests, as rules.
 *
 * A buyer plays for cards; a shop plays for buyers. So these pay in the one
 * thing a shop actually wants more of - reach. Every quest collected pays a
 * Spotlight: one tap that puts an item back at the top of the feed, without
 * waiting out the usual bump limit. XP comes along on the shop's level, at the buyers' rates.
 *
 * Every quest is about bringing people in from outside: sharing the shop,
 * visits that arrive through shared links, items that pay whoever shares them,
 * and a sale one of those sharers made. Like the buyers' game, nothing is
 * counted from a number somebody wrote - only from rows the server recorded.
 */

export type GrowthKind = 'weekly' | 'monthly';

export interface GrowthFacts {
  /** Times somebody on the shop sent the shop or an item out of the app. */
  shares: { at: string }[];
  /** Visitors who arrived through a shared link to the shop or its items. */
  opens: { at: string }[];
  /** Posts in the shop's channel. */
  posts: { at: string }[];
  /** Live items paying a commission to whoever shares them. */
  affiliateItems: number;
  /** Placed orders that came through somebody's link. */
  affiliateSales: { at: string }[];
  /** The fullest live pre-order, 0-1. */
  bestFill: number;
}

export interface GrowthTask {
  id: string;
  kind: GrowthKind;
  title: string;
  blurb: string;
  progress: number;
  goal: number;
  done: boolean;
  claimed: boolean;
  claimable: boolean;
  /** Spotlights it pays. */
  spotlights: number;
  xp: number;
  /** What to press to work on it, in the app's own terms. */
  action: 'share_shop' | 'share_item' | 'post' | 'affiliate' | 'preorder' | null;
}

export interface GrowthView {
  tasks: GrowthTask[];
  spotlights: number;
  /** XP the claimed quests are worth on the shop's level. */
  xp: number;
  /** This week's numbers, for the header. */
  week: { shares: number; opens: number; affiliateSales: number };
}

interface Def {
  key: string;
  kind: GrowthKind;
  title: string;
  blurb: string;
  goal: number;
  action: GrowthTask['action'];
  /** Counted from stamps inside the period, or read off how the shop stands now. */
  measure: (facts: GrowthFacts, inPeriod: (at: string) => boolean) => number;
}

const SPOTLIGHTS: Record<GrowthKind, number> = { weekly: 1, monthly: 2 };

const DEFS: readonly Def[] = [
  { key: 'share2', kind: 'weekly', title: 'Share your shop twice',
    blurb: 'Send your shop or a drop to WhatsApp, a story or a group - twice this week.',
    goal: 2, action: 'share_shop', measure: (f, inPeriod) => f.shares.filter((s) => inPeriod(s.at)).length },
  { key: 'visits5', kind: 'weekly', title: 'Five visitors from shared links',
    blurb: 'Five people open a link to your shop or items this week - yours or anybody\'s.',
    goal: 5, action: 'share_item', measure: (f, inPeriod) => f.opens.filter((o) => inPeriod(o.at)).length },
  { key: 'post2', kind: 'weekly', title: 'Post two drops',
    blurb: 'Two posts in your channel this week, so followers have something to pass on.',
    goal: 2, action: 'post', measure: (f, inPeriod) => f.posts.filter((p) => inPeriod(p.at)).length },
  { key: 'affiliate3', kind: 'weekly', title: 'Pay sharers on three items',
    blurb: 'Keep a commission on three live items, so buyers earn by sharing them.',
    goal: 3, action: 'affiliate', measure: (f) => f.affiliateItems },
  { key: 'affsale1', kind: 'monthly', title: 'A sale a sharer made',
    blurb: 'Somebody buys through another person\'s link this month.',
    goal: 1, action: 'affiliate', measure: (f, inPeriod) => f.affiliateSales.filter((s) => inPeriod(s.at)).length },
  { key: 'visits25', kind: 'monthly', title: 'Twenty-five visitors from shared links',
    blurb: 'Twenty-five people arrive through shared links this month.',
    goal: 25, action: 'share_shop', measure: (f, inPeriod) => f.opens.filter((o) => inPeriod(o.at)).length },
  { key: 'fill60', kind: 'monthly', title: 'Fill a pre-order past 60%',
    blurb: 'Share a pre-order until it is more than half full. Pre-orders travel on WhatsApp.',
    goal: 60, action: 'preorder', measure: (f) => Math.round(f.bestFill * 100) },
];

function periodOf(kind: GrowthKind, now: number): string {
  return kind === 'weekly' ? weekKey(now) : monthKey(now);
}

function inPeriodOf(kind: GrowthKind, now: number): (at: string) => boolean {
  const period = periodOf(kind, now);
  return kind === 'weekly' ? (at) => weekKey(at) === period : (at) => monthKey(at) === period;
}

export function emptyGrowth(): StoreGrowthState {
  return { claimed: {}, spotlights: 0 };
}

/** XP a claimed growth quest is worth, whenever it was claimed. */
function claimXp(key: string): number {
  const def = DEFS.find((entry) => `${entry.kind}-${entry.key}` === key.split(':')[0]);
  return def ? TASK_XP[def.kind] : 0;
}

export function growthXp(state: StoreGrowthState | undefined): number {
  return Object.keys(state?.claimed ?? {}).reduce((sum, key) => sum + claimXp(key), 0);
}

export function growthView(facts: GrowthFacts, stored: StoreGrowthState | undefined, now: number = Date.now()): GrowthView {
  const state = stored ?? emptyGrowth();
  const tasks = DEFS.map((def): GrowthTask => {
    const id = `${def.kind}-${def.key}`;
    const progress = Math.min(def.goal, def.measure(facts, inPeriodOf(def.kind, now)));
    const done = progress >= def.goal;
    const claimed = Boolean(state.claimed[`${id}:${periodOf(def.kind, now)}`]);
    return {
      id, kind: def.kind, title: def.title, blurb: def.blurb, progress, goal: def.goal,
      done, claimed, claimable: done && !claimed,
      spotlights: SPOTLIGHTS[def.kind], xp: TASK_XP[def.kind], action: def.action,
    };
  });
  const thisWeek = inPeriodOf('weekly', now);
  return {
    tasks,
    spotlights: state.spotlights,
    xp: growthXp(state),
    week: {
      shares: facts.shares.filter((s) => thisWeek(s.at)).length,
      opens: facts.opens.filter((o) => thisWeek(o.at)).length,
      affiliateSales: facts.affiliateSales.filter((s) => thisWeek(s.at)).length,
    },
  };
}

/**
 * Collects a quest's reward, or says why not. Returns the new state; the
 * caller saves it. Claiming twice in one period is refused, not paid twice.
 */
export function claimGrowth(
  facts: GrowthFacts, stored: StoreGrowthState | undefined, taskId: string, now: number = Date.now(),
): { state: StoreGrowthState; task: GrowthTask } | { refusal: string } {
  const state = stored ?? emptyGrowth();
  const task = growthView(facts, state, now).tasks.find((entry) => entry.id === taskId);
  if (!task) return { refusal: 'There is no such quest.' };
  if (task.claimed) return { refusal: 'Already collected for this period.' };
  if (!task.done) return { refusal: 'Not done yet.' };
  return {
    task,
    state: {
      ...state,
      claimed: { ...state.claimed, [`${task.id}:${periodOf(task.kind, now)}`]: new Date(now).toISOString() },
      spotlights: state.spotlights + task.spotlights,
    },
  };
}

/** Keeps the growth lists a size a user document carries easily. */
export function tidyGrowth(state: StoreGrowthState): StoreGrowthState {
  return {
    ...state,
    shares: (state.shares ?? []).slice(-300),
    opens: (state.opens ?? []).slice(-500),
    spotlightLog: (state.spotlightLog ?? []).slice(-100),
  };
}
