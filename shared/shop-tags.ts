/**
 * A shop's identity, as tags.
 *
 * What a shop says about itself (its own tags) and what it actually lists
 * (every listing's tags and category) folded into one short ranked list. It
 * is what search, the tag pages, "shops for you" and the Data tab all read,
 * so they agree on what a shop is about.
 *
 * Kept small on purpose: at most IDENTITY_SIZE entries of three short fields,
 * stored on the shop's own profile and rewritten only when a listing or the
 * shop's tags change. Nothing is stored per listing, per search or per view.
 */

/** One tag in a shop's identity: its match key, the label to show, and a weight. */
export interface ShopTag {
  /** Normalised key - what matching and the /tags/ page use. */
  k: string;
  /** How the tag reads, in the shop's most common spelling. */
  l: string;
  /** Weight: listings carrying it, plus OWN_WEIGHT if the shop declared it. */
  n: number;
  /** 1 when the shop chose this tag itself. */
  own?: 1;
  /** 1 when the shop declared it as a side line under "Also sells". */
  side?: 1;
}

export const IDENTITY_SIZE = 12;
/** A declared tag counts like this many listings: what a shop says it is matters most. */
export const OWN_WEIGHT = 5;
/** A declared side line counts less than a tag: it is what else the shop carries, not what it is. */
export const SIDE_WEIGHT = 2;
/** The most side lines a shop may declare. */
export const ALSO_SELLS_MAX = 6;

/**
 * What a shop may say it also sells: every catalog category, and under each
 * the specific lines buyers actually look for. A fixed list, so two shops
 * that both "also sell Plushies" match each other and the buyers who like
 * plushies; free text would split that into a dozen spellings.
 *
 * Group names are the catalog's categories (shared/category-specs.ts).
 */
export const ALSO_SELLS_GROUPS: readonly { category: string; lines: readonly string[] }[] = [
  { category: 'Figures', lines: ['Scale figures', 'Nendoroids', 'Action figures', 'Funko Pops', 'Statues', 'Garage kits', 'Prize figures'] },
  { category: 'Model kits', lines: ['Gunpla', 'Plastic models', 'Diecast cars', 'Model paints & tools', 'Mecha kits'] },
  { category: 'Trading cards', lines: ['Pokémon cards', 'One Piece cards', 'Yu-Gi-Oh cards', 'Sports cards', 'Sealed boxes', 'Sleeves & binders', 'Graded cards'] },
  { category: 'Anime merch', lines: ['Plushies', 'Keychains', 'Acrylic stands', 'Posters & art prints', 'Cosplay', 'Badges & pins', 'Gacha'] },
  { category: 'Sneakers', lines: ['Limited releases', 'Running shoes', 'Sneaker care', 'Slides & sandals'] },
  { category: 'Streetwear', lines: ['T-shirts', 'Hoodies', 'Caps & hats', 'Jerseys', 'Anime apparel'] },
  { category: 'Bags & watches', lines: ['Bags', 'Watches', 'Wallets', 'Jewellery', 'Sunglasses'] },
  { category: 'Electronics', lines: ['Phone accessories', 'Audio', 'Gaming accessories', 'Cameras', 'Smart gadgets'] },
  { category: 'Beauty', lines: ['Skincare', 'K-beauty', 'J-beauty', 'Fragrance', 'Makeup'] },
  { category: 'Collectibles', lines: ['Blind boxes', 'LEGO', 'Vintage toys', 'Coins & stamps', 'Autographs'] },
  { category: 'Books & manga', lines: ['Manga', 'Comics', 'Art books', 'Light novels'] },
  { category: 'Games & consoles', lines: ['Video games', 'Retro games', 'Board games', 'Consoles', 'Controllers'] },
  { category: 'Home & decor', lines: ['Display cases', 'Lighting', 'Stationery', 'Wall art', 'Kitchen & mugs'] },
];

/** Every name a shop may pick under Also sells, categories first within each group. */
export const ALSO_SELLS_OPTIONS: readonly string[] = ALSO_SELLS_GROUPS.flatMap((group) => [group.category, ...group.lines]);

/** The category a picked line sits under, or the line itself when it is a category. */
export function alsoSellsCategory(name: string): string | undefined {
  const key = tagKey(name);
  return ALSO_SELLS_GROUPS.find((group) => tagKey(group.category) === key || group.lines.some((line) => tagKey(line) === key))?.category;
}

/**
 * What a shop's side lines count as in its identity: each line, and the
 * category over it, so a shop that also sells Plushies is found by buyers of
 * Anime merch too. Categories the shop already named come once.
 */
export function alsoSellsKeys(lines: readonly string[]): string[] {
  const out = new Map<string, string>();
  for (const line of lines) {
    out.set(tagKey(line), line);
    const parent = alsoSellsCategory(line);
    if (parent && !out.has(tagKey(parent))) out.set(tagKey(parent), parent);
  }
  return [...out.values()];
}

/**
 * Tags and "Also sells" answer different questions, and are kept apart.
 *
 * - Tags ("Known for") are the shop's own words for what it is and how it
 *   works: "Gunpla", "Japan imports", "Ships weekly". Free text, up to six.
 * - Also sells is the other things it carries beyond that: picked from a
 *   fixed list (ALSO_SELLS_OPTIONS), up to six, so every shop that says
 *   "Also sells Plushies" means the same thing. It weighs less than a tag in
 *   search and suggestions, and the Data tab reads how each one does.
 *
 * A side line that repeats one of the shop's tags is dropped: the tag says it.
 */
export function cleanAlsoSells(raw: readonly string[], options: readonly string[] = ALSO_SELLS_OPTIONS, tags: readonly string[] = []): string[] {
  const known = new Map(options.map((name) => [tagKey(name), name]));
  const taken = new Set(tags.map(tagKey));
  const out: string[] = [];
  for (const entry of raw) {
    const key = tagKey(String(entry ?? ''));
    const name = known.get(key);
    if (!name || taken.has(key)) continue;
    taken.add(key);
    out.push(name);
    if (out.length >= ALSO_SELLS_MAX) break;
  }
  return out;
}

/** Words that mean the same thing to a buyer, folded to one key. */
const SAME: Record<string, string> = {
  'gundam kit': 'gunpla',
  'gundam model kit': 'gunpla',
  'gundam': 'gunpla',
  'pokemon card': 'pokemon tcg',
  'preorder': 'pre order',
  'pre orders open': 'pre order',
  'pre order open': 'pre order',
  'nendo': 'nendoroid',
};

/** Singular for the plural a buyer would type: "kits" → "kit", not "glass" → "glas". */
function singular(word: string): string {
  if (word.length <= 3 || /(ss|us|is)$/.test(word) || word === 'series' || word === 'species') return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  return word.endsWith('s') ? word.slice(0, -1) : word;
}

/**
 * The key a tag is matched by: lowercase, punctuation gone, plurals folded,
 * known synonyms merged. "Resin Kits!" and "resin kit" are one tag.
 */
export function tagKey(raw: string): string {
  const words = raw.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .split(' ').filter(Boolean).map(singular);
  const key = words.join(' ').slice(0, 24).trim();
  return SAME[key] ?? key;
}

/**
 * The single words in a piece of text, keyed the way tags are: lowercase,
 * accents and punctuation gone, plurals folded, "nendo" read as "nendoroid".
 * "Pokémon Center plushies" reads as pokemon, center, plushy.
 */
export function wordKeys(raw: string): string[] {
  return raw.toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .split(' ').filter(Boolean).map(singular).map((word) => SAME[word] ?? word);
}

/** A tag key as a URL segment and back: "resin kit" ↔ "resin-kit". */
export const tagSlug = (key: string) => key.replace(/ /g, '-');
export const tagFromSlug = (slug: string) => tagKey(decodeURIComponent(slug).replace(/-/g, ' '));

/** A tag typed in passing, made presentable: separators to spaces, a capital first letter. */
export function tidyLabel(raw: string): string {
  const spaced = raw.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Fold a shop's own tags and its listings into its identity.
 *
 * Each listing counts each of its tags once, and its category at half
 * (it is broad, and every listing has one); an expired listing counts half, because what a shop used to sell says less
 * about it than what it sells now. Private deals are left out.
 */
export function buildIdentity(
  own: readonly string[],
  listings: readonly { tags?: readonly string[]; category?: string; expired?: boolean }[],
  side: readonly string[] = [],
): ShopTag[] {
  const rows = new Map<string, { n: number; own: boolean; side: boolean; labels: Map<string, number> }>();
  const add = (label: string, weight: number, isOwn: boolean, isSide = false) => {
    // A shop's own spelling stands; a listing's "garage-kit" reads "Garage kit".
    const trimmed = label.trim().slice(0, 24);
    const clean = isOwn ? trimmed : tidyLabel(trimmed);
    const k = tagKey(clean);
    if (k.length < 2) return;
    const row = rows.get(k) ?? { n: 0, own: false, side: false, labels: new Map<string, number>() };
    row.n += weight;
    row.own ||= isOwn;
    row.side ||= isSide;
    // The shop's own spelling wins; otherwise the commonest one.
    row.labels.set(clean, (row.labels.get(clean) ?? 0) + (isOwn ? 1000 : isSide ? 500 : weight));
    rows.set(k, row);
  };
  for (const tag of own) add(tag, OWN_WEIGHT, true);
  for (const line of side) add(line, SIDE_WEIGHT, false, true);
  for (const listing of listings) {
    const weight = listing.expired ? 0.5 : 1;
    const seen = new Set<string>();
    // The seller's own words first; the category is broad, so it counts half.
    const words = [...(listing.tags ?? []).map((tag) => ({ tag, by: 1 })),
      ...(listing.category ? [{ tag: listing.category, by: 0.5 }] : [])];
    for (const { tag, by } of words) {
      const k = tagKey(tag);
      if (seen.has(k)) continue;
      seen.add(k);
      add(tag, weight * by, false);
    }
  }
  const ranked = [...rows.entries()]
    .map(([k, row]): ShopTag => {
      const l = [...row.labels.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      return {
        k, l, n: Math.round(row.n * 2) / 2,
        ...(row.own ? { own: 1 as const } : row.side ? { side: 1 as const } : {}),
      };
    })
    .sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
  // What the shop declared always stays; what its listings say fills the rest.
  const declared = ranked.filter((tag) => tag.own || tag.side);
  const room = Math.max(0, IDENTITY_SIZE - declared.length);
  const kept = new Set([...declared, ...ranked.filter((tag) => !tag.own && !tag.side).slice(0, room)]);
  return ranked.filter((tag) => kept.has(tag));
}

/** Whether two identities differ enough to be worth writing. */
export function sameIdentity(a: readonly ShopTag[] | undefined, b: readonly ShopTag[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

/**
 * How well a shop matches a search: by name first, then by tag, weighted by
 * how much of the shop the tag is. Zero means no match.
 */
export function shopMatchScore(
  query: string,
  shop: { name: string; handle: string | null; identity: readonly ShopTag[] },
): { score: number; matched: string[] } {
  const q = tagKey(query);
  if (q.length < 2) return { score: 0, matched: [] };
  const words = q.split(' ');
  let score = 0;
  const name = `${shop.name} ${shop.handle ?? ''}`.toLowerCase();
  if (words.every((word) => name.includes(word))) score += 50;
  const matched: string[] = [];
  for (const tag of shop.identity) {
    const hit = tag.k === q || tag.k.includes(q) || words.every((word) => tag.k.includes(word));
    if (!hit) continue;
    matched.push(tag.l);
    score += (tag.k === q ? 20 : 10) + Math.log2(1 + tag.n) * 4 + (tag.own ? 6 : 0);
  }
  return { score, matched };
}

/**
 * How close two sets of interests are: the shared keys, each weighted on
 * both sides. Used for "shops for you" and "similar shops".
 */
export function affinity(interest: ReadonlyMap<string, number>, identity: readonly ShopTag[]): number {
  let score = 0;
  for (const tag of identity) {
    const want = interest.get(tag.k);
    if (want) score += want * Math.log2(1 + tag.n);
  }
  return score;
}

/** One badge a shop earned from what it actually did, never typed. */
export interface EarnedTag {
  id: 'fast_dispatch' | 'delivered';
  label: string;
}

/**
 * Badges read off a shop's orders, worked out when its page is read and
 * never stored.
 *
 * Fast dispatch: the median time from an order being placed to it being
 * dispatched, over the last twenty that were, with at least five to go on.
 * Delivered: the count of orders that reached their buyer, in steps.
 */
export function earnedTags(orders: readonly {
  status: string;
  placedAt?: string | null;
  createdAt: string;
  checkpoints?: Partial<Record<string, string | null>>;
}[]): EarnedTag[] {
  const out: EarnedTag[] = [];
  const days = orders
    .flatMap((order) => {
      const from = Date.parse(order.placedAt ?? order.createdAt);
      const to = Date.parse(order.checkpoints?.dispatched ?? '');
      return Number.isFinite(from) && Number.isFinite(to) && to >= from ? [{ to, d: (to - from) / 86_400_000 }] : [];
    })
    .sort((a, b) => b.to - a.to)
    .slice(0, 20)
    .map((row) => row.d)
    .sort((a, b) => a - b);
  if (days.length >= 5) {
    const median = days[Math.floor(days.length / 2)]!;
    if (median <= 2) out.push({ id: 'fast_dispatch', label: 'Ships within 2 days' });
    else if (median <= 4) out.push({ id: 'fast_dispatch', label: 'Ships within 4 days' });
  }
  // No "100+ orders delivered": how much a shop has sold is never shown to buyers.
  return out;
}
