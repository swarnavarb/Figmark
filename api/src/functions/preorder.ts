import type { Listing, Order, Pledge, PreOrder } from '../../../shared/models.js';
import { personRef, type PartyRef } from '../../../shared/parties.js';
import { NEARLY_FRACTION, preOrderView, type PreOrderState, type PreOrderView } from '../../../shared/preorder.js';
import type { getRepository } from '../data/index.js';
import { notify } from './notify.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * A pre-order as a group rather than a progress bar.
 *
 * The rule the whole feature rests on: a pledge is intent, an order is money,
 * and the threshold is met by the two of them together. The first person to
 * pay into a group-buy carries the whole risk of it never happening, and most
 * people will not - so the bar sits at zero, nothing gets imported, and the
 * seller concludes there was no demand. A free first step gets the number off
 * zero, and the number is what recruits everybody after that.
 *
 * What keeps it honest is that the two halves are never added up into one
 * figure and shown as sales. They are counted apart, drawn apart, and the
 * pledges are called in for payment the moment the threshold is reached.
 */

/** How long a pledge has to become an order once the meter fills. */
export const PLEDGE_GRACE_HOURS = 24;

export type { PreOrderState, PreOrderView };

/** One person in a campaign, as the roster shows them. */
export interface PreOrderMember {
  /** Null when they chose to be counted rather than named. */
  ref: PartyRef | null;
  units: number;
  /** They have an order, whether or not they have paid for it yet. */
  booked: boolean;
  /**
   * The money has actually arrived.
   *
   * Distinct from `booked` because an order is created unpaid - the buyer
   * chooses how to pay on the next screen - and a roster that says "Paid" next
   * to somebody who has not paid tells the other nineteen people something
   * false about how safe this campaign is.
   */
  paid: boolean;
  /** Who brought them in, when somebody did. */
  broughtBy: string | null;
  joinedAt: string;
}

export interface PreOrderRoster {
  preOrder: PreOrderView;
  /** Named members, oldest first. Whoever is reading is always in this list. */
  people: PreOrderMember[];
  /** How many are in it but not named. */
  unlisted: number;
  /** The reader's own place in it, or null when they have none. */
  mine: { pledged: boolean; booked: number; units: number; listed: boolean } | null;
  /** Who the reader brought in, which is the only reason sharing is worth doing. */
  brought: PartyRef[];
}

function counts(listing: Listing, pledges: readonly Pledge[], orders: readonly Order[]) {
  const live = pledges.filter((pledge) => pledge.convertedOrderId === null);
  const pledgedCount = live.reduce((total, pledge) => total + pledge.units, 0);
  // Orders are the truth about what has been bought; the denormalised counter
  // on the listing is a cache of it, and a cache is not what a roster is drawn
  // from. Cancelled orders are not in it - somebody who pulled out is not still
  // holding a place.
  const filledCount = orders
    .filter((order) => order.status !== 'cancelled')
    .reduce((total, order) => total + order.quantity, 0);
  return { live, pledgedCount, filledCount };
}

/**
 * Bring a campaign's stored state up to date, telling whoever is in it.
 *
 * Called after anything that can move the number, and on the two reads that
 * display it - there is no scheduler here, so a cutoff that has passed is
 * noticed the next time somebody looks. That is late rather than wrong: the
 * campaign is over either way, and the alternative is a timer nobody is paying
 * for firing on ten thousand listings that nobody is reading.
 *
 * Every notice goes out at most once, guarded by a timestamp on the listing
 * rather than by remembering whether we sent it. Sending "two more to go" every
 * time somebody opens the page is how a helpful nudge becomes a reason to turn
 * notifications off.
 */
export async function reconcilePreOrder(
  repository: Repo,
  listing: Listing,
  options: { actorId?: string; now?: Date } = {},
): Promise<{ listing: Listing; pledges: Pledge[]; orders: Order[] }> {
  const [pledges, orders] = await Promise.all([
    repository.listPledges(listing.id),
    repository.listOrdersForListing(listing.id),
  ]);

  const preOrder = listing.preOrder;
  if (!preOrder) return { listing, pledges, orders };

  const now = options.now ?? new Date();
  const iso = now.toISOString();
  const { live, pledgedCount, filledCount } = counts(listing, pledges, orders);
  const committed = filledCount + pledgedCount;

  const next: PreOrder = { ...preOrder, filledCount, pledgedCount };
  const audience = [
    ...live.map((pledge) => pledge.userId),
    ...orders.map((order) => order.buyerId),
  ];

  // Nearly there. The one moment the app asks everybody for something, so it
  // has to be worth the interruption: it names the gap, not the deadline.
  const nearlyAt = Math.ceil(preOrder.fillThreshold * NEARLY_FRACTION);
  if (
    !preOrder.nearlyNotifiedAt &&
    !preOrder.filledAt &&
    !preOrder.closedAt &&
    committed >= nearlyAt &&
    committed < preOrder.fillThreshold
  ) {
    next.nearlyNotifiedAt = iso;
    await notify(repository, audience, {
      kind: 'preorder_nearly',
      title: `${preOrder.fillThreshold - committed} more and ${listing.title} goes ahead`,
      body: `${committed} of ${preOrder.fillThreshold} are in. Bring someone in and the seller places the order.`,
      link: `/listing/${listing.id}`,
    });
  }

  // It filled. Everyone in it is told it is happening; the ones who only
  // pledged are told separately, because for them it is a bill.
  if (!preOrder.filledAt && !preOrder.closedAt && committed >= preOrder.fillThreshold) {
    next.filledAt = iso;
    next.pledgeDueAt = new Date(now.getTime() + PLEDGE_GRACE_HOURS * 3_600_000).toISOString();
    await notify(repository, audience, {
      kind: 'preorder_filled',
      title: `${listing.title} is going ahead`,
      body: `${committed} of ${preOrder.fillThreshold} committed. The seller places the order now.`,
      link: `/listing/${listing.id}`,
    });
    if (live.length > 0) {
      await notify(
        repository,
        live.map((pledge) => pledge.userId),
        {
          kind: 'preorder_due',
          title: `Your place in ${listing.title} is due`,
          body: `It filled, so pledges are being called in. Pay within ${PLEDGE_GRACE_HOURS} hours or the place is offered to whoever is behind you.`,
          link: `/listing/${listing.id}`,
        },
      );
    }
  }

  // The cutoff passed and it did not make it. Said plainly, with what happens
  // to the money, because the alternative is everybody working it out from a
  // bar that stopped moving.
  if (!preOrder.closedAt && !preOrder.filledAt && Date.parse(preOrder.cutoffAt) <= now.getTime()) {
    next.closedAt = iso;
    await notify(repository, audience, {
      kind: 'preorder_closed',
      title: `${listing.title} closed ${preOrder.fillThreshold - committed} short`,
      body:
        filledCount > 0
          ? 'The seller placed no order. Every booking is refunded in full, and pledges were never charged.'
          : 'The seller placed no order. Nothing was charged.',
      link: `/listing/${listing.id}`,
    });
  }

  const changed =
    next.filledCount !== preOrder.filledCount ||
    next.pledgedCount !== (preOrder.pledgedCount ?? 0) ||
    next.nearlyNotifiedAt !== preOrder.nearlyNotifiedAt ||
    next.filledAt !== preOrder.filledAt ||
    next.closedAt !== preOrder.closedAt;

  if (!changed) return { listing, pledges, orders };

  const saved = await repository.updatePreOrder({ ...listing, preOrder: next });
  return { listing: saved, pledges, orders };
}

/**
 * Who gets the credit for bringing somebody in.
 *
 * Nobody credits themselves, and the seller is not a recruiter of their own
 * campaign: both would turn the count into something to be gamed rather than
 * something to be proud of.
 */
export function referrer(via: string | undefined, selfId: string, sellerId: string): string | null {
  const id = via?.trim();
  if (!id || id === selfId || id === sellerId) return null;
  return id;
}

/**
 * The campaign as a meter reads it.
 *
 * Counted from the pledges and orders rather than from the numbers cached on
 * the listing: this is the read that draws the roster beside it, and a bar that
 * disagrees with the list under it is worse than no bar.
 */
export function viewOf(listing: Listing, pledges: readonly Pledge[], orders: readonly Order[]): PreOrderView | null {
  if (!listing.preOrder) return null;
  const { pledgedCount, filledCount } = counts(listing, pledges, orders);
  return preOrderView(listing.preOrder, { filledCount, pledgedCount });
}

/**
 * The roster: who is in, and who is only counted.
 *
 * Naming is opt in and off by default. Being one of twenty is a fact about a
 * group; being named tells strangers what you buy and roughly what you spend,
 * and which of those you are comfortable with is not a decision to make on
 * somebody's behalf by displaying it. Whoever is reading always sees their own
 * row, named or not - it is their place in it.
 *
 * The choice lives on the pledge, which means somebody who books outright
 * without ever pledging is counted and never named. That is the safe direction
 * to be wrong in, and it is the direction this errs in deliberately: the cost
 * is a shorter list, and the cost of the other way round is publishing what
 * somebody bought because they were never asked.
 */
export async function rosterOf(
  repository: Repo,
  listing: Listing,
  pledges: readonly Pledge[],
  orders: readonly Order[],
  viewerId: string | null,
): Promise<PreOrderRoster | null> {
  const view = viewOf(listing, pledges, orders);
  if (!view) return null;

  const live = pledges.filter((pledge) => pledge.convertedOrderId === null);
  const placed = orders.filter((order) => order.status !== 'cancelled');

  const rows = [
    ...placed.map((order) => ({
      userId: order.buyerId,
      units: order.quantity,
      booked: true,
      paid: order.paymentStatus === 'paid',
      // A booking is public in the sense that the seller ships to them, but the
      // roster is a different audience, so the same opt-in applies: a buyer is
      // named here only if they pledged first and said they could be.
      listed: pledges.some((pledge) => pledge.userId === order.buyerId && pledge.listed),
      broughtBy: order.broughtBy ?? null,
      joinedAt: order.createdAt,
    })),
    ...live.map((pledge) => ({
      userId: pledge.userId,
      units: pledge.units,
      booked: false,
      paid: false,
      listed: pledge.listed,
      broughtBy: pledge.broughtBy,
      joinedAt: pledge.createdAt,
    })),
  ].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));

  const named = rows.filter((row) => row.listed || row.userId === viewerId);
  const people = await repository.listUsersByIds([...new Set(named.map((row) => row.userId))]);
  const personOf = new Map(people.map((person) => [person.id, person]));

  const brought = rows.filter((row) => viewerId && row.broughtBy === viewerId);
  const broughtPeople = await repository.listUsersByIds([...new Set(brought.map((row) => row.userId))]);
  const broughtOf = new Map(broughtPeople.map((person) => [person.id, person]));

  const mineRows = viewerId ? rows.filter((row) => row.userId === viewerId) : [];

  return {
    preOrder: view,
    people: named.map((row) => ({
      ref: personRef(personOf.get(row.userId), 'Someone'),
      units: row.units,
      booked: row.booked,
      paid: row.paid,
      broughtBy: row.broughtBy,
      joinedAt: row.joinedAt,
    })),
    unlisted: rows.length - named.length,
    mine:
      mineRows.length === 0
        ? null
        : {
            pledged: mineRows.some((row) => !row.booked),
            booked: mineRows.filter((row) => row.booked).reduce((total, row) => total + row.units, 0),
            units: mineRows.reduce((total, row) => total + row.units, 0),
            listed: mineRows.some((row) => row.listed),
          },
    // Named whether or not they opted into the roster: they arrived through
    // this person's link, so this person already knows who they are.
    brought: brought.map((row) => personRef(broughtOf.get(row.userId), 'Someone')),
  };
}
