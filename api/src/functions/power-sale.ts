import { randomUUID } from 'node:crypto';
import type { Listing, Post, PowerSale, PowerSaleItem, User } from '../../../shared/models.js';
import type { getRepository } from '../data/index.js';
import { actorName } from '../../../shared/notifications.js';
import { notify } from './notify.js';
import { refreshIdentity } from '../shop-identity.js';
import { renewShowcaseSales } from '../data/seed-showcase.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Running a sale in a shop's channel, on a timer the shop set.
 *
 * The shape a group-buy shop already works in by hand: a message saying the
 * sale is starting, then items one at a time so the room has a rhythm, then a
 * message saying it is over. What this replaces is somebody sitting with a
 * phone for two hours doing exactly that.
 *
 * ── When it moves ──────────────────────────────────────────────────────────
 * Two things move a sale: the clock app's timer, every five minutes, and
 * anybody looking at it - the shop's console, the channel, the Drops shelf -
 * the same way a pre-order notices its own cutoff.
 *
 * Five minutes is too coarse for a drop due at 9:02, so each pass writes what
 * falls due in the next LOOKAHEAD, not just what is due now: the posts and
 * listings with the moment they show (`visibleAt`, hidden by every read until
 * then - see timed-view.ts), the notices held until the same moment, and each
 * listing's members' window, so its price goes up on time by itself. Nothing
 * waits for a run to land on time; the runs only have to come often enough
 * to stay ahead.
 *
 * Behind schedule - the clock was down, or a sale was set to open in the
 * past - it catches up one item per pass, posted when it is written, so a
 * quiet night cannot dump eleven items into the channel in one scroll.
 *
 * Everything written ahead has a fixed id, so a pass that runs twice, or two
 * that race, write it once; and calling a sale off takes back whatever has
 * not shown yet (`callOffAhead`).
 */

/** The most a single sale may carry, so one run cannot flood a channel. */
export const MAX_SALE_ITEMS = 30;

/** Floors, so a sale cannot be configured into a wall of posts. */
export const MIN_EVERY_MINUTES = 1;
export const MIN_WINDOW_MINUTES = 5;
/**
 * The least time between the opening message and the first item.
 *
 * Half an hour, so every drop has a countdown on the Buy tab's Drops shelf and
 * in the channel - time for the announcement to travel and for people to set
 * a reminder. A sale whose first item lands with its own announcement gives
 * nobody a chance to turn up.
 */
export const MIN_LEAD_MINUTES = 30;

function minutes(n: number): number {
  return n * 60_000;
}

/**
 * How far ahead each pass writes: the clock's five minutes, and two more so a
 * run that starts late still finds the next minutes already written.
 */
export const LOOKAHEAD_MS = minutes(7);

const iso = (ms: number) => new Date(ms).toISOString();
const later = (stamp: string | null | undefined, now: number) => Boolean(stamp && Date.parse(stamp) > now);

/** Fixed ids, so what is written ahead is written once however many passes write it. */
const ids = {
  opening: (sale: PowerSale) => `pst_${sale.id}_open`,
  drop: (sale: PowerSale, index: number) => `pst_${sale.id}_${index}`,
  public: (sale: PowerSale, index: number) => `pst_${sale.id}_${index}_public`,
  closing: (sale: PowerSale) => `pst_${sale.id}_close`,
  listing: (sale: PowerSale, index: number) => `lst_${sale.id}_${index}`,
  /* Notice keys: one row per person per key (see notify). */
  opened: (sale: PowerSale) => `${sale.id}_open`,
  remind: (sale: PowerSale) => `${sale.id}_remind`,
};

/** Write once: a second write of the same id is the first one already done. */
async function once(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    if ((err as { code?: number } | null)?.code !== 409) throw err;
  }
}

/**
 * The sale as people see it at `now`: what was written ahead and has not
 * shown yet reads as not done. Every view of a sale goes through this, so the
 * console, the shelf and the reminder button agree with the channel.
 */
export function asOf(sale: PowerSale, now = new Date()): PowerSale {
  const t = now.getTime();
  const openedAt = later(sale.openedAt, t) ? null : sale.openedAt;
  return {
    ...sale,
    openedAt,
    status: sale.status === 'running' && !openedAt ? 'scheduled' : sale.status,
    items: sale.items.map((item) => (later(item.postedAt, t)
      ? { ...item, postedAt: null, windowEndsAt: null, listingId: null, publicPostAt: null }
      : item)),
  };
}

/** A post the runner writes as the shop, into the shop's own channel. */
function shopPost(
  shop: User, body: string, listingId: string | null, announcement: boolean, reach: Post['reach'] = 'channel',
  drop: Post['drop'] = null, opening: Post['opening'] = null,
  /** Its fixed id, and when it shows: dated then, and hidden until then when that is ahead. */
  timing: { id: string; at: number } | null = null,
): Post {
  const now = timing ? iso(timing.at) : new Date().toISOString();
  return {
    id: timing?.id ?? `pst_${randomUUID().slice(0, 12)}`,
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
    reach,
    announcement,
    ...(drop ? { drop } : {}),
    ...(opening ? { opening } : {}),
    powerSale: true,
    ...(timing && timing.at > Date.now() ? { visibleAt: now } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** The listing one sale item becomes when its turn comes. */
function listingFor(sale: PowerSale, item: PowerSaleItem, index: number, showAt: number, endsAt: number): Listing {
  const now = iso(showAt);
  return {
    id: ids.listing(sale, index),
    sellerId: sale.sellerId,
    title: item.title,
    description: item.description,
    category: item.category,
    condition: item.condition,
    status: 'active',
    // Opens at the members' price. The public price is what it moves to when
    // the window closes - on the same listing rather than a second one, so a
    // buyer who bookmarked it finds the same item at a new price, not a dead
    // link beside a fresh one. `memberWindow` makes that happen on the minute,
    // on every read; the runner writes it down when it next passes.
    priceMinor: item.priceMinor,
    memberWindow: {
      endsAt: iso(endsAt),
      publicPriceMinor: item.listPriceMinor,
      publicExpiresAt: publicExpiry(item, new Date(endsAt)),
    },
    currency: 'INR',
    quantityAvailable: item.quantity,
    quantityMode: item.quantityMode ?? 'fixed',
    expiresAt: item.expiresAt ?? null,
    advancePercent: item.advancePercent ?? null,
    preOrder: null,
    lotId: item.lotId ?? null,
    sourcing: item.lotId ? 'import' : item.sourcing ?? 'in_hand',
    channelDrop: true,
    bundle: false,
    // Out of the catalog while the window is open. The people in the room can
    // buy it from the post that dropped it; nobody else can find it. That is
    // the members' window - without this it is a price difference anyone
    // browsing the buy page could take, which is not the same thing at all.
    unlisted: true,
    costSheet: item.costSheet ?? null,
    photos: item.photos ?? [],
    tags: item.tags ?? [],
    likeCount: 0,
    viewCount: 0,
    bumpedAt: null,
    ...(showAt > Date.now() ? { visibleAt: now } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** A limited time deal runs from when the item goes public. */
function publicExpiry(item: PowerSaleItem, now: Date): string | null {
  return item.limitedDays ? new Date(now.getTime() + item.limitedDays * 86_400_000).toISOString() : null;
}

/** When the first item goes out: the moment the shelf counts down to. */
export function firstDropAt(sale: PowerSale): string {
  return new Date(dueAt(sale, 0)).toISOString();
}

/** When the next item still to post is due, or null when all are out. */
export function nextDropAt(sale: PowerSale): string | null {
  const next = sale.items.findIndex((item) => !item.postedAt);
  return next === -1 ? null : new Date(dueAt(sale, next)).toISOString();
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

/** What the people who pressed "Remind me" are told when the first item drops. */
function reminderDraft(sale: PowerSale, shop: User) {
  const first = sale.items[0]!;
  return {
    kind: 'sale_opened' as const,
    title: `⚡ ${sale.name} is dropping now at ${actorName(shop.sellerProfile!.storefrontName, shop.sellerProfile!.username)}`,
    body: `${first.title} is first - members' price for ${sale.windowMinutes} min.`,
    link: `/social/c/${encodeURIComponent(sale.sellerId)}`,
  };
}

/** Held until `at` when that is ahead; sent now when it is not. */
const heldUntil = (at: number, now: number) => (at > now ? { notBefore: iso(at) } : {});

/**
 * Move a sale to where the clock says it should be, and write what falls due
 * within LOOKAHEAD so it shows on the minute (see the note at the top).
 */
export async function advancePowerSale(
  repository: Repo,
  sale: PowerSale,
  options: { now?: Date } = {},
): Promise<PowerSale> {
  if (sale.status === 'draft' || sale.status === 'cancelled' || sale.status === 'done') return sale;

  const now = (options.now ?? new Date()).getTime();
  const horizon = now + LOOKAHEAD_MS;
  const stamp = iso(now);
  let changed = false;

  const shop = await repository.getUserById(sale.sellerId);
  if (!shop?.sellerProfile) return sale;

  // 1. The opening message. Nothing else can happen before it: an item posted
  //    into a room that was never told a sale was starting is just an item.
  if (!sale.openedAt) {
    const opensAt = Date.parse(sale.openingAt);
    if (opensAt > horizon) return sale;
    const showAt = Math.max(opensAt, now);
    // The opening message carries the sale, so the channel can count down to
    // the first item and offer a reminder - and the Buy tab's Drops shelf
    // shows the sale from this moment on.
    await once(() => repository.createPost(shopPost(shop, sale.openingBody, null, true, 'channel', null, {
      saleId: sale.id,
      sellerId: sale.sellerId,
      startsAt: firstDropAt(sale),
      saleName: sale.name,
      itemCount: sale.items.length,
    }, { id: ids.opening(sale), at: showAt })));
    sale.openedAt = iso(showAt);
    sale.status = 'running';
    changed = true;

    const followers = await repository.listFollowerIds(sale.sellerId);
    await notify(repository, followers, {
      kind: 'sale_opened',
      title: `${shop.sellerProfile.storefrontName} has started a sale`,
      body: sale.openingBody.slice(0, 140),
      link: `/social/c/${encodeURIComponent(sale.sellerId)}`,
    }, { ...heldUntil(showAt, now), key: ids.opened(sale) });
  }
  const openedAt = Date.parse(sale.openedAt);

  // 2. Items due within the lookahead, each written to show at its own time.
  //    Behind schedule, one per pass and shown now - see the note at the top.
  let caughtUp = false;
  for (const [index, item] of sale.items.entries()) {
    if (item.postedAt) continue;
    // Never ahead of the message that opens the sale.
    const due = Math.max(dueAt(sale, index), openedAt);
    if (due > horizon) break;
    let showAt = due;
    if (due <= now) {
      if (caughtUp) break;
      caughtUp = true;
      showAt = now;
    }
    await dropItem(repository, shop, sale, index, showAt, now);
    changed = true;
  }

  // 3. Windows. The item stays; the price goes up to what everybody else pays,
  //    which is the whole bargain: the window rewards being here, it does not
  //    punish being late. The listing reads that way from the minute the
  //    window ends (its `memberWindow`); here it is written down.
  for (const [index, item] of sale.items.entries()) {
    if (!item.postedAt || item.liftedAt || !item.listingId || !item.windowEndsAt) continue;
    const endsAt = Date.parse(item.windowEndsAt);

    // Now it is everybody's, so it can be said to everybody - where the shop
    // chose when it scheduled the sale, at the minute the window ends. One
    // post: a feed post is already in the channel, so asking for both writes
    // it once.
    const after = sale.afterWindow;
    if (!item.publicPostAt && endsAt <= horizon && after && (after.channel || after.feed)) {
      const showAt = Math.max(endsAt, now);
      try {
        await once(() => repository.createPost(shopPost(
          shop,
          // A feed post is read outside the room, so it does not talk about it.
          after.feed
            ? `✨ Now open to everyone: ${item.title}.`
            : `✨ Exclusive channel drop, now open to everyone: ${item.title}.`,
          item.listingId,
          true,
          after.feed ? 'feed' : 'channel',
          null,
          null,
          { id: ids.public(sale, index), at: showAt },
        )));
      } catch {
        /* The item goes public either way; a lost announcement is the lesser loss. */
      }
      item.publicPostAt = iso(showAt);
      changed = true;
    }

    if (endsAt > now) continue;
    const listing = await repository.getListing(item.listingId);
    if (listing) {
      // The handover: the price goes up to what everybody else pays, and the
      // item joins the catalog and the shop's own grid. Same listing, same id -
      // a bookmark made during the sale still opens the thing it pointed at.
      await repository.updateListing({
        ...listing,
        priceMinor: item.listPriceMinor,
        unlisted: false,
        expiresAt: publicExpiry(item, new Date(endsAt)) ?? listing.expiresAt,
        memberWindow: null,
        updatedAt: stamp,
      });
    }
    item.liftedAt = stamp;
    changed = true;
  }

  // 4. The closing message, at the minute the last window shuts; and the run
  //    is done once every window has been written down as shut.
  const allPosted = sale.items.every((item) => item.postedAt);
  if (allPosted && !sale.closingAt) {
    const last = Math.max(...sale.items.map((item) => Date.parse(item.windowEndsAt ?? item.postedAt!)));
    if (last <= horizon) {
      const showAt = Math.max(last, now);
      if (sale.closingBody.trim()) {
        await once(() => repository.createPost(shopPost(
          shop, sale.closingBody, null, true, 'channel', null, null, { id: ids.closing(sale), at: showAt },
        )));
      }
      sale.closingAt = iso(showAt);
      changed = true;
    }
  }
  if (allPosted && sale.items.every((item) => item.liftedAt) && !sale.closedAt) {
    sale.closedAt = stamp;
    sale.status = 'done';
    changed = true;
  }

  if (!changed) return sale;
  sale.updatedAt = stamp;
  return repository.savePowerSale(sale);
}

/** One item out: its listing and its post, both showing at `showAt`. */
async function dropItem(
  repository: Repo, shop: User, sale: PowerSale, index: number, showAt: number, now: number,
): Promise<void> {
  const item = sale.items[index]!;
  const endsAt = showAt + minutes(sale.windowMinutes);
  const listing = listingFor(sale, item, index, showAt, endsAt);
  await once(() => repository.createListing(listing));
  await refreshIdentity(repository, sale.sellerId);

  const rises = item.listPriceMinor > item.priceMinor;
  await once(() => repository.createPost(
    shopPost(
      shop,
      rises
        ? `⚡ Drop ${index + 1}/${sale.items.length}: ${item.title} — members' price for ${sale.windowMinutes} min, then the price goes up.`
        : `⚡ Drop ${index + 1}/${sale.items.length}: ${item.title} — yours first for ${sale.windowMinutes} min, then it goes public.`,
      listing.id,
      false,
      'channel',
      {
        endsAt: iso(endsAt), memberPriceMinor: item.priceMinor, publicPriceMinor: item.listPriceMinor,
        index: index + 1, total: sale.items.length, saleName: sale.name,
      },
      null,
      { id: ids.drop(sale, index), at: showAt },
    ),
  ));

  item.postedAt = iso(showAt);
  item.windowEndsAt = iso(endsAt);
  item.listingId = listing.id;

  // The first item is what everyone who pressed "Remind me" was waiting for:
  // held until it shows, so the phone buzzes as the post appears.
  if (index === 0 && !sale.remindedAt && (sale.reminders ?? []).length > 0) {
    await notify(repository, sale.reminders ?? [], reminderDraft(sale, shop), {
      except: sale.sellerId, ...heldUntil(showAt, now), key: ids.remind(sale),
    });
    sale.remindedAt = iso(showAt);
  }
}

/**
 * Somebody pressed "Remind me", or took it back, after the first item was
 * already written ahead - their notice is written, or withdrawn, to match.
 * Nothing to do before then: the item's own pass tells everyone on the list.
 */
export async function remindOne(repository: Repo, sale: PowerSale, userId: string, on: boolean): Promise<void> {
  const showAt = sale.items[0]?.postedAt;
  if (!sale.remindedAt || !showAt || userId === sale.sellerId) return;
  if (!on) {
    await repository.deleteNotification(userId, `ntf_${ids.remind(sale)}_${userId}`).catch(() => undefined);
    return;
  }
  const shop = await repository.getUserById(sale.sellerId);
  if (!shop?.sellerProfile) return;
  await notify(repository, [userId], reminderDraft(sale, shop), {
    ...heldUntil(Date.parse(showAt), Date.now()), key: ids.remind(sale),
  });
}

/**
 * Take back everything written ahead that has not shown yet: the posts, the
 * listings, the notices held for them. Calling a sale off at 9:01 must not
 * still drop the item written for 9:03.
 */
export async function callOffAhead(repository: Repo, sale: PowerSale, now = new Date()): Promise<void> {
  const t = now.getTime();
  const gone = (channelId: string, id: string) => repository.deletePost(channelId, id).catch(() => undefined);
  const unsay = (userIds: readonly string[], key: string) => Promise.all(userIds.map((userId) =>
    repository.deleteNotification(userId, `ntf_${key}_${userId}`).catch(() => undefined)));

  if (later(sale.openedAt, t)) {
    await gone(sale.sellerId, ids.opening(sale));
    await unsay(await repository.listFollowerIds(sale.sellerId), ids.opened(sale));
    sale.openedAt = null;
  }
  if (later(sale.remindedAt, t)) {
    await unsay(sale.reminders ?? [], ids.remind(sale));
    sale.remindedAt = null;
  }
  for (const [index, item] of sale.items.entries()) {
    if (later(item.postedAt, t)) {
      await gone(sale.sellerId, ids.drop(sale, index));
      if (item.listingId) await repository.deleteListing(sale.sellerId, item.listingId);
      Object.assign(item, { postedAt: null, windowEndsAt: null, listingId: null });
    }
    if (later(item.publicPostAt, t)) {
      await gone(sale.sellerId, ids.public(sale, index));
      item.publicPostAt = null;
    }
  }
  if (later(sale.closingAt, t)) {
    await gone(sale.sellerId, ids.closing(sale));
    sale.closingAt = null;
  }
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
  const pending = sale.items.filter((item) => item.listingId && !item.liftedAt);
  const listings = await Promise.all(pending.map((item) => repository.getListing(item.listingId!)));
  for (const [index, item] of pending.entries()) {
    const listing = listings[index];
    if (!listing) continue;
    await repository.updateListing({
      ...listing,
      priceMinor: item.listPriceMinor,
      unlisted: false,
      expiresAt: publicExpiry(item, now) ?? listing.expiresAt,
      memberWindow: null,
      updatedAt: stamp,
    });
    item.liftedAt = stamp;
    item.windowEndsAt = item.windowEndsAt ?? stamp;
  }
}

/**
 * Advance every live sale on the platform, whoever is or is not watching.
 *
 * What the clock app's timer runs every five minutes (the local dev server,
 * every minute). Each pass writes the next LOOKAHEAD ahead, so a drop due at
 * 3am shows at 3am with nobody watching. Returns how many sales it touched,
 * for the log.
 */
export async function tickPowerSales(repository: Repo, now = new Date()): Promise<number> {
  await renewShowcaseSales(repository, now).catch(() => 0);
  const live = await repository.listLivePowerSales();
  for (const sale of live) {
    try {
      await advancePowerSale(repository, sale, { now });
    } catch {
      /* One stuck sale must not hold up the others; it is retried next pass. */
    }
  }
  return live.length;
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
