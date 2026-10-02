import { useState, type FormEvent } from 'react';
import type { CreditRecord, Listing, Order } from '@shared/models';
import { affiliateUnitMinor } from '@shared/affiliate';
import {
  PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS, REFUND_ORIGIN_LABELS, availabilityLabel, creditIsLive, creditLeft, expiresSoon, isExpired,
  isMultiple, methodOf, orderMoney, timeLeft,
} from '@shared/payments';
import { Link } from 'react-router-dom';
import { ApiRequestError, api } from '../api';
import { formatDate, formatMoney } from '../format';
import { Modal } from './LotFields';
import { ErrorNotice } from './ui';
import { LBox, OptionTiles, Switch, ToggleRow, daysUntil, isoInDays } from './ListingForm';

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

/** On a public card's picture: this first dropped in the shop's channel. Overlaid, so the card stays its size. */
export function DropTag({ on }: { on: boolean | undefined }) {
  return on ? <span className="droptag">⚡ Exclusive channel drop</span> : null;
}

/** The highlighted line under a card's picture: this can be booked with part of the price. */
export function AdvanceStrip({ percent }: { percent: number | null | undefined }) {
  if (!percent) return null;
  return <span className="advstrip">💸 Booking Amt · {percent}%</span>;
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
export function PaymentHistory({ order, side }: {
  order: Order; side: 'buyer' | 'seller' | null;
}) {
  const money = orderMoney(order);
  const records = order.payments ?? [];
  const open = (order.credits ?? []).filter(creditIsLive);

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
            ↩️ {REFUND_ORIGIN_LABELS[credit.origin ?? 'overpaid']}: <b>{formatMoney(credit.amountMinor, order.currency)}</b>
          </span>
          <span className="faint">{creditStory(credit, order.currency)}</span>
        </div>
      ))}
      {side === 'seller' && open.length > 0 && (
        <Link to="/shop?tab=refunds" className="btn">
          ↩️ Refund {formatMoney(money.creditMinor, order.currency)} in Refunds
        </Link>
      )}
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
    parts.push(`${formatMoney(credit.pendingRefund.amountMinor, currency)} refunded — waiting for the buyer to confirm`);
  } else if (credit.status === 'held') {
    parts.push(`${formatMoney(creditLeft(credit), currency)} kept as credit for future orders`);
  } else if (credit.status === 'open') {
    parts.push(`${formatMoney(creditLeft(credit), currency)} still to refund`);
  }
  return parts.join(' · ');
}

export interface TermsDraft {
  quantityMode: 'fixed' | 'multiple';
  quantity: string;
  /** A limited time deal ends `days` from when it is saved. */
  limited: boolean;
  days: string;
  /** The expiry it came with, kept as is unless the days are changed. */
  was: { at: string; days: string } | null;
  advance: boolean;
  advancePercent: string;
  /** Pay a commission to whoever brings the buyer through their own link. */
  affiliate: boolean;
  /** In rupees, per unit sold. */
  affiliateAmount: string;
}

export function termsDraft(listing?: Partial<Terms & Pick<Listing, 'advancePercent' | 'affiliate' | 'priceMinor'>>): TermsDraft {
  const commission = affiliateUnitMinor(listing?.affiliate, listing?.priceMinor ?? 0);
  return {
    quantityMode: listing?.quantityMode === 'multiple' ? 'multiple' : 'fixed',
    quantity: String(listing?.quantityAvailable ?? 1),
    limited: listing ? Boolean(listing.expiresAt) : false,
    days: String(daysUntil(listing?.expiresAt)),
    was: listing?.expiresAt ? { at: listing.expiresAt, days: String(daysUntil(listing.expiresAt)) } : null,
    advance: Boolean(listing?.advancePercent),
    advancePercent: String(listing?.advancePercent ?? 20),
    affiliate: commission > 0,
    affiliateAmount: commission > 0 ? String(commission / 100) : '50',
  };
}

/** The draft as the API takes it. */
export function termsBody(draft: TermsDraft) {
  return {
    quantityMode: draft.quantityMode,
    quantityAvailable: Math.max(draft.quantityMode === 'multiple' ? 1 : 0, Number(draft.quantity) || 0),
    expiresAt: !draft.limited ? null : draft.was && draft.was.days === draft.days ? draft.was.at : isoInDays(draft.days),
    advancePercent: draft.advance ? Math.min(99, Math.max(1, Number(draft.advancePercent) || 20)) : null,
    affiliateMinor: draft.affiliate ? Math.max(100, Math.round((Number(draft.affiliateAmount) || 0) * 100)) : null,
  };
}

/**
 * Stock, advance and expiry - on every listing form, in the same boxes.
 *
 * A pre-order passes `preOrder`: it has no fixed stock and its bookings-close
 * date is its expiry, so both questions step aside rather than being asked
 * twice.
 */
export function TermsFields({ value, onChange, preOrder = false, publicLater = false }: {
  value: TermsDraft;
  onChange: (next: TermsDraft) => void;
  preOrder?: boolean;
  /** A power sale item: the deal clock starts when it goes public, after the member price. */
  publicLater?: boolean;
}) {
  const set = (patch: Partial<TermsDraft>) => onChange({ ...value, ...patch });
  return (
    <>
      <LBox icon="📦" title="Stock & payment">
        {!preOrder && (
          <>
            <OptionTiles label="Quantity" value={value.quantityMode} onChange={(quantityMode) => set({ quantityMode })}
              options={[
                { id: 'fixed', icon: '🔢', title: 'Set number' },
                { id: 'multiple', icon: '∞', title: 'Multiple', note: 'No fixed count' },
              ]} />
            {value.quantityMode === 'fixed' && (
              <label className="field">
                <span>How many</span>
                <input type="number" min="0" step="1" value={value.quantity}
                  onChange={(e) => set({ quantity: e.target.value })} />
              </label>
            )}
          </>
        )}
        <ToggleRow icon="💳" title="Accept an advance" hint="Buyers pay part now, the rest later."
          checked={value.advance} onChange={(advance) => set({ advance })} />
        {value.advance && (
          <label className="field">
            <span>Advance (% of the price)</span>
            <input type="number" min="1" max="99" value={value.advancePercent}
              onChange={(e) => set({ advancePercent: e.target.value })} />
          </label>
        )}
      </LBox>

      {/* Not on a power sale: its items are made by the sale, which sets its own terms. */}
      {!publicLater && <LBox icon="🤝" title="Affiliate commission"
        hint={value.affiliate
          ? `Anyone can share their own link to this item and earns ₹${value.affiliateAmount || '—'} for every unit it sells.`
          : 'Off: nobody earns for sharing this item.'}
        right={<Switch checked={value.affiliate} onChange={(affiliate) => set({ affiliate })} label="Affiliate commission" />}>
        {value.affiliate && (
          <label className="field">
            <span>Commission per unit sold (₹)</span>
            <input type="number" min="1" step="1" value={value.affiliateAmount}
              onChange={(e) => set({ affiliateAmount: e.target.value })} />
            <span className="field__hint">
              A fixed amount, less than the price. Owed once the item is delivered; you pay it to the
              affiliate and mark it paid on the order.
            </span>
          </label>
        )}
      </LBox>}

      {!preOrder && (
        <LBox icon="⏳" title="Limited time deal" hint={publicLater
            ? `For the public listing: starts when the member price ends${value.limited ? `, lasts ${value.days || '—'} days` : ''}.`
            : value.limited ? `Comes off sale in ${value.days || '—'} days.` : 'Off: stays up until you take it down.'}
          right={<Switch checked={value.limited} onChange={(limited) => set({ limited })} label="Limited time deal" />}>
          {value.limited && (
            <label className="field">
              <span>Ends in (days)</span>
              <input type="number" min="1" max="365" value={value.days} onChange={(e) => set({ days: e.target.value })} />
            </label>
          )}
        </LBox>
      )}
    </>
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
        <LBox icon="🏷️" title="The item">
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label className="field">
            <span>Price (₹)</span>
            <input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} required />
          </label>
        </LBox>
        <TermsFields value={terms} onChange={setTerms} preOrder={Boolean(listing.preOrder)} />
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
