import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing, Lot, Order, User } from '../../../shared/models.js';
import type { OrderStatus } from '../../../shared/enums.js';
import { isExpired, orderMoney } from '../../../shared/payments.js';
import {
  COST_STAGES, cleanCostSheet, sheetTotal,
  type CostStage, type ItemCostSheet,
} from '../../../shared/profit.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { names, shopFor } from './insight-routes.js';
import { notify } from './notify.js';


/** How many earlier versions of an item's costs are kept to step back to. */
const MAX_COST_HISTORY = 10;
/**
 * The numbers underneath the shop.
 *
 * Real profit per lot, item and customer from each item's saved costs; the
 * deeper Pro figures (retention, customer value, price changes, demand
 * forecast, reminders, bundles, returns); the free sales figures Analytics
 * shows; and the one write - a nudge to a buyer.
 *
 * All of it reads with the same right as Insights, from the lots, listings,
 * orders and saves the shop already has.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

const DAY = 86_400_000;

/** Orders that never turned into money kept: called off, turned down, or given back. */
const GONE: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'cancelled', 'rejected', 'refunded', 'cancelled_reversed', 'payment_reversal_pending',
]);

const placedAt = (order: Order) => order.placedAt ?? order.createdAt;
const valueOf = (order: Order) => order.quantity * order.unitPriceMinor;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

async function open(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const shopId = await shopFor(request, repository, user);
  return { user, repository, shopId };
}

function photoOf(listing: Listing | undefined): string | null {
  const lead = listing?.photos.find((photo) => photo.isPrimary) ?? listing?.photos[0];
  return lead?.url || null;
}

/** On sale right now. */
const onSale = (listing: Listing) => listing.status === 'active' && !isExpired(listing);

/* ── Real profit ─────────────────────────────────────────────────────────── */

interface ProfitRow {
  key: string;
  name: string;
  sub: string | null;
  photo: string | null;
  orders: number;
  units: number;
  revenueMinor: number;
  /** What the costed units cost. */
  costMinor: number;
  /** Revenue on units with costs saved, less those costs. */
  profitMinor: number;
  marginPercent: number | null;
  /** Sold units whose item has no costs saved yet, so no profit is counted for them. */
  uncostedUnits: number;
  stages: Record<CostStage, number>;
  /** Per step, for the breakdown: label, stage and paise across every unit. */
  steps: { id: string; label: string; stage: CostStage; amountMinor: number }[];
}

function blankRow(key: string, name: string, sub: string | null, photo: string | null): ProfitRow & { costedRevenue: number } {
  return {
    key, name, sub, photo, orders: 0, units: 0, revenueMinor: 0, costMinor: 0, profitMinor: 0,
    marginPercent: null, uncostedUnits: 0,
    stages: Object.fromEntries(COST_STAGES.map((stage) => [stage, 0])) as Record<CostStage, number>,
    steps: [], costedRevenue: 0,
  };
}

function addOrder(row: ProfitRow & { costedRevenue: number }, order: Order, sheet: ItemCostSheet | null | undefined) {
  row.orders += 1;
  row.units += order.quantity;
  row.revenueMinor += valueOf(order);
  if (!sheet || sheet.steps.length === 0) {
    row.uncostedUnits += order.quantity;
    return;
  }
  row.costedRevenue += valueOf(order);
  for (const step of sheet.steps) {
    const amount = step.amountMinor * order.quantity;
    row.costMinor += amount;
    row.stages[step.stage] += amount;
    const found = row.steps.find((entry) => entry.label === step.label && entry.stage === step.stage);
    if (found) found.amountMinor += amount;
    else row.steps.push({ id: step.id, label: step.label, stage: step.stage, amountMinor: amount });
  }
}

function finish(row: ProfitRow & { costedRevenue: number }): ProfitRow {
  const { costedRevenue, ...rest } = row;
  rest.profitMinor = costedRevenue - rest.costMinor;
  rest.marginPercent = percent(rest.profitMinor, costedRevenue);
  rest.steps.sort((a, b) => COST_STAGES.indexOf(a.stage) - COST_STAGES.indexOf(b.stage));
  return rest;
}

const byProfit = (a: ProfitRow, b: ProfitRow) => b.profitMinor - a.profitMinor || b.revenueMinor - a.revenueMinor;

/**
 * GET /api/me/costs - what the shop actually made, per lot, per item and per
 * customer, each split into what is still running and what is done.
 *
 * Profit is counted only on units whose item has costs saved; the rest is
 * shown as revenue with a count of what is missing, rather than as a profit
 * that pretends the item was free.
 */
async function costs(request: HttpRequest, _context: InvocationContext) {
  const { repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot read the numbers for that shop.');

  const [lots, orders, listings] = await Promise.all([
    repository.listLots({ sellerId: shopId }),
    repository.listOrdersForSeller(shopId),
    repository.listListings({ sellerId: shopId, includeHidden: true }),
  ]);
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const kept = orders.filter((order) => !GONE.has(order.status));

  // A lot is done once it is closed, or everything in it has been delivered.
  const lotOrders = new Map<string, Order[]>();
  for (const order of kept) lotOrders.set(order.lotId, [...(lotOrders.get(order.lotId) ?? []), order]);
  const lotDone = (lot: Lot) => {
    const rows = lotOrders.get(lot.id) ?? [];
    return lot.status === 'closed' || lot.status === 'cancelled'
      || (rows.length > 0 && rows.every((order) => order.status === 'delivered'));
  };
  const customerOrders = new Map<string, Order[]>();
  for (const order of kept) customerOrders.set(order.buyerId, [...(customerOrders.get(order.buyerId) ?? []), order]);

  const lotRows = new Map<string, ReturnType<typeof blankRow>>();
  const itemRows = new Map<string, ReturnType<typeof blankRow>>();
  const customerRows = new Map<string, ReturnType<typeof blankRow>>();
  const totals = { active: blankRow('active', 'Active', null, null), closed: blankRow('closed', 'Closed', null, null) };
  const who = await names(repository, customerOrders.keys());

  for (const order of kept) {
    const listing = listingById.get(order.listingId);
    const sheet = listing?.costSheet;
    const lot = lotById.get(order.lotId);
    if (lot) {
      const row = lotRows.get(lot.id) ?? blankRow(lot.id, lot.name, lot.lotNumber ? `#${lot.lotNumber}` : null, null);
      addOrder(row, order, sheet);
      lotRows.set(lot.id, row);
    }
    const item = itemRows.get(order.listingId)
      ?? blankRow(order.listingId, listing?.title ?? order.itemName, lot?.name ?? null, photoOf(listing));
    addOrder(item, order, sheet);
    itemRows.set(order.listingId, item);
    const person = who.get(order.buyerId)!;
    const customer = customerRows.get(order.buyerId) ?? blankRow(order.buyerId, person.name, person.handle, null);
    addOrder(customer, order, sheet);
    customerRows.set(order.buyerId, customer);
    addOrder(order.status === 'delivered' ? totals.closed : totals.active, order, sheet);
  }

  const split = (rows: Map<string, ReturnType<typeof blankRow>>, done: (key: string) => boolean) => {
    const active: ProfitRow[] = [];
    const closed: ProfitRow[] = [];
    for (const [key, row] of rows) (done(key) ? closed : active).push(finish(row));
    return { active: active.sort(byProfit), closed: closed.sort(byProfit) };
  };

  return json(200, {
    /** By order: delivered is closed, anything still moving is active. */
    totals: { active: finish(totals.active), closed: finish(totals.closed) },
    lots: split(lotRows, (id) => { const lot = lotById.get(id); return lot ? lotDone(lot) : true; }),
    items: split(itemRows, (id) => { const listing = listingById.get(id); return !listing || !onSale(listing); }),
    // A customer is active while anything of theirs is still on its way.
    customers: split(customerRows, (id) => (customerOrders.get(id) ?? []).every((order) => order.status === 'delivered')),
    handles: Object.fromEntries([...who].map(([id, ref]) => [id, ref.handle])),
    /** Every item, for choosing which to cost. Newest first. */
    sheets: listings
      .filter((listing) => listing.status !== 'draft')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((listing) => ({
        listingId: listing.id,
        title: listing.title,
        photo: photoOf(listing),
        priceMinor: listing.priceMinor,
        currency: listing.currency,
        lotName: listing.lotId ? lotById.get(listing.lotId)?.name ?? null : null,
        onSale: onSale(listing),
        sold: (kept.filter((order) => order.listingId === listing.id)).reduce((sum, order) => sum + order.quantity, 0),
        sheet: listing.costSheet ?? null,
        costMinor: sheetTotal(listing.costSheet),
        /** What Remove steps back to: the costs saved before these, if any. */
        previousCostMinor: listing.costSheetPrevious?.length ? sheetTotal(listing.costSheetPrevious.at(-1)) : null,
      })),
  });
}

/** POST /api/me/listings/{id}/cost-sheet - save, correct or clear one item's costs. */
async function saveCostSheet(request: HttpRequest, _context: InvocationContext) {
  const { repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot change the costs for that shop.');
  const listing = await repository.getListing(request.params.id ?? '');
  if (!listing || listing.sellerId !== shopId) return error(404, 'not_found', 'No such item in this shop.');

  let body: { sheet?: Partial<ItemCostSheet> | null; restore?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const now = new Date().toISOString();

  const history = [...(listing.costSheetPrevious ?? [])];
  let sheet: ItemCostSheet | null = null;
  if (body.restore) {
    // Removing steps back to the costs saved before these, when there were any.
    sheet = history.pop() ?? null;
  } else if (body.sheet) {
    try {
      sheet = cleanCostSheet(body.sheet, now);
    } catch (err) {
      return error(400, 'invalid_sheet', (err as Error).message);
    }
    if (!sheet) return error(400, 'invalid_sheet', 'Keep at least one cost step, or remove the costs.');
  }

  // Anything replaced is kept, so it can be stepped back to.
  if (!body.restore && listing.costSheet) history.push(listing.costSheet);
  const saved = await repository.updateListing({
    ...listing, costSheet: sheet, costSheetPrevious: history.slice(-MAX_COST_HISTORY), updatedAt: now,
  });
  return json(200, {
    listingId: saved.id, sheet: saved.costSheet ?? null, costMinor: sheetTotal(saved.costSheet),
    previous: saved.costSheetPrevious?.at(-1) ?? null,
  });
}

/* ── Deeper Pro figures ──────────────────────────────────────────────────── */

const monthOf = (iso: string) => iso.slice(0, 7);
const addMonths = (month: string, count: number) => {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, mon - 1 + count, 1));
  return date.toISOString().slice(0, 7);
};

type ValueLabel = 'vip' | 'regular' | 'at_risk' | 'one_time' | 'new';

/**
 * GET /api/me/deep - retention by month, what each customer is worth, what
 * price changes did, how many to bring next time, who to remind, what sells
 * together, and which items come back.
 */
async function deep(request: HttpRequest, _context: InvocationContext) {
  const { repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot read the numbers for that shop.');

  const [lots, orders, listings] = await Promise.all([
    repository.listLots({ sellerId: shopId }),
    repository.listOrdersForSeller(shopId),
    repository.listListings({ sellerId: shopId, includeHidden: true }),
  ]);
  const likes = (await repository.listLikesForListings(listings.map((listing) => listing.id)))
    .filter((like) => like.userId !== shopId);
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const kept = orders.filter((order) => !GONE.has(order.status))
    .sort((a, b) => placedAt(a).localeCompare(placedAt(b)));
  const now = Date.now();
  const thisMonth = new Date(now).toISOString().slice(0, 7);

  const byBuyer = new Map<string, Order[]>();
  for (const order of kept) byBuyer.set(order.buyerId, [...(byBuyer.get(order.buyerId) ?? []), order]);

  /* Retention: of the people whose first order was in a month, how many
     ordered again one, two and three months on. */
  const cohortMap = new Map<string, { size: number; back: [number, number, number] }>();
  for (const rows of byBuyer.values()) {
    const first = monthOf(placedAt(rows[0]!));
    const entry = cohortMap.get(first) ?? { size: 0, back: [0, 0, 0] };
    entry.size += 1;
    const months = new Set(rows.map((order) => monthOf(placedAt(order))));
    for (const step of [1, 2, 3] as const) if (months.has(addMonths(first, step))) entry.back[step - 1]! += 1;
    cohortMap.set(first, entry);
  }
  const cohorts = [...cohortMap]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 8)
    .map(([month, entry]) => ({
      month,
      size: entry.size,
      // A month that has not happened yet has no answer, which is not zero.
      back: entry.back.map((count, at) => (addMonths(month, at + 1) > thisMonth ? null : percent(count, entry.size))),
    }));

  /* Customer value. */
  const spends = [...byBuyer].map(([buyerId, rows]) => ({
    buyerId,
    orders: rows.length,
    spentMinor: rows.reduce((sum, order) => sum + valueOf(order), 0),
    firstAt: placedAt(rows[0]!),
    lastAt: placedAt(rows[rows.length - 1]!),
  })).sort((a, b) => b.spentMinor - a.spentMinor);
  const vipCut = spends[Math.max(0, Math.ceil(spends.length * 0.1) - 1)]?.spentMinor ?? Infinity;
  const labelOf = (row: (typeof spends)[number]): ValueLabel => {
    const quiet = (now - Date.parse(row.lastAt)) / DAY;
    if (row.orders === 1) return quiet <= 30 ? 'new' : 'one_time';
    const gap = (Date.parse(row.lastAt) - Date.parse(row.firstAt)) / DAY / (row.orders - 1);
    if (quiet > 30 && quiet > Math.max(gap, 15) * 1.5) return 'at_risk';
    return row.spentMinor >= vipCut ? 'vip' : 'regular';
  };
  const valueNames = await names(repository, spends.slice(0, 60).map((row) => row.buyerId));
  const labelled = spends.map((row) => ({ ...row, label: labelOf(row) }));
  const value = {
    counts: Object.fromEntries((['vip', 'regular', 'at_risk', 'one_time', 'new'] as const)
      .map((label) => [label, labelled.filter((row) => row.label === label).length])) as Record<ValueLabel, number>,
    averageMinor: spends.length ? Math.round(spends.reduce((sum, row) => sum + row.spentMinor, 0) / spends.length) : 0,
    rows: labelled.slice(0, 60).map((row) => ({
      who: valueNames.get(row.buyerId)!, orders: row.orders, spentMinor: row.spentMinor, lastAt: row.lastAt, label: row.label,
    })),
  };

  /* Price changes: each price an item has had, and what demand did at it. */
  const pricing = listings.flatMap((listing) => {
    const history = listing.priceHistory ?? [];
    if (history.length < 2) return [];
    const itemOrders = kept.filter((order) => order.listingId === listing.id);
    const itemLikes = likes.filter((like) => like.listingId === listing.id);
    const periods = history.map((entry, at) => {
      const from = Date.parse(entry.at);
      const to = at + 1 < history.length ? Date.parse(history[at + 1]!.at) : now;
      const inside = (iso: string) => { const time = Date.parse(iso); return time >= from && time < to; };
      const units = itemOrders.filter((order) => inside(placedAt(order))).reduce((sum, order) => sum + order.quantity, 0);
      const weeks = Math.max(1, (to - from) / (7 * DAY));
      return {
        priceMinor: entry.priceMinor,
        from: entry.at,
        days: Math.max(0, Math.round((to - from) / DAY)),
        saves: itemLikes.filter((like) => inside(like.createdAt)).length,
        units,
        perWeek: Math.round((units / weeks) * 10) / 10,
      };
    });
    return [{ listingId: listing.id, title: listing.title, photo: photoOf(listing), currency: listing.currency, periods }];
  }).slice(0, 20);

  /* Demand forecast: how many to bring in the next lot. */
  const lotStarts = lots.map((lot) => Date.parse(lot.createdAt)).sort((a, b) => a - b);
  const gaps = lotStarts.slice(1).map((time, at) => (time - lotStarts[at]!) / DAY).sort((a, b) => a - b);
  const cycleDays = gaps.length ? Math.max(7, Math.round(gaps[Math.floor(gaps.length / 2)]!)) : 28;
  const bought = new Set(kept.map((order) => `${order.buyerId}:${order.listingId}`));
  const savedThenBought = likes.filter((like) => bought.has(`${like.userId}:${like.listingId}`)).length;
  const conversion = likes.length ? savedThenBought / likes.length : 0;
  const forecast = listings
    .filter((listing) => listing.status !== 'archived')
    .map((listing) => {
      const recent = kept.filter((order) => order.listingId === listing.id && now - Date.parse(placedAt(order)) < 28 * DAY);
      const perWeek = recent.reduce((sum, order) => sum + order.quantity, 0) / 4;
      const waiting = likes.filter((like) => like.listingId === listing.id && !bought.has(`${like.userId}:${like.listingId}`)).length;
      const pledged = listing.preOrder ? (listing.preOrder.pledgedCount ?? 0) : 0;
      const next = Math.ceil(perWeek * (cycleDays / 7) + waiting * conversion + pledged);
      return {
        listingId: listing.id, title: listing.title, photo: photoOf(listing),
        perWeek: Math.round(perWeek * 10) / 10, waiting, pledged,
        inStock: listing.quantityMode === 'multiple' ? null : listing.quantityAvailable,
        next,
      };
    })
    .filter((row) => row.next > 0)
    .sort((a, b) => b.next - a.next)
    .slice(0, 20);

  /* Worth reminding: saved it, never bought it, and it is back or cheaper. */
  const priceWhen = (listing: Listing, iso: string) => {
    let price = listing.priceHistory?.[0]?.priceMinor ?? listing.priceMinor;
    for (const entry of listing.priceHistory ?? []) if (entry.at <= iso) price = entry.priceMinor;
    return price;
  };
  const remindRows = likes.flatMap((like) => {
    const listing = listingById.get(like.listingId);
    if (!listing || !onSale(listing) || bought.has(`${like.userId}:${like.listingId}`)) return [];
    const was = priceWhen(listing, like.createdAt);
    const cheaper = listing.priceMinor < was;
    const restocked = Boolean(listing.restockedAt && listing.restockedAt > like.createdAt);
    if (!cheaper && !restocked) return [];
    return [{
      buyerId: like.userId, listingId: listing.id, title: listing.title, photo: photoOf(listing),
      currency: listing.currency, wasMinor: was, nowMinor: listing.priceMinor,
      reason: cheaper ? 'cheaper' as const : 'restocked' as const, savedAt: like.createdAt,
    }];
  }).slice(0, 60);
  const remindNames = await names(repository, remindRows.map((row) => row.buyerId));
  const reminders = remindRows.map(({ buyerId, ...row }) => ({ ...row, buyerId, who: remindNames.get(buyerId)! }));

  /* Bought together: two items the same person ordered within a week. */
  const pairs = new Map<string, number>();
  for (const rows of byBuyer.values()) {
    const seen = new Set<string>();
    for (const [at, first] of rows.entries()) {
      for (const second of rows.slice(at + 1)) {
        if (second.listingId === first.listingId) continue;
        if (Date.parse(placedAt(second)) - Date.parse(placedAt(first)) > 7 * DAY) break;
        const key = [first.listingId, second.listingId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const bundles = [...pairs]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, count]) => ({
      count,
      items: key.split('|').map((id) => {
        const listing = listingById.get(id);
        return { listingId: id, title: listing?.title ?? 'Removed item', photo: photoOf(listing), priceMinor: listing?.priceMinor ?? 0 };
      }),
    }));

  /* Returns and cancellations, for every order that was ever placed. */
  const trouble = (rows: Order[]) => {
    const placed = rows.filter((order) => order.status !== 'rejected');
    const cancelled = placed.filter((order) => GONE.has(order.status)).length;
    const disputed = placed.filter((order) => (order.disputeLinks?.length ?? 0) > 0).length;
    return { orders: placed.length, cancelled, disputed, ratePercent: percent(cancelled + disputed, placed.length) ?? 0 };
  };
  const byItem = new Map<string, Order[]>();
  const byCategory = new Map<string, Order[]>();
  for (const order of orders) {
    byItem.set(order.listingId, [...(byItem.get(order.listingId) ?? []), order]);
    const category = listingById.get(order.listingId)?.category ?? 'Other';
    byCategory.set(category, [...(byCategory.get(category) ?? []), order]);
  }
  const returns = {
    overall: trouble(orders),
    items: [...byItem]
      .map(([id, rows]) => ({ listingId: id, title: listingById.get(id)?.title ?? rows[0]!.itemName, ...trouble(rows) }))
      .filter((row) => row.cancelled + row.disputed > 0)
      .sort((a, b) => b.ratePercent - a.ratePercent || b.orders - a.orders)
      .slice(0, 20),
    categories: [...byCategory]
      .map(([category, rows]) => ({ category, ...trouble(rows) }))
      .filter((row) => row.orders > 0)
      .sort((a, b) => b.ratePercent - a.ratePercent),
  };

  return json(200, { cohorts, value, pricing, forecast: { cycleDays, conversionPercent: Math.round(conversion * 100), rows: forecast }, reminders, bundles, returns });
}

/* ── Sales (free Analytics) ──────────────────────────────────────────────── */

type Bucket = 'day' | 'week' | 'month';

/**
 * GET /api/me/sales-report?days=30 - sales over a period, best sellers, unpaid
 * balances by age, where orders came from, stock running out, and the rows
 * for a spreadsheet.
 */
async function sales(request: HttpRequest, _context: InvocationContext) {
  const { repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot read the numbers for that shop.');

  const days = Math.min(730, Math.max(1, Number(request.query.get('days')) || 30));
  const now = Date.now();
  const from = now - days * DAY;
  const [orders, listings, lots, powerSales] = await Promise.all([
    repository.listOrdersForSeller(shopId),
    repository.listListings({ sellerId: shopId, includeHidden: true }),
    repository.listLots({ sellerId: shopId }),
    repository.listPowerSales(shopId),
  ]);
  const listingById = new Map(listings.map((listing) => [listing.id, listing]));
  const lotName = new Map(lots.map((lot) => [lot.id, lot.name]));
  const kept = orders.filter((order) => !GONE.has(order.status));
  const inRange = (order: Order, start: number, end: number) => {
    const time = Date.parse(placedAt(order));
    return time >= start && time < end;
  };
  const period = kept.filter((order) => inRange(order, from, now));
  const before = kept.filter((order) => inRange(order, from - days * DAY, from));
  const sum = (rows: Order[]) => ({
    orders: rows.length,
    units: rows.reduce((total, order) => total + order.quantity, 0),
    revenueMinor: rows.reduce((total, order) => total + valueOf(order), 0),
    customers: new Set(rows.map((order) => order.buyerId)).size,
  });

  /* Over time. */
  const bucket: Bucket = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
  const startOf = (time: number) => {
    const date = new Date(time);
    date.setUTCHours(0, 0, 0, 0);
    if (bucket === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    if (bucket === 'month') date.setUTCDate(1);
    return date.toISOString().slice(0, 10);
  };
  const series = new Map<string, { start: string; orders: number; revenueMinor: number }>();
  for (let time = from; time <= now; time += DAY) {
    const key = startOf(time);
    if (!series.has(key)) series.set(key, { start: key, orders: 0, revenueMinor: 0 });
  }
  for (const order of period) {
    const entry = series.get(startOf(Date.parse(placedAt(order))));
    if (!entry) continue;
    entry.orders += 1;
    entry.revenueMinor += valueOf(order);
  }

  /* Best sellers. */
  const items = new Map<string, { listingId: string; title: string; photo: string | null; units: number; revenueMinor: number }>();
  for (const order of period) {
    const listing = listingById.get(order.listingId);
    const row = items.get(order.listingId)
      ?? { listingId: order.listingId, title: listing?.title ?? order.itemName, photo: photoOf(listing), units: 0, revenueMinor: 0 };
    row.units += order.quantity;
    row.revenueMinor += valueOf(order);
    items.set(order.listingId, row);
  }
  const itemRows = [...items.values()];

  /* Unpaid balances by how long they have been owed. */
  const owed = kept.filter((order) => order.status !== 'delivered' || order.paymentStatus !== 'paid')
    .filter((order) => (order.accepted || order.paymentStatus !== 'unpaid') && orderMoney(order).outstandingMinor > 0);
  const owedNames = await names(repository, owed.map((order) => order.buyerId));
  const ageing = owed.map((order) => {
    const since = order.acceptedAt ?? placedAt(order);
    return {
      orderId: order.id,
      who: owedNames.get(order.buyerId)!,
      title: order.itemName,
      outstandingMinor: orderMoney(order).outstandingMinor,
      currency: order.currency,
      days: Math.max(0, Math.floor((now - Date.parse(since)) / DAY)),
    };
  }).sort((a, b) => b.days - a.days);
  const band = (low: number, high: number) => {
    const rows = ageing.filter((row) => row.days >= low && row.days <= high);
    return { count: rows.length, amountMinor: rows.reduce((total, row) => total + row.outstandingMinor, 0) };
  };

  /* Where orders came from. There is no record of where a visitor clicked
     from, so this is where the order itself came through. */
  const saleListings = new Set(powerSales.flatMap((sale) => sale.items.map((item) => item.listingId)).filter(Boolean));
  const sourceOf = (order: Order) => {
    if (order.broughtBy) return 'shared';
    if (saleListings.has(order.listingId)) return 'sale';
    if (listingById.get(order.listingId)?.preOrder) return 'preorder';
    return 'shop';
  };
  const sources = (['shared', 'sale', 'preorder', 'shop'] as const).map((source) => ({
    source, ...sum(period.filter((order) => sourceOf(order) === source)),
  }));

  /* Running out. */
  const stock = listings
    .filter((listing) => listing.status !== 'archived' && listing.status !== 'draft' && listing.quantityMode !== 'multiple' && !isExpired(listing))
    .filter((listing) => listing.quantityAvailable <= 2)
    .map((listing) => ({
      listingId: listing.id, title: listing.title, photo: photoOf(listing), left: listing.quantityAvailable,
      soldRecently: kept.filter((order) => order.listingId === listing.id && now - Date.parse(placedAt(order)) < 30 * DAY)
        .reduce((total, order) => total + order.quantity, 0),
    }))
    .sort((a, b) => a.left - b.left || b.soldRecently - a.soldRecently);

  /* The spreadsheet: every order in the period, cancelled ones included and marked. */
  const rowNames = await names(repository, orders.filter((order) => inRange(order, from, now)).map((order) => order.buyerId));
  const rows = orders.filter((order) => inRange(order, from, now))
    .sort((a, b) => placedAt(b).localeCompare(placedAt(a)))
    .map((order) => {
      const money = orderMoney(order);
      return {
        date: placedAt(order),
        orderId: order.id,
        item: order.itemName,
        buyer: rowNames.get(order.buyerId)!.name,
        handle: rowNames.get(order.buyerId)!.handle,
        quantity: order.quantity,
        unitPriceMinor: order.unitPriceMinor,
        totalMinor: money.totalMinor,
        paidMinor: money.paidMinor,
        outstandingMinor: money.outstandingMinor,
        currency: order.currency,
        status: order.status,
        payment: order.paymentStatus,
        lot: lotName.get(order.lotId) ?? '',
      };
    });

  return json(200, {
    days,
    bucket,
    totals: sum(period),
    before: sum(before),
    series: [...series.values()],
    best: {
      units: [...itemRows].sort((a, b) => b.units - a.units).slice(0, 10),
      revenue: [...itemRows].sort((a, b) => b.revenueMinor - a.revenueMinor).slice(0, 10),
    },
    ageing: { fresh: band(0, 3), week: band(4, 7), old: band(8, Infinity), rows: ageing.slice(0, 40) },
    sources,
    stock,
    rows,
  });
}

/* ── Nudges ──────────────────────────────────────────────────────────────── */

type NudgeKind = 'payment' | 'checkout' | 'saved';

/**
 * POST /api/me/nudge - one friendly reminder to one buyer.
 *
 * Once a day per thing at most: a reminder that arrives every time a seller
 * taps a button is how a shop gets muted.
 */
async function nudge(request: HttpRequest, _context: InvocationContext) {
  const { user, repository, shopId } = await open(request);
  if (!shopId) return error(403, 'forbidden', 'You cannot message buyers for that shop.');

  let body: { kind?: NudgeKind; orderId?: string; listingId?: string; buyerId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const shop: User | null = await repository.getUserById(shopId);
  const shopName = shop?.sellerProfile?.storefrontName || shop?.displayName || 'A shop';

  let buyerId: string;
  let title: string;
  let text: string;
  let link: string;
  if (body.kind === 'payment' || body.kind === 'checkout') {
    const order = body.orderId ? await repository.getOrder(body.orderId) : null;
    if (!order || order.sellerId !== shopId) return error(404, 'not_found', 'No such order in this shop.');
    buyerId = order.buyerId;
    if (body.kind === 'payment') {
      const { outstandingMinor } = orderMoney(order);
      if (outstandingMinor <= 0) return error(409, 'nothing_due', 'Nothing is owed on that order.');
      title = `A reminder from ${shopName}`;
      text = `₹${(outstandingMinor / 100).toLocaleString('en-IN')} is still due on ${order.itemName}.`;
      link = `/order/${order.id}`;
    } else {
      if (order.placedAt) return error(409, 'already_placed', 'That checkout already became an order.');
      title = `${order.itemName} is still waiting for you`;
      text = `You pressed Buy at ${shopName} but did not finish. It is still there if you want it.`;
      link = `/listing/${order.listingId}`;
    }
  } else if (body.kind === 'saved') {
    const listing = body.listingId ? await repository.getListing(body.listingId) : null;
    if (!listing || listing.sellerId !== shopId || !body.buyerId) return error(404, 'not_found', 'No such item in this shop.');
    const saved = (await repository.listLikesForListings([listing.id])).some((like) => like.userId === body.buyerId);
    if (!saved) return error(404, 'not_found', 'They have not saved that item.');
    buyerId = body.buyerId;
    title = `${listing.title} - the one you saved`;
    text = listing.restockedAt ? `It is back in stock at ${shopName}.` : `It is on sale at ${shopName}.`;
    text += ` Now ₹${(listing.priceMinor / 100).toLocaleString('en-IN')}.`;
    link = `/listing/${listing.id}`;
  } else {
    return error(400, 'invalid_nudge', 'Say what the reminder is about.');
  }

  const recent = await repository.listNotifications(buyerId, 50);
  if (recent.some((row) => row.kind === 'seller_nudge' && row.link === link && Date.now() - Date.parse(row.createdAt) < DAY)) {
    return error(429, 'too_soon', 'They were reminded about this in the last day.');
  }
  await notify(repository, [buyerId], { kind: 'seller_nudge', title, body: text, link }, { except: user.id });
  return json(200, { sent: true });
}

export const costsRoute = handler(costs);
export const saveCostSheetRoute = handler(saveCostSheet);
export const deepRoute = handler(deep);
export const salesReportRoute = handler(sales);
export const nudgeRoute = handler(nudge);

app.http('me-costs', { authLevel: 'anonymous', methods: ['GET'], route: 'me/costs', handler: costsRoute });
app.http('me-cost-sheet', {
  authLevel: 'anonymous', methods: ['POST'], route: 'me/listings/{id}/cost-sheet', handler: saveCostSheetRoute,
});
app.http('me-deep', { authLevel: 'anonymous', methods: ['GET'], route: 'me/deep', handler: deepRoute });
app.http('me-sales-report', { authLevel: 'anonymous', methods: ['GET'], route: 'me/sales-report', handler: salesReportRoute });
app.http('me-nudge', { authLevel: 'anonymous', methods: ['POST'], route: 'me/nudge', handler: nudgeRoute });
