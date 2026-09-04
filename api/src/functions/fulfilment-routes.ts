import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { LOT_STAGES, type LotStage } from '../../../shared/enums.js';
import { DIRECT_LOT_ID, furthestStage, stagesFor } from '../../../shared/fulfilment.js';
import type { Lot, Order, StageEvent } from '../../../shared/models.js';
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

  let body: { name?: string; description?: string; estimatedDispatchAt?: string; forwarderUserId?: string; forwarderName?: string; forwarderContact?: string };
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

export const myLotsRoute = handler(myLots);
export const createLotRoute = handler(createLot);
export const lotContentsRoute = handler(lotContents);
export const assignToLotRoute = handler(assignToLot);
export const advanceStageRoute = handler(advanceStage);
export const setTrackingRoute = handler(setTracking);
export const orderTrackingRoute = handler(orderTracking);

const anon = { authLevel: 'anonymous' } as const;
app.http('me-lots', { ...anon, methods: ['GET'], route: 'me/lots', handler: myLotsRoute });
app.http('lot-create', { ...anon, methods: ['POST'], route: 'lots', handler: createLotRoute });
app.http('lot-contents', { ...anon, methods: ['GET'], route: 'lots/{id}/contents', handler: lotContentsRoute });
app.http('lot-assign', { ...anon, methods: ['POST'], route: 'lots/{id}/assign', handler: assignToLotRoute });
app.http('lot-stage', { ...anon, methods: ['POST'], route: 'lots/{id}/stage', handler: advanceStageRoute });
app.http('lot-tracking', { ...anon, methods: ['POST'], route: 'lots/{id}/tracking', handler: setTrackingRoute });
app.http('order-tracking', { ...anon, methods: ['GET'], route: 'orders/{id}', handler: orderTrackingRoute });
