import { LOT_STAGES, LOT_STAGE_LABELS, type LotStage } from './enums.js';
import type { BaseDocument, Lot } from './models.js';

/**
 * A route is the list of steps a batch travels through.
 *
 * Until now the ladder was a fixed seven-word enum, which is right for the
 * shape of the trade and wrong for the words: one seller runs air freight
 * through Guangzhou and another sends sea freight out of Yiwu with a customs
 * broker in between, and both were made to describe it as "QC & repack". A
 * route lets the seller write their own ladder once and reuse it on every
 * batch, and the buyer reads the same words the seller works.
 *
 * The batch is the tracking engine. An item in a batch has no timeline of its
 * own - it inherits the batch's, which is what makes moving thirty-four items
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

export interface RouteStep {
  id: string;
  name: string;
  /** Optional, and usually empty: most steps are their own explanation. */
  description: string;
  /** Index in the ladder. Stored so a reorder is a write, not a re-sort. */
  position: number;
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
export const BUILT_IN_ROUTE: LotRoute = {
  routeId: null,
  name: 'China → India',
  steps: LOT_STAGES.map((stage, index) => ({
    id: stage,
    name: LOT_STAGE_LABELS[stage],
    description: '',
    position: index,
  })),
};

/**
 * What the builder opens with.
 *
 * Nine steps rather than the built-in seven, because this is what sellers
 * actually describe when asked: the two extra are the waits - the flight, and
 * the item sitting in a warehouse before it has a batch at all - which the
 * seven-stage ladder folded into its neighbours and buyers asked about anyway.
 */
export const SUGGESTED_STEPS: readonly string[] = [
  'Order placed',
  'Received at international warehouse',
  'Added to lot',
  'Dispatched from China',
  'International transit',
  'Indian customs',
  'Received by seller',
  'Domestic dispatch',
  'Delivered',
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
    .map((step) => ({
      id: step.id?.trim() || stepId(Date.now()),
      name: (step.name ?? '').trim(),
      description: (step.description ?? '').trim(),
      position: 0,
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
 * `lot.stage` is still what the packing console, the batch card and the
 * analytics read, and none of them should have to learn a vocabulary the
 * seller invented this morning. So it is derived: the route is laid over the
 * seven fixed stages in proportion.
 *
 * For the built-in route - seven steps over seven stages - that is exactly the
 * identity, which is why nothing that existed before this behaves differently.
 * For a nine-step route it is an approximation, and it is meant to be: a stage
 * is a summary, and the route beside it is the precise answer.
 */
export function coarseStage(route: LotRoute, index: number): LotStage {
  const steps = Math.max(1, route.steps.length);
  const clamped = Math.max(0, Math.min(steps - 1, index));
  // The last step is always delivered, whatever the arithmetic says: a route
  // the seller has finished is a batch that has arrived.
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
export function stepForStage(route: LotRoute, stage: LotStage): number {
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

/** The step a lot is on, for a card that has room for one line. */
export function currentStepName(lot: Pick<Lot, 'route' | 'currentStep' | 'stage'>): string {
  const route = routeOf(lot);
  return route.steps[currentStepOf(lot)]?.name ?? 'Not started';
}

/** Whether the lot has reached the point where items are worked one by one. */
export function atSellerYet(lot: Pick<Lot, 'route' | 'currentStep' | 'stage'>): boolean {
  // Read off the coarse stage rather than a step name, because the name is the
  // seller's to write and this has to hold whatever they called it. India
  // received is where a batch stops being one object and becomes a pile of
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
