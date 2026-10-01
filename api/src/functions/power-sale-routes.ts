import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { CONDITION_TAGS, type ConditionTag } from '../../../shared/enums.js';
import { cleanCostSheet } from '../../../shared/profit.js';
import { CATEGORIES } from '../../../shared/catalog.js';
import type { PowerSale, PowerSaleItem } from '../../../shared/models.js';
import { can } from '../../../shared/stores.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import {
  MAX_SALE_ITEMS,
  MIN_EVERY_MINUTES,
  MIN_WINDOW_MINUTES,
  advanceAll,
  advancePowerSale,
  finishesAt,
  releaseItems,
  tickPowerSales,
  windowLeftMinutes,
} from './power-sale.js';

/**
 * Power selling: a sale a shop schedules once and does not have to sit through.
 *
 * The console half, plus the once-a-minute clock at the bottom. The runner is
 * in power-sale.ts; the console calls it before answering too, so what it
 * shows is never a minute behind.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** The shop being acted in, and whether this account may act in it. */
async function shopFor(
  request: HttpRequest,
  repository: Repo,
  userId: string,
): Promise<{ sellerId: string } | { refusal: ReturnType<typeof error> }> {
  const wanted = request.query.get('store') ?? (await bodyStore(request)) ?? userId;
  if (wanted === userId) {
    const mine = await repository.getUserById(userId);
    if (!mine?.sellerProfile) {
      return { refusal: error(409, 'no_storefront', 'Open a storefront first.') };
    }
    return { sellerId: userId };
  }

  const owner = await repository.getUserById(wanted);
  if (!owner?.sellerProfile) return { refusal: error(404, 'not_found', 'No such store.') };
  // Running a sale posts in the shop's name and prices its stock, so it rides
  // on the two rights that cover exactly those things.
  if (!can(owner, userId, 'posts') || !can(owner, userId, 'listings')) {
    return { refusal: error(403, 'forbidden', 'You cannot run sales in that shop.') };
  }
  return { sellerId: owner.id };
}

/**
 * The store id from a JSON body, read without consuming the body twice.
 *
 * Memoised rather than method-gated: a request body can only be read once, and
 * both the shop lookup and the handler want it. Checking the method first
 * looked tidier and quietly broke every call whose request object did not carry
 * one, which is every call in the test harness.
 */
const bodies = new WeakMap<HttpRequest, Record<string, unknown>>();
async function bodyStore(request: HttpRequest): Promise<string | undefined> {
  if (!bodies.has(request)) {
    try {
      bodies.set(request, (await request.json()) as Record<string, unknown>);
    } catch {
      bodies.set(request, {});
    }
  }
  const value = bodies.get(request)!.storeId;
  return typeof value === 'string' ? value : undefined;
}

async function readBody(request: HttpRequest): Promise<Record<string, unknown>> {
  await bodyStore(request);
  return bodies.get(request) ?? {};
}

/** One sale, as the console draws it. */
function card(sale: PowerSale, now = new Date()) {
  const posted = sale.items.filter((item) => item.postedAt).length;
  return {
    id: sale.id,
    name: sale.name,
    status: sale.status,
    openingBody: sale.openingBody,
    openingAt: sale.openingAt,
    leadMinutes: sale.leadMinutes ?? 0,
    everyMinutes: sale.everyMinutes,
    windowMinutes: sale.windowMinutes,
    closingBody: sale.closingBody,
    openedAt: sale.openedAt,
    closedAt: sale.closedAt,
    afterWindow: sale.afterWindow ?? { channel: false, feed: false },
    /** When the last item hands over and the whole run is public. */
    finishesAt: finishesAt(sale),
    posted,
    total: sale.items.length,
    items: sale.items.map((item) => ({
      id: item.id,
      title: item.title,
      priceMinor: item.priceMinor,
      listPriceMinor: item.listPriceMinor,
      quantity: item.quantity,
      allowMultiple: item.allowMultiple,
      postedAt: item.postedAt,
      windowEndsAt: item.windowEndsAt,
      liftedAt: item.liftedAt,
      listingId: item.listingId,
      /** Minutes of members' price left, so the console never has to guess. */
      windowLeft: windowLeftMinutes(item, now),
    })),
    createdAt: sale.createdAt,
  };
}

/** GET /api/power-sales - a shop's runs, advanced to where the clock says. */
async function list(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  const shop = await shopFor(request, repository, user.id);
  if ('refusal' in shop) return shop.refusal;

  const sales = await advanceAll(repository, shop.sellerId);
  return json(200, { sales: sales.map((sale) => card(sale)) });
}

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function positive(value: unknown, fallback: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** One item as the builder submits it, refused rather than repaired. */
function readItem(raw: unknown): { item: PowerSaleItem } | { why: string } {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const title = trimmed(entry.title, 120);
  if (!title) return { why: 'Every item needs a title.' };

  const priceMinor = positive(entry.priceMinor, 0);
  if (priceMinor <= 0) return { why: `${title} needs a members' price.` };

  // The public price is what it moves to when the window shuts. The same
  // number is fine - no discount, it just goes public - but never lower.
  const listPriceMinor = positive(entry.listPriceMinor, 0) || priceMinor;
  if (listPriceMinor < priceMinor) {
    return { why: `${title}: the price after the window can't be below the members' price.` };
  }

  const category = trimmed(entry.category, 40);
  const condition = trimmed(entry.condition, 10);

  return {
    item: {
      id: `psi_${randomUUID().slice(0, 10)}`,
      title,
      description: trimmed(entry.description, 600),
      category: (CATEGORIES as readonly string[]).includes(category) ? category : 'Collectibles',
      condition: (CONDITION_TAGS as readonly string[]).includes(condition)
        ? (condition as ConditionTag)
        : 'MISB',
      priceMinor,
      listPriceMinor,
      quantity: Math.min(999, positive(entry.quantity, 1)),
      allowMultiple: entry.allowMultiple === true,
      postedAt: null,
      windowEndsAt: null,
      liftedAt: null,
      listingId: null,
      costSheet: (() => {
        try {
          return cleanCostSheet(entry.costSheet, new Date().toISOString());
        } catch {
          return null;
        }
      })(),
      ...listingOptions(entry),
    },
  };
}

/**
 * The sell page's own options for one item - photos, tags, where it ships
 * from, stock, expiry, advance - read the same way the listing route reads
 * them, so an item from a sale is listed exactly as one listed by hand.
 */
function listingOptions(entry: Record<string, unknown>): Partial<PowerSaleItem> {
  const photos = (Array.isArray(entry.photos) ? entry.photos : [])
    .slice(0, 6)
    .map((raw) => (raw ?? {}) as Record<string, unknown>)
    .map((photo) => ({
      blobName: typeof photo.blobName === 'string' ? photo.blobName : '',
      url: typeof photo.url === 'string' ? photo.url : '',
      imageHash: null,
      isPrimary: photo.isPrimary === true,
    }))
    .filter((photo) => photo.blobName || photo.url);
  if (photos.length > 0 && !photos.some((photo) => photo.isPrimary)) photos[0]!.isPrimary = true;

  const tags = (Array.isArray(entry.tags) ? entry.tags : [])
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 12);

  const expires = typeof entry.expiresAt === 'string' ? new Date(entry.expiresAt) : null;
  const advance = Math.round(Number(entry.advancePercent) || 0);
  return {
    photos,
    tags,
    sourcing: entry.sourcing === 'import' ? 'import' : 'in_hand',
    quantityMode: entry.quantityMode === 'multiple' ? 'multiple' : 'fixed',
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null,
    advancePercent: advance > 0 && advance < 100 ? advance : null,
    lotId: typeof entry.lotId === 'string' && entry.lotId ? entry.lotId : null,
    limitedDays: Math.min(365, Math.max(0, Math.round(Number(entry.limitedDays) || 0))) || null,
  };
}

/**
 * POST /api/power-sales - schedule a run.
 *
 * Written whole rather than assembled a field at a time: a half-configured sale
 * that starts posting is worse than no sale, and every knob here changes what
 * lands in somebody's channel.
 */
async function create(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  const shop = await shopFor(request, repository, user.id);
  if ('refusal' in shop) return shop.refusal;
  const body = await readBody(request);

  const openingBody = trimmed(body.openingBody, 600);
  if (!openingBody) return error(400, 'invalid_sale', 'Write the message that opens the sale.');

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) return error(400, 'invalid_sale', 'Add at least one item to sell.');
  if (rawItems.length > MAX_SALE_ITEMS) {
    return error(400, 'invalid_sale', `A run carries at most ${MAX_SALE_ITEMS} items.`);
  }

  const items: PowerSaleItem[] = [];
  for (const raw of rawItems) {
    const read = readItem(raw);
    if ('why' in read) return error(400, 'invalid_sale', read.why);
    // A lot has to be one of the shop's own; another shop's id does not resolve.
    if (read.item.lotId && !(await repository.getLot(shop.sellerId, read.item.lotId))) {
      return error(404, 'not_found', `${read.item.title}: no such lot of yours.`);
    }
    items.push(read.item);
  }

  const now = new Date();
  const openingAt = typeof body.openingAt === 'string' && Date.parse(body.openingAt)
    ? new Date(body.openingAt).toISOString()
    // "Post immediately" is a time, not a mode: one less branch everywhere
    // downstream, and a sale that starts now is a sale whose opening time is
    // now.
    : now.toISOString();

  const sale: PowerSale = {
    id: `pws_${randomUUID().slice(0, 12)}`,
    sellerId: shop.sellerId,
    name: trimmed(body.name, 80) || 'Channel sale',
    status: 'scheduled',
    openingBody,
    openingAt,
    leadMinutes: Math.max(0, Math.min(1440, Math.round(Number(body.leadMinutes) || 0))),
    everyMinutes: Math.max(MIN_EVERY_MINUTES, positive(body.everyMinutes, 5)),
    windowMinutes: Math.max(MIN_WINDOW_MINUTES, positive(body.windowMinutes, 60)),
    closingBody: trimmed(body.closingBody, 600),
    items,
    openedAt: null,
    closedAt: null,
    // Announced when each item goes public, unless the shop said not to.
    afterWindow: {
      channel: (body.afterWindow as { channel?: unknown } | undefined)?.channel !== false,
      feed: (body.afterWindow as { feed?: unknown } | undefined)?.feed !== false,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const saved = await repository.savePowerSale(sale);
  // Starting now means starting now: the first pass runs here rather than
  // waiting for whoever next opens the console.
  return json(201, { sale: card(await advancePowerSale(repository, saved)) });
}

/** GET /api/power-sales/{id} - one run, advanced. */
async function read(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  const shop = await shopFor(request, repository, user.id);
  if ('refusal' in shop) return shop.refusal;

  const id = request.params.id;
  const sale = id ? await repository.getPowerSale(shop.sellerId, id) : null;
  if (!sale) return error(404, 'not_found', 'No such sale.');

  return json(200, { sale: card(await advancePowerSale(repository, sale)) });
}

/**
 * POST /api/power-sales/{id}/stop - call it off.
 *
 * Whatever has already been posted stays posted. A shop can stop a sale; it
 * cannot un-say things in a room people were reading.
 */
async function stop(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  const shop = await shopFor(request, repository, user.id);
  if ('refusal' in shop) return shop.refusal;

  const id = request.params.id;
  const sale = id ? await repository.getPowerSale(shop.sellerId, id) : null;
  if (!sale) return error(404, 'not_found', 'No such sale.');
  if (sale.status === 'done' || sale.status === 'cancelled') {
    return error(409, 'already_over', 'That sale is already over.');
  }

  // Whatever it already dropped goes to the catalog rather than being stranded
  // out of it, priced for a window that will never close.
  await releaseItems(repository, sale);

  const now = new Date().toISOString();
  sale.status = 'cancelled';
  sale.closedAt = now;
  sale.updatedAt = now;
  return json(200, { sale: card(await repository.savePowerSale(sale)) });
}

export const powerSalesRoute = handler(list);
export const powerSaleCreateRoute = handler(create);
export const powerSaleReadRoute = handler(read);
export const powerSaleStopRoute = handler(stop);

const anon = { authLevel: 'anonymous' } as const;

app.http('power-sales', { ...anon, methods: ['GET'], route: 'power-sales', handler: powerSalesRoute });
app.http('power-sale-create', { ...anon, methods: ['POST'], route: 'power-sales/new', handler: powerSaleCreateRoute });
app.http('power-sale-read', { ...anon, methods: ['GET'], route: 'power-sales/{id}', handler: powerSaleReadRoute });
app.http('power-sale-stop', { ...anon, methods: ['POST'], route: 'power-sales/{id}/stop', handler: powerSaleStopRoute });

/**
 * The clock: every minute, every live sale moves to where it should be.
 *
 * The console still advances what it reads, so a seller watching sees the next
 * item the moment it is due; this is what moves it when nobody is watching.
 */
app.timer('power-sale-clock', {
  schedule: '0 */1 * * * *',
  handler: async (_timer, context) => {
    const touched = await tickPowerSales(await getRepository());
    if (touched > 0) context.log(`power-sale-clock: advanced ${touched} live sale(s)`);
  },
});
