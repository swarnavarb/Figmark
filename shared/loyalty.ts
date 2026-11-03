/**
 * Loyalty cards: a Pro shop's stamp cards.
 *
 * Every delivered order of an item a card covers stamps it - once, or once
 * per item in it when the shop says so (`stampPer`). A card holds eight stamps; the shop puts a reward on any of them the operators allow -
 * cashback, a free item, free shipping, money off. A full card starts again.
 *
 * Cashback is paid at once as store credit at that shop, so it comes off the
 * buyer's next order there by itself. Everything else is a reward the buyer
 * holds in their wallet until the shop marks it given.
 *
 * Rewards and offers never collide: an order pays out at most one reward, and
 * none at all when it already took an offer (money off, free shipping, a
 * bundle price). A reward reached on such an order still counts - it waits,
 * and the buyer's next stamping order without an offer pays it.
 *
 * What may be offered, on which stamps, and how much, is the operators' to say
 * (`LoyaltySettings`, in the pricing document).
 */

export const STAMPS = 8;

export const REWARD_KINDS = ['cashback_flat', 'cashback_percent', 'free_item', 'free_shipping', 'percent_off', 'custom'] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const REWARD_META: Record<RewardKind, { icon: string; label: string; hint: string; credit: boolean }> = {
  cashback_flat: { icon: '💸', label: 'Cashback (₹)', hint: 'A fixed amount, paid as store credit the moment the stamp lands.', credit: true },
  cashback_percent: { icon: '🔁', label: 'Cashback (%)', hint: 'A share of the stamped order, paid as store credit at once.', credit: true },
  free_item: { icon: '🎁', label: 'Free item', hint: 'Something free with a later order - the shop hands it over.', credit: false },
  free_shipping: { icon: '🚚', label: 'Free shipping', hint: 'Shipping on the next order is on the shop.', credit: false },
  percent_off: { icon: '🏷️', label: '% off next order', hint: 'Money off the next order, applied by the shop.', credit: false },
  custom: { icon: '⭐', label: 'Something else', hint: 'Anything the shop words itself: early access, a sticker, a sample.', credit: false },
};

export interface LoyaltySettings {
  /** Off: no shop can run a card, and no stamps land. */
  enabled: boolean;
  /** Which rewards shops may put on a stamp. */
  rewardKinds: Record<RewardKind, boolean>;
  /** Which stamps (1 to 8) may carry a reward at all. */
  stampsAllowed: boolean[];
  /** Cards one shop may run at once. */
  maxCards: number;
  /** The most a percent cashback may be, in basis points of the order. */
  maxCashbackBp: number;
  /** The most a fixed cashback may be. */
  maxFlatMinor: number;
  /** The most a "% off" may be. */
  maxPercentOffBp: number;
}

export const DEFAULT_LOYALTY: LoyaltySettings = {
  enabled: true,
  rewardKinds: { cashback_flat: true, cashback_percent: true, free_item: true, free_shipping: true, percent_off: true, custom: true },
  stampsAllowed: Array.from({ length: STAMPS }, () => true),
  maxCards: 3,
  maxCashbackBp: 1_000,
  maxFlatMinor: 50_000,
  maxPercentOffBp: 2_500,
};

export interface LoyaltyReward {
  kind: RewardKind;
  /** Cashback in rupees. */
  amountMinor?: number;
  /** Cashback or money off, in basis points. */
  bp?: number;
  /** A free item, or the shop's own words. */
  text?: string;
}

/** One stamp per delivered order, or one per item in it. */
export type StampPer = 'order' | 'item';

/** The most stamps one order can give on a per-item card: a full card. */
export const MAX_STAMPS_PER_ORDER = STAMPS;

export const CARD_THEMES = ['gold', 'pink', 'mint', 'violet', 'ink'] as const;
export type CardTheme = (typeof CARD_THEMES)[number];

export interface LoyaltyCard {
  id: string;
  ownerId: string;
  name: string;
  theme: CardTheme;
  /** The items it covers; null for every item the shop sells. */
  listingIds: string[] | null;
  /** An order below this does not stamp. */
  minOrderMinor: number;
  /** `item` stamps once per item in an order; missing on older cards, which stamp once per order. */
  stampPer?: StampPer;
  /** One slot per stamp, a reward or nothing. */
  rewards: (LoyaltyReward | null)[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A reward a stamp earned somebody. */
export interface IssuedReward {
  /** `${cardId}:${round}:${stamp}` - earning the same stamp twice is a no-op. */
  id: string;
  cardId: string;
  cardName: string;
  ownerId: string;
  shopName: string;
  buyerId: string;
  buyerName: string;
  round: number;
  stamp: number;
  reward: LoyaltyReward;
  /** The order that paid it out - the stamping order, or a later one when that one took an offer. */
  orderId: string;
  itemName: string;
  at: string;
  /** What was credited, for cashback. */
  valueMinor: number;
  /** `credited` - cashback, already store credit. `ready` - waiting to be used. */
  status: 'credited' | 'ready' | 'used';
  usedAt: string | null;
}

/** Where one buyer stands on one card. */
export interface CardProgress {
  card: LoyaltyCard;
  shopName: string;
  /** Stamps on the current card, 0 to 7 (a full card has rolled over). */
  stamps: number;
  /** Which time round the card this is, from 1. */
  round: number;
  total: number;
  next: { stamp: number; reward: LoyaltyReward } | null;
  /** Rewards reached but not paid yet: they come with the next order that takes no offer. */
  waiting: number;
  rewards: IssuedReward[];
}

const int = (value: unknown): number | null => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) ? number : null;
};

export function cleanLoyaltySettings(raw: unknown, base: LoyaltySettings = DEFAULT_LOYALTY): { loyalty: LoyaltySettings } | { error: string } {
  const loyalty: LoyaltySettings = JSON.parse(JSON.stringify(base)) as LoyaltySettings;
  if (!raw || typeof raw !== 'object') return { loyalty };
  const input = raw as Record<string, unknown>;
  if (input.enabled !== undefined) loyalty.enabled = input.enabled === true;
  const kinds = (input.rewardKinds ?? {}) as Record<string, unknown>;
  for (const kind of REWARD_KINDS) if (kinds[kind] !== undefined) loyalty.rewardKinds[kind] = kinds[kind] === true;
  if (Array.isArray(input.stampsAllowed)) {
    loyalty.stampsAllowed = Array.from({ length: STAMPS }, (_, index) => (input.stampsAllowed as unknown[])[index] !== false);
  }
  const bounded = (key: keyof LoyaltySettings, low: number, high: number, message: string): string | null => {
    if (input[key] === undefined) return null;
    const value = int(input[key]);
    if (value === null || value < low || value > high) return message;
    (loyalty as unknown as Record<string, number>)[key] = value;
    return null;
  };
  const problem = bounded('maxCards', 1, 10, 'A shop runs 1 to 10 cards.')
    ?? bounded('maxCashbackBp', 0, 5_000, 'Cashback is 0% to 50% of the order.')
    ?? bounded('maxFlatMinor', 0, 10_00_000, 'Fixed cashback is ₹0 to ₹10,000.')
    ?? bounded('maxPercentOffBp', 0, 10_000, 'Money off is 0% to 100%.');
  return problem ? { error: problem } : { loyalty };
}

/** The reward in a few words: "₹50 cashback", "10% back", "Free tote bag". */
export function rewardWords(reward: LoyaltyReward, money: (minor: number) => string): string {
  const pct = (bp = 0) => `${(bp / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
  switch (reward.kind) {
    case 'cashback_flat': return `${money(reward.amountMinor ?? 0)} cashback`;
    case 'cashback_percent': return `${pct(reward.bp)} cashback`;
    case 'free_item': return `Free ${reward.text || 'item'}`;
    case 'free_shipping': return 'Free shipping';
    case 'percent_off': return `${pct(reward.bp)} off next order`;
    default: return reward.text || 'A surprise';
  }
}

/** Checks a card a shop saved against the operators' rules. */
export function cleanCard(
  raw: unknown, settings: LoyaltySettings,
): { card: Pick<LoyaltyCard, 'name' | 'theme' | 'listingIds' | 'minOrderMinor' | 'stampPer' | 'rewards' | 'active'> } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Send the card.' };
  const input = raw as Record<string, unknown>;
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 40) : '';
  if (name.length < 2) return { error: 'Give the card a name.' };
  const theme = CARD_THEMES.includes(input.theme as CardTheme) ? input.theme as CardTheme : 'gold';
  const listingIds = Array.isArray(input.listingIds)
    ? [...new Set(input.listingIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 200)
    : null;
  if (listingIds && listingIds.length === 0) return { error: 'Pick at least one item, or let the card cover every item.' };
  const min = int(input.minOrderMinor ?? 0);
  if (min === null || min < 0 || min > 10_00_000) return { error: 'The smallest order that stamps is ₹0 to ₹10,000.' };
  const slots = Array.isArray(input.rewards) ? input.rewards : [];
  const rewards: (LoyaltyReward | null)[] = [];
  for (let index = 0; index < STAMPS; index += 1) {
    const slot = slots[index] as Record<string, unknown> | null | undefined;
    if (!slot || !slot.kind) { rewards.push(null); continue; }
    const kind = slot.kind as RewardKind;
    const at = `Stamp ${index + 1}`;
    if (!REWARD_KINDS.includes(kind) || !settings.rewardKinds[kind]) return { error: `${at}: that reward is not offered on Figmark right now.` };
    if (!settings.stampsAllowed[index]) return { error: `${at} cannot carry a reward.` };
    const reward: LoyaltyReward = { kind };
    if (kind === 'cashback_flat') {
      const amount = int(slot.amountMinor);
      if (amount === null || amount <= 0 || amount > settings.maxFlatMinor) return { error: `${at}: cashback is up to ₹${settings.maxFlatMinor / 100}.` };
      reward.amountMinor = amount;
    } else if (kind === 'cashback_percent' || kind === 'percent_off') {
      const cap = kind === 'cashback_percent' ? settings.maxCashbackBp : settings.maxPercentOffBp;
      const bp = int(slot.bp);
      if (bp === null || bp <= 0 || bp > cap) return { error: `${at}: up to ${cap / 100}%.` };
      reward.bp = bp;
    } else if (kind === 'free_item' || kind === 'custom') {
      const text = typeof slot.text === 'string' ? slot.text.trim().slice(0, 60) : '';
      if (text.length < 2) return { error: `${at}: say what it is.` };
      reward.text = text;
    }
    rewards.push(reward);
  }
  if (!rewards.some(Boolean)) return { error: 'Put a reward on at least one stamp.' };
  const stampPer: StampPer = input.stampPer === 'item' ? 'item' : 'order';
  return { card: { name, theme, listingIds, minOrderMinor: min, stampPer, rewards, active: input.active !== false } };
}

/** Whether an order stamps a card: delivered, an item the card covers, big enough, after the card began. */
export function stampsCard(
  card: LoyaltyCard,
  order: { sellerId: string; listingId: string; status: string; completedAt: string | null; quantity: number; unitPriceMinor: number },
): boolean {
  return order.sellerId === card.ownerId
    && order.status === 'delivered'
    && Boolean(order.completedAt) && order.completedAt! >= card.createdAt
    && (card.listingIds === null || card.listingIds.includes(order.listingId))
    && order.quantity * order.unitPriceMinor >= card.minOrderMinor;
}

type StampOrder = Parameters<typeof stampsCard>[1] & {
  id: string;
  offerDiscountMinor?: number;
  appliedOffers?: { savedMinor: number }[];
};

/** Whether an order already took an offer - and so pays out no loyalty reward. */
export const tookOffer = (order: Pick<StampOrder, 'offerDiscountMinor' | 'appliedOffers'>): boolean =>
  (order.offerDiscountMinor ?? 0) > 0 || (order.appliedOffers ?? []).some((applied) => applied.savedMinor > 0);

/** How many stamps one order puts on a card. */
export const stampsFrom = (card: Pick<LoyaltyCard, 'stampPer'>, order: { quantity: number }): number =>
  card.stampPer === 'item' ? Math.min(MAX_STAMPS_PER_ORDER, Math.max(1, Math.floor(order.quantity))) : 1;

/** A reward a card has paid out, before it is written down. */
export interface Payout<O> {
  id: string;
  round: number;
  stamp: number;
  reward: LoyaltyReward;
  /** The order it is paid on. */
  order: O;
}

/**
 * One buyer's history on one card, replayed from their delivered orders in
 * the order they arrived. The same orders always give the same answer, so
 * the ids it hands out are stable and paying twice is impossible.
 */
export function replayCard<O extends StampOrder>(card: LoyaltyCard, orders: readonly O[]): {
  total: number; payouts: Payout<O>[]; waiting: Omit<Payout<O>, 'order'>[];
} {
  const stamped = orders.filter((order) => stampsCard(card, order))
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.id.localeCompare(b.id));
  let total = 0;
  const queue: Omit<Payout<O>, 'order'>[] = [];
  const payouts: Payout<O>[] = [];
  for (const order of stamped) {
    for (let count = stampsFrom(card, order); count > 0; count -= 1) {
      const { round, stamp } = stampPosition(total);
      total += 1;
      const reward = card.rewards[stamp - 1];
      if (reward) queue.push({ id: `${card.id}:${round}:${stamp}`, round, stamp, reward });
    }
    // One reward per order, and none on an order that took an offer.
    if (queue.length && !tookOffer(order)) payouts.push({ ...queue.shift()!, order });
  }
  return { total, payouts, waiting: queue };
}

/** The stamp after `total`: which one it is on the card, and the round. */
export const stampPosition = (index: number) => ({ round: Math.floor(index / STAMPS) + 1, stamp: (index % STAMPS) + 1 });

/** The next reward from where somebody stands (stamps already on this round). */
export function nextReward(card: LoyaltyCard, stamps: number): { stamp: number; reward: LoyaltyReward } | null {
  for (let index = stamps; index < STAMPS; index += 1) {
    const reward = card.rewards[index];
    if (reward) return { stamp: index + 1, reward };
  }
  const first = card.rewards.findIndex(Boolean);
  return first >= 0 ? { stamp: first + 1, reward: card.rewards[first]! } : null;
}
