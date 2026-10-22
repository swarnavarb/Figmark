import type { Listing, Order, Pledge, PreOrder, PreOrderFullRule, PreOrderShortRule } from '../../../shared/models.js';
import { isCancelledLike } from '../../../shared/orders.js';
import { personRef, type PartyRef } from '../../../shared/parties.js';
import { rupees } from '../../../shared/payments.js';
import {
  DECISION_HOURS, FULL_RULES, NEARLY_FRACTION, SHORT_RULES, cutoffProblem, fullRuleOf, isGoingAhead, preOrderView,
  shortRuleOf, thresholdProblem, type PreOrderState, type PreOrderView,
} from '../../../shared/preorder.js';
import type { getRepository } from '../data/index.js';
import { callOffOrder } from './call-off.js';
import { capital, notify, storeCrew } from './notify.js';
import { actorName, gistOf, whose } from '../../../shared/notifications.js';

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

/** How close to the cutoff the one last call goes out. */
export const LAST_CALL_HOURS = 24;

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
  mine: {
    pledged: boolean; booked: number; units: number; listed: boolean;
    /** Their place in the waitlist, from 1, or null when they are not waiting. */
    waitlisted: number | null;
    /** When a called-in pledge or a waitlist offer must be booked by. */
    dueAt: string | null;
  } | null;
  /** Who the reader brought in, which is the only reason sharing is worth doing. */
  brought: PartyRef[];
}

/** A pledge holding a place: not yet an order, not let go, not queued. */
export const holdsPlace = (pledge: Pledge): boolean =>
  pledge.convertedOrderId === null && !pledge.lapsedAt && !pledge.waitlisted;

/** A pledge queued behind a full campaign. */
export const isWaiting = (pledge: Pledge): boolean =>
  pledge.convertedOrderId === null && !pledge.lapsedAt && pledge.waitlisted === true;

/** Order statuses a closing campaign can still call off: nothing has shipped. */
const CALLABLE: ReadonlySet<Order['status']> = new Set(['pending_payment', 'confirmed', 'in_fulfilment']);

function counts(pledges: readonly Pledge[], orders: readonly Order[]) {
  const live = pledges.filter(holdsPlace);
  const waiting = pledges.filter(isWaiting).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pledgedCount = live.reduce((total, pledge) => total + pledge.units, 0);
  const waitlistCount = waiting.reduce((total, pledge) => total + pledge.units, 0);
  // Orders are the truth about what has been bought; the denormalised counter
  // on the listing is a cache of it, and a cache is not what a roster is drawn
  // from. Cancelled orders are not in it - somebody who pulled out is not still
  // holding a place.
  const filledCount = orders
    .filter((order) => !isCancelledLike(order.status))
    .reduce((total, order) => total + order.quantity, 0);
  return { live, waiting, pledgedCount, waitlistCount, filledCount, committed: filledCount + pledgedCount };
}

const hoursFrom = (now: Date, hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
const later = (a: string | null | undefined, b: string): string => (a && Date.parse(a) > Date.parse(b) ? a : b);

/** Who a campaign's notices name, worked out once per reconcile. */
async function namesFor(repository: Repo, listing: Listing) {
  const seller = await repository.getUserById(listing.sellerId);
  const shopName = seller?.sellerProfile?.storefrontName ?? seller?.displayName ?? null;
  return {
    shopName,
    // Named in every notice: somebody in three pre-orders needs to know whose.
    shop: shopName ? actorName(shopName, seller?.sellerProfile?.username) : 'The shop',
    crew: seller?.sellerProfile ? storeCrew(seller, 'lots') : [listing.sellerId],
    item: gistOf(listing.title, 'the pre-order', 40),
    link: `/listing/${listing.id}`,
  };
}

type Names = Awaited<ReturnType<typeof namesFor>>;

/**
 * One reconcile's working state: the campaign as it is becoming, and the rows
 * it is read from. Steps below change it in place and the caller saves once.
 */
interface Working {
  repository: Repo;
  listing: Listing;
  next: PreOrder;
  pledges: Pledge[];
  orders: Order[];
  names: Names;
  now: Date;
  iso: string;
  actorId?: string;
  /** The listing's expiry, pushed out when somebody is given time past it to book. */
  expiresAt: string | null;
}

const audienceOf = (work: Working) => {
  const { live, waiting } = counts(work.pledges, work.orders);
  return [
    ...live.map((pledge) => pledge.userId),
    ...waiting.map((pledge) => pledge.userId),
    ...work.orders.filter((order) => !isCancelledLike(order.status)).map((order) => order.buyerId),
  ];
};

/** A booking deadline past the listing's own expiry would be a deadline nobody can meet. */
function keepOpenUntil(work: Working, dueAt: string) {
  if (work.expiresAt) work.expiresAt = later(work.expiresAt, dueAt);
}

/** Give somebody off the waitlist a place, and a day to book it. */
async function admit(work: Working, pledge: Pledge): Promise<void> {
  const dueAt = hoursFrom(work.now, PLEDGE_GRACE_HOURS);
  pledge.waitlisted = false;
  pledge.offerDueAt = dueAt;
  pledge.updatedAt = work.iso;
  await work.repository.savePledge(pledge);
  keepOpenUntil(work, dueAt);
  await notify(work.repository, [pledge.userId], {
    kind: 'preorder_offer',
    title: `A place opened in ${work.names.item} at ${work.names.shop}`,
    body: `You were on the waitlist. Book within ${PLEDGE_GRACE_HOURS} hours or it goes to whoever is next.`,
    link: work.names.link,
  });
}

/**
 * It goes ahead below the threshold, because the seller said so - in advance,
 * or when asked. Pledges are called in exactly as they are when it fills.
 */
async function goAheadShort(work: Working, options: { callIn: boolean }): Promise<void> {
  const { next, names } = work;
  const { live, committed } = counts(work.pledges, work.orders);
  next.proceededShortAt = work.iso;
  next.decisionDueAt = null;
  next.filledAt = next.filledAt ?? work.iso;
  if (options.callIn) {
    next.pledgeDueAt = hoursFrom(work.now, PLEDGE_GRACE_HOURS);
    keepOpenUntil(work, next.pledgeDueAt);
  }
  await notify(work.repository, audienceOf(work), {
    kind: 'preorder_filled',
    title: `${names.item} at ${names.shop} is going ahead`,
    body: `${names.shop} is going ahead with the ${committed} committed, short of ${next.fillThreshold}.`,
    link: names.link,
  }, { except: work.actorId });
  if (options.callIn && live.length > 0) {
    await notify(work.repository, live.map((pledge) => pledge.userId), {
      kind: 'preorder_due',
      title: `Pay ${names.shop} for your place in ${names.item}`,
      body: `It is going ahead, so pledges are being called in. Pay within ${PLEDGE_GRACE_HOURS} hours or the place is let go.`,
      link: names.link,
    });
  }
}

/**
 * It is over without going ahead: every booking that has not shipped is called
 * off - refunded through the seller's Refunds list where money was paid - and
 * everybody in it is told, with what happens to their money.
 */
async function closeCampaign(work: Working, how: 'short' | 'called_off' | 'undecided'): Promise<void> {
  const { next, names, repository } = work;
  const audience = audienceOf(work);
  const { filledCount, committed } = counts(work.pledges, work.orders);
  next.closedAt = work.iso;
  next.decisionDueAt = null;

  const reason = how === 'called_off'
    ? `${names.shop} called off the pre-order for ${names.item}.`
    : `The pre-order for ${names.item} closed ${Math.max(0, next.fillThreshold - committed)} short.`;
  let refunds = 0;
  for (const order of work.orders) {
    // A checkout never placed is not a booking; the guard keeps it from becoming one.
    if (order.placedAt === null || !CALLABLE.has(order.status)) continue;
    const owed = callOffOrder(order, reason, work.actorId ?? work.listing.sellerId);
    await repository.updateOrder(order);
    if (owed > 0) {
      refunds += 1;
      await notify(repository, [order.buyerId], {
        kind: 'payment_reversal_pending',
        title: `${names.shop} is returning ${rupees(owed)} for ${names.item}`,
        body: reason,
        link: `/order/${order.id}`,
      });
    }
  }

  const short = Math.max(0, next.fillThreshold - committed);
  const title = how === 'called_off'
    ? `${names.item} at ${names.shop} was called off`
    : `${names.item} at ${names.shop} closed ${short} short`;
  await notify(repository, audience, {
    kind: 'preorder_closed',
    title,
    body:
      filledCount > 0
        ? `${names.shop} placed no order. Every booking is refunded in full, and pledges were never charged.`
        : `${names.shop} placed no order. Nothing was charged.`,
    link: names.link,
  }, { except: work.actorId });
  await notify(repository, names.crew, {
    kind: 'preorder_closed',
    title: how === 'called_off'
      ? `${capital(whose(names.shopName))} pre-order was called off`
      : `${capital(whose(names.shopName))} pre-order closed ${short} short${how === 'undecided' ? ' (no decision in time)' : ''}`,
    body: refunds > 0 ? `${names.item}: ${refunds} paid booking${refunds === 1 ? '' : 's'} to refund, on your Refunds list.` : `${names.item}: nothing was charged.`,
    link: names.link,
  }, { except: work.actorId });
}

/** Short, by the cutoff or by people dropping out: do what the seller chose. */
async function whenShort(work: Working, moment: 'cutoff' | 'lapse'): Promise<void> {
  const { committed } = counts(work.pledges, work.orders);
  const rule = shortRuleOf(work.next);
  if (rule === 'cancel' || committed === 0) {
    await closeCampaign(work, 'short');
    return;
  }
  if (rule === 'proceed') {
    await goAheadShort(work, { callIn: moment === 'cutoff' });
    return;
  }
  // Ask. Paused, and the seller has a few days to say; silence cancels it,
  // because a campaign nobody is running should not hold anybody's money.
  work.next.decisionDueAt = hoursFrom(work.now, DECISION_HOURS);
  const { names } = work;
  await notify(work.repository, names.crew, {
    kind: 'preorder_decide',
    title: `${capital(whose(names.shopName))} pre-order is ${work.next.fillThreshold - committed} short: go ahead?`,
    body: `${names.item}: ${committed} of ${work.next.fillThreshold} committed. Go ahead, extend or cancel within ${DECISION_HOURS / 24} days, or it cancels and refunds.`,
    link: names.link,
  });
  await notify(work.repository, audienceOf(work), {
    kind: 'preorder_changed',
    title: `${names.item} at ${names.shop} came up short`,
    body: `${committed} of ${work.next.fillThreshold}. ${names.shop} is deciding whether to go ahead; nothing more is charged meanwhile.`,
    link: names.link,
  });
}

/**
 * Bring a campaign's stored state up to date, telling whoever is in it.
 *
 * Called after anything that can move the number, on the reads that display
 * it, and by the pre-order clock (closeDuePreOrders) for a cutoff or deadline
 * that passed with nobody looking - otherwise the feed keeps advertising a
 * campaign that is over, and the people in it are never told or refunded.
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
  const work: Working = {
    repository, listing, pledges, orders, now,
    next: { ...preOrder },
    names: await namesFor(repository, listing),
    iso: now.toISOString(),
    actorId: options.actorId,
    expiresAt: listing.expiresAt ?? null,
  };
  const { next, names } = work;
  const settled = () => Boolean(next.closedAt);

  // Called in and not paid in time: the place is let go, and whoever is
  // behind it is offered it. A pledge nobody has to keep makes the hatched
  // half of the bar a lie.
  const lapsed: Pledge[] = [];
  if (isGoingAhead(next)) {
    for (const pledge of counts(pledges, orders).live) {
      const dueAt = pledge.offerDueAt ?? next.pledgeDueAt;
      if (!dueAt || Date.parse(dueAt) > now.getTime()) continue;
      pledge.lapsedAt = work.iso;
      pledge.updatedAt = work.iso;
      await repository.savePledge(pledge);
      lapsed.push(pledge);
    }
    if (lapsed.length > 0) {
      await notify(repository, lapsed.map((pledge) => pledge.userId), {
        kind: 'preorder_lapsed',
        title: `Your place in ${names.item} at ${names.shop} was let go`,
        body: 'It was not booked in time, so it went to whoever was behind you. Nothing was charged.',
        link: names.link,
      });
      const units = lapsed.reduce((total, pledge) => total + pledge.units, 0);
      await notify(repository, names.crew, {
        kind: 'preorder_lapsed',
        title: `${units} unpaid place${units === 1 ? '' : 's'} let go in ${names.item}`,
        body: 'Pledges called in and not paid in time no longer count.',
        link: names.link,
      });
    }

    // Freed places go to the waitlist, oldest first, up to the threshold - more
    // than that is the seller's call, from the waitlist controls.
    if (fullRuleOf(next) === 'waitlist') {
      let free = next.fillThreshold - counts(pledges, orders).committed;
      for (const pledge of counts(pledges, orders).waiting) {
        if (free <= 0) break;
        if (pledge.units > free) continue;
        await admit(work, pledge);
        free -= pledge.units;
      }
    }
  }

  let { committed } = counts(pledges, orders);

  // Nearly there. The one moment the app asks everybody for something, so it
  // has to be worth the interruption: it names the gap, not the deadline.
  const nearlyAt = Math.ceil(next.fillThreshold * NEARLY_FRACTION);
  if (
    !next.nearlyNotifiedAt && !next.filledAt && !settled() && !next.decisionDueAt &&
    committed >= nearlyAt && committed < next.fillThreshold
  ) {
    next.nearlyNotifiedAt = work.iso;
    await notify(repository, audienceOf(work), {
      kind: 'preorder_nearly',
      title: `${next.fillThreshold - committed} more and ${names.item} at ${names.shop} goes ahead`,
      body: `${committed} of ${next.fillThreshold} are in at ${names.shop}. Bring someone in and they place the order.`,
      link: names.link,
    });
  }

  // Last call: one day left and still short. Said once, to the people in it
  // and the people who saved it - the ones who already said they cared.
  const cutoff = Date.parse(next.cutoffAt);
  if (
    !next.lastCallAt && !next.filledAt && !next.proceededShortAt && !settled() && !next.decisionDueAt &&
    committed < next.fillThreshold && cutoff > now.getTime() && cutoff - now.getTime() <= LAST_CALL_HOURS * 3_600_000
  ) {
    next.lastCallAt = work.iso;
    const savers = (await repository.listLikesForListings([listing.id])).map((like) => like.userId);
    await notify(repository, [...new Set([...audienceOf(work), ...savers])].filter((id) => id !== listing.sellerId), {
      kind: 'preorder_last_call',
      title: `Last day: ${names.item} at ${names.shop} needs ${next.fillThreshold - committed} more`,
      body: `${committed} of ${next.fillThreshold} are in, and bookings close ${new Date(cutoff).toUTCString().slice(0, 22)}.`,
      link: names.link,
    });
  }

  // It filled. Everyone in it is told it is happening; the ones who only
  // pledged are told separately, because for them it is a bill.
  if (!next.filledAt && !settled() && committed >= next.fillThreshold) {
    const { live } = counts(pledges, orders);
    next.filledAt = work.iso;
    next.decisionDueAt = null;
    next.pledgeDueAt = hoursFrom(now, PLEDGE_GRACE_HOURS);
    keepOpenUntil(work, next.pledgeDueAt);
    await notify(repository, audienceOf(work), {
      kind: 'preorder_filled',
      title: `${names.item} at ${names.shop} is going ahead`,
      body: `${committed} of ${next.fillThreshold} committed. ${names.shop} places the order now.`,
      link: names.link,
    });
    // The shop is the one with something to do now.
    await notify(repository, names.crew, {
      kind: 'preorder_filled',
      title: `${capital(whose(names.shopName))} pre-order filled`,
      body: `${names.item}: ${committed} of ${next.fillThreshold} committed. Place the order with your supplier.`,
      link: names.link,
    }, { except: options.actorId });
    if (live.length > 0) {
      await notify(repository, live.map((pledge) => pledge.userId), {
        kind: 'preorder_due',
        title: `Pay ${names.shop} for your place in ${names.item}`,
        body: `It filled, so pledges are being called in. Pay within ${PLEDGE_GRACE_HOURS} hours or the place is offered to whoever is behind you.`,
        link: names.link,
      });
    }
  }

  // The cutoff passed and it did not make it: whatever the seller chose.
  if (!settled() && !next.filledAt && !next.proceededShortAt && !next.decisionDueAt && cutoff <= now.getTime()) {
    await whenShort(work, 'cutoff');
  }

  // It had filled, then enough people failed to pay that it no longer has -
  // and nobody was waiting to take their places.
  ({ committed } = counts(pledges, orders));
  if (
    lapsed.length > 0 && next.filledAt && !next.proceededShortAt && !settled() && !next.decisionDueAt &&
    committed < next.fillThreshold
  ) {
    await whenShort(work, 'lapse');
  }

  // Asked, and no answer in time.
  if (!settled() && next.decisionDueAt && Date.parse(next.decisionDueAt) <= now.getTime()) {
    await closeCampaign(work, 'undecided');
  }

  return save(work, preOrder);
}

/** The most campaigns one tick of the clock settles; the rest wait for the next. */
const CLOCK_BATCH = 25;

/**
 * The pre-order clock: settle every campaign whose deadline has passed.
 *
 * Asks only for the due ones, so a tick with nothing due is one small query
 * however many campaigns are running. One that fails is left for the next
 * tick rather than holding up the others. Returns how many were settled.
 */
export async function closeDuePreOrders(repository: Repo, now = new Date()): Promise<number> {
  const due = await repository.listPreOrdersDue(now.toISOString(), CLOCK_BATCH);
  let settled = 0;
  for (const listing of due) {
    try {
      await reconcilePreOrder(repository, listing, { now });
      settled += 1;
    } catch {
      // Still due; the next tick tries again.
    }
  }
  return settled;
}

let lastTick = 0;

/**
 * The clock, run on a read rather than a timer - the same arrangement as held
 * pushes (see sendHeldPushesSoon), for a host without timer triggers. At most
 * once a minute per instance, and never waited on by the read that called it.
 */
export function closeDuePreOrdersSoon(repository: Repo, now = Date.now()): void {
  if (now - lastTick < 60_000) return;
  lastTick = now;
  void closeDuePreOrders(repository, new Date(now)).catch(() => undefined);
}

/** Write the campaign back when anything about it moved. */
async function save(work: Working, was: PreOrder): Promise<{ listing: Listing; pledges: Pledge[]; orders: Order[] }> {
  const { pledgedCount, waitlistCount, filledCount } = counts(work.pledges, work.orders);
  const next: PreOrder = { ...work.next, filledCount, pledgedCount, waitlistCount };
  const keys = new Set([...Object.keys(was), ...Object.keys(next)]) as Set<keyof PreOrder>;
  const changed = [...keys].some((key) => (next[key] ?? null) !== (was[key] ?? null))
    || (work.expiresAt ?? null) !== (work.listing.expiresAt ?? null);
  if (!changed) return { listing: work.listing, pledges: work.pledges, orders: work.orders };

  const saved = await work.repository.updateListing({
    ...work.listing,
    preOrder: next,
    ...(work.expiresAt ? { expiresAt: work.expiresAt } : {}),
  });
  return { listing: saved, pledges: work.pledges, orders: work.orders };
}

/* ── What the seller can do ───────────────────────────────────────────── */

export type SellerAction =
  | { action: 'proceed' }
  | { action: 'cancel' }
  | { action: 'extend'; cutoffAt: string }
  | { action: 'admit'; units?: number }
  | { action: 'dismiss' };

/**
 * A seller's decision, applied and told to the people it affects. Returns a
 * refusal message when it does not apply to the campaign as it stands.
 */
export async function sellerDecides(
  repository: Repo,
  listing: Listing,
  decision: SellerAction,
  actorId: string,
): Promise<{ refusal: string } | { listing: Listing; pledges: Pledge[]; orders: Order[] }> {
  // Brought up to date first: a decision about a campaign is a decision about
  // it as it is now, not as somebody last looked at it.
  const fresh = await reconcilePreOrder(repository, listing, { actorId });
  const preOrder = fresh.listing.preOrder;
  if (!preOrder) return { refusal: 'This item is not being pre-ordered.' };
  if (preOrder.closedAt) return { refusal: 'That pre-order is over.' };

  const now = new Date();
  const work: Working = {
    repository, listing: fresh.listing, pledges: fresh.pledges, orders: fresh.orders, now,
    next: { ...preOrder },
    names: await namesFor(repository, fresh.listing),
    iso: now.toISOString(),
    actorId,
    expiresAt: fresh.listing.expiresAt ?? null,
  };
  const { next, names } = work;
  const { committed, waiting } = counts(work.pledges, work.orders);

  switch (decision.action) {
    case 'proceed': {
      if (next.proceededShortAt || (next.filledAt && committed >= next.fillThreshold)) {
        return { refusal: 'It is already going ahead.' };
      }
      if (committed === 0) return { refusal: 'Nobody is in it yet, so there is nothing to go ahead with.' };
      await goAheadShort(work, { callIn: !next.filledAt || !next.pledgeDueAt });
      break;
    }
    case 'cancel': {
      await closeCampaign(work, 'called_off');
      break;
    }
    case 'extend': {
      if (next.filledAt || next.proceededShortAt) return { refusal: 'It is already going ahead; there is nothing to extend.' };
      const problem = cutoffProblem(decision.cutoffAt, now.getTime());
      if (problem) return { refusal: problem };
      next.cutoffAt = new Date(decision.cutoffAt).toISOString();
      next.decisionDueAt = null;
      next.lastCallAt = null;
      keepOpenUntil(work, next.cutoffAt);
      await notify(repository, audienceOf(work), {
        kind: 'preorder_changed',
        title: `${names.item} at ${names.shop} has more time`,
        body: `Bookings now close ${new Date(next.cutoffAt).toUTCString().slice(0, 16)}. ${committed} of ${next.fillThreshold} are in.`,
        link: names.link,
      }, { except: actorId });
      break;
    }
    case 'admit': {
      if (!isGoingAhead(next)) return { refusal: 'Nobody waits until it has filled.' };
      if (waiting.length === 0) return { refusal: 'Nobody is on the waitlist.' };
      let room = decision.units === undefined ? Infinity : Math.max(1, Math.round(decision.units));
      for (const pledge of waiting) {
        if (room <= 0) break;
        await admit(work, pledge);
        room -= pledge.units;
      }
      break;
    }
    case 'dismiss': {
      if (waiting.length === 0) return { refusal: 'Nobody is on the waitlist.' };
      for (const pledge of waiting) {
        pledge.lapsedAt = work.iso;
        pledge.updatedAt = work.iso;
        await repository.savePledge(pledge);
      }
      await notify(repository, waiting.map((pledge) => pledge.userId), {
        kind: 'preorder_changed',
        title: `${names.shop} is not taking more for ${names.item}`,
        body: 'The places are all taken this round, so the waitlist was let go. Nothing was charged.',
        link: names.link,
      });
      break;
    }
  }
  return save(work, preOrder);
}

/** What a seller may change on a running campaign. */
export interface PreOrderEdit {
  fillThreshold?: number;
  cutoffAt?: string;
  whenShort?: PreOrderShortRule;
  whenFull?: PreOrderFullRule;
}

/**
 * Change a campaign's terms. The threshold and cutoff only until it has gone
 * ahead - after that they describe something that already happened - and the
 * rules at any time. Everybody in it hears about a change to the terms they
 * joined on.
 */
export async function editPreOrder(
  repository: Repo,
  listing: Listing,
  edit: PreOrderEdit,
  actorId: string,
): Promise<{ refusal: string } | { listing: Listing; pledges: Pledge[]; orders: Order[] }> {
  const preOrder = listing.preOrder;
  if (!preOrder) return { refusal: 'This item is not being pre-ordered.' };
  if (preOrder.closedAt) return { refusal: 'That pre-order is over.' };

  const terms = edit.fillThreshold !== undefined || edit.cutoffAt !== undefined;
  if (terms && isGoingAhead(preOrder)) {
    return { refusal: 'It is already going ahead, so the number and the date are settled.' };
  }
  if (edit.fillThreshold !== undefined) {
    const problem = thresholdProblem(edit.fillThreshold);
    if (problem) return { refusal: problem };
  }
  if (edit.cutoffAt !== undefined) {
    const problem = cutoffProblem(edit.cutoffAt);
    if (problem) return { refusal: problem };
  }
  if (edit.whenShort !== undefined && !SHORT_RULES.includes(edit.whenShort)) return { refusal: 'Pick what happens if it comes up short.' };
  if (edit.whenFull !== undefined && !FULL_RULES.includes(edit.whenFull)) return { refusal: 'Pick what happens once it fills.' };

  const next: PreOrder = { ...preOrder };
  if (edit.fillThreshold !== undefined) next.fillThreshold = Math.round(edit.fillThreshold);
  if (edit.cutoffAt !== undefined) {
    next.cutoffAt = new Date(edit.cutoffAt).toISOString();
    next.lastCallAt = null;
  }
  // A new date answers the question a paused campaign was waiting on; a lower
  // number that is already met answers it too, when the reconcile below fills it.
  if (edit.cutoffAt !== undefined) next.decisionDueAt = null;
  // A higher bar can make "nearly" untrue again; it may be said again when true.
  if (edit.fillThreshold !== undefined && next.fillThreshold > preOrder.fillThreshold) next.nearlyNotifiedAt = null;
  if (edit.whenShort !== undefined) next.whenShort = edit.whenShort;
  if (edit.whenFull !== undefined) next.whenFull = edit.whenFull;

  const expiresAt = listing.expiresAt && edit.cutoffAt !== undefined ? later(listing.expiresAt, next.cutoffAt) : listing.expiresAt;
  const saved = await repository.updateListing({ ...listing, preOrder: next, expiresAt });

  if (terms) {
    const names = await namesFor(repository, saved);
    const [pledges, orders] = await Promise.all([repository.listPledges(saved.id), repository.listOrdersForListing(saved.id)]);
    const audience = [
      ...pledges.filter((pledge) => holdsPlace(pledge) || isWaiting(pledge)).map((pledge) => pledge.userId),
      ...orders.filter((order) => !isCancelledLike(order.status)).map((order) => order.buyerId),
    ];
    const said = [
      edit.fillThreshold !== undefined && next.fillThreshold !== preOrder.fillThreshold
        ? `it now needs ${next.fillThreshold}` : null,
      edit.cutoffAt !== undefined && next.cutoffAt !== preOrder.cutoffAt
        ? `bookings close ${new Date(next.cutoffAt).toUTCString().slice(0, 16)}` : null,
    ].filter(Boolean);
    if (said.length > 0) {
      await notify(repository, audience, {
        kind: 'preorder_changed',
        title: `${names.shop} changed ${names.item}`,
        body: `${capital(said.join(', and '))}.`,
        link: names.link,
      }, { except: actorId });
    }
  }

  // A lower bar may already be met.
  return reconcilePreOrder(repository, saved, { actorId });
}

/**
 * Who gets the credit for bringing somebody in.
 *
 * Nobody credits themselves, and the seller is not a recruiter of their own
 * campaign: both would turn the count into something to be gamed rather than
 * something to be proud of.
 */
export function referrer(via: unknown, selfId: string, sellerId: string): string | null {
  const id = typeof via === 'string' ? via.trim() : '';
  if (!id || id.length > 100 || id === selfId || id === sellerId) return null;
  return id;
}

/**
 * The same, checked against the record: a link only credits somebody who is
 * actually in the thing they are recommending - pledged to it or ordered it.
 * Otherwise anybody could put any id in `?via=` and hand out credit.
 */
export async function verifiedReferrer(
  repository: Repo,
  via: unknown,
  selfId: string,
  listing: Pick<Listing, 'id' | 'sellerId'>,
): Promise<string | null> {
  const id = referrer(via, selfId, listing.sellerId);
  if (!id) return null;
  const [pledges, orders] = await Promise.all([
    repository.listPledges(listing.id),
    repository.listOrdersForListing(listing.id),
  ]);
  const inIt = pledges.some((entry) => entry.userId === id && !entry.lapsedAt && !entry.waitlisted)
    || orders.some((entry) => entry.buyerId === id && !isCancelledLike(entry.status));
  return inIt ? id : null;
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
  const { pledgedCount, filledCount, waitlistCount } = counts(pledges, orders);
  return preOrderView(listing.preOrder, { filledCount, pledgedCount, waitlistCount });
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

  const { live, waiting } = counts(pledges, orders);
  const placed = orders.filter((order) => !isCancelledLike(order.status));

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
  const myPledge = viewerId ? live.find((pledge) => pledge.userId === viewerId) ?? null : null;
  const myWait = viewerId ? waiting.findIndex((pledge) => pledge.userId === viewerId) : -1;

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
      mineRows.length === 0 && myWait < 0
        ? null
        : {
            pledged: mineRows.some((row) => !row.booked),
            booked: mineRows.filter((row) => row.booked).reduce((total, row) => total + row.units, 0),
            units: mineRows.reduce((total, row) => total + row.units, 0),
            listed: mineRows.some((row) => row.listed) || (myWait >= 0 && waiting[myWait]!.listed),
            // Where they stand behind a full campaign, counting from 1.
            waitlisted: myWait >= 0 ? myWait + 1 : null,
            // Their own deadline to book, when they have one.
            dueAt: myPledge && view.state !== 'open' && view.state !== 'nearly'
              ? myPledge.offerDueAt ?? view.pledgeDueAt
              : null,
          },
    // Named whether or not they opted into the roster: they arrived through
    // this person's link, so this person already knows who they are.
    brought: brought.map((row) => personRef(broughtOf.get(row.userId), 'Someone')),
  };
}
