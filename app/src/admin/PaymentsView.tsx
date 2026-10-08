import { useEffect, useState } from 'react';
import { ApiRequestError, admin, type LedgerEntry } from './api';
import { formatMoney, timeAgo } from '../format';

const KIND_LABELS: Record<LedgerEntry['kind'], string> = {
  protection: 'Buyer protection',
  dispute: 'Dispute fee',
  escalation: 'Escalation fee',
};

/**
 * Every fee paid through the gateway: buyer protection, raising a dispute and
 * each escalation, with Figmark's commission and the community manager's share
 * of each. Nothing is paid person to person, and nothing here is refunded.
 */
export function PaymentsView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof admin.ledger>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    admin.ledger().then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the payments.'));
  }, []);

  if (error) return <p className="notice notice--error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      <div className="card card--pad">
        <div className="row" style={{ flexWrap: 'wrap', gap: 24 }}>
          <div><div className="faint">Collected</div><b>{formatMoney(data.totals.collectedMinor)}</b></div>
          <div><div className="faint">Figmark commission</div><b>{formatMoney(data.totals.commissionMinor)}</b></div>
          <div><div className="faint">To community managers</div><b>{formatMoney(data.totals.managerShareMinor)}</b></div>
        </div>
      </div>
      {data.entries.length === 0 ? <p className="muted">No fees paid yet.</p> : (
        <div className="card">
          {data.entries.map((entry) => (
            <div key={entry.id} className="userrow" style={{ cursor: 'default' }}>
              <div className="userrow__main">
                <span className="userrow__name">{KIND_LABELS[entry.kind]} · {formatMoney(entry.amountMinor, entry.currency)}</span>
                <span className="userrow__meta">
                  {timeAgo(entry.paidAt)} · commission {formatMoney(entry.commissionMinor, entry.currency)} · manager {formatMoney(entry.managerShareMinor, entry.currency)} · {entry.gatewayRef}
                </span>
              </div>
              <div className="userrow__tags"><span className="badge">{entry.reference}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
