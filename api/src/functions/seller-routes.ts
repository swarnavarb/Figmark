import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { LOT_STAGES, LOT_STAGE_LABELS, STORE_PERMISSIONS, type StorePermission } from '../../../shared/enums.js';
import type { Lot, SellerProfile } from '../../../shared/models.js';
import { awaitingLot, inLot, isDirect } from '../../../shared/fulfilment.js';
import { currentStepOf, lotNumberFrom, routeOf } from '../../../shared/routes.js';
import { accessFor, can, managerEntry, type StoreAccess } from '../../../shared/stores.js';
import { actionsFor, disputeSubjects, isCancelledLike } from '../../../shared/orders.js';
import { creditIsLive, creditLeft, orderMoney } from '../../../shared/payments.js';
import { USERNAME_PROBLEMS, checkUsername, suggestUsername } from '../../../shared/handles.js';
import { personRef } from '../../../shared/parties.js';
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
  const inFlight = orders.filter((order) => order.status !== 'delivered' && !isCancelledLike(order.status));

  /* Analytics: the numbers a seller checks, and nothing they cannot act on. */
  const revenueMinor = orders
    .filter((order) => !isCancelledLike(order.status))
    .reduce((sum, order) => sum + order.quantity * order.unitPriceMinor, 0);
  const unitsSold = orders
    .filter((order) => !isCancelledLike(order.status))
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
    const onDay = orders.filter((order) => order.createdAt.slice(0, 10) === key && !isCancelledLike(order.status));
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
        .filter((order) => order.listingId === listing.id && !isCancelledLike(order.status))
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
      orderCount: orders.filter((order) => !isCancelledLike(order.status)).length,
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
  const buyers = new Map<string, ReturnType<typeof personRef>>();
  for (const order of orders) {
    if (buyers.has(order.buyerId)) continue;
    buyers.set(order.buyerId, personRef(await repository.getUserById(order.buyerId)));
  }

  /* Every lot these orders ride in, read once rather than per row: a shop
     with forty orders in three lots should not make forty lookups to put
     three numbers on cards. */
  const lots = new Map<string, Lot | null>();
  for (const order of orders) {
    if (!inLot(order) || lots.has(order.lotId)) continue;
    lots.set(order.lotId, await repository.getLot(storeId, order.lotId));
  }

  /* The listings behind the orders still waiting for a lot, so the "add to a
     lot" screen can pre-select the route the Quick Post template set up for
     them. One query for the shop rather than one per order. */
  const listings = new Map(
    (await repository.listListings({ sellerId: storeId, includeHidden: true }))
      .map((listing) => [listing.id, listing]),
  );

  const row = (order: (typeof orders)[number]) => {
    const lot = inLot(order) ? lots.get(order.lotId) ?? null : null;
    const listing = listings.get(order.listingId);
    const photo = listing?.photos.find((entry) => entry.isPrimary) ?? listing?.photos[0] ?? null;
    const money = orderMoney(order);
    return {
      photoUrl: photo?.url ?? null,
      paidMinor: money.paidMinor,
      outstandingMinor: money.outstandingMinor,
      creditMinor: money.creditMinor,
      id: order.id,
      itemName: order.itemName,
      quantity: order.quantity,
      totalMinor: order.unitPriceMinor * order.quantity,
      currency: order.currency,
      buyer: buyers.get(order.buyerId) ?? personRef(null),
      paymentStatus: order.paymentStatus,
      status: order.status,
      claim: order.paymentClaim ?? null,
      createdAt: order.createdAt,
      /* Everything the order card shows, so one screen answers "where is this
         and what does it need" without opening anything. */
      escrowState: order.escrow.state,
      /** A domestic sale is in hand by definition: there is nothing to import. */
      inHand: isDirect(order),
      awaitingLot: awaitingLot(order),
      lotId: lot?.id ?? null,
      lotName: lot?.name ?? null,
      lotNumber: lot ? lot.lotNumber ?? lotNumberFrom(lot.id, lot.createdAt) : null,
      lotStep: lot ? routeOf(lot).steps[currentStepOf(lot)]?.name ?? null : null,
      /** The one tick a seller makes from this screen. */
      chinaReceivedAt: order.checkpoints?.china_received ?? null,
      /** Ticked on the lot screen, not this one - read here so this screen's
       *  own Active/Completed split can tell without asking `order.status`,
       *  which a seller's tick deliberately never touches (see setCheckpoint
       *  in fulfilment-routes.ts). */
      deliveredAt: order.checkpoints?.delivered ?? null,
      /**
       * The route the item's template said a lot carrying it should travel.
       *
       * Pre-selected when the seller opens a lot from this order, which is
       * the last link in the chain a Quick Post template sets up: pick the
       * template once, and the buyer's whole journey is configured.
       */
      lotRouteId: listings.get(order.listingId)?.lotRouteId ?? null,
      /** Whether the buyer chose Book: no charge yet, waiting on acceptance. */
      bookingOnly: order.bookingOnly ?? false,
      accepted: order.accepted ?? false,
      cancelReason: order.cancelReason ?? null,
      reversal: order.reversal ?? null,
      /** From the one shared rule, so this card never offers a button the
       *  server would refuse. */
      canAccept: actionsFor(order, storeId).includes('accept'),
      canCancel: actionsFor(order, storeId).includes('cancel'),
    };
  };

  // Four piles, because they need four different things from the seller.
  // Somebody who has said they paid is waiting on a yes or no about money.
  // Somebody who has only ordered is waiting to hear whether it can be served
  // at all - that used to be invisible here, so an order the shop could not
  // fill simply sat there and the buyer found out by never receiving anything.
  // A payment being reversed is waiting on the seller too, for as long as it
  // takes to record it.
  const waiting = orders
    .filter((order) =>
      (order.paymentStatus === 'claimed' || order.status === 'payment_reversal_pending')
      && !isCancelledLike(order.status))
    .sort((a, b) => (a.paymentClaim?.claimedAt ?? a.updatedAt).localeCompare(b.paymentClaim?.claimedAt ?? b.updatedAt));

  const placed = orders
    .filter((order) => order.status === 'pending_payment' && order.paymentStatus === 'unpaid')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const answered = orders
    .filter((order) => order.paymentClaim?.decision || isCancelledLike(order.status)
      || order.status === 'cancelled_reversed' || order.status === 'dispute_raised')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12);

  /*
   * Every extra payment a buyer has made in this shop, in one place.
   *
   * An overpayment lands on whichever order the payment happened to reach
   * last, which is no place to manage it from. Collected here with the
   * buyer's other orders that still owe something, so the seller can decide
   * in one step: send it back, move it onto one of those, or keep it for
   * whatever the buyer orders next. Settled ones drop off; one waiting on the
   * buyer to confirm a return stays, so it is not forgotten either.
   */
  const credits = orders.flatMap((order) => (order.credits ?? [])
    .filter((credit) => creditIsLive(credit) || credit.status === 'refund_pending')
    .map((credit) => ({
      orderId: order.id,
      itemName: order.itemName,
      currency: order.currency,
      buyer: buyers.get(order.buyerId) ?? personRef(null),
      creditId: credit.id,
      createdAt: credit.createdAt,
      origin: credit.origin ?? 'overpaid',
      reason: credit.reason ?? null,
      amountMinor: credit.amountMinor,
      refundedMinor: credit.refundedMinor,
      leftMinor: creditLeft(credit),
      status: credit.status,
      pendingRefund: credit.pendingRefund ?? null,
      refundDenials: credit.refundDenials?.length ?? 0,
      /** A refund of this the buyer said never came, which the seller may dispute. */
      disputable: disputeSubjects(order, storeId).filter((entry) =>
        (credit.refundLog ?? []).some((logged) => entry.subject === `refund:${logged.id}`)),
      applications: credit.applications ?? [],
      targets: orders
        .filter((other) => other.id !== order.id && other.buyerId === order.buyerId
          && !isCancelledLike(other.status) && other.paymentStatus !== 'claimed'
          && orderMoney(other).outstandingMinor > 0)
        .map((other) => ({ orderId: other.id, itemName: other.itemName, outstandingMinor: orderMoney(other).outstandingMinor })),
    })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /* Every refund this shop has ever sent, and every amount it moved onto
     another order instead - to whom, for what, and when - newest first. */
  const refundHistory = orders.flatMap((order) => (order.credits ?? []).flatMap((credit) => {
    const common = {
      orderId: order.id, itemName: order.itemName, currency: order.currency,
      buyer: buyers.get(order.buyerId) ?? personRef(null),
      origin: credit.origin ?? 'overpaid', reason: credit.reason ?? null,
    };
    return [
      ...(credit.refundLog ?? []).map((entry) => ({
        ...common, id: entry.id, kind: 'refund' as const, amountMinor: entry.amountMinor, at: entry.sentAt,
        reference: entry.reference, screenshotUrl: entry.screenshotUrl ?? null,
        status: entry.status, answeredAt: entry.answeredAt, movedTo: null,
      })),
      ...(credit.applications ?? []).map((moved, at) => ({
        ...common, id: `${credit.id}-mv${at}`, kind: 'moved' as const, amountMinor: moved.amountMinor, at: moved.at,
        reference: null, screenshotUrl: null, status: 'received' as const, answeredAt: moved.at, movedTo: moved.itemName,
      })),
    ];
  })).sort((a, b) => b.at.localeCompare(a.at));

  /* What a fresh refund could be started against: anything paid for that a
     cancellation or an earlier refund has not already claimed. */
  const refundable = orders
    .map((order) => {
      const reserved = (order.credits ?? [])
        .filter((credit) => credit.origin === 'cancelled' || credit.origin === 'manual')
        .reduce((sum, credit) => sum + credit.amountMinor, 0);
      return {
        orderId: order.id, itemName: order.itemName, currency: order.currency, createdAt: order.createdAt,
        buyer: buyers.get(order.buyerId) ?? personRef(null),
        refundableMinor: Math.max(0, orderMoney(order).paidMinor - reserved),
      };
    })
    .filter((entry) => entry.refundableMinor > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return json(200, {
    credits,
    refundHistory,
    refundable,
    waiting: waiting.map(row),
    placed: placed.map(row),
    answered: answered.map(row),
    /* Every purchase, newest first. The three piles above are the ones that
       need an answer about money; this is the shop's whole book, which is what
       the seller is actually working from. */
    orders: orders
      .filter((order) => !isCancelledLike(order.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(row),
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
