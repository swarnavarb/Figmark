import type { OrderCheckpoint } from './enums.js';
import type { Lot, Order, OrderPhoto, PhotoAudience, User } from './models.js';
import { currentStepOf, itemLeaveIndex, joinIndexOf, lotEndIndex, renderStepText, routeOf, stepButtonLabel, stepTickKey } from './routes.js';
import { isLive } from './service-stores.js';

/**
 * The trades around the trade.
 *
 * An import does not move because one person lists a figure. Somebody checks
 * the goods before they leave China, somebody flies the crate, somebody takes
 * delivery in India and gets the parcels to fifteen different cities, and
 * somebody holds the money while all of that happens. Every one of those is a
 * different person with a different job, and until now three of the four were
 * reachable only from inside a seller's console - a freight forwarder had a
 * directory entry and no way to see what had been consigned to them.
 *
 * This is the register of those jobs: what each is called, how somebody comes
 * to do one, and whether there is a public list of them. The work itself is
 * always under My services. The directory and the consoles both read it, so a
 * category on the tab and the screen it opens can never disagree about what the
 * job is.
 */

export const SERVICE_KINDS = ['forwarder', 'handler', 'supplier', 'artist'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/**
 * How somebody comes to provide a service.
 *
 * The routes are genuinely different, and the difference is what decides
 * whether there can be a public list at all:
 *
 * - `listed` - they put themselves up. Anyone can, so there is a directory.
 * - `approved` - they apply with their details and an operator opens the
 *   store. There is a directory, of the approved ones only.
 * - `named` - a shop names one person on one lot. Nobody applies, so a
 *   directory would list people who never agreed to be listed.
 */
export type ServiceEntry = 'listed' | 'approved' | 'named';

export interface ServiceMeta {
  kind: ServiceKind;
  label: string;
  plural: string;
  /**
   * The emoji this service used to be drawn with. Kept for anywhere that can
   * only carry text, and no longer what the UI renders: colour emoji are a
   * different typeface on every platform and carry somebody else's palette.
   */
  glyph: string;
  /** The drawn mark, by name in the app's own icon set. */
  icon: 'plane' | 'box' | 'search' | 'spark';
  /** What they do, in the words a seller would use. */
  blurb: string;
  /** The longer version, on the category's own screen. */
  detail: string;
  entry: ServiceEntry;
  /** Whether anyone can browse a list of them. */
  browsable: boolean;
}

export const SERVICES: Record<ServiceKind, ServiceMeta> = {
  forwarder: {
    kind: 'forwarder',
    label: 'Freight forwarder',
    plural: 'Freight forwarders',
    glyph: '✈',
    icon: 'plane',
    blurb: 'Consolidates the crate and flies it China → India.',
    detail:
      'They take the lot from the supplier or the China warehouse and get it to India: '
      + 'consolidation, air or sea freight, and the customs paperwork at both ends. Rates and '
      + 'turnaround are the forwarder’s own claims until they have shipped lots here.',
    entry: 'approved',
    browsable: true,
  },
  handler: {
    kind: 'handler',
    label: 'Domestic handler',
    plural: 'Domestic handlers',
    glyph: '📦',
    icon: 'box',
    blurb: 'Takes delivery in India and gets every parcel to its buyer.',
    detail:
      'The India end of the run. They receive the lot when it lands, split it into one parcel '
      + 'per buyer, and book the domestic courier - the work between customs and somebody’s '
      + 'door. A handler can stay unlisted and work only for shops that already know them.',
    entry: 'listed',
    browsable: true,
  },
  supplier: {
    kind: 'supplier',
    label: 'Supplier',
    plural: 'Suppliers',
    glyph: '🔍',
    icon: 'search',
    blurb: 'Sells the shop the run, and packs it before it leaves.',
    detail:
      'Named by a shop on a lot, and only that lot. They work from a packing list - pieces, '
      + 'counts and weights, never customers or prices - and tick each one as it is packed, which '
      + 'is what the shop watches to know the run is ready to fly.',
    entry: 'named',
    // Nobody applies to be somebody's supplier, so a list of them would be a
    // list of people who never asked to be on one.
    browsable: false,
  },
  artist: {
    kind: 'artist',
    label: 'Artist',
    plural: 'Artists',
    glyph: '🎨',
    icon: 'spark',
    blurb: 'Repaints, customs and restoration on the piece you bought.',
    detail:
      'Painters, sculptors and restorers who work on figures: a repaint, a custom head, a '
      + 'diorama base, a broken part made good. Commission one from your order - they quote, '
      + 'you pay held or direct, and the finished piece comes back to you.',
    entry: 'approved',
    browsable: true,
  },
};

/** In the order the goods actually move. */
export const SERVICE_ORDER: readonly ServiceKind[] = ['supplier', 'forwarder', 'handler', 'artist'];


/** Whether this account provides that service right now. */
export function provides(user: Pick<User, 'forwarderProfile' | 'handlerProfile' | 'artistProfile'>, kind: ServiceKind): boolean {
  switch (kind) {
    case 'forwarder':
      return isLive(user.forwarderProfile);
    case 'artist':
      return isLive(user.artistProfile);
    case 'handler':
      return Boolean(user.handlerProfile);
    // Being somebody's supplier is not a thing you are, it is a thing a shop
    // asked you to be: the answer is the lots naming you, which only the API
    // can see.
    case 'supplier':
      return false;
  }
}

/** The services this account provides, minus the one it cannot answer alone. */
export function servicesOf(
  user: Pick<User, 'forwarderProfile' | 'handlerProfile' | 'artistProfile'>,
): ServiceKind[] {
  return SERVICE_ORDER.filter((kind) => provides(user, kind));
}

/* ── Working somebody else's lot ─────────────────────────────────────── */

/** What this account is on a given lot, beyond owning it. */
export type CrewRole = 'supplier' | 'handler' | 'forwarder';

/**
 * The account behind this lot's supplier, wherever it was written.
 *
 * Lots named before the merge put them in `exporterUserId`, because the two
 * roles were modelled as two people until it became clear they never were.
 */
export function supplierIdOf(
  lot: Pick<Lot, 'supplier' | 'exporterUserId'>,
): string | null {
  return lot.supplier?.supplierUserId ?? lot.exporterUserId ?? null;
}

/**
 * The checkpoints each role may tick, and nothing else.
 *
 * The split is the work each one actually does. A supplier packs: they mark
 * pieces packed and that is all - the warehouse receipt stays the shop's,
 * because the shop is the one being told a crate arrived. A handler is the one
 * taking custody in India, so the receipt there is theirs, and so is everything
 * from it to somebody's door. A forwarder takes the piece in at their origin
 * warehouse; whatever else they press is what the shop's route hands them.
 *
 * Shared so the console offers exactly the ticks the API will accept: a button
 * that appears and then 403s is worse than no button.
 */
export const CREW_CHECKPOINTS: Record<CrewRole, readonly OrderCheckpoint[]> = {
  supplier: ['china_packed'],
  handler: ['india_received', 'ready_to_dispatch', 'packed', 'dispatched'],
  forwarder: ['china_received'],
};

export function mayTick(role: CrewRole, checkpoint: OrderCheckpoint): boolean {
  return CREW_CHECKPOINTS[role].includes(checkpoint);
}

/* ── What the seller hands the people they tag ───────────────────────── */

/** The two roles a seller tags by hand, and so the two whose buttons they choose. */
export type TaggedRole = 'supplier' | 'handler';
export const TAGGED_ROLES: readonly TaggedRole[] = ['supplier', 'handler'];

/** One button on a lot's route, as a crew member is shown it. */
export interface CrewButton {
  key: string;
  label: string;
  /** The step it moves the item to, in the lot's own words. */
  step: string;
  index: number;
  /** Handed over by the seller, rather than the role's stock buttons. */
  assigned: boolean;
}

type CrewLot = Pick<Lot, 'route' | 'originCountry' | 'destinationCountry' | 'crew'>;

/**
 * Whether the seller clears each customer before the handler may dispatch.
 *
 * Always, for any order riding a lot: "Ready to dispatch" is the seller's
 * press - paid up, nothing still to add - and the handler holds the parcel
 * until it is made. It used to be a per-lot switch; it is not optional now.
 */
export function readyGated(lot: object | null | undefined): boolean {
  return Boolean(lot);
}

const placesOfLot = (lot: CrewLot) => ({ origin: lot.originCountry ?? null, destination: lot.destinationCountry ?? null });

/** The seller's chosen list for this role, or null for the stock buttons. */
export function chosenButtons(lot: CrewLot, role: TaggedRole): string[] | null {
  const list = role === 'supplier' ? lot.crew?.supplierButtons : lot.crew?.handlerButtons;
  return Array.isArray(list) ? list : null;
}

/**
 * Whether a piece riding a lot has reached the destination, so "Ready to
 * dispatch" can mean something: the handler cannot send what they do not
 * have. Received there, or the crate has made its last move.
 */
export function hasArrived(
  order: Pick<Order, 'checkpoints'>,
  lot: Pick<Lot, 'route' | 'currentStep' | 'stage'> | null | undefined,
): boolean {
  if (!lot) return true;
  if (order.checkpoints?.india_received) return true;
  return currentStepOf(lot) >= lotEndIndex(routeOf(lot));
}

/**
 * The buttons a seller may hand this role on this lot.
 *
 * Each role's side of the lot and nothing else: the supplier presses what
 * happens to an item before it joins the lot, the handler what happens once
 * it has left it. Inside the lot the crate moves its items together, and
 * Delivered stays the seller's - it is the press that settles the money, and
 * so is "Ready to dispatch" (see `readyGated`).
 */
export function crewSlots(lot: CrewLot, role: TaggedRole): Omit<CrewButton, 'assigned'>[] {
  const route = routeOf(lot);
  const join = joinIndexOf(route);
  const leave = Math.max(join, itemLeaveIndex(route));
  const places = placesOfLot(lot);
  return route.steps.flatMap((step, index) => {
    const key = stepTickKey(step);
    if (!key || step.trigger === 'delivered') return [];
    const onSide = role === 'supplier' ? index < join : join < route.steps.length && index >= leave;
    if (!onSide) return [];
    if (role === 'handler' && key === 'ready_to_dispatch' && readyGated(lot)) return [];
    return [{ key, label: stepButtonLabel(step, places), step: renderStepText(step.name, places), index }];
  });
}

/**
 * The buttons this role has on this lot, in route order.
 *
 * The seller's list where they made one, kept to the role's side of the lot so
 * a route edited since cannot carry a button across. Otherwise the stock
 * buttons: whatever the route's steps assign the role, and the checkpoints the
 * role has always been able to press.
 */
export function crewButtons(lot: CrewLot, role: CrewRole): CrewButton[] {
  const chosen = role === 'forwarder' ? null : chosenButtons(lot, role);
  if (chosen && role !== 'forwarder') {
    return crewSlots(lot, role).filter((slot) => chosen.includes(slot.key)).map((slot) => ({ ...slot, assigned: true }));
  }
  const places = placesOfLot(lot);
  return routeOf(lot).steps.flatMap((step, index) => {
    const key = stepTickKey(step);
    if (!key) return [];
    if (role === 'handler' && key === 'ready_to_dispatch' && readyGated(lot)) return [];
    const mine = step.assignee === role || (step.trigger && CREW_CHECKPOINTS[role].includes(step.trigger));
    return mine
      ? [{ key, label: stepButtonLabel(step, places), step: renderStepText(step.name, places), index, assigned: step.assignee === role }]
      : [];
  });
}

/**
 * Whether this role may press this key on this lot - the rule the API applies,
 * so a button the screen offers is a button that saves.
 *
 * Stock buttons also cover a role's checkpoints the route has no step for (a
 * supplier marking pieces packed on a route that never says so), as they
 * always have. A seller's own list is exactly that list.
 */
export function crewMayPress(lot: CrewLot | null, role: CrewRole, key: string, assignee?: string | null): boolean {
  const custom = key.startsWith('custom:');
  if (!lot) return !custom && mayTick(role, key as OrderCheckpoint);
  if (role === 'handler' && key === 'ready_to_dispatch' && readyGated(lot)) return false;
  if (crewButtons(lot, role).some((button) => button.key === key)) return true;
  if (role !== 'forwarder' && chosenButtons(lot, role)) return false;
  return (!custom && mayTick(role, key as OrderCheckpoint)) || assignee === role;
}

/**
 * The photos of an order this viewer may see: every one for the shop, the
 * ones shared with them for anyone else - and, for the crew, the ones they
 * took themselves, which are theirs to see until the seller says otherwise.
 */
export function photosFor(order: Pick<Order, 'photos'>, as: 'seller' | PhotoAudience, userId?: string): OrderPhoto[] {
  const all = order.photos ?? [];
  if (as === 'seller') return all;
  return all.filter((photo) => photo.showTo.includes(as) || (as !== 'buyer' && userId !== undefined && photo.addedBy === userId));
}
