import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { AWAITING_LOT_ID, DIRECT_LOT_ID, inLot } from '../../../shared/fulfilment.js';
import type { Lot, Order, StageEvent, User } from '../../../shared/models.js';
import {
  BUILT_IN_ROUTE, ROUTE_PRESETS, SUGGESTED_STEPS, coarseStage, currentStepOf, lotNumberFrom, lotRefOf, itemStepOn, lotOffset, normaliseSteps, routeOf, stepForStage, stepId, type LotRoute, type RouteStep, type StepSide, type StepTrigger, type TrackingRoute,
} from '../../../shared/routes.js';
import { AuthError, getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';
import { ownedLot } from './fulfilment-routes.js';

/**
 * Routes, the items that ride them, and moving a lot one step.
 *
 * The lot is the tracking engine and an item inherits its progress. That is
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
    /*
     * The shapes a shop can start from.
     *
     * Sent rather than bundled into the app so the set can grow without a
     * deploy of the frontend, and so both ends agree about what a preset is.
     * They are not saved routes: picking one fills the editor in, and it only
     * becomes a route of the shop's own when they save it.
     */
    presets: ROUTE_PRESETS.map((preset) => ({
      ...preset,
      steps: preset.steps.map((step, index) => ({
        id: `${preset.id}_${index}`,
        name: step.name,
        description: step.description,
        position: index,
        side: step.side,
        // The bindings come with the shape. A preset that arrived with no
        // buttons attached would make every shop wire up its own from scratch
        // to get the behaviour the preset is describing.
        trigger: step.trigger,
      })),
    })),
    /** What a blank route opens with: the nine steps sellers actually describe. */
    suggested: SUGGESTED_STEPS.map((step, index) => ({
      id: `sg_${index}`,
      name: step.name,
      description: step.description,
      position: index,
      side: step.side,
      trigger: step.trigger,
    })),
  });
}

interface RouteBody {
  id?: string;
  name?: string;
  steps?: { id?: string; name?: string; description?: string; side?: StepSide; trigger?: StepTrigger }[];
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
 * The lots already travelling it are unaffected: each carries its own copy,
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

/* ── Filling a lot ───────────────────────────────────────────────────── */

/** An item as the "what can go in this lot" list shows it. */
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
 * GET /api/lots/{id}/candidates - what could go in this lot.
 *
 * Everything this shop has sold that is bound for a lot and is not in one.
 * Not "every order ever": a domestic sale is never going in a crate, and an
 * item already in another lot would have to be taken out of it first.
 */
async function lotCandidates(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
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
 * POST /api/lots/{id}/items - put items in the lot.
 *
 * Moving an item is a partition move in the store, so it goes through the
 * repository's own method rather than a plain update. The item keeps its own
 * history and gains an entry saying where it went, so a buyer sees "added to
 * lot" rather than their timeline silently growing five new steps.
 */
async function addItems(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
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
    /* Filed where the item is, not where the lot is. A parcel already counted
       into the warehouse joined its lot there, and recording the lot's own
       step put "travelling with lot" above an arrival that happened first. */
    const at = itemStepOn(route, index, undefined, order.checkpoints);
    // Somebody else's item, a domestic sale, or one already riding in a lot:
    // all three are refusals, and none of them is worth failing the whole
    // request over when the other nine are fine.
    if (order.sellerId !== lot.sellerId) continue;
    if (order.lotId !== AWAITING_LOT_ID) continue;

    const event: StageEvent = {
      stage: coarseStage(route, at),
      step: route.steps[at]?.name,
      enteredAt: now,
      kind: 'joined',
      lot: lotRefOf(lot),
      note: null,
      recordedBy: userId,
    };
    const moved = await repository.moveOrderToLot(
      {
        ...order,
        lotId: lot.id,
        stage: coarseStage(route, at),
        currentStep: at,
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
        body: `It now travels with the lot: ${route.name}.`,
        link: '/me?tab=purchases',
      },
      { except: lot.sellerId },
    );
  }

  return json(200, { added: added.length, orderIds: added.map((order) => order.id) });
}

/* ── Moving the lot ──────────────────────────────────────────────────── */

/**
 * POST /api/lots/{id}/step - move the lot along its route.
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
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
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

  /* A lot may not be stepped into the half of the route that happens to one
     item at a time. The floor is one short of its own first step, which is
     where a lot sits while it is still filling. */
  const floor = Math.max(0, lotOffset(route) - 1);
  if (target < floor || target >= route.steps.length) {
    return error(409, 'no_such_step', 'That lot is at the end of its route.');
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
        // Written on the item as well as the lot: an item the seller had moved
        // on its own is brought back in line by the next move of the lot,
        // rather than staying stuck at a position nobody remembers setting.
        currentStep: target,
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
      body: `${live.length} ${live.length === 1 ? 'item' : 'items'} in this lot moved.`,
      link: '/me?tab=purchases',
    },
    { except: lot.sellerId },
  );

  return json(200, { lot: updated, ordersUpdated: live.length });
}

/**
 * POST /api/lots/{id}/route - put this lot on a different ladder.
 *
 * A shop picks a route when it opens a lot, which is before it knows whether
 * the forwarder will clear customs or the shop will. Getting it wrong used to
 * mean the lot travelled the wrong words to the end, because a route is copied
 * onto the lot and nothing could copy another one over it.
 *
 * The position moves with it. Where the lot had got to is a fact about the
 * shipment, not about the list it was being described with, so it is carried
 * across through the coarse stage the two ladders share rather than reset to
 * the beginning or left pointing at a rung that no longer exists.
 */
async function setLotRoute(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot, userId } = await ownedLot(request, id);

  let body: { routeId?: string | null; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();

  /* A copy, like every route a lot carries: editing the template later must
     not rewrite a timeline somebody has been reading for three weeks. */
  let next: LotRoute = BUILT_IN_ROUTE;
  if (body.routeId) {
    const template = await repository.getRoute(userId, body.routeId);
    if (!template) return error(404, 'not_found', 'No such route.');
    next = { routeId: template.id, name: template.name, steps: template.steps };
  }

  const before = routeOf(lot);
  if (before.routeId === next.routeId && before.name === next.name) {
    return error(409, 'same_route', 'That lot already travels that route.');
  }

  /* Carried across by the stage the two ladders share, so a lot halfway to
     India stays halfway to India rather than starting again - except a lot
     still filling, which has taken none of its own steps and should be still
     filling on the new ladder rather than mapped onto one. */
  const was = currentStepOf(lot);
  const at = was < lotOffset(before)
    ? Math.max(0, lotOffset(next) - 1)
    : stepForStage(next, coarseStage(before, was));
  const stage = coarseStage(next, at);
  const now = new Date().toISOString();
  const event: StageEvent = {
    stage,
    step: next.steps[at]?.name,
    enteredAt: now,
    kind: 'note',
    note: body.note?.trim() || `Now tracked as ${next.name}.`,
    recordedBy: userId,
  };

  const updated = await repository.updateLot({
    ...lot,
    route: next,
    currentStep: at,
    stage,
    stageHistory: [...lot.stageHistory, event],
    updatedAt: now,
  });

  /* Every item in it, because an order's own position indexes into the lot's
     ladder and a position left pointing at the old one is a buyer reading a
     step that is no longer on their timeline. */
  const orders = (await repository.listOrdersForLot(lot.id))
    .filter((order) => order.status !== 'cancelled');
  await Promise.all(orders.map((order) =>
    repository.updateOrder({
      ...order,
      stage,
      currentStep: at,
      stageHistory: [...order.stageHistory, event],
      updatedAt: now,
    })));

  await notify(
    repository,
    orders.map((order) => order.buyerId),
    {
      kind: 'lot_moved',
      title: `${lot.name}: tracking updated`,
      body: event.note ?? `Now tracked as ${next.name}.`,
      link: '/me?tab=purchases',
    },
    { except: lot.sellerId },
  );

  return json(200, { lot: updated, ordersUpdated: orders.length });
}

/* ── Notes, and one item that travels differently ──────────────────────── */

/**
 * POST /api/lots/{id}/note - say something without moving the lot.
 *
 * The thing sellers actually do between steps. A crate sits at the forwarder
 * for nine days and the honest thing to tell twenty buyers is "still waiting
 * on the airline, booked for Thursday" - which is not a step, has no place on
 * a ladder, and until now could only be said by inventing one.
 *
 * It is the same `StageEvent` a step writes, recorded at the position the lot
 * is already at. Nothing new: one history, read by one timeline, so a note
 * lands between the steps it was written between.
 */
async function noteOnLot(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot, userId } = await ownedLot(request, id);

  let body: { note?: string; at?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const note = body.note?.trim();
  if (!note) return error(400, 'invalid_request', 'Write the note first.');

  const route = routeOf(lot);
  /* Filed at the step it was written against, not at wherever the lot happens
     to be. "Booked for Thursday" written against the flight belongs on the
     flight, and a seller who writes ahead is telling people what is coming. */
  const at = typeof body.at === 'number'
    ? Math.max(0, Math.min(route.steps.length - 1, Math.trunc(body.at)))
    : currentStepOf(lot);
  const now = new Date().toISOString();
  const event: StageEvent = {
    stage: coarseStage(route, at),
    step: route.steps[at]?.name,
    enteredAt: now,
    note,
    recordedBy: userId,
  };

  const repository = await getRepository();
  // The lot's own history and every item's, because the item's history is what
  // the buyer reads and a note only the seller can see is not a note.
  const updated = await repository.updateLot({
    ...lot,
    stageHistory: [...lot.stageHistory, event],
    updatedAt: now,
  });

  const orders = (await repository.listOrdersForLot(lot.id))
    .filter((order) => order.status !== 'cancelled');
  await Promise.all(orders.map((order) =>
    repository.updateOrder({
      ...order,
      stageHistory: [...order.stageHistory, event],
      updatedAt: now,
    })));

  await notify(
    repository,
    orders.map((order) => order.buyerId),
    {
      kind: 'lot_moved',
      title: `${lot.name}: an update`,
      body: note,
      link: '/me?tab=purchases',
    },
    { except: lot.sellerId },
  );

  return json(200, { lot: updated, ordersUpdated: orders.length });
}

/**
 * The order a caller may work, and the lot it rides in.
 *
 * Seller-side only. An order's timeline is the seller's to write; the buyer
 * reads it through `orderTracking` and never through here.
 */
async function ownedOrder(request: HttpRequest, orderId: string) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const order = await repository.getOrder(orderId);
  if (!order || order.sellerId !== user.id) {
    throw AuthError.forbidden('That order is not yours.');
  }
  const lot = inLot(order) ? await repository.getLot(order.sellerId, order.lotId) : null;
  return { order, lot, userId: user.id, repository };
}

/**
 * POST /api/orders/{id}/step - move one item, or note something about it.
 *
 * The exception that makes the rule usable. Thirty-three pieces cleared and
 * one was pulled for inspection; the lot has not moved, and neither has the
 * truth for thirty-three people. So the item gets its own position and its own
 * note, on the lot's own ladder, and the next move of the lot brings it back
 * in line.
 *
 * `to` moves it. `to` omitted is a note at wherever it already is - which is
 * the between-the-steps case, and by far the commoner one.
 */
async function stepItem(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'An order id is required.');
  const { order, lot, userId, repository } = await ownedOrder(request, id);

  let body: { to?: number; note?: string; at?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const note = body.note?.trim() || null;
  const moving = typeof body.to === 'number';
  if (!moving && !note) {
    return error(400, 'invalid_request', 'Write a note, or pick a step to move it to.');
  }
  if (moving && !lot) {
    return error(409, 'no_lot', 'That item is not in a lot yet, so it has no route to move along.');
  }

  const route = lot ? routeOf(lot) : null;
  const here = route
    ? Math.max(0, Math.min(route.steps.length - 1, order.currentStep ?? currentStepOf(lot!)))
    : 0;
  // A note goes where it was written; only `to` moves the item.
  const at = !moving && typeof body.at === 'number' && route
    ? Math.max(0, Math.min(route.steps.length - 1, Math.trunc(body.at)))
    : here;
  const target = moving ? Math.trunc(body.to!) : at;

  if (route && (target < 0 || target >= route.steps.length)) {
    return error(409, 'no_such_step', 'That route has no such step.');
  }

  const now = new Date().toISOString();
  const stage = route ? coarseStage(route, target) : order.stage;
  const event: StageEvent = {
    stage,
    step: route?.steps[target]?.name,
    enteredAt: now,
    note,
    recordedBy: userId,
  };

  const last = Boolean(route) && target === route!.steps.length - 1;
  const updated = await repository.updateOrder({
    ...order,
    ...(moving
      ? {
          currentStep: target,
          stage,
          status: last ? 'delivered' : order.status === 'cancelled' ? order.status : 'in_fulfilment',
          completedAt: last ? now : order.completedAt,
        }
      : {}),
    stageHistory: [...order.stageHistory, event],
    updatedAt: now,
  });

  await notify(
    repository,
    [order.buyerId],
    {
      kind: 'lot_moved',
      title: moving && route ? `${order.itemName}: ${route.steps[target]!.name}` : `${order.itemName}: an update`,
      body: note ?? 'Your item moved on.',
      link: '/me?tab=purchases',
    },
    { except: order.sellerId },
  );

  return json(200, { order: updated });
}

/* ── What the buyer sees ───────────────────────────────────────────────── */

/** The buyer's own items, grouped by the lot they travel in. */
async function myItems(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const orders = (await repository.listOrdersForBuyer(user.id))
    .filter((order) => order.status !== 'cancelled');

  // One read per lot rather than one per item: three items in one lot are
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
    /* One ladder for the group, at the furthest of the items sharing it: a
       buyer whose parcel is already counted into the warehouse should not read
       a summary that has forgotten it. */
    const index = lot && route
      ? Math.max(...items.map((order) => itemStepOn(
          route, currentStepOf(lot), order.currentStep,
          order.checkpoints,
        )))
      : 0;
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
export const noteOnLotRoute = handler(noteOnLot);
export const setLotRouteRoute = handler(setLotRoute);
export const stepItemRoute = handler(stepItem);
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
app.http('lot-note', { ...anon, methods: ['POST'], route: 'lots/{id}/note', handler: noteOnLotRoute });
app.http('lot-route', { ...anon, methods: ['POST'], route: 'lots/{id}/route', handler: setLotRouteRoute });
app.http('order-step', { ...anon, methods: ['POST'], route: 'orders/{id}/step', handler: stepItemRoute });
app.http('me-items', { ...anon, methods: ['GET'], route: 'me/items', handler: myItemsRoute });
