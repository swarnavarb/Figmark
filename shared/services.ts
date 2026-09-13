import type { OrderCheckpoint } from './enums.js';
import type { Lot, User } from './models.js';

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
 * to do one, whether there is a public list of them, and where the person doing
 * it goes to actually do it. The directory and the consoles both read it, so a
 * category on the tab and the screen it opens can never disagree about what the
 * job is.
 */

export const SERVICE_KINDS = ['forwarder', 'handler', 'escrow', 'exporter'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

/**
 * How somebody comes to provide a service.
 *
 * The three routes are genuinely different, and the difference is what decides
 * whether there can be a public list at all:
 *
 * - `listed` - they put themselves up. Anyone can, so there is a directory.
 * - `granted` - the company grants it, because the job is holding other
 *   people's money and an open sign-up for that is a fraud vector.
 * - `named` - a shop names one person on one batch. Nobody applies, so a
 *   directory would list people who never agreed to be listed.
 */
export type ServiceEntry = 'listed' | 'granted' | 'named';

export interface ServiceMeta {
  kind: ServiceKind;
  label: string;
  plural: string;
  glyph: string;
  /** What they do, in the words a seller would use. */
  blurb: string;
  /** The longer version, on the category's own screen. */
  detail: string;
  entry: ServiceEntry;
  /** Whether anyone can browse a list of them. */
  browsable: boolean;
  /** Where somebody who provides this goes to do the work. */
  console: string;
}

export const SERVICES: Record<ServiceKind, ServiceMeta> = {
  forwarder: {
    kind: 'forwarder',
    label: 'Freight forwarder',
    plural: 'Freight forwarders',
    glyph: '✈',
    blurb: 'Consolidates the crate and flies it China → India.',
    detail:
      'They take the batch from the supplier or the China warehouse and get it to India: '
      + 'consolidation, air or sea freight, and the customs paperwork at both ends. Rates and '
      + 'turnaround are the forwarder’s own claims until they have shipped batches here.',
    entry: 'listed',
    browsable: true,
    console: '/services/mine/forwarder',
  },
  handler: {
    kind: 'handler',
    label: 'Domestic handler',
    plural: 'Domestic handlers',
    glyph: '📦',
    blurb: 'Takes delivery in India and gets every parcel to its buyer.',
    detail:
      'The India end of the run. They receive the batch when it lands, split it into one parcel '
      + 'per buyer, and book the domestic courier - the work between customs and somebody’s '
      + 'door. A handler can stay unlisted and work only for shops that already know them.',
    entry: 'listed',
    browsable: true,
    console: '/services/mine/handler',
  },
  escrow: {
    kind: 'escrow',
    label: 'Escrow',
    plural: 'Escrow agents',
    glyph: '🔒',
    blurb: 'Holds the money until the buyer has the thing.',
    detail:
      'A person, not a company account: the buyer picks one at checkout, they hold the payment '
      + 'until the item arrives, and they are the one who decides a dispute. Granted by Figmark '
      + 'rather than applied for, because the job is holding other people’s money.',
    entry: 'granted',
    browsable: true,
    console: '/escrow',
  },
  exporter: {
    kind: 'exporter',
    label: 'Exporter',
    plural: 'Exporters',
    glyph: '🔍',
    blurb: 'Checks every piece in China before the batch leaves.',
    detail:
      'Named by a shop on a batch, and only that batch. They work from a packing list - pieces, '
      + 'counts and weights, never customers or prices - and tick each one as it is packed, which '
      + 'is what the shop watches to know the run is ready to fly.',
    entry: 'named',
    // Nobody applies to be an exporter, so a list of them would be a list of
    // people who never asked to be on one.
    browsable: false,
    console: '/packing',
  },
};

/** In the order the goods actually move. */
export const SERVICE_ORDER: readonly ServiceKind[] = ['exporter', 'forwarder', 'handler', 'escrow'];

/** How somebody becomes one, in one line, for the category screen. */
export const ENTRY_NOTE: Record<ServiceEntry, string> = {
  listed: 'Anyone can offer this. Put yourself on the list from My service.',
  granted: 'Granted by Figmark. Ask, rather than sign up.',
  named: 'Named by a shop on one batch. There is no list to join.',
};

/** Whether this account provides that service right now. */
export function provides(user: Pick<User, 'forwarderProfile' | 'handlerProfile' | 'escrowRights'>, kind: ServiceKind): boolean {
  switch (kind) {
    case 'forwarder':
      return Boolean(user.forwarderProfile);
    case 'handler':
      return Boolean(user.handlerProfile);
    case 'escrow':
      return Boolean(user.escrowRights);
    // An exporter is not a thing you are, it is a thing a shop asked you to do:
    // the answer is the lots naming you, which only the API can see.
    case 'exporter':
      return false;
  }
}

/** The services this account provides, minus the one it cannot answer alone. */
export function servicesOf(
  user: Pick<User, 'forwarderProfile' | 'handlerProfile' | 'escrowRights'>,
): ServiceKind[] {
  return SERVICE_ORDER.filter((kind) => provides(user, kind));
}

/* ── Working somebody else's batch ─────────────────────────────────────── */

/** What this account is on a given batch, beyond owning it. */
export type CrewRole = 'exporter' | 'handler';

/**
 * Named on the batch itself, as opposed to holding a right in the shop.
 *
 * A shop can hand one run to one person without making them staff, which is
 * how most of this work is actually arranged - a friend with a warehouse, for
 * this batch, this month.
 */
export function crewRoleOf(lot: Pick<Lot, 'handler' | 'exporterUserId'>, userId: string): CrewRole | null {
  if (lot.exporterUserId === userId) return 'exporter';
  if (lot.handler?.handlerUserId === userId) return 'handler';
  return null;
}

/**
 * The checkpoints each role may tick, and nothing else.
 *
 * The split is the work each one actually does. An exporter packs: they mark
 * pieces packed and that is all - the warehouse receipt stays the shop's,
 * because the shop is the one being told a crate arrived. A handler is the one
 * taking custody in India, so the receipt there is theirs, and so is everything
 * from it to somebody's door.
 *
 * Shared so the console offers exactly the ticks the API will accept: a button
 * that appears and then 403s is worse than no button.
 */
export const CREW_CHECKPOINTS: Record<CrewRole, readonly OrderCheckpoint[]> = {
  exporter: ['china_packed'],
  handler: ['india_received', 'ready_to_dispatch', 'packed', 'dispatched'],
};

export function mayTick(role: CrewRole, checkpoint: OrderCheckpoint): boolean {
  return CREW_CHECKPOINTS[role].includes(checkpoint);
}
