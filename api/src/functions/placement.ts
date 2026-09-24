import type { Order } from '../../../shared/models.js';
import { isExpired, isMultiple } from '../../../shared/payments.js';
import type { getRepository } from '../data/index.js';
import { notify } from './notify.js';
import { reconcilePreOrder } from './preorder.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

export type PlacedHow = 'paid' | 'advance' | 'booked';

const HOW_TEXT: Record<PlacedHow, string> = {
  paid: 'to pay in full',
  advance: 'to pay an advance',
  booked: 'to book',
};

/**
 * Turns a checkout into an order: the moment the buyer chose pay, advance or
 * book, and so the moment the seller hears of it.
 *
 * Pressing Buy only opens the checkout (`placedAt: null`) - it holds no stock
 * and nobody is told, because a click is not a decision. Everything a new
 * order used to do on that click happens here instead: the stock comes off
 * the shelf, a pre-order pledge is made good, and the seller is told.
 *
 * Saves the order. Returns a refusal message when the item can no longer be
 * had - it may have sold out, expired or been taken down while the buyer sat
 * at the checkout. Does nothing for an order that is already placed.
 */
export async function placeOrder(
  repository: Repo,
  order: Order,
  how: PlacedHow,
  actorId: string,
  options: { tellSeller?: boolean } = {},
): Promise<string | null> {
  if (order.placedAt !== null) return null;

  const listing = await repository.getListing(order.listingId);
  if (!listing || listing.status !== 'active' || isExpired(listing)) {
    return 'This item is no longer for sale.';
  }
  if (!isMultiple(listing) && order.quantity > listing.quantityAvailable) {
    return listing.quantityAvailable > 0 ? `Only ${listing.quantityAvailable} left.` : 'This item has sold out.';
  }
  if (listing.privateFor && listing.privateFor !== order.buyerId) return 'This item is no longer for sale.';
  if (listing.privateFor) order.privateDeal = true;

  const now = new Date().toISOString();
  order.placedAt = now;
  order.createdAt = now;
  order.updatedAt = now;
  // The timeline opens when the order did, not when Buy was first pressed.
  order.stageHistory = order.stageHistory.map((event) =>
    event.kind === 'joined' || event.note === 'Order placed.' ? { ...event, enteredAt: now } : event);

  // A pre-order booking is also a pledge made good. The pledge row is kept:
  // it carries who brought this person in.
  if (listing.preOrder) {
    const pledges = await repository.listPledges(listing.id);
    const mine = pledges.find((entry) => entry.userId === order.buyerId && entry.convertedOrderId === null);
    if (mine) {
      await repository.savePledge({ ...mine, convertedOrderId: order.id, updatedAt: now });
      if (mine.broughtBy && !order.broughtBy) order.broughtBy = mine.broughtBy;
    }
  }

  await repository.updateOrder(order);
  await repository.takeStock(order);

  if (listing.preOrder) {
    // Re-read: taking stock moved the fill counter.
    const fresh = await repository.getListing(listing.id);
    if (fresh) await reconcilePreOrder(repository, fresh, { actorId });
  }

  if (options.tellSeller !== false) {
    await notify(repository, [order.sellerId], {
      kind: 'order_placed',
      title: `New order — the buyer chose ${HOW_TEXT[how]}`,
      body: order.itemName,
      link: `/order/${order.id}`,
    });
  }
  return null;
}
