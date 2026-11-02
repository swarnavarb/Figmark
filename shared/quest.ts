import type { Listing, QuestState } from './models.js';
import { FORUM_UNLOCK_LEVELS } from './enums.js';

/**
 * The collector game, as rules.
 *
 * One definition used by both sides: the API works out XP, tasks and honours
 * from the rows when somebody asks, and the app reads a listing's rarity off
 * the same function the server would use - so a card that says "Legendary" on
 * the feed never opens a page that disagrees.
 *
 * Almost nothing here is stored. XP is counted from what a person has actually
 * done (orders, reviews, saves, posts), so it cannot drift from the record and
 * cannot be farmed by writing a number. The only things kept are the ones no
 * other row remembers: which days somebody checked in, which days they flipped
 * the daily reveal, and which task rewards they collected.
 */

/* -------------------------------------------------------------------------- */
/* Clock                                                                      */
/* -------------------------------------------------------------------------- */

/** India time, because that is where the buyers are and when their day turns. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD of the India day an instant falls in. */
export function dayKey(at: Date | string | number): string {
  return new Date(new Date(at).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Monday (India time) that starts the week an instant falls in, as a day key. */
export function weekKey(at: Date | string | number): string {
  const shifted = new Date(new Date(at).getTime() + IST_OFFSET_MS);
  const weekday = (shifted.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(shifted.getTime() - weekday * DAY_MS).toISOString().slice(0, 10);
}

function previousDay(key: string): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Listing rarity                                                             */
/* -------------------------------------------------------------------------- */

export type RarityTier = 'legendary' | 'epic' | 'new';

export const RARITY_LABELS: Record<RarityTier, string> = {
  legendary: 'Legendary',
  epic: 'Epic',
  new: 'New',
};

export interface ListingRarity {
  tier: RarityTier | null;
  /** Sales and engagement folded into one number, after the clock has had its say. */
  heat: number;
  /** Why, in two or three words each - shown under the label. */
  reasons: string[];
  /** Hours until it stops being buyable, when the seller set a timer. */
  hoursLeft: number | null;
  /** How far the price came down from its highest, in percent. */
  priceDropPercent: number | null;
}

type RarityInput = Pick<
  Listing,
  'createdAt' | 'likeCount' | 'viewCount' | 'quantityAvailable' | 'preOrder' | 'priceMinor'
> & Partial<Pick<Listing, 'soldCount' | 'quantityMode' | 'expiresAt' | 'restockedAt' | 'priceHistory'>>;

/** How recent counts as new: long enough to be seen, short enough to mean it. */
export const NEW_WINDOW_HOURS = 72;
export const LEGENDARY_HEAT = 150;
export const EPIC_HEAT = 60;

/**
 * The label a listing wears, from how it is selling and how people react to it.
 *
 * Heat is sales first (a sale is the strongest signal there is), then saves,
 * then views, plus how full a group buy has got. A timer turns the heat up:
 * the same interest in something that disappears tomorrow is worth more than
 * in something that is here all month, and the closer the deadline the more
 * so. Scarcity promotes too - two left of something people are buying is the
 * definition of hard to get.
 *
 * `new` is the consolation tier: only something that has earned neither of the
 * others gets it, because a brand-new legendary should say legendary.
 */
export function listingRarity(listing: RarityInput, now: number = Date.now()): ListingRarity {
  const sold = listing.soldCount ?? 0;
  const likes = listing.likeCount ?? 0;
  const views = listing.viewCount ?? 0;
  const reasons: string[] = [];

  let fill = 0;
  if (listing.preOrder && listing.preOrder.fillThreshold > 0) {
    const committed = listing.preOrder.filledCount + (listing.preOrder.pledgedCount ?? 0);
    fill = Math.min(1, committed / listing.preOrder.fillThreshold);
  }

  let heat = sold * 8 + likes * 1.5 + views * 0.05 + fill * 40;

  const hoursLeft = listing.expiresAt
    ? Math.max(0, (Date.parse(listing.expiresAt) - now) / 3_600_000)
    : null;
  if (hoursLeft !== null) {
    if (hoursLeft <= 24) heat *= 1.6;
    else if (hoursLeft <= 72) heat *= 1.3;
  }

  const left = listing.quantityMode === 'multiple' ? null : listing.quantityAvailable;
  const scarce = left !== null && left > 0 && left <= 2;
  // Scarcity only counts when people are actually buying: one left of
  // something nobody wants is not rare, just unsold.
  if (scarce && sold >= 2) heat += 20;
  heat = Math.round(heat);

  if (sold >= 5) reasons.push('Selling fast');
  if (likes >= 25) reasons.push('Most saved');
  if (fill >= 0.8 && fill < 1) reasons.push('Almost full');
  if (scarce) reasons.push(`Only ${left} left`);
  if (hoursLeft !== null && hoursLeft <= 72) reasons.push(hoursLeft < 1 ? 'Last hour' : `Ends in ${formatHours(hoursLeft)}`);

  const priceDropPercent = priceDrop(listing);
  if (priceDropPercent) reasons.push(`${priceDropPercent}% off`);

  let tier: RarityTier | null = null;
  const lastCall = hoursLeft !== null && hoursLeft <= 6 && heat >= 20;
  if (heat >= LEGENDARY_HEAT || fill >= 0.9 || lastCall) tier = 'legendary';
  else if (heat >= EPIC_HEAT || fill >= 0.6 || (hoursLeft !== null && hoursLeft <= 72 && heat >= 15)) tier = 'epic';
  else {
    const fresh = [listing.createdAt, listing.restockedAt]
      .filter((at): at is string => Boolean(at))
      .some((at) => now - Date.parse(at) <= NEW_WINDOW_HOURS * 3_600_000);
    if (fresh) {
      tier = 'new';
      reasons.unshift(listing.restockedAt && now - Date.parse(listing.restockedAt) <= NEW_WINDOW_HOURS * 3_600_000
        ? 'Back in stock'
        : 'Just listed');
    }
  }

  return { tier, heat, reasons: reasons.slice(0, 3), hoursLeft, priceDropPercent };
}

function formatHours(hours: number): string {
  if (hours < 24) return `${Math.ceil(hours)}h`;
  return `${Math.floor(hours / 24)}d ${Math.floor(hours % 24)}h`;
}

/** Percent below the highest price it has been on sale at, when it has come down. */
function priceDrop(listing: RarityInput): number | null {
  const history = listing.priceHistory ?? [];
  if (history.length === 0) return null;
  const highest = Math.max(...history.map((entry) => entry.priceMinor));
  if (highest <= listing.priceMinor) return null;
  const percent = Math.round(((highest - listing.priceMinor) / highest) * 100);
  return percent >= 5 ? percent : null;
}

/* -------------------------------------------------------------------------- */
/* Levels                                                                     */
/* -------------------------------------------------------------------------- */

export const MAX_LEVEL = 50;

/**
 * One scale for buyers and shops, so a level 6 buyer and a level 6 shop did
 * about the same amount: 0, 500, 1500, 3000, 5000, … Each level asks 500 XP
 * more than the one before it, so the top of the ladder stays rare.
 */
export const LEVEL_STEP_XP = 250;
export function xpForLevel(level: number): number {
  return LEVEL_STEP_XP * level * (level - 1);
}

/*
 * What anything is worth, on either side. Every way of earning pays the same
 * at the same size, so no one action is the way to level - doing a bit of
 * everything is. A counted action is worth one unit, up to a hundred of each
 * kind; a task pays by how long it runs; a milestone step pays by which step.
 */
export const ACTION_XP = 20;
/**
 * What each thing earns. Finishing a trade and reviewing it pay far more than
 * anything social, because a level is a statement about how somebody trades.
 * Liking, following and posting pay a few points each (and are capped) so
 * they can colour a level but never carry one.
 */
export const XP = {
  orderPlaced: 10,
  orderDelivered: 90,
  dispatchOnTime: 30,
  preOrderJoined: 10,
  reviewWritten: 50,
  goodRatingReceived: 40,
  referredSale: 40,
  collectionItem: 10,
  post: 4,
  want: 4,
  follow: 2,
  like: 2,
  shareOpen: 3,
  invite: 10,
  invitedSeller: 50,
  checkIn: 3,
  /** Flipping the daily reveal. */
  reveal: 5,
} as const;
export const ACTION_CAP = 100;
/** What a periodic task pays; a Getting started step pays once, on the starter line. */
export const TASK_XP = { daily: 5, weekly: 20, monthly: 60, starter: 20 } as const;
export const TIER_XP = [60, 150, 300, 500, 800, 1200] as const;

/*
 * Bump points: what a weekly or monthly quest pays on top of XP, on either
 * side. One Bump on an item spends one and puts it back at the top of the
 * feed: the shop's points first, then those of whoever pressed it - so
 * bumping is earned by taking part, not by tapping a button.
 */
export const BUMPS_FOR: Record<TaskKind, number> = { daily: 0, weekly: 1, monthly: 2, milestone: 0, starter: 0 };
/** A Bump this soon after the last one would spend a point for nothing, so it is refused. */
export const BUMP_GUARD_MS = 60 * 60 * 1000;

/** One kind of counted action, capped like every other. */
export function actionXp(count: number, each = ACTION_XP): number {
  return Math.min(Math.max(count, 0), ACTION_CAP) * each;
}


export function levelFor(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

/*
 * Rank tiers: what a level means.
 *
 * A level reads as a rank, and a rank is earned by trading well - not by
 * being busy. The first two are open to everybody; from the third on they
 * need a record of finished orders and no pile of lost disputes, whatever
 * else a person has done (see `trustCap`). Buyers and shops climb the same
 * nine steps with their own names. None of them says "verified": that word
 * belongs to the phone, email and ID checks, not to a level.
 *
 * Every XP source is capped, so the high levels come from a long, steady
 * record rather than a burst; the ranks sit where real people can reach them.
 */
export const TIER_FLOORS = [1, 3, 6, 10, 13, 16, 20, 25, 30] as const;
export const BUYER_TIERS = [
  'Newcomer', 'Rising Collector', 'Trusted Collector', 'Elite Collector', 'Master Collector',
  'Grand Collector', 'Paragon', 'Legend', 'Icon',
] as const;
export const SHOP_TIERS = [
  'New Shop', 'Rising Shop', 'Trusted Shop', 'Prime Shop', 'Premier Shop',
  'Flagship Store', 'Master Merchant', 'Legendary House', 'Icon Store',
] as const;

/** 0 to 8: which rank a level sits in. */
export function tierOfLevel(level: number): number {
  let tier = 0;
  for (const [index, floor] of TIER_FLOORS.entries()) if (level >= floor) tier = index;
  return tier;
}

/** The rank a level reads as, for a buyer or for a shop. */
export function tierTitle(level: number, shop: boolean): string {
  return (shop ? SHOP_TIERS : BUYER_TIERS)[tierOfLevel(level)]!;
}

export function titleFor(level: number): string {
  return tierTitle(level, false);
}

/** Every rank with the level it starts at, for the explainer. */
export function rankLadder(shop: boolean): { title: string; from: number; to: number | null }[] {
  const names = shop ? SHOP_TIERS : BUYER_TIERS;
  return TIER_FLOORS.map((from, index) => ({
    title: names[index]!,
    from,
    to: index + 1 < TIER_FLOORS.length ? TIER_FLOORS[index + 1]! - 1 : null,
  }));
}

/**
 * The highest level a record allows, however much XP is piled up.
 *
 * Finished orders are what a rank is evidence of: nobody is Rising without
 * one, Trusted without ten, or Elite without forty. Lost disputes hold the top
 * back - two keep a person out of Elite, four out of Trusted.
 */
export function trustCap(completed: number, disputesLost: number): number {
  let cap = MAX_LEVEL;
  if (completed < 1) cap = 2;
  else if (completed < 10) cap = 5;
  else if (completed < 40) cap = 9;
  if (disputesLost >= 4) cap = Math.min(cap, 5);
  else if (disputesLost >= 2) cap = Math.min(cap, 9);
  return cap;
}

/** The level XP earns, held to what the record allows - and why, when it is held. */
export function levelWithRecord(xp: number, completed: number, disputesLost: number): { level: number; heldBack: string | null } {
  const earned = levelFor(xp);
  const cap = trustCap(completed, disputesLost);
  if (earned <= cap) return { level: earned, heldBack: null };
  const lost = disputesLost >= 2;
  const heldBack = completed < 40 && cap < 10
    ? `Your XP is ahead of your record. Finish ${completed < 1 ? 'an order' : completed < 10 ? `${10 - completed} more orders` : `${40 - completed} more orders`} with no dispute to rank up.`
    : lost ? 'Lost disputes are holding your rank back. Clean trades lift it again.' : null;
  return { level: cap, heldBack };
}

/** FNV-1a: small, pure and the same in the browser and on the server. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/* -------------------------------------------------------------------------- */
/* Facts the game is counted from                                             */
/* -------------------------------------------------------------------------- */

/**
 * Everything the game needs from the rest of the record, already read.
 *
 * The API gathers it (orders, reviews, likes, posts); the rules below never
 * touch storage, which is what makes them testable and the same everywhere.
 */
export interface QuestFacts {
  /** Orders the person actually placed - checkouts nobody went ahead with are not orders. */
  orders: { createdAt: string; status: string; totalMinor: number; preOrder: boolean; sellerId?: string; early?: boolean }[];
  /** `detailed`: long enough to help the next buyer (see DETAILED_REVIEW_CHARS). */
  reviewsWritten: { createdAt: string; detailed?: boolean }[];
  /** Stars sellers gave this person after completed orders (revealed ones only), 1-5. */
  ratingsReceived: number[];
  /** Stars left on their page by anybody, 1-5. Counted apart, and weighed lighter. */
  pageRatings: number[];
  likes: { createdAt: string }[];
  follows: { createdAt: string }[];
  posts: { createdAt: string }[];
  wants: { createdAt: string }[];
  pledges: number;
  disputesLost: number;
  /** XP community managers' approved decisions took away. */
  penaltyXp?: number;
  /** Delivered purchases the person has put in their collection. */
  collection: { addedAt: string }[];
  hasBio: boolean;
  hasTags: boolean;
  /** Items this person made an affiliate link for. Making a link is not sharing it, so this earns nothing on its own. */
  shares: number;
  /** Orders other people placed through their links. */
  referredSales: number;
  /** Other people opening what this person shared, one per visitor per link. */
  shareOpens: { createdAt: string }[];
  /** Times this person sent something out of the app - WhatsApp, a story, a copied link - and what it was. */
  sharesSent: { createdAt: string; kind?: string }[];
  /** Friends who signed up through this person's invite. */
  invites: { createdAt: string }[];
  /** Of those, how many opened a shop. */
  invitedSellers: number;
  /* The rest feeds honours and Getting started; absent reads as none. */
  /** Games won, from the badges the games hand out. */
  wins?: { contest: number; debate: number; guess: number };
  /** Answers of theirs marked as the answer. */
  helpfulAnswers?: number;
  /** When the account was made. */
  joinedAt?: string;
  /** Top-three finishes on hobby leaderboards, in seasons that have ended. */
  podiums?: number;
  hasPhoto?: boolean;
  tagCount?: number;
  /** Notifications switched on in at least one browser or phone. */
  pushOn?: boolean;
  phoneVerified?: boolean;
  emailVerified?: boolean;
  /** Hobby leaderboards joined. */
  boards?: number;
}

/** A review this long tells the next buyer something. */
export const DETAILED_REVIEW_CHARS = 80;
/** A pre-order joined this soon after it opened is backing it early. */
export const EARLY_BACK_HOURS = 24;
/** Accounts made before this joined in the founding season. */
export const FOUNDING_BEFORE = '2027-07-01T00:00:00+05:30';

export function emptyQuestState(): QuestState {
  return { checkIns: [], claimed: {}, reveals: [] };
}

/** YYYY-MM of the India month an instant falls in. */
export function monthKey(at: Date | string | number): string {
  return dayKey(at).slice(0, 7);
}

/* -------------------------------------------------------------------------- */
/* Streak                                                                     */
/* -------------------------------------------------------------------------- */

export interface StreakDay {
  day: string;
  done: boolean;
  today: boolean;
  /** Later this week, not reached yet. */
  future: boolean;
}

export interface Streak {
  current: number;
  best: number;
  checkedInToday: boolean;
  /** This week, Monday to Sunday (India time). */
  week: StreakDay[];
}

function nextDay(key: string): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

export function streakOf(checkIns: readonly string[], now: number = Date.now()): Streak {
  const days = new Set(checkIns);
  const today = dayKey(now);
  const checkedInToday = days.has(today);

  // A streak survives until the end of the day after the last check-in: not
  // having checked in *yet* today does not break it.
  let current = 0;
  let cursor = checkedInToday ? today : previousDay(today);
  while (days.has(cursor)) {
    current += 1;
    cursor = previousDay(cursor);
  }

  let best = 0;
  let run = 0;
  let last: string | null = null;
  for (const day of [...days].sort()) {
    run = last && previousDay(day) === last ? run + 1 : 1;
    best = Math.max(best, run);
    last = day;
  }

  // The week strip runs Monday to Sunday, like a calendar, rather than
  // "the last seven days" - so it fills left to right as the week goes on.
  const week: StreakDay[] = [];
  let day = weekKey(now);
  for (let index = 0; index < 7; index += 1) {
    week.push({ day, done: days.has(day), today: day === today, future: day > today });
    day = nextDay(day);
  }

  return { current, best: Math.max(best, current), checkedInToday, week };
}


/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

/** `starter` is Getting started: one-time steps that set a new account up. */
export type TaskKind = 'daily' | 'weekly' | 'monthly' | 'milestone' | 'starter';

export interface TaskView {
  id: string;
  kind: TaskKind;
  title: string;
  blurb: string;
  xp: number;
  /** Bump points it pays. */
  bumps: number;
  progress: number;
  goal: number;
  done: boolean;
  claimed: boolean;
  /** Done, and the reward is waiting for a tap. */
  claimable: boolean;
  /** Where to go to do it. */
  href: string | null;
  /** For a milestone ladder: which step this is, of how many. */
  step?: { index: number; of: number };
  /** A quest about bringing people in, shown with a megaphone. */
  marketing?: boolean;
}

type Metric = 'order' | 'preorder' | 'review' | 'detailed' | 'save' | 'follow' | 'post' | 'want' | 'collect' | 'checkin'
  | 'open' | 'sent' | 'sentHaul' | 'sentPage' | 'invite';

interface MeasureContext {
  facts: QuestFacts;
  state: QuestState;
  streak: Streak;
  now: number;
}

const HAUL_KINDS = new Set(['purchased', 'delivered', 'booked']);

/** When each fact happened, so a count can be limited to today, this week or this month. */
function stampsFor(metric: Metric, { facts, state }: MeasureContext): string[] {
  switch (metric) {
    case 'order': return facts.orders.map((order) => order.createdAt);
    case 'preorder': return facts.orders.filter((order) => order.preOrder).map((order) => order.createdAt);
    case 'review': return facts.reviewsWritten.map((review) => review.createdAt);
    case 'detailed': return facts.reviewsWritten.filter((review) => review.detailed).map((review) => review.createdAt);
    case 'save': return facts.likes.map((like) => like.createdAt);
    case 'follow': return facts.follows.map((follow) => follow.createdAt);
    case 'post': return facts.posts.map((post) => post.createdAt);
    case 'want': return facts.wants.map((want) => want.createdAt);
    case 'collect': return facts.collection.map((item) => item.addedAt);
    case 'checkin': return state.checkIns.map((day) => `${day}T12:00:00+05:30`);
    case 'open': return facts.shareOpens.map((open) => open.createdAt);
    case 'sent': return facts.sharesSent.map((sent) => sent.createdAt);
    case 'sentHaul': return facts.sharesSent.filter((sent) => HAUL_KINDS.has(sent.kind ?? '')).map((sent) => sent.createdAt);
    case 'sentPage': return facts.sharesSent.filter((sent) => sent.kind === 'profile').map((sent) => sent.createdAt);
    case 'invite': return facts.invites.map((invite) => invite.createdAt);
  }
}

function periodOf(kind: TaskKind, now: number): string {
  if (kind === 'daily') return dayKey(now);
  if (kind === 'weekly') return weekKey(now);
  if (kind === 'monthly') return monthKey(now);
  return 'once';
}

function countIn(metric: Metric, kind: TaskKind, context: MeasureContext): number {
  const stamps = stampsFor(metric, context);
  if (kind === 'milestone' || kind === 'starter') return stamps.length;
  const period = periodOf(kind, context.now);
  const keyOf = kind === 'daily' ? dayKey : kind === 'weekly' ? weekKey : monthKey;
  return stamps.filter((at) => keyOf(at) === period).length;
}

interface Template {
  key: string;
  title: string;
  blurb: string;
  metric: Metric;
  goal: number;
  href: string | null;
  marketing?: boolean;
}

/* Daily: checking in and the reveal every day, plus two from this pool. */
const DAILY_POOL: readonly Template[] = [
  { key: 'save1', title: 'Save something you like', blurb: 'Tap the heart on any listing.', metric: 'save', goal: 1, href: '/' },
  { key: 'save3', title: 'Save three finds', blurb: 'Build a wishlist: save three listings today.', metric: 'save', goal: 3, href: '/' },
  { key: 'follow1', title: 'Follow a new shop', blurb: 'Follow a shop to see its drops first.', metric: 'follow', goal: 1, href: '/' },
  { key: 'post1', title: 'Say something in Social', blurb: 'Post a haul, a question or a tip.', metric: 'post', goal: 1, href: '/social' },
  { key: 'order1', title: 'Buy something today', blurb: 'Any order from the catalogue counts.', metric: 'order', goal: 1, href: '/' },
  { key: 'review1', title: 'Rate a seller', blurb: 'Review an order that has arrived.', metric: 'review', goal: 1, href: '/purchases' },
  { key: 'collect1', title: 'Add to your collection', blurb: 'Put a delivered item in your collection.', metric: 'collect', goal: 1, href: '/me?tab=collection' },
];

/* Weekly: five check-ins every week, plus three from this pool. */
const WEEKLY_POOL: readonly Template[] = [
  { key: 'order1', title: 'Place an order', blurb: 'Buy anything from the catalogue this week.', metric: 'order', goal: 1, href: '/' },
  { key: 'order3', title: 'Three orders', blurb: 'Place three orders this week.', metric: 'order', goal: 3, href: '/' },
  { key: 'preorder1', title: 'Join a pre-order', blurb: 'Get into a pre-order before it fills.', metric: 'preorder', goal: 1, href: '/?kind=pre_order' },
  { key: 'review2', title: 'Review two sellers', blurb: 'Rate two orders that arrived.', metric: 'review', goal: 2, href: '/purchases' },
  { key: 'save10', title: 'Save ten finds', blurb: 'Save ten listings this week.', metric: 'save', goal: 10, href: '/' },
  { key: 'follow3', title: 'Follow three shops', blurb: 'Find three new shops to follow.', metric: 'follow', goal: 3, href: '/' },
  { key: 'post3', title: 'Three posts', blurb: 'Post three times in Social.', metric: 'post', goal: 3, href: '/social' },
  { key: 'collect2', title: 'Grow your collection', blurb: 'Add two delivered items to your collection.', metric: 'collect', goal: 2, href: '/me?tab=collection' },
];

/* Monthly: three of these, bigger goals and bigger rewards. */
const MONTHLY_POOL: readonly Template[] = [
  { key: 'order5', title: 'Five orders this month', blurb: 'Place five orders before the month ends.', metric: 'order', goal: 5, href: '/' },
  { key: 'checkin20', title: 'Twenty check-ins', blurb: 'Check in on twenty days this month.', metric: 'checkin', goal: 20, href: null },
  { key: 'review3', title: 'Three reviews', blurb: 'Review three orders this month.', metric: 'review', goal: 3, href: '/purchases' },
  { key: 'preorder2', title: 'Back two pre-orders', blurb: 'Join two pre-orders this month.', metric: 'preorder', goal: 2, href: '/?kind=pre_order' },
  { key: 'collect5', title: 'Curate five', blurb: 'Add five delivered items to your collection.', metric: 'collect', goal: 5, href: '/me?tab=collection' },
];

/*
 * Marketing, one extra slot each week and month drawn from its own pool, so
 * the quests above stay exactly as they were. These count what reached
 * somebody else - a haul shown off, a page shared, a review that helps the
 * next buyer, a Wanted that tells shops what to import.
 */
const MARKETING_WEEKLY: readonly Template[] = [
  { key: 'mk-haul', title: 'Show off a haul', blurb: 'Share something you bought or got delivered - a story, WhatsApp or a friend.', metric: 'sentHaul', goal: 1, href: '/purchases', marketing: true },
  { key: 'mk-page', title: 'Share your page', blurb: 'Send your collector page to someone who collects what you do.', metric: 'sentPage', goal: 1, href: '/me', marketing: true },
  { key: 'mk-want', title: 'Post a Wanted', blurb: 'Tell shops what you are hunting for, so they know what to import.', metric: 'want', goal: 1, href: '/wanted', marketing: true },
  { key: 'mk-detail', title: 'Write a detailed review', blurb: `A review of ${DETAILED_REVIEW_CHARS}+ characters - what arrived, how it was packed, how it looks.`, metric: 'detailed', goal: 1, href: '/purchases', marketing: true },
  { key: 'mk-sent5', title: 'Share five finds', blurb: 'Send five items, hauls or shops out of the app this week.', metric: 'sent', goal: 5, href: '/', marketing: true },
];
const MARKETING_MONTHLY: readonly Template[] = [
  { key: 'mk-opens10', title: 'Ten people opened your links', blurb: 'Share things good enough that ten people tap them this month.', metric: 'open', goal: 10, href: '/', marketing: true },
  { key: 'mk-sent15', title: 'Share fifteen times', blurb: 'Fifteen shares out of the app this month.', metric: 'sent', goal: 15, href: '/', marketing: true },
  { key: 'mk-detail3', title: 'Three detailed reviews', blurb: `Three reviews of ${DETAILED_REVIEW_CHARS}+ characters this month.`, metric: 'detailed', goal: 3, href: '/purchases', marketing: true },
  { key: 'mk-want3', title: 'Three Wanteds', blurb: 'Post three things you are hunting for this month.', metric: 'want', goal: 3, href: '/wanted', marketing: true },
];

const CHECKIN5: Template = {
  key: 'checkin5', title: 'Check in five days', blurb: 'Five check-ins this week, any five days.',
  metric: 'checkin', goal: 5, href: null,
};

/*
 * Marketing, there every period rather than drawn from a pool: bringing other
 * people in is what a marketplace runs on, so it is never a week off. Sending
 * is the daily habit; the weekly and monthly ones only count what actually
 * reached somebody - a link opened by another person, a friend who joined.
 */
const SHARE_DAILY: Template = {
  key: 'share1', title: 'Share a find', blurb: 'Send an item, a haul or your shop to WhatsApp, a story or a friend.',
  metric: 'sent', goal: 1, href: '/', marketing: true,
};
const OPENS_WEEKLY: Template = {
  key: 'opens2', title: 'Two people opened your links', blurb: 'Share something good enough that two people tap it this week.',
  metric: 'open', goal: 2, href: '/', marketing: true,
};
const INVITE_MONTHLY: Template = {
  key: 'invite1', title: 'Bring a friend', blurb: 'Someone joins Figmark with your invite link this month.',
  metric: 'invite', goal: 1, href: '/quests#invite', marketing: true,
};

/*
 * Getting started: one-time steps that set an account up to get something out
 * of the market. Each pays once, and the tab empties as they are collected.
 */
interface Starter {
  key: string;
  title: string;
  blurb: string;
  goal: number;
  href: string | null;
  have: (context: MeasureContext) => number;
  marketing?: boolean;
}

const STARTERS: readonly Starter[] = [
  { key: 'photo', title: 'Add a profile photo', blurb: 'Shops and collectors trust a face over a blank circle.', goal: 1,
    href: '/me?tab=settings', have: ({ facts }) => Number(Boolean(facts.hasPhoto)) },
  { key: 'phone', title: 'Confirm your phone', blurb: 'One code by SMS. It keeps your account yours.', goal: 1,
    href: '/me?tab=settings', have: ({ facts }) => Number(Boolean(facts.phoneVerified)) },
  { key: 'hobbies', title: 'Pick three hobbies', blurb: 'Add three tags to your page - figures, kits, cards, sneakers, whatever you collect.', goal: 3,
    href: '/me?tab=settings', have: ({ facts }) => facts.tagCount ?? 0 },
  { key: 'board', title: 'Join a leaderboard', blurb: 'Pick a hobby board and compete with the people who collect what you do.', goal: 1,
    href: '/quests#boards', have: ({ facts }) => facts.boards ?? 0 },
  { key: 'follow3', title: 'Follow three shops', blurb: 'Their new drops and pre-orders show up first in your feed.', goal: 3,
    href: '/', have: ({ facts }) => facts.follows.length },
  { key: 'save1', title: 'Save your first find', blurb: 'Tap the heart on anything you would buy.', goal: 1,
    href: '/', have: ({ facts }) => facts.likes.length },
  { key: 'notify', title: 'Turn on notifications', blurb: 'Hear the moment a pre-order fills, an order ships or someone replies.', goal: 1,
    href: '/me?tab=settings', have: ({ facts }) => Number(Boolean(facts.pushOn)) },
  { key: 'post1', title: 'Say hello in Social', blurb: 'Post a haul, a question or what you are hunting for.', goal: 1,
    href: '/social', have: ({ facts }) => facts.posts.length },
  { key: 'share1', title: 'Share something', blurb: 'Send a find to a friend or a group - it is how good drops travel.', goal: 1,
    href: '/', have: ({ facts }) => facts.sharesSent.length, marketing: true },
  { key: 'invite1', title: 'Invite a friend', blurb: 'Somebody joins with your invite link.', goal: 1,
    href: '/quests#invite', have: ({ facts }) => facts.invites.length, marketing: true },
  { key: 'order1', title: 'Place your first order', blurb: 'Buyer Protection holds your money until it arrives.', goal: 1,
    href: '/', have: ({ facts }) => facts.orders.length },
  { key: 'review1', title: 'Write your first review', blurb: 'Rate the seller once your order arrives.', goal: 1,
    href: '/purchases', have: ({ facts }) => facts.reviewsWritten.length },
];

interface Ladder {
  key: string;
  name: string;
  metric: Metric | 'streak' | 'profile' | 'refer' | 'scout' | 'level';
  steps: number[];
  blurb: (goal: number) => string;
  href: string | null;
}

/* Milestones repeat with bigger numbers: finish one step and the next appears. */
const LADDERS: readonly Ladder[] = [
  // Marketing first: bringing other people in is what a marketplace runs on.
  // The key stays `shares` so steps collected before opens were counted keep their XP.
  { key: 'shares', name: 'Promoter', metric: 'open', steps: [1, 5, 15, 40],
    blurb: (n) => (n === 1 ? 'Share a link that somebody else opens.' : `${n} people open links you shared.`), href: '/?view=earn' },
  { key: 'referrals', name: 'Rainmaker', metric: 'refer', steps: [1, 5, 15, 40],
    blurb: (n) => (n === 1 ? 'Get someone to buy through your link.' : `${n} sales through your links.`), href: '/?view=earn' },
  { key: 'invites', name: 'Ambassador', metric: 'invite', steps: [1, 5, 15, 40],
    blurb: (n) => (n === 1 ? 'A friend joins Figmark with your invite.' : `${n} friends join with your invite.`), href: '/quests#invite' },
  { key: 'scouts', name: 'Talent Scout', metric: 'scout', steps: [1, 3, 10],
    blurb: (n) => (n === 1 ? 'Invite a seller who opens a shop here.' : `${n} sellers you invited open shops.`), href: '/quests#invite' },
  { key: 'orders', name: 'Haul Hunter', metric: 'order', steps: [1, 5, 10, 25, 50, 100],
    blurb: (n) => (n === 1 ? 'Place your first order.' : `Place ${n} orders in total.`), href: '/' },
  { key: 'preorders', name: 'Backer', metric: 'preorder', steps: [1, 5, 10, 25],
    blurb: (n) => (n === 1 ? 'Join your first pre-order.' : `Join ${n} pre-orders in total.`), href: '/?kind=pre_order' },
  { key: 'reviews', name: 'Critic', metric: 'review', steps: [1, 5, 10, 25, 50],
    blurb: (n) => (n === 1 ? 'Review a seller after an order arrives.' : `Write ${n} reviews in total.`), href: '/purchases' },
  { key: 'collection', name: 'Curator', metric: 'collect', steps: [1, 10, 25, 50],
    blurb: (n) => (n === 1 ? 'Add your first delivered item to your collection.' : `Have ${n} items in your collection.`), href: '/me?tab=collection' },
  { key: 'saves', name: 'Wishlist', metric: 'save', steps: [10, 25, 50, 100],
    blurb: (n) => `Save ${n} items in total.`, href: '/' },
  { key: 'follows', name: 'Fan Club', metric: 'follow', steps: [3, 10, 25],
    blurb: (n) => `Follow ${n} shops.`, href: '/' },
  { key: 'posts', name: 'Town Crier', metric: 'post', steps: [1, 10, 50],
    blurb: (n) => (n === 1 ? 'Make your first post in Social.' : `Make ${n} posts in Social.`), href: '/social' },
  { key: 'wants', name: 'Bounty Hunter', metric: 'want', steps: [1, 5],
    blurb: (n) => (n === 1 ? 'Post something you are hunting for.' : `Post ${n} Wanted requests.`), href: '/wanted' },
  { key: 'streak', name: 'On Fire', metric: 'streak', steps: [7, 30, 100],
    blurb: (n) => `Check in ${n} days in a row.`, href: null },
  // Forums are earned: a new one opens at each of these levels.
  { key: 'forums', name: 'Forum Founder', metric: 'level', steps: [...FORUM_UNLOCK_LEVELS],
    blurb: (n) => `Reach level ${n} to unlock forum #${FORUM_UNLOCK_LEVELS.indexOf(n as typeof FORUM_UNLOCK_LEVELS[number]) + 1}.`,
    href: '/social?view=forums' },
  { key: 'profile', name: 'Show Yourself', metric: 'profile', steps: [2],
    blurb: () => 'Add a bio and a tag to your page.', href: '/me?tab=settings' },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * Every task id that has ever been claimable, with its kind and reward - so a
 * claim made on another day, or from a task since rotated out, still counts.
 */
interface KnownTask { kind: TaskKind; xp: number; title: string }
const KNOWN = new Map<string, KnownTask>();
const PERIODIC: readonly (readonly [Exclude<TaskKind, 'milestone' | 'starter'>, readonly Template[]])[] = [
  ['daily', [...DAILY_POOL, SHARE_DAILY]],
  ['weekly', [...WEEKLY_POOL, CHECKIN5, OPENS_WEEKLY, ...MARKETING_WEEKLY]],
  ['monthly', [...MONTHLY_POOL, INVITE_MONTHLY, ...MARKETING_MONTHLY]],
];
for (const [kind, pool] of PERIODIC) {
  for (const template of pool) KNOWN.set(`${kind}-${template.key}`, { kind, xp: TASK_XP[kind], title: template.title });
}
for (const starter of STARTERS) {
  KNOWN.set(`starter-${starter.key}`, { kind: 'starter', xp: TASK_XP.starter, title: starter.title });
}
for (const ladder of LADDERS) {
  ladder.steps.forEach((goal, index) => {
    KNOWN.set(`ms-${ladder.key}-${goal}`, {
      kind: 'milestone', xp: TIER_XP[index] ?? 0, title: `${ladder.name} ${ROMAN[index] ?? index + 1}`,
    });
  });
}

function known(taskId: string): KnownTask | null {
  return KNOWN.get(taskId) ?? null;
}

/**
 * Metrics a person can take back with a tap - unsaving a listing, unfollowing
 * a shop. A quest met with one of these is only met while it stays met: undo
 * the saves and the quest opens again and its claimed XP goes with it; redo
 * them and the same claim counts again, without claiming twice.
 */
const UNDOABLE: ReadonlySet<Ladder['metric']> = new Set(['save', 'follow']);

const TEMPLATE_BY_ID = new Map<string, { kind: TaskKind; template: Template }>();
for (const [kind, pool] of PERIODIC) {
  for (const template of pool) TEMPLATE_BY_ID.set(`${kind}-${template.key}`, { kind, template });
}

/** Whether a stored claim still stands, given what the person has now. */
function claimStands(key: string, context: MeasureContext): boolean {
  const [taskId = '', period = ''] = key.split(':');
  const entry = TEMPLATE_BY_ID.get(taskId);
  if (entry) {
    if (!UNDOABLE.has(entry.template.metric)) return true;
    const keyOf = entry.kind === 'daily' ? dayKey : entry.kind === 'weekly' ? weekKey : monthKey;
    const count = stampsFor(entry.template.metric, context).filter((at) => keyOf(at) === period).length;
    return count >= entry.template.goal;
  }
  const ladder = LADDERS.find((candidate) => taskId.startsWith(`ms-${candidate.key}-`));
  if (ladder && UNDOABLE.has(ladder.metric)) {
    return ladderProgress(ladder, context) >= Number(taskId.slice(`ms-${ladder.key}-`.length));
  }
  return true;
}

/** The key a claim is stored under: one claim per task per period. */
export function claimKey(taskId: string, now: number = Date.now()): string | null {
  const task = KNOWN.get(taskId);
  if (!task) return null;
  return `${taskId}:${periodOf(task.kind, now)}`;
}

/** A few from a pool, the same few for everybody all period, different next period. */
function pick<T>(pool: readonly T[], count: number, seed: string): T[] {
  return [...pool]
    .map((entry, index) => ({ entry, order: hash(`${seed}|${index}`) }))
    .sort((a, b) => a.order - b.order)
    .slice(0, count)
    .map(({ entry }) => entry);
}

function view(
  context: MeasureContext,
  kind: Exclude<TaskKind, 'milestone' | 'starter'>,
  template: Template,
  auto = false,
): TaskView {
  const id = `${kind}-${template.key}`;
  const progress = Math.min(template.goal, countIn(template.metric, kind, context));
  const done = progress >= template.goal;
  const key = `${id}:${periodOf(kind, context.now)}`;
  const claimed = auto ? done : Boolean(context.state.claimed[key]) && claimStands(key, context);
  return {
    id, kind, title: template.title, blurb: template.blurb, xp: TASK_XP[kind], bumps: BUMPS_FOR[kind],
    progress, goal: template.goal,
    done, claimed, claimable: done && !claimed, href: template.href,
    ...(template.marketing ? { marketing: true } : {}),
  };
}

function ladderProgress(ladder: Ladder, context: MeasureContext): number {
  if (ladder.metric === 'streak') return context.streak.best;
  if (ladder.metric === 'profile') return Number(context.facts.hasBio) + Number(context.facts.hasTags);
  if (ladder.metric === 'refer') return context.facts.referredSales;
  if (ladder.metric === 'scout') return context.facts.invitedSellers;
  // The level last worked out: the one being worked out now includes this.
  if (ladder.metric === 'level') return context.state.levelCache ?? 1;
  return countIn(ladder.metric, 'milestone', context);
}

/** Whether today's reveal has been flipped. */
function revealedOn(state: QuestState, now: number): boolean {
  return (state.reveals ?? []).includes(dayKey(now));
}

function tasksFor(context: MeasureContext): TaskView[] {
  const { now, state } = context;
  const tasks: TaskView[] = [];

  // Daily: the two that are always there, then today's two.
  tasks.push({
    ...view(context, 'daily', { key: 'checkin', title: 'Check in', blurb: 'Open the vault and keep your streak alive.', metric: 'checkin', goal: 1, href: null }, true),
    id: 'daily-checkin',
  });
  const revealed = revealedOn(state, now);
  tasks.push({
    id: 'daily-reveal', kind: 'daily', title: 'Reveal today\'s loot', blurb: 'Flip the daily drop to see today\'s pick.',
    xp: XP.reveal, bumps: 0, progress: revealed ? 1 : 0, goal: 1, done: revealed, claimed: revealed, claimable: false,
    // The daily drop is flipped on the Shop page, at the top.
    href: revealed ? null : '/',
  });
  tasks.push(view(context, 'daily', SHARE_DAILY));
  for (const template of pick(DAILY_POOL, 2, `daily|${dayKey(now)}`)) tasks.push(view(context, 'daily', template));

  tasks.push(view(context, 'weekly', CHECKIN5));
  tasks.push(view(context, 'weekly', OPENS_WEEKLY));
  for (const template of pick(WEEKLY_POOL, 3, `weekly|${weekKey(now)}`)) tasks.push(view(context, 'weekly', template));
  for (const template of pick(MARKETING_WEEKLY, 1, `weekly-mk|${weekKey(now)}`)) tasks.push(view(context, 'weekly', template));

  tasks.push(view(context, 'monthly', INVITE_MONTHLY));
  for (const template of pick(MONTHLY_POOL, 3, `monthly|${monthKey(now)}`)) tasks.push(view(context, 'monthly', template));
  for (const template of pick(MARKETING_MONTHLY, 1, `monthly-mk|${monthKey(now)}`)) tasks.push(view(context, 'monthly', template));

  // Getting started: every step not yet collected, in the order they are worth doing.
  for (const starter of STARTERS) {
    const id = `starter-${starter.key}`;
    const progress = Math.min(starter.goal, starter.have(context));
    const done = progress >= starter.goal;
    const claimed = Boolean(state.claimed[`${id}:once`]);
    tasks.push({
      id, kind: 'starter', title: starter.title, blurb: starter.blurb, xp: TASK_XP.starter, bumps: 0,
      progress, goal: starter.goal, done, claimed, claimable: done && !claimed, href: starter.href,
      ...(starter.marketing ? { marketing: true } : {}),
    });
  }

  // Milestones: the lowest step on each ladder not yet collected.
  for (const ladder of LADDERS) {
    const progress = ladderProgress(ladder, context);
    let index = ladder.steps.findIndex((goal) => {
      const key = `ms-${ladder.key}-${goal}:once`;
      return !state.claimed[key] || !claimStands(key, context);
    });
    const finished = index === -1;
    if (finished) index = ladder.steps.length - 1;
    const goal = ladder.steps[index] ?? 1;
    const done = progress >= goal;
    tasks.push({
      id: `ms-${ladder.key}-${goal}`,
      kind: 'milestone',
      title: `${ladder.name} ${ladder.steps.length > 1 ? ROMAN[index] ?? '' : ''}`.trim(),
      blurb: ladder.blurb(goal),
      xp: TIER_XP[index] ?? 0,
      bumps: 0,
      progress: Math.min(goal, progress),
      goal,
      done,
      claimed: finished,
      claimable: done && !finished,
      href: ladder.href,
      step: { index: index + 1, of: ladder.steps.length },
    });
  }
  return tasks;
}

/* -------------------------------------------------------------------------- */
/* Honours                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Honours are the badges a page wears. (In the code and the API they are still
 * called stickers, their first name; everything a person reads says Honours.)
 * Each climbs five tiers, Bronze to Diamond; a one-off honour is simply earned
 * and wears the top rim.
 */
export type StickerTier = 0 | 1 | 2 | 3 | 4 | 5;
export const STICKER_TIER_NAMES = ['Locked', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'] as const;
export const HONOUR_TIER_NAMES = STICKER_TIER_NAMES;
/** The tier a one-step honour reads as once earned. */
export const SINGLE_STEP_TIER: StickerTier = 5;

/** What a tier list asks for, in words: "Bronze 1 · Silver 10 · Gold 50 · …". */
export function honourHow(how: string, tiers: readonly number[]): string {
  if (tiers.length <= 1) return how;
  return `${how}: ${tiers.map((threshold, index) => `${STICKER_TIER_NAMES[index + 1]} ${threshold}`).join(' · ')}.`;
}

/** Which tier a count reaches, and what the next one asks. */
export function honourTier(have: number, tiers: readonly number[]): { tier: StickerTier; reached: number; next: number | null } {
  const reached = tiers.filter((threshold) => have >= threshold).length;
  const tier = (tiers.length === 1 ? (reached ? SINGLE_STEP_TIER : 0) : reached) as StickerTier;
  return { tier, reached, next: tiers.find((threshold) => have < threshold) ?? null };
}

export interface StickerView {
  id: string;
  name: string;
  /** What it tells somebody looking at the profile. */
  meaning: string;
  /** How to earn it, and what each tier needs. */
  how: string;
  hue: 'gold' | 'violet' | 'aqua' | 'coral' | 'lime' | 'pink' | 'blue';
  glyph: 'bolt' | 'chest' | 'crest' | 'flame' | 'star' | 'heart' | 'chat' | 'bag' | 'shield' | 'crown' | 'clock' | 'gift';
  /** Thresholds for Bronze to Diamond - or one number for a one-step honour. */
  tiers: number[];
  tier: StickerTier;
  have: number;
  /** What the next tier needs, or null at the top. */
  next: number | null;
  earned: boolean;
}

interface StickerDef {
  id: string;
  name: string;
  meaning: string;
  /** The action, without numbers: the tiers are added to it. */
  how: string;
  hue: StickerView['hue'];
  glyph: StickerView['glyph'];
  tiers: number[];
  have: (context: MeasureContext) => number;
}

const DAY = 86_400_000;

const STICKERS: readonly StickerDef[] = [
  { id: 'ambassador', name: 'Ambassador', hue: 'pink', glyph: 'heart', tiers: [1, 10, 40, 100, 250],
    meaning: 'Brings people to Figmark: friends and shops joined through their invite.',
    how: 'Friends who sign up with your invite',
    have: ({ facts }) => facts.invites.length },
  { id: 'promoter', name: 'Promoter', hue: 'aqua', glyph: 'bolt', tiers: [5, 50, 250, 1000, 5000],
    meaning: 'Shares finds people actually open - the reason half the market hears about a drop.',
    how: 'People opening links you shared',
    have: ({ facts }) => facts.shareOpens.length },
  { id: 'haul', name: 'Haul Hunter', hue: 'gold', glyph: 'bag', tiers: [1, 10, 50, 150, 500],
    meaning: 'A real, active buyer. Sellers can see this person actually buys, not just browses.',
    how: 'Place orders',
    have: ({ facts }) => facts.orders.length },
  { id: 'backer', name: 'Backer', hue: 'violet', glyph: 'bolt', tiers: [1, 5, 25, 75, 200],
    meaning: 'Helps pre-orders reach their goal, so shops can import things the community wants.',
    how: 'Join pre-orders',
    have: ({ facts }) => facts.orders.filter((order) => order.preOrder).length + facts.pledges },
  { id: 'early-backer', name: 'Early Backer', hue: 'lime', glyph: 'clock', tiers: [1, 5, 15, 40, 100],
    meaning: `Gets into pre-orders in their first ${EARLY_BACK_HOURS} hours - the push that tells a shop the import is worth it.`,
    how: `Join pre-orders within ${EARLY_BACK_HOURS} hours of them opening`,
    have: ({ facts }) => facts.orders.filter((order) => order.preOrder && order.early).length },
  { id: 'critic', name: 'Critic', hue: 'blue', glyph: 'star', tiers: [1, 10, 50, 150, 500],
    meaning: 'Leaves honest reviews after orders arrive, which helps every other buyer choose.',
    how: 'Review sellers',
    have: ({ facts }) => facts.reviewsWritten.length },
  { id: 'wordsmith', name: 'Wordsmith', hue: 'violet', glyph: 'chat', tiers: [1, 10, 25, 50, 100],
    meaning: 'Writes reviews with real detail - packing, condition, how it looks in hand.',
    how: `Write reviews of ${DETAILED_REVIEW_CHARS} characters or more`,
    have: ({ facts }) => facts.reviewsWritten.filter((review) => review.detailed).length },
  { id: 'five-star', name: 'Five-Star Buyer', hue: 'gold', glyph: 'crest', tiers: [1, 5, 25, 75, 200],
    meaning: 'Sellers rated this buyer five stars: pays on time and is easy to deal with.',
    how: 'Get five-star ratings from sellers',
    have: ({ facts }) => facts.ratingsReceived.filter((stars) => stars === 5).length },
  { id: 'clean-record', name: 'Clean Record', hue: 'aqua', glyph: 'shield', tiers: [3, 15, 50, 150, 500],
    meaning: 'Completes orders without ever losing a dispute - one of the strongest trust signals here.',
    how: 'Complete orders with no dispute lost (losing one resets it)',
    have: ({ facts }) => (facts.disputesLost > 0 ? 0 : facts.orders.filter((order) => order.status === 'delivered').length) },
  { id: 'loyal-patron', name: 'Loyal Patron', hue: 'coral', glyph: 'heart', tiers: [3, 5, 10, 25, 50],
    meaning: 'Keeps coming back to the same shop - the regular every seller hopes for.',
    how: 'Orders from your favourite shop',
    have: ({ facts }) => Math.max(0, ...shopCounts(facts).values()) },
  { id: 'explorer', name: 'Explorer', hue: 'aqua', glyph: 'gift', tiers: [3, 10, 25, 50, 100],
    meaning: 'Buys from many different shops, and knows the market well.',
    how: 'Different shops you have ordered from',
    have: ({ facts }) => shopCounts(facts).size },
  { id: 'curator', name: 'Curator', hue: 'pink', glyph: 'heart', tiers: [1, 10, 50, 150, 500],
    meaning: 'Shows off a real collection built from purchases delivered through Figmark.',
    how: 'Add delivered items to your collection',
    have: ({ facts }) => facts.collection.length },
  { id: 'on-fire', name: 'On Fire', hue: 'coral', glyph: 'flame', tiers: [7, 30, 100, 200, 365],
    meaning: 'Shows up day after day. A dedicated member of the community.',
    how: 'Check in days in a row (best streak counts)',
    have: ({ streak }) => streak.best },
  { id: 'town-crier', name: 'Town Crier', hue: 'lime', glyph: 'chat', tiers: [1, 10, 50, 150, 500],
    meaning: 'An active voice in the forums: shares hauls, answers questions, helps others.',
    how: 'Post in Social',
    have: ({ facts }) => facts.posts.length },
  { id: 'mentor', name: 'Mentor', hue: 'blue', glyph: 'crest', tiers: [1, 10, 25, 50, 100],
    meaning: 'Answers other collectors\' questions well enough that the asker marks it as the answer.',
    how: 'Answers marked as the answer',
    have: ({ facts }) => facts.helpfulAnswers ?? 0 },
  { id: 'bounty-hunter', name: 'Bounty Hunter', hue: 'gold', glyph: 'star', tiers: [1, 5, 15, 40, 100],
    meaning: 'Posts what they are hunting for, so shops know what to bring in.',
    how: 'Post Wanted requests',
    have: ({ facts }) => facts.wants.length },
  { id: 'champion', name: 'Champion', hue: 'gold', glyph: 'crown', tiers: [1, 3, 10, 25, 50],
    meaning: 'Wins photo competitions and weekly challenges.',
    how: 'Win competitions',
    have: ({ facts }) => facts.wins?.contest ?? 0 },
  { id: 'debate-master', name: 'Debate Master', hue: 'violet', glyph: 'chat', tiers: [1, 3, 10, 25, 50],
    meaning: 'Made the argument the community voted best.',
    how: 'Win debates',
    have: ({ facts }) => facts.wins?.debate ?? 0 },
  { id: 'sharp-eye', name: 'Sharp Eye', hue: 'aqua', glyph: 'star', tiers: [1, 3, 10, 25, 50],
    meaning: 'Knows what things are worth: closest guess on guess-the-price.',
    how: 'Win guess-the-price',
    have: ({ facts }) => facts.wins?.guess ?? 0 },
  { id: 'season-podium', name: 'Season Podium', hue: 'gold', glyph: 'crown', tiers: [1, 3, 10, 25, 50],
    meaning: 'Finished in the top three of a hobby leaderboard season.',
    how: 'Top-three finishes on hobby leaderboards',
    have: ({ facts }) => facts.podiums ?? 0 },
  { id: 'anniversary', name: 'Anniversary', hue: 'pink', glyph: 'gift', tiers: [1, 2, 3, 4, 5],
    meaning: 'Years spent in the community.',
    how: 'Years on Figmark',
    have: ({ facts, now }) => (facts.joinedAt ? Math.floor((now - Date.parse(facts.joinedAt)) / (365 * DAY)) : 0) },
  { id: 'founding-member', name: 'Founding Member', hue: 'violet', glyph: 'crest', tiers: [1],
    meaning: 'Joined Figmark in its founding season, before July 2027.',
    how: 'Join before 1 July 2027. It cannot be earned any more after that.',
    have: ({ facts }) => Number(Boolean(facts.joinedAt && Date.parse(facts.joinedAt) < Date.parse(FOUNDING_BEFORE))) },
];

/** Orders per shop. */
function shopCounts(facts: QuestFacts): Map<string, number> {
  const counts = new Map<string, number>();
  for (const order of facts.orders) {
    if (!order.sellerId) continue;
    counts.set(order.sellerId, (counts.get(order.sellerId) ?? 0) + 1);
  }
  return counts;
}

function stickerView(def: StickerDef, context: MeasureContext): StickerView {
  const have = def.have(context);
  const { tier, next } = honourTier(have, def.tiers);
  const { have: _count, how, ...rest } = def;
  return { ...rest, how: honourHow(how, def.tiers), tier, have, next, earned: tier > 0 };
}

/* -------------------------------------------------------------------------- */
/* The whole view                                                             */
/* -------------------------------------------------------------------------- */

export interface XpLine {
  label: string;
  xp: number;
  /** One line of how it was worked out, e.g. "3 × 40". */
  detail?: string;
}

export interface QuestView {
  xp: number;
  level: number;
  title: string;
  /** XP at the start of this level, and at the start of the next. */
  levelFloor: number;
  nextLevelXp: number;
  /** 0-1 through the current level. */
  progress: number;
  streak: Streak;
  tasks: TaskView[];
  /** Honours (stored and sent as stickers). */
  stickers: StickerView[];
  dailyRevealed: boolean;
  /** Where the XP came from, gains and losses both, so the number can be checked. */
  breakdown: XpLine[];
  /** The losses on their own, as a positive number (0 when there are none). */
  penalty: number;
  /** Bump points saved up to spend on the person's own listings. */
  bumps: number;
  /** Why the level is lower than the XP would give, when the record is holding it back. */
  heldBack?: string | null;
}

/**
 * XP from the record itself: what a person did, and how others found them.
 *
 * Saves, follows and posts are capped so that XP tracks being a good member of
 * the market rather than tapping one button a thousand times. Bad ratings and
 * lost disputes take XP away - a level says something about how a person
 * trades, not only how much.
 */
function recordXp(facts: QuestFacts): XpLine[] {
  const preOrders = facts.orders.filter((order) => order.preOrder).length;
  const stars = (value: number) => facts.ratingsReceived.filter((rating) => rating === value).length;
  const pageStars = (value: number) => facts.pageRatings.filter((rating) => rating === value).length;
  const line = (label: string, count: number, each: number) => ({ label, xp: actionXp(count, each), detail: `${count} × ${each}, up to ${ACTION_CAP}` });
  const delivered = facts.orders.filter((order) => order.status === 'delivered').length;

  return [
    line('Orders completed', delivered, XP.orderDelivered),
    line('Orders placed', facts.orders.length, XP.orderPlaced),
    line('Pre-orders joined', preOrders, XP.preOrderJoined),
    line('Reviews written after an order', facts.reviewsWritten.length, XP.reviewWritten),
    line('Good ratings from sellers', stars(5) + stars(4), XP.goodRatingReceived),
    line('Sales through your links', facts.referredSales, XP.referredSale),
    line('Collection items', facts.collection.length, XP.collectionItem),
    line('Friends who joined with your invite', facts.invites.length, XP.invite),
    { label: 'Shops you brought in', xp: actionXp(facts.invitedSellers, XP.invitedSeller), detail: `${facts.invitedSellers} × ${XP.invitedSeller}, up to ${ACTION_CAP}` },
    line('People who opened your links', facts.shareOpens.length, XP.shareOpen),
    line('Social posts', facts.posts.length, XP.post),
    line('Wanted posts', facts.wants.length, XP.want),
    line('Shops followed', facts.follows.length, XP.follow),
    line('Items saved', facts.likes.length, XP.like),
    { label: 'Low ratings from sellers', xp: -(actionXp(stars(2)) + actionXp(stars(1), ACTION_XP * 2)), detail: `${stars(2)} two-star × −${ACTION_XP}, ${stars(1)} one-star × −${ACTION_XP * 2}` },
    { label: 'Low page reviews', xp: -Math.min(5 * ACTION_XP, actionXp(pageStars(2), ACTION_XP / 2) + actionXp(pageStars(1))), detail: `${pageStars(2)} two-star × −${ACTION_XP / 2}, ${pageStars(1)} one-star × −${ACTION_XP}, at most −${5 * ACTION_XP}` },
    { label: 'Disputes lost', xp: -actionXp(facts.disputesLost, ACTION_XP * 4), detail: `${facts.disputesLost} × −${ACTION_XP * 4}` },
    ...(facts.penaltyXp
      ? [{ label: 'Community manager decisions', xp: -facts.penaltyXp, detail: `${facts.penaltyXp} XP taken by dispute decisions` }]
      : []),
  ];
}

export function questView(
  userId: string,
  facts: QuestFacts,
  stored: QuestState | undefined,
  now: number = Date.now(),
): QuestView {
  void userId;
  const state = stored ?? emptyQuestState();
  const streak = streakOf(state.checkIns, now);
  const context: MeasureContext = { facts, state, streak, now };

  // Every day checked in is one action; keeping a streak pays through On Fire.
  const checkInDays = [...new Set(state.checkIns)];
  const checkIn = checkInDays.length * XP.checkIn;

  // A claim whose quest has since been undone (the saves taken back) pays nothing.
  const standing = Object.keys(state.claimed).filter((key) => claimStands(key, context));
  let claimedXp = 0;
  for (const key of standing) claimedXp += known(key.split(':')[0] ?? '')?.xp ?? 0;
  const reveals = new Set(state.reveals ?? []).size;

  const breakdown = [
    ...recordXp(facts),
    { label: 'Check-ins', xp: checkIn, detail: `${checkInDays.length} day${checkInDays.length === 1 ? '' : 's'}, more for streaks` },
    { label: 'Quests completed', xp: claimedXp + reveals * XP.reveal, detail: `${standing.length} claimed + ${reveals} reveal${reveals === 1 ? '' : 's'} × ${XP.reveal}` },
  ].filter((line) => line.xp !== 0);

  const penalty = -breakdown.filter((line) => line.xp < 0).reduce((sum, line) => sum + line.xp, 0);
  // Losses can take a person down levels, but never below zero.
  const xp = Math.max(0, breakdown.reduce((sum, line) => sum + line.xp, 0));

  const completed = facts.orders.filter((order) => order.status === 'delivered').length;
  const { level, heldBack } = levelWithRecord(xp, completed, facts.disputesLost);
  const levelFloor = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const progress = level >= MAX_LEVEL || heldBack ? 1 : (xp - levelFloor) / (nextLevelXp - levelFloor);

  return {
    xp,
    level,
    title: titleFor(level),
    levelFloor,
    nextLevelXp,
    progress,
    streak,
    tasks: tasksFor(context),
    stickers: STICKERS.map((def) => stickerView(def, context)),
    dailyRevealed: revealedOn(state, now),
    breakdown,
    penalty,
    bumps: state.bumps ?? 0,
    heldBack,
  };
}

/**
 * Tidies the stored state before it is written back.
 *
 * Only duplicates go. Nothing is trimmed by age, because XP is counted from
 * these lists - dropping an old claim or reveal would quietly take XP away.
 * They grow by a few entries a day at most, which a user document carries easily.
 */
export function tidyQuestState(state: QuestState): QuestState {
  return {
    ...state,
    checkIns: [...new Set(state.checkIns)].sort(),
    reveals: [...new Set(state.reveals ?? [])].sort(),
    ...(state.bumpLog ? { bumpLog: state.bumpLog.slice(-100) } : {}),
  };
}
