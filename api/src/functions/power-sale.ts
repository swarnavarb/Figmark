import { randomUUID } from 'node:crypto';
import type { Listing, Post, PowerSale, PowerSaleItem, User } from '../../../shared/models.js';
import type { getRepository } from '../data/index.js';
import { notify } from './notify.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Running a sale in a shop's channel, on a timer the shop set.
 *
 * The shape a group-buy shop already works in by hand: a message saying the
 * sale is starting, then items one at a time so the room has a rhythm, then a
 * message saying it is over. What this replaces is somebody sitting with a
 * phone for two hours doing exactly that.
 *
 * ── Why it advances on a read ──────────────────────────────────────────────
 * There is no scheduler. Managed functions on Static Web Apps are HTTP-only,
 * so a timer trigger is not available to deploy, and inventing one would mean
 * a second piece of infrastructure to keep alive for a feature that is idle
 * most of the day. So a sale moves when somebody looks at it - the shop's
 * console, the channel, the sale's own page - the same way a pre-order notices
 * its own cutoff.
 *
 * What that costs is honest and worth saying out loud: a post is due at the
 * minute it is due, and lands the first time anyone opens the room after that.
 * For a sale whose whole point is that the shop's followers are watching, the
 * gap is seconds. For one scheduled at 3am with nobody looking, everything
 * queued lands together when the first person arrives - which is why the runner
 * posts at most one item per pass, so a quiet night cannot dump eleven items
 * into the channel in one scroll.
 */

/** The most a single sale may carry, so one run cannot flood a channel. */
export const MAX_SALE_ITEMS = 30;

/** Floors, so a sale cannot be configured into a wall of posts. */
export const MIN_EVERY_MINUTES = 1;
export const MIN_WINDOW_MINUTES = 5;

function minutes(n: number): number {
  return n * 60_000;
}

/** A post the runner writes as the shop, into the shop's own channel. */
function shopPost(shop: User, body: string, listingId: string | null, announcement: boolean): Post {
  const now = new Date().toISOString();
  return {
    id: `pst_${randomUUID().slice(0, 12)}`,
    channelId: shop.id,
    channel: 'seller',
    kind: listingId ? 'sale' : 'update',
    authorId: shop.id,
    authorName: shop.sellerProfile?.storefrontName ?? shop.displayName,
    body,
    listingId,
    photoUrl: null,
    likeCount: 0,
    replyCount: 0,
    voice: 'store',
    // A scheduled sale lives in the room it was scheduled for. The whole point
    // of the members' window is that being in the channel is worth something,
    // and pushing every item to everyone's feed would give it away.
    reach: 'channel',
    announcement,
    createdAt: now,
    updatedAt: now,
  };
}

/** The listing one sale item becomes when its turn comes. */
function listingFor(sale: PowerSale, item: PowerSaleItem, now: string): Listing {
  return {
    id: `lst_${randomUUID().slice(0, 12)}`,
    sellerId: sale.sellerId,
    title: item.title,
    description: item.description,
    category: item.category,
    condition: item.condition,
    status: 'active',
    // Opens at the members' price. The public price is what it moves to when
    // the window closes, which `liftPrice` does rather than a second listing -
    // a buyer who bookmarked it should find the same item at a new price, not
    // a dead link beside a fresh one.
    priceMinor: item.priceMinor,
    currency: 'INR',
    quantityAvailable: item.quantity,
    preOrder: null,
    lotId: null,
    sourcing: 'in_hand',
    bundle: false,
    // Out of the catalog while the window is open. The people in the room can
    // buy it from the post that dropped it; nobody else can find it. That is
    // the members' window - without this it is a price difference anyone
    // browsing the buy page could take, which is not the same thing at all.
    unlisted: true,
    photos: [],
    tags: [],
    likeCount: 0,
    viewCount: 0,
    bumpedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** When the nth item is due out, counting from the opening message. */
function dueAt(sale: PowerSale, index: number): number {
  return Date.parse(sale.openingAt) + minutes(sale.leadMinutes ?? 0) + minutes(sale.everyMinutes) * index;
}

/**
 * When the last item hands over, and the whole run is public.
 *
 * The one number a shop actually wants off a collapsed card: not how far
 * through it is, but when it is over. Computed from the schedule rather than
 * ticked down client-side, because the schedule is the server's - a browser
 * left open overnight with a stale copy would count down to the wrong minute.
 *
 * Null once nothing is left to hand over.
 */
export function finishesAt(sale: PowerSale): string | null {
  if (sale.status === 'done' || sale.status === 'cancelled') return null;

  let last = 0;
  sale.items.forEach((item, index) => {
    if (item.liftedAt) return;
    // Posted: its window is already running. Queued: it starts when its turn
    // comes, which is the schedule plus its place in the queue.
    const closes = item.windowEndsAt
      ? Date.parse(item.windowEndsAt)
      : dueAt(sale, index) + minutes(sale.windowMinutes);
    if (closes > last) last = closes;
  });

  return last === 0 ? null : new Date(last).toISOString();
}

/** How much longer the members' price holds, in whole minutes. Never negative. */
export function windowLeftMinutes(item: PowerSaleItem, now = new Date()): number {
  if (!item.windowEndsAt || item.liftedAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(item.windowEndsAt) - now.getTime()) / 60_000));
}

/**
 * Move a sale to where the clock says it should be.
 *
 * At most one item per pass. Everything else - the opening message, closing a
 * window that has expired, the closing message - happens as soon as it is due,
 * because none of those are things a reader has to scroll past.
 */
export async function advancePowerSale(
  repository: Repo,
  sale: PowerSale,
  options: { now?: Date } = {},
): Promise<PowerSale> {
  if (sale.status === 'draft' || sale.status === 'cancelled' || sale.status === 'done') return sale;

  const now = options.now ?? new Date();
  const stamp = now.toISOString();
  let changed = false;

  const shop = await repository.getUserById(sale.sellerId);
  if (!shop?.sellerProfile) return sale;

  // 1. The opening message. Nothing else can happen before it: an item posted
  //    into a room that was never told a sale was starting is just an item.
  if (!sale.openedAt) {
    if (Date.parse(sale.openingAt) > now.getTime()) return sale;
    await repository.createPost(shopPost(shop, sale.openingBody, null, true));
    sale.openedAt = stamp;
    sale.status = 'running';
    changed = true;

    const followers = await repository.listFollowerIds(sale.sellerId);
    await notify(repository, followers, {
      kind: 'sale_opened',
      title: `${shop.sellerProfile.storefrontName} has started a sale`,
      body: sale.openingBody.slice(0, 140),
      link: `/social?view=channels&channel=${encodeURIComponent(sale.sellerId)}`,
    });
  }

  // 2. Windows that have run out. The item stays; the price goes up to what
  //    everybody else pays, which is the whole bargain: the window rewards
  //    being here, it does not punish being late.
  for (const item of sale.items) {
    if (!item.postedAt || item.liftedAt || !item.listingId) continue;
    if (!item.windowEndsAt || Date.parse(item.windowEndsAt) > now.getTime()) continue;

    const listing = await repository.getListing(item.listingId);
    if (listing) {
      // The handover: the price goes up to what everybody else pays, and the
      // item joins the catalog and the shop's own grid. Same listing, same id -
      // a bookmark made during the sale still opens the thing it pointed at.
      await repository.updateListing({
        ...listing,
        priceMinor: item.listPriceMinor,
        unlisted: false,
        updatedAt: stamp,
      });
    }
    item.liftedAt = stamp;
    changed = true;
  }

  // 3. The next item, if its turn has come. One per pass - see the note at the
  //    top: a sale nobody watched overnight must not arrive as one scroll.
  const next = sale.items.findIndex((item) => !item.postedAt);
  if (next !== -1 && dueAt(sale, next) <= now.getTime()) {
    const item = sale.items[next]!;
    const listing = await repository.createListing(listingFor(sale, item, stamp));
    const endsAt = new Date(now.getTime() + minutes(sale.windowMinutes)).toISOString();

    await repository.createPost(
      shopPost(
        shop,
        `${item.title} — ${sale.windowMinutes} minutes at the members' price.`,
        listing.id,
        false,
      ),
    );

    item.postedAt = stamp;
    item.windowEndsAt = endsAt;
    item.listingId = listing.id;
    changed = true;
  }

  // 4. The closing message, once every item is out and every window is shut.
  const allPosted = sale.items.every((item) => item.postedAt);
  const allSettled = sale.items.every((item) => item.liftedAt);
  if (allPosted && allSettled && !sale.closedAt) {
    if (sale.closingBody.trim()) {
      await repository.createPost(shopPost(shop, sale.closingBody, null, true));
    }
    sale.closedAt = stamp;
    sale.status = 'done';
    changed = true;
  }

  if (!changed) return sale;
  sale.updatedAt = stamp;
  return repository.savePowerSale(sale);
}

/**
 * End a run early, handing every item it has already posted to the catalog.
 *
 * Stopping a sale must not strand what it dropped. An unlisted item whose run
 * was cancelled is reachable only by whoever still has the post in their
 * scroll - invisible to the shop's own grid, unfindable on the buy page, and
 * priced for a window that will never close.
 */
export async function releaseItems(repository: Repo, sale: PowerSale, now = new Date()): Promise<void> {
  const stamp = now.toISOString();
  for (const item of sale.items) {
    if (!item.listingId || item.liftedAt) continue;
    const listing = await repository.getListing(item.listingId);
    if (!listing) continue;
    await repository.updateListing({
      ...listing,
      priceMinor: item.listPriceMinor,
      unlisted: false,
      updatedAt: stamp,
    });
    item.liftedAt = stamp;
    item.windowEndsAt = item.windowEndsAt ?? stamp;
  }
}

/** Advance a shop's live sales, and hand back the list. */
export async function advanceAll(repository: Repo, sellerId: string): Promise<PowerSale[]> {
  const sales = await repository.listPowerSales(sellerId);
  const advanced: PowerSale[] = [];
  for (const sale of sales) {
    // One failure must not stop the rest: a sale that cannot post is a sale
    // that stalls, not a console that will not load.
    try {
      advanced.push(await advancePowerSale(repository, sale));
    } catch {
      advanced.push(sale);
    }
  }
  return advanced;
}
