import type { StoreGrowthState } from './models.js';
import {
  ACTION_XP, MAX_LEVEL, actionXp, levelFor, titleFor, titleIn, xpForLevel,
  type StickerTier, type StickerView,
} from './quest.js';
import { growthAreas } from './store-growth.js';

/**
 * What a shop's page is graded on, and the two follow addresses an account has.
 *
 * A shop and the person behind it share one account id, but they are two
 * pages: following one is not following the other. A person is followed under
 * a prefixed id so the shop's follow - the one that ranks its items in your
 * feed - stays the plain account id it always was.
 */
export const PERSON_FOLLOW = 'person:';
export const personFollowId = (userId: string) => `${PERSON_FOLLOW}${userId}`;
export const isPersonFollow = (id: string) => id.startsWith(PERSON_FOLLOW);

/**
 * Which page a page review was left on. Rows from before the split carry no
 * side; they were written on the shop's page if the account had a shop.
 */
export function reviewSide(review: { side?: 'store' | 'person' }, hasShop: boolean): 'store' | 'person' {
  return review.side ?? (hasShop ? 'store' : 'person');
}

/** Everything a shop's level and stickers are read from. */
export interface StoreFacts {
  completedSales: number;
  /** Orders that came in through somebody's affiliate link. */
  affiliateSales: number;
  /** Live items paying a commission to whoever shares them. */
  affiliateItems: number;
  /** Posts in the shop's own channel. */
  posts: number;
  followers: number;
  /** Hearts on the shop's items, all told. */
  likes: number;
  /** Merged rating, 0-100, or null when nobody has rated. */
  ratingAverage: number | null;
  ratingCount: number;
  /** Merged ratings at each star, five first. */
  stars: number[];
  /** Four- and five-star reviews from buyers who ordered - the ones nobody can leave for a friend. */
  tradeGoodReviews: number;
  listings: number;
  soldOut: number;
  trust: number;
  preOrders: number;
  disputesLost: number;
  ageDays: number;
}

export interface XpLine { label: string; xp: number; detail: string }

export interface StoreLevel {
  level: number;
  title: string;
  points: number;
  floor: number;
  next: number | null;
  progress: number;
  /** Where every point came from, so the level can be checked. */
  breakdown: XpLine[];
}

const STORE_TITLES = [
  'New stall', 'Corner shop', 'Local favourite', 'Busy counter', 'Known name',
  'Trusted house', 'Flagship', 'Landmark', 'Emporium', 'Legend',
];
const STORE_HIGH_TITLES = ['Eternal', 'Empire', 'Dynasty', 'Heritage house'];
export function storeTitleFor(level: number): string {
  return titleIn(level, STORE_TITLES, STORE_HIGH_TITLES);
}

/** The level and title shown beside a name, for a buyer or for a shop. */
export interface LevelTag { level: number; title: string; shop?: boolean }
export const buyerTag = (level: number | undefined): LevelTag => ({ level: level ?? 1, title: titleFor(level ?? 1) });
export const storeTag = (level: number | undefined): LevelTag => ({ level: level ?? 1, title: storeTitleFor(level ?? 1), shop: true });

/**
 * A shop's XP, on the buyers' scale: everything it earns comes from the shop
 * quests it collected (see `store-growth.ts`), which pay full for reviews,
 * popularity, sales and marketing and a token amount for upkeep. Low ratings
 * and lost disputes still take XP away, so a level says how a shop trades.
 */
export function storeLevel(facts: StoreFacts, growth: StoreGrowthState | undefined): StoreLevel {
  const two = facts.stars[3] ?? 0;
  const one = facts.stars[4] ?? 0;
  const breakdown: XpLine[] = [
    ...growthAreas(growth, facts).map((area) => ({
      label: `${area.label} quests`, xp: area.xp, detail: `${area.collected} collected`,
    })),
    { label: 'Low ratings', xp: -(actionXp(two) + actionXp(one, ACTION_XP * 2)), detail: `${two} two-star × −${ACTION_XP}, ${one} one-star × −${ACTION_XP * 2}` },
    { label: 'Disputes lost', xp: -actionXp(facts.disputesLost, ACTION_XP * 4), detail: `${facts.disputesLost} × −${ACTION_XP * 4}` },
  ].filter((entry) => entry.xp !== 0);
  const points = Math.max(0, breakdown.reduce((sum, entry) => sum + entry.xp, 0));
  const level = levelFor(points);
  const floor = xpForLevel(level);
  const next = level >= MAX_LEVEL ? null : xpForLevel(level + 1);
  return {
    level,
    title: storeTitleFor(level),
    points,
    floor,
    next,
    progress: next === null ? 1 : (points - floor) / (next - floor),
    breakdown,
  };
}

type Def = Omit<StickerView, 'tier' | 'have' | 'next' | 'earned'> & { have: (facts: StoreFacts) => number };

const goodAverage = (f: StoreFacts) => f.ratingAverage !== null && f.ratingAverage >= 90;

/** Marketing first, then selling, then standing. Trusted and Top rated lead once earned. */
const STORE_STICKERS: Def[] = [
  { id: 's-trust', name: 'Trusted', glyph: 'shield', hue: 'aqua', tiers: [80],
    meaning: 'A trust score of 80 or more from completed, undisputed orders.', how: 'Reach a trust score of 80.',
    have: (f) => f.trust },
  { id: 's-rated', name: 'Top rated', glyph: 'star', hue: 'violet', tiers: [5, 20, 60],
    meaning: 'Rated 4.5 or better, by enough people for it to mean something.',
    how: 'Keep a 4.5★ rating across 5, 20 and 60 ratings.',
    have: (f) => (goodAverage(f) ? f.ratingCount : 0) },
  { id: 's-mouth', name: 'Word of mouth', glyph: 'chat', hue: 'pink', tiers: [1, 10, 50],
    meaning: 'Sales that came in through people sharing the shop\'s items.', how: 'Make 1, 10 and 50 sales through affiliate links.',
    have: (f) => f.affiliateSales },
  { id: 's-partner', name: 'Affiliate partner', glyph: 'card', hue: 'lime', tiers: [1, 10, 30],
    meaning: 'Items that pay a commission to whoever shares them.', how: 'Offer a commission on 1, 10 and 30 items.',
    have: (f) => f.affiliateItems },
  { id: 's-fans', name: 'Following', glyph: 'heart', hue: 'pink', tiers: [10, 50, 250],
    meaning: 'People who follow the shop for its new items.', how: 'Reach 10, 50 and 250 followers.',
    have: (f) => f.followers },
  { id: 's-voice', name: 'Broadcaster', glyph: 'chat', hue: 'blue', tiers: [1, 20, 100],
    meaning: 'Posts the shop put in front of its followers.', how: 'Post 1, 20 and 100 times in the shop\'s channel.',
    have: (f) => f.posts },
  { id: 's-hearts', name: 'Crowd favourite', glyph: 'heart', hue: 'coral', tiers: [10, 100, 500],
    meaning: 'Hearts people put on the shop\'s items.', how: 'Collect 10, 100 and 500 hearts across your items.',
    have: (f) => f.likes },
  { id: 's-launch', name: 'Launcher', glyph: 'bolt', hue: 'blue', tiers: [1, 5, 15],
    meaning: 'Pre-orders this shop has run.', how: 'Run 1, 5 and 15 pre-orders.',
    have: (f) => f.preOrders },
  { id: 's-sales', name: 'Sales', glyph: 'bag', hue: 'gold', tiers: [1, 25, 100],
    meaning: 'Orders this shop has delivered to the end.', how: 'Complete orders: 1, 25 and 100 delivered.',
    have: (f) => f.completedSales },
  { id: 's-soldout', name: 'Sell-out', glyph: 'flame', hue: 'coral', tiers: [1, 5, 20],
    meaning: 'Items that sold every unit.', how: 'Sell out 1, 5 and 20 items.',
    have: (f) => f.soldOut },
  { id: 's-shelf', name: 'Full shelf', glyph: 'chest', hue: 'lime', tiers: [5, 25, 75],
    meaning: 'How much the shop has put up for sale.', how: 'List 5, 25 and 75 items.',
    have: (f) => f.listings },
  { id: 's-clean', name: 'Flawless', glyph: 'shield', hue: 'violet', tiers: [10],
    meaning: 'Ten or more orders delivered and not one dispute lost.', how: 'Deliver 10 orders without losing a dispute.',
    have: (f) => (f.disputesLost === 0 ? f.completedSales : 0) },
  { id: 's-year', name: 'Veteran', glyph: 'crest', hue: 'gold', tiers: [90, 365, 1095],
    meaning: 'How long the shop has been open.', how: 'Stay open 3 months, 1 year and 3 years.',
    have: (f) => f.ageDays },
];

const PINNED = ['s-trust', 's-rated'];

/** Earned first - Trusted and Top rated ahead of the rest - then by tier; locked last. */
export function storeStickers(facts: StoreFacts): (StickerView & { reached: number })[] {
  return STORE_STICKERS.map(({ have: measure, ...def }) => {
    const have = measure(facts);
    const reached = def.tiers.filter((threshold) => have >= threshold).length;
    const tier = (def.tiers.length === 1 ? (reached ? 3 : 0) : reached) as StickerTier;
    const next = def.tiers.find((threshold) => have < threshold) ?? null;
    return { ...def, tier, have, next, earned: tier > 0, reached };
  }).sort((a, b) => {
    const pin = (s: { id: string; earned: boolean }) => (s.earned && PINNED.includes(s.id) ? 0 : 1);
    return Number(b.earned) - Number(a.earned) || pin(a) - pin(b) || b.tier - a.tier;
  });
}

/** A merged rating: the after-trade ones and the page ones, as one figure. */
export function mergedRating(trade: readonly number[], page: readonly number[]) {
  const all = [...trade, ...page];
  const avg = (list: readonly number[]) =>
    list.length ? Math.round((list.reduce((sum, n) => sum + n, 0) / list.length) * 20) : null;
  return {
    average: avg(all),
    count: all.length,
    stars: [5, 4, 3, 2, 1].map((value) => all.filter((rating) => Math.round(rating) === value).length),
    trade: { average: avg(trade), count: trade.length },
    page: { average: avg(page), count: page.length },
  };
}
export type MergedRating = ReturnType<typeof mergedRating>;
