import { useState, type FormEvent } from 'react';
import type { CreditRecord, Listing, Order } from '@shared/models';
import {
  PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, availabilityLabel, creditIsLive, creditLeft, expiresSoon, isExpired,
  isMultiple, methodOf, orderMoney, timeLeft,
} from '@shared/payments';
import { ApiRequestError, api } from '../api';
import { formatDate, formatMoney } from '../format';
import { Modal } from './LotFields';
import { ErrorNotice } from './ui';

/**
 * The small, loud pieces the Buy, Sell and Purchases screens share: stock and
 * expiry chips, the money bar, the payment history and the item terms form.
 * One place so a "3 left" means the same thing on every screen.
 */

type Terms = Pick<Listing, 'quantityMode' | 'quantityAvailable' | 'expiresAt'>;

/** "10 available" or "Multiple available". */
export function StockChip({ listing }: { listing: Pick<Listing, 'quantityMode' | 'quantityAvailable'> }) {
  return (
    <span className={`stockchip${isMultiple(listing) ? ' stockchip--multi' : ''}`}>
      {isMultiple(listing) ? '∞ ' : '📦 '}{availabilityLabel(listing)}
    </span>
  );
}

/** Time left, hot when it is nearly up, and plainly Expired once it is. */
export function ExpiryChip({ listing, big = false }: { listing: Pick<Listing, 'expiresAt'>; big?: boolean }) {
  if (!listing.expiresAt) return null;
  const expired = isExpired(listing);
  const soon = expiresSoon(listing);
  return (
    <span className={`expchip${expired ? ' expchip--gone' : soon ? ' expchip--soon' : ''}${big ? ' expchip--big' : ''}`}
      title={`Expires ${formatDate(listing.expiresAt)}`}>
      {expired ? '⛔ Expired' : `⏳ ${timeLeft(listing.expiresAt)}`}
    </span>
  );
}

/** Total, paid, balance and credit: the four numbers that must never be ambiguous. */
export function MoneyBar({ totalMinor, paidMinor, outstandingMinor, creditMinor = 0, currency = 'INR' }: {
  totalMinor: number; paidMinor: number; outstandingMinor: number; creditMinor?: number; currency?: string;
}) {
  const percent = totalMinor > 0 ? Math.min(100, Math.round((paidMinor / totalMinor) * 100)) : 0;
  return (
    <div className="moneybar">
      <div className="moneybar__nums">
        <span><small>Total</small><b>{formatMoney(totalMinor, currency)}</b></span>
        <span className="moneybar__paid"><small>Paid</small><b>{formatMoney(paidMinor, currency)}</b></span>
        {outstandingMinor > 0 ? (
          <span className="moneybar__due"><small>Balance</small><b>{formatMoney(outstandingMinor, currency)}</b></span>
        ) : (
          <span className="moneybar__done"><small>Balance</small><b>Paid in full 🎉</b></span>
        )}
        {creditMinor > 0 && (
          <span className="moneybar__credit"><small>Extra / credit</small><b>{formatMoney(creditMinor, currency)}</b></span>
        )}
      </div>
      <div className="moneybar__track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * Every payment on an order as its own dated line, with the totals summed from
 * them. The seller gets the refund button for any extra that is still held.
 */
export function PaymentHistory({ order, side, onChanged }: {
  order: Order; side: 'buyer' | 'seller' | null; onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = orderMoney(order);
  const records = order.payments ?? [];
  const open = (order.credits ?? []).filter(creditIsLive);

  async function refund() {
    if (!window.confirm('Mark the extra payment as returned? The buyer is told and asked to confirm it arrived.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.refundCredit(order.id);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not record the refund.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card--pad stack payhist">
      <div className="row row--between">
        <h3>💸 Payments</h3>
        {records.length > 0 && <span className="badge badge--aqua">{PAYMENT_METHOD_LABELS[methodOf(order)]}</span>}
      </div>
      <MoneyBar {...money} currency={order.currency} />
      {records.length === 0 ? (
        <p className="faint">No payments yet.</p>
      ) : (
        <ul className="payhist__list">
          {records.map((record) => (
            <li key={record.id} className={`payhist__row payhist__row--${record.kind}`}>
              <span className="payhist__icon" aria-hidden="true">
                {record.kind === 'refund' ? '↩️' : record.kind === 'credit' ? '💰' : '💳'}
              </span>
              <span className="payhist__what">
                <b>{PAYMENT_KIND_LABELS[record.kind]}</b>
                <small>{formatDate(record.at)}{record.batchTotalMinor && record.batchTotalMinor !== record.amountMinor
                  ? ` · part of ${formatMoney(record.batchTotalMinor, order.currency)}` : ''}</small>
              </span>
              <b className="payhist__amt">
                {record.kind === 'refund' ? '−' : '+'}{formatMoney(record.amountMinor, order.currency)}
              </b>
            </li>
          ))}
        </ul>
      )}
      {(order.credits ?? []).map((credit) => (
        <div key={credit.id}
          className={`creditline${credit.status === 'refunded' || credit.status === 'applied' ? ' is-done' : ''}`}>
          <span>
            💰 Extra payment / credit: <b>{formatMoney(credit.amountMinor, order.currency)}</b>
          </span>
          <span className="faint">{creditStory(credit, order.currency)}</span>
        </div>
      ))}
      {side === 'seller' && open.length > 0 && (
        <button type="button" className="btn" disabled={busy} onClick={() => void refund()}>
          {busy ? 'Sending…' : `↩️ Return extra payment (${formatMoney(money.creditMinor, order.currency)})`}
        </button>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/** Where one extra payment has got to, in a sentence either side can read. */
function creditStory(credit: CreditRecord, currency: string): string {
  const parts: string[] = [];
  if (credit.refundedMinor > 0 && credit.refundedAt) {
    parts.push(`${formatMoney(credit.refundedMinor, currency)} returned on ${formatDate(credit.refundedAt)}`);
  }
  for (const moved of credit.applications ?? []) {
    parts.push(`${formatMoney(moved.amountMinor, currency)} put towards ${moved.itemName}`);
  }
  if (credit.status === 'refund_pending' && credit.pendingRefund) {
    parts.push(`${formatMoney(credit.pendingRefund.amountMinor, currency)} sent back — waiting for the buyer to confirm`);
  } else if (credit.status === 'held') {
    parts.push(`${formatMoney(creditLeft(credit), currency)} kept as credit for future orders`);
  } else if (credit.status === 'open') {
    parts.push(`${formatMoney(creditLeft(credit), currency)} waiting for the seller to decide`);
  }
  return parts.join(' · ');
}

/** A datetime-local value for an ISO string, in the viewer's own clock. */
function localInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export interface TermsDraft {
  quantityMode: 'fixed' | 'multiple';
  quantity: string;
  expiresAt: string;
  advance: boolean;
  advancePercent: string;
}

export function termsDraft(listing?: Partial<Terms & Pick<Listing, 'advancePercent'>>): TermsDraft {
  return {
    quantityMode: listing?.quantityMode === 'multiple' ? 'multiple' : 'fixed',
    quantity: String(listing?.quantityAvailable ?? 1),
    expiresAt: localInput(listing?.expiresAt),
    advance: Boolean(listing?.advancePercent),
    advancePercent: String(listing?.advancePercent ?? 30),
  };
}

/** The draft as the API takes it. */
export function termsBody(draft: TermsDraft) {
  return {
    quantityMode: draft.quantityMode,
    quantityAvailable: Math.max(draft.quantityMode === 'multiple' ? 1 : 0, Number(draft.quantity) || 0),
    expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
    advancePercent: draft.advance ? Math.min(99, Math.max(1, Number(draft.advancePercent) || 30)) : null,
  };
}

/** Quantity (a number, or Multiple), expiry and advance - on the sell form and the edit dialog. */
export function TermsFields({ value, onChange }: { value: TermsDraft; onChange: (next: TermsDraft) => void }) {
  const set = (patch: Partial<TermsDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="stack">
      <div className="field">
        <span>Quantity</span>
        <div className="seg" role="radiogroup" aria-label="Quantity">
          <button type="button" role="radio" aria-checked={value.quantityMode === 'fixed'}
            className={value.quantityMode === 'fixed' ? 'is-on' : ''} onClick={() => set({ quantityMode: 'fixed' })}>
            🔢 Specific number
          </button>
          <button type="button" role="radio" aria-checked={value.quantityMode === 'multiple'}
            className={value.quantityMode === 'multiple' ? 'is-on' : ''} onClick={() => set({ quantityMode: 'multiple' })}>
            ∞ Multiple
          </button>
        </div>
        {value.quantityMode === 'fixed' ? (
          <input type="number" min="0" step="1" value={value.quantity} aria-label="How many"
            onChange={(e) => set({ quantity: e.target.value })} />
        ) : (
          <span className="field__hint">Not sure how many? It stays available with no fixed count.</span>
        )}
      </div>

      <label className="field">
        <span>⏳ Expires</span>
        <input type="datetime-local" value={value.expiresAt} onChange={(e) => set({ expiresAt: e.target.value })} />
        <span className="field__hint">Leave empty to keep it up until you take it down.</span>
      </label>

      <label className="row" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={value.advance} onChange={(e) => set({ advance: e.target.checked })}
          style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
        <span>
          <b>Accept advance payment</b>
          <span className="field__hint" style={{ display: 'block' }}>Buyers can pay part now and the rest later.</span>
        </span>
      </label>
      {value.advance && (
        <label className="field">
          <span>Advance (% of the price)</span>
          <input type="number" min="1" max="99" value={value.advancePercent}
            onChange={(e) => set({ advancePercent: e.target.value })} />
        </label>
      )}
    </div>
  );
}

/**
 * Edit an item, or bring an expired one back.
 *
 * "Make available again" is the same edit with the expiry cleared or pushed
 * out, so it is offered here rather than as a second screen.
 */
export function EditListingDialog({ listing, onClose, onSaved }: {
  listing: Listing; onClose: () => void; onSaved: (listing: Listing | null) => void;
}) {
  const [title, setTitle] = useState(listing.title);
  const [price, setPrice] = useState(String(listing.priceMinor / 100));
  const [terms, setTerms] = useState(() => termsDraft({
    ...listing, expiresAt: isExpired(listing) ? null : listing.expiresAt,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = isExpired(listing);

  async function run(fn: () => Promise<Listing | null>) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await fn());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => (await api.editListing(listing.id, {
      title: title.trim(), priceMinor: Math.round(Number(price) * 100), ...termsBody(terms),
    })).listing);
  }

  return (
    <Modal title={expired ? 'Expired item' : 'Edit item'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {expired && (
          <p className="notice notice--warn">
            This expired, so buyers cannot purchase it. Clear the expiry or set a new one to put it back on sale.
          </p>
        )}
        <label className="field">
          <span>Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field">
          <span>Price (₹)</span>
          <input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </label>
        <TermsFields value={terms} onChange={setTerms} />
        {error && <ErrorNotice message={error} />}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn--lg" disabled={busy}>
            {expired ? '✨ Make available again' : 'Save'}
          </button>
          <button type="button" className="btn btn--danger" disabled={busy || expired}
            onClick={() => {
              if (window.confirm('Expire this item? It comes off sale immediately - you can put it back on with a new expiry any time.')) {
                void run(async () => { await api.expireListing(listing.id); return null; });
              }
            }}>
            Expire
          </button>
        </div>
      </form>
    </Modal>
  );
}
