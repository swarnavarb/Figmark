/**
 * What the catalog is made of, and how it is narrowed.
 *
 * Two vocabularies, deliberately separate. A *category* says what the thing
 * is - a figure, a pair of sneakers - and is chosen by the seller when they
 * list it. A *kind* says how it is being sold - already in hand, still being
 * pooled into a pre-order, sold as one assorted lot - and is derived from the
 * listing rather than typed.
 *
 * Buyers narrow by both, and they are not interchangeable: "sneakers" and
 * "pre-orders" answer different questions, and a single flat chip row that
 * mixes them makes both harder to read.
 */

/**
 * The categories a seller may choose from.
 *
 * A fixed list rather than free text: a catalog where one seller writes
 * "Gunpla", another "Model kits" and a third "model kit" has three categories
 * with a third of the stock each, and every filter built on it is wrong. Kept
 * deliberately short - the fine distinctions belong in the title and the tags,
 * which is what search reads.
 */
export const CATEGORIES = [
  'Scale figures',
  'Model kits',
  'Trading cards',
  'Anime merch',
  'Sneakers',
  'Streetwear',
  'Electronics',
  'Beauty',
  'Bags & watches',
  'Collectibles',
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * A broad heading, and the categories that sit under it.
 *
 * The top row of the buy page. Ten chips is a list to read; six headings is a
 * choice to make, and on a phone the difference is whether the row fits. The
 * `members` array is what the filter actually matches on, so a heading is a
 * shorthand for a set of categories rather than a second field on the row -
 * nothing has to be migrated, and a category can be re-housed by editing this
 * file.
 */
export interface CategoryGroup {
  id: string;
  label: string;
  /**
   * A glyph, not an icon set: one character costs nothing to ship.
   *
   * Kept as the fallback and for anywhere text-only. The buy page draws these
   * as vectors instead, because a colour emoji is a different typeface on
   * every platform and lands as somebody else's palette in the one row that
   * is supposed to introduce ours.
   */
  glyph: string;
  /**
   * Which brand hue this heading owns.
   *
   * Presentational, and here rather than in the app so the rail, the chips on
   * a listing and any future category page all reach for the same answer. A
   * heading keeps its colour everywhere, which is what makes it learnable.
   */
  hue: 'violet' | 'coral' | 'aqua' | 'blue' | 'pink' | 'lime';
  members: readonly string[];
}

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    id: 'figures',
    label: 'Figures',
    glyph: '🧸',
    hue: 'violet',
    members: ['Scale figures', 'Anime merch', 'Collectibles'],
  },
  { id: 'models', label: 'Model kits', glyph: '🤖', hue: 'aqua', members: ['Model kits'] },
  { id: 'cards', label: 'Cards', glyph: '🃏', hue: 'pink', members: ['Trading cards'] },
  { id: 'wear', label: 'Sneakers & wear', glyph: '👟', hue: 'lime', members: ['Sneakers', 'Streetwear'] },
  { id: 'tech', label: 'Electronics', glyph: '🎧', hue: 'blue', members: ['Electronics'] },
  { id: 'beauty', label: 'Beauty & bags', glyph: '💄', hue: 'coral', members: ['Beauty', 'Bags & watches'] },
];

/** The categories under one heading, or an empty list for an unknown one. */
export function categoriesIn(groupId: string): readonly string[] {
  return CATEGORY_GROUPS.find((group) => group.id === groupId)?.members ?? [];
}

/**
 * How a listing is being sold - the second row of chips.
 *
 * `all` is a real member rather than the absence of one so the row always has
 * something switched on: a filter row where nothing is selected reads as
 * broken, and "All" is the honest name for what you are looking at.
 */
export const CATALOG_KINDS = ['all', 'pre_order', 'mixed_lot', 'in_hand'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export const CATALOG_KIND_LABELS: Record<CatalogKind, string> = {
  all: 'All',
  pre_order: 'Pre-orders',
  mixed_lot: 'Mixed lots',
  in_hand: 'In hand',
};

/**
 * How the results are ordered.
 *
 * Four, all of them over a field every listing carries. "Closing soon" is
 * deliberately absent: it only means anything for a pre-order, and a sort that
 * quietly hides two thirds of the catalog is a filter wearing a sort's clothes.
 * Urgency on this marketplace belongs to the fill meter, which counts real
 * shortfalls against a real cutoff.
 */
export const CATALOG_SORTS = ['newest', 'price_asc', 'price_desc', 'popular'] as const;
// "popular" orders by `popularity` below: views and saves, not sales.
export type CatalogSort = (typeof CATALOG_SORTS)[number];

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = {
  newest: 'Newest',
  price_asc: 'Cheapest first',
  price_desc: 'Dearest first',
  popular: 'Popularity',
};

/** What popularity reads: attention, never sales. */
interface PopularityShape {
  viewCount?: number;
  likeCount?: number;
}

/**
 * How much attention a listing is getting: every view counts once and every
 * save ten times, because a save is somebody deciding they want it.
 *
 * Deliberately not sales. Something can be wanted by a lot of people before
 * anyone has bought it, and a listing with one unit left would otherwise never
 * look popular however many people are watching it.
 */
export function popularity(listing: PopularityShape): number {
  return (listing.viewCount ?? 0) + (listing.likeCount ?? 0) * 10;
}

/** The score a listing has to reach before it is called "in demand". */
export const IN_DEMAND_SCORE = 300;

export function isInDemand(listing: PopularityShape): boolean {
  return popularity(listing) >= IN_DEMAND_SCORE;
}

/** How far ahead a timer has to end for the listing to count as ending soon. */
export const ENDING_SOON_HOURS = 7 * 24;

/** Hours until a listing's offer ends, or null when it has no timer or it already ended. */
export function hoursToEnd(listing: { expiresAt?: string | null }, now: number = Date.now()): number | null {
  if (!listing.expiresAt) return null;
  const left = (Date.parse(listing.expiresAt) - now) / 3_600_000;
  return left > 0 ? left : null;
}

export function isEndingSoon(listing: { expiresAt?: string | null }, now: number = Date.now()): boolean {
  const left = hoursToEnd(listing, now);
  return left !== null && left <= ENDING_SOON_HOURS;
}

/** What a listing needs to carry for a kind to match it. */
interface KindShape {
  preOrder: unknown;
  bundle?: boolean;
  lotId?: string | null;
  sourcing?: string;
}

/**
 * Whether one listing belongs to one kind.
 *
 * Shared rather than written twice because the in-memory store filters in
 * JavaScript and Cosmos filters in SQL, and two implementations of the same
 * rule drift the moment one of them is edited. The SQL mirrors this function
 * clause for clause; this is the definition.
 */
export function matchesKind(listing: KindShape, kind: string | undefined): boolean {
  switch (kind) {
    case 'pre_order':
      return listing.preOrder !== null && listing.preOrder !== undefined;
    case 'mixed_lot':
      return listing.bundle === true;
    case 'in_hand':
      // Not "has no shipment lot": an item can be in hand and still have been
      // imported at some point. What a buyer is asking is whether it ships from
      // the seller's shelf today, which is what `sourcing` records.
      return (listing.sourcing ?? (listing.lotId ? 'import' : 'in_hand')) === 'in_hand';
    // 'in_stock' is the name the first version of the buy page used. Kept
    // because it is in links people have already shared.
    case 'in_stock':
      return listing.preOrder === null || listing.preOrder === undefined;
    default:
      return true;
  }
}

/** What a free-text search reads. */
interface SearchShape {
  title: string;
  description: string;
  category: string;
  tags: readonly string[];
}

/**
 * Whether a listing answers a search term.
 *
 * Every word must appear somewhere, so extra words narrow rather than widen -
 * "frieren nendoroid" should not return every Nendoroid ever listed. Shared
 * because both backends apply it in JavaScript: Cosmos SQL cannot express
 * "all of these words, across four fields" without assembling the statement
 * from the term, and a query built by string concatenation is the one thing
 * this repository refuses to do.
 */
export function matchesSearch(listing: SearchShape, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [listing.title, listing.description, listing.category, ...listing.tags]
    .join(' ')
    .toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/** How long a bump keeps an item at the very top, ahead of the shops the reader follows. */
export const BUMP_LEAD_MS = 24 * 60 * 60 * 1000;

interface FreshnessShape {
  createdAt: string;
  bumpedAt?: string | null;
  sellerId: string;
}

/** When an item last came to the top: its bump, or when it was listed. */
export function freshness(listing: FreshnessShape): string {
  return listing.bumpedAt && listing.bumpedAt > listing.createdAt ? listing.bumpedAt : listing.createdAt;
}

/**
 * The "newest" order of the Buy tab.
 *
 * A bump in the last day leads, newest bump first: the seller spent a point to
 * be at the top, and following other shops must not bury it. Then the shops the
 * reader follows, then everything else, each by freshness.
 */
export function newestOrder(followed: ReadonlySet<string>, now: number = Date.now()) {
  const since = new Date(now - BUMP_LEAD_MS).toISOString();
  const leading = (l: FreshnessShape) => (l.bumpedAt && l.bumpedAt >= since ? l.bumpedAt : '');
  return (a: FreshnessShape, b: FreshnessShape): number => {
    const bump = leading(b).localeCompare(leading(a));
    if (bump !== 0) return bump;
    const follow = Number(followed.has(b.sellerId)) - Number(followed.has(a.sellerId));
    if (follow !== 0) return follow;
    return freshness(b).localeCompare(freshness(a));
  };
}
