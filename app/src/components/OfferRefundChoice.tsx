import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CREDIT_OFFER_MAX_TIMES } from '@shared/payments';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { haptic } from '../haptics';
import { useToast } from './Feedback';

/**
 * Money an offer made owed back after it was paid, and how it goes back.
 *
 * The buyer chooses: a refund of what is owed, or the shop's store credit,
 * which the shop can raise to tempt them. The shop sees what it has offered
 * and can offer more; it cannot choose for them. Both are also talking it
 * over in their chat, where every offer and the answer are said too.
 */
export function OfferRefundChoice({ orderId, creditId, amountMinor, offerMinor, currency = 'INR', side, shopName, itemName, onDone, chatHref }: {
  orderId: string;
  creditId: string;
  /** What is owed back as money. */
  amountMinor: number;
  /** The store credit the shop offers instead: never less than what is owed. */
  offerMinor: number | null;
  currency?: string;
  side: 'buyer' | 'seller';
  shopName?: string;
  /** Said when the panel sits away from its order, as on a Refunds list. */
  itemName?: string;
  onDone: () => void | Promise<void>;
  /** The two sides' chat, to talk it over. */
  chatHref?: string | null;
}) {
  const toast = useToast();
  const offer = Math.max(amountMinor, offerMinor ?? 0);
  const extra = offer - amountMinor;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState('');

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setProblem(null);
    try {
      await fn();
      haptic('success');
      toast(done, 'ok');
      setMore('');
      await onDone();
    } catch (err) {
      haptic('error');
      setProblem(err instanceof ApiRequestError ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  const moreMinor = Math.round(Number(more) * 100);
  const moreOk = Number.isFinite(moreMinor) && moreMinor > offer && moreMinor <= amountMinor * CREDIT_OFFER_MAX_TIMES;

  return (
    <section className="orc" aria-label="Money back from an offer">
      <header className="orc__head">
        <span className="orc__icon" aria-hidden="true">🎁</span>
        <span className="orc__lead">
          <b>{formatMoney(amountMinor, currency)} back{itemName ? ` · ${itemName}` : ''}</b>
          <small>
            {side === 'buyer'
              ? 'An offer lowered the price after you paid. Choose how you get it back.'
              : 'An offer lowered the price after they paid. The buyer chooses a refund or your store credit.'}
          </small>
        </span>
      </header>

      {side === 'buyer' ? (
        <div className="orc__opts">
          <button type="button" className="orc__opt" disabled={busy !== null}
            onClick={() => void run('refund', () => api.chooseOfferRefund(orderId, creditId, 'refund'),
              `Refund chosen. ${shopName ?? 'The shop'} sends it and you confirm it arrived.`)}>
            <span className="orc__optname">Refund</span>
            <b className="orc__optamt">{formatMoney(amountMinor, currency)}</b>
            <small>Sent to your account by the shop</small>
            <span className="orc__go">{busy === 'refund' ? 'Choosing…' : 'Choose refund'}</span>
          </button>
          <button type="button" className="orc__opt orc__opt--credit" disabled={busy !== null}
            onClick={() => void run('credit', () => api.chooseOfferRefund(orderId, creditId, 'store_credit'),
              `${formatMoney(offer, currency)} store credit is in your wallet.`)}>
            <span className="orc__optname">Store credit {extra > 0 && <em className="orc__extra">+{formatMoney(extra, currency)}</em>}</span>
            <b className="orc__optamt">{formatMoney(offer, currency)}</b>
            <small>At {shopName ?? 'this shop'} · never expires · yours at once</small>
            <span className="orc__go">{busy === 'credit' ? 'Choosing…' : 'Take store credit'}</span>
          </button>
        </div>
      ) : (
        <div className="orc__seller">
          <p className="orc__state">
            <span className="badge badge--warn">Buyer choosing</span>
            <span>Refund <b>{formatMoney(amountMinor, currency)}</b> or store credit <b>{formatMoney(offer, currency)}</b></span>
          </p>
          <form className="orc__more" onSubmit={(event) => {
            event.preventDefault();
            if (moreOk) void run('more', () => api.offerMoreCredit(orderId, creditId, moreMinor), 'Offer sent to the buyer.');
          }}>
            <label className="orc__field">
              <span>Offer more store credit</span>
              <span className="orc__input">
                <span aria-hidden="true">₹</span>
                <input inputMode="decimal" value={more} placeholder={String(Math.ceil((offer * 1.2) / 100))}
                  onChange={(event) => setMore(event.target.value.replace(/[^\d.]/g, ''))} aria-label="Store credit to offer, in rupees" />
              </span>
            </label>
            <button type="submit" className="btn btn--sm" disabled={busy !== null || !moreOk}>
              {busy === 'more' ? 'Sending…' : 'Offer'}
            </button>
          </form>
          {more && !moreOk && (
            <small className="orc__hint">
              More than {formatMoney(offer, currency)}, up to {formatMoney(amountMinor * CREDIT_OFFER_MAX_TIMES, currency)}.
            </small>
          )}
        </div>
      )}
      {problem && <p className="notice notice--error orc__problem">{problem}</p>}
      {chatHref && <Link to={chatHref} className="orc__chat">💬 Talk it over in chat</Link>}
    </section>
  );
}
