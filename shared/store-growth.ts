import type { StoreGrowthState } from './models.js';
import { BUMPS_FOR, TASK_XP, TIER_XP, dayKey, monthKey, weekKey } from './quest.js';
import type { StoreFacts } from './storefront.js';

/**
 * A shop's quests, as rules - and the only way a shop earns XP.
 *
 * A buyer plays for cards; a shop plays for buyers. So the weekly and monthly
 * quests also pay in the one thing a shop actually wants more of - reach. Each
 * pays bump points, and every Bump on one of the shop's items spends one to put
 * it back at the top of the feed. (Stored as `spotlights`, their old name.)
 *
 * Every quest belongs to one area. Four are what a shop is graded on - its
 * reviews, how popular it is, what it sells, and how it markets itself - and
 * those pay full XP. Keeping the shop stocked and tidy matters too, but it is
 * what any shop does anyway, so upkeep quests pay a token amount and no
 * bump points. Like the buyers' game, nothing is counted from a number somebody
 * wrote - only from rows the server recorded.
 */

export type GrowthKind = 'daily' | 'weekly' | 'monthly' | 'milestone';
type Periodic = Exclude<GrowthKind, 'milestone'>;

export type GrowthArea = 'reviews' | 'popularity' | 'sales' | 'marketing' | 'upkeep';
export const GROWTH_AREAS: readonly GrowthArea[] = ['reviews', 'popularity', 'sales', 'marketing', 'upkeep'];
export const AREA_LABELS: Record<GrowthArea, string> = {
  reviews: 'Reviews', popularity: 'Popularity', sales: 'Sales', marketing: 'Marketing', upkeep: 'Upkeep',
};
/** What an upkeep quest pays, as a share of what the same quest pays in a focus area. */
export const UPKEEP_SHARE = 0.25;

const isFocus = (area: GrowthArea) => area !== 'upkeep';

type Stamp = { at: string };

export interface GrowthFacts {
  /** Times somebody on the shop sent the shop or an item out of the app. */
  shares: Stamp[];
  /** Visitors who arrived through a shared link to the shop or its items. */
  opens: Stamp[];
  /** Posts in the shop's channel. */
  posts: Stamp[];
  /** Placed orders that came through somebody's link. */
  affiliateSales: Stamp[];
  /** Placed orders, not called off. */
  sales: Stamp[];
  /** Orders that went all the way to delivered. */
  delivered: Stamp[];
  /** Four- and five-star reviews from buyers who ordered. */
  goodReviews: Stamp[];
  /** Hearts other people put on the shop's items. */
  hearts: Stamp[];
  /** People who follow the shop now, stamped when they followed. */
  follows: Stamp[];
  /** Items put up for sale. */
  listed: Stamp[];
  /** Pre-orders opened. */
  preOrdersRun: Stamp[];
  /** Live items paying a commission to whoever shares them. */
  affiliateItems: number;
  /** The fullest live pre-order, 0-1. */
  bestFill: number;
  /** How the shop stands overall, for the milestone ladders. */
  totals: StoreFacts;
}

export type GrowthAction = 'share_shop' | 'share_item' | 'post' | 'affiliate' | 'preorder' | 'list' | 'orders' | null;

export interface GrowthTask {
  id: string;
  kind: GrowthKind;
  area: GrowthArea;
  /** One of the four areas a shop is graded on, paying full XP. */
  focus: boolean;
  title: string;
  blurb: string;
  progress: number;
  goal: number;
  done: boolean;
  claimed: boolean;
  claimable: boolean;
  /** Bump points it pays. */
  bumps: number;
  xp: number;
  /** What to press to work on it, in the app's own terms. */
  action: GrowthAction;
  /** For a milestone ladder: which step this is, of how many. */
  step?: { index: number; of: number };
}

export interface GrowthView {
  tasks: GrowthTask[];
  /** Bump points saved up to spend. */
  bumps: number;
  /** XP the collected quests are worth on the shop's level. */
  xp: number;
  /** That XP split by area, focus areas first. */
  areas: { area: GrowthArea; label: string; xp: number; collected: number }[];
  /** This week's numbers, for the header. */
  week: { shares: number; opens: number; affiliateSales: number; sales: number; goodReviews: number };
}

interface Def {
  key: string;
  kind: Periodic;
  area: GrowthArea;
  title: string;
  blurb: string;
  goal: number;
  action: GrowthAction;
  /** Counted from stamps inside the period, or read off how the shop stands now. */
  measure: (facts: GrowthFacts, inPeriod: (at: string) => boolean) => number;
}

const within = (list: Stamp[], inPeriod: (at: string) => boolean) => list.filter((entry) => inPeriod(entry.at)).length;

/*
 * The ids of the weekly and monthly marketing quests predate the areas; they
 * stay as they were so quests already collected keep their XP.
 */
const DEFS: readonly Def[] = [
  // Daily: a nudge in each focus area, plus one upkeep job.
  { key: 'share1', kind: 'daily', area: 'marketing', title: 'Share something today',
    blurb: 'Send your shop or a drop to WhatsApp, a story or a group.',
    goal: 1, action: 'share_shop', measure: (f, inPeriod) => within(f.shares, inPeriod) },
  { key: 'sale1', kind: 'daily', area: 'sales', title: 'Make a sale today',
    blurb: 'Any order placed with the shop today counts.',
    goal: 1, action: 'share_item', measure: (f, inPeriod) => within(f.sales, inPeriod) },
  { key: 'hearts3', kind: 'daily', area: 'popularity', title: 'Three hearts today',
    blurb: 'Three hearts from shoppers on your items today.',
    goal: 3, action: 'share_item', measure: (f, inPeriod) => within(f.hearts, inPeriod) },
  { key: 'list1', kind: 'daily', area: 'upkeep', title: 'List something new',
    blurb: 'Put one new item up for sale today.',
    goal: 1, action: 'list', measure: (f, inPeriod) => within(f.listed, inPeriod) },

  // Weekly.
  { key: 'good2', kind: 'weekly', area: 'reviews', title: 'Two good reviews',
    blurb: 'Two buyers rate an order four or five stars this week. Deliver well, then ask.',
    goal: 2, action: 'orders', measure: (f, inPeriod) => within(f.goodReviews, inPeriod) },
  { key: 'hearts15', kind: 'weekly', area: 'popularity', title: 'Fifteen hearts',
    blurb: 'Fifteen hearts from shoppers on your items this week.',
    goal: 15, action: 'share_item', measure: (f, inPeriod) => within(f.hearts, inPeriod) },
  { key: 'follows3', kind: 'weekly', area: 'popularity', title: 'Three new followers',
    blurb: 'Three people follow the shop this week. Share it where your buyers are.',
    goal: 3, action: 'share_shop', measure: (f, inPeriod) => within(f.follows, inPeriod) },
  { key: 'sales3', kind: 'weekly', area: 'sales', title: 'Three sales',
    blurb: 'Three orders placed with the shop this week.',
    goal: 3, action: 'share_item', measure: (f, inPeriod) => within(f.sales, inPeriod) },
  { key: 'deliver3', kind: 'weekly', area: 'sales', title: 'Deliver three orders',
    blurb: 'Three orders go all the way to delivered this week.',
    goal: 3, action: 'orders', measure: (f, inPeriod) => within(f.delivered, inPeriod) },
  { key: 'share2', kind: 'weekly', area: 'marketing', title: 'Share your shop twice',
    blurb: 'Send your shop or a drop to WhatsApp, a story or a group - twice this week.',
    goal: 2, action: 'share_shop', measure: (f, inPeriod) => within(f.shares, inPeriod) },
  { key: 'visits5', kind: 'weekly', area: 'marketing', title: 'Five visitors from shared links',
    blurb: 'Five people open a link to your shop or items this week - yours or anybody\'s.',
    goal: 5, action: 'share_item', measure: (f, inPeriod) => within(f.opens, inPeriod) },
  { key: 'post2', kind: 'weekly', area: 'marketing', title: 'Post two drops',
    blurb: 'Two posts in your channel this week, so followers have something to pass on.',
    goal: 2, action: 'post', measure: (f, inPeriod) => within(f.posts, inPeriod) },
  { key: 'affiliate3', kind: 'weekly', area: 'marketing', title: 'Pay sharers on three items',
    blurb: 'Keep a commission on three live items, so buyers earn by sharing them.',
    goal: 3, action: 'affiliate', measure: (f) => f.affiliateItems },
  { key: 'list3', kind: 'weekly', area: 'upkeep', title: 'List three items',
    blurb: 'Keep the shelf fresh: three new items this week.',
    goal: 3, action: 'list', measure: (f, inPeriod) => within(f.listed, inPeriod) },

  // Monthly.
  { key: 'good8', kind: 'monthly', area: 'reviews', title: 'Eight good reviews',
    blurb: 'Eight four- or five-star reviews from buyers this month.',
    goal: 8, action: 'orders', measure: (f, inPeriod) => within(f.goodReviews, inPeriod) },
  { key: 'hearts60', kind: 'monthly', area: 'popularity', title: 'Sixty hearts',
    blurb: 'Sixty hearts from shoppers on your items this month.',
    goal: 60, action: 'share_item', measure: (f, inPeriod) => within(f.hearts, inPeriod) },
  { key: 'follows10', kind: 'monthly', area: 'popularity', title: 'Ten new followers',
    blurb: 'Ten people follow the shop this month.',
    goal: 10, action: 'share_shop', measure: (f, inPeriod) => within(f.follows, inPeriod) },
  { key: 'sales15', kind: 'monthly', area: 'sales', title: 'Fifteen sales',
    blurb: 'Fifteen orders placed with the shop this month.',
    goal: 15, action: 'share_item', measure: (f, inPeriod) => within(f.sales, inPeriod) },
  { key: 'deliver10', kind: 'monthly', area: 'sales', title: 'Deliver ten orders',
    blurb: 'Ten orders go all the way to delivered this month.',
    goal: 10, action: 'orders', measure: (f, inPeriod) => within(f.delivered, inPeriod) },
  { key: 'fill60', kind: 'monthly', area: 'sales', title: 'Fill a pre-order past 60%',
    blurb: 'Share a pre-order until it is more than half full. Pre-orders travel on WhatsApp.',
    goal: 60, action: 'preorder', measure: (f) => Math.round(f.bestFill * 100) },
  { key: 'affsale1', kind: 'monthly', area: 'marketing', title: 'A sale a sharer made',
    blurb: 'Somebody buys through another person\'s link this month.',
    goal: 1, action: 'affiliate', measure: (f, inPeriod) => within(f.affiliateSales, inPeriod) },
  { key: 'visits25', kind: 'monthly', area: 'marketing', title: 'Twenty-five visitors from shared links',
    blurb: 'Twenty-five people arrive through shared links this month.',
    goal: 25, action: 'share_shop', measure: (f, inPeriod) => within(f.opens, inPeriod) },
  { key: 'preorder1', kind: 'monthly', area: 'upkeep', title: 'Open a pre-order',
    blurb: 'Run at least one pre-order this month.',
    goal: 1, action: 'preorder', measure: (f, inPeriod) => within(f.preOrdersRun, inPeriod) },
];

interface Ladder {
  key: string;
  name: string;
  area: GrowthArea;
  steps: number[];
  blurb: (goal: number) => string;
  action: GrowthAction;
  have: (totals: StoreFacts) => number;
  /**
   * Counts that can go back down - an unfollow, a heart taken back, a rating
   * that slips. A step on one of these only pays while it stays met.
   */
  undoable?: boolean;
}

const goodAverage = (t: StoreFacts) => t.ratingAverage !== null && t.ratingAverage >= 90;

/* Milestones repeat with bigger numbers: collect one step and the next appears. */
const LADDERS: readonly Ladder[] = [
  { key: 'reviewed', name: 'Well reviewed', area: 'reviews', steps: [1, 5, 15, 40, 100],
    blurb: (n) => (n === 1 ? 'Get a four- or five-star review from a buyer.' : `${n} four- or five-star reviews from buyers.`),
    action: 'orders', have: (t) => t.tradeGoodReviews },
  { key: 'rated', name: 'Top rated', area: 'reviews', steps: [5, 20, 60], undoable: true,
    blurb: (n) => `Keep a 4.5★ rating across ${n} ratings.`,
    action: 'orders', have: (t) => (goodAverage(t) ? t.ratingCount : 0) },
  { key: 'flawless', name: 'Flawless', area: 'reviews', steps: [10, 50], undoable: true,
    blurb: (n) => `Deliver ${n} orders without losing a dispute.`,
    action: 'orders', have: (t) => (t.disputesLost === 0 ? t.completedSales : 0) },
  { key: 'trusted', name: 'Trusted', area: 'reviews', steps: [50, 80, 95], undoable: true,
    blurb: (n) => `Reach a trust score of ${n}. It rises with every order completed without a dispute.`,
    action: 'orders', have: (t) => t.trust },
  { key: 'fans', name: 'Following', area: 'popularity', steps: [10, 50, 250, 1000], undoable: true,
    blurb: (n) => `Reach ${n} followers.`, action: 'share_shop', have: (t) => t.followers },
  { key: 'hearts', name: 'Crowd favourite', area: 'popularity', steps: [10, 100, 500, 2000], undoable: true,
    blurb: (n) => `Collect ${n} hearts across your items.`, action: 'share_item', have: (t) => t.likes },
  { key: 'sales', name: 'Sales', area: 'sales', steps: [1, 10, 25, 100, 250, 500],
    blurb: (n) => (n === 1 ? 'Deliver your first order.' : `Deliver ${n} orders in total.`),
    action: 'orders', have: (t) => t.completedSales },
  { key: 'soldout', name: 'Sell-out', area: 'sales', steps: [1, 5, 20],
    blurb: (n) => (n === 1 ? 'Sell every unit of an item.' : `Sell out ${n} items.`),
    action: 'share_item', have: (t) => t.soldOut },
  { key: 'mouth', name: 'Word of mouth', area: 'marketing', steps: [1, 10, 50, 150],
    blurb: (n) => (n === 1 ? 'Make a sale through somebody\'s affiliate link.' : `${n} sales through affiliate links.`),
    action: 'affiliate', have: (t) => t.affiliateSales },
  { key: 'partner', name: 'Affiliate partner', area: 'marketing', steps: [1, 10, 30], undoable: true,
    blurb: (n) => `Offer a commission on ${n} live item${n === 1 ? '' : 's'}.`,
    action: 'affiliate', have: (t) => t.affiliateItems },
  { key: 'voice', name: 'Broadcaster', area: 'marketing', steps: [1, 20, 100],
    blurb: (n) => (n === 1 ? 'Post in your shop\'s channel.' : `Post ${n} times in your shop's channel.`),
    action: 'post', have: (t) => t.posts },
  { key: 'stickers', name: 'Sticker book', area: 'popularity', steps: [3, 10, 20, 30], undoable: true,
    blurb: (n) => `Earn ${n} sticker steps on your shop's page. Each sticker has its own milestone quest.`,
    action: null, have: (t) => t.stickerSteps ?? 0 },
  { key: 'shelf', name: 'Full shelf', area: 'upkeep', steps: [5, 25, 75],
    blurb: (n) => `List ${n} items.`, action: 'list', have: (t) => t.listings },
  { key: 'launch', name: 'Launcher', area: 'upkeep', steps: [1, 5, 15],
    blurb: (n) => (n === 1 ? 'Run your first pre-order.' : `Run ${n} pre-orders.`), action: 'preorder', have: (t) => t.preOrders },
  { key: 'year', name: 'Veteran', area: 'upkeep', steps: [90, 365, 1095],
    blurb: (n) => `Stay open ${n === 90 ? '3 months' : n === 365 ? 'a year' : '3 years'}.`, action: null, have: (t) => t.ageDays },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];


function xpOf(kind: GrowthKind, area: GrowthArea, stepIndex = 0): number {
  const base = kind === 'milestone' ? TIER_XP[stepIndex] ?? 0 : TASK_XP[kind];
  return isFocus(area) ? base : Math.round(base * UPKEEP_SHARE);
}

const bumpsOf = (kind: GrowthKind, area: GrowthArea) => (isFocus(area) ? BUMPS_FOR[kind] : 0);

function periodOf(kind: GrowthKind, now: number): string {
  if (kind === 'daily') return dayKey(now);
  if (kind === 'weekly') return weekKey(now);
  if (kind === 'monthly') return monthKey(now);
  return 'once';
}

function inPeriodOf(kind: Periodic, now: number): (at: string) => boolean {
  const period = periodOf(kind, now);
  const keyOf = kind === 'daily' ? dayKey : kind === 'weekly' ? weekKey : monthKey;
  return (at) => keyOf(at) === period;
}

export function emptyGrowth(): StoreGrowthState {
  return { claimed: {}, spotlights: 0 };
}

/** What a stored claim was for, and what it is worth. */
function claimInfo(key: string): { area: GrowthArea; xp: number; ladder?: Ladder; goal?: number } | null {
  const id = key.split(':')[0] ?? '';
  const def = DEFS.find((entry) => `${entry.kind}-${entry.key}` === id);
  if (def) return { area: def.area, xp: xpOf(def.kind, def.area) };
  for (const ladder of LADDERS) {
    if (!id.startsWith(`ms-${ladder.key}-`)) continue;
    const goal = Number(id.slice(`ms-${ladder.key}-`.length));
    const index = ladder.steps.indexOf(goal);
    if (index >= 0) return { area: ladder.area, xp: xpOf('milestone', ladder.area, index), ladder, goal };
  }
  return null;
}

/** A milestone on a count that can drop pays only while the shop still meets it. */
function stands(info: NonNullable<ReturnType<typeof claimInfo>>, totals: StoreFacts | undefined): boolean {
  if (!info.ladder?.undoable || !totals) return true;
  return info.ladder.have(totals) >= (info.goal ?? 0);
}

/**
 * XP from every quest the shop collected, by area. Pass how the shop stands
 * now so a milestone it has since slipped below stops paying.
 */
export function growthAreas(state: StoreGrowthState | undefined, totals?: StoreFacts): GrowthView['areas'] {
  const sums = new Map<GrowthArea, { xp: number; collected: number }>(GROWTH_AREAS.map((area) => [area, { xp: 0, collected: 0 }]));
  for (const key of Object.keys(state?.claimed ?? {})) {
    const info = claimInfo(key);
    if (!info || !stands(info, totals)) continue;
    const sum = sums.get(info.area)!;
    sum.xp += info.xp;
    sum.collected += 1;
  }
  return GROWTH_AREAS.map((area) => ({ area, label: AREA_LABELS[area], ...sums.get(area)! }));
}

export function growthXp(state: StoreGrowthState | undefined, totals?: StoreFacts): number {
  return growthAreas(state, totals).reduce((sum, area) => sum + area.xp, 0);
}

function periodicTask(def: Def, facts: GrowthFacts, state: StoreGrowthState, now: number): GrowthTask {
  const id = `${def.kind}-${def.key}`;
  const progress = Math.min(def.goal, def.measure(facts, inPeriodOf(def.kind, now)));
  const done = progress >= def.goal;
  const claimed = Boolean(state.claimed[`${id}:${periodOf(def.kind, now)}`]);
  return {
    id, kind: def.kind, area: def.area, focus: isFocus(def.area), title: def.title, blurb: def.blurb,
    progress, goal: def.goal, done, claimed, claimable: done && !claimed,
    bumps: bumpsOf(def.kind, def.area), xp: xpOf(def.kind, def.area), action: def.action,
  };
}

/** The lowest step on a ladder not yet collected (or the top one, once all are). */
function ladderTask(ladder: Ladder, facts: GrowthFacts, state: StoreGrowthState): GrowthTask {
  const have = ladder.have(facts.totals);
  const standing = (goal: number) => {
    if (!state.claimed[`ms-${ladder.key}-${goal}:once`]) return false;
    return !ladder.undoable || have >= goal;
  };
  let index = ladder.steps.findIndex((goal) => !standing(goal));
  const finished = index === -1;
  if (finished) index = ladder.steps.length - 1;
  const goal = ladder.steps[index] ?? 1;
  const done = have >= goal;
  return {
    id: `ms-${ladder.key}-${goal}`,
    kind: 'milestone', area: ladder.area, focus: isFocus(ladder.area),
    title: `${ladder.name} ${ladder.steps.length > 1 ? ROMAN[index] ?? '' : ''}`.trim(),
    blurb: ladder.blurb(goal),
    progress: Math.min(goal, have), goal, done,
    claimed: finished, claimable: done && !finished && !state.claimed[`ms-${ladder.key}-${goal}:once`],
    bumps: 0, xp: xpOf('milestone', ladder.area, index), action: ladder.action,
    step: { index: index + 1, of: ladder.steps.length },
  };
}

/** Focus areas first within each kind, in the order the areas are listed. */
const byArea = (a: GrowthTask, b: GrowthTask) => GROWTH_AREAS.indexOf(a.area) - GROWTH_AREAS.indexOf(b.area);

export function growthView(facts: GrowthFacts, stored: StoreGrowthState | undefined, now: number = Date.now()): GrowthView {
  const state = stored ?? emptyGrowth();
  const tasks = [
    ...DEFS.map((def) => periodicTask(def, facts, state, now)),
    ...LADDERS.map((ladder) => ladderTask(ladder, facts, state)),
  ];
  const kinds: GrowthKind[] = ['daily', 'weekly', 'monthly', 'milestone'];
  tasks.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || byArea(a, b));
  const areas = growthAreas(state, facts.totals);
  const thisWeek = inPeriodOf('weekly', now);
  return {
    tasks,
    bumps: state.spotlights,
    xp: areas.reduce((sum, area) => sum + area.xp, 0),
    areas,
    week: {
      shares: within(facts.shares, thisWeek),
      opens: within(facts.opens, thisWeek),
      affiliateSales: within(facts.affiliateSales, thisWeek),
      sales: within(facts.sales, thisWeek),
      goodReviews: within(facts.goodReviews, thisWeek),
    },
  };
}

function claimKeyOf(task: GrowthTask, now: number): string {
  return `${task.id}:${periodOf(task.kind, now)}`;
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
  if (task.claimed || state.claimed[claimKeyOf(task, now)]) return { refusal: 'Already collected for this period.' };
  if (!task.done) return { refusal: 'Not done yet.' };
  return {
    task,
    state: {
      ...state,
      claimed: { ...state.claimed, [claimKeyOf(task, now)]: new Date(now).toISOString() },
      spotlights: state.spotlights + task.bumps,
    },
  };
}

/**
 * Collects everything that is ready at once, climbing each milestone ladder as
 * far as the shop already reaches - so a shop that has done the work does not
 * have to tap through it one step at a time.
 */
export function claimAllGrowth(
  facts: GrowthFacts, stored: StoreGrowthState | undefined, now: number = Date.now(),
): { state: StoreGrowthState; tasks: GrowthTask[] } {
  let state = stored ?? emptyGrowth();
  const tasks: GrowthTask[] = [];
  for (let guard = 0; guard < 100; guard += 1) {
    const ready = growthView(facts, state, now).tasks.filter((task) => task.claimable);
    if (ready.length === 0) break;
    for (const task of ready) {
      const result = claimGrowth(facts, state, task.id, now);
      if ('refusal' in result) continue;
      state = result.state;
      tasks.push(result.task);
    }
  }
  return { state, tasks };
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
