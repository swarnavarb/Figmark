import { randomUUID } from 'node:crypto';
import type { CreditRecord, Message, MessageLink, MessageParty, Order, User } from '../../shared/models.js';
import { threadIdFor } from '../../shared/handles.js';
import { rupees } from '../../shared/payments.js';
import type { getRepository } from './data/index.js';

/**
 * Money owed back because an offer lowered the price after it was paid.
 *
 * It is not the shop's to decide how it goes back, nor the buyer's alone: the
 * shop may offer store credit instead - never less than what is owed, and
 * raised as many times as it likes - and the buyer chooses between that and a
 * refund. Until they do, the amount sits on the order as a `choosing` refund,
 * on both Refunds screens and in their chat. Once chosen it is an ordinary
 * refund (sent, then confirmed) or credit already in the buyer's wallet.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

export { CREDIT_OFFER_MAX_TIMES } from '../../shared/payments.js';

export const isOfferChoice = (credit: Pick<CreditRecord, 'origin' | 'status'>) =>
  credit.origin === 'offer' && credit.status === 'choosing';

/** What has already gone back for offers on this order, or is on its way: chosen, so no longer the buyer's to claim. */
export function offerSettledMinor(order: Pick<Order, 'credits'>): number {
  return (order.credits ?? [])
    .filter((credit) => credit.origin === 'offer' && credit.status !== 'choosing')
    .reduce((sum, credit) => sum + credit.amountMinor, 0);
}

/**
 * Keeps the one open choice on an order in step with what is owed back
 * (`order.offerRefundDueMinor`). Says whether it opened, changed or closed.
 */
export function syncOfferChoice(order: Order, at: string): 'opened' | 'changed' | 'closed' | null {
  const due = order.offerRefundDueMinor ?? 0;
  const credits = order.credits ?? [];
  const open = credits.find(isOfferChoice);
  if (due <= 0) {
    if (!open) return null;
    order.credits = credits.filter((credit) => credit !== open);
    return 'closed';
  }
  if (open) {
    if (open.amountMinor === due) return null;
    open.amountMinor = due;
    open.storeCreditOfferMinor = Math.max(open.storeCreditOfferMinor ?? 0, due);
    return 'changed';
  }
  order.credits = [...credits, {
    id: `crd_${randomUUID().slice(0, 12)}`, createdAt: at, amountMinor: due, batchId: null,
    refundedMinor: 0, refundedAt: null, refundedBy: null, status: 'choosing', origin: 'offer',
    reason: 'An offer lowered the price after it was paid',
    storeCreditOfferMinor: due, creditOffers: [{ amountMinor: due, at }], chosen: null, chosenAt: null,
  }];
  return 'opened';
}

/** A line in the two sides' own chat, said by the seller's shop or by the buyer, with a button into the app. */
export async function orderMessage(
  repository: Repo, order: Order, from: 'seller' | 'buyer', body: string, link?: MessageLink,
): Promise<void> {
  const [seller, buyer] = await Promise.all([repository.getUserById(order.sellerId), repository.getUserById(order.buyerId)]);
  if (!seller || !buyer) return;
  const party = (user: User): MessageParty => (user.id === order.sellerId && user.sellerProfile?.username
    ? { handle: user.sellerProfile.username, userId: user.id, isStore: true, displayName: user.sellerProfile.storefrontName }
    : { handle: user.username ?? user.id, userId: user.id, isStore: false, displayName: user.displayName });
  const [a, b] = from === 'seller' ? [party(seller), party(buyer)] : [party(buyer), party(seller)];
  const now = new Date().toISOString();
  const message: Message = {
    id: `msg_${randomUUID().slice(0, 12)}`, threadId: threadIdFor(a.handle, b.handle), from: a, to: b, body,
    readAt: null, createdAt: now, updatedAt: now, ...(link ? { link } : {}),
  };
  await repository.sendMessage(message);
}

/** The shop's words to the buyer when an amount to choose about opens or moves. */
export function choiceMessage(order: Order, credit: CreditRecord): string {
  const offer = credit.storeCreditOfferMinor ?? credit.amountMinor;
  return `An offer lowered the price of "${order.itemName}" after you paid, so ${rupees(credit.amountMinor)} is yours back. `
    + `Choose how you'd like it: a refund of ${rupees(credit.amountMinor)}, or ${rupees(offer)} store credit with us.`;
}

export const choiceLink = (order: Pick<Order, 'id'>): MessageLink =>
  ({ href: `/order/${encodeURIComponent(order.id)}`, label: 'Choose refund or store credit' });
