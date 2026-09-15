import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { LOT_STAGES, LOT_STAGE_LABELS, ORDER_CHECKPOINTS, type LotStage, type OrderCheckpoint } from '../../../shared/enums.js';
import { byCustomer, tally } from '../../../shared/board.js';
import { hasAnyCapability } from '../../../shared/capabilities.js';
import { can } from '../../../shared/stores.js';
import { mayTick, type CrewRole } from '../../../shared/services.js';
import { preLotRouteOf } from '../../../shared/templates.js';
import {
  BUILT_IN_ROUTE, atSellerYet, coarseStage, currentStepOf, lotNumberFrom, normaliseSteps,
  joinIndexOf, routeOf, stepForStage, type LotRoute, type StepSide,
} from '../../../shared/routes.js';
import { AUTO_RELEASE_DAYS, daysFrom } from '../../../shared/orders.js';
import {
  awaitingLot, furthestStage, inLot, stagesFor,
} from '../../../shared/fulfilment.js';
import type { Lot, LotSupplier, Order, StageEvent } from '../../../shared/models.js';
import { AuthError } from '../auth/errors.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';

/**
 * Seller-side shipment lots.
 *
 * A lot groups the items a seller is moving in one consignment. Buyers never
 * see one: advancing a lot's stage appends an event to every order inside it,
 * and the buyer reads that from their own order.
 */

/** GET /api/me/lots - the seller's own lots, with what's in each. */
/**
 * Everything about a lot that is a description of it rather than a movement.
 *
 * Shared by create and edit so the two cannot drift: a field you can set when
 * opening a lot is a field you can correct afterwards, which is the whole
 * point of keeping them together.
 */
interface LotDetailsBody {
  name?: string;
  description?: string;
  origin?: string;
  estimatedDispatchAt?: string | null;
  supplierName?: string;
  supplierContact?: string;
  supplierReference?: string;
}

/** Null unless a supplier was actually named; a contact alone is not one. */
function supplierFrom(body: LotDetailsBody): LotSupplier | null {
  const name = body.supplierName?.trim();
  if (!name) return null;
  return {
    name,
    contact: body.supplierContact?.trim() || null,
    reference: body.supplierReference?.trim() || null,
  };
}

/**
 * PATCH-ish update of a lot's details.
 *
 * Only the keys present in the body are touched, so editing the origin cannot
 * silently blank the supplier. The name is the one field that cannot be cleared:
 * it is how the seller finds the lot again.
 */
async function updateLotDetails(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const lotId = request.params.id;
  if (!lotId) return error(400, 'invalid_lot', 'A lot id is required.');

  let body: LotDetailsBody;
  try {
    body = (await request.json()) as LotDetailsBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  // Scoped to the caller's partition, so one seller cannot edit another's lot.
  const lot = await repository.getLot(user.id, lotId);
  if (!lot) return error(404, 'not_found', 'No such lot.');

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return error(400, 'invalid_lot', 'A lot needs a name you will recognise.');
    lot.name = name;
  }
  if (body.description !== undefined) lot.description = body.description.trim();
  if (body.origin !== undefined) lot.origin = body.origin.trim();
  if (body.estimatedDispatchAt !== undefined) lot.estimatedDispatchAt = body.estimatedDispatchAt;
  // The supplier moves as a unit: naming one sets it, clearing the name drops it.
  if (body.supplierName !== undefined) lot.supplier = supplierFrom(body);

  lot.updatedAt = new Date().toISOString();
  return json(200, { lot: await repository.updateLot(lot) });
}

async function myLots(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  // A manager works the shop's consignments, not their own, where the shop has
  // granted them that.
  const sellerId = await lotsStoreFor(request, user, request.query.get('store') ?? undefined);
  if (!sellerId) return error(403, 'forbidden', 'You cannot work the lots in that store.');

  const lots = await repository.listLots({ sellerId });
  const withContents = await Promise.all(
    lots.map(async (lot) => {
      const [listings, orders] = await Promise.all([
        repository.listListingsInLot(lot.id),
        repository.listOrdersForLot(lot.id),
      ]);
      return {
        lot,
        listingCount: listings.length,
        orderCount: orders.length,
        unitCount: orders.reduce((sum, order) => sum + order.quantity, 0),
        weightGrams: orders.reduce((sum, o) => sum + o.quantity * o.unitWeightGrams, 0),
        valueMinor: orders.reduce((sum, o) => sum + o.quantity * o.unitPriceMinor, 0),
        // The packing tally, off the orders already in hand. Managing a lot
        // and tracking one were two screens asking for the same rows twice;
        // this is the same answer at no extra cost.
        tally: tally(orders),
      };
    }),
  );

  // Most recently touched first: the lot that just moved is the lot being
  // worked. Creation order would put a quiet old one above it.
  withContents.sort((a, b) => (a.lot.updatedAt < b.lot.updatedAt ? 1 : -1));

  // Listings not yet in any lot: the seller's to-do list.
  const all = await repository.listListings({ sellerId });
  return json(200, { lots: withContents, unassigned: all.filter((l) => l.lotId === null) });
}

/** POST /api/lots - open a new shipment lot. */
/**
 * What opening a lot needs to know.
 *
 * Shared by `POST /api/lots` and by the Orders screen, which opens a lot and
 * puts one order in it in a single move - so the rules about what a lot is
 * when it is created live in one place rather than in two that drift.
 */
export interface NewLotBody {
  name?: string;
  description?: string;
  origin?: string;
  estimatedDispatchAt?: string | null;
  supplierName?: string;
  supplierContact?: string;
  supplierReference?: string;
  forwarderUserId?: string;
  forwarderName?: string;
  forwarderContact?: string;
  /** A saved template to travel, or steps written here and now. */
  routeId?: string;
  routeName?: string;
  routeSteps?: { id?: string; name?: string; description?: string; side?: StepSide }[];
  /** Who checks it before it leaves, and who gets it out when it lands. */
  exporterHandle?: string;
  handlerUserId?: string;
  handlerName?: string;
}

/** Either the new lot, or the refusal to return to the caller. */
export type LotOrRefusal =
  | { lot: Lot; refusal: null }
  | { lot: null; refusal: { status: number; code: string; message: string } };

export async function buildLot(
  userId: string,
  body: NewLotBody,
  repository: Awaited<ReturnType<typeof getRepository>>,
): Promise<LotOrRefusal> {
  const refuse = (status: number, code: string, message: string): LotOrRefusal =>
    ({ lot: null, refusal: { status, code, message } });

  const name = body.name?.trim();
  if (!name) return refuse(400, 'invalid_lot', 'Give the lot a name you will recognise.');

  /* The ladder this lot travels, settled before anything is written: a lot
     created against a template that turns out not to exist should not exist
     either, tracking whatever the fallback happened to be. */
  let route: LotRoute = BUILT_IN_ROUTE;
  if (body.routeId) {
    const template = await repository.getRoute(userId, body.routeId);
    if (!template) return refuse(404, 'not_found', 'No such route.');
    // A copy, so editing the template later cannot rewrite this lot's
    // timeline under a buyer who has been reading it for three weeks.
    route = { routeId: template.id, name: template.name, steps: template.steps };
  } else if (body.routeSteps && body.routeSteps.length > 0) {
    const steps = normaliseSteps(body.routeSteps);
    if (steps.length < 2) return refuse(400, 'invalid_route', 'A route needs at least two steps.');
    route = { routeId: null, name: body.routeName?.trim() || 'Route', steps };
  }

  const id = `lot_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const first = route.steps[0]!;

  /* The two people who work it, named up front rather than found later on a
     different screen: naming them is part of opening a lot, and a form that
     asks afterwards is a form most sellers never come back to. */
  let exporterUserId: string | null = null;
  if (body.exporterHandle?.trim()) {
    const found = await repository.getByHandle(body.exporterHandle.trim().replace(/^@/, ''));
    if (!found) return refuse(404, 'not_found', `Nobody here goes by ${body.exporterHandle}.`);
    exporterUserId = found.user.id;
  }
  let handlerNamed: Lot['handler'] = null;
  if (body.handlerUserId || body.handlerName?.trim()) {
    const named = body.handlerUserId ? await repository.getUserById(body.handlerUserId) : null;
    if (body.handlerUserId && !named) {
      return refuse(404, 'not_found', 'No such account to handle this lot.');
    }
    const handlerName = body.handlerName?.trim()
      || named?.handlerProfile?.companyName || named?.displayName || '';
    if (handlerName) {
      handlerNamed = {
        handlerUserId: named?.id ?? null,
        name: handlerName,
        contact: named?.handlerProfile?.contactPhone || named?.handlerProfile?.contactEmail || null,
        city: named?.handlerProfile?.cities[0] ?? null,
      };
    }
  }

  const lot: Lot = {
    id,
    sellerId: userId,
    name,
    lotNumber: lotNumberFrom(id, now),
    route,
    currentStep: 0,
    exporterUserId,
    handler: handlerNamed,
    description: body.description?.trim() ?? '',
    origin: body.origin?.trim() ?? '',
    supplier: supplierFrom(body),
    status: 'open',
    stage: coarseStage(route, 0),
    stageHistory: [
      {
        stage: coarseStage(route, 0),
        step: first.name,
        enteredAt: now,
        note: 'Lot opened.',
        recordedBy: userId,
      },
    ],
    estimatedDispatchAt: body.estimatedDispatchAt ?? null,
    // Either picked from the directory or typed in; both are the same shape.
    forwarder: body.forwarderName
      ? {
          forwarderUserId: body.forwarderUserId ?? null,
          name: body.forwarderName,
          contact: body.forwarderContact ?? null,
          trackingReference: null,
        }
      : null,
    costModel: {
      currency: 'INR', goodsCostMinor: 0, freightMinor: 0, customsDutyMinor: 0,
      packagingMinor: 0, localShippingMinor: 0, totalWeightGrams: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  return { lot: await repository.createLot(lot), refusal: null };
}

async function createLot(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  let body: NewLotBody;
  try {
    body = (await request.json()) as NewLotBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const made = await buildLot(user.id, body, repository);
  if (made.refusal) return error(made.refusal.status, made.refusal.code, made.refusal.message);
  return json(201, { lot: made.lot });
}

/** Loads a lot and refuses anyone who is not its owner. */
export async function ownedLot(request: HttpRequest, lotId: string): Promise<{ lot: Lot; userId: string }> {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const lot = await repository.getLot(user.id, lotId);
  // Capability says "may sell"; ownership is the separate question.
  if (!lot) throw AuthError.forbidden('That lot is not yours.');
  return { lot, userId: user.id };
}

/** GET /api/lots/{id}/contents - the manifest: what is in this lot. */
async function lotContents(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot } = await ownedLot(request, id);
  const repository = await getRepository();

  const [listings, orders] = await Promise.all([
    repository.listListingsInLot(id),
    repository.listOrdersForLot(id),
  ]);

  // Who bought each item, because a manifest of anonymous rows is not something
  // a person can work from - and because the handler downstream gets the same
  // names, so the two screens agree about whose parcel is whose.
  const buyers = await repository.listUsersByIds([...new Set(orders.map((o) => o.buyerId))]);
  const byId = new Map(buyers.map((buyer) => [buyer.id, buyer]));
  const route = routeOf(lot);
  const step = currentStepOf(lot);

  return json(200, {
    lot,
    listings,
    orders,
    /** The ladder and where along it, resolved once for every screen that reads it. */
    route: {
      name: route.name,
      routeId: route.routeId,
      steps: route.steps,
      currentStep: step,
      /** Once the lot is with the seller, items are finished one at a time. */
      atSeller: atSellerYet(lot),
      lotNumber: lot.lotNumber ?? lotNumberFrom(lot.id, lot.createdAt),
    },
    /** The lot's own history: every step it took and every note written on it. */
    history: lot.stageHistory,
    items: orders.map((order) => ({
      id: order.id,
      itemName: order.itemName,
      condition: order.condition,
      quantity: order.quantity,
      status: order.status,
      buyerId: order.buyerId,
      buyerName: byId.get(order.buyerId)?.displayName ?? 'Unknown',
      buyerHandle: byId.get(order.buyerId)?.username ?? null,
      checkpoints: order.checkpoints ?? {},
      /** Where this one is, which is the lot's position unless it was moved alone. */
      currentStep: order.currentStep ?? step,
      /** True only when it was: the screen says so rather than implying it. */
      ownStep: typeof order.currentStep === 'number' && order.currentStep !== step,
      history: order.stageHistory,
    })),
    totals: {
      lines: orders.length,
      units: orders.reduce((sum, o) => sum + o.quantity, 0),
      weightGrams: orders.reduce((sum, o) => sum + o.quantity * o.unitWeightGrams, 0),
      valueMinor: orders.reduce((sum, o) => sum + o.quantity * o.unitPriceMinor, 0),
    },
  });
}

/** POST /api/lots/{id}/assign - tag listings into (or out of) this lot. */
async function assignToLot(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot, userId } = await ownedLot(request, id);

  let body: { listingIds?: string[]; remove?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (!Array.isArray(body.listingIds) || body.listingIds.length === 0) {
    return error(400, 'invalid_request', 'Pick at least one listing.');
  }

  const repository = await getRepository();
  const changed = await repository.assignListingsToLot(
    userId,
    body.listingIds,
    body.remove ? null : lot.id,
  );
  return json(200, { changed });
}

/**
 * POST /api/lots/{id}/stage - advance the lot one stage.
 *
 * The write that matters: it appends to the lot's history *and* to every order
 * inside it, which is what the buyer's tracking reads. Appending rather than
 * recomputing is what stops a re-tagged item rewinding someone's timeline.
 */
async function advanceStage(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot, userId } = await ownedLot(request, id);

  let body: { stage?: LotStage; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const target = body.stage;
  if (!target || !LOT_STAGES.includes(target)) {
    return error(400, 'invalid_stage', 'Unknown stage.');
  }
  if (LOT_STAGES.indexOf(target) <= LOT_STAGES.indexOf(lot.stage)) {
    return error(409, 'stage_not_forward', 'A lot can only move forward through its stages.');
  }

  // One lot, one position. This route names a stage and the route screen names
  // a step, and they are two doors onto the same thing: a lot advanced through
  // here without moving its step would read as still at the start, and every
  // buyer in it would be told nothing had happened.
  const route = routeOf(lot);
  const step = stepForStage(route, target);
  const now = new Date().toISOString();
  const event: StageEvent = {
    stage: target,
    step: route.steps[step]?.name,
    enteredAt: now,
    note: body.note?.trim() || null,
    recordedBy: userId,
  };

  const repository = await getRepository();
  const updated = await repository.updateLot({
    ...lot,
    stage: target,
    currentStep: step,
    stageHistory: [...lot.stageHistory, event],
    status: target === 'delivered' ? 'closed' : lot.status,
    updatedAt: now,
  });

  // Fan the event out to every order riding in this lot.
  const orders = await repository.listOrdersForLot(lot.id);
  await Promise.all(
    orders.map((order) =>
      repository.updateOrder({
        ...order,
        stage: target,
        stageHistory: [...order.stageHistory, event],
        status: target === 'delivered' ? 'delivered' : 'in_fulfilment',
        completedAt: target === 'delivered' ? now : order.completedAt,
        updatedAt: now,
      }),
    ),
  );

  // Every buyer in the lot, in one go. This is the notification the whole
  // product is really for: twenty people paid for one shipment weeks ago and
  // have no way of knowing it cleared customs unless somebody tells them.
  // Without this they ask the seller one at a time, which is the conversation
  // the channel exists to stop happening twenty times.
  await notify(
    repository,
    orders.map((order) => order.buyerId),
    {
      kind: 'lot_moved',
      title: `${lot.name}: ${LOT_STAGE_LABELS[target]}`,
      body: `${orders.length} ${orders.length === 1 ? 'order' : 'orders'} in this lot moved.`,
      // To their own order rather than to the lot, which is the seller's
      // view of it and shows them everybody else's purchases.
      link: '/me?tab=purchases',
    },
    { except: lot.sellerId },
  );

  return json(200, { lot: updated, ordersUpdated: orders.length });
}

/** POST /api/lots/{id}/tracking - record the forwarder's tracking reference. */
async function setTracking(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot } = await ownedLot(request, id);

  let body: { trackingReference?: string; forwarderName?: string; forwarderContact?: string; forwarderUserId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const name = body.forwarderName?.trim() || lot.forwarder?.name;
  if (!name) return error(400, 'invalid_request', 'Name the forwarder before adding tracking.');

  const repository = await getRepository();
  const updated = await repository.updateLot({
    ...lot,
    forwarder: {
      forwarderUserId: body.forwarderUserId ?? lot.forwarder?.forwarderUserId ?? null,
      name,
      contact: body.forwarderContact?.trim() ?? lot.forwarder?.contact ?? null,
      trackingReference: body.trackingReference?.trim() || null,
    },
    updatedAt: new Date().toISOString(),
  });
  return json(200, { lot: updated });
}

/**
 * POST /api/lots/{id}/crew - who else is working this lot.
 *
 * The forwarder is set with the tracking, because a tracking number without one
 * is meaningless. These two are not: an exporter is named before anything
 * moves, and a handler is named when it is about to land, so they get their own
 * door rather than riding along with a field neither of them fills in.
 *
 * Naming somebody is not making them staff. It grants exactly one thing - the
 * screen for their half of the job on this lot and no other - which is why a
 * shop can hand one run to a friend with a warehouse without giving them the
 * shop.
 */
async function setCrew(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot } = await ownedLot(request, id);

  let body: {
    handlerUserId?: string | null;
    handlerName?: string;
    handlerContact?: string;
    handlerCity?: string;
    exporterUserId?: string | null;
    /** An @handle instead of an id, which is how a shop knows their supplier. */
    exporterHandle?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const next: Lot = { ...lot, updatedAt: new Date().toISOString() };

  if (body.exporterHandle !== undefined) {
    // A shop knows its supplier by the name it messages them under, not by an
    // id it has never seen.
    const handle = body.exporterHandle?.trim().replace(/^@/, '') ?? '';
    if (!handle) {
      next.exporterUserId = null;
    } else {
      // A shop handle resolves to its owner, which is right: plenty of
      // suppliers here sell as well as pack.
      const found = await repository.getByHandle(handle);
      if (!found) return error(404, 'not_found', `Nobody here goes by @${handle}.`);
      next.exporterUserId = found.user.id;
    }
  } else if (body.exporterUserId !== undefined) {
    if (body.exporterUserId && !(await repository.getUserById(body.exporterUserId))) {
      return error(404, 'not_found', 'No such account to check this lot.');
    }
    next.exporterUserId = body.exporterUserId || null;
  }

  // The handler moves as a unit, the way the supplier does: a name clears it,
  // and naming one from the directory carries their id so the lot turns up on
  // their own screen rather than only in the shop's notes.
  if (body.handlerName !== undefined || body.handlerUserId !== undefined) {
    const named = body.handlerUserId
      ? await repository.getUserById(body.handlerUserId)
      : null;
    if (body.handlerUserId && !named) {
      return error(404, 'not_found', 'No such account to handle this lot.');
    }

    const name =
      body.handlerName?.trim()
      || named?.handlerProfile?.companyName
      || named?.displayName
      || '';

    next.handler = name
      ? {
          handlerUserId: named?.id ?? null,
          name,
          contact:
            body.handlerContact?.trim()
            || named?.handlerProfile?.contactPhone
            || named?.handlerProfile?.contactEmail
            || null,
          city: body.handlerCity?.trim() || named?.handlerProfile?.cities[0] || null,
        }
      : null;
  }

  return json(200, { lot: await repository.updateLot(next) });
}

/**
 * GET /api/orders/{id} - the buyer's view of one order.
 *
 * Deliberately says nothing about the lot: no lot name, no other buyers, no
 * unit counts. Just this order's own timeline, plus the tracking reference and
 * dispatch estimate, which are the only two lot facts a buyer needs.
 */
async function orderTracking(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'An order id is required.');

  const repository = await getRepository();
  const order = await repository.getOrder(id);
  if (!order) return error(404, 'not_found', 'No such order.');
  if (order.buyerId !== user.id && order.sellerId !== user.id) {
    throw AuthError.forbidden('That order is not yours.');
  }

  const lot = inLot(order) ? await repository.getLot(order.sellerId, order.lotId) : null;
  const sellers = await repository.listUsersByIds([order.sellerId]);

  /* The timeline the buyer reads is the lot's route, in the seller's own
     words. Without a lot there is no route to read, and the honest answer is
     what has happened plus the fact that it is waiting for one - not five
     hollow circles implying a journey nobody has booked yet. */
  const route = lot ? routeOf(lot) : null;

  /* The short ladder an item travels before it has a lot. Shown on its own,
     ending at a wall rather than at five hollow circles. Once there IS a
     lot this is not drawn at all: the lot's route already opens with the
     same two events, and drawing both put "at the China warehouse" on the
     screen twice, ticked in one ladder and hollow in the other. */
  const before = preLotRouteOf(order);
  const beforeReached = order.checkpoints?.china_received ? 1 : 0;

  /* Where the item is on its lot's ladder.
   *
   * The lot's own position is the floor, not the answer. A seller ticks
   * "China WH received" per item, and an item that has landed is past that
   * step whether or not the whole lot has been moved on yet. Taking the
   * furthest of the two is what stops the timeline contradicting the tick
   * the seller just made. */
  /*
   * The warehouse tick means the item has finished travelling alone, so it
   * sits on the last step before the lot takes over - read off the route's own
   * hand-over rather than off the seven coarse stages.
   *
   * The coarse mapping used to answer this and it overshot: on an eight-step
   * route the first step whose stage reached `china_wh_received` was
   * "Dispatched from China", so ticking a parcel into the warehouse told its
   * buyer the crate had left the country. A route is the seller's own list and
   * only it knows where the item stops being one item.
   */
  const reached = route && order.checkpoints?.china_received
    ? Math.max(0, Math.min(route.steps.length - 1, joinIndexOf(route) - 1))
    : 0;
  /* The item's own position wins over the lot's when it has one: a piece
     pulled for inspection while the crate cleared is genuinely somewhere
     else, and telling its buyer otherwise is the one lie this screen must
     never tell. The checkpoint stays a floor either way. */
  const position = route
    ? Math.max(order.currentStep ?? currentStepOf(lot!), reached)
    : 0;

  /*
   * The gap between the two ladders, which is a real place to be.
   *
   * An item can be done with everything that happens to it alone - counted
   * into the warehouse, waiting - while the lot it rides has not moved. Drawing
   * the next rung as current says the crate has dispatched; drawing nothing
   * says the item is stuck. It is neither: it is waiting for the lot, and that
   * is what the timeline says now.
   */
  const join = route ? joinIndexOf(route) : 0;
  const waiting = Boolean(
    route && position === join - 1 && currentStepOf(lot!) < join && join < route.steps.length,
  );

  return json(200, {
    order,
    stages: stagesFor(order),
    currentStage: furthestStage(order),
    preLot: { name: before.name, steps: before.steps, currentStep: beforeReached },
    route: route
      ? {
          name: route.name,
          steps: route.steps,
          currentStep: position,
          /** True while the item is done travelling alone and the lot has not moved. */
          waitingForLot: waiting,
          lotId: lot!.id,
          lotName: lot!.name,
          lotNumber: lot!.lotNumber ?? lotNumberFrom(lot!.id, lot!.createdAt),
        }
      : null,
    /** True while it is sold, bound for a lot, and not in one. */
    awaitingLot: awaitingLot(order),
    sellerName: sellers[0]?.sellerProfile?.storefrontName ?? sellers[0]?.displayName ?? 'Seller',
    // The only two things the lot contributes to the buyer's view.
    trackingReference: lot?.forwarder?.trackingReference ?? null,
    estimatedDispatchAt: lot?.estimatedDispatchAt ?? null,
  });
}

/**
 * The store a caller may work the lots of.
 *
 * Their own by default; a store they hold `lots` in when they name it. Returns
 * null when they hold nothing there, which every caller turns into a 403.
 */
async function lotsStoreFor(
  request: HttpRequest,
  user: { id: string },
  storeId: string | undefined,
): Promise<string | null> {
  if (!storeId || storeId === user.id) return user.id;
  const repository = await getRepository();
  const owner = await repository.getUserById(storeId);
  if (!owner?.sellerProfile) return null;
  return can(owner, user.id, 'lots') ? owner.id : null;
}

/**
 * GET /api/me/lots/board - the tracking screen.
 *
 * One card per lot, with the counts it is read by. Every number is derived from
 * the orders in the lot rather than stored on it, so a card can never claim
 * progress the items themselves have not made.
 */
async function lotsBoard(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  const sellerId = await lotsStoreFor(request, user, request.query.get('store') ?? undefined);
  if (!sellerId) return error(403, 'forbidden', 'You cannot work the lots in that store.');

  const repository = await getRepository();
  const lots = await repository.listLots({ sellerId });

  const cards = await Promise.all(
    lots.map(async (lot) => {
      const orders = await repository.listOrdersForLot(lot.id);
      return {
        lot: {
          id: lot.id,
          name: lot.name,
          stage: lot.stage,
          status: lot.status,
          origin: lot.origin ?? '',
          estimatedDispatchAt: lot.estimatedDispatchAt,
          updatedAt: lot.updatedAt,
        },
        tally: tally(orders),
      };
    }),
  );

  // Most recently touched first: the lot that just moved is the lot being
  // worked, which is what the board is for. Creation order would put a quiet
  // old lot above the one filling up right now.
  cards.sort((a, b) => b.lot.id.localeCompare(a.lot.id));
  cards.sort((a, b) => (a.lot.updatedAt < b.lot.updatedAt ? 1 : -1));
  return json(200, { lots: cards });
}

/**
 * GET /api/lots/{id}/board - one lot, grouped by customer.
 *
 * A parcel goes to a person, not to a line item, so the unit of work here is a
 * customer with all of their orders under them - which is how they get packed
 * and how they get dispatched.
 */
async function lotBoard(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const lotId = request.params.id;
  if (!lotId) return error(400, 'invalid_lot', 'A lot id is required.');

  const sellerId = await lotsStoreFor(request, user, request.query.get('store') ?? undefined);
  if (!sellerId) return error(403, 'forbidden', 'You cannot work the lots in that store.');

  const repository = await getRepository();
  const lot = await repository.getLot(sellerId, lotId);
  if (!lot) return error(404, 'not_found', 'No such lot.');

  const orders = await repository.listOrdersForLot(lot.id);
  const grouped = byCustomer(orders);
  const buyers = await repository.listUsersByIds([...grouped.keys()]);
  const byId = new Map(buyers.map((buyer) => [buyer.id, buyer]));

  const customers = [...grouped.entries()].map(([buyerId, theirs]) => {
    const buyer = byId.get(buyerId);
    return {
      buyerId,
      name: buyer?.displayName ?? 'Unknown',
      phone: buyer?.phone ?? null,
      orders: theirs.map((order) => ({
        id: order.id,
        itemName: order.itemName,
        condition: order.condition,
        quantity: order.quantity,
        unitWeightGrams: order.unitWeightGrams,
        checkpoints: order.checkpoints ?? {},
      })),
      trackingReference: lot.forwarder?.trackingReference ?? null,
    };
  });

  // Alphabetical: a packing list is worked through, not ranked.
  customers.sort((a, b) => a.name.localeCompare(b.name));

  return json(200, {
    lot: {
      id: lot.id,
      name: lot.name,
      /* The sayable identifier, as three sibling endpoints already send it.
         Without it this screen was the only place a lot appeared under its
         name alone, so a row elsewhere reading "LOT 26-832C" looked like a
         link to a different lot entirely. */
      lotNumber: lot.lotNumber ?? lotNumberFrom(lot.id, lot.createdAt),
      stage: lot.stage,
      status: lot.status,
      origin: lot.origin ?? '',
      estimatedDispatchAt: lot.estimatedDispatchAt,
    },
    tally: tally(orders),
    customers,
  });
}

/**
 * POST /api/orders/{id}/checkpoint - tick one item past one checkpoint.
 *
 * Ticking is not the same as advancing a stage: a stage is the consignment's
 * story for the buyer, and this is the seller counting boxes. Untickable too,
 * because the commonest correction on a packing floor is undoing a tick made on
 * the wrong row.
 */
async function setCheckpoint(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  // Only authenticated here. Who may tick what depends on which side of the
  // water they are on, and a packer abroad is not selling anything - gating
  // this on the seller capability would lock them out of their own job.
  const user = await auth.requireAuth(request);
  const orderId = request.params.id;
  if (!orderId) return error(400, 'invalid_order', 'An order id is required.');

  let body: { checkpoint?: OrderCheckpoint; on?: boolean; orderIds?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const checkpoint = body.checkpoint;
  if (!checkpoint || !ORDER_CHECKPOINTS.includes(checkpoint)) {
    return error(400, 'invalid_checkpoint', 'Name a checkpoint to tick.');
  }

  const repository = await getRepository();
  const order = await repository.getOrder(orderId);
  if (!order) return error(404, 'not_found', 'No such order.');

  const sellerId = await lotsStoreFor(request, user, order.sellerId);
  if (sellerId === order.sellerId) {
    // Working it as the store, which is a selling action like any other.
    if (!hasAnyCapability(user.capabilities, ['sell'])) {
      return error(403, 'forbidden', 'This action requires one of: sell.');
    }
  } else {
    // Not theirs to work as a seller. Two other people have business with this
    // order: whoever packs it in China, and whoever gets it out in India. Each
    // may tick their own half of the journey and nothing else - the ticks are
    // the record of work done, so the person who did it is the one who makes
    // them.
    const owner = await repository.getUserById(order.sellerId);
    const lot = await repository.getLot(order.sellerId, order.lotId);
    const role: CrewRole | null =
      (owner && can(owner, user.id, 'export')) || lot?.exporterUserId === user.id
        ? 'exporter'
        : lot && lot.handler?.handlerUserId === user.id
          ? 'handler'
          : null;

    if (!role) return error(403, 'forbidden', 'That order is not yours to work.');
    if (!mayTick(role, checkpoint)) {
      return error(
        403,
        'forbidden',
        role === 'exporter'
          ? 'You can mark items packed, and nothing else.'
          : 'You can work this lot from the moment it lands, and no earlier.',
      );
    }
  }

  const on = body.on !== false;
  const now = new Date().toISOString();
  order.checkpoints = { ...(order.checkpoints ?? {}), [checkpoint]: on ? now : null };
  order.updatedAt = now;

  // Dispatching is already recorded here, so the order takes its shipped state
  // from this tick rather than from a second screen saying the same thing. It
  // is also what starts the auto-release clock: the window has to open when the
  // box leaves, not when the buyer paid - an import can sit in a lot for weeks,
  // and a clock started at checkout would pay the seller for a box still with
  // their supplier.
  if (checkpoint === 'dispatched' && order.escrow.state === 'held') {
    order.status = on ? 'shipped' : 'confirmed';
    order.escrow = { ...order.escrow, autoReleaseAt: on ? daysFrom(AUTO_RELEASE_DAYS) : null };
    order.stageHistory = [
      ...order.stageHistory,
      {
        stage: order.stage,
        enteredAt: now,
        note: on ? 'Dispatched to the buyer.' : 'Dispatch un-marked.',
        recordedBy: user.id,
      },
    ];
  }

  const saved = await repository.updateOrder(order);
  const siblings = await repository.listOrdersForLot(order.lotId);
  return json(200, { order: { id: saved.id, checkpoints: saved.checkpoints ?? {} }, tally: tally(siblings) });
}

/**
 * GET /api/exporter/lots - the lots this account packs for somebody.
 *
 * The exporter is the supplier at the origin end: they hold `export` in a store
 * they do not own, and their whole job here is the packing list. They get the
 * lots and nothing else - no customers, no prices, no analytics.
 */
/**
 * The stages a lot is still the packer's to work.
 *
 * Once it has left China there is nothing for them to pack and no reason for
 * them to keep reading it, so the list and the lot itself agree on one rule
 * rather than each deciding for itself.
 */
const PACKABLE_STAGES: readonly LotStage[] = ['ordering', 'china_wh_received'];

async function exporterLots(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const rows: {
    store: { ownerId: string; name: string; handle: string | null };
    lot: unknown;
    tally: unknown;
  }[] = [];
  for (const owner of await repository.listStoreOwners()) {
    const standing = can(owner, user.id, 'export');
    const lots = await repository.listLots({ sellerId: owner.id });
    for (const lot of lots) {
      // Two ways to be here: the shop's standing packer, or named on this one
      // lot. The second is how a shop asks somebody to check a single run
      // without handing over the rest of the shop.
      if (!standing && lot.exporterUserId !== user.id) continue;
      // Only what is still on their side of the water.
      if (!PACKABLE_STAGES.includes(lot.stage)) continue;
      const orders = await repository.listOrdersForLot(lot.id);
      rows.push({
        store: {
          ownerId: owner.id,
          name: owner.sellerProfile?.storefrontName ?? owner.displayName,
          handle: owner.sellerProfile?.username ?? null,
        },
        lot: { id: lot.id, name: lot.name, stage: lot.stage, origin: lot.origin ?? '' },
        tally: tally(orders),
      });
    }
  }

  return json(200, { lots: rows });
}

/**
 * GET /api/exporter/lots/{id} - one lot as a packing list.
 *
 * A flat grid of items rather than the owner's customer-by-customer board: the
 * exporter packs pieces, and grouping by buyer would hand them a customer list
 * they have no business holding. Prices are left out for the same reason.
 */
async function exporterLot(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const lotId = request.params.id;
  if (!lotId) return error(400, 'invalid_lot', 'A lot id is required.');

  const repository = await getRepository();
  const owner = await findExportStoreFor(user.id, lotId, repository);
  if (!owner) return error(403, 'forbidden', 'You do not pack for that lot.');

  const lot = await repository.getLot(owner.id, lotId);
  if (!lot) return error(404, 'not_found', 'No such lot.');
  if (!PACKABLE_STAGES.includes(lot.stage)) {
    return error(403, 'forbidden', 'That lot has left China. There is nothing left to pack.');
  }

  const orders = await repository.listOrdersForLot(lot.id);
  return json(200, {
    // The handle too: telling the shop a crate has landed is a message, and
    // this screen is where the packer is standing when they need to send it.
    store: {
      ownerId: owner.id,
      name: owner.sellerProfile?.storefrontName ?? owner.displayName,
      handle: owner.sellerProfile?.username ?? null,
    },
    lot: { id: lot.id, name: lot.name, stage: lot.stage, origin: lot.origin ?? '' },
    tally: tally(orders),
    items: orders.map((order) => ({
      id: order.id,
      itemName: order.itemName,
      condition: order.condition,
      quantity: order.quantity,
      unitWeightGrams: order.unitWeightGrams,
      received: Boolean(order.checkpoints?.china_received),
      packed: Boolean(order.checkpoints?.china_packed),
    })),
  });
}

/** The store whose lot this is, when the caller packs for it. */
async function findExportStoreFor(userId: string, lotId: string, repository: Awaited<ReturnType<typeof getRepository>>) {
  for (const owner of await repository.listStoreOwners()) {
    const lot = await repository.getLot(owner.id, lotId);
    if (!lot) continue;
    // Named on the lot, or packing for the whole shop. Either way it is this
    // one lot they are being handed.
    if (lot.exporterUserId === userId || can(owner, userId, 'export')) return owner;
  }
  return null;
}

export const exporterLotsRoute = handler(exporterLots);
export const exporterLotRoute = handler(exporterLot);
export const lotsBoardRoute = handler(lotsBoard);
export const lotBoardRoute = handler(lotBoard);
export const setCheckpointRoute = handler(setCheckpoint);
export const myLotsRoute = handler(myLots);
export const createLotRoute = handler(createLot);
export const lotContentsRoute = handler(lotContents);
export const assignToLotRoute = handler(assignToLot);
export const advanceStageRoute = handler(advanceStage);
export const setTrackingRoute = handler(setTracking);
export const setCrewRoute = handler(setCrew);
export const updateLotDetailsRoute = handler(updateLotDetails);
export const orderTrackingRoute = handler(orderTracking);

const anon = { authLevel: 'anonymous' } as const;
app.http('lot-crew', { ...anon, methods: ['POST'], route: 'lots/{id}/crew', handler: setCrewRoute });
app.http('me-lots', { ...anon, methods: ['GET'], route: 'me/lots', handler: myLotsRoute });
app.http('lot-create', { ...anon, methods: ['POST'], route: 'lots', handler: createLotRoute });
app.http('lot-contents', { ...anon, methods: ['GET'], route: 'lots/{id}/contents', handler: lotContentsRoute });
app.http('lot-assign', { ...anon, methods: ['POST'], route: 'lots/{id}/assign', handler: assignToLotRoute });
app.http('lot-stage', { ...anon, methods: ['POST'], route: 'lots/{id}/stage', handler: advanceStageRoute });
app.http('lot-tracking', { ...anon, methods: ['POST'], route: 'lots/{id}/tracking', handler: setTrackingRoute });
app.http('lot-details', { ...anon, methods: ['POST'], route: 'lots/{id}/details', handler: updateLotDetailsRoute });
app.http('lots-board', { ...anon, methods: ['GET'], route: 'me/lots/board', handler: lotsBoardRoute });
app.http('lot-board', { ...anon, methods: ['GET'], route: 'lots/{id}/board', handler: lotBoardRoute });
app.http('order-checkpoint', { ...anon, methods: ['POST'], route: 'orders/{id}/checkpoint', handler: setCheckpointRoute });
app.http('exporter-lots', { ...anon, methods: ['GET'], route: 'exporter/lots', handler: exporterLotsRoute });
app.http('exporter-lot', { ...anon, methods: ['GET'], route: 'exporter/lots/{id}', handler: exporterLotRoute });
app.http('order-tracking', { ...anon, methods: ['GET'], route: 'orders/{id}', handler: orderTrackingRoute });
