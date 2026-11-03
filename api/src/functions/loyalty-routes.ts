import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { cleanCard, STAMPS, stampsCard, stampsFrom, type LoyaltyCard } from '../../../shared/loyalty.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { loadPricing, proRefusal } from '../billing.js';
import { cardsLive, changeIssued, loadCards, loadIssued, saveCards, shopNameOf, syncLoyalty, walletLoyalty } from '../loyalty.js';
import { tooFast } from '../rate-limit.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';

/**
 * Loyalty cards:
 *
 * - `GET /api/loyalty/shop/{id}?listing=` - a shop's live cards (those
 *   covering one item, given `listing`), and where the viewer stands on each.
 * - `GET /api/me/loyalty` - the buyer's cards and rewards, every shop.
 * - `GET|POST /api/me/loyalty/cards…` - the shop's own cards (Pro).
 * - `GET /api/me/loyalty/rewards`, `POST …/{id}/use` - rewards the shop owes.
 */

const anon = { authLevel: 'anonymous' } as const;

async function readBody<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function shopCards(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const viewer = await auth.getCurrentUser(request).catch(() => null);
  const repository = await getRepository();
  const ownerId = request.params.id ?? '';
  const listingId = request.query.get('listing');
  const [cards, owner] = await Promise.all([loadCards(repository, ownerId), repository.getUserById(ownerId)]);
  if (!owner || !(await cardsLive(repository, owner))) return json(200, { cards: [], live: false });
  const shown = cards.filter((card) => card.active && (!listingId || card.listingIds === null || card.listingIds.includes(listingId)));
  if (!shown.length) return json(200, { cards: [], live: true });
  const progress = viewer && viewer.id !== ownerId ? await syncLoyalty(repository, viewer.id, ownerId, { cards: shown }) : null;
  return json(200, {
    live: true,
    shopName: shopNameOf(owner),
    cards: shown.map((card) => {
      const mine = progress?.find((row) => row.card.id === card.id) ?? null;
      return {
        card: { ...card, listingIds: card.listingIds ? card.listingIds.length : null },
        stamps: mine?.stamps ?? 0,
        total: mine?.total ?? 0,
        next: mine?.next ?? null,
        ready: mine?.rewards.filter((entry) => entry.status === 'ready').length ?? 0,
        waiting: mine?.waiting ?? 0,
        signedIn: Boolean(viewer),
      };
    }),
  });
}

async function myLoyalty(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  return json(200, { cards: await walletLoyalty(repository, user.id) });
}

async function myCards(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const [cards, pricing, orders, locked] = await Promise.all([
    loadCards(repository, user.id), loadPricing(repository), repository.listOrdersForSeller(user.id), proRefusal(repository, user.id, 'loyalty'),
  ]);
  // How many people hold each card, and how many stamps it has given.
  const stats = Object.fromEntries(cards.map((card) => {
    const stamped = orders.filter((order) => stampsCard(card, order));
    return [card.id, {
      holders: new Set(stamped.map((order) => order.buyerId)).size,
      stamps: stamped.reduce((sum, order) => sum + stampsFrom(card, order), 0),
    }];
  }));
  return json(200, { cards, stats, settings: pricing.loyalty, locked: Boolean(locked), stampsPerCard: STAMPS });
}

async function saveCard(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const slow = await tooFast(user.id, 'billing');
  if (slow) return slow;
  const refusal = await proRefusal(repository, user.id, 'loyalty');
  if (refusal) return error(refusal.status, refusal.jsonBody.error, refusal.jsonBody.message);
  const pricing = await loadPricing(repository);
  if (!pricing.loyalty.enabled) return error(409, 'loyalty_off', 'Loyalty cards are switched off on Figmark right now.');
  const input = await readBody<Record<string, unknown>>(request);
  const cleaned = cleanCard(input, pricing.loyalty);
  if ('error' in cleaned) return error(400, 'invalid_card', cleaned.error);
  if (cleaned.card.listingIds) {
    const listings = await repository.listListings({ sellerId: user.id, includeHidden: true, limit: 10_000 });
    const own = new Set(listings.map((listing) => listing.id));
    if (cleaned.card.listingIds.some((id) => !own.has(id))) return error(400, 'invalid_card', 'Pick items from your own shop.');
  }
  const id = typeof input?.id === 'string' ? input.id : null;
  const now = new Date().toISOString();
  let refused: string | null = null;
  let saved: LoyaltyCard | null = null;
  await saveCards(repository, user.id, (cards) => {
    const existing = id ? cards.find((card) => card.id === id) : null;
    if (id && !existing) { refused = 'No such card.'; return cards; }
    const activeOthers = cards.filter((card) => card.active && card.id !== id).length;
    if (cleaned.card.active && activeOthers >= pricing.loyalty.maxCards) {
      refused = `You can run ${pricing.loyalty.maxCards} cards at once. Pause one first.`;
      return cards;
    }
    saved = existing
      ? { ...existing, ...cleaned.card, updatedAt: now }
      : { id: `lc_${randomUUID().slice(0, 10)}`, ownerId: user.id, ...cleaned.card, createdAt: now, updatedAt: now };
    return existing ? cards.map((card) => (card.id === id ? saved! : card)) : [...cards, saved];
  });
  if (refused) return error(409, 'card_refused', refused);
  return json(200, { card: saved });
}

async function deleteCard(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const id = request.params.id ?? '';
  let found = false;
  await saveCards(repository, user.id, (cards) => {
    found = cards.some((card) => card.id === id);
    return cards.filter((card) => card.id !== id);
  });
  if (!found) return error(404, 'not_found', 'No such card.');
  return json(200, { deleted: id });
}

async function shopRewards(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const rewards = await loadIssued(repository, user.id);
  return json(200, {
    rewards: [...rewards].sort((a, b) => (a.status === 'ready' ? 0 : 1) - (b.status === 'ready' ? 0 : 1) || b.at.localeCompare(a.at)).slice(0, 300),
  });
}

async function useReward(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const id = decodeURIComponent(request.params.id ?? '');
  let hit: { buyerId: string; words: string } | null = null;
  const at = new Date().toISOString();
  await changeIssued(repository, user.id, (rewards) => rewards.map((entry) => {
    if (entry.id !== id || entry.status !== 'ready') return entry;
    hit = { buyerId: entry.buyerId, words: entry.cardName };
    return { ...entry, status: 'used', usedAt: at };
  }));
  if (!hit) return error(404, 'not_found', 'No reward waiting like that.');
  const { buyerId, words } = hit as { buyerId: string; words: string };
  const owner = await repository.getUserById(user.id);
  await notify(repository, [buyerId], {
    kind: 'loyalty', title: `${shopNameOf(owner)} gave you your reward`, body: `${words} - enjoy it.`, link: '/wallet?tab=loyalty',
  }).catch(() => null);
  return json(200, { used: id });
}

export const shopLoyaltyRoute = handler(shopCards);
export const myLoyaltyRoute = handler(myLoyalty);
export const myCardsRoute = handler(myCards);
export const saveCardRoute = handler(saveCard);
export const deleteCardRoute = handler(deleteCard);
export const shopRewardsRoute = handler(shopRewards);
export const useRewardRoute = handler(useReward);

app.http('loyalty-shop', { ...anon, methods: ['GET'], route: 'loyalty/shop/{id}', handler: shopLoyaltyRoute });
app.http('my-loyalty', { ...anon, methods: ['GET'], route: 'me/loyalty', handler: myLoyaltyRoute });
app.http('my-loyalty-cards', { ...anon, methods: ['GET'], route: 'me/loyalty/cards', handler: myCardsRoute });
app.http('my-loyalty-card-save', { ...anon, methods: ['POST'], route: 'me/loyalty/cards/save', handler: saveCardRoute });
app.http('my-loyalty-card-delete', { ...anon, methods: ['POST'], route: 'me/loyalty/cards/{id}/delete', handler: deleteCardRoute });
app.http('my-loyalty-rewards', { ...anon, methods: ['GET'], route: 'me/loyalty/rewards', handler: shopRewardsRoute });
app.http('my-loyalty-reward-use', { ...anon, methods: ['POST'], route: 'me/loyalty/rewards/{id}/use', handler: useRewardRoute });
