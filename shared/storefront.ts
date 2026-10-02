import type { StickerTier, StickerView } from './quest.js';

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
  followers: number;
  /** Merged rating, 0-100, or null when nobody has rated. */
  ratingAverage: number | null;
  ratingCount: number;
  listings: number;
  soldOut: number;
  trust: number;
  preOrders: number;
  ageDays: number;
}

export interface StoreLevel {
  level: number;
  title: string;
  points: number;
  floor: number;
  next: number | null;
  progress: number;
}

const LEVELS: [number, string][] = [
  [0, 'New stall'], [60, 'Corner shop'], [180, 'Local favourite'], [400, 'Busy counter'],
  [800, 'Known name'], [1500, 'Trusted house'], [2600, 'Landmark'], [4200, 'Legend'],
];

/** Points, from what buyers did rather than from anything the shop can post. */
export function storePoints(facts: StoreFacts): number {
  const wellRated = facts.ratingAverage !== null && facts.ratingAverage >= 90 ? facts.ratingCount * 5 : 0;
  return Math.round(
    facts.completedSales * 12 + facts.followers * 3 + facts.ratingCount * 5 + wellRated
      + facts.listings * 2 + facts.soldOut * 4 + facts.preOrders * 10 + Math.min(facts.ageDays, 730) / 10,
  );
}

export function storeLevel(facts: StoreFacts): StoreLevel {
  const points = storePoints(facts);
  const index = LEVELS.reduce((found, [floor], i) => (points >= floor ? i : found), 0);
  const [floor, title] = LEVELS[index]!;
  const next = LEVELS[index + 1]?.[0] ?? null;
  return {
    level: index + 1,
    title,
    points,
    floor,
    next,
    progress: next === null ? 1 : (points - floor) / (next - floor),
  };
}

type Def = Omit<StickerView, 'tier' | 'have' | 'next' | 'earned'> & { have: (facts: StoreFacts) => number };

const STORE_STICKERS: Def[] = [
  { id: 's-sales', name: 'Sales', glyph: 'bag', hue: 'gold', tiers: [1, 25, 100],
    meaning: 'Orders this shop has delivered to the end.', how: 'Complete orders: 1, 25 and 100 delivered.',
    have: (f) => f.completedSales },
  { id: 's-fans', name: 'Following', glyph: 'heart', hue: 'pink', tiers: [10, 50, 250],
    meaning: 'People who follow the shop for its new items.', how: 'Reach 10, 50 and 250 followers.',
    have: (f) => f.followers },
  { id: 's-rated', name: 'Top rated', glyph: 'star', hue: 'violet', tiers: [5, 20, 60],
    meaning: 'Rated 4.5 or better, by enough people for it to mean something.',
    how: 'Keep a 4.5★ rating across 5, 20 and 60 ratings.',
    have: (f) => (f.ratingAverage !== null && f.ratingAverage >= 90 ? f.ratingCount : 0) },
  { id: 's-trust', name: 'Trusted', glyph: 'shield', hue: 'aqua', tiers: [80],
    meaning: 'A trust score of 80 or more from completed, undisputed orders.', how: 'Reach a trust score of 80.',
    have: (f) => f.trust },
  { id: 's-soldout', name: 'Sell-out', glyph: 'flame', hue: 'coral', tiers: [1, 5, 20],
    meaning: 'Items that sold every unit.', how: 'Sell out 1, 5 and 20 items.',
    have: (f) => f.soldOut },
  { id: 's-shelf', name: 'Full shelf', glyph: 'chest', hue: 'lime', tiers: [5, 25, 75],
    meaning: 'How much the shop has put up for sale.', how: 'List 5, 25 and 75 items.',
    have: (f) => f.listings },
  { id: 's-launch', name: 'Launcher', glyph: 'bolt', hue: 'blue', tiers: [1, 5, 15],
    meaning: 'Pre-orders this shop has run.', how: 'Run 1, 5 and 15 pre-orders.',
    have: (f) => f.preOrders },
  { id: 's-year', name: 'Veteran', glyph: 'crest', hue: 'gold', tiers: [90, 365, 1095],
    meaning: 'How long the shop has been open.', how: 'Stay open 3 months, 1 year and 3 years.',
    have: (f) => f.ageDays },
];

export function storeStickers(facts: StoreFacts): StickerView[] {
  return STORE_STICKERS.map(({ have: measure, ...def }) => {
    const have = measure(facts);
    const reached = def.tiers.filter((threshold) => have >= threshold).length;
    const tier = (def.tiers.length === 1 ? (reached ? 3 : 0) : reached) as StickerTier;
    const next = def.tiers.find((threshold) => have < threshold) ?? null;
    return { ...def, tier, have, next, earned: tier > 0 };
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
