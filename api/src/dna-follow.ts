import type { Listing, SiteContent } from '../../shared/models.js';
import {
  DNA_FOLLOW_PREFIX, PRICE_MOVE_SHARE, dnaFollowId, type DnaFollow, type ProductDna,
} from '../../shared/dna.js';
import { timedUntil } from '../../shared/timed.js';
import { getRepository } from './data/index.js';
import { dnasLinked, getDna } from './dna.js';
import { notify } from './functions/notify.js';
import { everListed, onSale } from './photo-sales.js';

/**
 * Following a Product DNA: for a while the person picks, up to three months,
 * they hear when the market for it moves - the lowest price going down or up,
 * the product coming back on sale or selling out everywhere, a shop starting
 * to sell it.
 *
 * Each follow is one `siteContent` row with a Cosmos time-to-live, so a follow
 * that has run its course is gone from the database by itself; every check
 * here deletes any it finds past its end too, for the in-memory store and for
 * the hour before Cosmos gets to it.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** The market as a follow remembers it. */
export interface DnaMarket {
  lowMinor: number | null;
  currency: string;
  onSale: string[];
}

/** What is on sale for a DNA right now, from the catalogue. */
export function marketOf(dna: ProductDna, byId: Map<string, Listing>): DnaMarket {
  const selling = dna.links
    .filter((entry) => entry.kind === 'listing')
    .map((entry) => byId.get(entry.id))
    .filter((listing): listing is Listing => Boolean(listing && everListed(listing) && onSale(listing)));
  return {
    lowMinor: selling.length ? Math.min(...selling.map((listing) => listing.priceMinor)) : null,
    currency: selling[0]?.currency ?? 'INR',
    onSale: selling.map((listing) => listing.id).sort(),
  };
}

const live = (follow: DnaFollow, now = Date.now()) => Date.parse(follow.until) > now;

function rowOf(follow: DnaFollow): SiteContent {
  const now = new Date().toISOString();
  // The row outlives the follow by an hour, so the last check can still read it.
  const ttl = Math.max(60, Math.ceil((Date.parse(follow.until) - Date.now()) / 1000) + 3600);
  return { id: dnaFollowId(follow.dnaId, follow.userId), data: follow, updatedBy: null, createdAt: follow.createdAt, updatedAt: now, ttl };
}

/** Follows of one DNA still running; ended ones are deleted on the way. */
export async function followsOf(repository: Repo, dnaId: string): Promise<DnaFollow[]> {
  const rows = await repository.listSiteContentRange(`${DNA_FOLLOW_PREFIX}${dnaId}:`, `${DNA_FOLLOW_PREFIX}${dnaId};`);
  return keepLive(repository, rows);
}

async function keepLive(repository: Repo, rows: SiteContent[]): Promise<DnaFollow[]> {
  const kept: DnaFollow[] = [];
  for (const row of rows) {
    const follow = row.data as DnaFollow | null;
    if (follow && live(follow)) kept.push(follow);
    else await repository.deleteSiteContent(row.id).catch(() => undefined);
  }
  return kept;
}

/** One person's follow of one DNA, while it runs. */
export async function followOf(repository: Repo, dnaId: string, userId: string): Promise<DnaFollow | null> {
  const row = await repository.getSiteContent(dnaFollowId(dnaId, userId)).catch(() => null);
  const follow = (row?.data as DnaFollow | undefined) ?? null;
  return follow && live(follow) ? follow : null;
}

/** Start, change or stop a follow. `days` null stops it. */
export async function setFollow(
  repository: Repo, dna: ProductDna, userId: string, days: number | null, market: DnaMarket,
): Promise<DnaFollow | null> {
  const id = dnaFollowId(dna.id, userId);
  if (days === null) {
    await repository.deleteSiteContent(id).catch(() => undefined);
    return null;
  }
  const existing = await followOf(repository, dna.id, userId);
  const follow: DnaFollow = {
    dnaId: dna.id,
    userId,
    until: timedUntil(days),
    // A follow already running keeps what it last told; a new one starts from now.
    lowMinor: existing ? existing.lowMinor : market.lowMinor,
    onSale: existing ? existing.onSale : market.onSale,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await repository.saveSiteContent(rowOf(follow));
  return follow;
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
}

/** What changed for one follower, in a line, or null when nothing worth saying did. */
export function newsFor(follow: Pick<DnaFollow, 'lowMinor' | 'onSale'>, market: DnaMarket): { title: string; body: string } | null {
  const before = follow.lowMinor;
  const now = market.lowMinor;
  const fresh = market.onSale.filter((id) => !follow.onSale.includes(id)).length;
  if (before === null && now !== null) {
    return { title: 'Back on sale', body: `From ${money(now, market.currency)}${market.onSale.length > 1 ? ` at ${market.onSale.length} shops` : ''}.` };
  }
  if (before !== null && now === null) {
    return { title: 'Sold out everywhere', body: 'Nobody is selling it right now. You will hear when it is back.' };
  }
  if (before !== null && now !== null && Math.abs(now - before) >= before * PRICE_MOVE_SHARE) {
    const share = Math.round((Math.abs(now - before) / before) * 100);
    return now < before
      ? { title: `Price down ${share}%`, body: `Lowest is now ${money(now, market.currency)}, was ${money(before, market.currency)}.` }
      : { title: `Price up ${share}%`, body: `Lowest is now ${money(now, market.currency)}, was ${money(before, market.currency)}.` };
  }
  if (fresh > 0 && now !== null) {
    return { title: fresh === 1 ? 'A new shop is selling it' : `${fresh} new listings`, body: `Lowest price ${money(now, market.currency)}.` };
  }
  return null;
}

/**
 * Tell this DNA's followers what moved since they were last told, and remember
 * the market as told. Never throws: an alert that could not go is a pity, not a
 * failure of whatever change caused it.
 */
export async function alertFollowers(repository: Repo, dna: ProductDna, byId: Map<string, Listing>): Promise<number> {
  try {
    const follows = await followsOf(repository, dna.id);
    if (follows.length === 0) return 0;
    const market = marketOf(dna, byId);
    let told = 0;
    for (const follow of follows) {
      const news = newsFor(follow, market);
      const same = follow.lowMinor === market.lowMinor && follow.onSale.join() === market.onSale.join();
      if (same) continue;
      if (news) {
        await notify(repository, [follow.userId], {
          kind: 'dna_alert',
          title: `${news.title}: ${dna.name}`,
          body: news.body,
          link: `/dna/${encodeURIComponent(dna.id)}`,
        }, { pushLater: true, key: `dna:${dna.id}:${follow.userId}:${market.lowMinor ?? 'none'}:${market.onSale.join(',')}` });
        told += 1;
      }
      await repository.saveSiteContent(rowOf({ ...follow, lowMinor: market.lowMinor, onSale: market.onSale }));
    }
    return told;
  } catch {
    return 0;
  }
}

/**
 * Every follow, checked: the clock's hourly run, for prices changed by edits,
 * sales and listings ending while nobody looked at the page.
 */
export async function sweepFollows(repository: Repo, catalogue: Listing[]): Promise<number> {
  const rows = await repository.listSiteContentRange(DNA_FOLLOW_PREFIX, 'dnaf;');
  const follows = await keepLive(repository, rows);
  const byId = new Map(catalogue.map((listing) => [listing.id, listing]));
  let told = 0;
  for (const dnaId of new Set(follows.map((follow) => follow.dnaId))) {
    const dna = await getDna(repository, dnaId);
    if (dna) told += await alertFollowers(repository, dna, byId);
  }
  return told;
}

/**
 * After a listing changed - listed, repriced, restocked, sold out - tell the
 * followers of the DNAs it is on. `catalogue` may be a minute old, so the
 * listing as it is now is laid over it.
 */
export async function alertForListing(repository: Repo, listing: Listing, catalogue: Listing[]): Promise<number> {
  try {
    const dnas = await dnasLinked(repository, 'listing', listing.id);
    if (dnas.length === 0) return 0;
    const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
    byId.set(listing.id, listing);
    let told = 0;
    for (const dna of dnas) told += await alertFollowers(repository, dna, byId);
    return told;
  } catch {
    return 0;
  }
}
