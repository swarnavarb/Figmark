import type { Listing, OwnedCard, QuestState } from './models.js';
import { FORUM_UNLOCK_LEVELS } from './enums.js';

/**
 * The collector game, as rules.
 *
 * One definition used by both sides: the API works out XP, tasks and packs
 * from the rows when somebody asks, and the app reads a listing's rarity off
 * the same function the server would use - so a card that says "Legendary" on
 * the feed never opens a page that disagrees.
 *
 * Almost nothing here is stored. XP is counted from what a person has actually
 * done (orders, reviews, saves, posts), so it cannot drift from the record and
 * cannot be farmed by writing a number. The only things kept are the ones no
 * other row remembers: which days somebody checked in, which task rewards they
 * collected, and which cards came out of which pack.
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

const TITLES = [
  'Rookie', 'Scout', 'Seeker', 'Hunter', 'Collector',
  'Curator', 'Connoisseur', 'Vault Keeper', 'Grandmaster', 'Legend',
];

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
export const ACTION_CAP = 100;
export const TASK_XP = { daily: 20, weekly: 60, monthly: 180 } as const;
export const TIER_XP = [60, 150, 300, 500, 800, 1200] as const;

/*
 * Bump points: what a weekly or monthly quest pays on top of XP, on either
 * side. One Bump on an item spends one and puts it back at the top of the
 * feed: the shop's points first, then those of whoever pressed it - so
 * bumping is earned by taking part, not by tapping a button.
 */
export const BUMPS_FOR: Record<'daily' | 'weekly' | 'monthly' | 'milestone', number> = { daily: 0, weekly: 1, monthly: 2, milestone: 0 };
/** A Bump this soon after the last one would spend a point for nothing, so it is refused. */
export const BUMP_GUARD_MS = 60 * 60 * 1000;

/** One kind of counted action, capped like every other. */
export function actionXp(count: number, each = ACTION_XP): number {
  return Math.min(Math.max(count, 0), ACTION_CAP) * each;
}

/** A milestone ladder's worth for the steps reached. */
export function tierXp(reached: number): number {
  return TIER_XP.slice(0, reached).reduce((sum, xp) => sum + xp, 0);
}

export function levelFor(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

/** Past level 10 a new title lands at 15, 20, 30 and 50. */
const HIGH_LEVELS = [50, 30, 20, 15];
const HIGH_TITLES = ['Immortal', 'Titan', 'Icon', 'Mythic'];

/** The title for a level: one per level up to ten, then one per band. */
export function titleIn(level: number, low: readonly string[], high: readonly string[]): string {
  const band = HIGH_LEVELS.findIndex((floor) => level >= floor);
  return (band >= 0 ? high[band] : low[Math.min(Math.max(level, 1), low.length) - 1]) ?? 'Legend';
}

export function titleFor(level: number): string {
  return titleIn(level, TITLES, HIGH_TITLES);
}

/* -------------------------------------------------------------------------- */
/* Cards                                                                      */
/* -------------------------------------------------------------------------- */

export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';

export const CARD_RARITIES: readonly CardRarity[] = ['common', 'rare', 'epic', 'legendary'];

export interface CardSet {
  id: string;
  name: string;
  hue: 'aqua' | 'coral' | 'violet' | 'lime';
}

export const CARD_SETS: readonly CardSet[] = [
  { id: 'mecha', name: 'Mecha Hangar', hue: 'aqua' },
  { id: 'kaiju', name: 'Kaiju Isle', hue: 'coral' },
  { id: 'arcana', name: 'Arcana Deck', hue: 'violet' },
  { id: 'street', name: 'Street Kicks', hue: 'lime' },
];

export interface CardDef {
  id: string;
  name: string;
  set: string;
  rarity: CardRarity;
  /** Which drawn glyph the app puts on the face. */
  glyph: 'mech' | 'beast' | 'card' | 'shoe' | 'box' | 'star';
  /** One line of flavour, shown when the card is opened. */
  lore: string;
}

/** Six per set: two common, two rare, one epic, one legendary. */
export const CARDS: readonly CardDef[] = [
  { id: 'mecha-1', name: 'Scout Frame', set: 'mecha', rarity: 'common', glyph: 'mech', lore: 'Every hangar starts with one frame and a lot of plans.' },
  { id: 'mecha-2', name: 'Hangar Drone', set: 'mecha', rarity: 'common', glyph: 'box', lore: 'Keeps the runners sorted so you never lose a part.' },
  { id: 'mecha-3', name: 'Wing Lancer', set: 'mecha', rarity: 'rare', glyph: 'mech', lore: 'Built for speed; the first kit most collectors finish.' },
  { id: 'mecha-4', name: 'Beam Rifle', set: 'mecha', rarity: 'rare', glyph: 'star', lore: 'The accessory every display shelf ends up needing.' },
  { id: 'mecha-5', name: 'Zero Custom', set: 'mecha', rarity: 'epic', glyph: 'mech', lore: 'A custom build that only shows up in limited runs.' },
  { id: 'mecha-6', name: 'Perfect Grade', set: 'mecha', rarity: 'legendary', glyph: 'mech', lore: 'The grail of the hangar: the kit people wait years for.' },
  { id: 'kaiju-1', name: 'Tide Pup', set: 'kaiju', rarity: 'common', glyph: 'beast', lore: 'Small, loud, and always first off the boat.' },
  { id: 'kaiju-2', name: 'Reef Crawler', set: 'kaiju', rarity: 'common', glyph: 'beast', lore: 'Found in every mixed lot, loved by every collector.' },
  { id: 'kaiju-3', name: 'Storm Wing', set: 'kaiju', rarity: 'rare', glyph: 'beast', lore: 'Rides the monsoon winds into the import season.' },
  { id: 'kaiju-4', name: 'Magma Horn', set: 'kaiju', rarity: 'rare', glyph: 'beast', lore: 'Glows when a pre-order is about to fill.' },
  { id: 'kaiju-5', name: 'Deep King', set: 'kaiju', rarity: 'epic', glyph: 'beast', lore: 'Rules the deep end of the catalogue.' },
  { id: 'kaiju-6', name: 'Dragon Knight', set: 'kaiju', rarity: 'legendary', glyph: 'beast', lore: 'The resin legend that sells out before it lands.' },
  { id: 'arcana-1', name: 'The Novice', set: 'arcana', rarity: 'common', glyph: 'card', lore: 'The first card of every journey through the market.' },
  { id: 'arcana-2', name: 'The Trader', set: 'arcana', rarity: 'common', glyph: 'card', lore: 'Knows a fair price when they see one.' },
  { id: 'arcana-3', name: 'The Seer', set: 'arcana', rarity: 'rare', glyph: 'star', lore: 'Sees which drops will be legendary before they are.' },
  { id: 'arcana-4', name: 'The Vault', set: 'arcana', rarity: 'rare', glyph: 'box', lore: 'Guards everything you have ever saved.' },
  { id: 'arcana-5', name: 'The Crown', set: 'arcana', rarity: 'epic', glyph: 'card', lore: 'Worn by those who complete what they start.' },
  { id: 'arcana-6', name: 'Foil Ace', set: 'arcana', rarity: 'legendary', glyph: 'card', lore: 'The foil every binder is built around.' },
  { id: 'street-1', name: 'Daily Runner', set: 'street', rarity: 'common', glyph: 'shoe', lore: 'Worn every day, collected by everybody.' },
  { id: 'street-2', name: 'Canvas Low', set: 'street', rarity: 'common', glyph: 'shoe', lore: 'A classic that never really goes out.' },
  { id: 'street-3', name: 'Retro High', set: 'street', rarity: 'rare', glyph: 'shoe', lore: 'The pair that started the hunt.' },
  { id: 'street-4', name: 'Deadstock Box', set: 'street', rarity: 'rare', glyph: 'box', lore: 'Never worn, never opened, never selling cheap.' },
  { id: 'street-5', name: 'Collab Pair', set: 'street', rarity: 'epic', glyph: 'shoe', lore: 'Two names on one tongue label; gone in minutes.' },
  { id: 'street-6', name: 'Grail', set: 'street', rarity: 'legendary', glyph: 'shoe', lore: 'The pair you only talk about in whispers.' },
];

export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

/** XP a pulled card is worth, so a lucky pull is a small boost and not a free level. */
export const CARD_XP: Record<CardRarity, number> = { common: ACTION_XP, rare: ACTION_XP, epic: ACTION_XP, legendary: ACTION_XP };

const CARD_WEIGHTS: Record<CardRarity, number> = { common: 55, rare: 28, epic: 13, legendary: 4 };

/** FNV-1a: small, pure and the same in the browser and on the server. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * The card a pack holds for one person.
 *
 * Deterministic from who and which pack, so opening it twice (a retry, a
 * double tap) can only ever produce the same card, and nobody can reroll a
 * pull by asking again. `min` lifts the floor for packs that were worked for.
 */
export function drawCard(userId: string, packId: string, min: CardRarity = 'common'): CardDef {
  const floor = CARD_RARITIES.indexOf(min);
  const allowed = CARD_RARITIES.filter((_, index) => index >= floor);
  const total = allowed.reduce((sum, rarity) => sum + CARD_WEIGHTS[rarity], 0);
  let roll = hash(`${userId}|${packId}|rarity`) % total;
  let rarity: CardRarity = allowed[0] ?? 'common';
  for (const candidate of allowed) {
    if (roll < CARD_WEIGHTS[candidate]) {
      rarity = candidate;
      break;
    }
    roll -= CARD_WEIGHTS[candidate];
  }
  const pool = CARDS.filter((card) => card.rarity === rarity);
  return pool[hash(`${userId}|${packId}|card`) % pool.length] ?? CARDS[0]!;
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
  orders: { createdAt: string; status: string; totalMinor: number; preOrder: boolean }[];
  reviewsWritten: { createdAt: string }[];
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
  /** Times this person sent something out of the app - WhatsApp, a story, a copied link. */
  sharesSent: { createdAt: string }[];
  /** Friends who signed up through this person's invite. */
  invites: { createdAt: string }[];
  /** Of those, how many opened a shop. */
  invitedSellers: number;
}

/** XP for finishing a card set - the reward that gives a set its point. */
export const SET_BONUS_XP = TIER_XP[2];

export function emptyQuestState(): QuestState {
  return { checkIns: [], claimed: {}, cards: [] };
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

export type TaskKind = 'daily' | 'weekly' | 'monthly' | 'milestone';

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
  /** Milestones hand out a card pack as well as XP. */
  pack: boolean;
  /** For a milestone ladder: which step this is, of how many. */
  step?: { index: number; of: number };
}

type Metric = 'order' | 'preorder' | 'review' | 'save' | 'follow' | 'post' | 'want' | 'collect' | 'checkin'
  | 'open' | 'sent' | 'invite';

interface MeasureContext {
  facts: QuestFacts;
  state: QuestState;
  streak: Streak;
  now: number;
}

/** When each fact happened, so a count can be limited to today, this week or this month. */
function stampsFor(metric: Metric, { facts, state }: MeasureContext): string[] {
  switch (metric) {
    case 'order': return facts.orders.map((order) => order.createdAt);
    case 'preorder': return facts.orders.filter((order) => order.preOrder).map((order) => order.createdAt);
    case 'review': return facts.reviewsWritten.map((review) => review.createdAt);
    case 'save': return facts.likes.map((like) => like.createdAt);
    case 'follow': return facts.follows.map((follow) => follow.createdAt);
    case 'post': return facts.posts.map((post) => post.createdAt);
    case 'want': return facts.wants.map((want) => want.createdAt);
    case 'collect': return facts.collection.map((item) => item.addedAt);
    case 'checkin': return state.checkIns.map((day) => `${day}T12:00:00+05:30`);
    case 'open': return facts.shareOpens.map((open) => open.createdAt);
    case 'sent': return facts.sharesSent.map((sent) => sent.createdAt);
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
  if (kind === 'milestone') return stamps.length;
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
  metric: 'sent', goal: 1, href: '/',
};
const OPENS_WEEKLY: Template = {
  key: 'opens2', title: 'Two people opened your links', blurb: 'Share something good enough that two people tap it this week.',
  metric: 'open', goal: 2, href: '/',
};
const INVITE_MONTHLY: Template = {
  key: 'invite1', title: 'Bring a friend', blurb: 'Someone joins Figmark with your invite link this month.',
  metric: 'invite', goal: 1, href: '/quests#invite',
};

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
interface KnownTask { kind: TaskKind; xp: number; title: string; pack: boolean }
const KNOWN = new Map<string, KnownTask>();
for (const [kind, pool] of [['daily', [...DAILY_POOL, SHARE_DAILY]], ['weekly', [...WEEKLY_POOL, CHECKIN5, OPENS_WEEKLY]], ['monthly', [...MONTHLY_POOL, INVITE_MONTHLY]]] as const) {
  for (const template of pool) KNOWN.set(`${kind}-${template.key}`, { kind, xp: TASK_XP[kind], title: template.title, pack: false });
}
for (const ladder of LADDERS) {
  ladder.steps.forEach((goal, index) => {
    KNOWN.set(`ms-${ladder.key}-${goal}`, {
      kind: 'milestone', xp: TIER_XP[index] ?? 0, title: `${ladder.name} ${ROMAN[index] ?? index + 1}`, pack: true,
    });
  });
}

/**
 * Tasks from the first version of the game, which people may already have
 * collected. Kept so nobody loses XP or an unopened pack to a redesign.
 */
const LEGACY: Record<string, KnownTask> = {
  save: { kind: 'daily', xp: 15, title: 'Save something', pack: false },
  order: { kind: 'weekly', xp: 60, title: 'Place an order', pack: false },
  group: { kind: 'weekly', xp: 40, title: 'Join a pre-order', pack: false },
  social: { kind: 'weekly', xp: 25, title: 'Post in Social', pack: false },
  streak5: { kind: 'weekly', xp: 50, title: 'Check in five days', pack: false },
  'first-order': { kind: 'milestone', xp: 100, title: 'First haul', pack: true },
  'five-orders': { kind: 'milestone', xp: 250, title: 'Regular', pack: true },
  'first-review': { kind: 'milestone', xp: 80, title: 'Critic', pack: true },
  'five-reviews': { kind: 'milestone', xp: 200, title: 'Trusted voice', pack: true },
  'ten-saves': { kind: 'milestone', xp: 60, title: 'Wishlist', pack: true },
  'three-follows': { kind: 'milestone', xp: 60, title: 'Fan club', pack: true },
  profile: { kind: 'milestone', xp: 50, title: 'Show yourself', pack: true },
  want: { kind: 'milestone', xp: 40, title: 'Bounty hunter', pack: true },
  streak7: { kind: 'milestone', xp: 150, title: 'On fire', pack: true },
};

function known(taskId: string): KnownTask | null {
  return KNOWN.get(taskId) ?? LEGACY[taskId] ?? null;
}

/**
 * Metrics a person can take back with a tap - unsaving a listing, unfollowing
 * a shop. A quest met with one of these is only met while it stays met: undo
 * the saves and the quest opens again and its claimed XP goes with it; redo
 * them and the same claim counts again, without claiming twice.
 */
const UNDOABLE: ReadonlySet<Ladder['metric']> = new Set(['save', 'follow']);

const TEMPLATE_BY_ID = new Map<string, { kind: TaskKind; template: Template }>();
for (const [kind, pool] of [['daily', [...DAILY_POOL, SHARE_DAILY]], ['weekly', [...WEEKLY_POOL, CHECKIN5, OPENS_WEEKLY]], ['monthly', [...MONTHLY_POOL, INVITE_MONTHLY]]] as const) {
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
  kind: TaskKind,
  template: Template,
  auto = false,
): TaskView {
  const id = `${kind}-${template.key}`;
  const progress = Math.min(template.goal, countIn(template.metric, kind, context));
  const done = progress >= template.goal;
  const key = `${id}:${periodOf(kind, context.now)}`;
  const claimed = auto ? done : Boolean(context.state.claimed[key]) && claimStands(key, context);
  return {
    id, kind, title: template.title, blurb: template.blurb, xp: kind === 'milestone' ? 0 : TASK_XP[kind], bumps: BUMPS_FOR[kind],
    progress, goal: template.goal,
    done, claimed, claimable: done && !claimed, href: template.href, pack: false,
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

function tasksFor(context: MeasureContext): TaskView[] {
  const { now, state } = context;
  const tasks: TaskView[] = [];

  // Daily: the two that are always there, then today's two.
  tasks.push({
    ...view(context, 'daily', { key: 'checkin', title: 'Check in', blurb: 'Open the vault and keep your streak alive.', metric: 'checkin', goal: 1, href: null }, true),
    id: 'daily-checkin',
  });
  const revealed = state.cards.some((card) => card.packId === `daily-${dayKey(now)}`);
  tasks.push({
    id: 'daily-reveal', kind: 'daily', title: 'Reveal today\'s loot', blurb: 'Flip the daily drop for a free card.',
    xp: ACTION_XP, bumps: 0, progress: revealed ? 1 : 0, goal: 1, done: revealed, claimed: revealed, claimable: false, href: null, pack: false,
  });
  tasks.push(view(context, 'daily', SHARE_DAILY));
  for (const template of pick(DAILY_POOL, 2, `daily|${dayKey(now)}`)) tasks.push(view(context, 'daily', template));

  tasks.push(view(context, 'weekly', CHECKIN5));
  tasks.push(view(context, 'weekly', OPENS_WEEKLY));
  for (const template of pick(WEEKLY_POOL, 3, `weekly|${weekKey(now)}`)) tasks.push(view(context, 'weekly', template));

  tasks.push(view(context, 'monthly', INVITE_MONTHLY));
  for (const template of pick(MONTHLY_POOL, 3, `monthly|${monthKey(now)}`)) tasks.push(view(context, 'monthly', template));

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
      pack: true,
      step: { index: index + 1, of: ladder.steps.length },
    });
  }
  return tasks;
}

/* -------------------------------------------------------------------------- */
/* Stickers                                                                   */
/* -------------------------------------------------------------------------- */

export type StickerTier = 0 | 1 | 2 | 3;
export const STICKER_TIER_NAMES = ['Locked', 'Bronze', 'Silver', 'Gold'] as const;

export interface StickerView {
  id: string;
  name: string;
  /** What it tells somebody looking at the profile. */
  meaning: string;
  /** How to earn it, and what each tier needs. */
  how: string;
  hue: 'gold' | 'violet' | 'aqua' | 'coral' | 'lime' | 'pink' | 'blue';
  glyph: 'bolt' | 'chest' | 'crest' | 'flame' | 'star' | 'heart' | 'chat' | 'bag' | 'shield' | 'card';
  /** Thresholds for bronze, silver and gold - or one number for a single-step sticker. */
  tiers: number[];
  tier: StickerTier;
  have: number;
  /** What the next tier needs, or null at the top. */
  next: number | null;
  earned: boolean;
}

interface StickerContext extends MeasureContext {
  owned: CardDef[];
}

interface StickerDef {
  id: string;
  name: string;
  meaning: string;
  how: string;
  hue: StickerView['hue'];
  glyph: StickerView['glyph'];
  tiers: number[];
  have: (context: StickerContext) => number;
}

const STICKERS: readonly StickerDef[] = [
  { id: 'ambassador', name: 'Ambassador', hue: 'pink', glyph: 'heart', tiers: [1, 10, 40],
    meaning: 'Brings people to Figmark: friends and shops joined through their invite.',
    how: 'Friends who sign up with your invite: bronze at 1, silver at 10, gold at 40.',
    have: ({ facts }) => facts.invites.length },
  { id: 'promoter', name: 'Promoter', hue: 'aqua', glyph: 'bolt', tiers: [5, 50, 250],
    meaning: 'Shares finds people actually open - the reason half the market hears about a drop.',
    how: 'People opening links you shared: bronze at 5, silver at 50, gold at 250.',
    have: ({ facts }) => facts.shareOpens.length },
  { id: 'haul', name: 'Haul Hunter', hue: 'gold', glyph: 'bag', tiers: [1, 10, 50],
    meaning: 'A real, active buyer. Sellers can see this person actually buys, not just browses.',
    how: 'Place orders: bronze at 1, silver at 10, gold at 50.',
    have: ({ facts }) => facts.orders.length },
  { id: 'backer', name: 'Backer', hue: 'violet', glyph: 'bolt', tiers: [1, 5, 25],
    meaning: 'Helps pre-orders reach their goal, so shops can import things the community wants.',
    how: 'Join pre-orders: bronze at 1, silver at 5, gold at 25.',
    have: ({ facts }) => facts.orders.filter((order) => order.preOrder).length + facts.pledges },
  { id: 'critic', name: 'Critic', hue: 'blue', glyph: 'star', tiers: [1, 10, 50],
    meaning: 'Leaves honest reviews after orders arrive, which helps every other buyer choose.',
    how: 'Review sellers: bronze at 1, silver at 10, gold at 50.',
    have: ({ facts }) => facts.reviewsWritten.length },
  { id: 'five-star', name: 'Five-Star Buyer', hue: 'gold', glyph: 'crest', tiers: [1, 5, 25],
    meaning: 'Sellers rated this buyer five stars: pays on time and is easy to deal with.',
    how: 'Get five-star ratings from sellers: bronze at 1, silver at 5, gold at 25.',
    have: ({ facts }) => facts.ratingsReceived.filter((stars) => stars === 5).length },
  { id: 'clean-record', name: 'Clean Record', hue: 'aqua', glyph: 'shield', tiers: [3, 15, 50],
    meaning: 'Completes orders without ever losing a dispute - one of the strongest trust signals here.',
    how: 'Complete orders with no disputes lost: bronze at 3, silver at 15, gold at 50. Losing a dispute resets it.',
    have: ({ facts }) => (facts.disputesLost > 0 ? 0 : facts.orders.filter((order) => order.status === 'delivered').length) },
  { id: 'curator', name: 'Curator', hue: 'pink', glyph: 'heart', tiers: [1, 10, 50],
    meaning: 'Shows off a real collection built from purchases delivered through Figmark.',
    how: 'Add delivered items to your collection: bronze at 1, silver at 10, gold at 50.',
    have: ({ facts }) => facts.collection.length },
  { id: 'on-fire', name: 'On Fire', hue: 'coral', glyph: 'flame', tiers: [7, 30, 100],
    meaning: 'Shows up day after day. A dedicated member of the community.',
    how: 'Check in days in a row: bronze at 7, silver at 30, gold at 100 (best streak counts).',
    have: ({ streak }) => streak.best },
  { id: 'town-crier', name: 'Town Crier', hue: 'lime', glyph: 'chat', tiers: [1, 10, 50],
    meaning: 'An active voice in the forums: shares hauls, answers questions, helps others.',
    how: 'Post in Social: bronze at 1, silver at 10, gold at 50.',
    have: ({ facts }) => facts.posts.length },
  { id: 'card-collector', name: 'Card Collector', hue: 'violet', glyph: 'card', tiers: [6, 12, 24],
    meaning: 'Plays the collector game: checks in, completes quests and opens packs.',
    how: 'Collect different cards: bronze at 6, silver at 12, gold for all 24.',
    have: ({ owned }) => new Set(owned.map((card) => card.id)).size },
  { id: 'lucky-pull', name: 'Lucky Pull', hue: 'gold', glyph: 'star', tiers: [1, 3, 6],
    meaning: 'Pulled legendary cards - only a 4% chance from any pack.',
    how: 'Pull legendary cards: bronze at 1, silver at 3, gold at 6.',
    have: ({ owned }) => owned.filter((card) => card.rarity === 'legendary').length },
  ...CARD_SETS.map((set): StickerDef => ({
    id: `set-${set.id}`,
    name: `${set.name} Master`,
    meaning: `Completed all six ${set.name} cards.`,
    how: `Collect every card in the ${set.name} set. Completing it also gives ${SET_BONUS_XP} XP.`,
    hue: set.hue,
    glyph: 'card',
    tiers: [6],
    have: ({ owned }) => new Set(owned.filter((card) => card.set === set.id).map((card) => card.id)).size,
  })),
];

function stickerView(def: StickerDef, context: StickerContext): StickerView {
  const have = def.have(context);
  const reached = def.tiers.filter((threshold) => have >= threshold).length;
  // A single-step sticker is simply earned; show it as gold.
  const tier = (def.tiers.length === 1 ? (reached ? 3 : 0) : reached) as StickerTier;
  const next = def.tiers.find((threshold) => have < threshold) ?? null;
  const { have: _count, ...rest } = def;
  return { ...rest, tier, have, next, earned: tier > 0 };
}

/* -------------------------------------------------------------------------- */
/* Packs                                                                      */
/* -------------------------------------------------------------------------- */

export interface PackView {
  id: string;
  label: string;
  min: CardRarity;
}

/**
 * Every pack a person has earned and not yet opened.
 *
 * Earned packs are recomputed rather than stored - one per level reached and
 * one per milestone claimed - and "opened" is simply a card carrying that pack
 * id. So a pack can be opened exactly once, and one earned while offline is
 * still waiting next time. A level lost to bad ratings takes its unopened pack
 * with it.
 */
function pendingPacks(state: QuestState, level: number): PackView[] {
  const opened = new Set(state.cards.map((card) => card.packId));
  const packs: PackView[] = [];
  for (let reached = 2; reached <= level; reached += 1) {
    packs.push({ id: `level-${reached}`, label: `Level ${reached} pack`, min: reached % 5 === 0 ? 'epic' : 'rare' });
  }
  for (const key of Object.keys(state.claimed)) {
    const [taskId = '', period] = key.split(':');
    const task = known(taskId);
    if (task?.pack && period === 'once') {
      packs.push({ id: `task-${taskId}`, label: `${task.title} pack`, min: 'rare' });
    }
  }
  return packs.filter((pack) => !opened.has(pack.id));
}

/** The pack a given id names, if this person has earned it. Used to open one. */
export function packFor(state: QuestState, level: number, packId: string): PackView | null {
  return pendingPacks(state, level).find((pack) => pack.id === packId) ?? null;
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
  stickers: StickerView[];
  cards: (OwnedCard & CardDef)[];
  sets: { id: string; name: string; hue: CardSet['hue']; owned: number; total: number; complete: boolean }[];
  packs: PackView[];
  dailyRevealed: boolean;
  /** Where the XP came from, gains and losses both, so the number can be checked. */
  breakdown: XpLine[];
  /** The losses on their own, as a positive number (0 when there are none). */
  penalty: number;
  /** Bump points saved up to spend on the person's own listings. */
  bumps: number;
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
  const line = (label: string, count: number) => ({ label, xp: actionXp(count), detail: `${count} × ${ACTION_XP}, up to ${ACTION_CAP}` });

  return [
    line('People who opened your links', facts.shareOpens.length),
    line('Sales through your links', facts.referredSales),
    line('Friends who joined with your invite', facts.invites.length),
    { label: 'Shops you brought in', xp: actionXp(facts.invitedSellers, ACTION_XP * 5), detail: `${facts.invitedSellers} × ${ACTION_XP * 5}, up to ${ACTION_CAP}` },
    line('Orders placed', facts.orders.length),
    line('Pre-orders joined', preOrders),
    line('Reviews written', facts.reviewsWritten.length),
    line('Good ratings from sellers', stars(5) + stars(4)),
    line('Collection items', facts.collection.length),
    line('Social posts', facts.posts.length),
    line('Wanted posts', facts.wants.length),
    line('Shops followed', facts.follows.length),
    line('Items saved', facts.likes.length),
    { label: 'Low ratings from sellers', xp: -(actionXp(stars(2)) + actionXp(stars(1), ACTION_XP * 2)), detail: `${stars(2)} two-star × −${ACTION_XP}, ${stars(1)} one-star × −${ACTION_XP * 2}` },
    { label: 'Low page reviews', xp: -Math.min(5 * ACTION_XP, actionXp(pageStars(2), ACTION_XP / 2) + actionXp(pageStars(1))), detail: `${pageStars(2)} two-star × −${ACTION_XP / 2}, ${pageStars(1)} one-star × −${ACTION_XP}, at most −${5 * ACTION_XP}` },
    { label: 'Disputes lost', xp: -actionXp(facts.disputesLost, ACTION_XP * 4), detail: `${facts.disputesLost} × −${ACTION_XP * 4}` },
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
  const checkIn = checkInDays.length * ACTION_XP;

  // A claim whose quest has since been undone (the saves taken back) pays nothing.
  const standing = Object.keys(state.claimed).filter((key) => claimStands(key, context));
  let claimedXp = 0;
  for (const key of standing) claimedXp += known(key.split(':')[0] ?? '')?.xp ?? 0;
  const reveals = state.cards.filter((card) => card.packId.startsWith('daily-')).length;

  const owned = state.cards
    .map((card) => {
      const def = CARD_BY_ID.get(card.cardId);
      return def ? { ...card, ...def } : null;
    })
    .filter((card): card is OwnedCard & CardDef => card !== null);
  const cardXp = owned.reduce((sum, card) => sum + CARD_XP[card.rarity], 0);

  const sets = CARD_SETS.map((set) => {
    const inSet = CARDS.filter((card) => card.set === set.id);
    const count = inSet.filter((card) => owned.some((mine) => mine.id === card.id)).length;
    return { id: set.id, name: set.name, hue: set.hue, owned: count, total: inSet.length, complete: count === inSet.length };
  });
  const setsDone = sets.filter((set) => set.complete).length;

  const breakdown = [
    ...recordXp(facts),
    { label: 'Check-ins', xp: checkIn, detail: `${checkInDays.length} days, more for streaks` },
    { label: 'Quests completed', xp: claimedXp + reveals * ACTION_XP, detail: `${standing.length} claimed + ${reveals} reveals × ${ACTION_XP}` },
    { label: 'Cards collected', xp: cardXp, detail: `${owned.length} cards by rarity` },
    { label: 'Card sets completed', xp: setsDone * SET_BONUS_XP, detail: `${setsDone} × ${SET_BONUS_XP}` },
  ].filter((line) => line.xp !== 0);

  const penalty = -breakdown.filter((line) => line.xp < 0).reduce((sum, line) => sum + line.xp, 0);
  // Losses can take a person down levels, but never below zero.
  const xp = Math.max(0, breakdown.reduce((sum, line) => sum + line.xp, 0));

  const level = levelFor(xp);
  const levelFloor = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const progress = level >= MAX_LEVEL ? 1 : (xp - levelFloor) / (nextLevelXp - levelFloor);

  const stickerContext: StickerContext = { ...context, owned };

  return {
    xp,
    level,
    title: titleFor(level),
    levelFloor,
    nextLevelXp,
    progress,
    streak,
    tasks: tasksFor(context),
    stickers: STICKERS.map((def) => stickerView(def, stickerContext)),
    cards: owned.sort((a, b) => CARD_RARITIES.indexOf(b.rarity) - CARD_RARITIES.indexOf(a.rarity) || b.at.localeCompare(a.at)),
    sets,
    packs: pendingPacks(state, level),
    dailyRevealed: state.cards.some((card) => card.packId === `daily-${dayKey(now)}`),
    breakdown,
    penalty,
    bumps: state.bumps ?? 0,
  };
}

/** Chances of each rarity from an ordinary pack, for the card explainer. */
export const CARD_ODDS: Record<CardRarity, number> = { ...CARD_WEIGHTS };

/**
 * Tidies the stored state before it is written back.
 *
 * Only duplicates go. Nothing is trimmed by age, because XP is counted from
 * these lists - dropping an old claim or card would quietly take XP away. They
 * grow by a few entries a day at most, which a user document carries easily.
 */
export function tidyQuestState(state: QuestState): QuestState {
  const seenPacks = new Set<string>();
  const cards = state.cards.filter((card) => {
    if (seenPacks.has(card.packId)) return false;
    seenPacks.add(card.packId);
    return true;
  });
  return {
    ...state, checkIns: [...new Set(state.checkIns)].sort(), cards,
    ...(state.bumpLog ? { bumpLog: state.bumpLog.slice(-100) } : {}),
  };
}
