import { useEffect, useState } from 'react';
import { ApiRequestError, admin, type AuditEntry } from './api';
import { timeAgo } from '../format';

/**
 * What operators did: every write made from this console, recorded once it
 * succeeded - who, what, to which account or case, and what they sent.
 * Read-only: nothing in the app edits or deletes it.
 */
export function AuditView() {
  const [days, setDays] = useState(7);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(null);
    admin.audit(days).then((data) => setEntries(data.entries))
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the audit trail.'));
  }, [days]);

  if (error) return <p className="notice notice--error">{error}</p>;

  return (
    <div className="stack">
      <div className="row" style={{ gap: 8 }}>
        {[1, 7, 30, 90].map((span) => (
          <button key={span} type="button" className={`btn btn--sm${span === days ? '' : ' btn--quiet'}`} onClick={() => setDays(span)}>
            {span === 1 ? 'Today' : `${span} days`}
          </button>
        ))}
      </div>
      {!entries ? <p className="muted">Loading…</p> : entries.length === 0 ? <p className="muted">Nothing recorded in this period.</p> : (
        <div className="card">
          {entries.map((entry) => (
            <div key={entry.id} className="userrow" style={{ cursor: 'default' }}>
              <div className="userrow__main">
                <span className="userrow__name">{entry.action}</span>
                <span className="userrow__meta">
                  {timeAgo(entry.at)} · {new Date(entry.at).toLocaleString()} · {entry.actorEmail ?? entry.actorId ?? 'unknown'}
                </span>
                {entry.detail !== null && entry.detail !== undefined && (
                  <code className="faint" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                    {typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail)}
                  </code>
                )}
              </div>
              <div className="userrow__tags">
                {Object.entries(entry.target).map(([key, value]) => <span key={key} className="badge">{key}: {value}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
