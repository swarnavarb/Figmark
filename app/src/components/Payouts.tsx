import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError, api, type PayoutsResponse } from '../api';
import { formatDate, formatMoney } from '../format';
import { ErrorNotice } from './ui';
import '../styles/Payouts.css';

/**
 * How much of the shop's money is its own yet, and when the rest comes.
 *
 * A protected order says "paid" the moment the buyer pays, but the money sits
 * with Figmark until delivery is confirmed or the release date passes. Without
 * this a seller adds up their orders, checks their account, and wonders where
 * the difference went.
 */
export function PayoutsPanel({ storeId }: { storeId?: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<PayoutsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setError(null);
    void api.payouts(storeId, days)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your money.'));
  }, [storeId, days]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <div className="card card--pad pyo"><p className="muted">Loading your money…</p></div>;

  const money = (minor: number) => formatMoney(minor, data.currency);
  const name = (id: string) => data.buyers[id] ?? 'Buyer';
  const heldRows = showAll ? data.held : data.held.slice(0, 5);

  return (
    <section className="card card--pad stack pyo" aria-labelledby="pyo-title">
      <div className="row row--between">
        <div>
          <h2 id="pyo-title">Your money</h2>
          <span className="field__hint">Protected payments are held until the buyer confirms delivery, or the release date passes.</span>
        </div>
        <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Released over">
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      <div className="pyo__tiles">
        <div className="pyo__tile pyo__tileheld">
          <small>Held for you</small>
          <b>{money(data.heldMinor)}</b>
          <span>{data.held.length} {data.held.length === 1 ? 'order' : 'orders'}</span>
        </div>
        <div className="pyo__tile pyo__tilerel">
          <small>Released · {data.days}d</small>
          <b>{money(data.releasedMinor)}</b>
          <span>{data.released.length} {data.released.length === 1 ? 'order' : 'orders'}</span>
        </div>
        <div className="pyo__tile">
          <small>Paid to you directly · {data.days}d</small>
          <b>{money(data.directMinor)}</b>
          <span>Never held</span>
        </div>
        {data.disputedMinor > 0 && (
          <div className="pyo__tile pyo__tiledisp">
            <small>In a dispute</small>
            <b>{money(data.disputedMinor)}</b>
            <span>{data.disputed.length} {data.disputed.length === 1 ? 'order' : 'orders'}</span>
          </div>
        )}
      </div>

      {data.upcoming.length > 0 && (
        <div>
          <h3 className="pyo__h">Coming to you</h3>
          <ol className="pyo__when">
            {data.upcoming.map((slot) => (
              <li key={slot.date ?? 'later'}>
                <span>{slot.date ? formatDate(slot.date) : 'Once delivered'}</span>
                <b>{money(slot.amountMinor)}</b>
                <small>{slot.orders} {slot.orders === 1 ? 'order' : 'orders'}{slot.date ? ' · unless the buyer disputes' : ' · the clock starts at delivery'}</small>
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.held.length > 0 && (
        <div>
          <h3 className="pyo__h">Held now</h3>
          <ul className="pyo__rows">
            {heldRows.map((row) => (
              <li key={row.orderId}>
                <Link to={`/order/${encodeURIComponent(row.orderId)}`}>
                  <span className="pyo__item"><b>{row.itemName}</b><small>{name(row.buyerId)}</small></span>
                  <span className="pyo__amt">{money(row.amountMinor)}
                    <small>{row.releasesAt ? `releases ${formatDate(row.releasesAt)}` : row.delivered ? 'releasing' : 'until delivered'}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {data.held.length > 5 && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${data.held.length}`}
            </button>
          )}
        </div>
      )}

      {data.held.length === 0 && data.released.length === 0 && data.directMinor === 0 && (
        <p className="muted">Nothing paid in this period yet. Paid orders show up here the moment the money arrives.</p>
      )}
    </section>
  );
}
