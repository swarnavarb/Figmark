import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { lotIsDone, lotPhase } from '../../../shared/fulfilment.js';
import { lotNo, lotNumberFrom } from '../../../shared/routes.js';
import { isCancelledLike } from '../../../shared/orders.js';
import type { Lot, PowerSale, User } from '../../../shared/models.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { advancePowerSale, finishesAt, firstDropAt, nextDropAt } from './power-sale.js';
import { error, handler, json } from './http.js';

/**
 * Two shelves on the Buy tab that sell an event rather than an item.
 *
 * Boxes filling up: a shop's lot still taking orders, with what can go in it
 * and how many people are already in. Joining a shared box is cheaper per
 * item and ships with everyone else's, and a box that fills sooner leaves
 * sooner - so the shelf is good for buyer and shop alike.
 *
 * Drops: a power sale from the moment its opening message is posted in the
 * shop's channel, counting down to the first item, with a "Remind me" that
 * notifies the buyer when it starts. Before the opening message a sale is the
 * shop's private plan, and nothing here says it exists.
 *
 * Both are honest by construction: the counts are the real counts, the clock
 * is the sale's own schedule, and an empty shelf is not drawn at all.
 */

/** No one shop fills a shelf: two of its boxes or drops at most. */
const PER_SHOP = 2;
const SHELF = 12;

function shopOf(user: User | undefined) {
  return {
    name: user?.sellerProfile?.storefrontName ?? user?.displayName ?? 'A shop',
    handle: user?.sellerProfile?.username ?? null,
  };
}

function capPerShop<T extends { sellerId: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.filter((row) => {
    const count = seen.get(row.sellerId) ?? 0;
    if (count >= PER_SHOP) return false;
    seen.set(row.sellerId, count + 1);
    return true;
  }).slice(0, SHELF);
}

/** GET /api/showcase/lots - lots still filling that something can be bought into. */
async function fillingLots(_request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const lots = (await repository.listLots()).filter((lot) => !lotIsDone(lot) && lotPhase(lot) === 'filling');

  const rows: {
    lot: Lot;
    listings: { id: string; title: string; priceMinor: number; currency: string; photoUrl: string | null }[];
    people: number;
    orders: number;
  }[] = [];
  for (const lot of lots) {
    // Only what a buyer can actually press Buy on: a box with nothing for
    // sale in it is a dead end on a shelf.
    const listings = (await repository.listListingsInLot(lot.id))
      .filter((listing) => listing.status === 'active' && !listing.unlisted && !listing.privateFor);
    if (listings.length === 0) continue;
    const orders = (await repository.listOrdersForLot(lot.id)).filter((order) => !isCancelledLike(order.status));
    rows.push({
      lot,
      listings: listings.slice(0, 6).map((listing) => ({
        id: listing.id,
        title: listing.title,
        priceMinor: listing.priceMinor,
        currency: listing.currency,
        photoUrl: (listing.photos.find((photo) => photo.isPrimary) ?? listing.photos[0])?.url || null,
      })),
      people: new Set(orders.map((order) => order.buyerId)).size,
      orders: orders.length,
    });
  }

  // Busiest first: a box with people in it is the stronger invitation.
  rows.sort((a, b) => b.people - a.people || b.lot.createdAt.localeCompare(a.lot.createdAt));
  const picked = capPerShop(rows.map((row) => ({ ...row, sellerId: row.lot.sellerId })));
  const shops = new Map((await repository.listUsersByIds([...new Set(picked.map((row) => row.sellerId))]))
    .map((user) => [user.id, user]));

  return json(200, {
    lots: picked.map(({ lot, listings, people, orders }) => ({
      id: lot.id,
      name: lot.name,
      number: lotNo(lot.lotNumber) ?? lotNumberFrom(lot.id, lot.createdAt),
      sellerId: lot.sellerId,
      shop: shopOf(shops.get(lot.sellerId)),
      originCountry: lot.originCountry ?? null,
      destinationCountry: lot.destinationCountry ?? null,
      closesAround: lot.estimatedDispatchAt,
      people,
      orders,
      listings,
    })),
  });
}

/** A sale as the shelf and the channel's countdown draw it. */
function dropView(sale: PowerSale, shop: User | undefined, viewerId: string | null) {
  const out = sale.items.filter((item) => item.postedAt).length;
  const startsAt = firstDropAt(sale);
  return {
    id: sale.id,
    sellerId: sale.sellerId,
    shop: shopOf(shop),
    name: sale.name,
    message: sale.openingBody,
    openedAt: sale.openedAt,
    startsAt,
    live: out > 0,
    nextAt: nextDropAt(sale),
    endsAt: finishesAt(sale),
    itemCount: sale.items.length,
    itemsOut: out,
    // A taste of what is coming: names and prices, never the photos of items
    // not yet dropped - the reveal is the shop's to make in the channel.
    preview: sale.items.slice(0, 4).map((item) => ({
      title: item.title,
      priceMinor: item.priceMinor,
      listPriceMinor: item.listPriceMinor,
      out: Boolean(item.postedAt),
    })),
    reminders: (sale.reminders ?? []).length,
    reminded: viewerId ? (sale.reminders ?? []).includes(viewerId) : false,
    channel: `/social/c/${encodeURIComponent(sale.sellerId)}`,
  };
}

/**
 * Every live sale nudged to where its clock says, so a sale due to open
 * appears on the shelf the moment anyone looks - not only once the minute
 * timer next runs.
 */
async function liveSales(repository: Awaited<ReturnType<typeof getRepository>>): Promise<PowerSale[]> {
  const live = await repository.listLivePowerSales();
  const advanced: PowerSale[] = [];
  for (const sale of live) {
    try {
      advanced.push(await advancePowerSale(repository, sale));
    } catch {
      advanced.push(sale);
    }
  }
  return advanced;
}

/** GET /api/showcase/drops - sales announced in a channel and not yet over. */
async function drops(request: HttpRequest, _context: InvocationContext) {
  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const viewer = await auth.getCurrentUser(request);
  const shown = (await liveSales(repository))
    .filter((sale) => sale.openedAt && sale.status === 'running')
    // Soonest to start first; live ones (already started) ahead of all.
    .sort((a, b) => firstDropAt(a).localeCompare(firstDropAt(b)));
  const picked = capPerShop(shown);
  const shops = new Map((await repository.listUsersByIds([...new Set(picked.map((sale) => sale.sellerId))]))
    .map((user) => [user.id, user]));
  return json(200, { drops: picked.map((sale) => dropView(sale, shops.get(sale.sellerId), viewer?.id ?? null)) });
}

/** GET /api/showcase/drops/{sellerId}/{id} - one, for the channel's countdown. */
async function drop(request: HttpRequest, _context: InvocationContext) {
  const { sellerId, id } = request.params;
  if (!sellerId || !id) return error(400, 'invalid_request', 'A sale is required.');
  const [repository, auth] = await Promise.all([getRepository(), getAuthService()]);
  const viewer = await auth.getCurrentUser(request);
  const sale = await repository.getPowerSale(sellerId, id);
  if (!sale || !sale.openedAt) return error(404, 'not_found', 'No such drop.');
  const shop = await repository.getUserById(sellerId);
  return json(200, { drop: dropView(sale, shop ?? undefined, viewer?.id ?? null) });
}

/**
 * POST /api/showcase/drops/{sellerId}/{id}/remind - be told when it starts,
 * or stop being told. `{ on: false }` takes the reminder off.
 */
async function remind(request: HttpRequest, _context: InvocationContext) {
  const { sellerId, id } = request.params;
  if (!sellerId || !id) return error(400, 'invalid_request', 'A sale is required.');
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  let body: { on?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  const repository = await getRepository();
  const sale = await repository.getPowerSale(sellerId, id);
  if (!sale || !sale.openedAt || sale.status !== 'running') return error(404, 'not_found', 'That drop is not on.');
  if (sale.items.some((item) => item.postedAt)) {
    return error(409, 'already_live', 'It has already started - head to the channel.');
  }
  const on = body.on !== false;
  const others = (sale.reminders ?? []).filter((who) => who !== user.id);
  const saved = await repository.savePowerSale({
    ...sale,
    reminders: on ? [...others, user.id] : others,
    updatedAt: new Date().toISOString(),
  });
  const shop = await repository.getUserById(sellerId);
  return json(200, { drop: dropView(saved, shop ?? undefined, user.id) });
}

export const fillingLotsRoute = handler(fillingLots);
export const dropsRoute = handler(drops);
export const dropRoute = handler(drop);
export const remindRoute = handler(remind);

const anon = { authLevel: 'anonymous' } as const;

app.http('showcase-lots', { ...anon, methods: ['GET'], route: 'showcase/lots', handler: fillingLotsRoute });
app.http('showcase-drops', { ...anon, methods: ['GET'], route: 'showcase/drops', handler: dropsRoute });
app.http('showcase-drop', { ...anon, methods: ['GET'], route: 'showcase/drops/{sellerId}/{id}', handler: dropRoute });
app.http('showcase-remind', {
  ...anon, methods: ['POST'], route: 'showcase/drops/{sellerId}/{id}/remind', handler: remindRoute,
});
