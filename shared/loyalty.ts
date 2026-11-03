/**
 * Loyalty cards: a Pro shop's stamp cards.
 *
 * Every item bought stamps the card once, when its order is delivered. A
 * card holds eight stamps; the shop puts a reward on any of them the
 * operators allow - cashback, a free item, free shipping, money off. A full
 * card starts again.
 *
 * Cashback is credited to the buyer's wallet as store credit at that shop.
 * Money off ("15% off") is an immediate discount: it comes off the price, at
 * checkout, of the order that reaches the stamp. A free item, free shipping or
 * the shop's own reward is held in the buyer's wallet until the shop gives it.
 *
 * Rewards and offers go together, unless they give the same kind of thing
 * (`Perk`): cashback and a money-off offer, a free item and buy-2-get-1, free
 * shipping and free shipping. The shop can also mark a reward as never used
 * with an offer. When one clashes, the buyer picks at checkout: keep the
 * offer (the reward waits for a later order) or take the reward (the clashing
 * offer comes off that order). Store credit and refunds are never part of it.
 *
 * What may be offered, on which stamps, and how much, is the operators' to say
 * (`LoyaltySettings`, in the pricing document).
 */

import { appliedPerks, type OfferKind, type Perk } from './offers.js';

export const STAMPS = 8;

export const REWARD_KINDS = ['cashback_flat', 'cashback_percent', 'free_item', 'free_shipping', 'percent_off', 'custom'] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

export const REWARD_META: Record<RewardKind, { icon: string; label: string; hint: string; credit: boolean }> = {
  cashback_flat: { icon: '💸', label: 'Cashback (₹)', hint: 'A fixed amount, credited to the buyer\'s wallet when the order arrives.', credit: true },
  cashback_percent: { icon: '🔁', label: 'Cashback (%)', hint: 'A share of the order, credited to the buyer\'s wallet when it arrives.', credit: true },
  free_item: { icon: '🎁', label: 'Free item', hint: 'Something free with a later order - the shop hands it over.', credit: false },
  free_shipping: { icon: '🚚', label: 'Free shipping', hint: 'Shipping on the next order is on the shop.', credit: false },
  percent_off: { icon: '🏷️', label: '% off', hint: 'Taken off the price at checkout, on the order that reaches this stamp.', credit: false },
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
  /** The most a percentage pays on one order ("10% off, up to ₹120"); missing for no cap. */
  capMinor?: number;
  /** A free item, or the shop's own words. */
  text?: string;
  /**
   * False: never used on an order that took any offer. Missing or true: used
   * alongside offers of a different kind (see `rewardPerk`).
   */
  withOffers?: boolean;
}

/** What a reward gives, to match against offers; null for one that clashes with nothing. */
export function rewardPerk(kind: RewardKind): Perk | null {
  if (kind === 'free_item') return 'freebie';
  if (kind === 'free_shipping') return 'shipping';
  if (kind === 'custom') return null;
  return 'money';
}

/** Whether a reward can be paid on an order that gave these kinds of offer. */
export function rewardFits(reward: LoyaltyReward, offerPerks: readonly Perk[]): boolean {
  if (offerPerks.length === 0) return true;
  if (reward.withOffers === false) return false;
  const perk = rewardPerk(reward.kind);
  return perk === null || !offerPerks.includes(perk);
}

/** Which offers a buyer gives up to take this reward instead: one kind, or every offer. */
export function offersToDrop(reward: LoyaltyReward): Perk[] | 'all' {
  if (reward.withOffers === false) return 'all';
  const perk = rewardPerk(reward.kind);
  return perk ? [perk] : [];
}

/** The most stamps one order can give: a full card. */
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
  /** Rewards reached but not paid yet: they clashed with an offer, and come with a later order. */
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
    case 'cashback_percent': return `${pct(reward.bp)} cashback${reward.capMinor ? ` up to ${money(reward.capMinor)}` : ''}`;
    case 'free_item': return `Free ${reward.text || 'item'}`;
    case 'free_shipping': return 'Free shipping';
    case 'percent_off': return `${pct(reward.bp)} off${reward.capMinor ? ` up to ${money(reward.capMinor)}` : ''}`;
    default: return reward.text || 'A surprise';
  }
}

/** Checks a card a shop saved against the operators' rules. */
export function cleanCard(
  raw: unknown, settings: LoyaltySettings,
): { card: Pick<LoyaltyCard, 'name' | 'theme' | 'listingIds' | 'minOrderMinor' | 'rewards' | 'active'> } | { error: string } {
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
      if (slot.capMinor !== undefined && slot.capMinor !== null && slot.capMinor !== 0) {
        const most = int(slot.capMinor);
        if (most === null || most < 100 || most > 10_00_000) return { error: `${at}: the cap is ₹1 to ₹10,000, or no cap.` };
        reward.capMinor = most;
      }
    } else if (kind === 'free_item' || kind === 'custom') {
      const text = typeof slot.text === 'string' ? slot.text.trim().slice(0, 60) : '';
      if (text.length < 2) return { error: `${at}: say what it is.` };
      reward.text = text;
    }
    if (slot.withOffers === false) reward.withOffers = false;
    rewards.push(reward);
  }
  if (!rewards.some(Boolean)) return { error: 'Put a reward on at least one stamp.' };
  return { card: { name, theme, listingIds, minOrderMinor: min, rewards, active: input.active !== false } };
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
  appliedOffers?: { kind: OfferKind; savedMinor: number; perk?: Perk }[];
};

/** The kinds of offer an order took. */
export const orderPerks = (order: Pick<StampOrder, 'appliedOffers'>): Perk[] => appliedPerks(order.appliedOffers);

/** How many stamps one order puts on a card: one per item. */
export const stampsFrom = (order: { quantity: number }): number =>
  Math.min(MAX_STAMPS_PER_ORDER, Math.max(1, Math.floor(order.quantity)));

/** What a money-off reward takes off an order of this value; 0 for any other reward. */
export const rewardOffMinor = (reward: LoyaltyReward, valueMinor: number): number =>
  reward.kind === 'percent_off' ? percentReward(reward, valueMinor) : 0;

/** A percentage reward on an order of this value, stopped at its cap. */
export function percentReward(reward: LoyaltyReward, valueMinor: number): number {
  const raw = Math.max(0, Math.round((valueMinor * (reward.bp ?? 0)) / 10_000));
  return reward.capMinor ? Math.min(raw, reward.capMinor) : raw;
}

/** A reward taken off an order's price at checkout. */
export interface LoyaltyApplied {
  rewardId: string;
  cardId: string;
  cardName: string;
  stamp: number;
  label: string;
  valueMinor: number;
}

/** A reward a card has paid out, before it is written down. */
export interface Payout<O> {
  id: string;
  round: number;
  stamp: number;
  reward: LoyaltyReward;
  /** The order it is paid on. */
  order: O;
}

type Reached = Omit<Payout<never>, 'order'>;

/**
 * One buyer's history on one card, replayed from their delivered orders in
 * the order they arrived. `claimed` are rewards already taken off a placed
 * order's price at checkout. The same orders always give the same answer, so
 * the ids it hands out are stable and paying twice is impossible.
 *
 * Each order pays every reward waiting that fits beside its offers; one that
 * clashes waits for a later order it fits. `at` says what was waiting, paid
 * and held when each order came in - what checkout shows the buyer.
 */
export function replayCard<O extends StampOrder>(card: LoyaltyCard, orders: readonly O[], claimed: ReadonlySet<string> = new Set()): {
  total: number; payouts: Payout<O>[]; waiting: Reached[]; at: Map<string, { paid: Reached[]; held: Reached[] }>;
} {
  const stamped = orders.filter((order) => stampsCard(card, order))
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? '') || a.id.localeCompare(b.id));
  let total = 0;
  let queue: Reached[] = [];
  const payouts: Payout<O>[] = [];
  const at = new Map<string, { paid: Reached[]; held: Reached[] }>();
  for (const order of stamped) {
    for (let count = stampsFrom(order); count > 0; count -= 1) {
      const { round, stamp } = stampPosition(total);
      total += 1;
      const reward = card.rewards[stamp - 1];
      // Already taken off an order's price at checkout.
      if (reward && !claimed.has(`${card.id}:${round}:${stamp}`)) queue.push({ id: `${card.id}:${round}:${stamp}`, round, stamp, reward });
    }
    const perks = orderPerks(order);
    const paid = queue.filter((entry) => rewardFits(entry.reward, perks));
    queue = queue.filter((entry) => !paid.includes(entry));
    for (const entry of paid) payouts.push({ ...entry, order });
    at.set(order.id, { paid, held: [...queue] });
  }
  return { total, payouts, waiting: queue, at };
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
