import { randomUUID } from 'node:crypto';
import type { Listing, Post, SiteContent, Want } from '../../shared/models.js';
import {
  DNA_PREFIX, DNA_TAGS_PER_POST, HUNT_COVERED, SAME_PRODUCT, SAME_WITH_PHOTO, covered, dnaDocId, heatOf, lineOf,
  linkKey, nameFrom, productWords, sameCategory, wordLikeness,
  type DnaLine, type DnaLink, type DnaLinkKind, type DnaSummary, type ProductDna,
} from '../../shared/dna.js';
import { getRepository } from './data/index.js';
import { everListed, findSales, onSale, textSales } from './photo-sales.js';
import { pictureMatches } from './photo-search.js';
import { ownPhotoName } from './storage/index.js';

/**
 * Product DNA on the server: where each DNA is kept, how things are linked to
 * one, and the small summary cards are worked out from.
 *
 * Every DNA is a `siteContent` row, `dna:<id>`: the database is at its
 * container ceiling, and that container is already read whole by id or as a
 * range of ids, which is exactly how DNAs are read. Each host instance keeps
 * all of them in memory for a minute, with a reverse index from each linked
 * thing to its DNAs, so a listing page asking "which DNA is this?" is a map
 * lookup.
 *
 * Linking is automatic and lazy. A listing is linked when it is listed, and
 * any listing that somehow is not is linked the first time anyone asks about
 * it or a sweep finds it; a post or a hunt is linked when it is first asked
 * about. Only listings start a DNA - a post or a hunt joins one that exists.
 * An owner's own choice - a listing moved, a post tagged or untagged - is
 * kept, and the matcher never puts back what an owner took off.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

interface DnaIndex {
  at: number;
  byId: Map<string, ProductDna>;
  /** `kind:id` -> the DNAs it is linked to. */
  byLink: Map<string, string[]>;
}

const INDEX_MS = 60_000;
let held: { at: number; index: Promise<DnaIndex> } | null = null;

function indexOf(rows: SiteContent[]): DnaIndex {
  const index: DnaIndex = { at: Date.now(), byId: new Map(), byLink: new Map() };
  for (const row of rows) {
    const dna = row.data as ProductDna | null;
    if (dna && typeof dna === 'object' && typeof dna.id === 'string') place(index, dna);
  }
  return index;
}

function place(index: DnaIndex, dna: ProductDna): void {
  const before = index.byId.get(dna.id);
  if (before) {
    for (const link of before.links) {
      const key = linkKey(link.kind, link.id);
      const left = (index.byLink.get(key) ?? []).filter((id) => id !== dna.id);
      if (left.length) index.byLink.set(key, left); else index.byLink.delete(key);
    }
  }
  index.byId.set(dna.id, dna);
  if (dna.mergedInto) return;
  for (const link of dna.links) {
    const key = linkKey(link.kind, link.id);
    const ids = index.byLink.get(key) ?? [];
    if (!ids.includes(dna.id)) index.byLink.set(key, [...ids, dna.id]);
  }
}

/** Every DNA, from this instance's copy when it is under a minute old. */
export function dnaIndex(repository: Repo): Promise<DnaIndex> {
  if (!held || Date.now() - held.at > INDEX_MS) {
    const index = repository.listSiteContentRange(DNA_PREFIX, 'dna;').then(indexOf);
    const entry = { at: Date.now(), index };
    held = entry;
    index.catch(() => { if (held === entry) held = null; });
  }
  return held.index;
}

/** For tests: read every DNA afresh next time. */
export function forgetDnaIndex(): void {
  held = null;
}

/** A DNA by id, following merges to the one it now lives in. */
export async function getDna(repository: Repo, id: string): Promise<ProductDna | null> {
  const index = await dnaIndex(repository);
  let dna = index.byId.get(id) ?? null;
  for (let hop = 0; dna?.mergedInto && hop < 4; hop += 1) dna = index.byId.get(dna.mergedInto) ?? null;
  return dna;
}

/** The live DNAs a thing is linked to. */
export async function dnasLinked(repository: Repo, kind: DnaLinkKind, id: string): Promise<ProductDna[]> {
  const index = await dnaIndex(repository);
  return (index.byLink.get(linkKey(kind, id)) ?? [])
    .map((dnaId) => index.byId.get(dnaId))
    .filter((dna): dna is ProductDna => Boolean(dna && !dna.mergedInto));
}

/** Change one DNA and keep this instance's copy in step. */
export async function saveDna(
  repository: Repo, id: string, change: (current: ProductDna | null) => ProductDna | null,
): Promise<ProductDna | null> {
  const index = await dnaIndex(repository);
  const known = index.byId.get(id) ?? null;
  // Nothing would change against what this instance holds: no write at all.
  if (known && change(known) === null) return known;
  let result: ProductDna | null = null;
  const now = new Date().toISOString();
  await repository.mutateSiteContent(dnaDocId(id), (row) => {
    const next = change((row?.data as ProductDna | undefined) ?? null);
    result = next ? { ...next, updatedAt: now } : null;
    // Nothing to change: the row is written back as it was.
    if (!result) return row ?? { id: dnaDocId(id), data: null, updatedBy: null, createdAt: now, updatedAt: now };
    return { id: dnaDocId(id), data: result, updatedBy: null, createdAt: row?.createdAt ?? now, updatedAt: now };
  });
  if (result) place(index, result);
  return result ?? known;
}

function newDna(name: string, category: string, line: DnaLine, words: string[], cover: string | null): ProductDna {
  const now = new Date().toISOString();
  return {
    id: `p${randomUUID().replace(/-/g, '').slice(0, 11)}`,
    name, category, line, words, cover,
    links: [], blocked: [], mergedInto: null, background: null, backgroundTriedAt: null,
    createdAt: now, updatedAt: now,
  };
}

const link = (kind: DnaLinkKind, id: string, partition: string, by: DnaLink['by']): DnaLink =>
  ({ kind, id, partition, by, at: new Date().toISOString() });

/** Add a link to a DNA, once. */
export async function addLink(repository: Repo, dnaId: string, entry: DnaLink): Promise<ProductDna | null> {
  return saveDna(repository, dnaId, (current) => {
    if (!current) return null;
    const key = linkKey(entry.kind, entry.id);
    const blocked = entry.by === 'auto' ? current.blocked : current.blocked.filter((value) => value !== key);
    if (entry.by === 'auto' && current.blocked.includes(key)) return null;
    if (current.links.some((existing) => existing.kind === entry.kind && existing.id === entry.id)) {
      return blocked.length === current.blocked.length ? null : { ...current, blocked };
    }
    return { ...current, blocked, links: [...current.links, entry] };
  });
}

/** Take a link off a DNA; `block` stops the matcher putting it back. */
export async function removeLink(
  repository: Repo, dnaId: string, kind: DnaLinkKind, id: string, block: boolean,
): Promise<ProductDna | null> {
  return saveDna(repository, dnaId, (current) => {
    if (!current) return null;
    const key = linkKey(kind, id);
    return {
      ...current,
      links: current.links.filter((entry) => !(entry.kind === kind && entry.id === id)),
      blocked: block && !current.blocked.includes(key) ? [...current.blocked, key] : current.blocked,
    };
  });
}

export const photoOf = (listing: Pick<Listing, 'photos'>): string | null => {
  const photo = listing.photos.find((entry) => entry.isPrimary) ?? listing.photos[0];
  return photo?.thumbUrl ?? photo?.url ?? null;
};

/* -------------------------------------------------------------------------- */
/* Listings                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The DNA a listing belongs to, linking it now if it is not yet: to the DNA
 * of the same product, or to a new one it starts. Null for a listing the
 * public never sees - a draft, a private deal, an unlisted item.
 *
 * Same product means the same category, the same line as the seller said it,
 * and then: titles that say the same thing; or the same photo, or a photo of
 * the same thing, with titles alike enough to back it up.
 */
export async function dnaForListing(
  repository: Repo, listing: Listing, catalogue: Listing[], fresh = false,
): Promise<ProductDna | null> {
  if (!everListed(listing)) return null;
  const [existing] = await dnasLinked(repository, 'listing', listing.id);
  if (existing) return existing;

  const index = await dnaIndex(repository);
  const words = productWords(listing.title);
  const line = lineOf(listing.category, listing.attributes);
  const key = linkKey('listing', listing.id);
  // `fresh`: its seller said it is a product of its own.
  const candidates = fresh ? [] : [...index.byId.values()].filter((dna) => !dna.mergedInto && dna.line === line
    && sameCategory(dna.category, listing.category) && !dna.blocked.includes(key));

  // The photo, against the photos of listings already on a candidate.
  const pictured = new Map<string, number>();
  const hashes = listing.photos.map((photo) => photo.imageHash).filter((hash): hash is string => Boolean(hash));
  if (hashes.length > 0 && candidates.length > 0) {
    const onCandidates = new Map<string, string>();
    for (const dna of candidates) {
      for (const entry of dna.links) if (entry.kind === 'listing') onCandidates.set(entry.id, dna.id);
    }
    const pool = catalogue.filter((other) => other.id !== listing.id && onCandidates.has(other.id)
      && other.photos.some((photo) => photo.imageHash));
    if (pool.length > 0) {
      const matches = await pictureMatches(pool, hashes).catch(() => new Map());
      for (const [listingId, match] of matches) {
        const strength = match.same ? 2 : match.sameItem ? 1 : 0;
        const dnaId = onCandidates.get(listingId)!;
        if (strength > (pictured.get(dnaId) ?? 0)) pictured.set(dnaId, strength);
      }
    }
  }

  let best: { dna: ProductDna; score: number } | null = null;
  for (const dna of candidates) {
    const like = wordLikeness(words, dna.words);
    const photo = pictured.get(dna.id) ?? 0;
    const score = photo === 2 && like >= 0.34 ? 2 + like
      : photo === 1 && like >= SAME_WITH_PHOTO ? 1 + like
        : like >= SAME_PRODUCT ? like : 0;
    if (score > 0 && (!best || score > best.score
      || (score === best.score && dna.links.length > best.dna.links.length))) best = { dna, score };
  }

  const entry = link('listing', listing.id, listing.sellerId, fresh ? 'owner' : 'auto');
  if (best) {
    const joined = await addLink(repository, best.dna.id, entry);
    // A cover for a DNA that never had one.
    if (joined && !joined.cover && photoOf(listing)) {
      return saveDna(repository, joined.id, (current) => (current ? { ...current, cover: photoOf(listing) } : null));
    }
    return joined ?? best.dna;
  }
  const started = newDna(nameFrom(listing.title), listing.category, line, words, photoOf(listing));
  // Other listings of the same product nobody has linked yet - listed before
  // DNAs existed - join it as it starts, so its first reader sees every shop.
  const siblings = fresh ? [] : catalogue.filter((other) => other.id !== listing.id && everListed(other)
    && !index.byLink.has(linkKey('listing', other.id)) && sameCategory(other.category, listing.category)
    && lineOf(other.category, other.attributes) === line && wordLikeness(words, productWords(other.title)) >= SAME_PRODUCT)
    .slice(0, 60)
    .map((other) => link('listing', other.id, other.sellerId, 'auto'));
  return saveDna(repository, started.id, () => ({ ...started, links: [entry, ...siblings] }));
}

let sweeping: Promise<number> | null = null;
/** Recent posts and open hunts looked at per sweep. */
const COMMUNITY_SWEEP = 60;

/**
 * Link listings nobody has asked about yet, newest first, a few at a time:
 * listings from before DNAs existed, or made while a link failed. One sweep
 * at a time per instance.
 */
export function sweepListings(repository: Repo, catalogue: Listing[], limit = 40): Promise<number> {
  if (sweeping) return sweeping;
  sweeping = (async () => {
    const index = await dnaIndex(repository);
    const waiting = catalogue
      .filter((listing) => everListed(listing) && !index.byLink.has(linkKey('listing', listing.id)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
    let linked = 0;
    for (const listing of waiting) {
      if (await dnaForListing(repository, listing, catalogue).catch(() => null)) linked += 1;
    }
    // Then what people said: recent posts and open hunts, so a product's page
    // has its community without waiting for somebody to open each post.
    const [posts, wants] = await Promise.all([
      repository.listRecentPosts(COMMUNITY_SWEEP).catch(() => [] as Post[]),
      repository.listOpenWants({ limit: COMMUNITY_SWEEP }).catch(() => [] as Want[]),
    ]);
    const now = new Date().toISOString();
    for (const post of posts) {
      if (post.visibleAt && post.visibleAt > now) continue;
      if (index.byLink.has(linkKey('post', post.id)) || looked.has(`${post.channelId}/${post.id}`)) continue;
      linked += (await dnasForPost(repository, post, catalogue).catch(() => [])).length;
    }
    for (const want of wants) {
      if (index.byLink.has(linkKey('want', want.id)) || looked.has(`want/${want.id}`)) continue;
      if (await dnaForWant(repository, want, catalogue).catch(() => null)) linked += 1;
    }
    return linked;
  })().finally(() => { sweeping = null; });
  return sweeping;
}

/* -------------------------------------------------------------------------- */
/* Posts and hunts                                                            */
/* -------------------------------------------------------------------------- */

/** Has this post been looked at for products: kept per instance, so a post with none is not looked at on every view. */
const looked = new Map<string, number>();
const LOOK_AGAIN_MS = 10 * 60_000;

/**
 * The DNAs a post is about, linking them the first time: the item a sale post
 * sells, each thing its photos are found to show - one photo of a shelf can
 * be several products - and the items its words name. Only sure matches; a
 * post nobody can be sure of is left for its author to tag.
 */
export async function dnasForPost(repository: Repo, post: Post, catalogue: Listing[]): Promise<ProductDna[]> {
  const linked = await dnasLinked(repository, 'post', post.id);
  const key = `${post.channelId}/${post.id}`;
  if (linked.length > 0 || Date.now() - (looked.get(key) ?? 0) < LOOK_AGAIN_MS) return linked;
  if (looked.size > 5_000) looked.delete(looked.keys().next().value!);
  looked.set(key, Date.now());

  const byId = new Map(catalogue.map((listing) => [listing.id, listing]));
  const found: Listing[] = [];
  const sold = post.listingId ? byId.get(post.listingId) : undefined;
  if (sold) found.push(sold);
  // Words alone are held to more than a hint: the caption has to name what
  // identifies the item ("Dunk Low" is not "Dunk Low Setsubun"), and a
  // product only named is taken to be the original - a post about a copy is
  // on its DNA when it sells that copy, shows its photo, or its poster says so.
  const said = productWords(post.body.slice(0, 500));
  const named = (listing: Listing) => covered(productWords(listing.title), said) >= HUNT_COVERED
    && lineOf(listing.category, listing.attributes) === 'original';
  const photos = [...new Set([post.photoUrl, ...(post.photoUrls ?? [])].filter((url): url is string => Boolean(url)))].slice(0, 4);
  let read = 0;
  for (const url of photos) {
    const name = await ownPhotoName(url).catch(() => null);
    if (!name) continue;
    read += 1;
    const sales = await findSales(name, catalogue, post.body.slice(0, 500), post.authorId).catch(() => null);
    // A group with no label was found by the picture; a labelled one by the caption's words.
    for (const group of sales?.items ?? []) {
      found.push(...group.listings.filter((listing) => group.label === null || named(listing)).slice(0, 3));
    }
  }
  // No photo this app stores (none at all, or only links elsewhere): the words are all there is.
  if (read === 0) found.push(...textSales(catalogue, post.body).filter(named).slice(0, 6));

  const dnas: ProductDna[] = [];
  for (const listing of found) {
    if (dnas.length >= DNA_TAGS_PER_POST) break;
    const dna = await dnaForListing(repository, listing, catalogue).catch(() => null);
    if (!dna || dnas.some((entry) => entry.id === dna.id) || dna.blocked.includes(linkKey('post', post.id))) continue;
    dnas.push(dna);
  }
  const saved: ProductDna[] = [];
  for (const dna of dnas) {
    const after = await addLink(repository, dna.id, link('post', post.id, post.channelId, 'auto'));
    saved.push(after ?? dna);
  }
  return saved;
}

/**
 * The DNA a hunt asks for, linking it the first time: one whose words cover
 * what the hunt says, and only when one stands out - "Nike Dunk" alone could
 * be any of a dozen, and is left for the hunter to point at. Failing that, a
 * photo the hunter added that matches a listing.
 */
export async function dnaForWant(repository: Repo, want: Want, catalogue: Listing[]): Promise<ProductDna | null> {
  const [linked] = await dnasLinked(repository, 'want', want.id);
  const key = `want/${want.id}`;
  if (linked || Date.now() - (looked.get(key) ?? 0) < LOOK_AGAIN_MS) return linked ?? null;
  looked.set(key, Date.now());

  const index = await dnaIndex(repository);
  const asked = productWords(want.title);
  const blockKey = linkKey('want', want.id);
  const scored = [...index.byId.values()]
    .filter((dna) => !dna.mergedInto && !dna.blocked.includes(blockKey)
      && (!want.category || sameCategory(dna.category, want.category)))
    .map((dna) => ({ dna, cover: covered(asked, dna.words), like: wordLikeness(asked, dna.words) }))
    .filter((entry) => entry.cover >= HUNT_COVERED && asked.length >= 2)
    .sort((a, b) => b.like - a.like || Number(b.dna.line === 'original') - Number(a.dna.line === 'original')
      || b.dna.links.length - a.dna.links.length);
  let chosen: ProductDna | null = null;
  const [first, second] = scored;
  if (first && (!second || first.like > second.like || second.dna.line !== first.dna.line)) chosen = first.dna;

  if (!chosen && want.photoUrls?.length) {
    const name = await ownPhotoName(want.photoUrls[0]!).catch(() => null);
    const sales = name ? await findSales(name, catalogue, want.title, null).catch(() => null) : null;
    const listing = sales?.items[0]?.listings[0];
    if (listing) chosen = await dnaForListing(repository, listing, catalogue).catch(() => null);
  }
  if (!chosen) return null;
  return (await addLink(repository, chosen.id, link('want', want.id, want.buyerId, 'auto'))) ?? chosen;
}

/* -------------------------------------------------------------------------- */
/* Summaries                                                                  */
/* -------------------------------------------------------------------------- */

/** The small card for a DNA, from the catalogue alone: no database reads. */
export function summaryOf(dna: ProductDna, byId: Map<string, Listing>): DnaSummary {
  const listings = dna.links.filter((entry) => entry.kind === 'listing')
    .map((entry) => byId.get(entry.id))
    .filter((listing): listing is Listing => Boolean(listing && everListed(listing)));
  const selling = listings.filter(onSale);
  const prices = selling.map((listing) => listing.priceMinor);
  const sellers = new Set(selling.map((listing) => listing.sellerId));
  const { heat, label } = heatOf({
    hunting: dna.links.filter((entry) => entry.kind === 'want').length,
    saves: listings.reduce((sum, listing) => sum + (listing.likeCount ?? 0), 0),
    views: listings.reduce((sum, listing) => sum + (listing.viewCount ?? 0), 0),
    sold: listings.reduce((sum, listing) => sum + (listing.soldCount ?? 0), 0),
    pledged: listings.reduce((sum, listing) => sum + (listing.preOrder?.pledgedCount ?? 0), 0),
    waiting: listings.reduce((sum, listing) => sum + (listing.restockWatch?.length ?? 0), 0),
  });
  const cover = dna.cover ?? (listings[0] ? photoOf(listings[0]) : null);
  return {
    id: dna.id,
    name: dna.name,
    category: dna.category,
    cover,
    lowMinor: prices.length ? Math.min(...prices) : null,
    highMinor: prices.length ? Math.max(...prices) : null,
    currency: selling[0]?.currency ?? listings[0]?.currency ?? 'INR',
    sellers: sellers.size,
    heat,
    heatLabel: label,
    rating: dna.score && dna.score.count > 0 ? Math.round((dna.score.total / dna.score.count) * 10) / 10 : null,
    ratings: dna.score?.count ?? 0,
    mentions: dna.links.filter((entry) => entry.kind !== 'listing').length,
  };
}

/** Whether a DNA has anything the public can see: a listing ever listed. */
export function isShown(dna: ProductDna, byId: Map<string, Listing>): boolean {
  return !dna.mergedInto && dna.links.some((entry) => {
    if (entry.kind !== 'listing') return false;
    const listing = byId.get(entry.id);
    return Boolean(listing && everListed(listing));
  });
}

/* -------------------------------------------------------------------------- */
/* Background                                                                 */
/* -------------------------------------------------------------------------- */

const BACKGROUND_AGAIN_MS = 30 * 24 * 3600_000;

/**
 * A few lines about the product from Wikipedia, kept on the DNA when the
 * article is plainly about it: every word of the article's title is in the
 * product's name, and it names at least two of them or most of the name.
 * Tried once a month per DNA; never linked out, credited as its licence asks.
 * `DNA_BACKGROUND=off` turns it off (the tests do).
 */
export async function findBackground(repository: Repo, dna: ProductDna): Promise<void> {
  if (process.env.DNA_BACKGROUND === 'off') return;
  if (dna.backgroundTriedAt && Date.now() - Date.parse(dna.backgroundTriedAt) < BACKGROUND_AGAIN_MS) return;
  const tried = new Date().toISOString();
  await saveDna(repository, dna.id, (current) => (current ? { ...current, backgroundTriedAt: tried } : null));

  const headers = { 'User-Agent': 'Figmark/1.0 (product pages; https://figmark.in)', Accept: 'application/json' };
  const ask = async (url: string) => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(4000) });
    return response.ok ? (await response.json()) as unknown : null;
  };
  try {
    const query = encodeURIComponent(dna.name.slice(0, 80));
    const search = await ask(`https://en.wikipedia.org/w/rest.php/v1/search/title?q=${query}&limit=5`) as
      { pages?: { title?: string }[] } | null;
    const fits = (title: string) => {
      const words = productWords(title);
      if (words.length === 0 || !words.every((word) => dna.words.includes(word))) return false;
      return words.length >= 2 || words.length / Math.max(1, dna.words.length) >= 0.6;
    };
    const title = (search?.pages ?? []).map((page) => page.title ?? '').find(fits);
    if (!title) return;
    const page = await ask(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`) as
      { type?: string; extract?: string } | null;
    if (page?.type !== 'standard' || !page.extract) return;
    const sentences = page.extract.match(/[^.!?]+[.!?]+/g) ?? [page.extract];
    let text = '';
    for (const sentence of sentences) {
      if ((text + sentence).length > 420) break;
      text += sentence;
    }
    text = (text || page.extract.slice(0, 400)).trim();
    await saveDna(repository, dna.id, (current) => (current
      ? { ...current, background: { text, source: 'Wikipedia', title } } : null));
  } catch {
    // Offline, slow or refused: there is simply no background this month.
  }
}
