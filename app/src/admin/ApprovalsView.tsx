import { useCallback, useEffect, useState } from 'react';
import { SANCTION_LABELS, XP_PENALTY } from '@shared/disputes';
import { ApiRequestError, admin, type PendingAction } from './api';
import { timeAgo } from '../format';

/**
 * What community managers decided that waits for Figmark.
 *
 * Two kinds: an alert banner on a store or person's page, and an XP
 * deduction. Both are approved or rejected here once the dispute is final; an
 * operator may shorten a banner or soften a deduction on the way through.
 */
export function ApprovalsView() {
  const [actions, setActions] = useState<PendingAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setActions((await admin.actions()).actions);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the approvals.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(action: PendingAction, approve: boolean, change: { days?: number; severity?: 'light' | 'severe' }) {
    setBusy(action.id);
    setError(null);
    try {
      await admin.decideAction(action.id, { approve, ...change });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not record that.');
    } finally {
      setBusy(null);
    }
  }

  if (!actions && !error) return <p className="muted">Loading…</p>;
  const pending = (actions ?? []).filter((entry) => entry.status === 'pending');
  const done = (actions ?? []).filter((entry) => entry.status !== 'pending');

  return (
    <div className="stack">
      <p className="faint">
        Alert banners and XP deductions a community manager decided, waiting for Figmark. Everything else in a final
        decision - removing content, warnings in the feed, flags and rating cuts - has already been carried out.
      </p>
      {error && <p className="notice notice--error">{error}</p>}
      {pending.length === 0 && <p className="muted">Nothing waiting.</p>}
      {pending.map((action) => (
        <ApprovalCard key={action.id} action={action} busy={busy === action.id} onDecide={decide} />
      ))}
      {done.length > 0 && (
        <div className="card">
          {done.slice(0, 50).map((action) => (
            <div key={action.id} className="userrow" style={{ cursor: 'default' }}>
              <div className="userrow__main">
                <span className="userrow__name">{SANCTION_LABELS[action.sanction.kind]} · {action.targetName}</span>
                <span className="userrow__meta">{action.decidedBy} · {action.decidedAt ? timeAgo(action.decidedAt) : ''}{action.note ? ` · ${action.note}` : ''}</span>
              </div>
              <div className="userrow__tags">
                <span className={`badge badge--${action.status === 'approved' ? 'ok' : 'warn'}`}>{action.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({ action, busy, onDecide }: {
  action: PendingAction;
  busy: boolean;
  onDecide: (action: PendingAction, approve: boolean, change: { days?: number; severity?: 'light' | 'severe' }) => Promise<void>;
}) {
  const [days, setDays] = useState(String(action.sanction.days ?? 7));
  const [severity, setSeverity] = useState<'light' | 'severe'>(action.sanction.severity ?? 'light');
  const banner = action.sanction.kind === 'alert_banner';
  const change = banner ? { days: Number(days) } : { severity };

  return (
    <div className="card card--pad stack">
      <span className="card__title">{SANCTION_LABELS[action.sanction.kind]} · {action.targetName}</span>
      <p className="faint" style={{ margin: 0 }}>
        Decided by {action.managerName} {timeAgo(action.createdAt)} ·{' '}
        <a href={`/dispute/${action.disputeId}`} target="_blank" rel="noreferrer">read the dispute</a>
      </p>
      {action.sanction.message && <p style={{ margin: 0 }}>“{action.sanction.message}”</p>}
      {banner ? (
        <label className="field">
          <span>Show for (days)</span>
          <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} style={{ maxWidth: 120 }} />
        </label>
      ) : (
        <label className="field">
          <span>Severity</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value as 'light' | 'severe')} style={{ maxWidth: 220 }}>
            <option value="light">Light (−{XP_PENALTY.light} XP)</option>
            <option value="severe">Severe (−{XP_PENALTY.severe} XP)</option>
          </select>
        </label>
      )}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy} onClick={() => void onDecide(action, true, change)}>Approve</button>
        <button className="btn btn--quiet" disabled={busy} onClick={() => void onDecide(action, false, {})}>Reject</button>
      </div>
    </div>
  );
}
