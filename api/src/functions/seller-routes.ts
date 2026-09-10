import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { LOT_STAGES, LOT_STAGE_LABELS, STORE_PERMISSIONS, type StorePermission } from '../../../shared/enums.js';
import type { SellerProfile } from '../../../shared/models.js';
import { accessFor, can, managerEntry, type StoreAccess } from '../../../shared/stores.js';
import { USERNAME_PROBLEMS, checkUsername, suggestUsername } from '../../../shared/handles.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * The seller's own side of the app: storefront, tracking, analytics.
 *
 * Everything here is scoped to the signed-in account by construction - the id
 * comes from the session, never from the request - so there is no way to read
 * or edit another seller's storefront or numbers through these.
 */

/** A slug that survives being in a URL, derived from the storefront name. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'storefront'
  );
}

/**
 * Accept only a link that is safe to render as one.
 *
 * `javascript:` and `data:` URLs in an href are the classic stored-XSS vector,
 * and this value is shown on a public storefront, so the scheme is checked here
 * rather than trusted and patched over in the client.
 */
function safeLink(raw: string | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** GET /api/me/storefront - the storefront as it stands, blank profile included. */
async function getStorefront(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const record = await repository.getUserById(user.id);
  if (!record) return error(404, 'not_found', 'This account no longer exists.');

  return json(200, {
    storefront: record.sellerProfile,
    displayName: record.displayName,
  });
}

/**
 * POST /api/me/storefront - design the storefront.
 *
 * Creates the profile on first save rather than requiring a separate "become a
 * seller" step: an account is a seller the moment it has a storefront, which is
 * the same rule listing something already follows.
 */
async function updateStorefront(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);

  let body: {
    storefrontName?: string;
    username?: string;
    bio?: string;
    dispatchRegion?: string;
    photoUrl?: string;
    coverUrl?: string;
    tags?: string[];
    link?: string;
    payment?: {
      upiId?: string;
      accountName?: string;
      accountNumber?: string;
      ifsc?: string;
      instructions?: string;
    } | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const record = await repository.getUserById(user.id);
  if (!record) return error(404, 'not_found', 'This account no longer exists.');

  const existing: SellerProfile = record.sellerProfile ?? {
    storefrontSlug: slugify(body.storefrontName ?? record.displayName),
    storefrontName: record.displayName,
    bio: '',
    tier: 'unverified',
    openLotCap: 1,
    depositHeldMinor: 0,
    dispatchRegion: '',
    followerCount: 0,
    photoUrl: null,
    link: null,
  };

  // The shop's own handle, out of the same namespace as people's: a store is
  // addressed and messaged as itself, not as whoever owns it.
  const wanted = (body.username ?? existing.username ?? suggestUsername(body.storefrontName ?? existing.storefrontName))
    .trim()
    .toLowerCase();
  if (wanted !== existing.username) {
    const problem = checkUsername(wanted);
    if (problem) return error(400, 'invalid_storefront', USERNAME_PROBLEMS[problem]);
    if (!(await repository.reserveHandle(wanted, record.id, true))) {
      return error(409, 'username_taken', `@${wanted} is already taken.`);
    }
    // Only after the new one is safely held: a rename that frees the old handle
    // first can lose both if the new one turns out to be taken.
    if (existing.username) await repository.releaseHandle(existing.username);
    existing.username = wanted;
  }

  if (body.storefrontName !== undefined) {
    const name = body.storefrontName.trim();
    if (!name) return error(400, 'invalid_storefront', 'A storefront needs a name.');
    existing.storefrontName = name;
    // The slug follows the name only while nobody has linked to it yet, which
    // for now is always - a stable public URL is a separate promise to make.
    existing.storefrontSlug = slugify(name);
  }
  if (body.bio !== undefined) existing.bio = body.bio.trim().slice(0, 600);
  if (body.dispatchRegion !== undefined) existing.dispatchRegion = body.dispatchRegion.trim();
  if (body.photoUrl !== undefined) {
    const photo = safeLink(body.photoUrl);
    if (photo === undefined) return error(400, 'invalid_storefront', 'The photo link is not a valid http(s) URL.');
    existing.photoUrl = photo;
  }
  if (body.link !== undefined) {
    const link = safeLink(body.link);
    if (link === undefined) return error(400, 'invalid_storefront', 'That link is not a valid http(s) URL.');
    existing.link = link;
  }
  if (body.coverUrl !== undefined) {
    const cover = safeLink(body.coverUrl);
    if (cover === undefined) return error(400, 'invalid_storefront', 'The banner link is not a valid http(s) URL.');
    existing.coverUrl = cover;
  }
  if (body.tags !== undefined) {
    // Six, short, deduplicated. A row of chips is scanned; twenty of them is a
    // wall, and a wall is skipped.
    existing.tags = [...new Set(body.tags.map((tag) => tag.trim()).filter(Boolean))]
      .map((tag) => tag.slice(0, 24))
      .slice(0, 6);
  }
  if (body.payment !== undefined) {
    // Carried as typed. The platform does not move this money and cannot
    // verify an account exists, so validating the shape of it would only
    // suggest it had checked something. Length is capped; nothing else.
    const trim = (value: string | undefined) => (value ?? '').trim().slice(0, 120) || null;
    const payment = body.payment
      ? {
          upiId: trim(body.payment.upiId),
          accountName: trim(body.payment.accountName),
          accountNumber: trim(body.payment.accountNumber),
          ifsc: trim(body.payment.ifsc),
          instructions: (body.payment.instructions ?? '').trim().slice(0, 400) || null,
        }
      : null;
    existing.payment = payment && Object.values(payment).some(Boolean) ? payment : null;
  }

  record.sellerProfile = existing;
  record.updatedAt = new Date().toISOString();
  const saved = await repository.updateUser(record);
  return json(200, { storefront: saved.sellerProfile });
}

/**
 * GET /api/me/dashboard - what is moving, and how the shop is doing.
 *
 * Both dashboards in one call because they are one screen and read the same
 * rows: splitting them would double the work to render them side by side.
 */
async function dashboard(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const [orders, listings, lots] = await Promise.all([
    repository.listOrdersForSeller(user.id),
    repository.listListings({ sellerId: user.id }),
    repository.listLots({ sellerId: user.id }),
  ]);

  /* Tracking: what is in flight, grouped by the stage it is sitting at. */
  const byStage = LOT_STAGES.map((stage) => ({
    stage,
    label: LOT_STAGE_LABELS[stage],
    lots: lots.filter((lot) => lot.stage === stage).length,
  }));

  const openLots = lots.filter((lot) => lot.status === 'open');
  const inFlight = orders.filter((order) => order.status !== 'delivered' && order.status !== 'cancelled');

  /* Analytics: the numbers a seller checks, and nothing they cannot act on. */
  const revenueMinor = orders
    .filter((order) => order.status !== 'cancelled')
    .reduce((sum, order) => sum + order.quantity * order.unitPriceMinor, 0);
  const unitsSold = orders
    .filter((order) => order.status !== 'cancelled')
    .reduce((sum, order) => sum + order.quantity, 0);
  const views = listings.reduce((sum, listing) => sum + listing.viewCount, 0);
  const saves = listings.reduce((sum, listing) => sum + listing.likeCount, 0);

  // Thirty days of orders, so the shape of the last month is visible rather
  // than just its total.
  const dayMs = 86_400_000;
  const start = Date.now() - 29 * dayMs;
  const daily = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(start + index * dayMs);
    const key = day.toISOString().slice(0, 10);
    const onDay = orders.filter((order) => order.createdAt.slice(0, 10) === key && order.status !== 'cancelled');
    return {
      date: key,
      orders: onDay.length,
      revenueMinor: onDay.reduce((sum, order) => sum + order.quantity * order.unitPriceMinor, 0),
    };
  });

  // The items actually earning their place in the storefront.
  const topListings = [...listings]
    .map((listing) => ({
      id: listing.id,
      title: listing.title,
      viewCount: listing.viewCount,
      likeCount: listing.likeCount,
      unitsSold: orders
        .filter((order) => order.listingId === listing.id && order.status !== 'cancelled')
        .reduce((sum, order) => sum + order.quantity, 0),
    }))
    .sort((a, b) => b.unitsSold - a.unitsSold || b.viewCount - a.viewCount)
    .slice(0, 5);

  return json(200, {
    tracking: {
      openLots: openLots.length,
      inFlightOrders: inFlight.length,
      byStage: byStage.filter((row) => row.lots > 0),
      lots: openLots.map((lot) => ({
        id: lot.id,
        name: lot.name,
        stage: lot.stage,
        origin: lot.origin ?? '',
        estimatedDispatchAt: lot.estimatedDispatchAt,
        orderCount: orders.filter((order) => order.lotId === lot.id).length,
      })),
    },
    analytics: {
      revenueMinor,
      unitsSold,
      orderCount: orders.filter((order) => order.status !== 'cancelled').length,
      activeListings: listings.length,
      views,
      saves,
      // Views to orders. Zero views means no rate rather than a divide by zero.
      conversion: views > 0 ? unitsSold / views : 0,
      daily,
      topListings,
    },
  });
}

/**
 * GET /api/me/sales - orders waiting on the seller, and the ones just settled.
 *
 * A direct sale ends with the seller checking their own bank and saying whether
 * the money arrived. That is a job, not a notification, so it gets a queue: what
 * is waiting on them first, then what they have already answered, so a decision
 * they regret is at least visible afterwards.
 */
async function sales(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const storeId = request.query.get('store') ?? user.id;
  // A manager acts in the shop, so the shop's orders are the ones they answer -
  // but only where the store has actually granted them that.
  if (storeId !== user.id) {
    const owner = await repository.getUserById(storeId);
    // Answering for the money is an owner's decision, so it rides on `admin`
    // rather than on the rights that only cover stock and shipping.
    if (!owner || !can(owner, user.id, 'admin')) {
      return error(403, 'forbidden', 'You do not have rights to answer payments in this shop.');
    }
  }

  const orders = await repository.listOrdersForSeller(storeId);
  const buyers = new Map<string, string>();
  for (const order of orders) {
    if (buyers.has(order.buyerId)) continue;
    const buyer = await repository.getUserById(order.buyerId);
    buyers.set(order.buyerId, buyer?.displayName ?? 'Someone');
  }

  const row = (order: (typeof orders)[number]) => ({
    id: order.id,
    itemName: order.itemName,
    quantity: order.quantity,
    totalMinor: order.unitPriceMinor * order.quantity,
    currency: order.currency,
    buyerName: buyers.get(order.buyerId) ?? 'Someone',
    paymentStatus: order.paymentStatus,
    claim: order.paymentClaim ?? null,
    createdAt: order.createdAt,
  });

  const waiting = orders.filter((order) => order.paymentStatus === 'claimed');
  const answered = orders
    .filter((order) => order.paymentClaim?.decision)
    .sort((a, b) => (b.paymentClaim!.decidedAt ?? '').localeCompare(a.paymentClaim!.decidedAt ?? ''))
    .slice(0, 10);

  return json(200, {
    waiting: waiting
      .sort((a, b) => (a.paymentClaim?.claimedAt ?? '').localeCompare(b.paymentClaim?.claimedAt ?? ''))
      .map(row),
    answered: answered.map(row),
  });
}

/**
 * GET /api/me/stores - every store this account may act in.
 *
 * Their own if they have opened one, plus any they have been given rights in.
 * The sell tab asks this first: with nothing here, the only thing to offer is
 * opening a store.
 */
async function myStores(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const mine = await repository.getUserById(user.id);
  const stores: StoreAccess[] = [];

  if (mine?.sellerProfile) {
    const access = accessFor(mine, user.id);
    if (access) stores.push(access);
  }

  // Stores that named this account as a manager. A scan of stores rather than
  // an index: a person manages a handful, and the alternative is a second
  // container to keep in step with the membership list itself.
  for (const owner of await repository.listStoreOwners()) {
    if (owner.id === user.id) continue;
    const access = accessFor(owner, user.id);
    if (access) stores.push(access);
  }

  return json(200, { stores });
}

/**
 * POST /api/me/storefront/managers - add, change or remove someone.
 *
 * Only an admin may hand out access, and only the owner is beyond removal: a
 * store that can be left with nobody able to administer it is a store somebody
 * eventually locks themselves out of.
 */
async function updateManagers(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);

  let body: { storeId?: string; identifier?: string; permissions?: StorePermission[]; remove?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const owner = await repository.getUserById(body.storeId ?? user.id);
  if (!owner?.sellerProfile) return error(404, 'not_found', 'No such store.');
  if (!can(owner, user.id, 'admin')) {
    return error(403, 'forbidden', 'Only a store admin can change who manages it.');
  }

  const identifier = body.identifier?.trim();
  if (!identifier) return error(400, 'invalid_manager', 'Name the person by email or phone.');

  const member = await repository.getUserByIdentifier(identifier);
  if (!member) return error(404, 'not_found', 'Nobody here with that email or phone.');
  if (member.id === owner.id) {
    return error(400, 'invalid_manager', 'The owner already administers this store.');
  }

  const existing = owner.sellerProfile.managers ?? [];
  if (body.remove) {
    owner.sellerProfile.managers = existing.filter((entry) => entry.userId !== member.id);
  } else {
    const permissions = (body.permissions ?? []).filter((value) => STORE_PERMISSIONS.includes(value));
    if (permissions.length === 0) {
      return error(400, 'invalid_manager', 'Give them at least one thing they may do.');
    }
    owner.sellerProfile.managers = [
      ...existing.filter((entry) => entry.userId !== member.id),
      managerEntry(member.id, member.displayName, permissions, user.id),
    ];
  }

  owner.updatedAt = new Date().toISOString();
  const saved = await repository.updateUser(owner);
  return json(200, { managers: saved.sellerProfile?.managers ?? [] });
}

export const myStoresRoute = handler(myStores);
export const updateManagersRoute = handler(updateManagers);
export const storefrontRoute = handler(getStorefront);
export const updateStorefrontRoute = handler(updateStorefront);
export const dashboardRoute = handler(dashboard);
export const salesRoute = handler(sales);

const anon = { authLevel: 'anonymous' } as const;

app.http('me-storefront', { ...anon, methods: ['GET'], route: 'me/storefront', handler: storefrontRoute });
app.http('me-storefront-save', { ...anon, methods: ['POST'], route: 'me/storefront/save', handler: updateStorefrontRoute });
app.http('me-dashboard', { ...anon, methods: ['GET'], route: 'me/dashboard', handler: dashboardRoute });
app.http('me-sales', { ...anon, methods: ['GET'], route: 'me/sales', handler: salesRoute });
app.http('me-stores', { ...anon, methods: ['GET'], route: 'me/stores', handler: myStoresRoute });
app.http('me-store-managers', { ...anon, methods: ['POST'], route: 'me/storefront/managers', handler: updateManagersRoute });
