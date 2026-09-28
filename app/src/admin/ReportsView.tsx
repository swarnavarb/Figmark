import { useCallback, useEffect, useState } from 'react';
import {
  DECISIONS_FOR, DECISION_LABELS, REPORT_TARGET_LABELS, type ContentReport, type ReportDecision,
} from '@shared/moderation';
import { ApiRequestError, admin } from './api';
import { timeAgo } from '../format';

type Row = ContentReport & { authorName: string };

/**
 * Disputed reviews and comments, and authors asking for their own to be
 * validated - one queue, open ones first.
 *
 * A dispute is answered Kept or Removed. A validation request is answered
 * Validated (the review or comment shows a mark saying Figmark checked it)
 * or Not validated (it stays up, unmarked).
 */
export function ReportsView() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await admin.reports()).reports);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the reports.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="notice notice--error">{error}</p>;
  if (!rows) return <p className="muted">Loading…</p>;

  const open = rows.filter((row) => row.status === 'open');
  const done = rows.filter((row) => row.status !== 'open');

  return (
    <div className="stack">
      <p className="faint">
        {open.length} waiting · {done.length} decided
      </p>
      {open.length === 0 && <p className="muted">Nothing waiting. Nobody has disputed a review or comment.</p>}
      {open.map((row) => <ReportCard key={row.id} row={row} onDone={load} />)}
      {done.length > 0 && (
        <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }}
          onClick={() => setShowDone((now) => !now)}>
          {showDone ? 'Hide decided' : `Show decided (${done.length})`}
        </button>
      )}
      {showDone && done.map((row) => <ReportCard key={row.id} row={row} onDone={load} />)}
    </div>
  );
}

function ReportCard({ row, onDone }: { row: Row; onDone: () => void | Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<ReportDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: ReportDecision) {
    setBusy(decision);
    setError(null);
    try {
      await admin.resolveReport(row.id, { decision, note: note.trim() });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that decision.');
    } finally {
      setBusy(null);
    }
  }

  const isOpen = row.status === 'open';
  return (
    <div className="card card--pad stack">
      <div className="row row--between">
        <b>
          {row.kind === 'validate' ? '✅ Validation request' : '⚠️ Dispute'} · {REPORT_TARGET_LABELS[row.targetType]}
        </b>
        <span className={`badge badge--${isOpen ? 'warn' : row.status === 'removed' ? 'danger' : 'ok'}`}>
          {isOpen ? 'Open' : DECISION_LABELS[row.status as ReportDecision]}
        </span>
      </div>
      <blockquote className="notice" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{row.excerpt}</blockquote>
      <span className="faint">
        Written by {row.authorName} · {row.kind === 'validate' ? 'asked by its author' : `disputed by ${row.reporterName}`}
        {' · '}{timeAgo(row.createdAt)}
      </span>
      <p style={{ margin: 0 }}><b>Why:</b> {row.reason}</p>
      <span className="faint">Where: {row.targetType} {row.targetId} on {row.parentId}</span>

      {isOpen ? (
        <>
          <label className="field">
            <span>Note to the people involved (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          {error && <p className="notice notice--error">{error}</p>}
          <div className="row">
            {DECISIONS_FOR[row.kind].map((decision) => (
              <button key={decision} type="button" disabled={busy !== null}
                className={`btn btn--sm${decision === 'removed' ? ' btn--danger' : decision === 'kept' || decision === 'declined' ? ' btn--quiet' : ''}`}
                onClick={() => void decide(decision)}>
                {busy === decision ? 'Saving…' : DECISION_LABELS[decision]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <span className="faint">
          Decided {row.resolvedAt ? timeAgo(row.resolvedAt) : ''}{row.resolvedBy ? ` by ${row.resolvedBy}` : ''}
          {row.resolutionNote ? ` · “${row.resolutionNote}”` : ''}
        </span>
      )}
    </div>
  );
}
