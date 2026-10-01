import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { REFUND_ORIGIN_LABELS } from '@shared/payments';
import { AFFILIATE_STATUS_LABELS } from '@shared/affiliate';
import { ApiRequestError, api, type AffiliateEarning, type MyRefund } from '../api';
import { ReversalDetailsForm } from '../components/ReversalDetailsForm';
import { EmptyState, ErrorNotice } from '../components/ui';
import { formatDateOrdinal, formatMoney } from '../format';

/**
 * My wallet - the money owed to this person: refunds from shops they bought
 * from, and commission their affiliate links earned.
 *
 * Refunds are the buyer's side of every refund owed to them.
 *
 * What each one is for, how much has come back and when, what is still
 * owed, and - first, because it is the one thing waiting on them - any
 * refund the seller says they sent, with the two buttons to answer it.
 */
export function MyRefundsPage() {
  const [refunds, setRefunds] = useState<MyRefund[] | null>(null);
  const [requests, setRequests] = useState<{ orderId: string; itemName: string; sellerName: string; requestedAt: string }[]>([]);
  const [hasDetails, setHasDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // In the URL, so a notification asking for reversal details lands on that tab.
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const tab = asked === 'details' ? 'details' : asked === 'earnings' ? 'earnings' : 'refunds';

  const load = useCallback(async () => {
    try {
      const result = await api.myRefunds();
      setRefunds(result.refunds);
      setRequests(result.detailsRequests);
      setHasDetails(result.hasDetails);
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

  async function confirmDetails(orderId: string) {
    setBusy(`confirm:${orderId}`);
    setError(null);
    try {
      await api.confirmReversalDetails(orderId);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
    } finally {
      setBusy(null);
    }
  }

  /* A seller waiting on this buyer before they can refund - on both tabs,
     because either is where they might be when they need to answer it. */
  const asks = requests.map((ask) => (
    <div key={ask.orderId} className="claimcard__ask">
      <p style={{ margin: 0 }}>
        💳 <b>{ask.sellerName}</b> asked you to {hasDetails ? 'confirm' : 'add'} your payment reversal details
        so they can refund you for <b>{ask.itemName}</b>.
      </p>
      <span className="row" style={{ flexWrap: 'wrap' }}>
        {hasDetails && (
          <button type="button" className="btn btn--ok" disabled={busy !== null}
            onClick={() => void confirmDetails(ask.orderId)}>
            {busy === `confirm:${ask.orderId}` ? 'Sending…' : '✅ They are up to date'}
          </button>
        )}
        {tab !== 'details' && (
          <button type="button" className="btn btn--ghost" onClick={() => setParams({ tab: 'details' }, { replace: true })}>
            ✏️ {hasDetails ? 'Update them' : 'Add them'}
          </button>
        )}
      </span>
    </div>
  ));

  const tabs = (
    <div className="tabs tabs--vivid">
      <button type="button" className={`tab${tab === 'refunds' ? ' is-on' : ''}`} onClick={() => setParams({}, { replace: true })}>
        Refunds
      </button>
      <button type="button" className={`tab${tab === 'earnings' ? ' is-on' : ''}`}
        onClick={() => setParams({ tab: 'earnings' }, { replace: true })}>
        Affiliate earnings
      </button>
      <button type="button" className={`tab${tab === 'details' ? ' is-on' : ''}`}
        onClick={() => setParams({ tab: 'details' }, { replace: true })}>
        Payment reversal details
      </button>
    </div>
  );

  if (tab === 'earnings') {
    return (
      <main className="page stack page--top">
        <div className="page__head"><h1>👛 My wallet</h1></div>
        {tabs}
        <EarningsTab />
      </main>
    );
  }

  if (tab === 'details') {
    return (
      <main className="page stack page--top">
        <div className="page__head"><h1>👛 My wallet</h1></div>
        {tabs}
        {asks}
        <ReversalDetailsForm onSaved={load} />
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
        <h1>👛 My wallet</h1>
      </div>
      {tabs}
      {asks}

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

/**
 * What this person's affiliate links have earned.
 *
 * Pending until the item is delivered, because a sale that falls through
 * owes nothing; then earned, until the shop marks it paid.
 */
function EarningsTab() {
  const [earnings, setEarnings] = useState<AffiliateEarning[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.myAffiliate()
      .then((result) => !cancelled && setEarnings(result.earnings))
      .catch((err) => !cancelled && setError(err instanceof ApiRequestError ? err.message : 'Could not load your earnings.'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorNotice message={error} />;
  if (!earnings) return <p className="muted">Loading…</p>;

  const currency = earnings[0]?.currency ?? 'INR';
  const sum = (status: AffiliateEarning['status']) => earnings
    .filter((entry) => entry.status === status).reduce((total, entry) => total + entry.commissionMinor, 0);

  return (
    <>
      <section className="rfhero">
        <div className="rfhero__main">
          <small>Earned, waiting to be paid</small>
          <b>{formatMoney(sum('earned'), currency)}</b>
          <span>
            {formatMoney(sum('pending'), currency)} pending delivery · {formatMoney(sum('paid'), currency)} paid out so far
          </span>
        </div>
      </section>

      {earnings.length === 0 ? (
        <EmptyState title="No affiliate earnings yet">
          Items marked 💸 pay a commission. Open one, tap “Share &amp; earn” and send your link: when somebody
          buys through it, your share shows here.
        </EmptyState>
      ) : earnings.map((entry) => (
        <div key={entry.orderId} className={`earnrow earnrow--${entry.status}`}>
          <span className="earnrow__what">
            <b><Link to={`/listing/${entry.listingId}`}>{entry.itemName}</Link></b>
            <small>
              {entry.percent}% of {formatMoney(entry.saleMinor, entry.currency)} · from {entry.sellerName}
              {entry.placedAt ? ` · ${formatDateOrdinal(entry.placedAt)}` : ''}
              {entry.paidAt ? ` · paid ${formatDateOrdinal(entry.paidAt)}${entry.paidReference ? ` (ref ${entry.paidReference})` : ''}` : ''}
            </small>
          </span>
          <span className="earnrow__side">
            <b>{formatMoney(entry.commissionMinor, entry.currency)}</b>
            <span className={`badge ${entry.status === 'earned' ? 'badge--lime' : entry.status === 'paid' ? 'badge--ok'
              : entry.status === 'void' ? 'badge--danger' : 'badge--warn'}`}>
              {AFFILIATE_STATUS_LABELS[entry.status]}
            </span>
          </span>
        </div>
      ))}
    </>
  );
}
