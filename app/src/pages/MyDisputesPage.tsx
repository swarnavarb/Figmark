import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, type DisputeRow, type MyDisputesResponse } from '../api';
import { EmptyState, ErrorNotice } from '../components/ui';
import { formatDateOrdinal, formatMoney } from '../format';

/**
 * My disputes - every dispute on this person's orders, in two piles.
 *
 * Buyer disputes are on things they bought; store disputes are on their
 * shop's sales. For now this is the record - who raised it, about what, for
 * how much, and when - plus a way to raise a new one. Working a dispute
 * through to an outcome comes later.
 */
export function MyDisputesPage() {
  const [data, setData] = useState<MyDisputesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'store' ? 'store' : 'buyer';
  const [raising, setRaising] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.myDisputes());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your disputes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function raise() {
    setBusy(true);
    setError(null);
    try {
      await api.flagDispute(orderId, { reason: reason.trim() });
      setRaising(false);
      setOrderId('');
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not record that.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const rows = tab === 'buyer' ? data.asBuyer : data.asStore;
  const choices = data.orders.filter((order) => order.side === (tab === 'buyer' ? 'buyer' : 'seller'));

  return (
    <main className="page stack page--top">
      <div className="page__head">
        <h1>⚖️ My disputes</h1>
        <button type="button" className="btn btn--danger btn--sm" onClick={() => setRaising((open) => !open)}>
          {raising ? 'Close' : '＋ Raise a dispute'}
        </button>
      </div>

      <div className="tabs tabs--vivid">
        <button type="button" className={`tab${tab === 'buyer' ? ' is-on' : ''}`} onClick={() => setParams({}, { replace: true })}>
          Buyer disputes {data.asBuyer.length}
        </button>
        <button type="button" className={`tab${tab === 'store' ? ' is-on' : ''}`}
          onClick={() => setParams({ tab: 'store' }, { replace: true })}>
          Store disputes {data.asStore.length}
        </button>
      </div>

      {raising && (
        <section className="card card--pad stack">
          <label className="field">
            <span>{tab === 'buyer' ? 'Which purchase?' : 'Which sale?'}</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Choose an order…</option>
              {choices.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.itemName} — {tab === 'buyer' ? 'from' : 'to'} {order.counterpartyName} · {formatDateOrdinal(order.createdAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>What is the dispute about?</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="What happened, and what you would like done about it." />
            <span className="field__hint">It is recorded, and the other side is told.</span>
          </label>
          <button type="button" className="btn btn--danger" style={{ justifySelf: 'start' }}
            disabled={busy || !orderId || reason.trim().length < 4} onClick={() => void raise()}>
            {busy ? 'Recording…' : 'Raise dispute'}
          </button>
        </section>
      )}

      {error && <ErrorNotice message={error} />}

      {rows.length === 0 ? (
        <EmptyState title={tab === 'buyer' ? 'No disputes on your purchases' : 'No disputes on your store'}>
          When a payment or a refund is said not to have arrived, the side that paid can dispute it -
          and either side can raise a dispute from the order. They are all kept here.
        </EmptyState>
      ) : (
        <ul className="rfhist">
          {rows.map((row) => <DisputeItem key={row.id} row={row} />)}
        </ul>
      )}
    </main>
  );
}

function DisputeItem({ row }: { row: DisputeRow }) {
  return (
    <li className="rfhist__row rfhist__row--not_received">
      <span className="rfhist__icon" aria-hidden="true">⚖️</span>
      <span className="rfhist__body">
        <b>{row.label}</b>
        <small>
          <Link to={row.link ?? `/order/${row.orderId}`}>{row.itemName}</Link> · with {row.counterpartyName}
        </small>
        {row.reason && <small>“{row.reason}”</small>}
        <small>
          Raised by {row.raisedByMe ? 'you' : `the ${row.raisedBySide}`} on {formatDateOrdinal(row.raisedAt)}
        </small>
      </span>
      <span className="rfhist__side">
        {row.amountMinor !== null && <b>{formatMoney(row.amountMinor, row.currency)}</b>}
        <span className="badge badge--danger">Open</span>
      </span>
    </li>
  );
}
