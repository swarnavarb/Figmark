import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing, Lot, Order, User } from '../../../shared/models.js';
import { isCancelledLike } from '../../../shared/orders.js';
import { isExpired, orderMoney } from '../../../shared/payments.js';
import { can } from '../../../shared/stores.js';
import { personRef, type PartyRef } from '../../../shared/parties.js';
import {
  SEGMENTS,
  checkpointProgress,
  doorToDoor,
  groupByBuyer,
  live,
  packingEstimate,
  phaseOf,
  timingsOf,
  type Timings,
} from '../../../shared/insights.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * GET /api/me/insights - what this shop's consignments have been doing.
 *
 * Everything is computed from the lots and orders the console already reads.
 * The numbers live in shared/insights so this route is assembly rather than
 * arithmetic, and so the tests can check the maths without going through HTTP.
 *
 * Read-only and idempotent: a shop looking at its own figures must not be able
 * to change any of them by looking.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** The shop being read, and whether this account may read it. */
async function shopFor(
  request: HttpRequest,
  repository: Repo,
  user: { id: string },
): Promise<string | null> {
  const wanted = request.query.get('store') ?? user.id;
  if (wanted === user.id) return user.id;
  const owner = await repository.getUserById(wanted);
  if (!owner?.sellerProfile) return null;
  // The same right the existing analytics tab is gated on.
  return can(owner, user.id, 'analytics') ? owner.id : null;
}

/** Everybody named on this screen, resolved once. */
async function names(repository: Repo, ids: Iterable<string>): Promise<Map<string, PartyRef>> {
  const unique = [...new Set(ids)];
  const people: User[] = await repository.listUsersByIds(unique);
  const found = new Map(people.map((person) => [person.id, personRef(person)]));
  return new Map(unique.map((id) => [id, found.get(id) ?? personRef(null)]));
}

/**
 * Two decimal places, which is hours.
 *
 * One would round a six-hour leg to nothing and print "0.0d" beside a bar that
 * is plainly not nothing; the screen turns anything under a day into hours, and
 * it can only do that if the number it is given still has them.
 */
function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function shaped(timings: Timings) {
  return Object.fromEntries(SEGMENTS.map((segment) => [segment, round(timings[segment])]));
}

async function insights(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  const sellerId = await shopFor(request, repository, user);
  if (!sellerId) return error(403, 'forbidden', 'You cannot read the numbers for that shop.');

  const [lots, orders, listings] = await Promise.all([
    repository.listLots({ sellerId }),
    repository.listOrdersForSeller(sellerId),
    repository.listListings({ sellerId, includeHidden: true }),
  ]);

  const real = live(orders);
  const byLot = new Map<string, Order[]>();
  for (const order of real) {
    const existing = byLot.get(order.lotId);
    if (existing) existing.push(order);
    else byLot.set(order.lotId, [order]);
  }

  /* ── Headline ──────────────────────────────────────────────────────────
     What is moving and what it is worth. In flight means not delivered: a
     completed order is history, and history is not a thing to act on. */
  const inFlight = real.filter((order) => order.status !== 'delivered');
  const valueOf = (rows: readonly Order[]) =>
    rows.reduce((sum, order) => sum + order.quantity * order.unitPriceMinor, 0);

  const unpaid = inFlight.filter((order) => order.paymentStatus !== 'paid');

  /* ── Waiting on payment ────────────────────────────────────────────────
     AxisTwelve infers this from "in India and not ticked ready", because it
     has no idea what anything costs. Here it is the actual money. */
  const landedUnpaid = real.filter(
    (order) => order.checkpoints?.india_received && order.paymentStatus !== 'paid',
  );
  const pendingNames = await names(repository, landedUnpaid.map((order) => order.buyerId));
  const pending = [...groupByBuyer(landedUnpaid)]
    .map(([buyerId, rows]) => {
      const landed = rows
        .map((order) => order.checkpoints?.india_received)
        .filter((at): at is string => Boolean(at))
        .sort();
      return {
        buyerId,
        who: pendingNames.get(buyerId)!,
        orders: rows.length,
        totalMinor: valueOf(rows),
        // How long the oldest of them has been sitting in India unpaid, which
        // is the number that decides whether to chase.
        waitingDays: landed[0]
          ? Math.floor((Date.now() - Date.parse(landed[0])) / 86_400_000)
          : 0,
      };
    })
    .sort((a, b) => b.totalMinor - a.totalMinor);

  /* ── Per-lot ───────────────────────────────────────────────────────────
     Newest first, matching every other list in the console. */
  const perLot = [...lots].reverse().map((lot: Lot) => {
    const rows = byLot.get(lot.id) ?? [];
    const timings = timingsOf(rows, lot.createdAt);
    const progress = rows.length
      ? Math.round((rows.reduce((sum, order) => sum + checkpointProgress(order), 0) / rows.length) * 100)
      : 0;
    return {
      lotId: lot.id,
      lotName: lot.name,
      orders: rows.length,
      customers: groupByBuyer(rows).size,
      valueMinor: valueOf(rows),
      unpaidMinor: valueOf(rows.filter((order) => order.paymentStatus !== 'paid')),
      progress,
      phase: phaseOf(rows),
      timings: shaped(timings),
      doorToDoor: round(doorToDoor(timings)),
    };
  });

  /* ── Customer cohorts ──────────────────────────────────────────────────
     New versus returning has to be walked oldest-first: "was this their first
     time" is a question about the order lots actually happened in. */
  const chronological = [...lots];
  const seen = new Set<string>();
  const lastLotIndex = new Map<string, number>();
  const cohorts: { lotName: string; newCount: number; returningCount: number }[] = [];

  chronological.forEach((lot, index) => {
    const rows = byLot.get(lot.id) ?? [];
    if (rows.length === 0) return;
    let newCount = 0;
    let returningCount = 0;
    for (const buyerId of groupByBuyer(rows).keys()) {
      if (seen.has(buyerId)) returningCount += 1;
      else newCount += 1;
      seen.add(buyerId);
      lastLotIndex.set(buyerId, index);
    }
    cohorts.push({ lotName: lot.name, newCount, returningCount });
  });
  cohorts.reverse();

  // Dormant only means something once there is history to judge by: a shop
  // with two lots has no dormant customers, it has a short past.
  const dormantIds: { buyerId: string; lastLotName: string; lotsAgo: number }[] = [];
  if (chronological.length >= 4) {
    const threshold = chronological.length - 3;
    for (const [buyerId, index] of lastLotIndex) {
      if (index < threshold) {
        dormantIds.push({
          buyerId,
          lastLotName: chronological[index]!.name,
          lotsAgo: chronological.length - 1 - index,
        });
      }
    }
    dormantIds.sort((a, b) => b.lotsAgo - a.lotsAgo);
  }

  /* Top customers, by what they have actually spent with this shop. */
  const spend = [...groupByBuyer(real)]
    .map(([buyerId, rows]) => ({
      buyerId,
      orders: rows.length,
      lots: new Set(rows.map((order) => order.lotId)).size,
      totalMinor: valueOf(rows),
    }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  /* Several items in one consignment: the orders worth packing together. */
  const bulk: { buyerId: string; lotName: string; count: number }[] = [];
  for (const lot of [...lots].reverse()) {
    for (const [buyerId, rows] of groupByBuyer(byLot.get(lot.id) ?? [])) {
      if (rows.length >= 2) bulk.push({ buyerId, lotName: lot.name, count: rows.length });
    }
  }
  bulk.sort((a, b) => b.count - a.count);

  const who = await names(repository, [
    ...spend.slice(0, 8).map((row) => row.buyerId),
    ...dormantIds.slice(0, 8).map((row) => row.buyerId),
    ...bulk.slice(0, 8).map((row) => row.buyerId),
  ]);

  /* ── What AxisTwelve had no rows for ───────────────────────────────────
     It is a manifest: it knows what moved, never what it was worth, and it has
     no catalog behind it at all. */
  const preOrders = listings
    .filter((listing) => listing.preOrder)
    .map((listing) => ({
      listingId: listing.id,
      title: listing.title,
      threshold: listing.preOrder!.fillThreshold,
      booked: listing.preOrder!.filledCount,
      pledged: listing.preOrder!.pledgedCount ?? 0,
      filled: Boolean(listing.preOrder!.filledAt),
      closedShort: Boolean(listing.preOrder!.closedAt),
    }));

  const sales = await repository.listPowerSales(sellerId);
  const saleItems = sales.flatMap((sale) => sale.items).filter((item) => item.postedAt);
  const soldInWindow = saleItems.filter((item) => item.listingId && !item.liftedAt).length;
  const handedOver = saleItems.filter((item) => item.liftedAt).length;

  return json(200, {
    headline: {
      ordersInFlight: inFlight.length,
      valueInFlightMinor: valueOf(inFlight),
      unpaidMinor: valueOf(unpaid),
      customers: groupByBuyer(real).size,
      openLots: lots.filter((lot) => lot.status === 'open').length,
      /** The longest anything has sat in India unpaid, in days. */
      oldestWaitingDays: pending[0]?.waitingDays ?? 0,
    },
    boxes: packingEstimate(lots, byLot),
    /** Across every order the shop has, not one lot. */
    timings: shaped(timingsOf(real, null)),
    perLot,
    pending: pending.slice(0, 8),
    cohorts,
    top: spend.slice(0, 8).map((row) => ({ ...row, who: who.get(row.buyerId)! })),
    repeat: spend.filter((row) => row.lots >= 2).length,
    dormant: dormantIds.slice(0, 8).map((row) => ({ ...row, who: who.get(row.buyerId)! })),
    bulk: bulk.slice(0, 8).map((row) => ({ ...row, who: who.get(row.buyerId)! })),
    preOrders,
    powerSales: {
      runs: sales.length,
      posted: saleItems.length,
      /** Still inside their window, so still members-only. */
      inWindow: soldInWindow,
      /** Windows that closed and handed the item to the catalog. */
      handedOver,
    },
  });
}

/** The item's lead photo, for a thumbnail beside its name. */
function photoOf(listing: Listing | undefined): string | null {
  const lead = listing?.photos.find((photo) => photo.isPrimary) ?? listing?.photos[0];
  return lead?.url || null;
}

/**
 * GET /api/me/interest - who wants what, before and after they buy.
 *
 * The Insights (Pro) tab. Everything the order book cannot show because it
 * never became an order: who saved which item, who pressed Buy and stopped at
 * the checkout, and how each item turns looking into paying. Plus the two
 * lists a shop acts on every day - people worth a message, and money still
 * to collect.
 */
async function interest(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  const sellerId = await shopFor(request, repository, user);
  if (!sellerId) return error(403, 'forbidden', 'You cannot read the numbers for that shop.');

  const [listings, orders, drafts] = await Promise.all([
    repository.listListings({ sellerId, includeHidden: true })
      .then((rows) => rows.filter((row) => row.status !== 'archived')),
    repository.listOrdersForSeller(sellerId),
    repository.listCheckoutDrafts(sellerId),
  ]);
  const likes = (await repository.listLikesForListings(listings.map((listing) => listing.id)))
    .filter((like) => like.userId !== sellerId);
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const real = orders.filter((order) => !isCancelledLike(order.status));
  const stalled = drafts.filter((order) => order.status === 'pending_payment');

  const boughtBy = new Set(real.map((order) => `${order.buyerId}:${order.listingId}`));
  const stalledBy = new Set(stalled.map((order) => `${order.buyerId}:${order.listingId}`));
  const customers = new Set(real.map((order) => order.buyerId));

  const who = await names(repository, [
    ...likes.map((like) => like.userId),
    ...stalled.map((order) => order.buyerId),
    ...real.map((order) => order.buyerId),
  ]);

  /* ── Saved ─────────────────────────────────────────────────────────────
     Per item, most-saved first, and for each person whether they went on to
     buy it - a save that became an order is not a lead any more. */
  const savesByItem = new Map<string, typeof likes>();
  for (const like of likes) {
    const rows = savesByItem.get(like.listingId);
    if (rows) rows.push(like);
    else savesByItem.set(like.listingId, [like]);
  }
  const saved = [...savesByItem]
    .map(([listingId, rows]) => {
      const listing = byId.get(listingId);
      return {
        listingId,
        title: listing?.title ?? 'An item',
        photo: photoOf(listing),
        priceMinor: listing?.priceMinor ?? 0,
        currency: listing?.currency ?? 'INR',
        people: rows
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((like) => ({
            who: who.get(like.userId)!,
            savedAt: like.createdAt,
            state: boughtBy.has(`${like.userId}:${listingId}`) ? 'bought' as const
              : stalledBy.has(`${like.userId}:${listingId}`) ? 'checkout' as const : 'saved' as const,
          })),
      };
    })
    .sort((a, b) => b.people.length - a.people.length);

  /* ── Pressed Buy, went no further ───────────────────────────────────── */
  const checkout = stalled.map((order) => {
    const listing = byId.get(order.listingId);
    return {
      orderId: order.id,
      listingId: order.listingId,
      title: order.itemName,
      photo: photoOf(listing),
      who: who.get(order.buyerId)!,
      firstAt: order.createdAt,
      lastAt: order.updatedAt,
      clicks: order.buyClicks ?? 1,
      amountMinor: order.unitPriceMinor * order.quantity,
      currency: order.currency,
      stillForSale: Boolean(listing && listing.status === 'active' && !isExpired(listing)),
      boughtElsewhere: boughtBy.has(`${order.buyerId}:${order.listingId}`),
    };
  });

  /* ── Each item, from a look to a payment ─────────────────────────────── */
  const items = listings
    .map((listing) => {
      const placed = real.filter((order) => order.listingId === listing.id);
      return {
        listingId: listing.id,
        title: listing.title,
        photo: photoOf(listing),
        live: listing.status === 'active' && !isExpired(listing),
        views: listing.viewCount ?? 0,
        saves: savesByItem.get(listing.id)?.length ?? 0,
        buyClicks: placed.length + stalled.filter((order) => order.listingId === listing.id).length,
        orders: placed.length,
        paid: placed.filter((order) => order.paymentStatus === 'paid').length,
        revenueMinor: placed.reduce((sum, order) => sum + orderMoney(order).paidMinor, 0),
        currency: listing.currency,
        expiresAt: listing.expiresAt ?? null,
      };
    })
    .filter((row) => row.views + row.saves + row.buyClicks > 0)
    .sort((a, b) => (b.buyClicks * 3 + b.saves * 2 + b.views) - (a.buyClicks * 3 + a.saves * 2 + a.views));

  /* ── People worth a message ────────────────────────────────────────────
     Interested and never ordered anything from this shop. */
  const leadMap = new Map<string, { saves: number; checkouts: number; lastAt: string }>();
  const touch = (id: string, at: string, key: 'saves' | 'checkouts') => {
    if (customers.has(id)) return;
    const row = leadMap.get(id) ?? { saves: 0, checkouts: 0, lastAt: at };
    row[key] += 1;
    if (at > row.lastAt) row.lastAt = at;
    leadMap.set(id, row);
  };
  for (const like of likes) touch(like.userId, like.createdAt, 'saves');
  for (const order of stalled) touch(order.buyerId, order.updatedAt, 'checkouts');
  const leads = [...leadMap]
    .map(([id, row]) => ({ who: who.get(id)!, ...row }))
    .sort((a, b) => (b.checkouts * 2 + b.saves) - (a.checkouts * 2 + a.saves) || b.lastAt.localeCompare(a.lastAt))
    .slice(0, 12);

  /* ── Money still to collect ──────────────────────────────────────────── */
  const owing = new Map<string, { outstandingMinor: number; orders: number; currency: string }>();
  for (const order of real) {
    if (!order.accepted && order.paymentStatus === 'unpaid') continue;
    const { outstandingMinor } = orderMoney(order);
    if (outstandingMinor <= 0) continue;
    const row = owing.get(order.buyerId) ?? { outstandingMinor: 0, orders: 0, currency: order.currency };
    row.outstandingMinor += outstandingMinor;
    row.orders += 1;
    owing.set(order.buyerId, row);
  }
  const toCollect = [...owing]
    .map(([id, row]) => ({ who: who.get(id)!, ...row }))
    .sort((a, b) => b.outstandingMinor - a.outstandingMinor)
    .slice(0, 10);

  /* ── Nearly gone and still wanted ─────────────────────────────────────── */
  const soon = Date.now() + 3 * 86_400_000;
  const expiring = items
    .filter((row) => row.live && row.expiresAt && Date.parse(row.expiresAt) <= soon && row.saves + row.buyClicks > 0)
    .map(({ listingId, title, expiresAt, saves, buyClicks }) => ({ listingId, title, expiresAt, saves, buyClicks }));

  const views = listings.reduce((sum, listing) => sum + (listing.viewCount ?? 0), 0);
  const clicks = real.length + stalled.length;

  return json(200, {
    summary: {
      views,
      saves: likes.length,
      buyClicks: clicks,
      stalled: stalled.length,
      stalledMinor: stalled.reduce((sum, order) => sum + order.unitPriceMinor * order.quantity, 0),
      orders: real.length,
      paid: real.filter((order) => order.paymentStatus === 'paid').length,
      /** Of everybody who pressed Buy, the share who went ahead. */
      placedPercent: clicks ? Math.round((real.length / clicks) * 100) : null,
      toCollectMinor: toCollect.reduce((sum, row) => sum + row.outstandingMinor, 0),
    },
    saved,
    checkout,
    items: items.slice(0, 20),
    leads,
    toCollect,
    expiring,
    /** When people act - saves, Buy presses and orders - for a by-hour chart drawn in the viewer's clock. */
    activity: [
      ...likes.map((like) => like.createdAt),
      ...stalled.map((order) => order.createdAt),
      ...real.map((order) => order.placedAt ?? order.createdAt),
    ].slice(-1000),
  });
}

export const insightsRoute = handler(insights);
export const interestRoute = handler(interest);

app.http('me-interest', {
  authLevel: 'anonymous',
  methods: ['GET'],
  route: 'me/interest',
  handler: interestRoute,
});

app.http('me-insights', {
  authLevel: 'anonymous',
  methods: ['GET'],
  route: 'me/insights',
  handler: insightsRoute,
});
