import { useCallback, useEffect, useState } from 'react';
import { DISPUTE_STATUS_LABELS } from '@shared/enums';
import { DISPUTE_SUBJECT_LABELS, DISPUTE_TOPIC_LABELS } from '@shared/disputes';
import { ApiRequestError, admin, type AdminDisputeRow } from './api';
import { formatDate, formatMoney, timeAgo } from '../format';

/**
 * Every dispute, for oversight.
 *
 * Community managers decide disputes; Figmark does not. What an operator
 * watches here is the clock: a manager past their deadline comes first, to be
 * reassigned - and if nobody reassigns it within two days, the system does,
 * to whoever is available. Everything else is here to be read.
 */
export function DisputesView() {
  const [rows, setRows] = useState<AdminDisputeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'overdue' | 'all'>('open');

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await admin.disputes()).disputes);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the disputes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reassign(id: string) {
    setBusy(id);
    setError(null);
    try {
      await admin.reassign(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reassign that.');
    } finally {
      setBusy(null);
    }
  }

  if (!rows && !error) return <p className="muted">Loading…</p>;
  const all = rows ?? [];
  const closed = (row: AdminDisputeRow) => row.dispute.status === 'resolved' || row.dispute.status === 'withdrawn';
  const overdue = all.filter((row) => row.overdue);
  const shown = filter === 'overdue' ? overdue : filter === 'open' ? all.filter((row) => !closed(row)) : all;

  return (
    <div className="stack">
      <p className="faint">
        {all.filter((row) => !closed(row)).length} open · {overdue.length} past their manager's deadline. Community managers
        decide every round; reassign a round whose manager has gone quiet.
      </p>
      <div className="tabs">
        {(['open', 'overdue', 'all'] as const).map((entry) => (
          <button key={entry} className={`tab${filter === entry ? ' is-on' : ''}`} onClick={() => setFilter(entry)}>
            {entry === 'open' ? 'Open' : entry === 'overdue' ? `Overdue ${overdue.length}` : 'All'}
          </button>
        ))}
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      {shown.length === 0 ? <p className="muted">Nothing here.</p> : (
        <div className="card">
          {shown.map((row) => {
            const { dispute } = row;
            const about = dispute.subjectRef ? DISPUTE_SUBJECT_LABELS[dispute.subjectRef.type] : DISPUTE_TOPIC_LABELS[dispute.topic ?? 'escrow'];
            return (
              <div key={dispute.id} className="userrow" style={{ cursor: 'default' }}>
                <div className="userrow__main">
                  <span className="userrow__name">{about} · {row.itemName}</span>
                  <span className="userrow__meta">
                    {row.raiser?.name ?? 'someone'} v {row.respondent?.name ?? 'someone'} · {timeAgo(dispute.updatedAt)}
                  </span>
                  {row.round && !closed(row) && (
                    <span className="userrow__meta">
                      Round {row.round.n}/3 · {row.round.managerName} · {row.round.decided ? 'decided, escalation window open' : `decide by ${formatDate(row.round.decideBy)}`}
                    </span>
                  )}
                  {dispute.result && (
                    <span className="userrow__meta">
                      {dispute.result.how === 'settled' ? 'Settled between the parties'
                        : dispute.result.how === 'withdrawn' ? 'Withdrawn'
                        : `Final after round ${dispute.result.finalRound}: ${dispute.result.winnerId === dispute.raisedBy ? row.raiser?.name : row.respondent?.name} won`}
                    </span>
                  )}
                </div>
                <div className="userrow__tags">
                  {row.heldMinor > 0 && !dispute.subjectRef && <span className="badge">{formatMoney(row.heldMinor, row.currency)}</span>}
                  {row.overdue && <span className="badge badge--warn">overdue</span>}
                  <span className="badge">{dispute.result?.how === 'settled' ? 'Settled' : DISPUTE_STATUS_LABELS[dispute.status]}</span>
                  {!closed(row) && row.round && !row.round.decided && (
                    <button className="btn btn--sm btn--ghost" disabled={busy !== null} onClick={() => void reassign(dispute.id)}>
                      {busy === dispute.id ? 'Reassigning…' : 'Reassign'}
                    </button>
                  )}
                  <a className="btn btn--sm btn--quiet" href={`/dispute/${dispute.id}`} target="_blank" rel="noreferrer">Thread</a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
