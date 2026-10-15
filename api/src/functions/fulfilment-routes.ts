import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { LOT_STAGES, LOT_STAGE_LABELS, ORDER_CHECKPOINTS, type LotStage, type OrderCheckpoint } from '../../../shared/enums.js';
import { byCustomer, tally } from '../../../shared/board.js';
import { hasAnyCapability } from '../../../shared/capabilities.js';
import { can } from '../../../shared/stores.js';
import { TAGGED_ROLES, crewMayPress, crewSlots, hasArrived, photosFor, readyGated, supplierIdOf, type CrewRole } from '../../../shared/services.js';
import { preLotRouteOf } from '../../../shared/templates.js';
import {
  atSellerYet, coarseStage, currentStepOf, lotNo, lotNumberFrom, normaliseSteps,
  itemStepOn, joinIndexOf, lotEndIndex, lotOffset, routeJoinsLot, routeOf, stepForStage, stepTickKey, triggeredStep,
  type LotRoute, type RouteStep, type StageIcon, type StepSide, type StepTrigger, ticksOf
} from '../../../shared/routes.js';
import { COUNTRIES } from '../../../shared/countries.js';
import { UNDO_EXPIRED, canUndo, undoTag, withoutUndo } from './undo.js';
import { RECEIVED_AS_MAX, ladderBeforeLot, withButtons, withReceivedAs } from '../../../shared/buttons.js';
import { NOT_ACCEPTED_MESSAGE, awaitingAcceptance, daysFrom, isCancelledLike, isStopped } from '../../../shared/orders.js';
import {
  AWAITING_LOT_ID, awaitingLot, furthestStage, inLot, lotPhase, settledHistory, stagesFor,
} from '../../../shared/fulfilment.js';
import type { Lot, LotCrewSettings, LotSupplier, Order, StageEvent } from '../../../shared/models.js';
import { AuthError } from '../auth/errors.js';
import { getAuthService } from '../auth/index.js';
import { bookingFor, forwarderWorks } from '../service-access.js';
import { getRepository } from '../data/index.js';
import { mapLimit, tellLot } from '../data/lot-view.js';
import {
  afterDelivered, deliver, dropFromCollection, isDeliveryLocked, lockedReason, syncLotDelivery, undeliver,
} from '../delivery.js';
import { autoReleaseDays } from '../settings.js';
import { offersAffiliate } from '../affiliate.js';
import { linkDiscountMinor } from '../../../shared/affiliate.js';
import { storeTag } from '../../../shared/storefront.js';
import { capital, notify, notifyBuyers } from './notify.js';
import { messageFromShop } from './message-routes.js';
import { threadIdFor } from '../../../shared/handles.js';
import { orderMoney, rupees } from '../../../shared/payments.js';
import { error, handler, json } from './http.js';

/** What to write on the timeline when a checkpoint is ticked. */
const CHECKPOINT_EVENT_TEXT: Record<OrderCheckpoint, string> = {
  china_received: 'Received at the international warehouse.',
  china_packed: 'Packed at the international warehouse.',
  india_received: 'Received at the India warehouse.',
  ready_to_dispatch: 'Ready to dispatch.',
  packed: 'Packed.',
  dispatched: 'Dispatched to the buyer.',
  delivered: 'Delivered.',
};

/**
 * Which rung a checkpoint's note belongs under.
 *
 * A lot's own route reliably tags its steps with the checkpoint that reaches
 * them (`trigger`), so that lookup works there. The built-in pre-lot route
 * does not - it is two fixed steps with no triggers at all, and the second
 * one simply *is* "received at the warehouse" by construction, the same way
 * `beforeReached` below already assumes. A custom pre-lot route from a
 * template can go either way, so the trigger is tried first regardless.
 */
function stepForCheckpoint(
  steps: RouteStep[], checkpoint: OrderCheckpoint, order: Pick<Order, 'lotId'>,
): RouteStep | undefined {
  return steps.find((step) => step.trigger === checkpoint)
    ?? (!inLot(order) && checkpoint === 'china_received' ? steps.at(-1) : undefined);
}

/**
 * The route steps an order is worked along: its lot's, or - before it has a
 * lot - the before-lot half of the route its listing chose.
 */
async function routeStepsOf(
  repository: Awaited<ReturnType<typeof getRepository>>,
  order: Order,
  lot: Lot | null,
): Promise<RouteStep[]> {
  if (lot) return routeOf(lot).steps;
  const listing = await repository.getListing(order.listingId);
  const template = listing?.lotRouteId ? await repository.getRoute(order.sellerId, listing.lotRouteId) : null;
  return ladderBeforeLot(order, template).steps;
}

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
  originCountry?: string;
  destinationCountry?: string;
  estimatedDispatchAt?: string | null;
  supplierName?: string;
  /** Their account here, by handle. Empty clears the tag and keeps the name. */
  supplierHandle?: string;
  supplierContact?: string;
  supplierReference?: string;
}

/** Null unless a supplier was actually named; a contact alone is not one. */
function supplierFrom(body: LotDetailsBody, supplierUserId?: string | null): LotSupplier | null {
  const name = body.supplierName?.trim();
  if (!name && !supplierUserId) return null;
  return {
    name: name || '',
    contact: body.supplierContact?.trim() || null,
    reference: body.supplierReference?.trim() || null,
    supplierUserId: supplierUserId ?? null,
  };
}

/**
 * The account behind a handle somebody typed, or a refusal.
 *
 * `null` for an empty field, which means "no account behind this name" rather
 * than an error: naming a supplier who is not here is the common case.
 */
async function userForHandle(
  handle: string | undefined,
  repository: Awaited<ReturnType<typeof getRepository>>,
): Promise<{ id: string | null; missing: string | null; shop?: boolean }> {
  const wanted = handle?.trim().replace(/^@/, '');
  if (!wanted) return { id: null, missing: null };
  const found = await repository.getByHandle(wanted);
  if (!found) return { id: null, missing: wanted };
  // A shop is not a person who can pack a crate or open a parcel: the crew is
  // tagged by their own handle, which is what their My services hangs off.
  if (found.isStore) return { id: null, missing: wanted, shop: true };
  return { id: found.user.id, missing: null };
}

/** The refusal for a handle that could not be tagged. */
function untaggable(tagged: { missing: string | null; shop?: boolean }) {
  return tagged.shop
    ? error(400, 'not_a_person', `@${tagged.missing} is a shop. Tag the person by their own handle.`)
    : error(404, 'not_found', `Nobody here goes by @${tagged.missing}.`);
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
  if (body.originCountry !== undefined) {
    const value = body.originCountry.trim();
    if (value && !COUNTRIES.includes(value)) return error(400, 'invalid_lot', 'Pick a country from the list.');
    lot.originCountry = value || undefined;
  }
  if (body.destinationCountry !== undefined) {
    const value = body.destinationCountry.trim();
    if (value && !COUNTRIES.includes(value)) return error(400, 'invalid_lot', 'Pick a country from the list.');
    lot.destinationCountry = value || undefined;
  }
  if (body.estimatedDispatchAt !== undefined) lot.estimatedDispatchAt = body.estimatedDispatchAt;
  // The supplier moves as a unit: naming one sets it, clearing the name drops it.
  if (body.supplierName !== undefined || body.supplierHandle !== undefined) {
    const tagged = await userForHandle(body.supplierHandle, repository);
    if (tagged.missing) return untaggable(tagged);
    lot.supplier = supplierFrom(
      { ...body, supplierName: body.supplierName ?? lot.supplier?.name },
      tagged.id ?? (body.supplierHandle === undefined ? lot.supplier?.supplierUserId ?? null : null),
    );
  }

  lot.updatedAt = new Date().toISOString();
  return json(200, { lot: await repository.updateLot(lot) });
}

/** Cancelled, turned down, or cancelled and refunded: listed, never counted. */
const countsAsOrder = (order: Pick<Order, 'status'>) =>
  order.status !== 'cancelled' && order.status !== 'rejected' && order.status !== 'cancelled_reversed';

async function myLots(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();

  // A manager works the shop's consignments, not their own, where the shop has
  // granted them that.
  const sellerId = await lotsStoreFor(request, user, request.query.get('store') ?? undefined);
  if (!sellerId) return error(403, 'forbidden', 'You cannot work the lots in that store.');

  /* Three reads for the whole shop rather than two per lot: every lot, every
     order and every listing, grouped here. A shop with thirty lots used to cost
     sixty-one queries to draw this screen. */
  const [lots, allOrders, allListings] = await Promise.all([
    repository.listLots({ sellerId }),
    repository.listOrdersForSeller(sellerId),
    repository.listListings({ sellerId, includeHidden: true, limit: 10_000 }),
  ]);
  const ordersByLot = groupBy(allOrders, (order) => order.lotId);
  const listingsByLot = groupBy(allListings, (listing) => listing.lotId);

  const withContents = lots.map((lot) => {
    const listings = listingsByLot.get(lot.id) ?? [];
    /* A cancelled or turned-down order is still listed in the lot, but it is
       not an order anybody is sending: it is not counted. */
    const orders = (ordersByLot.get(lot.id) ?? []).filter(countsAsOrder);
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
  });

  // Most recently touched first: the lot that just moved is the lot being
  // worked. Creation order would put a quiet old one above it.
  withContents.sort((a, b) => (a.lot.updatedAt < b.lot.updatedAt ? 1 : -1));

  // Listings on sale and not yet in any lot: the seller's to-do list.
  /* Only imports: an item shipping from the shelf never needs a lot, and
     listing it here made a seller think something was wrong with it. */
  const unassigned = allListings.filter((l) =>
    l.status === 'active' && !l.unlisted && l.lotId === null && l.sourcing === 'import');
  /* Sold, bound for a lot, and in none - the orders actually waiting on the
     seller, which is what the Lots screen asks them to act on. */
  const awaitingOrders = allOrders.filter((order) =>
    order.lotId === AWAITING_LOT_ID && !isCancelledLike(order.status)).length;
  return json(200, { lots: withContents, unassigned, awaitingOrders });
}

/** Rows grouped by a key, in the order they came. */
function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return groups;
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
  /** Required: the two countries this lot travels between, e.g. "China" -> "India". */
  originCountry?: string;
  destinationCountry?: string;
  estimatedDispatchAt?: string | null;
  supplierName?: string;
  /** Their account here, by handle. Empty clears the tag and keeps the name. */
  supplierHandle?: string;
  supplierContact?: string;
  supplierReference?: string;
  forwarderUserId?: string;
  forwarderName?: string;
  forwarderContact?: string;
  /** A saved template to travel, or steps written here and now. */
  routeId?: string;
  routeName?: string;
  routeSteps?: {
    id?: string; name?: string; description?: string; side?: StepSide; trigger?: StepTrigger;
    stageId?: string; stageName?: string; stageIcon?: string; locked?: boolean; forward?: boolean;
  }[];
  /** Who gets it out when it lands. The supplier is named above. */
  handlerUserId?: string;
  /** The handler's handle here, tagged as the supplier's is. */
  handlerHandle?: string;
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

  // Required: the name is how a shop tells its lots apart at a glance; the
  // number beside it is only the tiebreak.
  const name = body.name?.trim();
  if (!name) return refuse(400, 'invalid_lot', 'Give this lot a name.');

  const originCountry = body.originCountry?.trim();
  const destinationCountry = body.destinationCountry?.trim();
  if (!originCountry || !destinationCountry) {
    return refuse(400, 'invalid_lot', 'Pick where this lot is coming from and going to.');
  }
  if (!COUNTRIES.includes(originCountry) || !COUNTRIES.includes(destinationCountry)) {
    return refuse(400, 'invalid_lot', 'Pick a country from the list.');
  }

  /* The ladder this lot travels, settled before anything is written: a lot
     created against a template that turns out not to exist should not exist
     either, tracking whatever the fallback happened to be. */
  // Required: a lot's route is its buyers' tracking, so none opens without one.
  if (!body.routeId && !(body.routeSteps && body.routeSteps.length > 0)) {
    return refuse(400, 'route_required', 'Pick a route for this lot: one of yours, a new one, or a sample.');
  }
  let route: LotRoute;
  if (body.routeId) {
    const template = await repository.getRoute(userId, body.routeId);
    if (!template) return refuse(404, 'not_found', 'No such route.');
    if (!routeJoinsLot(template)) {
      return refuse(400, 'invalid_route', 'That route never joins a lot - it is for items shipped one by one. Pick a route with steps in the lot.');
    }
    // A copy, so editing the template later cannot rewrite this lot's
    // timeline under a buyer who has been reading it for three weeks.
    // Given its buttons on the way in, so a template saved before they were
    // handed out still travels with them in order.
    route = { routeId: template.id, name: template.name, steps: withButtons(template.steps) };
  } else {
    const steps = normaliseSteps(
      body.routeSteps!.map((step) => ({ ...step, stageIcon: step.stageIcon as StageIcon | undefined })),
    );
    if (steps.length < 2) return refuse(400, 'invalid_route', 'A route needs at least two steps.');
    route = { routeId: null, name: body.routeName?.trim() || 'Route', steps: withButtons(steps) };
  }

  const id = `lot_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  const lotNumber = lotNumberFrom(id, now);
  /*
   * A new lot has not taken any of its own steps yet.
   *
   * It used to open at step zero, which on any route with a pre-lot half is a
   * step that happens to one item - so a crate nobody had touched claimed the
   * first parcel's order had been placed. It opens one short of its own first
   * step instead: open, filling, nothing dispatched.
   */
  const opensAt = Math.max(0, lotOffset(route) - 1);
  /* Its coarse stage is the beginning, not whatever the step it sits above
     happens to mean. `currentStep` says where on the ladder it is; `stage` is
     the one-word summary older screens read, and the summary of a lot nobody
     has dispatched is that it is being ordered. */
  const opensAs = coarseStage(route, 0);

  /* The two people who work it, named up front rather than found later on a
     different screen: naming them is part of opening a lot, and a form that
     asks afterwards is a form most sellers never come back to. */
  const tagRefusal = (tagged: { missing: string | null; shop?: boolean }) => tagged.shop
    ? refuse(400, 'not_a_person', `@${tagged.missing} is a shop. Tag the person by their own handle.`)
    : refuse(404, 'not_found', `Nobody here goes by @${tagged.missing}.`);
  const supplierTagged = await userForHandle(body.supplierHandle, repository);
  if (supplierTagged.missing) return tagRefusal(supplierTagged);
  const supplierTag: string | null = supplierTagged.id;
  let handlerNamed: Lot['handler'] = null;
  if (body.handlerUserId || body.handlerHandle?.trim() || body.handlerName?.trim()) {
    let handlerId = body.handlerUserId ?? null;
    if (body.handlerHandle?.trim()) {
      const tagged = await userForHandle(body.handlerHandle, repository);
      if (tagged.missing) return tagRefusal(tagged);
      handlerId = tagged.id;
    }
    const named = handlerId ? await repository.getUserById(handlerId) : null;
    if (handlerId && !named) {
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
    lotNumber,
    route,
    currentStep: opensAt,
    handler: handlerNamed,
    description: body.description?.trim() ?? '',
    origin: body.origin?.trim() ?? '',
    originCountry,
    destinationCountry,
    supplier: supplierFrom(body, supplierTag),
    status: 'open',
    stage: opensAs,
    stageHistory: [
      {
        stage: opensAs,
        // No step: opening a lot is not one of the lot's steps, it is the
        // thing that has to happen before the first of them can.
        enteredAt: now,
        kind: 'note',
        note: 'Lot opened.',
        recordedBy: userId,
      },
    ],
    estimatedDispatchAt: body.estimatedDispatchAt ?? null,
    // Either picked from the directory or typed in; both are the same shape.
    // A store named here is booked the way the store says; see `bookingFor`.
    forwarder: body.forwarderName
      ? {
          ...(await bookingFor(await getRepository(), body.forwarderUserId)),
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
      /**
       * Where the lot's own half of the route starts.
       *
       * The lot's screen draws from here on: a lot never gets "received at the
       * warehouse", its items do. The items' own ladders still draw the whole
       * route, because an item travels both halves.
       */
      offset: lotOffset(route),
      /** Once the lot is with the seller, items are finished one at a time. */
      atSeller: atSellerYet(lot),
      lotNumber: lotNo(lot.lotNumber) ?? lotNumberFrom(lot.id, lot.createdAt),
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
      /** Every press, custom buttons included, keyed as the route's buttons are. */
      ticks: ticksOf(order),
      /** Its own word for where it was received, which renames that button. */
      receivedAs: order.receivedAs ?? null,
      /** Where this item is on the lot's route: the lot's, its own, or what it has done. */
      currentStep: itemStepOn(
        route, step, order.currentStep, ticksOf(order),
      ),
      /**
       * True only when the seller really did move this one away from the rest.
       *
       * Against where the item would be anyway - its buttons, and the lot when
       * the lot is carrying anything - rather than against the lot's raw
       * position, which while filling sits in the half of the route that
       * happens to one item at a time and made every new item look diverted.
       */
      ownStep: typeof order.currentStep === 'number'
        && order.currentStep !== itemStepOn(route, step, undefined, ticksOf(order)),
      /** Done travelling alone, and the lot has not moved: a real place to be. */
      waitingForLot:
        itemStepOn(route, step, order.currentStep, ticksOf(order)) === lotOffset(route) - 1
        && step < lotOffset(route)
        && lotOffset(route) < route.steps.length,
      history: order.stageHistory,
    })),
    /* Called-off orders stay on the manifest above but are not counted. */
    totals: {
      lines: orders.filter(countsAsOrder).length,
      units: orders.filter(countsAsOrder).reduce((sum, o) => sum + o.quantity, 0),
      weightGrams: orders.filter(countsAsOrder).reduce((sum, o) => sum + o.quantity * o.unitWeightGrams, 0),
      valueMinor: orders.filter(countsAsOrder).reduce((sum, o) => sum + o.quantity * o.unitPriceMinor, 0),
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
  // A landed lot is unpacked and its items go out one by one, so the crate is
  // never "delivered" as a whole: each item is, and the lot closes itself once
  // the last of them has.
  if (target === 'delivered' || stepForStage(routeOf(lot), target) > lotEndIndex(routeOf(lot))) {
    return error(
      409,
      'deliver_individually',
      'After a lot is unpacked each item is dispatched and delivered on its own. Mark the items delivered one by one.',
    );
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

  // The lot alone: every order still riding in it reads the move off the lot
  // (data/lot-view.ts). Called-off orders stay as they are, and an item
  // already delivered on its own has left the crate - the crate's later news
  // is not about it.
  const repository = await getRepository();
  const updated = await repository.updateLot({
    ...lot,
    stage: target,
    currentStep: step,
    ...tellLot(lot, event, { moved: true }),
    updatedAt: now,
  });

  const orders = (await repository.listOrdersForLot(lot.id))
    .filter((order) => !isStopped(order.status) && order.status !== 'delivered');

  // Every buyer in the lot, in one go. This is the notification the whole
  // product is really for: twenty people paid for one shipment weeks ago and
  // have no way of knowing it cleared customs unless somebody tells them.
  // Without this they ask the seller one at a time, which is the conversation
  // the channel exists to stop happening twenty times.
  // To their own order rather than to the lot, which is the seller's view of
  // it and shows them everybody else's purchases.
  await notifyBuyers(
    repository,
    orders,
    ({ items, shop }) => ({
      kind: 'lot_moved',
      title: `${capital(items)} from ${shop}: ${LOT_STAGE_LABELS[target]}`,
      body: `Travelling with ${lot.name}. Tap to see where it is.`,
    }),
    { except: lot.sellerId, track: lot.id },
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
  // Naming a different store here would skip its say in taking the lot, so a
  // change of store goes through the booking; this keeps whatever is booked.
  const switching = body.forwarderUserId && body.forwarderUserId !== lot.forwarder?.forwarderUserId;
  const updated = await repository.updateLot({
    ...lot,
    forwarder: {
      ...(lot.forwarder ?? {}),
      ...(switching ? await bookingFor(repository, body.forwarderUserId) : { forwarderUserId: lot.forwarder?.forwarderUserId ?? null }),
      name,
      contact: body.forwarderContact?.trim() ?? lot.forwarder?.contact ?? null,
      trackingReference: body.trackingReference?.trim() || null,
    },
    updatedAt: new Date().toISOString(),
  });
  return json(200, { lot: updated });
}

/**
 * POST /api/lots/{id}/crew - who takes the lot when it lands.
 *
 * The forwarder is set with the tracking, because a tracking number without one
 * is meaningless, and the supplier is set with the supplier's own details. The
 * handler is neither: they are named when the lot is about to land, so they get
 * their own door rather than riding along with a field nobody fills in at the
 * same time.
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
    /** Their handle here, tagged the way a supplier is: what gives them a screen. */
    handlerHandle?: string | null;
    handlerName?: string;
    handlerContact?: string;
    handlerCity?: string;
    /** Tick keys, or null to go back to the role's stock buttons. */
    supplierButtons?: string[] | null;
    handlerButtons?: string[] | null;
    handlerSeesPayment?: boolean;
    readyGate?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const next: Lot = { ...lot, updatedAt: new Date().toISOString() };

  // The handler moves as a unit, the way the supplier does: a name clears it,
  // and naming one from the directory carries their id so the lot turns up on
  // their own screen rather than only in the shop's notes.
  if (body.handlerName !== undefined || body.handlerUserId !== undefined || body.handlerHandle !== undefined) {
    // Tagged by handle, as the supplier is; an id still works for older callers.
    const tagged = await userForHandle(body.handlerHandle ?? undefined, repository);
    if (tagged.missing) return untaggable(tagged);
    // A blank handle keeps whoever is already tagged; only a name change or a
    // new handle moves the seat.
    const keep = body.handlerHandle === undefined || body.handlerHandle === null || body.handlerHandle.trim() === ''
      ? (body.handlerUserId === undefined ? lot.handler?.handlerUserId ?? null : body.handlerUserId)
      : null;
    const wantedId = tagged.id ?? keep;
    const named = wantedId ? await repository.getUserById(wantedId) : null;
    if (wantedId && !named) {
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

  /* What the two of them may press and see. "Ready to dispatch" is never on
     the handler's side - the seller clears every customer - so a readyGate
     sent by an older screen changes nothing. */
  const crew: LotCrewSettings = { ...(lot.crew ?? {}) };
  delete crew.readyGate;
  if (typeof body.handlerSeesPayment === 'boolean') crew.handlerSeesPayment = body.handlerSeesPayment;
  for (const role of TAGGED_ROLES) {
    const field = role === 'supplier' ? 'supplierButtons' : 'handlerButtons';
    const wanted = body[field];
    if (wanted === undefined) continue;
    if (wanted === null) {
      delete crew[field];
      continue;
    }
    if (!Array.isArray(wanted) || wanted.some((key) => typeof key !== 'string')) {
      return error(400, 'invalid_buttons', 'Send the buttons as a list.');
    }
    const slots = new Set(crewSlots({ ...next, crew }, role).map((slot) => slot.key));
    const stray = wanted.find((key) => !slots.has(key));
    if (stray) {
      return error(400, 'invalid_buttons', role === 'supplier'
        ? 'A supplier can only be handed buttons from before the item joins the lot.'
        : 'A handler can only be handed buttons from after the item leaves the lot, and never Delivered.');
    }
    crew[field] = [...new Set(wanted)];
  }
  // The ready press is the seller's: never kept on a handler's list.
  if (crew.handlerButtons) crew.handlerButtons = crew.handlerButtons.filter((key) => key !== 'ready_to_dispatch');
  next.crew = crew;

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
  const listing = await repository.getListing(order.listingId);
  const leadPhoto = listing?.photos.find((photo) => photo.isPrimary) ?? listing?.photos[0] ?? null;

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
  const template = !lot && listing?.lotRouteId ? await repository.getRoute(order.sellerId, listing.lotRouteId) : null;
  const ladder = ladderBeforeLot(order, template);
  const before = { ...ladder, steps: withReceivedAs(ladder.steps, order.receivedAs) };

  /*
   * Older orders ticked a checkpoint before every tick wrote a dated note of
   * its own - the flag on the order is real, but nothing on the timeline
   * ever said when. Filled in here, at read time, rather than by rewriting
   * stored history: synthesised only for a checkpoint with no matching note
   * already on the order, so a tick recorded properly is never duplicated.
   */
  const stepsForNotes = route ? route.steps : before.steps;
  const notedTexts = new Set(order.stageHistory.map((event) => event.note));
  const healedHistory: StageEvent[] = [
    ...order.stageHistory,
    ...ORDER_CHECKPOINTS.filter((checkpoint) => order.checkpoints?.[checkpoint] && !notedTexts.has(CHECKPOINT_EVENT_TEXT[checkpoint])
      // Received in the seller's own words is a recorded tick too.
      && !(checkpoint === 'china_received' && order.receivedAs && notedTexts.has(`${order.receivedAs}.`)))
      .map((checkpoint) => ({
        stage: order.stage,
        step: stepForCheckpoint(stepsForNotes, checkpoint, order)?.name,
        enteredAt: order.checkpoints![checkpoint]!,
        note: CHECKPOINT_EVENT_TEXT[checkpoint],
        recordedBy: order.sellerId,
      })),
  ];
  // A step that can still be undone is in effect but on no timeline yet.
  const orderForClient = {
    ...order,
    stageHistory: settledHistory(healedHistory),
    // The buyer sees the photos the shop shared with them, and no others.
    photos: order.sellerId === user.id ? order.photos ?? [] : photosFor(order, 'buyer'),
  };

  /*
   * A checkpoint that has been ticked has happened.
   *
   * It used to be handed over as the current step, so an item counted into the
   * warehouse showed that arrival as in progress - a fact drawn as a promise.
   * The arrival is done; what is actually in progress is the wait for a lot,
   * and that is what the screen says.
   */
  const beforeDone = Boolean(order.checkpoints?.china_received);
  // The furthest of its own buttons pressed - the warehouse tick, or the
  // packing one after it where the route has one.
  const beforeReached = Math.max(0, triggeredStep(before, ticksOf(order)));

  /*
   * Where the item is on its lot's ladder: the lot's position, its own when it
   * has been moved alone, and the floor set by what it has physically done -
   * furthest wins. A piece pulled for inspection while the crate cleared is
   * genuinely somewhere else, and telling its buyer otherwise is the one lie
   * this screen must never tell.
   */
  const position = route
    ? itemStepOn(
        route, currentStepOf(lot!), order.currentStep,
        ticksOf(order),
      )
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
    order: orderForClient,
    stages: stagesFor(order),
    currentStage: furthestStage(order),
    preLot: {
      name: before.name,
      steps: before.steps,
      currentStep: beforeReached,
      /** Everything it does alone is done; the wait for a lot is what is left. */
      waitingForLot: beforeDone && !route,
    },
    route: route
      ? {
          name: route.name,
          // Its own words for where it was received, carried into the lot.
          steps: withReceivedAs(route.steps, order.receivedAs),
          currentStep: position,
          /** True while the item is done travelling alone and the lot has not moved. */
          waitingForLot: waiting,
          lotId: lot!.id,
          lotName: lot!.name,
          lotNumber: lot!.lotNumber ?? lotNumberFrom(lot!.id, lot!.createdAt),
          originCountry: lot!.originCountry ?? null,
          destinationCountry: lot!.destinationCountry ?? null,
          /** The lot as a whole, in a few words: filling, closed, in transit, received. */
          lotPhase: lotPhase(lot!),
        }
      : null,
    /** True while it is sold, bound for a lot, and not in one. */
    awaitingLot: awaitingLot(order),
    sellerName: sellers[0]?.sellerProfile?.storefrontName ?? sellers[0]?.displayName ?? 'Seller',
    /** The shop as a shared picture signs it: its picture and level. */
    sellerBadge: sellers[0] ? {
      photoUrl: sellers[0].sellerProfile?.photoUrl ?? null,
      ...storeTag(sellers[0].sellerProfile?.levelCache ?? 1),
    } : null,
    // The only two things the lot contributes to the buyer's view.
    trackingReference: lot?.forwarder?.trackingReference ?? (order.shipment?.awb || null),
    estimatedDispatchAt: lot?.estimatedDispatchAt ?? null,
    // For the Details tab's product card - the listing as it is now, not the
    // order's own frozen snapshot, so a photo added after the sale still shows.
    listing: listing ? {
      id: listing.id, title: listing.title, photoUrl: leadPhoto?.url ?? null,
      // What a shared picture of this order says: how full the group buy is,
      // and whether a link to it pays whoever shares it.
      preOrder: listing.preOrder ? {
        joined: listing.preOrder.filledCount + (listing.preOrder.pledgedCount ?? 0),
        threshold: listing.preOrder.fillThreshold,
        cutoffAt: listing.preOrder.cutoffAt,
      } : null,
      affiliate: offersAffiliate(listing),
      /** What a friend saves through the sharer's link, in paise; 0 when the shop offers none. */
      buyerOffMinor: offersAffiliate(listing) ? linkDiscountMinor(listing.affiliate) : 0,
    } : null,
  });
}

/**
 * The store a caller may work the lots of.
 *
 * Their own by default; a store they hold `lots` in when they name it. Returns
 * null when they hold nothing there, which every caller turns into a 403.
 */
/**
 * Everyone this lot names who this person is. One person can be more than
 * one - a forwarder who also packs - and may do what any of their roles may.
 */
export async function crewRolesOn(
  repository: Awaited<ReturnType<typeof getRepository>>,
  userId: string,
  order: Pick<Order, 'sellerId'>,
  lot: Lot | null,
): Promise<CrewRole[]> {
  const owner = await repository.getUserById(order.sellerId);
  const roles: CrewRole[] = [];
  if ((owner && can(owner, userId, 'export')) || (lot && supplierIdOf(lot) === userId)) roles.push('supplier');
  if (lot && lot.handler?.handlerUserId === userId) roles.push('handler');
  if (lot && (await forwarderWorks(repository, lot, userId))) roles.push('forwarder');
  return roles;
}

export async function lotsStoreFor(
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
        photos: order.photos ?? [],
        /** At the destination, so Ready to dispatch can be pressed. */
        arrived: hasArrived(order, lot),
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
      lotNumber: lotNo(lot.lotNumber) ?? lotNumberFrom(lot.id, lot.createdAt),
      stage: lot.stage,
      status: lot.status,
      origin: lot.origin ?? '',
      estimatedDispatchAt: lot.estimatedDispatchAt,
    },
    // What the board offers beyond the ticks: the ready gate, and whose photos go where.
    crew: {
      readyGate: readyGated(lot),
      supplier: Boolean(supplierIdOf(lot)),
      handler: Boolean(lot.handler?.handlerUserId),
      handlerName: lot.handler?.name || null,
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
/** Ticks made as part of a batch, which reads the board once rather than per order. */
const IN_BATCH = new WeakSet<HttpRequest>();

async function setCheckpoint(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  // Only authenticated here. Who may tick what depends on which side of the
  // water they are on, and a packer abroad is not selling anything - gating
  // this on the seller capability would lock them out of their own job.
  const user = await auth.requireAuth(request);
  const orderId = request.params.id;
  if (!orderId) return error(400, 'invalid_order', 'An order id is required.');

  let body: { checkpoint?: string; on?: boolean; orderIds?: string[]; courier?: string; awb?: string; label?: string; undoOf?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  /* One of the seven checkpoints, or `custom:<step id>` - a button of the
     seller's own on this order's route. */
  const key = typeof body.checkpoint === 'string' ? body.checkpoint : '';
  const customId = key.startsWith('custom:') ? key.slice('custom:'.length) : null;
  if (!key || (!customId && !ORDER_CHECKPOINTS.includes(key as OrderCheckpoint))) {
    return error(400, 'invalid_checkpoint', 'Name a checkpoint to tick.');
  }
  const checkpoint = key as OrderCheckpoint;

  const repository = await getRepository();
  const order = await repository.getOrder(orderId);
  if (!order) return error(404, 'not_found', 'No such order.');
  const lot = inLot(order) ? await repository.getLot(order.sellerId, order.lotId) : null;

  /* The step this button reaches on the order's own route - for who it is
     assigned to, and for a custom button, for whether it exists at all. */
  const button = (await routeStepsOf(repository, order, lot)).find((step) => stepTickKey(step) === key) ?? null;
  if (customId && !button) return error(404, 'no_such_button', 'That route has no such button.');

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
    const roles = await crewRolesOn(repository, user.id, order, lot);
    /* Their own half of the journey: the buttons the seller handed them on
       this lot, or the role's stock ones where the seller has not chosen. */
    const mayPress = (each: CrewRole) => crewMayPress(lot, each, key, button?.assignee ?? null);
    const role: CrewRole | null = roles.find(mayPress) ?? roles[0] ?? null;

    if (!role) return error(403, 'forbidden', 'That order is not yours to work.');
    if (!mayPress(role)) {
      return error(
        403,
        'forbidden',
        role === 'forwarder'
          ? 'The shop’s route has not handed that button to the forwarder.'
          : role === 'handler' && key === 'ready_to_dispatch' && readyGated(lot)
            ? 'The shop marks each customer Ready to dispatch on this lot.'
            : 'The shop has not handed you that button on this lot.',
      );
    }
    /* The ready gate: the seller says a customer's parcel can go - paid up,
       nothing still to add - and until then the handler holds it. */
    if (role === 'handler' && readyGated(lot) && checkpoint === 'dispatched' && body.on !== false
      && !order.checkpoints?.ready_to_dispatch) {
      return error(409, 'not_cleared', 'The shop has not marked this customer ready to dispatch yet.');
    }
  }

  const on = body.on !== false;
  const now = new Date().toISOString();

  /* Ready to dispatch tells the handler to send it: not before it is there
     to send. Holding one back again is always allowed. */
  if (on && checkpoint === 'ready_to_dispatch' && lot && !hasArrived(order, lot)) {
    return error(409, 'not_arrived', 'It has not reached the destination yet - mark it ready once it arrives.');
  }

  /* Undoing a press made in the last three minutes: the opposite press, with
     the first one taken off the timeline instead of a second "undone" line
     written under it. Outside the window it is an ordinary press. */
  const undoing = body.undoOf ?? null;
  if (undoing && !canUndo(order.stageHistory, undoing)) return error(409, 'undo_expired', UNDO_EXPIRED);
  const tag = undoing ? null : undoTag(now);
  const undoReply = (key: string) => (tag ? { undo: { id: tag.undoId, until: tag.undoUntil, checkpoint: key, on: !on } } : {});

  // Shipping or handing over a booking is serving it, and the seller has not
  // yet said they will. Undoing a tick is always allowed.
  if (on && (checkpoint === 'dispatched' || checkpoint === 'delivered') && awaitingAcceptance(order)) {
    return error(409, 'not_accepted', NOT_ACCEPTED_MESSAGE);
  }

  /* A custom button records that it happened, and nothing else: none of the
     seven's consequences (status, protection window, delivery) hang off it. */
  if (customId && button) {
    if (isStopped(order.status)) {
      return error(409, 'order_stopped', 'That order was called off or refunded, so it no longer moves along the route.');
    }
    order.customTicks = { ...(order.customTicks ?? {}), [customId]: on ? now : null };
    order.updatedAt = now;
    order.stageHistory = undoing
      ? withoutUndo(order.stageHistory, undoing)
      : [
          ...order.stageHistory,
          { stage: order.stage, step: button.name, enteredAt: now, note: on ? `${button.name}.` : `${button.name} — undone.`, recordedBy: user.id, ...tag },
        ];
    const saved = await repository.updateOrder(order);
    return json(200, {
      order: { id: saved.id, checkpoints: saved.checkpoints ?? {}, customTicks: saved.customTicks ?? {}, status: saved.status },
      ...undoReply(key),
    });
  }

  /*
   * The courier and AWB a parcel went out with. Given with the dispatched
   * tick, or on their own for a parcel already dispatched - a seller often
   * has the AWB only once the courier has picked it up. Either way they are
   * written on the timeline too, so the buyer reads them where they read
   * everything else.
   */
  const courier = typeof body.courier === 'string' ? body.courier.trim().slice(0, 80) : '';
  const awb = typeof body.awb === 'string' ? body.awb.trim().slice(0, 80) : '';
  const withShipment = checkpoint === 'dispatched' && on && Boolean(courier || awb);
  if (withShipment && isStopped(order.status)) {
    return error(409, 'order_stopped', 'That order was called off or refunded, so it is not being shipped.');
  }
  // Only what was given: a blank courier is left out, never shown as a dash.
  const shipmentNote = withShipment
    ? [courier && `Courier: ${courier}`, awb && `AWB ${awb}`].filter(Boolean).join(' · ')
    : null;
  if (withShipment && order.checkpoints?.dispatched) {
    // Already on its way: only the details change, and the tick keeps its date.
    order.shipment = { courier, awb, at: now };
    order.updatedAt = now;
    order.stageHistory = [
      ...order.stageHistory,
      { stage: order.stage, enteredAt: now, note: `${shipmentNote} (updated)`, recordedBy: user.id },
    ];
    const saved = await repository.updateOrder(order);
    await notifyBuyers(repository, [order], ({ items, shop }) => ({
      kind: 'lot_moved',
      title: `${shop} added tracking for ${items}`,
      body: shipmentNote!,
    }), { except: order.sellerId });
    const siblings = !inLot(order)
      ? await repository.listSellerOrdersIn(order.lotId, order.sellerId)
      : await repository.listOrdersForLot(order.lotId);
    return json(200, {
      order: { id: saved.id, checkpoints: saved.checkpoints ?? {}, status: saved.status },
      tally: tally(siblings),
    });
  }
  if (withShipment) order.shipment = { courier, awb, at: now };
  if (checkpoint === 'dispatched' && !on) order.shipment = null;

  // Delivered is the one tick with consequences beyond the board: it is what
  // puts the purchase in the buyer's collection and unlocks their review. An
  // order that has left the road cannot be delivered, and one whose money has
  // already been released cannot be taken back.
  if (checkpoint === 'delivered') {
    if (on && isStopped(order.status)) {
      return error(409, 'order_stopped', 'That order was called off or refunded, so it cannot be marked delivered.');
    }
    if (!on && order.status === 'delivered' && isDeliveryLocked(order)) {
      return error(409, 'delivery_final', lockedReason(order));
    }
  }

  order.checkpoints = { ...(order.checkpoints ?? {}), [checkpoint]: on ? now : null };
  order.updatedAt = now;

  /* Where it was received, in the seller's words, for an item with no lot
     yet: the same tick, only labelled. Undoing the tick drops the label. */
  let receivedNote: string | null = null;
  if (checkpoint === 'china_received') {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, RECEIVED_AS_MAX) : '';
    if (!on) order.receivedAs = null;
    else if (label) order.receivedAs = label;
    if (order.receivedAs) receivedNote = `${order.receivedAs}.`;
  }

  // Every tick is a real, dated thing that happened, and belongs on the
  // ladder's own timeline. Filed under the rung it actually is - not the
  // order's coarse stage, which does not move when a checkpoint is ticked
  // and would otherwise leave the note stranded under whatever rung the
  // order happened to be at, however much later the tick came.
  const stepsForTick = lot ? routeOf(lot).steps : preLotRouteOf(order).steps;
  const found = stepForCheckpoint(stepsForTick, checkpoint, order);
  // Filed under the step as this order reads it - in its own words when it has some.
  const tickedStep = found && checkpoint === 'china_received' && order.receivedAs ? { ...found, name: order.receivedAs } : found;
  order.stageHistory = undoing ? withoutUndo(order.stageHistory, undoing) : [
    ...order.stageHistory,
    {
      stage: order.stage,
      step: tickedStep?.name,
      enteredAt: now,
      note: on ? receivedNote ?? `${CHECKPOINT_EVENT_TEXT[checkpoint]}` : `${CHECKPOINT_EVENT_TEXT[checkpoint]} — undone.`,
      recordedBy: user.id,
      ...tag,
    },
    // Its own line rather than folded into the tick's, which reading an order
    // matches word for word to tell a recorded tick from an unrecorded one.
    ...(shipmentNote
      ? [{ stage: order.stage, step: tickedStep?.name, enteredAt: now, note: shipmentNote, recordedBy: user.id, ...tag }]
      : []),
  ];

  // Dispatching is already recorded here, so the order takes its shipped state
  // from this tick rather than from a second screen saying the same thing.
  // Once a lot is unpacked every item goes out on its own, so this is also the
  // moment the item's own auto-release clock starts for a protected payment.
  // Unprotected orders ship too - with no money held there is simply no clock -
  // so their buyer can say it arrived.
  const releaseDays = checkpoint === 'dispatched' || checkpoint === 'delivered'
    ? await autoReleaseDays(repository)
    : 0;
  if (checkpoint === 'dispatched' && !isStopped(order.status) && order.status !== 'delivered') {
    if (on) {
      order.status = 'shipped';
    } else if (order.status === 'shipped') {
      order.status = inLot(order) ? 'in_fulfilment' : 'confirmed';
    }
    if (order.hold.state === 'held') {
      order.hold = { ...order.hold, autoReleaseAt: on ? daysFrom(releaseDays) : null };
    }
  }

  let delivered = false;
  if (checkpoint === 'delivered') {
    if (on) {
      // Ticking an item that is already delivered changes nothing and tells nobody twice.
      delivered = order.status !== 'delivered' && deliver(order, { by: user.id, now, releaseDays });
    } else if (undeliver(order, { now }) === 'ok') {
      await dropFromCollection(repository, order.buyerId, order.id);
    }
  }

  let saved = await repository.updateOrder(order);
  if (delivered) saved = await afterDelivered(saved, repository, user.id);

  // A lot is done once every live item in it has reached its buyer; a direct
  // sale has no lot, and its board is this shop's own direct orders only.
  // Only a delivery change can finish or reopen a lot; any other tick just
  // needs the board's counts.
  // A batch reads the board once at the end, not once per order.
  const withTally = !IN_BATCH.has(request);
  const siblings = !inLot(order)
    ? withTally ? await repository.listSellerOrdersIn(order.lotId, order.sellerId) : null
    : checkpoint === 'delivered'
      ? await syncLotDelivery(saved, repository)
      : withTally ? await repository.listOrdersForLot(order.lotId) : null;

  return json(200, {
    order: { id: saved.id, checkpoints: saved.checkpoints ?? {}, status: saved.status },
    tally: siblings ? tally(siblings) : null,
    ...undoReply(key),
  });
}

/**
 * POST /api/orders/checkpoints - the same tick on several orders at once.
 *
 * `{ orderIds, checkpoint, on }`: a customer's whole parcel marked ready, or
 * every item the warehouse never ticked in. It used to be one request per
 * order from the phone, one after another. Each order goes through exactly
 * the checks a single tick does, and one refused does not stop the rest:
 * the answer says which landed and which did not, and why.
 */
async function setCheckpoints(request: HttpRequest, context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireAuth(request);
  let body: { orderIds?: unknown; checkpoint?: string; on?: boolean; label?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const ids = Array.isArray(body.orderIds)
    ? [...new Set(body.orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];
  if (ids.length === 0) return error(400, 'invalid_request', 'Pick at least one order.');
  if (ids.length > 100) return error(400, 'too_many', 'At most a hundred at a time.');

  const one = { checkpoint: body.checkpoint, on: body.on, label: body.label };
  /* A delivery can finish its lot, so deliveries go one at a time: two
     closing the same lot at once would race on the lot itself. */
  const results = await mapLimit(ids, body.checkpoint === 'delivered' ? 1 : 4, async (id) => {
    const tick = {
      headers: request.headers,
      query: new URLSearchParams(),
      params: { id },
      json: async () => one,
    } as unknown as HttpRequest;
    IN_BATCH.add(tick);
    const answer = await setCheckpointRoute(tick, context);
    const reply = answer.jsonBody as { order?: { id: string; checkpoints: Record<string, string | null>; status: string }; message?: string; error?: string };
    return answer.status && answer.status >= 300
      ? { id, ok: false as const, error: reply.error ?? 'refused', message: reply.message ?? 'That did not save.' }
      : { id, ok: true as const, order: reply.order };
  });
  const failed = results.filter((result) => !result.ok).length;
  return json(200, { results, done: results.length - failed, failed });
}

/**
 * POST /api/orders/payment-reminder - tell a customer their parcel waits on payment.
 *
 * Pressed from the Ready to dispatch panel on the lot screen, for one order or
 * every order of one customer: `{ orderIds }`. It goes as a message from the
 * shop, in the thread the two of them already have, so the customer can answer
 * it; a customer with no handle yet gets it on their bell instead. Once a day
 * for the same orders: a reminder on every tap is how a shop gets muted.
 */
async function paymentReminder(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  let body: { orderIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const ids = Array.isArray(body.orderIds) ? [...new Set(body.orderIds.filter((id): id is string => typeof id === 'string'))] : [];
  if (ids.length === 0 || ids.length > 50) return error(400, 'invalid_orders', 'Name the orders to remind them about.');

  const repository = await getRepository();
  const found = await Promise.all(ids.map((id) => repository.getOrder(id)));
  const orders = found.filter((order): order is Order => Boolean(order));
  if (orders.length !== ids.length) return error(404, 'not_found', 'No such order.');
  const [first] = orders;
  if (orders.some((order) => order.sellerId !== first!.sellerId || order.buyerId !== first!.buyerId)) {
    return error(400, 'invalid_orders', 'Remind one customer at a time.');
  }
  if (await lotsStoreFor(request, user, first!.sellerId) !== first!.sellerId) {
    return error(403, 'forbidden', 'Those orders are not yours to chase.');
  }

  const due = orders.filter((order) => orderMoney(order).outstandingMinor > 0);
  if (due.length === 0) return error(409, 'nothing_due', 'They have paid in full - mark it Ready to dispatch.');
  const owedMinor = due.reduce((sum, order) => sum + orderMoney(order).outstandingMinor, 0);

  const [shop, buyer] = await Promise.all([repository.getUserById(first!.sellerId), repository.getUserById(first!.buyerId)]);
  const shopName = shop?.sellerProfile?.storefrontName || shop?.displayName || 'The shop';
  const hello = buyer?.displayName ? `Hi ${buyer.displayName.split(/\s+/)[0]}, ` : 'Hi, ';
  const what = due.length === 1
    ? `your ${due[0]!.itemName} is ready to go out`
    : `your ${due.length} orders (${due.map((order) => order.itemName).join(', ')}) are ready to go out`;
  const text = `${hello}${what}. ${rupees(owedMinor)} is still due - please pay it so we can dispatch `
    + `${due.length === 1 ? 'it' : 'them'} to you. Thank you! - ${shopName}`;
  const link = `/order/${due[0]!.id}`;

  /* Once a day. The words carry the orders and the amount, so the same
     reminder again is the same text - and a changed balance is news. */
  const DAY = 86_400_000;
  const recent = await repository.listNotifications(first!.buyerId, 50);
  const sentBell = recent.some((row) => row.kind === 'seller_nudge' && row.body === text && Date.now() - Date.parse(row.createdAt) < DAY);
  const handles = [shop?.sellerProfile?.username, buyer?.username];
  const thread = handles.every(Boolean) ? threadIdFor(handles[0]!, handles[1]!) : null;
  const sentMessage = thread
    ? (await repository.listMessages(thread, 30)).some((message) => message.body === text && Date.now() - Date.parse(message.createdAt) < DAY)
    : false;
  if (sentBell || sentMessage) return error(429, 'too_soon', 'They were reminded about this in the last 24 hrs.');

  const message = await messageFromShop(repository, first!.sellerId, first!.buyerId, text, user.id,
    due.length === 1 ? { href: link, label: 'View order & pay' } : { href: '/purchases', label: `View your ${due.length} orders & pay` });
  if (message) {
    // Where the seller can read the conversation it went into.
    return json(200, { sent: true, via: 'message', thread: `/messages/${encodeURIComponent(message.to.handle)}?as=${encodeURIComponent(message.from.handle)}` });
  }
  await notify(repository, [first!.buyerId], { kind: 'seller_nudge', title: `A reminder from ${shopName}`, body: text, link }, { except: user.id });
  return json(200, { sent: true, via: 'bell', thread: null });
}

export const lotsBoardRoute = handler(lotsBoard);
export const lotBoardRoute = handler(lotBoard);
export const setCheckpointRoute = handler(setCheckpoint);
export const setCheckpointsRoute = handler(setCheckpoints);
export const paymentReminderRoute = handler(paymentReminder);
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
app.http('order-checkpoints', { ...anon, methods: ['POST'], route: 'orders/checkpoints', handler: setCheckpointsRoute });
app.http('order-payment-reminder', { ...anon, methods: ['POST'], route: 'orders/payment-reminder', handler: paymentReminderRoute });
app.http('order-tracking', { ...anon, methods: ['GET'], route: 'orders/{id}', handler: orderTrackingRoute });
