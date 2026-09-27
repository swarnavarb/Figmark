import type { Listing, OwnedCard, QuestState } from './models.js';

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
export const LEGENDARY_HEAT = 120;
export const EPIC_HEAT = 50;

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
  if (scarce && (sold >= 1 || likes >= 5)) heat += 40;
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
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
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

/** Total XP needed to reach a level: 0, 100, 300, 600, 1000, … */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelFor(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level += 1;
  return level;
}

export function titleFor(level: number): string {
  return TITLES[Math.min(level, TITLES.length) - 1] ?? 'Legend';
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
}

/** Six per set: two common, two rare, one epic, one legendary. */
export const CARDS: readonly CardDef[] = [
  { id: 'mecha-1', name: 'Scout Frame', set: 'mecha', rarity: 'common', glyph: 'mech' },
  { id: 'mecha-2', name: 'Hangar Drone', set: 'mecha', rarity: 'common', glyph: 'box' },
  { id: 'mecha-3', name: 'Wing Lancer', set: 'mecha', rarity: 'rare', glyph: 'mech' },
  { id: 'mecha-4', name: 'Beam Rifle', set: 'mecha', rarity: 'rare', glyph: 'star' },
  { id: 'mecha-5', name: 'Zero Custom', set: 'mecha', rarity: 'epic', glyph: 'mech' },
  { id: 'mecha-6', name: 'Perfect Grade', set: 'mecha', rarity: 'legendary', glyph: 'mech' },
  { id: 'kaiju-1', name: 'Tide Pup', set: 'kaiju', rarity: 'common', glyph: 'beast' },
  { id: 'kaiju-2', name: 'Reef Crawler', set: 'kaiju', rarity: 'common', glyph: 'beast' },
  { id: 'kaiju-3', name: 'Storm Wing', set: 'kaiju', rarity: 'rare', glyph: 'beast' },
  { id: 'kaiju-4', name: 'Magma Horn', set: 'kaiju', rarity: 'rare', glyph: 'beast' },
  { id: 'kaiju-5', name: 'Deep King', set: 'kaiju', rarity: 'epic', glyph: 'beast' },
  { id: 'kaiju-6', name: 'Dragon Knight', set: 'kaiju', rarity: 'legendary', glyph: 'beast' },
  { id: 'arcana-1', name: 'The Novice', set: 'arcana', rarity: 'common', glyph: 'card' },
  { id: 'arcana-2', name: 'The Trader', set: 'arcana', rarity: 'common', glyph: 'card' },
  { id: 'arcana-3', name: 'The Seer', set: 'arcana', rarity: 'rare', glyph: 'star' },
  { id: 'arcana-4', name: 'The Vault', set: 'arcana', rarity: 'rare', glyph: 'box' },
  { id: 'arcana-5', name: 'The Crown', set: 'arcana', rarity: 'epic', glyph: 'card' },
  { id: 'arcana-6', name: 'Foil Ace', set: 'arcana', rarity: 'legendary', glyph: 'card' },
  { id: 'street-1', name: 'Daily Runner', set: 'street', rarity: 'common', glyph: 'shoe' },
  { id: 'street-2', name: 'Canvas Low', set: 'street', rarity: 'common', glyph: 'shoe' },
  { id: 'street-3', name: 'Retro High', set: 'street', rarity: 'rare', glyph: 'shoe' },
  { id: 'street-4', name: 'Deadstock Box', set: 'street', rarity: 'rare', glyph: 'box' },
  { id: 'street-5', name: 'Collab Pair', set: 'street', rarity: 'epic', glyph: 'shoe' },
  { id: 'street-6', name: 'Grail', set: 'street', rarity: 'legendary', glyph: 'shoe' },
];

export const CARD_BY_ID = new Map(CARDS.map((card) => [card.id, card]));

/** XP a pulled card is worth, so a lucky pull is a small boost and not a free level. */
export const CARD_XP: Record<CardRarity, number> = { common: 5, rare: 15, epic: 40, legendary: 100 };

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
  orders: { createdAt: string; status: string; totalMinor: number; groupBuy: boolean }[];
  reviewsWritten: { createdAt: string }[];
  fiveStarsReceived: number;
  likes: { createdAt: string }[];
  follows: number;
  posts: { createdAt: string }[];
  wants: number;
  pledges: number;
  disputesLost: number;
  hasBio: boolean;
  hasTags: boolean;
}

export function emptyQuestState(): QuestState {
  return { checkIns: [], claimed: {}, cards: [] };
}

/* -------------------------------------------------------------------------- */
/* Streak                                                                     */
/* -------------------------------------------------------------------------- */

export interface Streak {
  current: number;
  best: number;
  checkedInToday: boolean;
  /** The last seven India days, oldest first, and whether each was checked in. */
  week: { day: string; done: boolean }[];
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

  const week: Streak['week'] = [];
  let day = today;
  for (let index = 0; index < 7; index += 1) {
    week.unshift({ day, done: days.has(day) });
    day = previousDay(day);
  }

  return { current, best: Math.max(best, current), checkedInToday, week };
}

/** XP for checking in: ten a day, plus up to thirty-five more for keeping it going. */
export function checkInXp(streakDay: number): number {
  return 10 + 5 * Math.min(Math.max(streakDay - 1, 0), 7);
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

export type TaskKind = 'daily' | 'weekly' | 'milestone';

export interface TaskView {
  id: string;
  kind: TaskKind;
  title: string;
  blurb: string;
  xp: number;
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
}

interface TaskDef {
  id: string;
  kind: TaskKind;
  title: string;
  blurb: string;
  xp: number;
  goal: number;
  href: string | null;
  /** Claimed automatically by the action itself (checking in, revealing). */
  auto?: boolean;
  measure: (context: MeasureContext) => number;
}

interface MeasureContext {
  facts: QuestFacts;
  state: QuestState;
  today: string;
  week: string;
  streak: Streak;
}

const inDay = (at: string, today: string) => dayKey(at) === today;
const inWeek = (at: string, week: string) => weekKey(at) === week;

const TASKS: readonly TaskDef[] = [
  {
    id: 'checkin', kind: 'daily', title: 'Check in', blurb: 'Open the vault and keep your streak alive.',
    xp: 10, goal: 1, href: null, auto: true,
    measure: ({ streak }) => (streak.checkedInToday ? 1 : 0),
  },
  {
    id: 'reveal', kind: 'daily', title: 'Reveal today\'s loot', blurb: 'Flip the daily drop for a free card.',
    xp: 15, goal: 1, href: null, auto: true,
    measure: ({ state, today }) => (state.cards.some((card) => card.packId === `daily-${today}`) ? 1 : 0),
  },
  {
    id: 'save', kind: 'daily', title: 'Save something you like', blurb: 'Tap the chest on any listing.',
    xp: 15, goal: 1, href: '/',
    measure: ({ facts, today }) => facts.likes.filter((like) => inDay(like.createdAt, today)).length,
  },
  {
    id: 'order', kind: 'weekly', title: 'Place an order', blurb: 'Buy anything from the catalogue this week.',
    xp: 60, goal: 1, href: '/',
    measure: ({ facts, week }) => facts.orders.filter((order) => inWeek(order.createdAt, week)).length,
  },
  {
    id: 'group', kind: 'weekly', title: 'Join a group buy', blurb: 'Get into a pre-order before it fills.',
    xp: 40, goal: 1, href: '/?kind=preorder',
    measure: ({ facts, week }) =>
      facts.orders.filter((order) => order.groupBuy && inWeek(order.createdAt, week)).length,
  },
  {
    id: 'social', kind: 'weekly', title: 'Post in Social', blurb: 'Share a haul, ask a question, start a thread.',
    xp: 25, goal: 1, href: '/social',
    measure: ({ facts, week }) => facts.posts.filter((post) => inWeek(post.createdAt, week)).length,
  },
  {
    id: 'streak5', kind: 'weekly', title: 'Check in five days', blurb: 'Five check-ins in one week.',
    xp: 50, goal: 5, href: null,
    measure: ({ state, week }) => state.checkIns.filter((day) => weekKey(`${day}T12:00:00+05:30`) === week).length,
  },
  {
    id: 'first-order', kind: 'milestone', title: 'First haul', blurb: 'Place your first order.',
    xp: 100, goal: 1, href: '/', measure: ({ facts }) => facts.orders.length,
  },
  {
    id: 'five-orders', kind: 'milestone', title: 'Regular', blurb: 'Place five orders.',
    xp: 250, goal: 5, href: '/', measure: ({ facts }) => facts.orders.length,
  },
  {
    id: 'first-review', kind: 'milestone', title: 'Critic', blurb: 'Review a seller after an order arrives.',
    xp: 80, goal: 1, href: '/purchases', measure: ({ facts }) => facts.reviewsWritten.length,
  },
  {
    id: 'five-reviews', kind: 'milestone', title: 'Trusted voice', blurb: 'Write five reviews.',
    xp: 200, goal: 5, href: '/purchases', measure: ({ facts }) => facts.reviewsWritten.length,
  },
  {
    id: 'ten-saves', kind: 'milestone', title: 'Wishlist', blurb: 'Save ten items.',
    xp: 60, goal: 10, href: '/', measure: ({ facts }) => facts.likes.length,
  },
  {
    id: 'three-follows', kind: 'milestone', title: 'Fan club', blurb: 'Follow three shops.',
    xp: 60, goal: 3, href: '/', measure: ({ facts }) => facts.follows,
  },
  {
    id: 'profile', kind: 'milestone', title: 'Show yourself', blurb: 'Add a bio and a tag to your page.',
    xp: 50, goal: 2, href: '/me', measure: ({ facts }) => Number(facts.hasBio) + Number(facts.hasTags),
  },
  {
    id: 'want', kind: 'milestone', title: 'Bounty hunter', blurb: 'Post something you are hunting for.',
    xp: 40, goal: 1, href: '/wanted', measure: ({ facts }) => facts.wants,
  },
  {
    id: 'streak7', kind: 'milestone', title: 'On fire', blurb: 'Check in seven days in a row.',
    xp: 150, goal: 7, href: null, measure: ({ streak }) => streak.best,
  },
];

export const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]));

/** The key a claim is stored under: one claim per task per period. */
export function claimKey(taskId: string, now: number = Date.now()): string | null {
  const task = TASK_BY_ID.get(taskId);
  if (!task) return null;
  const period = task.kind === 'daily' ? dayKey(now) : task.kind === 'weekly' ? weekKey(now) : 'once';
  return `${taskId}:${period}`;
}

function tasksFor(context: MeasureContext, now: number): TaskView[] {
  return TASKS.map((task) => {
    const progress = Math.min(task.goal, task.measure(context));
    const done = progress >= task.goal;
    const claimed = task.auto ? done : Boolean(context.state.claimed[claimKey(task.id, now)!]);
    return {
      id: task.id,
      kind: task.kind,
      title: task.title,
      blurb: task.blurb,
      xp: task.xp,
      progress,
      goal: task.goal,
      done,
      claimed,
      claimable: done && !claimed,
      href: task.href,
      pack: task.kind === 'milestone',
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Stickers                                                                   */
/* -------------------------------------------------------------------------- */

export interface StickerView {
  id: string;
  name: string;
  blurb: string;
  hue: 'gold' | 'violet' | 'aqua' | 'coral' | 'lime' | 'pink' | 'blue';
  glyph: 'bolt' | 'chest' | 'crest' | 'flame' | 'star' | 'heart' | 'chat' | 'bag' | 'shield' | 'card';
  earned: boolean;
}

interface StickerContext extends MeasureContext {
  owned: CardDef[];
}

const STICKERS: readonly (Omit<StickerView, 'earned'> & { test: (context: StickerContext) => boolean })[] = [
  { id: 'first-haul', name: 'First Haul', blurb: 'Placed a first order', hue: 'gold', glyph: 'bag',
    test: ({ facts }) => facts.orders.length >= 1 },
  { id: 'regular', name: 'Regular', blurb: 'Five orders placed', hue: 'aqua', glyph: 'chest',
    test: ({ facts }) => facts.orders.length >= 5 },
  { id: 'high-roller', name: 'High Roller', blurb: 'Spent ₹10,000 or more', hue: 'gold', glyph: 'crest',
    test: ({ facts }) => facts.orders.reduce((sum, order) => sum + order.totalMinor, 0) >= 1_000_000 },
  { id: 'squad-up', name: 'Squad Up', blurb: 'Joined a group buy', hue: 'violet', glyph: 'bolt',
    test: ({ facts }) => facts.pledges > 0 || facts.orders.some((order) => order.groupBuy) },
  { id: 'critic', name: 'Critic', blurb: 'Wrote a review', hue: 'blue', glyph: 'star',
    test: ({ facts }) => facts.reviewsWritten.length >= 1 },
  { id: 'five-star', name: 'Five-Star Buyer', blurb: 'Rated five stars by a seller', hue: 'gold', glyph: 'star',
    test: ({ facts }) => facts.fiveStarsReceived >= 1 },
  { id: 'curator', name: 'Curator', blurb: 'Saved ten items', hue: 'pink', glyph: 'heart',
    test: ({ facts }) => facts.likes.length >= 10 },
  { id: 'on-fire', name: 'On Fire', blurb: 'Seven-day check-in streak', hue: 'coral', glyph: 'flame',
    test: ({ streak }) => streak.best >= 7 },
  { id: 'town-crier', name: 'Town Crier', blurb: 'Posted in Social', hue: 'lime', glyph: 'chat',
    test: ({ facts }) => facts.posts.length >= 1 },
  { id: 'clean-record', name: 'Clean Record', blurb: 'Three orders completed, no disputes lost', hue: 'aqua', glyph: 'shield',
    test: ({ facts }) => facts.orders.filter((order) => order.status === 'delivered').length >= 3 && facts.disputesLost === 0 },
  { id: 'lucky-pull', name: 'Lucky Pull', blurb: 'Pulled a legendary card', hue: 'gold', glyph: 'card',
    test: ({ owned }) => owned.some((card) => card.rarity === 'legendary') },
  ...CARD_SETS.map((set) => ({
    id: `set-${set.id}`,
    name: `${set.name} Master`,
    blurb: `Completed the ${set.name} set`,
    hue: (set.hue === 'aqua' ? 'aqua' : set.hue === 'coral' ? 'coral' : set.hue === 'violet' ? 'violet' : 'lime') as StickerView['hue'],
    glyph: 'card' as const,
    test: ({ owned }: StickerContext) =>
      CARDS.filter((card) => card.set === set.id).every((card) => owned.some((mine) => mine.id === card.id)),
  })),
];

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
 * still waiting next time.
 */
function pendingPacks(state: QuestState, level: number): PackView[] {
  const opened = new Set(state.cards.map((card) => card.packId));
  const packs: PackView[] = [];
  for (let reached = 2; reached <= level; reached += 1) {
    packs.push({ id: `level-${reached}`, label: `Level ${reached} pack`, min: reached % 5 === 0 ? 'epic' : 'rare' });
  }
  for (const key of Object.keys(state.claimed)) {
    const [taskId, period] = key.split(':');
    const task = TASK_BY_ID.get(taskId ?? '');
    if (task?.kind === 'milestone' && period === 'once') {
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
  sets: { id: string; name: string; hue: CardSet['hue']; owned: number; total: number }[];
  packs: PackView[];
  dailyRevealed: boolean;
  /** Where the XP came from, so the number can be checked. */
  breakdown: XpLine[];
}

/**
 * XP from the record itself: what a person did, not what they claimed.
 *
 * Saves, follows and posts are capped so that XP tracks being a good member of
 * the market rather than tapping one button a thousand times.
 */
function activityXp(facts: QuestFacts): XpLine[] {
  const placed = facts.orders.length;
  const delivered = facts.orders.filter((order) => order.status === 'delivered').length;
  const group = facts.orders.filter((order) => order.groupBuy).length;
  return [
    { label: 'Orders placed', xp: placed * 40 },
    { label: 'Orders received', xp: delivered * 40 },
    { label: 'Group buys joined', xp: group * 20 + Math.min(facts.pledges, 20) * 10 },
    { label: 'Reviews written', xp: facts.reviewsWritten.length * 25 },
    { label: 'Five-star ratings', xp: facts.fiveStarsReceived * 20 },
    { label: 'Items saved', xp: Math.min(facts.likes.length, 100) * 3 },
    { label: 'Shops followed', xp: Math.min(facts.follows, 10) * 5 },
    { label: 'Social posts', xp: Math.min(facts.posts.length, 50) * 10 },
    { label: 'Wanted posts', xp: Math.min(facts.wants, 10) * 10 },
  ];
}

export function questView(
  userId: string,
  facts: QuestFacts,
  stored: QuestState | undefined,
  now: number = Date.now(),
): QuestView {
  const state = stored ?? emptyQuestState();
  const today = dayKey(now);
  const week = weekKey(now);
  const streak = streakOf(state.checkIns, now);
  const context: MeasureContext = { facts, state, today, week, streak };

  // Check-in XP is counted per day with the streak it was part of, so a long
  // streak keeps paying even after it breaks.
  let checkIn = 0;
  let run = 0;
  let last: string | null = null;
  for (const day of [...new Set(state.checkIns)].sort()) {
    run = last && previousDay(day) === last ? run + 1 : 1;
    checkIn += checkInXp(run);
    last = day;
  }

  let claimedXp = 0;
  for (const key of Object.keys(state.claimed)) {
    const task = TASK_BY_ID.get(key.split(':')[0] ?? '');
    if (task && !task.auto) claimedXp += task.xp;
  }
  const revealXp = state.cards.filter((card) => card.packId.startsWith('daily-')).length * 15;

  const owned = state.cards
    .map((card) => {
      const def = CARD_BY_ID.get(card.cardId);
      return def ? { ...card, ...def } : null;
    })
    .filter((card): card is OwnedCard & CardDef => card !== null);
  const cardXp = owned.reduce((sum, card) => sum + CARD_XP[card.rarity], 0);

  const breakdown = [
    ...activityXp(facts),
    { label: 'Check-ins', xp: checkIn },
    { label: 'Tasks completed', xp: claimedXp + revealXp },
    { label: 'Cards collected', xp: cardXp },
  ].filter((line) => line.xp > 0);
  const xp = breakdown.reduce((sum, line) => sum + line.xp, 0);

  const level = levelFor(xp);
  const levelFloor = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const progress = level >= MAX_LEVEL ? 1 : (xp - levelFloor) / (nextLevelXp - levelFloor);

  const stickerContext: StickerContext = { ...context, owned };
  const stickers = STICKERS.map(({ test, ...sticker }) => ({ ...sticker, earned: test(stickerContext) }));

  const sets = CARD_SETS.map((set) => {
    const inSet = CARDS.filter((card) => card.set === set.id);
    return {
      id: set.id,
      name: set.name,
      hue: set.hue,
      owned: inSet.filter((card) => owned.some((mine) => mine.id === card.id)).length,
      total: inSet.length,
    };
  });

  return {
    xp,
    level,
    title: titleFor(level),
    levelFloor,
    nextLevelXp,
    progress,
    streak,
    tasks: tasksFor(context, now),
    stickers,
    cards: owned.sort((a, b) => CARD_RARITIES.indexOf(b.rarity) - CARD_RARITIES.indexOf(a.rarity) || b.at.localeCompare(a.at)),
    sets,
    packs: pendingPacks(state, level),
    dailyRevealed: state.cards.some((card) => card.packId === `daily-${today}`),
    breakdown,
  };
}

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
  return { ...state, checkIns: [...new Set(state.checkIns)].sort(), cards };
}
