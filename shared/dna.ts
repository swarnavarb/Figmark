import { canonicalCategory, specFor } from './category-specs.js';
import type { RegionBox } from './models.js';
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

/**
 * Numbers in a title that say how a copy is sized, counted or scaled rather
 * than which product it is: "UK 9", "size 10", "EU 42.5", "9.5", "2 pcs",
 * "x2", "30 cm", "1/6". Taken out before the words are read, so the numbers
 * left - "Mark 85", "Jordan 1", "RX-78-2", "Gen 3" - name the product.
 */
const SIZED = [
  /\b(?:uk|us|eu|euro|size|sz|fr|it|jp)\s*:?\s*\d{1,2}(?:[.,]\d)?\b/gi,
  /\b\d{1,2}[.,]5\b/g,
  /\b\d+(?:[.,]\d+)?\s*(?:pcs|pc|pieces|piece|pack|packs|cm|mm|ml|inch|inches|in|kg|g)\b/gi,
  /\b(?:x\s*\d{1,3}|\d{1,3}\s*x)\b/gi,
  /\b\d{1,2}\s*\/\s*\d{1,3}\b/g,
];

/**
 * Words that say what kind of thing it is, which every listing in its category
 * could say: "Scarecrow" and "Scarecrow figure" are one product.
 */
const KIND_WORDS = new Set([
  'figure', 'figurine', 'action', 'statue', 'collectible', 'collectable', 'toy', 'doll', 'model', 'kit',
  'sneaker', 'shoe', 'trainer', 'packaging', 'packaged', 'carded', 'card',
]);

/** Short forms shops write for a maker: "McF" is McFarlane. Both sides are read the same way. */
const ALIASES: Record<string, string> = {
  mcf: 'mcfarlane', mcfarlanes: 'mcfarlane', mcfarlanetoys: 'mcfarlane', hottoys: 'hot', ht: 'hot',
  sh: 'shfiguarts', shf: 'shfiguarts', figuarts: 'shfiguarts', mafex: 'mafex', nendo: 'nendoroid',
  bandaispirits: 'bandai', popmart: 'pop', funkopop: 'funko', jordans: 'jordan', aj: 'jordan',
};

/**
 * Makers, licences and product lines: who made it or which range it is in,
 * not which thing it is. "McF Scarecrow" and "DC Multiverse Scarecrow" are
 * one figure, named by two of the words on its box. A brand only one side
 * names is never held against the match - but a match that leans on that is
 * only taken when the pictures back it up (see `softWords`).
 */
const MAKER_WORDS = new Set([
  'mcfarlane', 'dc', 'multiverse', 'marvel', 'legends', 'hasbro', 'mattel', 'neca', 'mezco', 'one12', 'bandai',
  'tamashii', 'shfiguarts', 'mafex', 'medicom', 'funko', 'pop', 'mart', 'kotobukiya', 'goodsmile', 'nendoroid',
  'figma', 'toys', 'sideshow', 'prime1', 'kaiyodo', 'revoltech', 'jada', 'hotwheels', 'lego', 'disney', 'pixar',
  'dccomics', 'comics', 'nike', 'adidas', 'jordan', 'puma', 'reebok', 'asics', 'vans', 'converse', 'yeezy',
]);

/** Roman numerals a model is numbered with: Mark III, Final Fantasy VII. */
const ROMAN = new Set(['ii', 'iii', 'iv', 'vi', 'vii', 'viii', 'ix', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi']);

/** Whether a word numbers a model: it has a digit in it, or it is a roman numeral. */
export const isModelWord = (word: string) => /\d/.test(word) || ROMAN.has(word);

/**
 * The words that identify a product in a title: no noise, no sizes, counts or
 * scales. Numbers that number a model are kept: Mark 85 is not Mark III.
 */
export function productWords(title: string, keepKind = false): string[] {
  const seen = new Set<string>();
  const unsized = SIZED.reduce((text, pattern) => text.replace(pattern, ' '), title);
  for (const key of wordKeys(unsized)) {
    const word = ALIASES[key] ?? key;
    if ((word.length < 2 && !/^\d$/.test(word)) || NOISE.has(word) || (!keepKind && KIND_WORDS.has(word))) continue;
    if (/^(uk|us|eu|size|sz)\d{1,2}$/.test(word)) continue;
    if (/^\d+(cm|mm|ml)$/.test(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/**
 * Whether two sets of words number their model differently: each has a
 * model number the other lacks. "Iron Man Mark 85" and "Iron Man Mark III",
 * "Jordan 1" and "Jordan 4" - however many other words they share.
 */
export function otherModel(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return a.some((word) => isModelWord(word) && !right.has(word)) && b.some((word) => isModelWord(word) && !left.has(word));
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
/**
 * Whether two sets of words name the same product on words alone: alike past
 * `SAME_PRODUCT`, or just at it with one taking in every word of the other.
 * "McFarlane DC Multiverse Scarecrow" and "…Superman" share three words of
 * four, but each has one the other lacks: two figures in one line, not one.
 * Never when each numbers its model differently (`otherModel`).
 */
export function sameProductWords(a: readonly string[], b: readonly string[]): boolean {
  if (otherModel(a, b)) return false;
  const like = wordLikeness(a, b);
  if (like < SAME_PRODUCT) return false;
  if (like > SAME_PRODUCT + 1e-9) return true;
  const [short, long] = a.length <= b.length ? [a, new Set(b)] : [b, new Set(a)];
  return short.every((word) => long.has(word));
}

/**
 * Stored words read the way `productWords` reads them today: short forms
 * spelled out, kind words ("figure") dropped. DNAs started before then keep
 * matching the listings that come after.
 */
export function normalWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const key of words) {
    const word = ALIASES[key] ?? key;
    if (NOISE.has(word) || KIND_WORDS.has(word)) continue;
    seen.add(word);
  }
  return [...seen];
}

/** Whether a word names a maker, a licence or a range rather than the thing itself. */
export const isMakerWord = (word: string) => MAKER_WORDS.has(word);

/**
 * Two sets of words with the makers only one of them names taken out: what is
 * left says which thing each is. "McFarlane Scarecrow" and "DC Multiverse
 * Scarecrow" are both just "Scarecrow" - and so are Mezco's and NECA's, which
 * is why a match on these alone always needs the pictures to agree.
 */
export function softWords(a: readonly string[], b: readonly string[]): [string[], string[]] {
  const left = new Set(a);
  const right = new Set(b);
  return [
    a.filter((word) => !isMakerWord(word) || right.has(word)),
    b.filter((word) => !isMakerWord(word) || left.has(word)),
  ];
}

/** How alike two titles are once makers only one names are set aside. */
export function softLikeness(a: readonly string[], b: readonly string[]): number {
  const [left, right] = softWords(a, b);
  return wordLikeness(left, right);
}

/**
 * Whether the thing the titles name is the same once makers only one of them
 * names are set aside - and something besides makers is left to compare.
 * Weaker than `sameProductWords`: the matcher takes it only with a picture,
 * or an eye on both pictures, saying so too.
 */
export function sameProductSoft(a: readonly string[], b: readonly string[]): boolean {
  const [left, right] = softWords(a, b);
  if (left.length === 0 || right.length === 0) return false;
  return sameProductWords(left, right);
}

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

/** Brands whose first word is also a selling word, by that word and the one after it. */
const BRAND_HALVES = new Map([['hot', 'toy']]);

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
  const leading = (token: string, next: string | undefined) => {
    const keys = keysOf(token);
    // Half of a brand's name, not a selling word: "Hot Toys".
    if (keys.length === 1 && next && BRAND_HALVES.get(keys[0]!) === keysOf(next)[0]) return false;
    return keys.length === 0 || keys.every((key) => LEAD_NOISE.has(key));
  };
  while (tokens.length > 1 && trailing(tokens[tokens.length - 1]!)) tokens.pop();
  while (tokens.length > 1 && leading(tokens[0]!, tokens[1])) tokens.shift();
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
  /** For a piece of a lot: where it sits in `photoUrl`, so it is shown cut out of the lot's photo. */
  photoBox: RegionBox | null;
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
  /**
   * Set when the only photo of it is a lot's: where it sits in `cover`, so it
   * is shown cut out. Gone once a listing of the thing alone gives a photo of its own.
   */
  coverBox: RegionBox | null;
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
  dna: { id: string; name: string; category: string; cover: string | null; coverBox: RegionBox | null; createdAt: string };
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
/* Folding and splitting, for staff                                           */
/* -------------------------------------------------------------------------- */

/** One thing on a DNA, as staff see it before they fold or split. */
export interface DnaThing {
  kind: DnaLinkKind;
  id: string;
  partition: string;
  piece: string | null;
  title: string;
  photoUrl: string | null;
  photoBox: RegionBox | null;
  /** The shop, the poster or the hunter. */
  who: string | null;
  priceMinor: number | null;
  currency: string;
  onSale: boolean;
  by: DnaLink['by'];
}

/** Why a product is suggested as this one under another name. */
export type DnaTwinWhy = 'same-photo' | 'same-thing-in-photo' | 'same-name' | 'same-name-other-maker';

export interface DnaManage {
  dna: DnaSummary & { line: DnaLine; words: string[] };
  things: DnaThing[];
  twins: { dna: DnaSummary; like: number; why: DnaTwinWhy }[];
  reviews: number;
}

/* -------------------------------------------------------------------------- */
/* Checking a listing is on the right product                                 */
/* -------------------------------------------------------------------------- */

/**
 * What a seller is asked about their own listing, right after it goes live
 * and whenever it is in doubt: which thing in the photo they are selling,
 * when it shows several; and whether the product it landed on is it.
 */
export interface DnaCheck {
  listingId: string;
  /** The lead photo shows several things and nobody has said which: where each sits. */
  photo: { url: string; boxes: RegionBox[] } | null;
  /** The product it is on, when that may be wrong; `reports`: how many people said so. */
  match: { dna: DnaSummary; why: 'reported' | 'name-differs'; reports: number } | null;
}

/** A listing somebody said is on the wrong product, for its shop and the operators to fix. */
export interface DnaReport {
  /** The listing id, with `#piece` for one thing of a lot. */
  id: string;
  listingId: string;
  piece: string | null;
  dnaId: string;
  sellerId: string;
  listingTitle: string;
  dnaName: string;
  photoUrl: string | null;
  status: 'open' | 'fixed' | 'right';
  /** How many said it is wrong, and right. */
  no: number;
  yes: number;
  /** Who answered, so nobody counts twice. Never shown. */
  voters: Record<string, 'yes' | 'no'>;
  /** What the shop did: said it is right, or moved it. */
  sellerSaid: 'right' | 'moved' | null;
  /**
   * The shop said "no, it is a different product" and moved it, but Figmark
   * still thinks it is the one it was on: staff take a look.
   */
  doubt?: DnaDoubt | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/** Why Figmark doubts a shop's "no": what still says it is the product it left. */
export interface DnaDoubt {
  why: 'same-photo' | 'same-thing-in-photo' | 'looks-same' | 'same-name';
  /** Where the shop moved it: another product, or one of its own. */
  movedTo: { id: string; name: string } | null;
  at: string;
}

/** Answers of "yes, it is right" that settle a listing: nobody is asked about it again. */
export const DNA_YES_SETTLES = 3;

/** A listing on a product the page asks its reader about: does it match? */
export interface DnaAsk {
  listingId: string;
  title: string;
  photoUrl: string | null;
  shop: string;
  /** How many already said it matches. */
  yes: number;
}

export const DNA_REPORT_PREFIX = 'dnarep:';
export const dnaReportDocId = (listingId: string, piece: string | null) => `${DNA_REPORT_PREFIX}${listingId}${piece ? `#${piece}` : ''}`;

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
