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
  /** A glyph, not an icon set: one character costs nothing to ship. */
  glyph: string;
  members: readonly string[];
}

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    id: 'figures',
    label: 'Figures',
    glyph: '🧸',
    members: ['Scale figures', 'Anime merch', 'Collectibles'],
  },
  { id: 'models', label: 'Model kits', glyph: '🤖', members: ['Model kits'] },
  { id: 'cards', label: 'Cards', glyph: '🃏', members: ['Trading cards'] },
  { id: 'wear', label: 'Sneakers & wear', glyph: '👟', members: ['Sneakers', 'Streetwear'] },
  { id: 'tech', label: 'Electronics', glyph: '🎧', members: ['Electronics'] },
  { id: 'beauty', label: 'Beauty & bags', glyph: '💄', members: ['Beauty', 'Bags & watches'] },
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
      // Not "has no shipment batch": an item can be in hand and still have been
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
