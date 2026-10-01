import type { ReactNode } from 'react';
import type { Order, OrderShipment } from '@shared/models';
import type { OrderAction } from '@shared/orders';
import { orderMoney } from '@shared/payments';
import { trackingSearchUrl } from '@shared/tracking-links';
import { formatMoney } from '../format';

/**
 * One line that says where an order stands, for the person reading it.
 *
 * The same words on the card in My Purchases (or the seller's Orders) and at
 * the top of the order itself, so tapping an item never tells somebody
 * something different from the list they tapped it in. Short on purpose: a
 * headline and, at most, one sentence under it.
 */
export type StatusTone = 'urgent' | 'wait' | 'sent' | 'ok' | 'info' | 'danger' | 'quiet';

export interface StatusLine {
  tone: StatusTone;
  icon: string;
  title: string;
  note?: string;
}

/** What the status line is worked out from - the same few facts on both screens. */
export interface StatusFacts {
  placed: boolean;
  status: string;
  paymentStatus: string;
  bookingOnly: boolean;
  accepted: boolean;
  /** The buyer may pay for it now. */
  canPay: boolean;
  /** The seller said a claimed payment never arrived. */
  claimDenied: boolean;
  outstandingMinor: number;
  currency: string;
  dispatched: boolean;
  shipment: OrderShipment | null;
  receivedAt: string | null;
  inHand: boolean;
  /** Held money that either side has disputed. */
  disputed?: boolean;
}

/** The facts, read off a whole order and what this viewer may do to it. */
export function factsFromOrder(order: Order, actions: readonly OrderAction[]): StatusFacts {
  return {
    placed: order.placedAt !== null,
    status: order.status,
    paymentStatus: order.paymentStatus,
    bookingOnly: order.bookingOnly ?? false,
    accepted: order.accepted ?? false,
    canPay: actions.includes('pay'),
    claimDenied: order.paymentClaim?.decision === 'denied' && order.paymentStatus !== 'paid',
    outstandingMinor: orderMoney(order).outstandingMinor,
    currency: order.currency,
    dispatched: Boolean(order.checkpoints?.dispatched) || order.status === 'shipped',
    shipment: order.shipment ?? null,
    receivedAt: order.receivedAt ?? null,
    inHand: order.lotId === 'direct',
    disputed: order.escrow.state === 'disputed',
  };
}

function courierLine(shipment: OrderShipment | null): string | undefined {
  if (!shipment) return undefined;
  return [shipment.courier, shipment.awb && `AWB ${shipment.awb}`].filter(Boolean).join(' · ') || undefined;
}

/** The way it ended, when it did not end with the buyer holding it. */
function stopped(f: StatusFacts, side: 'buyer' | 'seller'): StatusLine | null {
  switch (f.status) {
    case 'rejected':
      return side === 'buyer'
        ? { tone: 'danger', icon: '❌', title: 'The seller declined this order', note: 'Nothing was charged.' }
        : { tone: 'danger', icon: '❌', title: 'You declined this order' };
    case 'cancelled':
      return { tone: 'quiet', icon: '🚫', title: 'Order cancelled' };
    case 'payment_reversal_pending':
      return side === 'buyer'
        ? { tone: 'info', icon: '↩️', title: 'Cancelled — your money is on its way back' }
        : { tone: 'urgent', icon: '↩️', title: 'Cancelled — send the buyer their money back' };
    case 'cancelled_reversed':
      return { tone: 'ok', icon: '↩️', title: 'Cancelled and refunded' };
    case 'refunded':
      return { tone: 'quiet', icon: '↩️', title: 'Refunded' };
    case 'dispute_raised':
      return { tone: 'danger', icon: '⚖️', title: 'Dispute raised', note: 'Open the order to follow it.' };
    default:
      return f.disputed
        ? { tone: 'danger', icon: '⚖️', title: 'In dispute', note: 'Open the order to follow it.' }
        : null;
  }
}

/** Where a purchase stands, in the buyer's words. */
export function buyerStatus(f: StatusFacts): StatusLine {
  if (!f.placed) {
    return { tone: 'info', icon: '🛒', title: 'In your cart', note: 'Finish checkout to place the order.' };
  }
  const ended = stopped(f, 'buyer');
  if (ended) return ended;

  if (f.status === 'delivered') {
    return f.receivedAt
      ? { tone: 'ok', icon: '📬', title: 'Delivered — enjoy it!' }
      : { tone: 'ok', icon: '📬', title: 'Delivered', note: 'Tap to confirm you received it.' };
  }
  if (f.dispatched) {
    return { tone: 'info', icon: '🚚', title: 'On its way to you', note: courierLine(f.shipment) };
  }
  if (f.paymentStatus === 'claimed') {
    return { tone: 'sent', icon: '📨', title: 'Payment sent', note: 'Waiting for the seller to confirm it arrived.' };
  }
  if (f.claimDenied) {
    return { tone: 'danger', icon: '⚠️', title: 'The seller has not received your payment', note: 'Check it and send it again.' };
  }
  if (f.canPay && f.accepted) {
    return { tone: 'urgent', icon: '🔔', title: 'Seller accepted — pay now!', note: 'Pay to lock it in. The seller is waiting on you.' };
  }
  if (f.bookingOnly && !f.accepted && f.paymentStatus === 'unpaid') {
    return { tone: 'wait', icon: '⏳', title: 'Booked — the seller is deciding', note: 'They will accept or decline it. No payment needed yet.' };
  }
  if (f.canPay) {
    return { tone: 'urgent', icon: '💳', title: 'Payment needed', note: 'Pay to confirm your order.' };
  }
  if (f.paymentStatus === 'partially_paid') {
    return {
      tone: 'sent', icon: '💳', title: `Advance paid · ${formatMoney(f.outstandingMinor, f.currency)} left`,
      note: 'The seller has your advance. Pay the rest any time.',
    };
  }
  if (f.paymentStatus === 'paid') {
    return { tone: 'ok', icon: '✅', title: 'Paid — the seller has your payment', note: 'They are getting it ready to ship.' };
  }
  return { tone: 'wait', icon: '⏳', title: 'Waiting for the seller' };
}

/** Where a sale stands, in the seller's words. */
export function sellerStatus(f: StatusFacts & { claimOpen: boolean }): StatusLine | null {
  if (!f.placed) return null;
  const ended = stopped(f, 'seller');
  if (ended) return ended;

  if (f.status === 'delivered') {
    return f.receivedAt
      ? { tone: 'ok', icon: '📬', title: 'Delivered — the buyer confirmed it' }
      : { tone: 'ok', icon: '📬', title: 'Delivered', note: 'Waiting for the buyer to confirm.' };
  }
  if (f.claimOpen || f.paymentStatus === 'claimed') {
    return { tone: 'urgent', icon: '💸', title: 'Buyer says they paid', note: 'Check your account, then confirm.' };
  }
  const fresh = f.status === 'pending_payment' && f.paymentStatus === 'unpaid' && !f.accepted;
  if (fresh) {
    return f.bookingOnly
      ? { tone: 'urgent', icon: '📘', title: 'New booking — accept or decline' }
      : { tone: 'urgent', icon: '🆕', title: 'New order — accept or decline' };
  }
  if (f.accepted && f.paymentStatus === 'unpaid') {
    return { tone: 'wait', icon: '⏳', title: 'Accepted — waiting for the buyer to pay' };
  }
  if (f.dispatched) {
    return { tone: 'info', icon: '🚚', title: 'Dispatched', note: courierLine(f.shipment) ?? (f.inHand ? 'Add the courier and AWB so the buyer can track it.' : undefined) };
  }
  if (f.paymentStatus === 'partially_paid') {
    return { tone: 'sent', icon: '💳', title: `Advance received · ${formatMoney(f.outstandingMinor, f.currency)} still due` };
  }
  if (f.paymentStatus === 'paid') {
    return {
      tone: 'ok', icon: '✅', title: 'Payment received — ship it!',
      note: f.inHand ? 'Mark it dispatched and add the courier and AWB.' : undefined,
    };
  }
  return null;
}

/** The line, drawn: an icon, a headline, one sentence, and room for a button. */
export function StatusBanner({ line, compact = false, children }: {
  line: StatusLine;
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`sbanner sbanner--${line.tone}${compact ? ' sbanner--compact' : ''}`} role="status">
      <span className="sbanner__icon" aria-hidden="true">{line.icon}</span>
      <span className="sbanner__text">
        <b className="sbanner__title">{line.title}</b>
        {line.note && <span className="sbanner__note">{line.note}</span>}
      </span>
      {children}
    </div>
  );
}

/** A courier and AWB, with the link that looks the AWB up. */
export function ShipmentChip({ shipment, linked = true }: {
  shipment: OrderShipment;
  /** False inside something that is already a link, where a second one cannot go. */
  linked?: boolean;
}) {
  // Nothing given, nothing shown: a blank courier line tells a buyer nothing.
  if (!shipment.courier && !shipment.awb) return null;
  return (
    <span className="shipchip">
      {shipment.courier && <span className="shipchip__label">🚚 {shipment.courier}</span>}
      {shipment.awb && (
        <>
          <span className="shipchip__awb mono">AWB {shipment.awb}</span>
          {linked && <a className="shipchip__track" href={trackingSearchUrl(shipment.courier || 'courier', shipment.awb)}
            target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            Track ↗
          </a>}
        </>
      )}
    </span>
  );
}
