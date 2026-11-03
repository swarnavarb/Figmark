import { proLocked } from '../../shared/billing.js';
import {
  REWARD_META, STAMPS, nextReward, rewardWords, stampPosition, stampsCard,
  type CardProgress, type IssuedReward, type LoyaltyCard,
} from '../../shared/loyalty.js';
import type { Order, User } from '../../shared/models.js';
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
 * covers, counted whenever somebody looks (and the moment an order arrives).
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

  for (const card of cards) {
    const stamped = theirs.filter((order) => stampsCard(card, order))
      .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
    if (live && card.active) {
      stamped.forEach((order, index) => {
        const { round, stamp } = stampPosition(index);
        const reward = card.rewards[stamp - 1];
        if (!reward) return;
        const id = `${card.id}:${round}:${stamp}`;
        if (issued.some((entry) => entry.id === id)) return;
        const credit = REWARD_META[reward.kind].credit;
        const valueMinor = reward.kind === 'cashback_flat' ? reward.amountMinor ?? 0
          : reward.kind === 'cashback_percent' ? Math.round((orderValue(order) * (reward.bp ?? 0)) / 10_000) : 0;
        fresh.push({
          id, cardId: card.id, cardName: card.name, ownerId, shopName, buyerId, buyerName: buyer.displayName,
          round, stamp, reward, orderId: order.id, itemName: order.itemName, at: new Date().toISOString(),
          valueMinor, status: credit ? 'credited' : 'ready', usedAt: null,
        });
      });
    }
    const total = stamped.length;
    const stamps = total % STAMPS;
    progress.push({
      card, shopName, stamps, round: Math.floor(total / STAMPS) + 1, total,
      next: nextReward(card, stamps),
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
    for (const entry of added) {
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
