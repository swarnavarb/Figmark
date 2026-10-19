import { randomUUID } from 'node:crypto';
import type { Listing, Order } from '../../../shared/models.js';
import { creditLeft, isExpired, isMultiple, orderMoney, rupees } from '../../../shared/payments.js';
import { orderTotalMinor } from '../../../shared/service-stores.js';
import { affiliateCommissionMinor } from '../../../shared/affiliate.js';
import { affiliateFor, creditAffiliate } from '../affiliate.js';
import type { getRepository } from '../data/index.js';
import { notify, orderNames } from './notify.js';
import { reconcilePreOrder } from './preorder.js';
import { storeCreditLeft } from '../../../shared/play.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

export type PlacedHow = 'paid' | 'advance' | 'booked';

const HOW_TEXT: Record<PlacedHow, string> = {
  paid: 'to pay in full',
  advance: 'to pay an advance',
  booked: 'to book',
};

/** Why a checkout could not be placed. `price_changed` means: look again, then pay. */
export interface Refusal {
  code: 'unavailable' | 'price_changed';
  message: string;
}

/**
 * What one of these costs a buyer today: the item's price now, less the
 * discount of the link the checkout was opened through - the same sum Buy
 * makes in catalog-routes.ts.
 */
export function checkoutUnitPriceMinor(listing: Pick<Listing, 'priceMinor'>, order: Pick<Order, 'affiliate'>): number {
  return Math.max(100, listing.priceMinor - (order.affiliate?.buyerOffMinor ?? 0));
}

/** Why this checkout cannot become an order right now, or null when it can. */
export function unavailableReason(listing: Listing | null, order: Order): string | null {
  if (!listing || listing.status !== 'active' || isExpired(listing)) return 'This item is no longer for sale.';
  if (listing.privateFor && listing.privateFor !== order.buyerId) return 'This item is no longer for sale.';
  if (!isMultiple(listing) && order.quantity > listing.quantityAvailable) {
    return listing.quantityAvailable > 0 ? `Only ${listing.quantityAvailable} left.` : 'This item has sold out.';
  }
  return null;
}

/**
 * Bring a checkout up to the item's price now.
 *
 * A cart item keeps the price Buy was pressed at, and a seller can change the
 * price afterwards - up or down. Nothing is paid at a checkout, so it simply
 * follows; what changes is recorded on it, so the cart and the checkout can
 * say so before anyone pays. True when the price moved and the order was saved.
 */
export async function repriceCheckout(repository: Repo, order: Order, listing: Listing): Promise<boolean> {
  if (order.placedAt !== null) return false;
  const now = checkoutUnitPriceMinor(listing, order);
  if (now === order.unitPriceMinor) return false;
  // Measured from the price they first saw, however many times it has moved since.
  const fromMinor = order.priceChange?.fromMinor ?? order.unitPriceMinor;
  order.unitPriceMinor = now;
  order.hold = { ...order.hold, amountMinor: now * order.quantity };
  order.priceChange = fromMinor === now ? null : { fromMinor, toMinor: now, at: new Date().toISOString() };
  order.updatedAt = new Date().toISOString();
  await repository.updateOrder(order);
  return true;
}

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
): Promise<Refusal | null> {
  if (order.placedAt !== null) return null;

  const fetched = await repository.getListing(order.listingId);
  const unavailable = unavailableReason(fetched, order);
  if (unavailable) return { code: 'unavailable', message: unavailable };
  const listing = fetched!;

  // Paid at the price on the item now, never the one from when Buy was
  // pressed - and never at a price the buyer has not been shown. A change
  // since they opened the checkout sends them back to look at it again.
  const was = orderTotalMinor(order);
  if (await repriceCheckout(repository, order, listing)) {
    return {
      code: 'price_changed',
      message: `The seller changed the price: ${rupees(was)} is now ${rupees(orderTotalMinor(order))}. `
        + 'Check the new total, then try again.',
    };
  }

  // The order is claimed before anything else moves. The write is checked, so
  // of two requests placing this same checkout at once - a double tap on Pay -
  // the second is refused here rather than taking the stock a second time.
  const now = new Date().toISOString();
  order.placedAt = now;
  await repository.updateOrder(order);

  // Stock comes off next, in one checked write: the check above can be beaten
  // by another buyer pressing at the same moment, and this cannot.
  if (!(await repository.takeStock(order))) {
    order.placedAt = null;
    await repository.updateOrder(order);
    return { code: 'unavailable', message: isMultiple(listing) ? 'This item is no longer for sale.' : 'This item has just sold out.' };
  }
  if (listing.privateFor) order.privateDeal = true;

  // Whoever's link brought the buyer, if the checkout opened before they
  // followed it - the account remembers, so the credit is not lost.
  if (!order.affiliate) order.affiliate = await affiliateFor(repository, order.buyerId, listing);

  order.createdAt = now;
  order.updatedAt = now;
  // Shown on the checkout only; an order is at the price it was placed at.
  order.priceChange = null;
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
    const named = await orderNames(repository, order);
    await notify(repository, [order.sellerId], {
      kind: 'order_placed',
      title: `${named.buyer} ordered from ${named.forShop}`,
      body: `${order.itemName} · chose ${HOW_TEXT[how]}`,
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
  const [theirs, buyer] = await Promise.all([repository.listOrdersForBuyer(order.buyerId), repository.getUserById(order.buyerId)]);
  const kept = theirs
    .filter((entry) => entry.id !== order.id && entry.sellerId === order.sellerId)
    .flatMap((entry) => entry.credits ?? [])
    .filter((credit) => credit.status === 'held')
    .reduce((sum, credit) => sum + creditLeft(credit), 0);
  // And store credit won from this shop - a competition prize, a debate, a poll.
  const won = (buyer?.storeCredits ?? [])
    .filter((credit) => credit.storeId === order.sellerId)
    .reduce((sum, credit) => sum + storeCreditLeft(credit), 0);
  return kept + won;
}

/**
 * Spends store credit the buyer won from this shop on the order being
 * placed, oldest first, after any credit the shop kept for them: that money
 * was theirs first. Mutates `order` (the caller saves it); saves the buyer.
 */
async function spendWonCredit(repository: Repo, order: Order, actorId: string, owing: number, now: string): Promise<number> {
  if (owing <= 0) return 0;
  const buyer = await repository.getUserById(order.buyerId);
  const credits = buyer?.storeCredits ?? [];
  if (!buyer || !credits.some((credit) => credit.storeId === order.sellerId && storeCreditLeft(credit) > 0)) return 0;
  let left = owing;
  let spent = 0;
  const next = [...credits].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((credit) => {
    if (left <= 0 || credit.storeId !== order.sellerId) return credit;
    const take = Math.min(storeCreditLeft(credit), left);
    if (take <= 0) return credit;
    left -= take;
    spent += take;
    return { ...credit, spentMinor: credit.spentMinor + take, spends: [...credit.spends, { orderId: order.id, itemName: order.itemName, amountMinor: take, at: now }] };
  });
  if (spent <= 0) return 0;
  await repository.updateUser({ ...buyer, storeCredits: next });
  order.payments = [
    ...(order.payments ?? []),
    {
      id: `pay_${randomUUID().slice(0, 12)}`,
      at: now,
      kind: 'credit',
      method: 'direct',
      amountMinor: spent,
      batchId: null,
      batchTotalMinor: null,
      reference: 'Store credit won',
      recordedBy: actorId,
    },
  ];
  order.stageHistory = [
    ...order.stageHistory,
    { stage: order.stage, enteredAt: now, note: `🎁 Store credit — ${rupees(spent)} the buyer won from this shop.`, recordedBy: actorId },
  ];
  return spent;
}

/** Puts back store credit an order spent, for an order turned down before it was taken on. */
async function returnWonCredit(repository: Repo, order: Order): Promise<number> {
  const buyer = await repository.getUserById(order.buyerId);
  const credits = buyer?.storeCredits ?? [];
  let back = 0;
  const next = credits.map((credit) => {
    const mine = credit.spends.filter((spend) => spend.orderId === order.id);
    if (mine.length === 0) return credit;
    const amount = mine.reduce((sum, spend) => sum + spend.amountMinor, 0);
    back += amount;
    return { ...credit, spentMinor: Math.max(0, credit.spentMinor - amount), spends: credit.spends.filter((spend) => spend.orderId !== order.id) };
  });
  if (buyer && back > 0) await repository.updateUser({ ...buyer, storeCredits: next });
  return back;
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

  applied += await spendWonCredit(repository, order, actorId, owing, now);

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

  returned += await returnWonCredit(repository, order);
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
