/**
 * Seller offers: what a shop promises on an item, and how the price follows.
 *
 * One definition used by both sides. The API prices an order from it, and the
 * item page reads the very same text off it, so the offer a buyer was shown is
 * the offer they are charged by - never a promise the checkout then disagrees
 * with.
 *
 * Two rules shape everything here.
 *
 * The price on a card is the seller's price. Shipping is a separate, per-item
 * charge shown beside it ("Free shipping" or "+ ₹X shipping") and is never
 * folded into it. Offers only ever take shipping or money off; they cannot add
 * anything.
 *
 * Offers are decided by the *group* the buyer has built, not the single item.
 * "Same lot" means every item of the shop's that is travelling in one
 * shipment; "same order" means everything the buyer has from the shop, even
 * from different lots, because the shop may dispatch them together. The shop
 * says which, offer by offer. Lots are often decided after the sale, so an
 * order outside any lot yet is simply not counted toward a lot offer until it
 * is filed into one - and the price follows the moment it is.
 */

export const OFFER_KINDS = [
  'free_shipping',
  'discount',
  'bundle',
  'wholesale',
  'spend_free_shipping',
  'early_bird',
  'group_fill',
  'buy_x_get_y',
  'repeat_buyer',
  'first_order',
  'prepay',
] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** Same shipment, or everything the buyer has from the shop. */
export type OfferScope = 'lot' | 'shop';

export type OfferValue = { type: 'fixed' | 'percent'; value: number };

export interface WholesaleTier {
  /** Units of this item in one order. */
  minQty: number;
  /** A percentage off, or a dropped price per unit (minor units). */
  type: 'percent' | 'price';
  value: number;
}

export interface ListingOffer {
  id: string;
  kind: OfferKind;
  /** free_shipping, discount: which group of items counts. */
  scope?: OfferScope;
  /** free_shipping, discount, buy_x_get_y, bundle: how many items it takes. */
  minItems?: number;
  /** Money off: a rupee amount per item, or a percentage of it. */
  discount?: OfferValue;
  /** spend_free_shipping: the order subtotal that unlocks it. */
  minSpendMinor?: number;
  /** bundle: what N of this item cost together. */
  bundlePriceMinor?: number;
  /** buy_x_get_y: how many come free. */
  freeQty?: number;
  /** wholesale: the price ladder. */
  tiers?: WholesaleTier[];
  /** early_bird: the first N orders, and/or until a date. */
  limit?: number;
  until?: string | null;
  /** group_fill: the reward is free shipping rather than money off. */
  freeShipping?: boolean;
}

export const MAX_OFFERS_PER_ITEM = 8;
export const MAX_WHOLESALE_TIERS = 4;

/** Every kind, in the order a seller picks from and a buyer reads. */
export const OFFER_KIND_INFO: Record<OfferKind, { name: string; blurb: string; groups: boolean }> = {
  free_shipping: { name: 'Free shipping on multiple items', blurb: 'Shipping is free when the buyer takes enough items together.', groups: true },
  discount: { name: 'Discount on multiple items', blurb: 'Money off each item when the buyer takes enough together.', groups: true },
  bundle: { name: 'Bundle price', blurb: 'Any N of this item for one price.', groups: false },
  wholesale: { name: 'Wholesale price', blurb: 'A lower price when buying in bulk.', groups: false },
  spend_free_shipping: { name: 'Free shipping over a spend', blurb: 'Shipping is free once the order reaches an amount.', groups: false },
  early_bird: { name: 'Early-bird price', blurb: 'A lower price for the first buyers, or until a date.', groups: false },
  group_fill: { name: 'Group-buy reward', blurb: 'A reward for everyone once the group buy fills.', groups: false },
  buy_x_get_y: { name: 'Buy X, get some free', blurb: 'Buy a number of this item and get some free.', groups: false },
  repeat_buyer: { name: 'Repeat-buyer perk', blurb: 'Money off for buyers who have bought from this shop before.', groups: false },
  first_order: { name: 'First-order offer', blurb: 'Money off a buyer\'s first purchase from this shop.', groups: false },
  prepay: { name: 'Pay-in-full discount', blurb: 'Money off for paying the whole amount instead of an advance.', groups: false },
};

/* ── Text ───────────────────────────────────────────────────────────────── */

const rupees = (minor: number): string => {
  const value = minor / 100;
  return `₹${Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
};

const moneyOff = (value: OfferValue | undefined): string =>
  !value ? 'money off' : value.type === 'percent' ? `${value.value}% off` : `${rupees(value.value)} off`;

/** Where the items have to be for this offer to count them. */
export const scopeWords = (scope: OfferScope | undefined): string =>
  scope === 'shop' ? 'from this shop in one order, even from different lots' : 'in the same lot';

/** The headline on the chip: short, because the row it sits in scrolls sideways. */
export function offerLabel(offer: ListingOffer): string {
  switch (offer.kind) {
    case 'free_shipping': return `Free shipping on ${offer.minItems ?? 2}+`;
    case 'discount': return `${moneyOff(offer.discount)} on ${offer.minItems ?? 2}+`;
    case 'bundle': return `Any ${offer.minItems ?? 2} for ${rupees(offer.bundlePriceMinor ?? 0)}`;
    case 'wholesale': return 'Wholesale price';
    case 'spend_free_shipping': return `Free shipping over ${rupees(offer.minSpendMinor ?? 0)}`;
    case 'early_bird': return offer.limit ? `Early bird: first ${offer.limit}` : 'Early-bird price';
    case 'group_fill': return offer.freeShipping ? 'Free shipping when it fills' : `${moneyOff(offer.discount)} when it fills`;
    case 'buy_x_get_y': return `Buy ${offer.minItems ?? 2}, get ${offer.freeQty ?? 1} free`;
    case 'repeat_buyer': return `${moneyOff(offer.discount)} for repeat buyers`;
    case 'first_order': return `${moneyOff(offer.discount)} on your first order`;
    case 'prepay': return `${moneyOff(offer.discount)} if you pay in full`;
  }
}

/** One plain sentence: what the buyer gets and what it takes. */
export function offerSummary(offer: ListingOffer): string {
  switch (offer.kind) {
    case 'free_shipping':
      return `Free shipping when you buy ${offer.minItems ?? 2} or more items ${scopeWords(offer.scope)}.`;
    case 'discount':
      return `${moneyOff(offer.discount)} each item when you buy ${offer.minItems ?? 2} or more items ${scopeWords(offer.scope)}.`;
    case 'bundle':
      return `Buy ${offer.minItems ?? 2} of this item for ${rupees(offer.bundlePriceMinor ?? 0)} together.`;
    case 'wholesale':
      return (offer.tiers ?? []).map((tier) =>
        `${tier.minQty}+ units: ${tier.type === 'percent' ? `${tier.value}% off` : `${rupees(tier.value)} each`}`).join(' · ');
    case 'spend_free_shipping':
      return `Free shipping when your order from this shop comes to ${rupees(offer.minSpendMinor ?? 0)} or more.`;
    case 'early_bird': {
      const parts = [
        offer.limit ? `the first ${offer.limit} orders` : null,
        offer.until ? `orders placed by ${new Date(offer.until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : null,
      ].filter(Boolean);
      return `${moneyOff(offer.discount)} for ${parts.join(' and ') || 'early buyers'}.`;
    }
    case 'group_fill':
      return offer.freeShipping
        ? 'Everyone in this group buy gets free shipping once it fills.'
        : `Everyone in this group buy gets ${moneyOff(offer.discount)} once it fills.`;
    case 'buy_x_get_y':
      return `Buy ${offer.minItems ?? 2} of this item and get ${offer.freeQty ?? 1} free.`;
    case 'repeat_buyer':
      return `${moneyOff(offer.discount)} if you have bought from this shop before.`;
    case 'first_order':
      return `${moneyOff(offer.discount)} if this is your first purchase from this shop.`;
    case 'prepay':
      return `${moneyOff(offer.discount)} when you pay the full amount rather than an advance.`;
  }
}

/**
 * The terms, shown on the offer, at checkout and on the order.
 *
 * The cancellation line is the one that matters: an offer is earned by the
 * group, so taking one item out can lose it for the rest, and nobody should
 * learn that after the fact.
 */
export function offerTerms(offer: ListingOffer): string[] {
  const terms: string[] = [];
  if (offer.kind === 'free_shipping' || offer.kind === 'discount') {
    terms.push(offer.scope === 'shop'
      ? 'Counts every item you order from this shop, even if they travel in different lots, as long as the shop dispatches them together.'
      : 'Counts items that are in the same lot. If a lot is not decided yet, the offer applies as soon as the shop puts your items in the same one, and your price updates automatically.');
    terms.push('If you cancel an item, or an item is called off, and the rest no longer qualify, this offer ends and the price of the remaining items goes back up.');
  }
  if (offer.kind === 'spend_free_shipping') {
    terms.push('The spend is worked out on the price of your items before shipping. If cancelling an item brings you under it, shipping is charged again.');
  }
  if (offer.kind === 'bundle' || offer.kind === 'buy_x_get_y' || offer.kind === 'wholesale') {
    terms.push('Applies to the quantity you order of this item. Lowering the quantity below the minimum removes the offer.');
  }
  if (offer.kind === 'early_bird') {
    terms.push('Decided when you place your order and kept for it, even if the limit fills afterwards. A cancelled order does not hand its place to anyone.');
  }
  if (offer.kind === 'group_fill') {
    terms.push('Given only if the group buy goes ahead. If it does not, the order is handled under the pre-order rules instead.');
  }
  if (offer.kind === 'repeat_buyer' || offer.kind === 'first_order') {
    terms.push('Based on your completed orders with this shop at the time you order.');
  }
  if (offer.kind === 'prepay') {
    terms.push('Applies only if you choose to pay the full amount up front.');
  }
  terms.push('One discount from each offer. If more than one offer gives money off, you get the best one for each item rather than all of them added together.');
  terms.push('Offers can be changed or removed by the shop for future orders, but never for an order you have already placed.');
  terms.push('Shipping is charged per item unless an offer says otherwise.');
  return terms;
}

/* ── Validation ─────────────────────────────────────────────────────────── */

const whole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

function cleanValue(raw: unknown): OfferValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const { type, value } = raw as { type?: unknown; value?: unknown };
  if (type === 'percent') return whole(value, 1, 90) ? { type, value } : null;
  if (type === 'fixed') return whole(value, 100, 100_000_000) ? { type, value } : null;
  return null;
}

/**
 * The offers a seller sent, checked and cleaned, or the first thing wrong.
 *
 * Strict on purpose: an offer with a missing number is a promise nobody can
 * price, so it is refused rather than guessed at.
 */
export function cleanOffers(raw: unknown, unitPriceMinor?: number): { offers: ListingOffer[]; error: string | null } {
  if (raw === undefined || raw === null) return { offers: [], error: null };
  if (!Array.isArray(raw)) return { offers: [], error: 'Offers must be a list.' };
  if (raw.length > MAX_OFFERS_PER_ITEM) return { offers: [], error: `An item can carry at most ${MAX_OFFERS_PER_ITEM} offers.` };

  const offers: ListingOffer[] = [];
  const seen = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const source = (item ?? {}) as Record<string, unknown>;
    const kind = source.kind as OfferKind;
    if (!OFFER_KINDS.includes(kind)) return { offers: [], error: `Offer ${index + 1}: pick what kind of offer it is.` };
    if (seen.has(kind) && kind !== 'discount' && kind !== 'free_shipping') {
      return { offers: [], error: `${OFFER_KIND_INFO[kind].name} can only be added once per item.` };
    }
    seen.add(kind);
    const where = `${OFFER_KIND_INFO[kind].name}:`;
    const offer: ListingOffer = {
      id: typeof source.id === 'string' && source.id.length > 0 && source.id.length <= 40 ? source.id : `${kind}_${index + 1}`,
      kind,
    };

    if (kind === 'free_shipping' || kind === 'discount') {
      if (!whole(source.minItems, 2, 100)) return { offers: [], error: `${where} say how many items it takes (2 or more).` };
      offer.minItems = source.minItems;
      offer.scope = source.scope === 'shop' ? 'shop' : 'lot';
    }
    if (kind === 'discount' || kind === 'early_bird' || kind === 'repeat_buyer' || kind === 'first_order' || kind === 'prepay'
      || (kind === 'group_fill' && source.freeShipping !== true)) {
      const discount = cleanValue(source.discount);
      if (!discount) return { offers: [], error: `${where} give an amount off (₹1 or more) or a percentage (1 to 90).` };
      if (discount.type === 'fixed' && unitPriceMinor !== undefined && discount.value >= unitPriceMinor) {
        return { offers: [], error: `${where} the amount off has to be less than the item's price.` };
      }
      offer.discount = discount;
    }
    if (kind === 'group_fill') offer.freeShipping = source.freeShipping === true;
    if (kind === 'bundle') {
      if (!whole(source.minItems, 2, 100)) return { offers: [], error: `${where} say how many items make a bundle (2 or more).` };
      if (!whole(source.bundlePriceMinor, 100, 1_000_000_000)) return { offers: [], error: `${where} give the bundle price.` };
      if (unitPriceMinor !== undefined && source.bundlePriceMinor >= unitPriceMinor * source.minItems) {
        return { offers: [], error: `${where} the bundle price has to be less than buying them one by one.` };
      }
      offer.minItems = source.minItems;
      offer.bundlePriceMinor = source.bundlePriceMinor;
    }
    if (kind === 'buy_x_get_y') {
      if (!whole(source.minItems, 1, 100)) return { offers: [], error: `${where} say how many to buy.` };
      if (!whole(source.freeQty, 1, 100)) return { offers: [], error: `${where} say how many come free.` };
      offer.minItems = source.minItems;
      offer.freeQty = source.freeQty;
    }
    if (kind === 'spend_free_shipping') {
      if (!whole(source.minSpendMinor, 100, 1_000_000_000)) return { offers: [], error: `${where} give the spend that unlocks it.` };
      offer.minSpendMinor = source.minSpendMinor;
    }
    if (kind === 'early_bird') {
      const limit = source.limit === undefined || source.limit === null ? null : source.limit;
      const until = typeof source.until === 'string' && source.until ? source.until : null;
      if (limit === null && !until) return { offers: [], error: `${where} set a number of buyers, a date, or both.` };
      if (limit !== null) {
        if (!whole(limit, 1, 10_000)) return { offers: [], error: `${where} the number of early buyers must be a whole number.` };
        offer.limit = limit;
      }
      if (until) {
        if (!Number.isFinite(Date.parse(until))) return { offers: [], error: `${where} that date is not valid.` };
        offer.until = until;
      }
    }
    if (kind === 'wholesale') {
      const tiers = Array.isArray(source.tiers) ? source.tiers : [];
      if (tiers.length === 0 || tiers.length > MAX_WHOLESALE_TIERS) {
        return { offers: [], error: `${where} add between 1 and ${MAX_WHOLESALE_TIERS} price steps.` };
      }
      const cleaned: WholesaleTier[] = [];
      for (const tier of tiers as Record<string, unknown>[]) {
        if (!whole(tier.minQty, 2, 100_000)) return { offers: [], error: `${where} each step needs a quantity of 2 or more.` };
        if (tier.type === 'percent') {
          if (!whole(tier.value, 1, 90)) return { offers: [], error: `${where} a percentage step is 1 to 90.` };
        } else if (tier.type === 'price') {
          if (!whole(tier.value, 100, 1_000_000_000)) return { offers: [], error: `${where} give each dropped price.` };
          if (unitPriceMinor !== undefined && tier.value >= unitPriceMinor) {
            return { offers: [], error: `${where} a dropped price has to be lower than the normal price.` };
          }
        } else {
          return { offers: [], error: `${where} each step is a percentage or a dropped price.` };
        }
        cleaned.push({ minQty: tier.minQty as number, type: tier.type, value: tier.value as number });
      }
      cleaned.sort((a, b) => a.minQty - b.minQty);
      for (let i = 1; i < cleaned.length; i += 1) {
        if (cleaned[i]!.minQty === cleaned[i - 1]!.minQty) return { offers: [], error: `${where} each step needs a different quantity.` };
      }
      offer.tiers = cleaned;
    }
    offers.push(offer);
  }
  return { offers, error: null };
}

/** The headline for a card: the lowest wholesale price, when the item has one. */
export function wholesaleHint(
  offers: readonly ListingOffer[] | undefined,
  unitPriceMinor: number,
): { minQty: number; priceMinor: number } | null {
  const wholesale = (offers ?? []).find((offer) => offer.kind === 'wholesale');
  if (!wholesale?.tiers?.length) return null;
  const best = [...wholesale.tiers]
    .map((tier) => ({ minQty: tier.minQty, priceMinor: tier.type === 'price' ? tier.value : Math.round(unitPriceMinor * (100 - tier.value) / 100) }))
    .sort((a, b) => a.priceMinor - b.priceMinor)[0];
  return best ?? null;
}

/* ── Pricing ────────────────────────────────────────────────────────────── */

/**
 * Whether an early-bird offer is still open for an order being placed now.
 * `ordersBefore` is how many orders the item already has.
 */
export function earlyBirdOpen(offer: ListingOffer, ordersBefore: number, now: number = Date.now()): boolean {
  if (offer.kind !== 'early_bird') return false;
  if (offer.limit && ordersBefore >= offer.limit) return false;
  if (offer.until && Date.parse(offer.until) < now) return false;
  return true;
}

/** One order line, as the pricing sees it. */
export interface OfferLine {
  id: string;
  listingId: string;
  /** The real lot it is travelling in, or null while it waits for one. */
  lotId: string | null;
  quantity: number;
  unitPriceMinor: number;
  /** What the shop charges to ship one of it, before any offer. */
  shippingPerItemMinor: number;
  offers: readonly ListingOffer[];
  /** Offers earned at the moment of ordering - early bird, first order, repeat buyer - and kept. */
  lockedOfferIds?: readonly string[];
  /** The group buy this line belongs to has filled. */
  groupFilled?: boolean;
  /** The buyer is paying the full amount rather than an advance. */
  paidInFull?: boolean;
  /** Called off or cancelled lines are left out of every count. */
  active: boolean;
}

export interface OfferWho {
  /** Has completed an order with this shop before. */
  repeatBuyer: boolean;
}

export interface AppliedOffer {
  offerId: string;
  kind: OfferKind;
  label: string;
  /** What it took off this line: money and shipping together. */
  savedMinor: number;
}

export interface LinePricing {
  /** What shipping this line costs the buyer now. */
  shippingMinor: number;
  /** What every offer together took off the goods. */
  discountMinor: number;
  applied: AppliedOffer[];
}

const percentOf = (amount: number, percent: number): number => Math.round(amount * percent / 100);

function valueOff(value: OfferValue, unitMinor: number, quantity: number): number {
  const perUnit = value.type === 'percent' ? percentOf(unitMinor, value.value) : value.value;
  // Never takes an item below ₹1.
  return Math.min(perUnit, Math.max(0, unitMinor - 100)) * quantity;
}

/** Items counted toward a line's group offer, by the scope the shop chose. */
function groupCount(line: OfferLine, lines: readonly OfferLine[], scope: OfferScope | undefined): number {
  const inGroup = scope === 'shop'
    ? lines.filter((other) => other.active)
    : line.lotId
      ? lines.filter((other) => other.active && other.lotId === line.lotId)
      : [line];
  return inGroup.reduce((sum, other) => sum + other.quantity, 0);
}

/**
 * Prices every line of one buyer's basket from one shop.
 *
 * Pure: the same lines always price the same, so the item page can show
 * progress, the checkout can show the total and the server can reprice when a
 * lot is filled, all from this one function.
 *
 * Money off: of every offer that qualifies, a line gets the single best one -
 * offers are not stacked, which keeps both the maths and the promise simple.
 * Shipping: free if any qualifying offer says so.
 */
export function priceBasket(
  lines: readonly OfferLine[],
  who: OfferWho,
): Map<string, LinePricing> {
  const result = new Map<string, LinePricing>();
  const subtotal = lines.filter((line) => line.active).reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);

  for (const line of lines) {
    const base = line.unitPriceMinor * line.quantity;
    if (!line.active) {
      result.set(line.id, { shippingMinor: 0, discountMinor: 0, applied: [] });
      continue;
    }

    let shipFree: { offer: ListingOffer } | null = null;
    const moneyOffers: { offer: ListingOffer; off: number }[] = [];
    const freeShip = (offer: ListingOffer) => { shipFree ??= { offer }; };

    for (const offer of line.offers) {
      switch (offer.kind) {
        case 'free_shipping':
          if (groupCount(line, lines, offer.scope) >= (offer.minItems ?? 2)) freeShip(offer);
          break;
        case 'discount':
          if (offer.discount && groupCount(line, lines, offer.scope) >= (offer.minItems ?? 2)) {
            moneyOffers.push({ offer, off: valueOff(offer.discount, line.unitPriceMinor, line.quantity) });
          }
          break;
        case 'bundle': {
          const size = offer.minItems ?? 2;
          const sets = Math.floor(line.quantity / size);
          const per = line.unitPriceMinor * size - (offer.bundlePriceMinor ?? 0);
          if (sets > 0 && per > 0) moneyOffers.push({ offer, off: sets * per });
          break;
        }
        case 'wholesale': {
          const tier = [...(offer.tiers ?? [])].filter((t) => line.quantity >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0];
          if (!tier) break;
          const off = tier.type === 'percent'
            ? Math.min(percentOf(line.unitPriceMinor, tier.value), line.unitPriceMinor - 100) * line.quantity
            : Math.max(0, line.unitPriceMinor - tier.value) * line.quantity;
          if (off > 0) moneyOffers.push({ offer, off });
          break;
        }
        case 'spend_free_shipping':
          if (subtotal >= (offer.minSpendMinor ?? Infinity)) freeShip(offer);
          break;
        case 'early_bird':
          // Earned at the moment of ordering (see `earlyBirdOpen`) and kept.
          if (offer.discount && line.lockedOfferIds?.includes(offer.id)) {
            moneyOffers.push({ offer, off: valueOff(offer.discount, line.unitPriceMinor, line.quantity) });
          }
          break;
        case 'group_fill':
          if (line.groupFilled) {
            if (offer.freeShipping) freeShip(offer);
            else if (offer.discount) moneyOffers.push({ offer, off: valueOff(offer.discount, line.unitPriceMinor, line.quantity) });
          }
          break;
        case 'buy_x_get_y': {
          const set = (offer.minItems ?? 1) + (offer.freeQty ?? 1);
          const free = Math.floor(line.quantity / set) * (offer.freeQty ?? 1);
          if (free > 0) moneyOffers.push({ offer, off: free * line.unitPriceMinor });
          break;
        }
        case 'repeat_buyer':
        case 'first_order': {
          // Settled when the order was made and kept, so finishing one order
          // never takes a first-order offer off another still on its way.
          const qualifies = line.lockedOfferIds
            ? line.lockedOfferIds.includes(offer.id)
            : offer.kind === 'repeat_buyer' ? who.repeatBuyer : !who.repeatBuyer;
          if (qualifies && offer.discount) moneyOffers.push({ offer, off: valueOff(offer.discount, line.unitPriceMinor, line.quantity) });
          break;
        }
        case 'prepay':
          if (line.paidInFull && offer.discount) moneyOffers.push({ offer, off: valueOff(offer.discount, line.unitPriceMinor, line.quantity) });
          break;
      }
    }

    const best = moneyOffers.sort((a, b) => b.off - a.off)[0];
    const discountMinor = Math.min(best?.off ?? 0, Math.max(0, base - 100 * line.quantity));
    const fullShipping = line.shippingPerItemMinor * line.quantity;
    const free = shipFree as { offer: ListingOffer } | null;
    const applied: AppliedOffer[] = [];
    if (best && discountMinor > 0) {
      applied.push({ offerId: best.offer.id, kind: best.offer.kind, label: offerLabel(best.offer), savedMinor: discountMinor });
    }
    if (free && fullShipping > 0) {
      applied.push({ offerId: free.offer.id, kind: free.offer.kind, label: offerLabel(free.offer), savedMinor: fullShipping });
    }
    result.set(line.id, { shippingMinor: free ? 0 : fullShipping, discountMinor, applied });
  }
  return result;
}

/**
 * How close a buyer is to an offer they have not got yet, in generic words.
 *
 * Lots are often decided later, so this never promises a lot: it says what is
 * still needed and where it counts.
 */
export function nextStepFor(offer: ListingOffer, have: { items: number; spendMinor: number }): string | null {
  if (offer.kind === 'free_shipping' || offer.kind === 'discount') {
    const need = (offer.minItems ?? 2) - have.items;
    if (need <= 0) return null;
    return `Add ${need} more ${need === 1 ? 'item' : 'items'} ${offer.scope === 'shop' ? 'from this shop' : 'to the same lot'} to get this.`;
  }
  if (offer.kind === 'spend_free_shipping') {
    const need = (offer.minSpendMinor ?? 0) - have.spendMinor;
    return need > 0 ? `Spend ${rupees(need)} more with this shop to get this.` : null;
  }
  return null;
}
