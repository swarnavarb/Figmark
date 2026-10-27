import { canonicalCategory } from '../../shared/catalog.js';
import type { Listing } from '../../shared/models.js';
import { wordKeys } from '../../shared/shop-tags.js';
import { isExpired } from '../../shared/payments.js';
import { fingerprintOf, isFingerprinted, storedFingerprint } from './image-hash.js';
import { describedScore, onlyAlike, pictureLooks, pictureScore, type LearnedHash, type PictureLook } from './photo-search.js';
import { getPhotoStore } from './storage/index.js';
import { describeItems, visionAvailable, type PhotoDescription } from './vision.js';

/**
 * Where the things in a photo are, or were, for sale.
 *
 * Photo search starts from a picture the shopper brings; this starts from one
 * already on Figmark - a post, a channel message, a listing, an order photo -
 * and answers the question a collector has looking at somebody's shelf: can I
 * buy that, and who has sold it before?
 *
 * The photo is split into the items in it when vision is on, each matched by
 * the words Claude read for it; the picture itself is matched by fingerprint
 * either way, so a reposted listing photo finds its listing with no key at all.
 * The words shown with the photo - a post's caption, a listing's title - are
 * searched too, against listing titles, so a haul post that names what is in
 * it finds those items with no key at all.
 *
 * Unlike photo search the pool reaches back past what is buyable now: an item
 * sold out or taken down is still evidence of who sells that thing. And past
 * the items themselves, it names the shops likely to get one: those that list
 * the brand or name first (Nike, McFarlane), then those that deal in the kind
 * of thing (sneakers, action figures).
 *
 * Under all of that sit the probable matches: a guess, ranked by how likely
 * each listing is to be the thing in the photo, for when nothing is certain -
 * a different photo of the same figure, with a caption that names nothing.
 * The colours of the subject (backdrop aside), any word the caption shares
 * with a title, and whether the person who posted the photo lists it, put
 * together into one chance. It is allowed to be wrong; it is shown as a guess.
 */
export interface SalesGroup {
  /** What Claude named the item, or null for listings found by the picture alone. */
  label: string | null;
  /** Best match first. */
  listings: Listing[];
}

export interface PastSeller {
  sellerId: string;
  /** Units sold across the matching items, as their counts have it. */
  unitsSold: number;
  /** How many of the matching items were this shop's and have sold. */
  items: number;
}

export interface LikelySeller {
  sellerId: string;
  /** What they were matched on: a keyword, like "Nike", or a category, like "Sneakers". */
  because: string;
  kind: 'keyword' | 'similar' | 'category';
  /** How many of their listings, past or present, carry it. */
  listings: number;
}

export interface ProbableListing {
  listing: Listing;
  /** 0 to 1: how likely this is the thing in the photo. A guess. */
  chance: number;
}

export interface PhotoSales {
  items: SalesGroup[];
  sellers: PastSeller[];
  likely: LikelySeller[];
  /** Listings that may be the thing in the photo, likeliest first; none of those in `items`. */
  probable: ProbableListing[];
  /** Listing photo fingerprints worked out to answer this, worth storing on the listings. */
  learned: LearnedHash[];
}

const PER_ITEM = 24;
const SELLERS = 12;
const LIKELY = 10;
/** Shops named per keyword or category, so one word cannot fill the list. */
const LIKELY_PER_TERM = 3;
/** Keywords tried for likely shops, most telling first. */
const TERMS = 6;
const PROBABLE = 8;
/** A probable match under this is not worth showing. */
const PROBABLE_FLOOR = 0.15;
/** The poster's own listings shown on that alone, with nothing else pointing at them. */
const POSTERS_OWN = 3;

/** Words that say nothing about what an item is. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those', 'have', 'has', 'had', 'are', 'was', 'were',
  'been', 'but', 'not', 'you', 'your', 'our', 'they', 'them', 'their', 'who', 'what', 'where', 'when', 'which',
  'just', 'got', 'get', 'finally', 'here', 'there', 'now', 'new', 'one', 'two', 'all', 'any', 'out', 'off', 'into',
  'about', 'more', 'some', 'very', 'really', 'still', 'want', 'wanted', 'year', 'month', 'week', 'day', 'today',
  'home', 'haul', 'photo', 'pic', 'tap', 'see', 'look', 'item', 'thing', 'stuff', 'anyone', 'know', 'sold', 'sell',
  'seller', 'shop', 'buy', 'price', 'left', 'last', 'run', 'box', 'boxed', 'sealed', 'japan', 'japanese', 'version',
  'ver', 'edition', 'original', 'real', 'fake', 'legit', 'set', 'lot', 'piece', 'pcs', 'unit', 'size',
  'good', 'great', 'company', 'official', 'limited', 'exclusive', 'mint', 'rare', 'condition', 'tag', 'center',
  'import', 'imported', 'pre', 'order', 'preorder', 'stock', 'instock', 'sale', 'deal', 'authentic', 'genuine', 'hand',
]);

/** Everyday words for a kind of thing, read as the category a shop files it under. */
const KIND_WORDS: Record<string, string> = {
  shoe: 'Sneakers', sneaker: 'Sneakers', kick: 'Sneakers', trainer: 'Sneakers',
  figure: 'Figures', action: 'Figures', figurine: 'Figures', statue: 'Figures', nendoroid: 'Figures', figma: 'Figures',
  kit: 'Model kits', gunpla: 'Model kits', model: 'Model kits',
  card: 'Trading cards', tcg: 'Trading cards', booster: 'Trading cards',
  plush: 'Anime merch', plushy: 'Anime merch', plushie: 'Anime merch', keychain: 'Anime merch', acrylic: 'Anime merch',
  hoodie: 'Streetwear', tee: 'Streetwear', shirt: 'Streetwear', jacket: 'Streetwear', cap: 'Streetwear',
  phone: 'Electronics', headphone: 'Electronics', earbud: 'Electronics', console: 'Electronics', camera: 'Electronics',
  watch: 'Bags & watches', bag: 'Bags & watches', wallet: 'Bags & watches',
  perfume: 'Beauty', skincare: 'Beauty', lipstick: 'Beauty',
};

/** The words worth matching on: no stop words, no bare numbers, nothing under three letters. */
function keyWords(text: string): string[] {
  return wordKeys(text).filter((word) => word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word));
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Listed for sale at some point and seen by the public: drafts, private deals and members' windows are not. */
export function everListed(listing: Listing): boolean {
  return listing.status !== 'draft' && !listing.privateFor && !listing.unlisted;
}

/** Buyable right now. */
export function onSale(listing: Listing): boolean {
  return listing.status === 'active' && !isExpired(listing);
}

/** Has sold, at least once, by its count or by running out. */
function hasSold(listing: Listing): boolean {
  return (listing.soldCount ?? 0) > 0 || listing.status === 'sold_out';
}

/**
 * What Claude read in each stored photo, by blob name.
 *
 * Blob names are never reused and the bytes behind one never change, so a
 * reading is good for as long as it is kept: a photo opened by a hundred
 * people is read once per host instance. Readings that failed are not kept, so
 * the next look tries again. In-flight readings are shared, so a burst of
 * viewers opening the same new post costs one call.
 */
const readings = new Map<string, Promise<PhotoDescription[] | null>>();
const READINGS_MAX = 5_000;

/** Whether looking at this photo again would cost nothing - nothing to read, or already read. */
export function alreadyRead(blobName: string, vision: boolean): boolean {
  return !vision || readings.has(blobName);
}

function readItems(blobName: string, bytes: Uint8Array, contentType: string): Promise<PhotoDescription[] | null> {
  const known = readings.get(blobName);
  if (known) return known;
  const reading = describeItems(bytes, contentType).then((items) => {
    if (items === null) readings.delete(blobName);
    return items;
  });
  if (readings.size >= READINGS_MAX) readings.delete(readings.keys().next().value!);
  readings.set(blobName, reading);
  return reading;
}

/** For tests: forget every reading. */
export function forgetReadings(): void {
  readings.clear();
}

/**
 * What every answer works out from the catalogue alone - the pool, its title
 * index, what each shop deals in - kept per catalogue snapshot. The caller
 * holds one snapshot for a minute, so a feed full of photos builds these once
 * rather than once per photo.
 */
interface Prepared {
  pool: Listing[];
  index: ReturnType<typeof titleIndex>;
  shops: ReturnType<typeof shopVocabulary>;
  /** Answers by photo, caption and poster, for this snapshot. */
  answers: Map<string, PhotoSales>;
}
const prepared = new WeakMap<Listing[], Prepared>();
const ANSWERS_MAX = 500;

function prepare(catalogue: Listing[]): Prepared {
  let ready = prepared.get(catalogue);
  if (!ready) {
    const pool = catalogue.filter(everListed);
    ready = { pool, index: titleIndex(pool), shops: shopVocabulary(pool), answers: new Map() };
    prepared.set(catalogue, ready);
  }
  return ready;
}

/**
 * The listings a stored photo's items are or were for sale under, the shops
 * that have sold them, and the shops likely to get them. `about` is the text
 * shown with the photo, `by` who posted it. Null when the photo is not in the store.
 *
 * Answers are kept for as long as the catalogue snapshot is: the same post
 * seen by a hundred people is worked out once.
 */
export async function findSales(
  blobName: string, catalogue: Listing[], about = '', by: string | null = null,
): Promise<PhotoSales | null> {
  const ready = prepare(catalogue);
  const key = `${blobName}\n${about}\n${by ?? ''}`;
  const kept = ready.answers.get(key);
  if (kept) return kept;

  // The photo's bytes are read only when something needs them: a fingerprint
  // this instance has not worked out, or items Claude has not read. A photo
  // fingerprinted before was in the store, so need not be read to know it is.
  const vision = visionAvailable();
  let hash: string | null;
  let described: PhotoDescription[] | null;
  if (isFingerprinted(blobName) && alreadyRead(blobName, vision)) {
    [hash, described] = await Promise.all([storedFingerprint(blobName), vision ? readings.get(blobName)! : null]);
  } else {
    const photo = await (await getPhotoStore()).read(blobName);
    if (!photo) return null;
    hash = fingerprintOf(blobName, photo.bytes, photo.contentType);
    described = vision ? await readItems(blobName, photo.bytes, photo.contentType) : null;
  }

  const found = answer(ready, hash ? await looksFor(ready.pool, hash, by) : { looks: new Map(), learned: [] },
    described ?? [], about, by);
  // A reading that failed is tried again on the next look, so its answer is not kept.
  if (!vision || described) {
    if (ready.answers.size >= ANSWERS_MAX) ready.answers.delete(ready.answers.keys().next().value!);
    // Kept without what was learned: that is stored once, by the first answer.
    ready.answers.set(key, { ...found, learned: [] });
  }
  return found;
}

/** How the pool compares with the photo, the poster's own listings and the newest compared first. */
async function looksFor(pool: Listing[], hash: string, by: string | null) {
  // Those are the likeliest, and the ones to compare when there are more photos than one look can read.
  const ordered = [...pool].sort((a, b) => Number(b.sellerId === by) - Number(a.sellerId === by)
    || b.createdAt.localeCompare(a.createdAt));
  const learned: LearnedHash[] = [];
  return { looks: await pictureLooks(ordered, hash, learned), learned };
}

function answer(
  { pool, index, shops }: Prepared, { looks, learned }: { looks: Map<string, PictureLook>; learned: LearnedHash[] },
  items: PhotoDescription[], about: string, by: string | null,
): PhotoSales {
  const pictures = onlyAlike(looks);

  // Each listing goes to the one group it matches best. A listing that uses this
  // very picture is about the photo's main item, so it counts toward the first.
  const best = new Map<string, { group: number; score: number }>();
  const labels: (string | null)[] = items.length > 0
    ? items.map((item) => item.query || item.keywords.join(' '))
    : [null];
  const itemWords = items.map((item) => new Set(keyWords([...item.keywords, item.query].join(' '))));
  // Only listings something points at are scored: a picture match, or a title word Claude read.
  const named = new Set(itemWords.flatMap((words) => [...words]));
  const candidates = items.length > 0 ? pool.filter((listing) => pictures.has(listing.id)
    || index.shared(listing, named).length > 0) : pool.filter((listing) => pictures.has(listing.id));
  candidates.forEach((listing) => {
    const picture = pictureScore(pictures.get(listing.id));
    items.forEach((item, group) => {
      // The same telling-words rule as the caption: a brand alone is a shop to
      // ask, not the item, so it is left to the likely shops.
      const words = index.tells(listing, itemWords[group]!) ? describedScore(listing, item) : 0;
      const score = words + (group === 0 ? picture : 0);
      if (score > 0 && score > (best.get(listing.id)?.score ?? 0)) best.set(listing.id, { group, score });
    });
    // Nothing named in the photo: the picture is all it has to go on.
    if (items.length === 0 && picture > 0) best.set(listing.id, { group: 0, score: picture });
  });

  // Then the words shown with it, for whatever the photo did not already find.
  for (const found of captionMatches(index, pool.filter((listing) => !best.has(listing.id)), about)) {
    let group = labels.indexOf(found.label);
    if (group < 0) group = labels.push(found.label) - 1;
    best.set(found.listing.id, { group, score: found.score });
  }

  const placed = pool.filter((listing) => best.has(listing.id));
  const groups: SalesGroup[] = labels.map((label, group) => ({
    label,
    listings: placed
      .filter((listing) => best.get(listing.id)!.group === group)
      .sort((a, b) => Number(onSale(b)) - Number(onSale(a))
        || best.get(b.id)!.score - best.get(a.id)!.score
        || b.createdAt.localeCompare(a.createdAt))
      .slice(0, PER_ITEM),
  })).filter((group) => group.listings.length > 0);

  const bySeller = new Map<string, PastSeller>();
  for (const listing of groups.flatMap((group) => group.listings)) {
    if (!hasSold(listing)) continue;
    const seller = bySeller.get(listing.sellerId) ?? { sellerId: listing.sellerId, unitsSold: 0, items: 0 };
    seller.unitsSold += listing.soldCount ?? 0;
    seller.items += 1;
    bySeller.set(listing.sellerId, seller);
  }
  const sellers = [...bySeller.values()]
    .sort((a, b) => b.unitsSold - a.unitsSold || b.items - a.items)
    .slice(0, SELLERS);

  const shown = new Set(groups.flatMap((group) => group.listings.map((listing) => listing.id)));
  const sure = new Set(groups.flatMap((group) => group.listings.map((listing) => listing.category)));
  const probable = probableMatches(index, pool.filter((listing) => !shown.has(listing.id)), looks, items, about, by, sure);
  return { items: groups, sellers, likely: likelySellers(index, shops, groups, items, about, probable), probable, learned };
}

/**
 * The listings likeliest to be the thing in the photo, each with a chance.
 *
 * Each piece of evidence is a chance of its own, and they are put together as
 * independent odds: the subject's colours, a word the caption shares with the
 * title (a rare word counts for more), the poster's own listing when it also
 * looks something like the photo, and the kind of thing the caption names.
 * Colour is weak evidence, so when the photo already has certain matches it
 * counts for half outside their categories.
 */
function probableMatches(
  index: ReturnType<typeof titleIndex>, pool: Listing[], looks: Map<string, PictureLook>,
  items: PhotoDescription[], about: string, by: string | null, sure: Set<string>,
): ProbableListing[] {
  const said = new Set([
    ...keyWords(about.slice(0, 500)),
    ...items.flatMap((item) => keyWords([...item.keywords, item.query].join(' '))),
  ]);
  const kinds = new Set([
    ...[...said].flatMap((word) => KIND_WORDS[word] ?? []),
    ...items.flatMap((item) => item.category ?? []),
  ]);
  const clamp = (value: number) => Math.max(0, Math.min(1, value));

  const found: (ProbableListing & { ownOnly: boolean })[] = [];
  for (const listing of pool) {
    const seen = looks.get(listing.id);
    const look = clamp(((seen?.look ?? 0) - 0.15) / 0.45);
    const colour = sure.size > 0 && !sure.has(listing.category) ? 0.5 : 1;
    const odds = [colour * 0.6 * look, colour * 0.4 * clamp(((seen?.visual ?? 0) - 0.45) / 0.3)];
    const shared = index.shared(listing, said).filter((word) => !KIND_WORDS[word]);
    if (shared.length > 0) {
      odds.push(Math.min(0.6, shared.reduce((sum, word) => sum + 0.6 / Math.sqrt(index.seen.get(word) ?? 1), 0)));
    }
    if (kinds.has(listing.category)) odds.push(0.15);
    const other = 1 - odds.reduce((miss, odd) => miss * (1 - odd), 1);
    // People post what they sell: their own listings are a fair guess on that
    // alone, and a better one the more the photo looks like them.
    const own = Boolean(by && listing.sellerId === by);
    const chance = own ? 1 - (1 - other) * (1 - (0.15 + 0.3 * clamp(look * 2))) : other;
    if (chance >= PROBABLE_FLOOR) found.push({ listing, chance, ownOnly: own && other < PROBABLE_FLOOR });
  }
  let ownOnly = 0;
  return found
    .sort((a, b) => b.chance - a.chance || Number(onSale(b.listing)) - Number(onSale(a.listing))
      || b.listing.createdAt.localeCompare(a.listing.createdAt))
    // A shop posts plenty that is not one of its listings: only a few on that alone.
    .filter((entry) => !entry.ownOnly || (ownOnly += 1) <= POSTERS_OWN)
    .slice(0, PROBABLE)
    .map(({ listing, chance }) => ({ listing, chance }));
}

/**
 * Which words every title carries, and how many titles carry each.
 *
 * A word only a few titles carry - "frieren", "pikachu" - is telling alone;
 * a common one - "nike" in a sneaker shop's catalogue - needs a second word
 * beside it. A word for a kind of thing ("figure", "shoe") never counts alone:
 * it is a category, and goes to the likely shops instead.
 */
function titleIndex(pool: Listing[]) {
  const titles = new Map(pool.map((listing) => [listing.id, new Set(keyWords(listing.title))]));
  const seen = new Map<string, number>();
  for (const words of titles.values()) for (const word of words) seen.set(word, (seen.get(word) ?? 0) + 1);
  const rare = Math.max(3, pool.length * 0.02);
  // How the titles spell each word, so a label reads "McFarlane", not "mcfarlane".
  const spelling = new Map<string, string>();
  for (const listing of pool) {
    for (const token of listing.title.split(/[\s/,()"'—–-]+/)) {
      const keys = wordKeys(token);
      if (keys.length === 1 && !spelling.has(keys[0]!)) spelling.set(keys[0]!, token.replace(/[^\p{L}\p{N}]+/gu, ''));
    }
  }
  const shared = (listing: Listing, wanted: Set<string>) =>
    [...(titles.get(listing.id) ?? [])].filter((word) => wanted.has(word));
  const enough = (words: string[]) => {
    const named = words.filter((word) => !KIND_WORDS[word]);
    return named.length >= 2 || (named.length === 1 && (seen.get(named[0]!) ?? 0) <= rare);
  };
  return {
    seen,
    shared,
    /** A word as the titles write it, capitalised when none do. */
    spell: (word: string) => spelling.get(word) ?? capital(word),
    enough,
    /** Whether the listing's title shares enough telling words with these. */
    tells: (listing: Listing, wanted: Set<string>) => enough(shared(listing, wanted)),
  };
}

/** Listings whose title shares telling words with the text, grouped by the rarest of them. */
function captionMatches(
  index: ReturnType<typeof titleIndex>, pool: Listing[], about: string,
): { listing: Listing; label: string; score: number }[] {
  const said = keyWords(about.slice(0, 500));
  if (said.length === 0) return [];
  const wanted = new Set(said);
  const df = (word: string) => index.seen.get(word) ?? 1;

  const found: { listing: Listing; key: string; shared: string[]; score: number }[] = [];
  for (const listing of pool) {
    const shared = index.shared(listing, wanted);
    if (!index.enough(shared)) continue;
    const named = shared.filter((word) => !KIND_WORDS[word]);
    const key = named.reduce((a, b) => (df(b) < df(a) ? b : a));
    found.push({ listing, key, shared, score: shared.reduce((sum, word) => sum + 4 / df(word), 0) });
  }
  // One label per group: the words the best match shares, in the order the text says them.
  const labelOf = new Map<string, string>();
  for (const entry of [...found].sort((a, b) => b.score - a.score)) {
    if (labelOf.has(entry.key)) continue;
    const words = said.filter((word, at) => entry.shared.includes(word) && said.indexOf(word) === at);
    labelOf.set(entry.key, words.map(index.spell).join(' '));
  }
  return found.map((entry) => ({ listing: entry.listing, label: labelOf.get(entry.key)!, score: entry.score }));
}

/**
 * Shops likely to get the photo's items, whether or not they list them now.
 *
 * Keywords first - the brand, the name, the line - because a shop that lists
 * Nike is a better bet for a Nike shoe than one that lists shoes; then the
 * categories, for a photo of something nobody has listed by name. What a shop
 * deals in is read off everything it has ever listed: titles, tags, category.
 */
/** What each shop deals in, and how many of its listings say so; and how many shops carry each word. */
function shopVocabulary(pool: Listing[]) {
  const vocabulary = new Map<string, Map<string, number>>();
  for (const listing of pool) {
    const words = new Set([...keyWords(listing.title), ...listing.tags.flatMap(keyWords), `#${listing.category}`]);
    const shop = vocabulary.get(listing.sellerId) ?? new Map<string, number>();
    for (const word of words) shop.set(word, (shop.get(word) ?? 0) + 1);
    vocabulary.set(listing.sellerId, shop);
  }
  const shopsWith = new Map<string, number>();
  /** Words some shop lists again and again: what a brand or a line looks like. */
  const dealtIn = new Set<string>();
  for (const words of vocabulary.values()) {
    for (const [word, count] of words) {
      shopsWith.set(word, (shopsWith.get(word) ?? 0) + 1);
      if (count >= 2) dealtIn.add(word);
    }
  }
  return { vocabulary, shopsWith, dealtIn };
}

function likelySellers(
  index: ReturnType<typeof titleIndex>, { vocabulary, shopsWith, dealtIn }: ReturnType<typeof shopVocabulary>,
  groups: SalesGroup[], items: PhotoDescription[], about: string, probable: ProbableListing[],
): LikelySeller[] {
  const matched = groups.flatMap((group) => group.listings);
  const taken = new Set(matched.map((listing) => listing.sellerId));

  // Keywords, most telling first: what Claude read, then the text, then the tags of what matched.
  // A word the matched titles share is about the item. Any other word counts
  // only when some shop lists it again and again, which is what a brand or a
  // line looks like - not a place or an event named once ("Mumbai", "con").
  const keywords: string[] = [];
  const kinds: string[] = [];
  const itemWords = new Set(matched.slice(0, 12).flatMap((listing) => keyWords(listing.title)));
  // A keyword singles out a few shops; one most of them carry says nothing.
  const telling = Math.max(3, vocabulary.size * 0.5);
  const addKeyword = (word: string, fromItems = false) => {
    const kind = KIND_WORDS[word];
    if (kind) { if (!kinds.includes(kind)) kinds.push(kind); return; }
    if (!fromItems && !itemWords.has(word) && !dealtIn.has(word)) return;
    const shops = shopsWith.get(word) ?? 0;
    if (shops > 0 && !keywords.includes(word) && shops <= telling) keywords.push(word);
  };
  items.forEach((item) => item.keywords.flatMap(keyWords).forEach((word) => addKeyword(word)));
  keyWords(about.slice(0, 500)).forEach((word) => addKeyword(word));
  matched.slice(0, 6).flatMap((listing) => listing.tags.flatMap(keyWords)).forEach((word) => addKeyword(word, true));
  const guesses = probable.slice(0, 3).map((entry) => entry.listing);
  for (const category of [
    ...items.map((item) => item.category), ...matched.map((listing) => listing.category), ...guesses.map((listing) => listing.category),
  ]) {
    const known = canonicalCategory(category);
    if (known && !kinds.includes(known)) kinds.push(known);
  }

  const likely: LikelySeller[] = [];
  const pick = (term: string, because: string, kind: LikelySeller['kind']) => {
    [...vocabulary.entries()]
      .map(([sellerId, words]) => ({ sellerId, count: words.get(term) ?? 0 }))
      .filter((entry) => entry.count > 0 && !taken.has(entry.sellerId))
      .sort((a, b) => b.count - a.count)
      .slice(0, LIKELY_PER_TERM)
      .forEach((entry) => {
        if (likely.length >= LIKELY) return;
        taken.add(entry.sellerId);
        likely.push({ sellerId: entry.sellerId, because, kind, listings: entry.count });
      });
  };
  keywords.slice(0, TERMS).forEach((word) => pick(word, index.spell(word), 'keyword'));
  // Then the shops behind the probable matches: they list something like it.
  const similar = new Map<string, number>();
  for (const { listing } of probable) similar.set(listing.sellerId, (similar.get(listing.sellerId) ?? 0) + 1);
  for (const [sellerId, count] of similar) {
    if (likely.length >= LIKELY || taken.has(sellerId)) continue;
    taken.add(sellerId);
    likely.push({ sellerId, because: 'Similar listings', kind: 'similar', listings: count });
  }
  kinds.forEach((category) => pick(`#${category}`, category, 'category'));
  return likely;
}
