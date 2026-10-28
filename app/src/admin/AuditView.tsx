import { useEffect, useState } from 'react';
import { ApiRequestError, admin, type AuditEntry } from './api';
import { timeAgo, formatDateTime } from '../format';
import { Loading } from '../components/Feedback';

/**
 * What operators did: every write made from this console, recorded once it
 * succeeded - who, what, to which account or case, and what they sent.
 * Read-only: nothing in the app edits or deletes it.
 *
 * Recording is off until an operator turns it on here. While off nothing is
 * written - turning it off included - and what was recorded before stays
 * until it is 90 days old.
 */
export function AuditView() {
  const [days, setDays] = useState(7);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    void admin.settings().then((settings) => setRecording(settings.auditTrail))
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the settings.'));
  }, []);

  useEffect(() => {
    setEntries(null);
    admin.audit(days).then((data) => setEntries(data.entries))
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the audit trail.'));
  }, [days]);

  async function toggle() {
    if (recording === null) return;
    setSwitching(true);
    setError(null);
    try {
      setRecording((await admin.saveSettings({ auditTrail: !recording })).auditTrail);
      // Turning it on is recorded; show it.
      setEntries(null);
      setEntries((await admin.audit(days)).entries);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not change that.');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="stack">
      {error && <p className="notice notice--error">{error}</p>}
      <div className="card card--pad">
        <label className="phoneprefs__row">
          <span>
            Record operator actions
            <span className="phoneprefs__hint muted">
              {recording === null ? <Loading size="sm" /> : recording
                ? 'On: every change made from this console is written here.'
                : 'Off: nothing is recorded, including turning it off. Entries already here stay for 90 days.'}
            </span>
          </span>
          <input type="checkbox" role="switch" className="phoneprefs__switch" aria-label="Record operator actions"
            checked={recording === true} disabled={recording === null || switching} onChange={() => void toggle()} />
        </label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {[1, 7, 30, 90].map((span) => (
          <button key={span} type="button" className={`btn btn--sm${span === days ? '' : ' btn--quiet'}`} onClick={() => setDays(span)}>
            {span === 1 ? 'Today' : `${span} days`}
          </button>
        ))}
      </div>
      {!entries ? <Loading /> : entries.length === 0 ? <p className="muted">Nothing recorded in this period.</p> : (
        <div className="card">
          {entries.map((entry) => (
            <div key={entry.id} className="userrow" style={{ cursor: 'default' }}>
              <div className="userrow__main">
                <span className="userrow__name">{entry.action}</span>
                <span className="userrow__meta">
                  {timeAgo(entry.at)} · {formatDateTime(entry.at)} · {entry.actorEmail ?? entry.actorId ?? 'unknown'}
                </span>
                {entry.detail !== null && entry.detail !== undefined && (
                  <code className="faint" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 'var(--t-xs)' }}>
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
