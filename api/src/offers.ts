import { priceBasket, earlyBirdOpen } from '../../shared/offers.js';
import type { LinePricing, OfferLine, ListingOffer } from '../../shared/offers.js';
import type { Listing, Order } from '../../shared/models.js';
import { inLot } from '../../shared/fulfilment.js';
import { isStopped } from '../../shared/orders.js';
import { orderMoney, rupees } from '../../shared/payments.js';
import { orderTotalMinor } from '../../shared/service-stores.js';
import type { getRepository } from './data/index.js';
import { notify, orderNames } from './functions/notify.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Why a basket was priced again, in the words a buyer is told.
 *
 * Lots are often decided after the sale, so the commonest reason is the shop
 * filing items into one lot - and the price follows the moment it does.
 */
export type RepriceCause = 'ordered' | 'lot' | 'cancelled' | 'placed';

const CAUSE_WORDS: Record<RepriceCause, string> = {
  ordered: 'because of what is in your basket',
  placed: 'because of what is in your basket',
  lot: 'because the shop put your items in a lot together',
  cancelled: 'because an item was cancelled or called off',
};

/** The ways an order can be priced before anybody pays: what the listing says now. */
export function snapshotFromListing(order: Order, listing: Listing): void {
  order.shipPerItemMinor = Math.max(0, listing.shippingMinor ?? 0);
  order.offerRules = (listing.offers ?? []).map((offer) => ({ ...offer }));
}

/**
 * Settles the offers that depend on the moment of ordering, once.
 *
 * Early-bird is earned by being early - the first N, or before a date - and
 * kept for the order, so a later cancellation by someone else cannot take it
 * back. Called when the checkout is made.
 */
export async function lockTimedOffers(repository: Repo, order: Order, listing: Listing): Promise<void> {
  const timed = (listing.offers ?? []).filter((offer) => ['early_bird', 'first_order', 'repeat_buyer'].includes(offer.kind));
  if (timed.length === 0) return;
  const before = (await repository.listOrdersForListing(listing.id))
    .filter((other) => other.id !== order.id && !isStopped(other.status) && other.placedAt !== null).length;
  const repeat = (await repository.listOrdersForBuyer(order.buyerId))
    .some((other) => other.sellerId === order.sellerId && other.id !== order.id && other.trustCountedAt && !isStopped(other.status));
  order.lockedOfferIds = timed
    .filter((offer) => offer.kind === 'early_bird' ? earlyBirdOpen(offer, before) : offer.kind === 'repeat_buyer' ? repeat : !repeat)
    .map((offer) => offer.id);
}

function lineOf(order: Order, listing: Listing | null, groupFilled: boolean): OfferLine {
  const placed = order.placedAt !== null;
  // A placed order keeps the offers it was bought under; a checkout follows the item.
  const rules: readonly ListingOffer[] = placed ? (order.offerRules ?? []) : (listing?.offers ?? order.offerRules ?? []);
  const shipping = placed ? (order.shipPerItemMinor ?? 0) : Math.max(0, listing?.shippingMinor ?? order.shipPerItemMinor ?? 0);
  return {
    id: order.id,
    listingId: order.listingId,
    lotId: inLot(order) ? order.lotId : null,
    quantity: order.quantity,
    unitPriceMinor: order.unitPriceMinor,
    shippingPerItemMinor: shipping,
    offers: rules,
    lockedOfferIds: order.lockedOfferIds,
    groupFilled,
    paidInFull: order.paidInFull === true,
    active: !isStopped(order.status),
  };
}

/** What a buyer's basket from one shop would cost, order by order. Does not save. */
export async function priceBuyerBasket(
  repository: Repo,
  sellerId: string,
  buyerId: string,
  options: { without?: string; include?: Order[] } = {},
): Promise<{ orders: Order[]; pricing: Map<string, LinePricing> }> {
  const mine = (await repository.listOrdersForBuyer(buyerId)).filter((order) => order.sellerId === sellerId);
  const byId = new Map(mine.map((order) => [order.id, order]));
  for (const extra of options.include ?? []) byId.set(extra.id, extra);
  const orders = [...byId.values()].filter((order) => order.id !== options.without);

  const listings = new Map<string, Listing | null>();
  for (const order of orders) {
    if (!listings.has(order.listingId)) listings.set(order.listingId, await repository.getListing(order.listingId));
  }
  const repeatBuyer = mine.some((order) => order.trustCountedAt && !isStopped(order.status));
  const lines = orders.map((order) => {
    const listing = listings.get(order.listingId) ?? null;
    const filled = Boolean(listing?.preOrder?.filledAt || listing?.preOrder?.proceededShortAt);
    return lineOf(order, listing, filled);
  });
  return { orders, pricing: priceBasket(lines, { repeatBuyer }) };
}

function describe(pricing: LinePricing): string {
  return pricing.applied.length > 0 ? pricing.applied.map((offer) => offer.label).join(', ') : 'no offer';
}

/**
 * Prices a buyer's basket from one shop again and saves what moved.
 *
 * The one place an order's shipping and discount are written. It runs when an
 * item is ordered, when the shop files items into a lot, and when an item is
 * cancelled or called off - so the price the buyer sees, the price the shop
 * sees and the price charged are always the same sum. Anything that moves a
 * placed order is told to both sides, with the reason.
 */
export async function repriceBasket(
  repository: Repo,
  sellerId: string,
  buyerId: string,
  cause: RepriceCause,
  options: { include?: Order[]; quiet?: boolean; actorId?: string } = {},
): Promise<Order[]> {
  const { orders, pricing } = await priceBuyerBasket(repository, sellerId, buyerId, { include: options.include });
  const changed: Order[] = [];

  for (const order of orders) {
    const next = pricing.get(order.id);
    if (!next || isStopped(order.status)) continue;
    const before = orderTotalMinor(order);
    const moved = (order.shippingMinor ?? 0) !== next.shippingMinor || (order.offerDiscountMinor ?? 0) !== next.discountMinor;
    const unplaced = order.placedAt === null;
    // Checkouts follow their item's shipping and offers as well as their basket.
    const listing = unplaced ? await repository.getListing(order.listingId) : null;
    if (unplaced && listing) snapshotFromListing(order, listing);
    if (!moved && !unplaced) continue;
    if (!moved && JSON.stringify(order.appliedOffers ?? []) === JSON.stringify(next.applied)) continue;

    order.shippingMinor = next.shippingMinor;
    order.offerDiscountMinor = next.discountMinor;
    order.appliedOffers = next.applied;
    order.updatedAt = new Date().toISOString();

    const after = orderTotalMinor(order);
    // Money already paid: say what is owed back or owed on top, and keep the
    // payment status honest for orders settled outside Figmark.
    const money = orderMoney(order);
    if (money.paidMinor > 0) {
      order.offerRefundDueMinor = Math.max(0, money.paidMinor - after);
      order.offerBalanceDueMinor = Math.max(0, after - money.paidMinor);
      if (order.hold.state === 'none') {
        if (order.paymentStatus === 'paid' && money.paidMinor < after) order.paymentStatus = 'partially_paid';
        else if (order.paymentStatus === 'partially_paid' && money.paidMinor >= after) order.paymentStatus = 'paid';
      }
    } else {
      order.offerRefundDueMinor = 0;
      order.offerBalanceDueMinor = 0;
    }
    await repository.updateOrder(order);
    changed.push(order);

    if (!options.quiet && !unplaced && after !== before) {
      await tellBoth(repository, order, before, after, next, cause, options.actorId);
    }
  }
  return changed;
}

async function tellBoth(
  repository: Repo, order: Order, before: number, after: number, pricing: LinePricing, cause: RepriceCause, actorId?: string,
): Promise<void> {
  const names = await orderNames(repository, order);
  const down = after < before;
  const diff = rupees(Math.abs(after - before));
  const link = `/order/${encodeURIComponent(order.id)}`;
  const owed = order.offerRefundDueMinor ?? 0;
  const topUp = order.offerBalanceDueMinor ?? 0;
  const why = CAUSE_WORDS[cause];

  await notify(repository, [order.buyerId], {
    kind: down ? 'offer_applied' : 'offer_changed',
    title: down
      ? `Good news: ${order.itemName} from ${names.shop} is ${diff} cheaper`
      : `The price of ${order.itemName} from ${names.shop} went up by ${diff}`,
    body: down
      ? `Now ${rupees(after)}, ${why}: ${describe(pricing)}.${owed > 0 ? ` ${names.shop} will send back the ${rupees(owed)} you already paid.` : ''}`
      : `Now ${rupees(after)}, ${why}. The offer it was under no longer applies.${topUp > 0 ? ` ${rupees(topUp)} is now due.` : ''}`,
    link,
  }, { except: actorId });
  await notify(repository, [order.sellerId], {
    kind: down ? 'offer_applied' : 'offer_changed',
    title: down
      ? `${names.buyer}'s ${order.itemName} dropped by ${diff}`
      : `${names.buyer}'s ${order.itemName} went up by ${diff}`,
    body: down
      ? `Now ${rupees(after)}, ${why}: ${describe(pricing)}.${owed > 0 ? ` Send back ${rupees(owed)}, which they paid already.` : ''}`
      : `Now ${rupees(after)}, ${why}.${topUp > 0 ? ` They owe ${rupees(topUp)} more.` : ''}`,
    link,
  }, { except: actorId });
}

/**
 * What a buyer loses if this order is taken out of their basket: the extra
 * they would pay on the others. Shown before they cancel, so it is never a
 * surprise afterwards.
 */
export async function cancellationImpact(
  repository: Repo, order: Order,
): Promise<{ extraMinor: number; lost: string[] }> {
  const { orders, pricing } = await priceBuyerBasket(repository, order.sellerId, order.buyerId, { without: order.id });
  const { pricing: now } = await priceBuyerBasket(repository, order.sellerId, order.buyerId);
  let extra = 0;
  const lost = new Set<string>();
  for (const other of orders) {
    if (isStopped(other.status)) continue;
    const had = now.get(other.id);
    const would = pricing.get(other.id);
    if (!had || !would) continue;
    const diff = (would.shippingMinor - had.shippingMinor) - (would.discountMinor - had.discountMinor);
    if (diff > 0) {
      extra += diff;
      for (const offer of had.applied) {
        if (!would.applied.some((kept) => kept.offerId === offer.offerId)) lost.add(offer.label);
      }
    }
  }
  return { extraMinor: extra, lost: [...lost] };
}

/**
 * What paying the full amount saves on an order that otherwise takes an
 * advance - the pay-in-full offer, read before the buyer chooses.
 */
export async function prepaySavingMinor(repository: Repo, order: Order): Promise<number> {
  if (!order.advancePercent || !(order.offerRules ?? []).some((offer) => offer.kind === 'prepay')) return 0;
  const current = await priceBuyerBasket(repository, order.sellerId, order.buyerId, { include: [{ ...order, paidInFull: false }] });
  const full = await priceBuyerBasket(repository, order.sellerId, order.buyerId, { include: [{ ...order, paidInFull: true }] });
  const a = current.pricing.get(order.id);
  const b = full.pricing.get(order.id);
  if (!a || !b) return 0;
  return Math.max(0, (a.shippingMinor - b.shippingMinor) + (b.discountMinor - a.discountMinor));
}
