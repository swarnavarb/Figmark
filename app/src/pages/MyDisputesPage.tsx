import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiRequestError, api, type DisputeRow, type MyDisputesResponse } from '../api';
import { DISPUTE_STATUS_LABELS } from '@shared/enums';
import { ManagerMark } from '../components/ManagerBadge';
import { RaiseDisputeModal } from '../components/DisputeFlows';
import { EmptyState, ErrorNotice } from '../components/ui';
import { formatDateOrdinal, formatMoney } from '../format';

type Tab = 'buyer' | 'store' | 'community';

/**
 * My disputes - every dispute this person is a party to, in three piles.
 *
 * Buyer disputes are on things they bought; store disputes are on their
 * shop's sales; community disputes are about everything else - reviews,
 * comments, posts, people. Every row opens the three-way thread with the
 * community manager deciding it. A new one is raised here on any of their
 * orders through the same popup the ⋮ menus open.
 */
export function MyDisputesPage() {
  const [data, setData] = useState<MyDisputesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: Tab = raw === 'store' || raw === 'community' ? raw : 'buyer';
  const [picking, setPicking] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [raising, setRaising] = useState(false);

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

  if (error && !data) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const rows = tab === 'buyer' ? data.asBuyer : tab === 'store' ? data.asStore : data.community;
  const choices = data.orders.filter((order) => tab === 'community' || order.side === (tab === 'buyer' ? 'buyer' : 'seller'));
  const chosen = data.orders.find((order) => order.id === orderId) ?? null;
  const go = (next: Tab) => setParams(next === 'buyer' ? {} : { tab: next }, { replace: true });

  return (
    <main className="page stack page--top">
      <div className="page__head">
        <h1>⚖️ My disputes</h1>
        <button type="button" className="btn btn--danger btn--sm" onClick={() => setPicking((open) => !open)}>
          {picking ? 'Close' : '＋ Raise a dispute'}
        </button>
      </div>

      <div className="tabs tabs--vivid">
        <button type="button" className={`tab${tab === 'buyer' ? ' is-on' : ''}`} onClick={() => go('buyer')}>
          Purchases {data.asBuyer.length}
        </button>
        <button type="button" className={`tab${tab === 'store' ? ' is-on' : ''}`} onClick={() => go('store')}>
          Store sales {data.asStore.length}
        </button>
        <button type="button" className={`tab${tab === 'community' ? ' is-on' : ''}`} onClick={() => go('community')}>
          Community {data.community.length}
        </button>
      </div>

      {picking && (
        <section className="card card--pad stack">
          <label className="field">
            <span>Which order?</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Choose an order…</option>
              {choices.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.itemName} — {order.side === 'buyer' ? 'from' : 'to'} {order.counterpartyName} · {formatDateOrdinal(order.createdAt)}
                  {order.protectedNow ? ' · protected' : ''}
                </option>
              ))}
            </select>
            <span className="field__hint">
              A purchase still under buyer protection goes to an available community manager, free. Anything
              else is heard by a community manager you pick, for the dispute fee. To dispute a review, comment or post,
              use the ⋮ on it.
            </span>
          </label>
          <button type="button" className="btn btn--danger" style={{ justifySelf: 'start' }}
            disabled={!chosen} onClick={() => setRaising(true)}>
            Continue
          </button>
        </section>
      )}

      {raising && chosen && (
        <RaiseDisputeModal onClose={() => { setRaising(false); void load(); }}
          protectedOrder={chosen.protectedNow} side={chosen.side}
          target={{ type: 'order', id: chosen.id, againstId: chosen.counterpartyId, label: `${chosen.itemName} — with ${chosen.counterpartyName}` }} />
      )}

      {error && <ErrorNotice message={error} />}

      {rows.length === 0 ? (
        <EmptyState title={tab === 'buyer' ? 'No disputes on your purchases' : tab === 'store' ? 'No disputes on your store' : 'No community disputes'}>
          {tab === 'community'
            ? 'Disputes about reviews, comments, posts and members land here - raised by you, or against you.'
            : 'Either side can raise a dispute from the order, or from here. A community manager hears it with both of you.'}
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
  const closed = row.status === 'resolved' || row.status === 'withdrawn';
  const outcome = row.result?.how === 'settled' ? 'Settled'
    : row.result?.how === 'decided' ? (row.result.winnerId && row.raisedByMe === (row.result.favour === 'raiser') ? 'Won' : 'Lost')
    : DISPUTE_STATUS_LABELS[row.status];
  return (
    <li className={`rfhist__row rfhist__row--${closed ? 'received' : 'not_received'}`}>
      <span className="rfhist__icon" aria-hidden="true">⚖️</span>
      <span className="rfhist__body">
        <b><Link to={`/dispute/${row.id}`}>{row.label}</Link> <span className="faint">· with {row.counterpartyName}</span></b>
        <small className="clamp2">
          {row.orderId ? <Link to={`/order/${row.orderId}`}>{row.itemName}</Link> : <>“{row.itemName}”</>}
        </small>
        <small>
          Raised by {row.raisedByMe ? 'you' : row.raisedBySide === 'member' ? row.counterpartyName : `the ${row.raisedBySide}`} on {formatDateOrdinal(row.raisedAt)}
          {row.round && row.managerName && !closed && <> · round {row.round} with {row.managerName}<ManagerMark always size={12} /></>}
        </small>
      </span>
      <span className="rfhist__side">
        {row.amountMinor !== null && <b>{formatMoney(row.amountMinor, row.currency)}</b>}
        <span className={`badge ${outcome === 'Won' || outcome === 'Settled' ? 'badge--ok' : outcome === 'Lost' ? 'badge--danger'
          : row.status === 'withdrawn' ? 'badge--accent' : row.status === 'decided' ? 'badge--purple' : 'badge--warn'}`}>
          {outcome}
        </span>
      </span>
    </li>
  );
}
