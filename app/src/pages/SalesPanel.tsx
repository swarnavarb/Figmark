import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError, api, type SalesResponse } from '../api';
import { formatMoney } from '../format';
import { NudgeButton } from '../components/NudgeButton';
import { PersonLink, Thumb } from '../components/ui';

/**
 * Sales (free Analytics): how much sold over a period, what sold best, who
 * still owes and for how long, where orders came through, what is about to
 * run out, and a spreadsheet of it all.
 */

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
] as const;

const SOURCES = {
  shared: { icon: '🔗', label: 'Shared links' },
  sale: { icon: '⚡', label: 'Power sales' },
  preorder: { icon: '🎯', label: 'Pre-orders' },
  shop: { icon: '🏪', label: 'Your shop and the feed' },
} as const;

type Best = 'units' | 'revenue';

export function SalesPanel({ shop }: { shop?: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<SalesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [best, setBest] = useState<Best>('units');

  useEffect(() => {
    setError(null);
    void api.salesReport(days, shop)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your sales.'));
  }, [days, shop]);

  if (error) return <p className="faint">{error}</p>;
  if (!data) return <p className="muted">Loading sales…</p>;

  const peak = Math.max(1, ...data.series.map((row) => row.revenueMinor));
  const change = (now: number, before: number) =>
    before === 0 ? (now > 0 ? 'new' : '—') : `${now >= before ? '▲' : '▼'} ${Math.abs(Math.round(((now - before) / before) * 100))}%`;
  const bucketLabel = (start: string) =>
    data.bucket === 'month'
      ? new Date(start).toLocaleDateString('en-IN', { month: 'short' })
      : new Date(start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const bestRows = data.best[best];
  const sourceTotal = Math.max(1, data.sources.reduce((sum, row) => sum + row.orders, 0));

  function exportCsv() {
    if (!data) return;
    const cells = (values: (string | number)[]) =>
      values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
    const rupees = (minor: number) => (minor / 100).toFixed(2);
    const lines = [
      cells(['Date', 'Order', 'Item', 'Buyer', 'Handle', 'Qty', 'Unit price', 'Total', 'Paid', 'Outstanding', 'Currency', 'Status', 'Payment', 'Lot']),
      ...data.rows.map((row) => cells([
        row.date.slice(0, 10), row.orderId, row.item, row.buyer, row.handle ?? '', row.quantity,
        rupees(row.unitPriceMinor), rupees(row.totalMinor), rupees(row.paidMinor), rupees(row.outstandingMinor),
        row.currency, row.status, row.payment, row.lot,
      ])),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `figmark-orders-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <>
      <div className="card card--pad stack">
        <div className="sales__head">
          <h2>Sales over time</h2>
          <div className="inssegs" role="tablist" aria-label="Period">
            {RANGES.map((range) => (
              <button key={range.days} type="button" role="tab" aria-selected={days === range.days}
                className={`inscat${days === range.days ? ' is-on' : ''}`} onClick={() => setDays(range.days)}>
                {range.label}
              </button>
            ))}
          </div>
        </div>
        <div className="stats">
          <Stat label="Revenue" value={formatMoney(data.totals.revenueMinor)}
            note={`${change(data.totals.revenueMinor, data.before.revenueMinor)} vs the ${days} days before`} />
          <Stat label="Orders" value={String(data.totals.orders)} note={change(data.totals.orders, data.before.orders)} />
          <Stat label="Units" value={String(data.totals.units)}
            note={`${data.totals.customers} customer${data.totals.customers === 1 ? '' : 's'}`} />
        </div>
        <div className="sales__chart" role="img" aria-label={`Revenue by ${data.bucket}`}>
          {data.series.map((row) => (
            <span key={row.start} className="sales__col"
              title={`${bucketLabel(row.start)}: ${formatMoney(row.revenueMinor)} from ${row.orders} order${row.orders === 1 ? '' : 's'}`}>
              <span className={`sales__bar${row.revenueMinor === 0 ? ' is-empty' : ''}`}
                style={{ height: `${Math.max(3, Math.round((row.revenueMinor / peak) * 100))}%` }} />
            </span>
          ))}
        </div>
        <div className="sales__axis faint">
          <span>{data.series[0] ? bucketLabel(data.series[0].start) : ''}</span>
          <span>By {data.bucket}</span>
          <span>{data.series.length ? bucketLabel(data.series[data.series.length - 1]!.start) : ''}</span>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" disabled={data.rows.length === 0} onClick={exportCsv}>
          ⬇ Export {data.rows.length} order{data.rows.length === 1 ? '' : 's'} as CSV
        </button>
      </div>

      <div className="card card--pad stack">
        <div className="sales__head">
          <h2>Best sellers</h2>
          <div className="inssegs" role="tablist" aria-label="Rank by">
            <button type="button" role="tab" aria-selected={best === 'units'} className={`inscat${best === 'units' ? ' is-on' : ''}`}
              onClick={() => setBest('units')}>By units</button>
            <button type="button" role="tab" aria-selected={best === 'revenue'} className={`inscat${best === 'revenue' ? ' is-on' : ''}`}
              onClick={() => setBest('revenue')}>By revenue</button>
          </div>
        </div>
        {bestRows.length === 0 ? <p className="muted">No sales in this period.</p> : (
          <ol className="sales__best">
            {bestRows.map((row, at) => (
              <li key={row.listingId}>
                <b className="sales__rank">{at + 1}</b>
                <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />
                <Link to={`/listing/${row.listingId}`} className="sales__title">{row.title}</Link>
                <span className="sales__fig">
                  <b>{best === 'units' ? `${row.units} sold` : formatMoney(row.revenueMinor)}</b>
                  <small className="faint">{best === 'units' ? formatMoney(row.revenueMinor) : `${row.units} sold`}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="card card--pad stack">
        <div>
          <h2>Unpaid, by how long</h2>
          <span className="field__hint">Balances on orders you accepted, counted from when you accepted them.</span>
        </div>
        <div className="sales__ages">
          <div className="sales__age"><small>0–3 days</small><b>{formatMoney(data.ageing.fresh.amountMinor)}</b><small>{data.ageing.fresh.count} orders</small></div>
          <div className="sales__age sales__age--warn"><small>4–7 days</small><b>{formatMoney(data.ageing.week.amountMinor)}</b><small>{data.ageing.week.count} orders</small></div>
          <div className="sales__age sales__age--bad"><small>8+ days</small><b>{formatMoney(data.ageing.old.amountMinor)}</b><small>{data.ageing.old.count} orders</small></div>
        </div>
        {data.ageing.rows.length === 0 ? <p className="muted">Nobody owes you anything.</p> : (
          data.ageing.rows.map((row) => (
            <div key={row.orderId} className="ins__row">
              <span style={{ minWidth: 0 }}>
                <PersonLink party={row.who} />
                <span className="faint"> · <Link to={`/order/${row.orderId}`}>{row.title}</Link> · {row.days} day{row.days === 1 ? '' : 's'}</span>
              </span>
              <span className={`badge badge--${row.days >= 8 ? 'danger' : 'warn'}`}>{formatMoney(row.outstandingMinor, row.currency)}</span>
              <NudgeButton request={{ kind: 'payment', orderId: row.orderId }} shop={shop} />
            </div>
          ))
        )}
      </div>

      <div className="card card--pad stack">
        <div>
          <h2>Where orders came from</h2>
          <span className="field__hint">How each order in this period came through.</span>
        </div>
        {data.sources.map((row) => (
          <div key={row.source} className="insbar">
            <span>{SOURCES[row.source].icon} {SOURCES[row.source].label}</span>
            <span className="insbar__track">
              <span className="insbar__fill insbar__fill--violet" style={{ width: `${Math.round((row.orders / sourceTotal) * 100)}%` }} />
            </span>
            <b>{row.orders}</b>
          </div>
        ))}
      </div>

      <div className="card card--pad stack">
        <div>
          <h2>Stock alerts</h2>
          <span className="field__hint">Items on sale with 2 or fewer left.</span>
        </div>
        {data.stock.length === 0 ? <p className="muted">Nothing running low.</p> : (
          data.stock.map((row) => (
            <div key={row.listingId} className="ins__row">
              <span style={{ minWidth: 0 }}>
                <Link to={`/listing/${row.listingId}`}>{row.title}</Link>
                {row.soldRecently > 0 && <span className="faint"> · {row.soldRecently} sold in 30 days</span>}
              </span>
              <span className={`badge badge--${row.left === 0 ? 'danger' : 'warn'}`}>{row.left === 0 ? 'Out of stock' : `${row.left} left`}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      <div className="stat__note">{note}</div>
    </div>
  );
}
