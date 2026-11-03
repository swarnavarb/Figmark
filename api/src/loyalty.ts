import { proLocked } from '../../shared/billing.js';
import {
  REWARD_META, STAMPS, nextReward, offersToDrop, replayCard, rewardOffMinor, rewardPerk, rewardWords,
  type CardProgress, type IssuedReward, type LoyaltyApplied, type LoyaltyCard, type LoyaltyReward,
} from '../../shared/loyalty.js';
import type { Order, User } from '../../shared/models.js';
import { appliedPerks, offerPerk, type Perk } from '../../shared/offers.js';
import { isStopped } from '../../shared/orders.js';
import { rupees } from '../../shared/payments.js';
import type { StoreCredit } from '../../shared/play.js';
import type { getRepository } from './data/index.js';
import { loadPricing } from './billing.js';
import { notify } from './functions/notify.js';

/**
 * Loyalty cards, kept per shop:
 *
 * - `loyalty-cards-<shop>` - the shop's cards.
 * - `loyalty-issued-<shop>` - every reward a stamp has earned anybody there.
 *
 * Stamps are never written: they are the buyer's delivered orders that a card
 * covers, replayed whenever somebody looks (and the moment an order arrives)
 * by `replayCard`, which also keeps rewards and offers from colliding.
 * Rewards are written once each, by id, so counting again never pays twice.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

const CARDS = 'loyalty-cards-';
const ISSUED = 'loyalty-issued-';

export const shopNameOf = (owner: User | null | undefined) => owner?.sellerProfile?.storefrontName || owner?.displayName || 'the shop';

export async function loadCards(repository: Repo, ownerId: string): Promise<LoyaltyCard[]> {
  const saved = await repository.getSiteContent(`${CARDS}${ownerId}`);
  const cards = (saved?.data as { cards?: LoyaltyCard[] } | undefined)?.cards;
  return Array.isArray(cards) ? cards : [];
}

export async function saveCards(repository: Repo, ownerId: string, change: (cards: LoyaltyCard[]) => LoyaltyCard[]): Promise<LoyaltyCard[]> {
  let next: LoyaltyCard[] = [];
  await repository.mutateSiteContent(`${CARDS}${ownerId}`, (current) => {
    const at = new Date().toISOString();
    next = change(((current?.data as { cards?: LoyaltyCard[] } | undefined)?.cards) ?? []);
    return { id: `${CARDS}${ownerId}`, data: { cards: next }, updatedBy: ownerId, createdAt: current?.createdAt ?? at, updatedAt: at };
  });
  return next;
}

export async function loadIssued(repository: Repo, ownerId: string): Promise<IssuedReward[]> {
  const saved = await repository.getSiteContent(`${ISSUED}${ownerId}`);
  const rewards = (saved?.data as { rewards?: IssuedReward[] } | undefined)?.rewards;
  return Array.isArray(rewards) ? rewards : [];
}

export async function changeIssued(
  repository: Repo, ownerId: string, change: (rewards: IssuedReward[]) => IssuedReward[],
): Promise<IssuedReward[]> {
  let next: IssuedReward[] = [];
  await repository.mutateSiteContent(`${ISSUED}${ownerId}`, (current) => {
    const at = new Date().toISOString();
    next = change(((current?.data as { rewards?: IssuedReward[] } | undefined)?.rewards) ?? []);
    return { id: `${ISSUED}${ownerId}`, data: { rewards: next }, updatedBy: 'system', createdAt: current?.createdAt ?? at, updatedAt: at };
  });
  return next;
}

/** Whether this shop's cards stamp right now: loyalty switched on, and the shop has Pro (when loyalty is a Pro tool). */
export async function cardsLive(repository: Repo, owner: User | null): Promise<boolean> {
  const pricing = await loadPricing(repository);
  return pricing.loyalty.enabled && !proLocked('loyalty', pricing.pro, owner?.pro ?? null);
}

const orderValue = (order: Pick<Order, 'quantity' | 'unitPriceMinor'>) => order.quantity * order.unitPriceMinor;

/**
 * Rewards already taken off a placed order's price at checkout, by id, with
 * the order that took each. A cancelled order gives its reward back.
 */
function claimsOf(orders: readonly Order[], except?: string): Map<string, { order: Order; applied: LoyaltyApplied }> {
  const out = new Map<string, { order: Order; applied: LoyaltyApplied }>();
  for (const order of orders) {
    if (order.id === except || order.placedAt === null || isStopped(order.status)) continue;
    for (const applied of order.loyaltyApplied ?? []) out.set(applied.rewardId, { order, applied });
  }
  return out;
}

/**
 * Brings one buyer's cards at one shop up to date: pays any cashback a stamp
 * has reached, holds any other reward for them, and says where they stand.
 * `orders` may be passed when the caller already has the buyer's orders.
 */
export async function syncLoyalty(
  repository: Repo, buyerId: string, ownerId: string, given?: { orders?: Order[]; cards?: LoyaltyCard[] },
): Promise<CardProgress[]> {
  const cards = given?.cards ?? await loadCards(repository, ownerId);
  if (cards.length === 0) return [];
  const [owner, buyer, orders, issued] = await Promise.all([
    repository.getUserById(ownerId),
    repository.getUserById(buyerId),
    given?.orders ? Promise.resolve(given.orders) : repository.listOrdersForBuyer(buyerId),
    loadIssued(repository, ownerId),
  ]);
  if (!buyer) return [];
  const live = await cardsLive(repository, owner ?? null);
  const shopName = shopNameOf(owner);
  const theirs = orders.filter((order) => order.sellerId === ownerId);
  const fresh: IssuedReward[] = [];
  const progress: CardProgress[] = [];
  const claims = claimsOf(theirs);

  for (const card of cards) {
    const { total, payouts, waiting } = replayCard(card, theirs, new Set(claims.keys()));
    // Money off taken at checkout is written down once its order arrives.
    for (const [id, { order, applied }] of claims) {
      if (applied.cardId !== card.id || order.status !== 'delivered' || issued.some((entry) => entry.id === id)) continue;
      const [, round] = id.split(':');
      fresh.push({
        id, cardId: card.id, cardName: card.name, ownerId, shopName, buyerId, buyerName: buyer.displayName,
        round: Number(round) || 1, stamp: applied.stamp, reward: card.rewards[applied.stamp - 1] ?? { kind: 'percent_off' },
        orderId: order.id, itemName: order.itemName, at: new Date().toISOString(),
        valueMinor: applied.valueMinor, status: 'used', usedAt: order.placedAt ?? null,
      });
    }
    if (live && card.active) {
      for (const { id, round, stamp, reward, order } of payouts) {
        if (issued.some((entry) => entry.id === id)) continue;
        const credit = REWARD_META[reward.kind].credit;
        const valueMinor = reward.kind === 'cashback_flat' ? reward.amountMinor ?? 0
          : reward.kind === 'cashback_percent' ? Math.round((orderValue(order) * (reward.bp ?? 0)) / 10_000) : 0;
        fresh.push({
          id, cardId: card.id, cardName: card.name, ownerId, shopName, buyerId, buyerName: buyer.displayName,
          round, stamp, reward, orderId: order.id, itemName: order.itemName, at: new Date().toISOString(),
          valueMinor, status: credit ? 'credited' : 'ready', usedAt: null,
        });
      }
    }
    const stamps = total % STAMPS;
    progress.push({
      card, shopName, stamps, round: Math.floor(total / STAMPS) + 1, total,
      next: nextReward(card, stamps),
      waiting: waiting.length,
      rewards: [],
    });
  }

  let all = issued;
  if (fresh.length) {
    // Written by id inside the write, so two looks at once pay once.
    let added: IssuedReward[] = [];
    all = await changeIssued(repository, ownerId, (current) => {
      added = fresh.filter((entry) => !current.some((had) => had.id === entry.id));
      return [...current, ...added];
    });
    const cash = added.filter((entry) => entry.status === 'credited' && entry.valueMinor > 0);
    if (cash.length) {
      const person = (await repository.getUserById(buyerId)) ?? buyer;
      const credits: StoreCredit[] = [...(person.storeCredits ?? [])];
      for (const entry of cash) {
        const creditId = `loyalty:${entry.id}`;
        if (credits.some((credit) => credit.id === creditId)) continue;
        credits.push({
          id: creditId, storeId: ownerId, storeName: shopName, amountMinor: entry.valueMinor, spentMinor: 0,
          reason: `Loyalty cashback · ${entry.cardName}, stamp ${entry.stamp}`, link: '/wallet?tab=loyalty',
          createdAt: entry.at, spends: [], kind: 'shop', given: true,
        });
      }
      await repository.updateUser({ ...person, storeCredits: credits });
    }
    for (const entry of added.filter((row) => row.status !== 'used')) {
      await notify(repository, [buyerId], {
        kind: 'loyalty',
        title: entry.status === 'credited'
          ? `${rupees(entry.valueMinor)} cashback from ${shopName}`
          : `You earned ${rewardWords(entry.reward, rupees)} at ${shopName}`,
        body: `${entry.cardName} · stamp ${entry.stamp} of ${STAMPS}, for ${entry.itemName}.`,
        link: '/wallet?tab=loyalty',
      }).catch(() => null);
    }
  }
  for (const row of progress) row.rewards = all.filter((entry) => entry.cardId === row.card.id && entry.buyerId === buyerId);
  return progress;
}

/** Every card this buyer has a stamp or a reward on, across every shop they bought from. */
export async function walletLoyalty(repository: Repo, buyerId: string): Promise<CardProgress[]> {
  const orders = await repository.listOrdersForBuyer(buyerId);
  const shops = [...new Set(orders.filter((order) => order.status === 'delivered').map((order) => order.sellerId))];
  const rows = await Promise.all(shops.map(async (ownerId) => {
    const cards = await loadCards(repository, ownerId);
    return cards.length ? syncLoyalty(repository, buyerId, ownerId, { orders, cards }) : [];
  }));
  return rows.flat().filter((row) => row.total > 0 || row.rewards.length > 0);
}

/** A reward an order at checkout would bring, and whether it goes with the offers on it. */
export interface CheckoutReward {
  cardId: string;
  cardName: string;
  stamp: number;
  reward: LoyaltyReward;
  /** Paid with this order beside its offers. False: it clashes with them, and the buyer picks. */
  fits: boolean;
  /** The offers on this order it clashes with, in words. */
  clashWith: string[];
  /** What those offers take off this order. */
  clashMinor: number;
  /** The buyer gave up an offer for this one. */
  tookOverOffer: boolean;
  /** Money off this order for a money-off reward: now when it fits, or if picked over the offer. */
  offMinor: number;
}

/**
 * What loyalty rewards an order at checkout would bring, worked out as if the
 * buyer's other orders on their way arrive first and this one after them.
 * Null when the shop runs no live card.
 */
export async function checkoutLoyalty(repository: Repo, order: Order): Promise<(CheckoutReward & { id: string })[] | null> {
  const cards = (await loadCards(repository, order.sellerId)).filter((card) => card.active);
  if (cards.length === 0) return null;
  const owner = await repository.getUserById(order.sellerId);
  if (!(await cardsLive(repository, owner))) return null;
  const mine = (await repository.listOrdersForBuyer(order.buyerId)).filter((other) => other.sellerId === order.sellerId && other.id !== order.id);
  const claimed = new Set(claimsOf(mine).keys());
  const base = Date.now();
  const coming = mine
    .filter((other) => other.status !== 'delivered' && !isStopped(other.status) && other.placedAt !== null)
    .sort((a, b) => (a.placedAt ?? '').localeCompare(b.placedAt ?? ''))
    .map((other, index) => ({ ...other, status: 'delivered' as const, completedAt: new Date(base + index + 1).toISOString() }));
  const self = { ...order, status: 'delivered' as const, completedAt: new Date(base + coming.length + 1).toISOString() };
  const history = [...mine.filter((other) => other.status === 'delivered'), ...coming, self];
  const perks = appliedPerks(order.appliedOffers);
  const rows: (CheckoutReward & { id: string })[] = [];
  for (const card of cards) {
    const here = replayCard(card, history, claimed).at.get(order.id);
    if (!here) continue;
    const value = Math.max(0, orderValue(order) - (order.offerDiscountMinor ?? 0));
    const row = (entry: { id: string; stamp: number; reward: LoyaltyReward }, fits: boolean): CheckoutReward & { id: string } => {
      const drop = offersToDrop(entry.reward);
      const clashing = fits ? [] : (order.appliedOffers ?? []).filter((offer) => offer.savedMinor > 0
        && (drop === 'all' || drop.includes(offer.perk ?? offerPerk(offer))));
      return {
        id: entry.id, offMinor: rewardOffMinor(entry.reward, fits ? value : orderValue(order)),
        cardId: card.id, cardName: card.name, stamp: entry.stamp, reward: entry.reward, fits,
        clashWith: clashing.map((offer) => offer.label), clashMinor: clashing.reduce((sum, offer) => sum + offer.savedMinor, 0),
        tookOverOffer: fits && Boolean(order.offersDropped)
          && (order.offersDropped === 'all' || drop === 'all' || drop.some((perk) => (order.offersDropped as Perk[]).includes(perk))),
      };
    };
    for (const entry of here.paid) rows.push(row(entry, true));
    for (const entry of here.held) if (perks.length > 0) rows.push(row(entry, false));
  }
  return rows;
}

/** The offers to give up for every clashing reward this order would bring. */
export function dropFor(rows: readonly CheckoutReward[]): Perk[] | 'all' | null {
  const clashing = rows.filter((row) => !row.fits);
  if (clashing.length === 0) return null;
  if (clashing.some((row) => offersToDrop(row.reward) === 'all')) return 'all';
  return [...new Set(clashing.map((row) => rewardPerk(row.reward.kind)).filter((perk): perk is Perk => perk !== null))];
}

/**
 * Takes the money-off rewards this checkout brings off its price, and drops
 * any it brought before that it no longer does. True when the price moved.
 */
export function applyLoyaltyOff(order: Order, rows: readonly (CheckoutReward & { id: string })[] | null): boolean {
  if (order.placedAt !== null) return false;
  const applied: LoyaltyApplied[] = (rows ?? []).filter((row) => row.fits && row.offMinor > 0).map((row) => ({
    rewardId: row.id, cardId: row.cardId, cardName: row.cardName, stamp: row.stamp,
    label: `${rewardWords(row.reward, rupees)} · ${row.cardName}`, valueMinor: row.offMinor,
  }));
  const off = Math.min(orderValue(order), applied.reduce((sum, row) => sum + row.valueMinor, 0));
  const moved = off !== (order.loyaltyOffMinor ?? 0);
  if (applied.length) { order.loyaltyApplied = applied; order.loyaltyOffMinor = off; } else { delete order.loyaltyApplied; delete order.loyaltyOffMinor; }
  return moved;
}

/** Works out a checkout's loyalty money off again, as it stands now. */
export async function refreshLoyaltyOff(repository: Repo, order: Order): Promise<boolean> {
  return applyLoyaltyOff(order, await checkoutLoyalty(repository, order).catch(() => null));
}
