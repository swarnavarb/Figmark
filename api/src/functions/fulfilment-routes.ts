import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { LOT_STAGES, ORDER_CHECKPOINTS, type LotStage, type OrderCheckpoint } from '../../../shared/enums.js';
import { byCustomer, tally } from '../../../shared/board.js';
import { can } from '../../../shared/stores.js';
import { DIRECT_LOT_ID, furthestStage, stagesFor } from '../../../shared/fulfilment.js';
import type { Lot, LotSupplier, Order, StageEvent } from '../../../shared/models.js';
import { AuthError } from '../auth/errors.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * Seller-side shipment batches.
 *
 * A lot groups the items a seller is moving in one consignment. Buyers never
 * see one: advancing a lot's stage appends an event to every order inside it,
 * and the buyer reads that from their own order.
 */

/** GET /api/me/lots - the seller's own batches, with what's in each. */
/**
 * Everything about a batch that is a description of it rather than a movement.
 *
 * Shared by create and edit so the two cannot drift: a field you can set when
 * opening a batch is a field you can correct afterwards, which is the whole
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
 * PATCH-ish update of a batch's details.
 *
 * Only the keys present in the body are touched, so editing the origin cannot
 * silently blank the supplier. The name is the one field that cannot be cleared:
 * it is how the seller finds the batch again.
 */
async function updateLotDetails(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const lotId = request.params.id;
  if (!lotId) return error(400, 'invalid_lot', 'A batch id is required.');

  let body: LotDetailsBody;
  try {
    body = (await request.json()) as LotDetailsBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  // Scoped to the caller's partition, so one seller cannot edit another's batch.
  const lot = await repository.getLot(user.id, lotId);
  if (!lot) return error(404, 'not_found', 'No such batch.');

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return error(400, 'invalid_lot', 'A batch needs a name you will recognise.');
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

  const lots = await repository.listLots({ sellerId: user.id });
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
      };
    }),
  );

  // Listings not yet in any batch: the seller's to-do list.
  const all = await repository.listListings({ sellerId: user.id });
  return json(200, { lots: withContents, unassigned: all.filter((l) => l.lotId === null) });
}

/** POST /api/lots - open a new shipment batch. */
async function createLot(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  let body: LotDetailsBody & { forwarderUserId?: string; forwarderName?: string; forwarderContact?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const name = body.name?.trim();
  if (!name) return error(400, 'invalid_lot', 'Give the batch a name you will recognise.');

  const now = new Date().toISOString();
  const lot: Lot = {
    id: `lot_${randomUUID().slice(0, 12)}`,
    sellerId: user.id,
    name,
    description: body.description?.trim() ?? '',
    origin: body.origin?.trim() ?? '',
    supplier: supplierFrom(body),
    status: 'open',
    stage: 'ordering',
    stageHistory: [{ stage: 'ordering', enteredAt: now, note: 'Batch opened.', recordedBy: user.id }],
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

  const repository = await getRepository();
  return json(201, { lot: await repository.createLot(lot) });
}

/** Loads a lot and refuses anyone who is not its owner. */
async function ownedLot(request: HttpRequest, lotId: string): Promise<{ lot: Lot; userId: string }> {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const lot = await repository.getLot(user.id, lotId);
  // Capability says "may sell"; ownership is the separate question.
  if (!lot) throw AuthError.forbidden('That batch is not yours.');
  return { lot, userId: user.id };
}

/** GET /api/lots/{id}/contents - the manifest: what is in this batch. */
async function lotContents(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot } = await ownedLot(request, id);
  const repository = await getRepository();

  const [listings, orders] = await Promise.all([
    repository.listListingsInLot(id),
    repository.listOrdersForLot(id),
  ]);

  return json(200, {
    lot,
    listings,
    orders,
    totals: {
      lines: orders.length,
      units: orders.reduce((sum, o) => sum + o.quantity, 0),
      weightGrams: orders.reduce((sum, o) => sum + o.quantity * o.unitWeightGrams, 0),
      valueMinor: orders.reduce((sum, o) => sum + o.quantity * o.unitPriceMinor, 0),
    },
  });
}

/** POST /api/lots/{id}/assign - tag listings into (or out of) this batch. */
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
 * POST /api/lots/{id}/stage - advance the batch one stage.
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
    return error(409, 'stage_not_forward', 'A batch can only move forward through its stages.');
  }

  const now = new Date().toISOString();
  const event: StageEvent = { stage: target, enteredAt: now, note: body.note?.trim() || null, recordedBy: userId };

  const repository = await getRepository();
  const updated = await repository.updateLot({
    ...lot,
    stage: target,
    stageHistory: [...lot.stageHistory, event],
    status: target === 'delivered' ? 'closed' : lot.status,
    updatedAt: now,
  });

  // Fan the event out to every order riding in this batch.
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
 * GET /api/orders/{id} - the buyer's view of one order.
 *
 * Deliberately says nothing about the batch: no lot name, no other buyers, no
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

  const lot = order.lotId === DIRECT_LOT_ID ? null : await repository.getLot(order.sellerId, order.lotId);
  const sellers = await repository.listUsersByIds([order.sellerId]);

  return json(200, {
    order,
    stages: stagesFor(order),
    currentStage: furthestStage(order),
    sellerName: sellers[0]?.sellerProfile?.storefrontName ?? sellers[0]?.displayName ?? 'Seller',
    // The only two things the batch contributes to the buyer's view.
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
  const user = await auth.requireCapability(request, ['sell']);
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
  if (sellerId !== order.sellerId) {
    return error(403, 'forbidden', 'That order is not yours to work.');
  }

  const on = body.on !== false;
  const now = new Date().toISOString();
  order.checkpoints = { ...(order.checkpoints ?? {}), [checkpoint]: on ? now : null };
  order.updatedAt = now;

  const saved = await repository.updateOrder(order);
  const siblings = await repository.listOrdersForLot(order.lotId);
  return json(200, { order: { id: saved.id, checkpoints: saved.checkpoints ?? {} }, tally: tally(siblings) });
}

export const lotsBoardRoute = handler(lotsBoard);
export const lotBoardRoute = handler(lotBoard);
export const setCheckpointRoute = handler(setCheckpoint);
export const myLotsRoute = handler(myLots);
export const createLotRoute = handler(createLot);
export const lotContentsRoute = handler(lotContents);
export const assignToLotRoute = handler(assignToLot);
export const advanceStageRoute = handler(advanceStage);
export const setTrackingRoute = handler(setTracking);
export const updateLotDetailsRoute = handler(updateLotDetails);
export const orderTrackingRoute = handler(orderTracking);

const anon = { authLevel: 'anonymous' } as const;
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
app.http('order-tracking', { ...anon, methods: ['GET'], route: 'orders/{id}', handler: orderTrackingRoute });
