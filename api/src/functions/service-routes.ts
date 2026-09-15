import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { tally } from '../../../shared/board.js';
import type { HandlerProfile, Lot, Order, User } from '../../../shared/models.js';
import {
  SERVICES,
  SERVICE_ORDER,
  servicesOf,
  type ServiceKind,
} from '../../../shared/services.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * The trades around the trade: who offers them, and the screens for doing them.
 *
 * Three of these four already existed in pieces - a forwarder directory nobody
 * could act from, an escrow console reachable only from a link on the sell tab,
 * a packing list behind a store right. What was missing was the front door: one
 * place that says these jobs exist, who does them, and where you go if you do
 * one. Nothing here replaces those screens; it points at them, and fills in the
 * two that were never built.
 *
 * Every list is filtered on the way out rather than on the way in: an unlisted
 * handler is a working handler who is simply not on offer to strangers, and a
 * route that forgot that would publish somebody's phone number.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** The public shape of a service provider, whichever kind they are. */
interface ProviderCard {
  userId: string;
  name: string;
  handle: string | null;
  /** One line under the name: the route, the cities, the fee. */
  line: string;
  description: string;
  contact: string | null;
  trustScore: number | null;
  /** Completed work behind the score, so an empty one reads as new. */
  completed: number | null;
}

function forwarderCard(user: User): ProviderCard {
  const profile = user.forwarderProfile!;
  const routes = profile.routes
    .map((route) => `${route.originCity} → ${route.destinationCity}`)
    .slice(0, 3);
  return {
    userId: user.id,
    name: profile.companyName,
    handle: user.username ?? null,
    line: routes.join(' · ') || 'Routes not listed',
    description: profile.description,
    contact: profile.contactEmail || profile.contactPhone || null,
    trustScore: profile.trust.score,
    completed: profile.trust.completedTransactions,
  };
}

function handlerCard(user: User): ProviderCard {
  const profile = user.handlerProfile!;
  return {
    userId: user.id,
    name: profile.companyName,
    handle: user.username ?? null,
    line: profile.cities.join(' · ') || 'Cities not listed',
    description: profile.description,
    contact: profile.contactEmail || profile.contactPhone || null,
    trustScore: profile.trust.score,
    completed: profile.trust.completedTransactions,
  };
}

function escrowCard(user: User): ProviderCard {
  const rights = user.escrowRights!;
  const fee = (rights.feeBasisPoints / 100).toFixed(rights.feeBasisPoints % 100 === 0 ? 0 : 2);
  return {
    userId: user.id,
    name: rights.displayName || user.displayName,
    handle: user.username ?? null,
    line: `${fee}% of the order, charged to the buyer`,
    // The operator's note is for operators. What a buyer needs is the fee and
    // the name, and inventing a blurb they never wrote would be worse.
    description: '',
    contact: null,
    trustScore: null,
    completed: null,
  };
}

/** Everyone offering one kind, already filtered to what may be shown. */
async function providersOf(repository: Repo, kind: ServiceKind): Promise<ProviderCard[]> {
  switch (kind) {
    case 'forwarder':
      return (await repository.listForwarders())
        .filter((user) => user.forwarderProfile)
        .map(forwarderCard)
        .sort((a, b) => (b.trustScore ?? 0) - (a.trustScore ?? 0));
    case 'handler':
      return (await repository.listHandlers())
        .filter((user) => user.handlerProfile)
        .map(handlerCard)
        .sort((a, b) => (b.trustScore ?? 0) - (a.trustScore ?? 0));
    case 'escrow':
      return (await repository.listEscrowAgents())
        .filter((user) => user.escrowRights && !user.suspended)
        .map(escrowCard);
    case 'exporter':
      // Private by construction. Guarded at the route too; this is the second
      // lock, so a future caller cannot reach the list by asking politely.
      return [];
  }
}

/* ── The hub ───────────────────────────────────────────────────────────── */

/**
 * GET /api/services - the categories, and what this account already is.
 *
 * Anonymous: the point of a directory is that somebody can look before they
 * commit to anything. Only `mine` needs a session, and it is empty without one.
 */
async function servicesHub(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request);
  const repository = await getRepository();

  const categories = await Promise.all(
    SERVICE_ORDER.map(async (kind) => ({
      ...SERVICES[kind],
      // A count only where there is a list to count. "0 exporters" would be a
      // lie about a category that deliberately has no roster.
      count: SERVICES[kind].browsable ? (await providersOf(repository, kind)).length : null,
    })),
  );

  const mine: ServiceKind[] = [];
  if (viewer) {
    const account = await repository.getUserById(viewer.id);
    if (account) mine.push(...servicesOf(account));
    // The exporter's answer is not on their account - it is whether anybody
    // has asked them to check a lot.
    if (await packsForAnyone(repository, viewer.id)) mine.push('exporter');
  }

  return json(200, { categories, mine: SERVICE_ORDER.filter((kind) => mine.includes(kind)) });
}

/** Whether anyone has named this account on a lot, or granted it the right. */
async function packsForAnyone(repository: Repo, userId: string): Promise<boolean> {
  for (const owner of await repository.listStoreOwners()) {
    const managers = owner.sellerProfile?.managers ?? [];
    if (managers.some((entry) => entry.userId === userId && entry.permissions.includes('export'))) {
      return true;
    }
    const lots = await repository.listLots({ sellerId: owner.id });
    if (lots.some((lot) => lot.exporterUserId === userId)) return true;
  }
  return false;
}

/** GET /api/services/{kind} - who offers it. */
async function serviceDirectory(request: HttpRequest, _context: InvocationContext) {
  const kind = request.params.kind as ServiceKind | undefined;
  if (!kind || !(kind in SERVICES)) return error(404, 'not_found', 'No such service.');

  const meta = SERVICES[kind];
  if (!meta.browsable) {
    return error(
      403,
      'not_browsable',
      `${meta.plural} are named by a shop on a lot, so there is no list of them.`,
    );
  }

  const repository = await getRepository();
  const providers = await providersOf(repository, kind);

  const query = request.query.get('q')?.trim().toLowerCase();
  const filtered = query
    ? providers.filter((card) =>
        `${card.name} ${card.line} ${card.description}`.toLowerCase().includes(query))
    : providers;

  return json(200, { service: meta, providers: filtered });
}

/* ── Offering one ──────────────────────────────────────────────────────── */

interface ListingBody {
  kind?: ServiceKind;
  companyName?: string;
  description?: string;
  /** Forwarder: routes as "Guangzhou → Mumbai". Handler: cities. */
  places?: string[];
  contactEmail?: string;
  contactPhone?: string;
  perParcelFeeMinor?: number | null;
  /** False withdraws the entry without deleting the history behind it. */
  listed?: boolean;
}

/**
 * POST /api/me/service - put yourself on a list, or take yourself off it.
 *
 * Only the two kinds anyone may offer. Escrow is granted because the job is
 * holding other people's money, and an exporter is named by a shop - neither is
 * something to sign up for, and letting this route write them would be a way
 * around both rules.
 */
async function offerService(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);

  let body: ListingBody;
  try {
    body = (await request.json()) as ListingBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const kind = body.kind;
  if (kind !== 'forwarder' && kind !== 'handler') {
    return error(400, 'invalid_service', 'You can offer freight forwarding or domestic handling.');
  }

  const repository = await getRepository();
  const account = await repository.getUserById(user.id);
  if (!account) return error(404, 'not_found', 'No such account.');

  const existing = kind === 'forwarder' ? account.forwarderProfile : account.handlerProfile;
  const name = (body.companyName ?? '').trim() || existing?.companyName || account.displayName;
  const places = (body.places ?? []).map((place) => place.trim()).filter(Boolean);

  // Withdrawing is a flag, not a delete: the lots they have already carried
  // are somebody else's history too, and it has to keep resolving to a name.
  const listed = body.listed !== false;

  if (kind === 'handler') {
    const profile: HandlerProfile = {
      companyName: name,
      directorySlug: account.handlerProfile?.directorySlug ?? slugOf(name, account.id),
      description: (body.description ?? account.handlerProfile?.description ?? '').trim(),
      cities: places.length > 0 ? places : (account.handlerProfile?.cities ?? []),
      contactEmail: (body.contactEmail ?? account.handlerProfile?.contactEmail ?? account.email ?? '').trim(),
      contactPhone: (body.contactPhone ?? account.handlerProfile?.contactPhone ?? account.phone ?? '').trim(),
      perParcelFeeMinor:
        body.perParcelFeeMinor === undefined
          ? (account.handlerProfile?.perParcelFeeMinor ?? null)
          : body.perParcelFeeMinor,
      trust: account.handlerProfile?.trust ?? { score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null },
      listedInDirectory: listed,
    };
    account.handlerProfile = profile;
  } else {
    const routes = places.map((place) => {
      const [origin, destination] = place.split(/→|->|,/).map((part) => part.trim());
      return {
        originCity: origin ?? place,
        destinationCity: destination ?? '',
        claimedTurnaroundDays: 0,
        ratePerKgMinor: 0,
        currency: 'INR',
      };
    });
    account.forwarderProfile = {
      companyName: name,
      directorySlug: account.forwarderProfile?.directorySlug ?? slugOf(name, account.id),
      description: (body.description ?? account.forwarderProfile?.description ?? '').trim(),
      routes: routes.length > 0 ? routes : (account.forwarderProfile?.routes ?? []),
      contactEmail: (body.contactEmail ?? account.forwarderProfile?.contactEmail ?? account.email ?? '').trim(),
      contactPhone: (body.contactPhone ?? account.forwarderProfile?.contactPhone ?? account.phone ?? '').trim(),
      claimedMonthlyCapacityKg: account.forwarderProfile?.claimedMonthlyCapacityKg ?? null,
      trust: account.forwarderProfile?.trust ?? { score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null },
      listedInDirectory: listed,
    };
  }

  account.updatedAt = new Date().toISOString();
  const saved = await repository.updateUser(account);
  return json(200, {
    kind,
    profile: kind === 'handler' ? saved.handlerProfile : saved.forwarderProfile,
  });
}

/** A readable slug that cannot collide with another account's. */
function slugOf(name: string, userId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service';
  return `${base}-${userId.slice(-6)}`;
}

/* ── Doing the work ────────────────────────────────────────────────────── */

/** Every lot across every shop that names this account in the given role. */
async function lotsNaming(
  repository: Repo,
  userId: string,
  role: 'forwarder' | 'handler',
): Promise<{ owner: User; lot: Lot }[]> {
  const rows: { owner: User; lot: Lot }[] = [];
  for (const owner of await repository.listStoreOwners()) {
    for (const lot of await repository.listLots({ sellerId: owner.id })) {
      const named =
        role === 'forwarder'
          ? lot.forwarder?.forwarderUserId === userId
          : lot.handler?.handlerUserId === userId;
      if (named) rows.push({ owner, lot });
    }
  }
  return rows;
}

function storeCard(owner: User) {
  return {
    ownerId: owner.id,
    name: owner.sellerProfile?.storefrontName ?? owner.displayName,
    handle: owner.sellerProfile?.username ?? null,
  };
}

/**
 * GET /api/me/service/consignments - what has been consigned to this forwarder.
 *
 * The screen a forwarder never had. Weight and piece count, because that is
 * what they quote and load on; no prices, because what the shop sold it for is
 * not their business.
 */
async function consignments(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const rows = await Promise.all(
    (await lotsNaming(repository, user.id, 'forwarder')).map(async ({ owner, lot }) => {
      const orders = await repository.listOrdersForLot(lot.id);
      return {
        store: storeCard(owner),
        lot: {
          id: lot.id,
          name: lot.name,
          stage: lot.stage,
          origin: lot.origin ?? '',
          estimatedDispatchAt: lot.estimatedDispatchAt,
          trackingReference: lot.forwarder?.trackingReference ?? null,
        },
        pieces: orders.reduce((sum, order) => sum + order.quantity, 0),
        weightGrams: orders.reduce((sum, order) => sum + order.quantity * order.unitWeightGrams, 0),
      };
    }),
  );

  return json(200, { consignments: rows });
}

/**
 * GET /api/me/service/distribution - lots this handler has to get out.
 *
 * Counted by parcel rather than by piece: a handler's day is people, and three
 * items for one buyer is one job, not three.
 */
async function distribution(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const rows = await Promise.all(
    (await lotsNaming(repository, user.id, 'handler')).map(async ({ owner, lot }) => {
      const orders = await repository.listOrdersForLot(lot.id);
      const live = orders.filter((order) => order.status !== 'cancelled');
      const buyers = new Set(live.map((order) => order.buyerId));
      const gone = new Set(
        live.filter((order) => order.checkpoints?.dispatched).map((order) => order.buyerId),
      );
      return {
        store: storeCard(owner),
        lot: { id: lot.id, name: lot.name, stage: lot.stage, origin: lot.origin ?? '' },
        city: lot.handler?.city ?? null,
        parcels: buyers.size,
        // A buyer counts as gone only when everything of theirs has: a parcel
        // goes out whole.
        dispatched: [...gone].filter((buyerId) =>
          live.every((order) => order.buyerId !== buyerId || order.checkpoints?.dispatched)).length,
        tally: tally(live),
      };
    }),
  );

  return json(200, { lots: rows });
}

/**
 * GET /api/me/service/distribution/{id} - one lot, as parcels to send.
 *
 * The exporter's packing list is pieces and never customers, because they pack
 * a crate. This is the mirror image: a handler's whole job is which box goes to
 * which person, so they get names and a phone number - and still no prices,
 * which are nobody's business but the shop's and the buyer's.
 */
async function distributionDetail(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const lotId = request.params.id;
  if (!lotId) return error(400, 'invalid_lot', 'A lot id is required.');

  const repository = await getRepository();
  const found = (await lotsNaming(repository, user.id, 'handler')).find(
    (row) => row.lot.id === lotId,
  );
  if (!found) return error(403, 'forbidden', 'That lot is not yours to distribute.');

  const orders = (await repository.listOrdersForLot(lotId)).filter(
    (order) => order.status !== 'cancelled',
  );
  const buyers = await repository.listUsersByIds([...new Set(orders.map((o) => o.buyerId))]);
  const byId = new Map(buyers.map((buyer) => [buyer.id, buyer]));

  const grouped = new Map<string, Order[]>();
  for (const order of orders) {
    const existing = grouped.get(order.buyerId);
    if (existing) existing.push(order);
    else grouped.set(order.buyerId, [order]);
  }

  const parcels = [...grouped]
    .map(([buyerId, rows]) => {
      const buyer = byId.get(buyerId);
      return {
        buyerId,
        name: buyer?.displayName ?? 'Unknown',
        phone: buyer?.phone ?? null,
        items: rows.map((order) => ({
          id: order.id,
          itemName: order.itemName,
          condition: order.condition,
          quantity: order.quantity,
          unitWeightGrams: order.unitWeightGrams,
          checkpoints: order.checkpoints ?? {},
        })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return json(200, {
    store: storeCard(found.owner),
    lot: {
      id: found.lot.id,
      name: found.lot.name,
      stage: found.lot.stage,
      origin: found.lot.origin ?? '',
    },
    city: found.lot.handler?.city ?? null,
    tally: tally(orders),
    parcels,
  });
}

export const servicesHubRoute = handler(servicesHub);
export const serviceDirectoryRoute = handler(serviceDirectory);
export const offerServiceRoute = handler(offerService);
export const consignmentsRoute = handler(consignments);
export const distributionRoute = handler(distribution);
export const distributionDetailRoute = handler(distributionDetail);

const anon = { authLevel: 'anonymous' } as const;

app.http('services-hub', { ...anon, methods: ['GET'], route: 'services', handler: servicesHubRoute });
app.http('services-directory', {
  ...anon, methods: ['GET'], route: 'services/{kind}', handler: serviceDirectoryRoute,
});
app.http('service-offer', { ...anon, methods: ['POST'], route: 'me/service', handler: offerServiceRoute });
app.http('service-consignments', {
  ...anon, methods: ['GET'], route: 'me/service/consignments', handler: consignmentsRoute,
});
app.http('service-distribution', {
  ...anon, methods: ['GET'], route: 'me/service/distribution', handler: distributionRoute,
});
app.http('service-distribution-lot', {
  ...anon, methods: ['GET'], route: 'me/service/distribution/{id}', handler: distributionDetailRoute,
});
