import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { labelFor } from '@shared/fulfilment';
import { api, type OrderTracking } from '../api';
import { ErrorNotice, Icon } from '../components/ui';
import { formatDate, formatMoney, timeAgo } from '../format';

/**
 * One order, as the buyer sees it.
 *
 * Nothing here mentions a shipment batch. The timeline is the order's own
 * history, so an item moved into a later consignment gains an event rather
 * than rewinding, and the only facts inherited from the batch are the tracking
 * reference and the dispatch estimate.
 */
export function OrderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<OrderTracking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .orderTracking(id)
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const { order, stages, currentStage } = data;
  const currentIndex = stages.indexOf(currentStage);
  // Newest first: what just happened matters more than what happened first.
  const history = [...order.stageHistory].reverse();

  return (
    <main className="page">
      <button className="btn btn--quiet" onClick={() => navigate('/me?tab=purchases')} style={{ marginBottom: 16 }}>
        <Icon name="back" size={14} /> My purchases
      </button>

      <div className="page__head">
        <div>
          <h1>{order.itemName}</h1>
          <p className="muted">
            From {data.sellerName} · ordered {timeAgo(order.createdAt)}
          </p>
        </div>
        <span className={`badge badge--${order.status === 'delivered' ? 'ok' : 'warn'}`}>
          {order.status.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="detail">
        <div className="card card--pad stack">
          <h2>Where it is</h2>

          <ol className="track" style={{ flexWrap: 'wrap' }}>
            {stages.map((stage, index) => (
              <li key={stage}
                className={`track__step${index < currentIndex ? ' is-done' : ''}${index === currentIndex ? ' is-current' : ''}`}>
                <span className="track__dot" aria-hidden="true" />
                <span>{labelFor(stage)}</span>
              </li>
            ))}
          </ol>

          <div className="detail__section" style={{ marginTop: 8 }}>
            <h3>History</h3>
            {history.map((event, index) => (
              <div key={`${event.stage}-${event.enteredAt}-${index}`} className="comment">
                <div className="comment__head">
                  <span className="comment__who">{labelFor(event.stage)}</span>
                  <span className="faint">{formatDate(event.enteredAt)}</span>
                </div>
                {event.note && <p className="muted">{event.note}</p>}
              </div>
            ))}
          </div>
        </div>

        <aside className="stack">
          <div className="card card--pad stack">
            <div className="row row--between">
              <span className="muted">Total</span>
              <span className="detail__price" style={{ fontSize: 'var(--t-lg)' }}>
                {formatMoney(order.unitPriceMinor * order.quantity, order.currency)}
              </span>
            </div>
            <dl style={{ margin: 0 }}>
              <div className="kv"><dt>Quantity</dt><dd>{order.quantity}</dd></div>
              <div className="kv"><dt>Condition</dt><dd>{order.condition}</dd></div>
              <div className="kv">
                <dt>Payment</dt>
                <dd>{order.paymentStatus.replace(/_/g, ' ')}</dd>
              </div>
              <div className="kv"><dt>Escrow</dt><dd>{order.escrow.state}</dd></div>
              {data.estimatedDispatchAt && (
                <div className="kv"><dt>Est. dispatch</dt><dd>{formatDate(data.estimatedDispatchAt)}</dd></div>
              )}
            </dl>

            {data.trackingReference ? (
              <div>
                <span className="faint">Tracking reference</span>
                <div className="mono" style={{ marginTop: 4 }}>{data.trackingReference}</div>
              </div>
            ) : (
              <p className="faint">No tracking reference yet. It appears once the seller dispatches.</p>
            )}
          </div>

          <p className="notice notice--info">
            Your payment is held in escrow and released to the seller once you confirm delivery, or
            automatically after the dispute window closes.
          </p>
        </aside>
      </div>
    </main>
  );
}
