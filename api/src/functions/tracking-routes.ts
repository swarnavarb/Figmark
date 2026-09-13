import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { AWAITING_LOT_ID, DIRECT_LOT_ID, inLot } from '../../../shared/fulfilment.js';
import type { Lot, Order, StageEvent, User } from '../../../shared/models.js';
import {
  BUILT_IN_ROUTE,
  SUGGESTED_STEPS,
  coarseStage,
  currentStepOf,
  lotNumberFrom,
  normaliseSteps,
  routeOf,
  stepId,
  type LotRoute,
  type RouteStep,
  type TrackingRoute,
} from '../../../shared/routes.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';
import { ownedLot } from './fulfilment-routes.js';

/**
 * Routes, the items that ride them, and moving a batch one step.
 *
 * The batch is the tracking engine and an item inherits its progress. That is
 * the whole design: one click moves thirty-four items, because moving them one
 * at a time is the work nobody did, which is why buyers used to ask instead.
 *
 * Kept out of `fulfilment-routes` because that module is the physical
 * checkpoint board - what each individual piece has done - and this is the
 * consignment's own ladder. They meet in exactly one place: the coarse stage,
 * which this module writes and that one reads.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/* ── Route templates ───────────────────────────────────────────────────── */

/**
 * GET /api/routes - the ladders this shop has written, and the two it starts with.
 *
 * The built-in one is handed over rather than assumed, so the picker can offer
 * it by name and the builder can open with something to edit instead of an
 * empty list nobody knows how to fill.
 */
async function listRoutes(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  return json(200, {
    routes: await repository.listRoutes(user.id),
    builtIn: BUILT_IN_ROUTE,
    /** What a new route opens with: the nine steps sellers actually describe. */
    suggested: SUGGESTED_STEPS.map((name, index) => ({
      id: `sg_${index}`,
      name,
      description: '',
      position: index,
    })),
  });
}

interface RouteBody {
  id?: string;
  name?: string;
  steps?: { id?: string; name?: string; description?: string }[];
}

/** POST /api/routes - write a ladder, or correct one. */
async function saveRoute(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  let body: RouteBody;
  try {
    body = (await request.json()) as RouteBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const name = body.name?.trim();
  if (!name) return error(400, 'invalid_route', 'Give the route a name.');

  const steps = normaliseSteps(body.steps ?? []);
  // Two, because one step is a state and not a journey - and because a buyer
  // reading a single-step timeline learns nothing a status word would not say.
  if (steps.length < 2) {
    return error(400, 'invalid_route', 'A route needs at least two steps.');
  }

  const repository = await getRepository();
  const now = new Date().toISOString();

  if (body.id) {
    const existing = await repository.getRoute(user.id, body.id);
    if (!existing) return error(404, 'not_found', 'No such route.');
    return json(200, {
      route: await repository.saveRoute({ ...existing, name, steps, updatedAt: now }),
    });
  }

  return json(201, {
    route: await repository.saveRoute({
      id: `rt_${randomUUID().slice(0, 12)}`,
      sellerId: user.id,
      name,
      steps,
      createdAt: now,
      updatedAt: now,
    }),
  });
}

/**
 * POST /api/routes/{id}/delete - drop a template.
 *
 * The batches already travelling it are unaffected: each carries its own copy,
 * which is the reason they carry one.
 */
async function deleteRoute(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A route id is required.');

  const repository = await getRepository();
  const gone = await repository.deleteRoute(user.id, id);
  if (!gone) return error(404, 'not_found', 'No such route.');
  return json(200, { deleted: id });
}

/* ── Filling a batch ───────────────────────────────────────────────────── */

/** An item as the "what can go in this batch" list shows it. */
function itemCard(order: Order, buyers: Map<string, User>) {
  const buyer = buyers.get(order.buyerId);
  return {
    id: order.id,
    itemName: order.itemName,
    condition: order.condition,
    quantity: order.quantity,
    buyerId: order.buyerId,
    buyerName: buyer?.displayName ?? 'Unknown',
    buyerHandle: buyer?.username ?? null,
    unitWeightGrams: order.unitWeightGrams,
    createdAt: order.createdAt,
  };
}

async function namesFor(repository: Repo, orders: readonly Order[]): Promise<Map<string, User>> {
  const people = await repository.listUsersByIds([...new Set(orders.map((o) => o.buyerId))]);
  return new Map(people.map((person) => [person.id, person]));
}

/**
 * GET /api/lots/{id}/candidates - what could go in this batch.
 *
 * Everything this shop has sold that is bound for a batch and is not in one.
 * Not "every order ever": a domestic sale is never going in a crate, and an
 * item already in another batch would have to be taken out of it first.
 */
async function lotCandidates(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A batch id is required.');
  const { lot } = await ownedLot(request, id);

  const repository = await getRepository();
  const waiting = await repository.listOrdersAwaitingLot(lot.sellerId);

  const query = request.query.get('q')?.trim().toLowerCase();
  const buyers = await namesFor(repository, waiting);
  const items = waiting
    .map((order) => itemCard(order, buyers))
    .filter((item) =>
      !query || `${item.itemName} ${item.buyerName}`.toLowerCase().includes(query));

  return json(200, { items });
}

/**
 * POST /api/lots/{id}/items - put items in the batch.
 *
 * Moving an item is a partition move in the store, so it goes through the
 * repository's own method rather than a plain update. The item keeps its own
 * history and gains an entry saying where it went, so a buyer sees "added to
 * batch" rather than their timeline silently growing five new steps.
 */
async function addItems(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A batch id is required.');
  const { lot, userId } = await ownedLot(request, id);

  let body: { orderIds?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const wanted = [...new Set(body.orderIds ?? [])].filter(Boolean);
  if (wanted.length === 0) return error(400, 'invalid_request', 'Pick at least one item.');

  const repository = await getRepository();
  const route = routeOf(lot);
  const index = currentStepOf(lot);
  const now = new Date().toISOString();

  const added: Order[] = [];
  for (const orderId of wanted) {
    const order = await repository.getOrder(orderId);
    if (!order) continue;
    // Somebody else's item, a domestic sale, or one already riding in a batch:
    // all three are refusals, and none of them is worth failing the whole
    // request over when the other nine are fine.
    if (order.sellerId !== lot.sellerId) continue;
    if (order.lotId !== AWAITING_LOT_ID) continue;

    const event: StageEvent = {
      stage: coarseStage(route, index),
      step: route.steps[index]?.name,
      enteredAt: now,
      note: `Added to ${lot.name}.`,
      recordedBy: userId,
    };
    const moved = await repository.moveOrderToLot(
      {
        ...order,
        lotId: lot.id,
        stage: coarseStage(route, index),
        stageHistory: [...order.stageHistory, event],
        status: order.status === 'cancelled' ? order.status : 'in_fulfilment',
        updatedAt: now,
      },
      AWAITING_LOT_ID,
    );
    added.push(moved);
  }

  if (added.length > 0) {
    await notify(
      repository,
      added.map((order) => order.buyerId),
      {
        kind: 'lot_moved',
        title: `Your item is in ${lot.name}`,
        body: `It now travels with the batch: ${route.name}.`,
        link: '/me?tab=purchases',
      },
      { except: lot.sellerId },
    );
  }

  return json(200, { added: added.length, orderIds: added.map((order) => order.id) });
}

/* ── Moving the batch ──────────────────────────────────────────────────── */

/**
 * POST /api/lots/{id}/step - move the batch along its route.
 *
 * One click, every item. The alternative - the seller ticking thirty-four
 * items through nine steps each - is 306 actions for one consignment, which is
 * why nobody did it and why buyers asked instead.
 *
 * Backwards is allowed, because the commonest correction on any board is a
 * button pressed once too often, and a seller who cannot undo it will tell
 * twenty buyers their crate has cleared customs when it has not.
 */
async function stepLot(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A batch id is required.');
  const { lot, userId } = await ownedLot(request, id);

  let body: { to?: number; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const route = routeOf(lot);
  const from = currentStepOf(lot);
  const target = typeof body.to === 'number' ? Math.trunc(body.to) : from + 1;

  if (target < 0 || target >= route.steps.length) {
    return error(409, 'no_such_step', 'That batch is at the end of its route.');
  }
  if (target === from) return json(200, { lot, ordersUpdated: 0 });

  const step = route.steps[target]!;
  const stage = coarseStage(route, target);
  const now = new Date().toISOString();
  const event: StageEvent = {
    stage,
    step: step.name,
    enteredAt: now,
    note: body.note?.trim() || null,
    recordedBy: userId,
  };

  const last = target === route.steps.length - 1;
  const repository = await getRepository();
  const updated = await repository.updateLot({
    ...lot,
    currentStep: target,
    stage,
    stageHistory: [...lot.stageHistory, event],
    status: last ? 'closed' : lot.status === 'closed' ? 'open' : lot.status,
    updatedAt: now,
  });

  const orders = await repository.listOrdersForLot(lot.id);
  const live = orders.filter((order) => order.status !== 'cancelled');
  await Promise.all(
    live.map((order) =>
      repository.updateOrder({
        ...order,
        stage,
        stageHistory: [...order.stageHistory, event],
        status: last ? 'delivered' : 'in_fulfilment',
        completedAt: last ? now : order.completedAt,
        updatedAt: now,
      }),
    ),
  );

  // The notification the whole product is really for: twenty people paid for
  // one shipment weeks ago and have no way of knowing it cleared customs
  // unless somebody tells them.
  await notify(
    repository,
    live.map((order) => order.buyerId),
    {
      kind: 'lot_moved',
      title: `${lot.name}: ${step.name}`,
      body: `${live.length} ${live.length === 1 ? 'item' : 'items'} in this batch moved.`,
      link: '/me?tab=purchases',
    },
    { except: lot.sellerId },
  );

  return json(200, { lot: updated, ordersUpdated: live.length });
}

/* ── What the buyer sees ───────────────────────────────────────────────── */

/** The buyer's own items, grouped by the batch they travel in. */
async function myItems(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const orders = (await repository.listOrdersForBuyer(user.id))
    .filter((order) => order.status !== 'cancelled');

  // One read per batch rather than one per item: three items in one batch are
  // one journey, and asking three times would be three chances to disagree.
  const lots = new Map<string, Lot | null>();
  for (const order of orders) {
    if (!inLot(order) || lots.has(order.lotId)) continue;
    lots.set(order.lotId, await repository.getLot(order.sellerId, order.lotId));
  }

  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const key = inLot(order) ? order.lotId : order.lotId === DIRECT_LOT_ID ? DIRECT_LOT_ID : AWAITING_LOT_ID;
    const existing = groups.get(key);
    if (existing) existing.push(order);
    else groups.set(key, [order]);
  }

  const sellers = await repository.listUsersByIds([...new Set(orders.map((o) => o.sellerId))]);
  const byId = new Map(sellers.map((seller) => [seller.id, seller]));

  const rows = [...groups].map(([key, items]) => {
    const lot = lots.get(key) ?? null;
    const route = lot ? routeOf(lot) : null;
    const index = lot ? currentStepOf(lot) : 0;
    const seller = byId.get(items[0]!.sellerId);
    return {
      key,
      kind: lot ? 'lot' : key === DIRECT_LOT_ID ? 'direct' : 'awaiting',
      lot: lot
        ? {
            id: lot.id,
            name: lot.name,
            number: lot.lotNumber ?? lotNumberFrom(lot.id, lot.createdAt),
            routeName: route!.name,
            steps: route!.steps,
            currentStep: index,
            estimatedDispatchAt: lot.estimatedDispatchAt,
            trackingReference: lot.forwarder?.trackingReference ?? null,
          }
        : null,
      sellerName: seller?.sellerProfile?.storefrontName ?? seller?.displayName ?? 'Seller',
      sellerHandle: seller?.sellerProfile?.username ?? null,
      items: items.map((order) => ({
        id: order.id,
        itemName: order.itemName,
        quantity: order.quantity,
        status: order.status,
        /** Ticked once the seller has this one in hand and is finishing it. */
        checkpoints: order.checkpoints ?? {},
      })),
    };
  });

  // Waiting first: it is the only group with anything a buyer might act on.
  const rank = (kind: string) => (kind === 'awaiting' ? 0 : kind === 'lot' ? 1 : 2);
  rows.sort((a, b) => rank(a.kind) - rank(b.kind));

  return json(200, { groups: rows });
}

/* ── Registration ──────────────────────────────────────────────────────── */

export const listRoutesRoute = handler(listRoutes);
export const saveRouteRoute = handler(saveRoute);
export const deleteRouteRoute = handler(deleteRoute);
export const lotCandidatesRoute = handler(lotCandidates);
export const addItemsRoute = handler(addItems);
export const stepLotRoute = handler(stepLot);
export const myItemsRoute = handler(myItems);

/** Route templates as the create-lot form needs them, for reuse elsewhere. */
export function templateFrom(name: string, steps: readonly RouteStep[], routeId: string | null): LotRoute {
  return { routeId, name, steps: normaliseSteps(steps) };
}

export { stepId, type TrackingRoute };

const anon = { authLevel: 'anonymous' } as const;

app.http('routes-list', { ...anon, methods: ['GET'], route: 'routes', handler: listRoutesRoute });
app.http('routes-save', { ...anon, methods: ['POST'], route: 'routes/new', handler: saveRouteRoute });
app.http('routes-delete', {
  ...anon, methods: ['POST'], route: 'routes/{id}/delete', handler: deleteRouteRoute,
});
app.http('lot-candidates', {
  ...anon, methods: ['GET'], route: 'lots/{id}/candidates', handler: lotCandidatesRoute,
});
app.http('lot-items', { ...anon, methods: ['POST'], route: 'lots/{id}/items', handler: addItemsRoute });
app.http('lot-step', { ...anon, methods: ['POST'], route: 'lots/{id}/step', handler: stepLotRoute });
app.http('me-items', { ...anon, methods: ['GET'], route: 'me/items', handler: myItemsRoute });
