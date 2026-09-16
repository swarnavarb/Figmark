import { LOT_STAGES, LOT_STAGE_LABELS, ORDER_CHECKPOINTS, type LotStage, type OrderCheckpoint } from './enums.js';
import type { BaseDocument, Lot } from './models.js';

/**
 * A route is the list of steps a lot travels through.
 *
 * Until now the ladder was a fixed seven-word enum, which is right for the
 * shape of the trade and wrong for the words: one seller runs air freight
 * through Guangzhou and another sends sea freight out of Yiwu with a customs
 * broker in between, and both were made to describe it as "QC & repack". A
 * route lets the seller write their own ladder once and reuse it on every
 * lot, and the buyer reads the same words the seller works.
 *
 * The lot is the tracking engine. An item in a lot has no timeline of its
 * own - it inherits the lot's, which is what makes moving thirty-four items
 * one click instead of thirty-four.
 *
 * Two rules keep this from becoming a second parallel system:
 *
 * 1. Every lot has a route. A lot with none uses `BUILT_IN_ROUTE`, which is
 *    `LOT_STAGES` spelled out - same length, same order, same labels - so every
 *    lot written before routes existed keeps exactly the timeline it has.
 * 2. `lot.stage` survives as the coarse summary the older screens read, and is
 *    computed from the route position rather than tracked separately. For the
 *    built-in route that mapping is the identity.
 */

/**
 * Which half of the journey a step belongs to.
 *
 * `pre` is everything that happens to one item on its own, before it joins a
 * lot. `post` is everything that happens to the whole lot once it has.
 *
 * This replaces the separate pre-lot template. One route now describes the
 * whole journey and says where it changes hands, which is what stopped the
 * two ladders overlapping: there is only one list, so no event can appear in
 * it twice.
 */
export type StepSide = 'pre' | 'post';

/**
 * The button that moves a step, when a button moves it.
 *
 * A route is a list of words until something advances it, and what actually
 * advances it is a person pressing a button: the piece lands at the warehouse,
 * the shop taps "China WH", and the buyer's timeline says "Received at
 * international warehouse" without anybody editing a timeline.
 *
 * The six are the physical checkpoints a shop already ticks per item. Binding
 * one to a step is what turns a tick into tracking; a step with no trigger is
 * moved by hand, from the ladder itself, which is right for the steps nobody
 * can mark from a warehouse floor ("customs cleared" is a phone call).
 *
 * `lot_move` is the seventh: the whole lot moving, which advances every item
 * in it at once. It is bound implicitly - every step in the lot's half of the
 * route is reached that way - so it is offered for reading rather than set.
 */
export type StepTrigger = OrderCheckpoint;

/** What each trigger button says, and what pressing it means. */
export const TRIGGER_LABELS: Record<StepTrigger, { button: string; means: string }> = {
  china_received: { button: 'China WH', means: 'the piece arrived at the overseas warehouse' },
  china_packed: { button: 'Packed CH', means: 'it was boxed up before the lot left' },
  india_received: { button: 'India WH', means: 'it landed and you have it' },
  ready_to_dispatch: { button: 'Ready', means: 'it is checked and ready to go out' },
  packed: { button: 'Packed', means: 'it is boxed for the domestic courier' },
  dispatched: { button: 'Dispatched', means: 'it is on its way to the buyer' },
};

/** How many opening steps count as `pre` on a route written before sides. */
const LEGACY_PRE_STEPS = 2;

export interface RouteStep {
  id: string;
  name: string;
  /**
   * What actually happens at this step, in a sentence.
   *
   * Written for the buyer, who reads it on their timeline, and shown to the
   * seller while they are arranging the route so they can tell two similar
   * steps apart.
   */
  description: string;
  /** Index in the ladder. Stored so a reorder is a write, not a re-sort. */
  position: number;
  /**
   * Optional so every route stored before this existed still loads. Read it
   * through `sideOf`, never directly.
   */
  side?: StepSide;
  /**
   * The button that advances an item to this step.
   *
   * Absent means nobody can press this one into place: it is reached by hand
   * from the ladder, or by the whole lot moving. Set it and the shop's
   * existing tick becomes the thing that writes the buyer's tracking.
   */
  trigger?: StepTrigger;
}

/**
 * Which side a step is on, for a route that may predate the field.
 *
 * The fallback reproduces exactly what the app did before: the first two
 * steps were the pre-lot ladder and everything after belonged to the lot.
 */
export function sideOf(step: RouteStep, index: number): StepSide {
  return step.side ?? (index < LEGACY_PRE_STEPS ? 'pre' : 'post');
}

/** Anything with a ladder in it: a lot's route, a saved template, a preset. */
interface HasSteps { steps: RouteStep[] }

/**
 * The steps an item travels on its own, before it joins a lot.
 *
 * Takes anything with steps - a lot's snapshot, a saved template, a preset -
 * because the answer depends on the steps and on nothing else about it.
 */
export function preSteps(route: HasSteps): RouteStep[] {
  return route.steps.filter((step, index) => sideOf(step, index) === 'pre');
}

/** The steps the whole lot travels together. */
export function postSteps(route: HasSteps): RouteStep[] {
  return route.steps.filter((step, index) => sideOf(step, index) === 'post');
}

/**
 * Where the hand-over sits: the index of the first `post` step.
 *
 * Equal to the step count when a route has no `post` steps at all, which is a
 * journey that never consolidates - a courier run, or a domestic sale.
 */
export function joinIndexOf(route: HasSteps): number {
  const at = route.steps.findIndex((step, index) => sideOf(step, index) === 'post');
  return at === -1 ? route.steps.length : at;
}

/**
 * Where a lot's own ladder starts inside the route.
 *
 * A lot never gets "received at the international warehouse" - its items do,
 * one at a time, before they are in it. The route's two halves are exactly
 * this distinction, so the lot's timeline is the second half of it and the
 * item's timeline is the whole thing.
 *
 * A route with no lot steps at all (a courier run, where every parcel travels
 * alone) leaves a lot nothing to show, so it shows the whole route: that lot
 * is a contradiction the seller made, and an empty screen explains it worse
 * than a full one.
 */
export function lotOffset(route: HasSteps): number {
  const at = joinIndexOf(route);
  return at >= route.steps.length ? 0 : at;
}

/** What an item has physically done, as the buttons a shop presses record it. */
export type Ticks = Partial<Record<OrderCheckpoint, string | null>> | undefined;

/**
 * How far the buttons alone have carried this item.
 *
 * The furthest step whose trigger has been pressed, and -1 when none has. It
 * is derived rather than stored on purpose: untick a button pressed by mistake
 * and the timeline falls back to the last one that is still true, with nothing
 * to correct by hand and nothing left holding a position nobody remembers
 * setting.
 */
export function triggeredStep(route: HasSteps, ticks: Ticks): number {
  let at = -1;
  route.steps.forEach((step, index) => {
    if (step.trigger && ticks?.[step.trigger]) at = Math.max(at, index);
  });
  return at;
}

/** True once any step on this route is worked by a button rather than by hand. */
export function hasTriggers(route: HasSteps): boolean {
  return route.steps.some((step) => Boolean(step.trigger));
}

/**
 * Where an item is on its lot's route.
 *
 * Three answers, and the furthest of them wins: the lot's own position, the
 * item's when it has been moved on its own, and the floor set by what the item
 * has physically done. The floor matters because a parcel counted into the
 * warehouse has finished travelling alone whether or not the crate has moved,
 * and a timeline that forgot it would rewind under its buyer.
 *
 * That floor is read off the buttons the shop bound to its own steps. A route
 * with none bound falls back to the hand-over - the old behaviour, and the
 * best a guess can do when nobody has said which tick means which step.
 */
export function itemStepOn(
  route: HasSteps,
  lotStep: number,
  own: number | undefined,
  ticks: Ticks,
): number {
  const alone = hasTriggers(route)
    ? triggeredStep(route, ticks)
    : (ticks?.china_received ? Math.max(0, lotOffset(route) - 1) : -1);
  /* A lot that is still filling has taken none of its own steps, so it carries
     its items nowhere: they are wherever their own buttons have put them. It
     sits one short of its first step, and that position is in the half of the
     route that happens to one item at a time - inheriting it would hand every
     new item an arrival it has not made. */
  const fromLot = lotStep >= lotOffset(route) ? lotStep : 0;
  const at = Math.max(own ?? fromLot, alone);
  return Math.max(0, Math.min(route.steps.length - 1, at));
}

/** A reusable ladder, saved under the seller who wrote it. */
export interface TrackingRoute extends BaseDocument {
  /** Partition key. A route belongs to one shop, like everything else here. */
  sellerId: string;
  name: string;
  steps: RouteStep[];
}

/**
 * The route as the lot carries it.
 *
 * A snapshot rather than a reference, on purpose: a route is a template, and
 * renaming a step on the template must not rewrite the timeline a buyer has
 * already been reading for three weeks. `routeId` is kept so the lot can say
 * which template it came from; it is not read back to resolve the steps.
 */
export interface LotRoute {
  routeId: string | null;
  name: string;
  steps: RouteStep[];
}

/** The ladder that has always been here, written out. */
/**
 * What each of the seven built-in steps actually means.
 *
 * Kept beside the labels rather than inside them because a label is what the
 * step is called and this is what happens there. The buyer reads these on
 * their timeline; the seller reads them while arranging a route.
 */
const BUILT_IN_DESCRIPTIONS: Record<string, string> = {
  ordering: 'The order is placed with you and you are sourcing the piece.',
  china_wh_received: 'The piece has arrived at the overseas warehouse and is waiting for a lot.',
  dispatched_from_china: 'The lot has left the warehouse and is on its way out of the country.',
  india_received: 'The lot has landed and is going through customs.',
  qc_repack: 'Every piece is checked and repacked for its own journey.',
  local_dispatch: 'Your parcel has been handed to the domestic courier.',
  delivered: 'It reached you.',
};

/** The two opening steps happen to one item; the rest happen to the whole lot. */
const BUILT_IN_SIDES: Record<string, StepSide> = {
  ordering: 'pre',
  china_wh_received: 'pre',
};

/**
 * Which tick moves which of the seven, so the built-in route works the way
 * every other one does: a shop that never opens the builder still gets a
 * timeline that moves when they press the buttons they already press.
 */
const BUILT_IN_TRIGGERS: Record<string, StepTrigger> = {
  china_wh_received: 'china_received',
  india_received: 'india_received',
  qc_repack: 'packed',
  local_dispatch: 'dispatched',
};

export const BUILT_IN_ROUTE: LotRoute = {
  routeId: null,
  name: 'China → India',
  steps: LOT_STAGES.map((stage, index) => ({
    id: stage,
    name: LOT_STAGE_LABELS[stage],
    description: BUILT_IN_DESCRIPTIONS[stage] ?? '',
    position: index,
    side: BUILT_IN_SIDES[stage] ?? 'post',
    trigger: BUILT_IN_TRIGGERS[stage],
  })),
};

/**
 * A step written out for a preset, before it becomes a real one.
 *
 * Presets are the point of this whole feature: a shop picking "Courier, end to
 * end" from a list gets a correct route in one tap, where the same shop in a
 * step builder gets one with customs missing.
 */
interface PresetStep {
  name: string;
  description: string;
  side: StepSide;
  /** The button that advances an item to it, where a button can. */
  trigger?: StepTrigger;
}

export interface RoutePreset {
  id: string;
  name: string;
  /** One line on what kind of journey this is, for the card that offers it. */
  blurb: string;
  steps: readonly PresetStep[];
}

export const ROUTE_PRESETS: readonly RoutePreset[] = [
  {
    id: 'consolidated',
    name: 'China → India, consolidated',
    blurb: 'Pieces gather at your warehouse, then travel together as one lot.',
    steps: [
      { name: 'Ordering', description: 'The order is placed with you and you are sourcing the piece.', side: 'pre' },
      { name: 'At the overseas warehouse', description: 'The piece has arrived and is waiting for a lot.', side: 'pre', trigger: 'china_received' },
      { name: 'Dispatched', description: 'The lot has left the warehouse.', side: 'post' },
      { name: 'In transit', description: 'On its way out of the country.', side: 'post' },
      { name: 'Customs', description: 'Clearing customs on arrival. Usually handled by the forwarder.', side: 'post' },
      { name: 'Landed', description: 'The lot has been received in India.', side: 'post', trigger: 'india_received' },
      { name: 'Out for delivery', description: 'Handed to the domestic courier.', side: 'post', trigger: 'dispatched' },
      { name: 'Delivered', description: 'It reached you.', side: 'post' },
    ],
  },
  {
    id: 'procurement',
    name: 'Chain procurement',
    blurb: 'You order from a supplier who orders from theirs. Longer before it moves.',
    steps: [
      { name: 'Order placed', description: 'Your order is confirmed with the shop.', side: 'pre' },
      { name: 'Ordered from the supplier', description: 'The shop has placed the order with their supplier.', side: 'pre' },
      { name: 'Supplier sourcing', description: 'The supplier is obtaining the piece.', side: 'pre' },
      { name: 'At the overseas warehouse', description: 'The piece has arrived and is waiting for a lot.', side: 'pre', trigger: 'china_received' },
      { name: 'Dispatched', description: 'The lot has left the warehouse.', side: 'post' },
      { name: 'In transit', description: 'On its way out of the country.', side: 'post' },
      { name: 'Customs', description: 'Clearing customs on arrival.', side: 'post' },
      { name: 'Out for delivery', description: 'Handed to the domestic courier.', side: 'post', trigger: 'dispatched' },
      { name: 'Delivered', description: 'It reached you.', side: 'post' },
    ],
  },
  {
    id: 'forwarder',
    name: 'Supplier → forwarder',
    blurb: 'The supplier ships straight to your freight forwarder. No warehouse of yours.',
    steps: [
      { name: 'Order placed', description: 'Your order is confirmed with the shop.', side: 'pre' },
      { name: 'Supplier shipped', description: 'The supplier has sent the piece to the freight forwarder.', side: 'pre' },
      { name: 'At the forwarder', description: 'Received and being consolidated into a lot.', side: 'post', trigger: 'china_received' },
      { name: 'Dispatched', description: 'The lot has left for India.', side: 'post' },
      { name: 'Customs', description: 'Clearing customs on arrival. Handled by the forwarder.', side: 'post' },
      { name: 'Landed', description: 'The lot has been received in India.', side: 'post', trigger: 'india_received' },
      { name: 'Delivered', description: 'It reached you.', side: 'post' },
    ],
  },
  {
    id: 'courier',
    name: 'Courier, end to end',
    blurb: 'DHL or similar, one parcel per order. Never joins a lot.',
    steps: [
      { name: 'Order placed', description: 'Your order is confirmed with the shop.', side: 'pre' },
      { name: 'Supplier shipped', description: 'The piece has been handed to the courier.', side: 'pre' },
      { name: 'Tracking issued', description: 'The courier has given the parcel a tracking number.', side: 'pre' },
      { name: 'In transit', description: 'On its way to India.', side: 'pre' },
      { name: 'Customs', description: 'Clearing customs. The courier handles this.', side: 'pre' },
      { name: 'Out for delivery', description: 'With the local courier for the last leg.', side: 'pre', trigger: 'dispatched' },
      { name: 'Delivered', description: 'It reached you.', side: 'pre' },
    ],
  },
  {
    id: 'preorder',
    name: 'Pre-order',
    blurb: 'Bought before it exists. Months of waiting before anything moves.',
    steps: [
      { name: 'Pre-order placed', description: 'Your place is reserved against the release.', side: 'pre' },
      { name: 'Release month reached', description: 'The maker has reached the announced release window.', side: 'pre' },
      { name: 'Produced', description: 'The piece has been made and shipped to the warehouse.', side: 'pre' },
      { name: 'At the overseas warehouse', description: 'Arrived and waiting for a lot.', side: 'pre', trigger: 'china_received' },
      { name: 'Dispatched', description: 'The lot has left the warehouse.', side: 'post' },
      { name: 'Customs', description: 'Clearing customs on arrival.', side: 'post' },
      { name: 'Out for delivery', description: 'Handed to the domestic courier.', side: 'post', trigger: 'dispatched' },
      { name: 'Delivered', description: 'It reached you.', side: 'post' },
    ],
  },
];

/**
 * What the builder opens with.
 *
 * Eight steps rather than the built-in seven, because this is what sellers
 * actually describe when asked: the extra is the flight itself, which the
 * seven-stage ladder folded into its neighbours and buyers asked about anyway.
 *
 * "Added to lot" used to be on this list and is not a step. An item can be in
 * a lot before it is listed, join one the moment it is bought, join halfway
 * through, or be re-filed into a later run - none of which a fixed rung can
 * describe. It is an event now, drawn where it happened.
 */
export const SUGGESTED_STEPS: readonly PresetStep[] = [
  { name: 'Order placed', description: 'Your order is confirmed with the shop.', side: 'pre' },
  {
    name: 'Received at international warehouse',
    description: 'The piece is counted in and waiting for a lot.',
    side: 'pre',
    trigger: 'china_received',
  },
  { name: 'Dispatched from China', description: 'The lot has left the warehouse.', side: 'post' },
  { name: 'International transit', description: 'On its way out of the country.', side: 'post' },
  { name: 'Indian customs', description: 'Clearing customs on arrival.', side: 'post' },
  {
    name: 'Received by seller',
    description: 'Landed, and with the shop.',
    side: 'post',
    trigger: 'india_received',
  },
  {
    name: 'Domestic dispatch',
    description: 'Handed to the courier for the last leg.',
    side: 'post',
    trigger: 'dispatched',
  },
  { name: 'Delivered', description: 'It reached you.', side: 'post' },
];

/** Ids that are stable for a saved step and unique within a route. */
export function stepId(seed: number): string {
  return `st_${seed.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Positions renumbered, blanks dropped, names trimmed.
 *
 * Called on the way in from every editor, so nothing downstream has to wonder
 * whether positions are contiguous or whether a step has a name.
 */
export function normaliseSteps(steps: readonly Partial<RouteStep>[]): RouteStep[] {
  return steps
    .map((step, index) => ({
      id: step.id?.trim() || stepId(Date.now() + index),
      name: (step.name ?? '').trim(),
      description: (step.description ?? '').trim(),
      position: 0,
      // Carried through rather than recomputed: which side a step is on is a
      // decision the seller made, and dropping it here would silently move
      // every step back to the legacy split on the next save.
      side: step.side === 'pre' || step.side === 'post' ? step.side : undefined,
      // The same, and it matters more: dropping the binding would leave the
      // shop pressing a button that had quietly stopped moving anything.
      trigger: ORDER_CHECKPOINTS.includes(step.trigger as OrderCheckpoint)
        ? (step.trigger as StepTrigger)
        : undefined,
    }))
    .filter((step) => step.name.length > 0)
    .map((step, index) => ({ ...step, position: index }));
}

/** The route this lot travels: its own, or the one that has always been here. */
export function routeOf(lot: Pick<Lot, 'route'>): LotRoute {
  const route = lot.route;
  return route && route.steps.length > 0 ? route : BUILT_IN_ROUTE;
}

/**
 * Where the lot has got to, as an index into its route.
 *
 * A lot written before routes existed has no `currentStep`, so it is read from
 * the stage it does have - which for the built-in route is the same number.
 */
export function currentStepOf(lot: Pick<Lot, 'route' | 'currentStep' | 'stage'>): number {
  const steps = routeOf(lot).steps;
  if (typeof lot.currentStep === 'number') {
    return Math.max(0, Math.min(steps.length - 1, lot.currentStep));
  }
  const fromStage = LOT_STAGES.indexOf(lot.stage as LotStage);
  return fromStage >= 0 ? Math.min(steps.length - 1, fromStage) : 0;
}

/**
 * The coarse stage a route position corresponds to.
 *
 * `lot.stage` is still what the packing console, the lot card and the
 * analytics read, and none of them should have to learn a vocabulary the
 * seller invented this morning. So it is derived: the route is laid over the
 * seven fixed stages in proportion.
 *
 * For the built-in route - seven steps over seven stages - that is exactly the
 * identity, which is why nothing that existed before this behaves differently.
 * For a nine-step route it is an approximation, and it is meant to be: a stage
 * is a summary, and the route beside it is the precise answer.
 */
export function coarseStage(route: HasSteps, index: number): LotStage {
  const steps = Math.max(1, route.steps.length);
  const clamped = Math.max(0, Math.min(steps - 1, index));
  // The last step is always delivered, whatever the arithmetic says: a route
  // the seller has finished is a lot that has arrived.
  if (clamped === steps - 1) return LOT_STAGES[LOT_STAGES.length - 1]!;
  const mapped = Math.floor((clamped / steps) * LOT_STAGES.length);
  return LOT_STAGES[Math.min(LOT_STAGES.length - 1, mapped)]!;
}

/**
 * The route position a coarse stage corresponds to.
 *
 * The inverse of `coarseStage`, and it exists because there are two doors onto
 * the same lot: the route's own "move to next step", and the older
 * `advanceStage`, which names one of the seven fixed stages. A lot has one
 * position, so whichever door is used has to set it - otherwise a lot advanced
 * through the old one would read as still at step zero, and every buyer in it
 * would be told nothing had happened.
 *
 * The first step that reaches the stage, so advancing to `india_received`
 * lands on "Indian customs" rather than halfway through the leg before it.
 */
export function stepForStage(route: HasSteps, stage: LotStage): number {
  const target = LOT_STAGES.indexOf(stage);
  for (let index = 0; index < route.steps.length; index += 1) {
    if (LOT_STAGES.indexOf(coarseStage(route, index)) >= target) return index;
  }
  return Math.max(0, route.steps.length - 1);
}

export type StepState = 'done' | 'current' | 'todo';

export function stepStateAt(index: number, current: number): StepState {
  if (index < current) return 'done';
  return index === current ? 'current' : 'todo';
}

/**
 * The step a lot is on, for a card that has room for one line.
 *
 * A lot below its own first step has not taken one: it is open and filling,
 * and naming the item step it happens to sit above would put "received at the
 * international warehouse" on a card for a crate nobody has touched.
 */
export function currentStepName(lot: Pick<Lot, 'route' | 'currentStep' | 'stage'>): string {
  const route = routeOf(lot);
  const at = currentStepOf(lot);
  if (at < lotOffset(route)) return 'Filling';
  return route.steps[at]?.name ?? 'Not started';
}

/** Whether the lot has reached the point where items are worked one by one. */
export function atSellerYet(lot: Pick<Lot, 'route' | 'currentStep' | 'stage'>): boolean {
  // Read off the coarse stage rather than a step name, because the name is the
  // seller's to write and this has to hold whatever they called it. India
  // received is where a lot stops being one object and becomes a pile of
  // parcels, which is exactly when per-item work starts.
  const stage = coarseStage(routeOf(lot), currentStepOf(lot));
  return LOT_STAGES.indexOf(stage) >= LOT_STAGES.indexOf('india_received');
}

/**
 * A lot number a person can say out loud.
 *
 * The id is a uuid because ids should be; this is what goes on the card, in the
 * channel post and in the message to the handler. Sequential per shop would
 * need a counter and a lock for no benefit - what matters is that it is short,
 * unambiguous, and the same every time anyone looks.
 */
export function lotNumberFrom(id: string, createdAt: string): string {
  const year = new Date(createdAt).getUTCFullYear() % 100;
  const tail = id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
  return `${year}-${tail}`;
}

/** A lot as an event names it: enough to read it back, never a pointer. */
export function lotRefOf(lot: { id: string; name: string; lotNumber?: string | null; createdAt: string }) {
  return {
    id: lot.id,
    name: lot.name,
    number: lot.lotNumber ?? lotNumberFrom(lot.id, lot.createdAt),
  };
}

/**
 * What the wait between the two ladders is called.
 *
 * One string, shared, because the seller reads it on their board and the buyer
 * reads it on their timeline and the two describing the same wait differently
 * is how a support message starts.
 */
export const WAITING_FOR_LOT = 'Prepping for dispatch from the warehouse';

/** The same wait, before the item has a lot at all to be prepped into. */
export const WAITING_FOR_A_LOT = 'Waiting for a shipment to travel in';

/**
 * A name to open a lot under, when the seller has not thought of one.
 *
 * Prefilled rather than defaulted: a name that appears in the field is a name
 * the seller reads and corrects, and one applied silently when the field is
 * left blank is how a shop ends up with "Lot for Marvel Legends Rivals
 * Punisher" holding thirty other people's parcels.
 *
 * The month, because that is how consolidation runs are actually talked about,
 * and the origin when there is one.
 */
export function suggestLotName(at: Date = new Date(), origin?: string): string {
  const month = at.toLocaleDateString('en-GB', { month: 'long' });
  const place = origin?.split(',')[0]?.trim();
  return place ? `${place} run — ${month}` : `${month} run`;
}
