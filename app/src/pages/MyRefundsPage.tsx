import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { REFUND_ORIGIN_LABELS } from '@shared/payments';
import { ApiRequestError, api, type MyRefund } from '../api';
import { ReversalDetailsForm } from '../components/ReversalDetailsForm';
import { EmptyState, ErrorNotice } from '../components/ui';
import { formatDateOrdinal, formatMoney } from '../format';

/**
 * My refunds - the buyer's side of every refund owed to them.
 *
 * What each one is for, how much has come back and when, what is still
 * owed, and - first, because it is the one thing waiting on them - any
 * refund the seller says they sent, with the two buttons to answer it.
 */
export function MyRefundsPage() {
  const [refunds, setRefunds] = useState<MyRefund[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // In the URL, so a notification asking for reversal details lands on that tab.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'details' ? 'details' : 'refunds';

  const load = useCallback(async () => {
    try {
      setRefunds((await api.myRefunds()).refunds);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your refunds.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer(refund: MyRefund, received: boolean) {
    const key = `${refund.creditId}:${received}`;
    setBusy(key);
    setError(null);
    try {
      await api.ackCreditRefund(refund.orderId, received, refund.creditId);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
    } finally {
      setBusy(null);
    }
  }

  const tabs = (
    <div className="tabs tabs--vivid">
      <button type="button" className={`tab${tab === 'refunds' ? ' is-on' : ''}`} onClick={() => setParams({}, { replace: true })}>
        Refunds
      </button>
      <button type="button" className={`tab${tab === 'details' ? ' is-on' : ''}`}
        onClick={() => setParams({ tab: 'details' }, { replace: true })}>
        Payment reversal details
      </button>
    </div>
  );

  if (tab === 'details') {
    return (
      <main className="page stack page--top">
        <div className="page__head"><h1>↩️ My refunds</h1></div>
        {tabs}
        <ReversalDetailsForm />
      </main>
    );
  }

  if (error && !refunds) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!refunds) return <main className="page"><p className="muted">Loading…</p></main>;

  const currency = refunds[0]?.currency ?? 'INR';
  const owed = refunds.reduce((sum, refund) => sum + refund.leftMinor, 0);
  const back = refunds.reduce((sum, refund) => sum + refund.refundedMinor, 0);
  const waiting = refunds.filter((refund) => refund.status === 'refund_pending');

  return (
    <main className="page stack page--top">
      <div className="page__head">
        <h1>↩️ My refunds</h1>
      </div>
      {tabs}

      <section className="rfhero">
        <div className="rfhero__main">
          <small>Still owed to you</small>
          <b>{formatMoney(owed, currency)}</b>
          <span>{formatMoney(back, currency)} refunded so far · {waiting.length} waiting on you</span>
        </div>
      </section>

      {error && <ErrorNotice message={error} />}

      {refunds.length === 0 ? (
        <EmptyState title="No refunds">
          When a seller owes you money back - you paid more than the item cost, they cancelled an
          order you had paid for, or they refunded part of one - it shows here.
        </EmptyState>
      ) : refunds.map((refund) => {
        const pending = refund.status === 'refund_pending' && refund.pendingRefund;
        return (
          <section key={refund.creditId} className={`xcredit xcredit--${refund.status}`}>
            <div className="xcredit__head">
              <span className="xcredit__amt">{formatMoney(refund.amountMinor, refund.currency)}</span>
              <span className="xcredit__who">
                <b><Link to={`/order/${refund.orderId}`}>{refund.itemName}</Link></b>
                <small>from {refund.sellerName} · {formatDateOrdinal(refund.createdAt)}</small>
              </span>
              <span className="xcredit__tags">
                <span className="badge badge--accent">{REFUND_ORIGIN_LABELS[refund.origin]}</span>
                <span className={`badge ${pending ? 'badge--warn' : refund.leftMinor === 0 ? 'badge--ok' : 'badge--purple'}`}>
                  {pending ? 'Confirm it arrived' : refund.leftMinor === 0 ? 'Settled' : `${formatMoney(refund.leftMinor, refund.currency)} owed`}
                </span>
              </span>
            </div>
            {refund.reason && <p className="faint xcredit__note">“{refund.reason}”</p>}
            {refund.status === 'held' && (
              <p className="faint xcredit__note">The seller is keeping this as credit towards your next order with them.</p>
            )}

            {pending && refund.pendingRefund && (
              <div className="claimcard__ask">
                <p style={{ margin: 0 }}>
                  {refund.sellerName} says they refunded <b>{formatMoney(refund.pendingRefund.amountMinor, refund.currency)}</b>
                  {refund.pendingRefund.reference ? ` (reference ${refund.pendingRefund.reference})` : ''}. Did it reach you?
                  {refund.pendingRefund.screenshotUrl && (
                    <> <a href={refund.pendingRefund.screenshotUrl} target="_blank" rel="noopener noreferrer"
                      className="claimcard__link">📎 See their screenshot</a></>
                  )}
                </p>
                <span className="row" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn--ok" disabled={busy !== null}
                    onClick={() => void answer(refund, true)}>
                    {busy === `${refund.creditId}:true` ? 'Sending…' : '✅ Received'}
                  </button>
                  <button type="button" className="btn btn--danger" disabled={busy !== null}
                    onClick={() => void answer(refund, false)}>
                    {busy === `${refund.creditId}:false` ? 'Sending…' : '❌ Not received'}
                  </button>
                </span>
              </div>
            )}

            {(refund.log.length > 0 || refund.applications.length > 0) && (
              <ul className="rfhist">
                {refund.log.map((entry) => (
                  <li key={entry.id} className={`rfhist__row rfhist__row--${entry.status}`}>
                    <span className="rfhist__icon" aria-hidden="true">↩️</span>
                    <span className="rfhist__body">
                      <b>Refund sent</b>
                      <small>
                        {formatDateOrdinal(entry.sentAt)}{entry.reference ? ` · ref ${entry.reference}` : ''}
                        {entry.screenshotUrl && (
                          <> · <a href={entry.screenshotUrl} target="_blank" rel="noopener noreferrer">📎 screenshot</a></>
                        )}
                      </small>
                    </span>
                    <span className="rfhist__side">
                      <b>{formatMoney(entry.amountMinor, refund.currency)}</b>
                      <span className={`badge ${entry.status === 'received' ? 'badge--ok' : entry.status === 'awaiting' ? 'badge--warn' : 'badge--danger'}`}>
                        {entry.status === 'received' ? 'Received' : entry.status === 'awaiting' ? 'Awaiting you' : 'Not received'}
                      </span>
                    </span>
                  </li>
                ))}
                {refund.applications.map((moved) => (
                  <li key={`${moved.orderId}-${moved.at}`} className="rfhist__row rfhist__row--moved">
                    <span className="rfhist__icon" aria-hidden="true">➡️</span>
                    <span className="rfhist__body">
                      <b>Put towards {moved.itemName}</b>
                      <small>{formatDateOrdinal(moved.at)}</small>
                    </span>
                    <span className="rfhist__side">
                      <b>{formatMoney(moved.amountMinor, refund.currency)}</b>
                      <span className="badge badge--aqua">Moved</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </main>
  );
}
