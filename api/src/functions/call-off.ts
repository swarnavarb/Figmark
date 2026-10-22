import { randomUUID } from 'node:crypto';
import type { Order } from '../../../shared/models.js';
import { orderMoney, rupees } from '../../../shared/payments.js';

/**
 * Calling off an order on the seller's side, as state: what it becomes, and
 * what is owed back.
 *
 * One function for a seller cancelling one order and a pre-order closing on
 * forty, because the two must leave identical state behind - nothing paid is
 * simply cancelled; anything paid becomes a reversal the seller owes, on their
 * Refunds list like every other refund. Saves nothing and tells nobody: the
 * callers do both, in their own words.
 *
 * Returns what is owed back, zero when nothing was paid.
 */
export function callOffOrder(order: Order, reason: string, actorId: string, by = 'seller'): number {
  const money = orderMoney(order);
  const now = new Date().toISOString();
  order.cancelReason = reason;
  order.updatedAt = now;

  if (money.paidMinor <= 0) {
    order.status = 'cancelled';
    note(order, `Order cancelled by ${by}: ${reason}`, actorId);
    return 0;
  }

  order.status = 'payment_reversal_pending';
  order.reversal = {
    reasonForCancel: reason,
    initiatedAt: now,
    amountMinor: money.paidMinor,
    buyerConfirmedDetailsAt: null,
    reference: null,
    screenshot: null,
    reversedAt: null,
    reversedBy: null,
    buyerResponse: null,
    buyerRespondedAt: null,
    disputeRaisedAt: null,
  };
  // What was paid is now owed back, and it goes where every refund goes: onto
  // the seller's Refunds list, to return in one go or in parts, or to put
  // towards another of this buyer's orders.
  order.credits = [...(order.credits ?? []), {
    id: `crd_${randomUUID().slice(0, 12)}`, createdAt: now, amountMinor: money.paidMinor, batchId: null,
    refundedMinor: 0, refundedAt: null, refundedBy: null, status: 'open', origin: 'cancelled', reason,
  }];
  note(order, `Order cancelled by ${by}, payment reversal pending: ${reason}`, actorId);
  note(order, `Payment reversal initiated — ${rupees(money.paidMinor)}`, actorId);
  return money.paidMinor;
}

function note(order: Order, text: string, by: string): void {
  order.stageHistory = [
    ...order.stageHistory,
    { stage: order.stage, enteredAt: new Date().toISOString(), note: text, recordedBy: by },
  ];
}
