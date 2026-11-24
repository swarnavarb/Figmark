import { canonicalCategory, specFor } from './category-specs.js';
import { wordKeys } from './shop-tags.js';

/**
 * Product DNA: one shared page per real-world product.
 *
 * Every listing of the same thing, by however many shops, points at one DNA;
 * so do the posts that show it, the hunts that ask for it and the reviews
 * people leave of it. The DNA itself stores only what identifies the product
 * and the list of things on Figmark that are about it. Everything a reader
 * sees on it - prices, demand, who sells it, photos - is worked out from those
 * things when it is read, so a post deleted is a post gone from its DNA too.
 *
 * Matching is by title words and photo fingerprints only. The original-or-copy
 * line is whatever the seller said on the listing, or the poster picked; it
 * keeps an original and its copies on separate DNAs and is never shown.
 */

/** Which line a product is on. Kept apart, never displayed. */
export type DnaLine = 'original' | 'copy';

export const DNA_LINK_KINDS = ['listing', 'post', 'want'] as const;
export type DnaLinkKind = (typeof DNA_LINK_KINDS)[number];

/** Something on Figmark that is about this product. */
export interface DnaLink {
  kind: DnaLinkKind;
  id: string;
  /** Where to read it: the seller id, the post's channel, the hunter's id. */
  partition: string;
  /** Linked by the matcher, by its owner, or by staff. An owner's choice is never undone by the matcher. */
  by: 'auto' | 'owner' | 'staff';
  at: string;
  /**
   * For a listing whose photo holds several things - sold piece by piece, or
   * as a set with each thing named - which of them this DNA is about. Each
   * thing is its own product, on its own DNA, under the name its seller gave
   * it; absent when the DNA is about the listing as a whole.
   */
  piece?: string | null;
}

/** What is stored, in `siteContent` under `dna:<id>`. */
export interface ProductDna {
  id: string;
  name: string;
  category: string;
  line: DnaLine;
  /** The words that identify it, from the titles that started it. */
  words: string[];
  /** The photo it is shown by. */
  cover: string | null;
  links: DnaLink[];
  /** `kind:id` of things taken off this DNA by their owner: the matcher never puts them back. */
  blocked: string[];
  /** Set when staff fold this into another; readers are sent there. */
  mergedInto: string | null;
  /** A few lines about the product from a free public source, kept when they were plainly about it. */
  background: { text: string; source: string; title: string } | null;
  /** When the background was last looked for, found or not. */
  backgroundTriedAt: string | null;
  /** Stars from the reviews left on it, kept so a card can show them without reading every review. */
  score?: { total: number; count: number };
  createdAt: string;
  updatedAt: string;
}

export const DNA_PREFIX = 'dna:';
export const dnaDocId = (id: string) => `${DNA_PREFIX}${id}`;
export const linkKey = (kind: DnaLinkKind, id: string) => `${kind}:${id}`;
/** One thing in a listing of several, as `blocked` remembers it: `listing:<id>#<piece>`. */
export const pieceKey = (id: string, piece: string) => `${linkKey('listing', id)}#${piece}`;

/** The most products one post or photo is tagged with. */
export const DNA_TAGS_PER_POST = 5;

/* -------------------------------------------------------------------------- */
/* Title words                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Words that say how a copy is kept, sized or sold rather than what it is. Two
 * listings of the same shoe in UK 8 and UK 10, mint and boxed, are the same
 * product.
 */
const NOISE = new Set([
  'the', 'and', 'for', 'with', 'from', 'new', 'brand', 'original', 'genuine', 'authentic', 'official', 'real',
  'legit', 'fake', 'copy', 'replica', 'bootleg', 'first', 'master', 'premium', 'batch', 'quality', 'high', 'best',
  'mint', 'misb', 'mib', 'bib', 'loose', 'boxed', 'box', 'sealed', 'deadstock', 'condition', 'used', 'preowned',
  'pre', 'owned', 'like', 'nwt', 'bnib', 'bnwt', 'unused', 'tag', 'tags', 'size', 'sz', 'uk', 'us', 'eu', 'cm',
  'mm', 'inch', 'pcs', 'pc', 'piece', 'set', 'lot', 'pack', 'import', 'imported', 'japan', 'jp', 'sale', 'deal',
  'offer', 'stock', 'instock', 'order', 'preorder', 'ready', 'ship', 'shipping', 'free', 'fast', 'india', 'cod',
  'rare', 'limited', 'exclusive', 'edition', 'ver', 'version', 'only', 'left', 'last', 'hot', 'item', 'one',
  'worn', 'women', 'woman', 'womens', 'wmns', 'men', 'man', 'mens', 'kid', 'kids', 'unisex', 'boy', 'boys', 'girl', 'girls',
]);

/** The words that identify a product in a title: no noise, no sizes, no bare numbers under three digits. */
export function productWords(title: string): string[] {
  const seen = new Set<string>();
  for (const word of wordKeys(title)) {
    if (word.length < 2 || NOISE.has(word)) continue;
    if (/^(uk|us|eu|size|sz)?\d{1,2}(\.\d)?$/.test(word)) continue;
    if (/^\d+(cm|mm|ml|gb|tb)$/.test(word) && !/gb|tb/.test(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/**
 * How alike two sets of product words are, 0 to 1: the shared words over the
 * longer set. "Nike Dunk Low Panda" and "Nike Dunk Low Panda UK9 deadstock"
 * are 1; "…Panda" and "…Grey Fog" are 0.6 - the same model, another product.
 */
export function wordLikeness(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const right = new Set(b);
  const shared = a.filter((word) => right.has(word)).length;
  return shared / Math.max(a.length, b.length);
}

/** Over this, two titles name the same product on words alone. */
export const SAME_PRODUCT = 0.75;
/** Over this, with a photo of the same thing, they do. */
export const SAME_WITH_PHOTO = 0.5;
/** A hunt's title is short and loose: over this share of its own words, it is asking for this. */
export const HUNT_COVERED = 0.75;

/** How much of `asked` the product's words cover, for a short title like a hunt's. */
export function covered(asked: readonly string[], product: readonly string[]): number {
  if (asked.length === 0) return 0;
  const have = new Set(product);
  return asked.filter((word) => have.has(word)).length / asked.length;
}

/** The line a listing is on, by what its seller said in the category's "Original or copy?" question. */
export function lineOf(category: string, attributes: Record<string, string> | undefined): DnaLine {
  const said = attributes?.authenticity;
  if (!said) return 'original';
  // Some originals, some copies: never put with the originals.
  if (said === 'Mixed') return 'copy';
  const field = specFor(category)?.fields.find((entry) => entry.key === 'authenticity');
  const option = field?.options?.find((entry) => entry.value === said);
  return option && option.genuine === false ? 'copy' : 'original';
}

/** One category name per kind of thing, so "sneakers" and "Sneakers" are one. */
export const sameCategory = (a: string, b: string) => (canonicalCategory(a) ?? a) === (canonicalCategory(b) ?? b);

/** Selling words a title may open with ("BNIB Nike…"). Not "new": it is half of New Balance. */
const LEAD_NOISE = new Set([
  'brand', 'bnib', 'bnwt', 'nwt', 'sale', 'original', 'genuine', 'authentic', 'official', 'rare', 'hot', 'sealed',
  'import', 'imported', 'preorder', 'pre', 'order', 'instock', 'ready', 'stock', 'deal', 'offer', 'limited',
]);

/**
 * A product's name, from the title that started it: the part before a dash or
 * a bar, where shops put the size and the state of their copy ("— UK 8,
 * worn"), trimmed of selling words at either end and kept as the seller
 * spelled it.
 */
export function nameFrom(title: string): string {
  const parts = title.split(/\s+[—–|-]\s+|\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
  const head = parts.find((part) => productWords(part).length >= 2) ?? parts[0] ?? title;
  const tokens = head.replace(/\s+/g, ' ').trim().split(' ');
  const keysOf = (token: string) => wordKeys(token);
  const trailing = (token: string) => {
    const keys = keysOf(token);
    return keys.length === 0 || keys.every((key) => NOISE.has(key) || /^(uk|us|eu)?\d{1,2}(\.\d)?$/.test(key));
  };
  const leading = (token: string) => {
    const keys = keysOf(token);
    return keys.length === 0 || keys.every((key) => LEAD_NOISE.has(key));
  };
  while (tokens.length > 1 && trailing(tokens[tokens.length - 1]!)) tokens.pop();
  while (tokens.length > 1 && leading(tokens[0]!)) tokens.shift();
  const name = tokens.join(' ').replace(/[\s,|/-]+$/, '');
  return name.length > 70 ? `${name.slice(0, 67).trimEnd()}…` : name;
}

/* -------------------------------------------------------------------------- */
/* What a reader is sent                                                      */
/* -------------------------------------------------------------------------- */

export type DnaHeatLabel = 'Quiet' | 'Warm' | 'Hot' | 'On fire';

/** Demand, from what people already do: hunts, saves, views, sales, pledges, restock waits. */
export interface DnaDemand {
  /** 0 to 100. */
  heat: number;
  label: DnaHeatLabel;
  hunting: number;
  saves: number;
  views: number;
  sold: number;
  pledged: number;
  waiting: number;
}

/** 0 to 100 from the raw counts; a log scale so one viral listing cannot peg it. */
export function heatOf(counts: Omit<DnaDemand, 'heat' | 'label'>): { heat: number; label: DnaHeatLabel } {
  const points = counts.hunting * 6 + counts.saves * 2 + counts.views * 0.1 + counts.sold * 5 + counts.pledged * 4
    + counts.waiting * 3;
  const heat = Math.max(0, Math.min(100, Math.round(Math.log10(1 + points) * 25)));
  const label: DnaHeatLabel = heat >= 80 ? 'On fire' : heat >= 55 ? 'Hot' : heat >= 25 ? 'Warm' : 'Quiet';
  return { heat, label };
}

export interface DnaShop {
  id: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
}

export interface DnaListingCard {
  id: string;
  /** The thing's own name: a piece of a lot or set goes by the name its seller gave it. */
  title: string;
  /** Set when it is one of several things in one listing: that piece, and the listing's own title. */
  piece: { id: string; listingTitle: string; set: boolean } | null;
  priceMinor: number;
  currency: string;
  shippingMinor: number | null;
  photoUrl: string | null;
  onSale: boolean;
  condition: string;
  shop: DnaShop | null;
  /** Against the typical asking price now: under it, about it, or over it. */
  deal: 'low' | 'fair' | 'high' | null;
}

/** The small form, for cards, chips and Discover. */
export interface DnaSummary {
  id: string;
  name: string;
  category: string;
  cover: string | null;
  lowMinor: number | null;
  highMinor: number | null;
  currency: string;
  sellers: number;
  heat: number;
  heatLabel: DnaHeatLabel;
  rating: number | null;
  ratings: number;
  mentions: number;
}

export interface DnaReviewCard {
  id: string;
  rating: number;
  body: string;
  photoUrls: string[];
  authorName: string;
  authorHandle: string | null;
  createdAt: string;
  /** Set when the author bought this product on Figmark: the shop they bought it from. */
  owner: { shop: string; handle: string | null } | null;
  mine: boolean;
}

export interface DnaPostCard {
  channelId: string;
  id: string;
  body: string;
  photoUrl: string | null;
  authorName: string;
  createdAt: string;
  likeCount: number;
  replyCount: number;
}

export interface DnaHuntCard {
  id: string;
  buyerId: string;
  title: string;
  budgetMinor: number | null;
  currency: string;
  hunters: number;
  createdAt: string;
}

export interface DnaPhoto {
  url: string;
  from: 'listing' | 'post' | 'review' | 'hunt' | 'buyer';
  /** Where tapping it goes, inside the app: a page, or `#review-<id>` for an owner's review on this one. */
  href: string | null;
}

export interface DnaTimelineEntry {
  at: string;
  label: string;
  kind: 'born' | 'listed' | 'sold' | 'low' | 'high' | 'post' | 'hunt' | 'review';
}

export interface DnaView {
  dna: { id: string; name: string; category: string; cover: string | null; createdAt: string };
  price: {
    currency: string;
    lowMinor: number;
    typicalMinor: number;
    highMinor: number;
    onSale: number;
    /** What shops typically charge to ship it, when they say. */
    shippingMinor: number | null;
  } | null;
  /** Weekly, oldest first: the middle price it sold at, and how many sold. */
  trend: { at: string; minor: number; sales: number }[];
  /** What hunters say they will pay, beside what shops ask. */
  gap: { askMinor: number; offerMinor: number; hunts: number } | null;
  demand: DnaDemand;
  sellingNow: DnaListingCard[];
  soldBefore: { shop: DnaShop; units: number }[];
  couldGet: { shop: DnaShop; because: string }[];
  rating: { average: number | null; count: number; owners: number };
  reviews: DnaReviewCard[];
  yours: { rating: number; body: string; photoUrls: string[] } | null;
  /** Whether the reader bought it here, so the form can say they will be shown as an owner. */
  youOwn: { shop: string } | null;
  posts: DnaPostCard[];
  hunts: DnaHuntCard[];
  gallery: DnaPhoto[];
  facts: { label: string; value: string }[];
  timeline: DnaTimelineEntry[];
  background: { text: string; source: string } | null;
  related: DnaSummary[];
  /** What this reader may fix: their own listings, posts and hunts on it; and whether they are staff. */
  yourLinks: { kind: DnaLinkKind; id: string; partition: string; title: string; piece?: string | null }[];
  staff: boolean;
  /** The reader's follow, while it runs. */
  follow: { until: string } | null;
  /** How many people follow it right now: a number, never names. */
  watchers: number;
  /** The reader's own open hunt for it, so the button says so instead of posting another. */
  hunting: { id: string; buyerId: string; expiresAt: string } | null;
}

/* -------------------------------------------------------------------------- */
/* Following a DNA                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One person following one DNA for a while they chose, at most three months.
 * Kept as `siteContent` row `dnaf:<dnaId>:<userId>` with a Cosmos time-to-live,
 * so the row goes by itself when the follow ends; the alert check deletes any
 * it finds past its end as well.
 *
 * What it remembers is the market as last told to this person - the lowest
 * price and which listings were on sale - so the next alert says what changed.
 */
export interface DnaFollow {
  dnaId: string;
  userId: string;
  until: string;
  lowMinor: number | null;
  onSale: string[];
  createdAt: string;
}

export const DNA_FOLLOW_PREFIX = 'dnaf:';
export const dnaFollowId = (dnaId: string, userId: string) => `${DNA_FOLLOW_PREFIX}${dnaId}:${userId}`;

/** A lowest price that moved less than this is not news. */
export const PRICE_MOVE_SHARE = 0.02;
