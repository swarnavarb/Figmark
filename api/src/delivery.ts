import { inLot } from '../../shared/fulfilment.js';
import type { Order, StageEvent } from '../../shared/models.js';
import { autoReleaseDue, daysFrom, isStopped } from '../../shared/orders.js';
import { coarseStage, lotEndIndex, routeOf } from '../../shared/routes.js';
import type { getRepository } from './data/index.js';
import { notify } from './functions/notify.js';

/**
 * The one way an item reaches its buyer, and the one way its money is let go.
 *
 * A lot travels as a crate until it lands; then it is unpacked and every item
 * goes to its own buyer. So "delivered" is always a fact about one order, and
 * several screens can state it - the seller's delivered tick, moving the item
 * to the last step of its route, the buyer's "It arrived", the auto-release
 * clock, a settled dispute. Each of those used to write the five or six fields
 * involved for itself, and they had drifted: some released the money and some
 * did not, some skipped cancelled orders and some delivered them. Every one of
 * them now calls into here.
 *
 * Two separate facts, kept separate:
 *
 * - **Delivered** is about the parcel. It unlocks reviews and the collection.
 *   The seller may say it; so may the buyer.
 * - **Released** is about the money held under buyer protection. Only the
 *   buyer confirming, the auto-release window passing with no dispute, or a
 *   dispute being settled may release it. A seller marking an item delivered
 *   starts that window if it was not running yet; it never skips it.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

export interface DeliverOptions {
  by: string;
  /** Appended to the buyer's timeline when given. */
  note?: string | null;
  /** The route step this lands on, when there is one to name. */
  step?: string;
  now?: string;
  /** Days for the auto-release window, when it has to be opened here. */
  releaseDays: number;
}

/**
 * Marks one order delivered, in memory. Returns false, changing nothing, for
 * an order that has left the road (cancelled, refunded, reversed, disputed).
 *
 * The first delivery date is kept: `completedAt` and the delivered checkpoint
 * are only written when empty, so a second screen saying the same thing later
 * does not move the day a collection card says it arrived.
 */
export function deliver(order: Order, options: DeliverOptions): boolean {
  if (isStopped(order.status)) return false;
  const now = options.now ?? new Date().toISOString();
  order.status = 'delivered';
  order.stage = 'delivered';
  order.completedAt = order.completedAt ?? now;
  order.checkpoints = { ...(order.checkpoints ?? {}), delivered: order.checkpoints?.delivered ?? now };
  // Held money waits for the buyer, or for the window. If nothing opened the
  // window (the item was never ticked dispatched), delivery opens it, so the
  // payment can never sit held forever with nobody left to press anything.
  if (order.escrow.state === 'held' && !order.escrow.autoReleaseAt) {
    order.escrow = { ...order.escrow, autoReleaseAt: daysFrom(options.releaseDays, new Date(now)) };
  }
  order.updatedAt = now;
  if (options.note) appendEvent(order, { note: options.note, by: options.by, now, step: options.step });
  return true;
}

/**
 * Takes a delivered mark back - a tick pressed on the wrong row, an item moved
 * one step too far. Refused once the money has gone: after release the order
 * is finished, and walking it back would leave the seller paid for a parcel
 * the timeline says never arrived.
 */
export function undeliver(order: Order, options: { now?: string }): 'ok' | 'locked' | 'not_delivered' {
  if (order.status !== 'delivered') return 'not_delivered';
  if (isDeliveryLocked(order)) return 'locked';
  const now = options.now ?? new Date().toISOString();
  order.status = order.checkpoints?.dispatched ? 'shipped' : inLot(order) ? 'in_fulfilment' : 'confirmed';
  order.completedAt = null;
  order.checkpoints = { ...(order.checkpoints ?? {}), delivered: null };
  order.updatedAt = now;
  return 'ok';
}

/**
 * Whether a delivery is final: the buyer has confirmed it arrived, or the
 * money held for it has been released. The same lock for direct and protected
 * orders - after either, the seller cannot take the delivery back.
 */
export function isDeliveryLocked(order: Pick<Order, 'receivedAt' | 'escrow'>): boolean {
  return Boolean(order.receivedAt) || order.escrow.state === 'released';
}

/** Why a locked delivery cannot be undone, in words for the seller. */
export function lockedReason(order: Pick<Order, 'receivedAt'>): string {
  return order.receivedAt
    ? 'The buyer has confirmed they received this item, so delivery cannot be undone.'
    : 'The payment for this item has already been released, so delivery cannot be undone.';
}

/**
 * The buyer says the item is in their hands - the last step of every
 * delivery, direct or protected.
 *
 * Under protection this is also what releases the held payment. Paid
 * directly, the money already went to the seller, so it only closes the
 * delivery and tells the seller. Either way an item not yet marked delivered
 * becomes delivered: the buyer holding it is the stronger fact.
 */
export async function confirmReceived(order: Order, by: string, repository: Repo): Promise<Order> {
  order.receivedAt = new Date().toISOString();
  if (order.escrow.state === 'held') {
    return releaseHeld(order, 'Delivery confirmed by the buyer.', by, repository);
  }
  const saved = await releaseHeld(order, 'The buyer confirmed they received it.', by, repository);
  await notify(
    repository,
    [order.sellerId],
    {
      kind: 'order_received',
      title: `Received: ${order.itemName}`,
      body: 'The buyer confirmed it reached them.',
      link: `/order/${encodeURIComponent(order.id)}`,
    },
    { except: by },
  );
  return saved;
}

function appendEvent(order: Order, event: { note: string; by: string; now: string; step?: string }): void {
  const entry: StageEvent = {
    stage: order.stage,
    step: event.step,
    enteredAt: event.now,
    note: event.note,
    recordedBy: event.by,
  };
  order.stageHistory = [...order.stageHistory, entry];
}

/**
 * Counts a finished trade toward both people's record, exactly once.
 *
 * A protected order counts when its money is released; an unprotected one,
 * with no money held, counts when it is delivered. Either way the marker on
 * the order stops a redo or a late release counting it twice.
 */
export async function countCompleted(order: Order, repository: Repo): Promise<void> {
  if (order.trustCountedAt) return;
  const now = new Date().toISOString();
  order.trustCountedAt = now;
  for (const id of [order.buyerId, order.sellerId]) {
    const person = await repository.getUserById(id);
    if (!person) continue;
    const signals = id === order.buyerId ? person.buyerTrust : person.sellerTrust;
    signals.completedTransactions += 1;
    person.updatedAt = now;
    await repository.updateUser(person);
  }
}

/**
 * After an order has been marked delivered and saved: count it if there is no
 * money left to wait for, and tell the buyer what to do next.
 */
export async function afterDelivered(order: Order, repository: Repo, by: string): Promise<Order> {
  let saved = order;
  // Only an order with no money in play is finished by arriving. Held money
  // counts when released; disputed money counts when the dispute settles.
  if (order.escrow.state === 'none' && !order.trustCountedAt) {
    await countCompleted(order, repository);
    saved = await repository.updateOrder(order);
  }
  const held = order.escrow.state === 'held';
  await notify(
    repository,
    [order.buyerId],
    {
      kind: 'order_delivered',
      title: `Delivered: ${order.itemName}`,
      body: held
        ? 'Tap "Yes, it arrived" on the order once it is in your hands - that releases the payment - or open a dispute if something is wrong. You can add it to your collection now.'
        : 'Tap "I received it" on the order once it is in your hands. You can add it to your collection and leave a review now.',
      link: `/order/${encodeURIComponent(order.id)}`,
    },
    { except: by },
  );
  return saved;
}

/**
 * Releases a held payment and completes the order.
 *
 * One function for both ways it happens - the buyer confirming, and the window
 * passing with no dispute - because the resulting state has to be identical.
 * An order that is not delivered yet is delivered by this too: the buyer
 * saying it arrived, or the clock running out, both mean the parcel is done.
 */
export async function releaseHeld(order: Order, reason: string, by: string, repository: Repo): Promise<Order> {
  const now = new Date().toISOString();
  const wasHeld = order.escrow.state === 'held';
  if (wasHeld) order.escrow = { ...order.escrow, state: 'released', releasedAt: now };
  const newlyDelivered = order.status !== 'delivered' && deliver(order, { by, now, releaseDays: 0 });
  order.updatedAt = now;
  appendEvent(order, { note: reason, by, now });
  await countCompleted(order, repository);
  let saved = await repository.updateOrder(order);
  if (newlyDelivered && inLot(saved)) {
    await syncLotDelivery(saved, repository);
    saved = (await repository.getOrder(saved.id)) ?? saved;
  }
  if (wasHeld) {
    await notify(
      repository,
      [order.sellerId],
      {
        kind: 'payment_released',
        title: `Payment released: ${order.itemName}`,
        body: reason,
        link: `/order/${encodeURIComponent(order.id)}`,
      },
      { except: by },
    );
  }
  return saved;
}

/**
 * Settles anything the clock has decided since this order was last touched.
 *
 * Called on reads, because a deadline that only exists inside a scheduled job
 * stops working the moment the job does - and there is no job here. A dispute
 * moves the escrow to `disputed`, which `autoReleaseDue` does not release, so
 * "released unless the buyer disputed" is the rule without saying it twice.
 */
export async function settleDue(order: Order, repository: Repo): Promise<Order> {
  if (!autoReleaseDue(order)) return order;
  // Worded without a number: the window this order was given may have been
  // set before an operator changed the setting.
  return releaseHeld(
    order,
    'Payment released automatically: no dispute was raised before the protection window closed.',
    'system',
    repository,
  );
}

/** Settles every order in a list whose window has run out, keeping the order of the list. */
export async function settleAll(orders: Order[], repository: Repo): Promise<Order[]> {
  return Promise.all(orders.map((order) => settleDue(order, repository)));
}

/**
 * Closes a lot once every live item in it has reached its buyer, and opens it
 * again if one of them is taken back. Called after any single item's delivery
 * changes, since the lot itself no longer moves onto its final step.
 *
 * Returns the lot's orders as they now stand, which the board wants anyway.
 */
export async function syncLotDelivery(order: Order, repository: Repo): Promise<Order[]> {
  if (!inLot(order)) return [order];
  const lot = await repository.getLot(order.sellerId, order.lotId);
  if (!lot) return repository.listOrdersForLot(order.lotId);
  const route = routeOf(lot);

  // The item's own position first. A delivered item is at the end of its
  // route whatever the crate is doing; one taken back returns to where the
  // crate stops, so its timeline does not keep saying "Delivered".
  const last = route.steps.length - 1;
  if (order.status === 'delivered' && order.currentStep !== last) {
    await repository.updateOrder({ ...order, currentStep: last });
  } else if (order.status !== 'delivered' && order.currentStep === last) {
    await repository.updateOrder({ ...order, currentStep: lotEndIndex(route) });
  }

  const siblings = await repository.listOrdersForLot(order.lotId);
  const live = siblings.filter((sibling) => !isStopped(sibling.status));
  const allDelivered = live.length > 0 && live.every((sibling) => sibling.status === 'delivered');
  const now = new Date().toISOString();

  if (allDelivered && lot.stage !== 'delivered') {
    await repository.updateLot({
      ...lot,
      stage: 'delivered',
      status: 'closed',
      currentStep: last,
      stageHistory: [...lot.stageHistory, {
        stage: 'delivered',
        step: route.steps[last]?.name,
        enteredAt: now,
        note: `Every item in this lot has reached its buyer.`,
        recordedBy: 'system',
      }],
      updatedAt: now,
    });
  } else if (!allDelivered && lot.stage === 'delivered') {
    const end = lotEndIndex(route);
    await repository.updateLot({
      ...lot,
      stage: coarseStage(route, end),
      status: lot.status === 'closed' ? 'open' : lot.status,
      currentStep: end,
      updatedAt: now,
    });
  }
  return siblings;
}

/**
 * Takes a card off the buyer's collection when the purchase behind it no
 * longer stands - taken back, refunded. The collection is only ever things
 * that actually arrived and stayed.
 */
export async function dropFromCollection(repository: Repo, buyerId: string, orderId: string): Promise<void> {
  const buyer = await repository.getUserById(buyerId);
  if (!buyer?.collection?.some((item) => item.orderId === orderId)) return;
  buyer.collection = buyer.collection.filter((item) => item.orderId !== orderId);
  buyer.updatedAt = new Date().toISOString();
  await repository.updateUser(buyer);
}
