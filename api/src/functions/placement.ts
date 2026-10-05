import { randomUUID } from 'node:crypto';
import type { Order } from '../../../shared/models.js';
import { creditLeft, isExpired, isMultiple, orderMoney, rupees } from '../../../shared/payments.js';
import { orderTotalMinor } from '../../../shared/service-stores.js';
import { affiliateCommissionMinor } from '../../../shared/affiliate.js';
import { affiliateFor, creditAffiliate } from '../affiliate.js';
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
  // Stock comes off first, in one checked write: the check above can be beaten
  // by another buyer pressing at the same moment, and this cannot.
  if (!(await repository.takeStock(order))) {
    return isMultiple(listing) ? 'This item is no longer for sale.' : 'This item has just sold out.';
  }
  if (listing.privateFor) order.privateDeal = true;

  // Whoever's link brought the buyer, if the checkout opened before they
  // followed it - the account remembers, so the credit is not lost.
  if (!order.affiliate) order.affiliate = await affiliateFor(repository, order.buyerId, listing);

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

  // A booking moves no money until the seller has said yes - kept credit
  // included. Spending it here left a booking part-paid before anybody had
  // accepted it, which took the Accept and Reject buttons away from the
  // seller. It is spent when the buyer pays for the accepted booking instead.
  if (!order.bookingOnly) await adjustHeldCredit(repository, order, actorId);

  await repository.updateOrder(order);

  // A sale the post made: counted once per buyer, on the post itself.
  if (order.fromPost) {
    const buyer = order.buyerId;
    await repository.mutatePost(order.fromPost.channelId, order.fromPost.postId, (post) =>
      (post.boughtBy ?? []).includes(buyer)
        ? null
        : { ...post, buyCount: (post.buyCount ?? 0) + 1, boughtBy: [...(post.boughtBy ?? []), buyer] },
    ).catch(() => null);
  }

  if (listing.preOrder) {
    // Re-read: taking stock moved the fill counter.
    const fresh = await repository.getListing(listing.id);
    if (fresh) await reconcilePreOrder(repository, fresh, { actorId });
  }

  // The affiliate who brought the buyer hears it the moment it is a sale.
  if (order.affiliate) {
    await creditAffiliate(repository, order);
    await notify(repository, [order.affiliate.referrerId], {
      kind: 'order_placed',
      title: `Your link made a sale — ${rupees(affiliateCommissionMinor(order))} commission`,
      body: `${order.itemName}. It is yours once the item is delivered.`,
      link: '/wallet?tab=earnings',
    });
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

/**
 * What this buyer has sitting with this seller as credit kept for later.
 *
 * Only `held` - the seller said "keep it for their next order". An `open`
 * credit is one nobody has decided on yet, and spending it here would make
 * that decision for the seller.
 */
export async function heldCreditMinor(
  repository: Repo,
  order: Pick<Order, 'id' | 'buyerId' | 'sellerId'>,
): Promise<number> {
  const theirs = await repository.listOrdersForBuyer(order.buyerId);
  return theirs
    .filter((entry) => entry.id !== order.id && entry.sellerId === order.sellerId)
    .flatMap((entry) => entry.credits ?? [])
    .filter((credit) => credit.status === 'held')
    .reduce((sum, credit) => sum + creditLeft(credit), 0);
}

/**
 * Spends credit the seller kept for this buyer on the order being placed.
 *
 * "Keep it for their next order" used to be only a note: the next order came
 * in asking for the full price, and the credit sat there until somebody
 * remembered to move it by hand. It is moved here, at the moment the next
 * order exists - oldest credit first, never more than the order costs - and
 * written on both orders the same way a hand-moved credit is, so the buyer
 * and the seller read one account of where the money went.
 *
 * Mutates `order` (the caller saves it); saves the orders the credit came from.
 */
export async function adjustHeldCredit(repository: Repo, order: Order, actorId: string): Promise<number> {
  let owing = orderMoney(order).outstandingMinor;
  if (owing <= 0) return 0;

  const sources = (await repository.listOrdersForBuyer(order.buyerId))
    .filter((entry) => entry.id !== order.id && entry.sellerId === order.sellerId
      && (entry.credits ?? []).some((credit) => credit.status === 'held' && creditLeft(credit) > 0))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const now = new Date().toISOString();
  let applied = 0;
  for (const source of sources) {
    if (owing <= 0) break;
    let moved = 0;
    source.credits = (source.credits ?? []).map((credit) => {
      if (owing <= 0 || credit.status !== 'held') return credit;
      const take = Math.min(creditLeft(credit), owing);
      if (take <= 0) return credit;
      owing -= take;
      moved += take;
      const next = {
        ...credit,
        appliedMinor: (credit.appliedMinor ?? 0) + take,
        applications: [...(credit.applications ?? []), { orderId: order.id, itemName: order.itemName, amountMinor: take, at: now }],
      };
      return { ...next, status: creditLeft(next) > 0 ? 'held' as const : 'applied' as const };
    });
    if (moved <= 0) continue;
    applied += moved;

    order.payments = [
      ...(order.payments ?? []),
      {
        id: `pay_${randomUUID().slice(0, 12)}`,
        at: now,
        kind: 'credit',
        method: 'direct',
        amountMinor: moved,
        batchId: null,
        batchTotalMinor: null,
        reference: null,
        recordedBy: actorId,
      },
    ];
    order.stageHistory = [
      ...order.stageHistory,
      { stage: order.stage, enteredAt: now, note: `💰 Credit adjusted — ${rupees(moved)} kept from "${source.itemName}".`, recordedBy: actorId },
    ];
    source.stageHistory = [
      ...source.stageHistory,
      { stage: source.stage, enteredAt: now, note: `💰 ${rupees(moved)} of the kept credit went towards "${order.itemName}".`, recordedBy: actorId },
    ];
    source.updatedAt = now;
    await repository.updateOrder(source);
  }

  if (applied > 0) {
    const money = orderMoney(order);
    order.paymentStatus = money.outstandingMinor === 0 ? 'paid' : 'partially_paid';
  }
  return applied;
}

/**
 * Puts kept credit this order spent back where it came from - for an order
 * the seller turns down before taking it on.
 *
 * The reverse of `adjustHeldCredit`: each source order gets its credit back as
 * `held`, and this order drops the credit payments, since none of that money
 * was ever the buyer paying for it. Mutates `order` (the caller saves it);
 * saves the source orders.
 */
export async function returnKeptCredit(repository: Repo, order: Order, actorId: string): Promise<number> {
  const spent = (order.payments ?? []).filter((payment) => payment.kind === 'credit');
  if (spent.length === 0) return 0;

  const now = new Date().toISOString();
  let returned = 0;
  const sources = (await repository.listOrdersForBuyer(order.buyerId))
    .filter((entry) => entry.id !== order.id && entry.sellerId === order.sellerId);
  for (const source of sources) {
    let back = 0;
    source.credits = (source.credits ?? []).map((credit) => {
      const mine = (credit.applications ?? []).filter((entry) => entry.orderId === order.id);
      if (mine.length === 0) return credit;
      const amount = mine.reduce((sum, entry) => sum + entry.amountMinor, 0);
      back += amount;
      return {
        ...credit,
        appliedMinor: Math.max(0, (credit.appliedMinor ?? 0) - amount),
        applications: (credit.applications ?? []).filter((entry) => entry.orderId !== order.id),
        status: credit.status === 'applied' ? 'held' as const : credit.status,
      };
    });
    if (back <= 0) continue;
    returned += back;
    source.stageHistory = [
      ...source.stageHistory,
      { stage: source.stage, enteredAt: now, note: `💰 ${rupees(back)} of kept credit came back from "${order.itemName}".`, recordedBy: actorId },
    ];
    source.updatedAt = now;
    await repository.updateOrder(source);
  }

  order.payments = (order.payments ?? []).filter((payment) => payment.kind !== 'credit');
  if (returned > 0) {
    order.stageHistory = [
      ...order.stageHistory,
      { stage: order.stage, enteredAt: now, note: `💰 ${rupees(returned)} of kept credit returned to the buyer's balance with the seller.`, recordedBy: actorId },
    ];
  }
  // Read from what is left, not `orderMoney`: with no records left it would
  // take the stale 'paid' status at its word.
  const paidMinor = order.payments.filter((payment) => payment.kind !== 'refund')
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const totalMinor = orderTotalMinor(order);
  order.paymentStatus = paidMinor === 0 ? 'unpaid' : paidMinor >= totalMinor ? 'paid' : 'partially_paid';
  return returned;
}
