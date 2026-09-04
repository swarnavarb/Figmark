import { useEffect, useState } from 'react';
import { api, type DirectoryForwarder } from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, TrustBadge } from '../components/ui';
import { formatMoney } from '../format';

/**
 * The freight forwarder directory.
 *
 * Forwarders list themselves; nothing here is admin-entered. Choosing one is
 * always optional — a seller already working with someone off-platform enters
 * them on the lot by hand instead.
 */
export function ForwardersPage() {
  const [entries, setEntries] = useState<DirectoryForwarder[] | null>(null);
  const [route, setRoute] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .forwarders(route || undefined)
        .then((result) => !cancelled && setEntries(result.forwarders))
        .catch((err: Error) => !cancelled && setError(err.message));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [route]);

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Freight forwarders</h1>
          <p className="muted">
            China to India consolidation. Rates and turnaround are the forwarder's own claims until they have
            shipped lots on the platform.
          </p>
        </div>
      </div>

      <div className="search" style={{ maxWidth: 380, marginBottom: 22 }}>
        <span className="search__icon"><Icon name="search" /></span>
        <input value={route} onChange={(event) => setRoute(event.target.value)}
          placeholder="Filter by route — Guangzhou, Mumbai…" aria-label="Filter forwarders by route" />
      </div>

      {error && <ErrorNotice message={error} />}

      {entries === null ? (
        <p className="muted">Loading…</p>
      ) : entries.length === 0 ? (
        <EmptyState icon="✈" title="No forwarders on that route yet">
          Try a different city, or add your own forwarder directly on the lot.
        </EmptyState>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {entries.map((entry) => (
            <article key={entry.id} className="card card--pad stack">
              <div className="row">
                <Avatar name={entry.companyName} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="card__title">{entry.companyName}</div>
                  <span className="faint">
                    {entry.trust.completedTransactions} lots shipped
                    {entry.claimedMonthlyCapacityKg && ` · ~${entry.claimedMonthlyCapacityKg.toLocaleString('en-IN')} kg/mo`}
                  </span>
                </div>
                <TrustBadge score={entry.trust.score} />
              </div>

              <p className="muted">{entry.description}</p>

              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr><th>Route</th><th>Days</th><th>Per kg</th></tr>
                  </thead>
                  <tbody>
                    {entry.routes.map((lane) => (
                      <tr key={`${lane.originCity}-${lane.destinationCity}`}>
                        <td>{lane.originCity} → {lane.destinationCity}</td>
                        <td>{lane.claimedTurnaroundDays}</td>
                        <td>{formatMoney(lane.ratePerKgMinor, lane.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="row row--between">
                <span className="faint">{entry.contactEmail}</span>
                <a className="btn btn--ghost" href={`mailto:${entry.contactEmail}`}>Contact</a>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
