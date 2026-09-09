import { useCallback, useEffect, useState } from 'react';
import {
  DISPUTE_OUTCOMES,
  DISPUTE_OUTCOME_LABELS,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
} from '@shared/enums';
import { ApiRequestError, admin, type AdminDisputeRow } from './api';
import { Confirm } from './Confirm';
import { formatMoney, timeAgo } from '../format';

/**
 * The mediation queue.
 *
 * Escalated first, because those are the ones actually waiting on a decision;
 * everything else is here to be read. A dispute the two sides are still working
 * between themselves is not the company's to touch, and putting it in the same
 * pile as the ones that are makes the queue meaningless.
 */
export function DisputesView() {
  const [rows, setRows] = useState<AdminDisputeRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await admin.disputes()).disputes);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the disputes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="notice notice--error">{error}</p>;
  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <p className="muted">Nothing is in dispute.</p>;

  const open = rows.find((row) => row.dispute.id === openId);
  if (open) return <DisputeDetail row={open} onClose={() => { setOpenId(null); void load(); }} />;

  const waiting = rows.filter((row) => row.dispute.status === 'under_mediation');

  return (
    <div className="stack">
      <p className="faint">
        {waiting.length} waiting on Figmark, {rows.length - waiting.length} being handled between the
        parties.
      </p>
      <div className="card">
        {rows.map((row) => (
          <button key={row.dispute.id} type="button" className="userrow"
            onClick={() => setOpenId(row.dispute.id)}>
            <div className="userrow__main">
              <span className="userrow__name">{row.itemName}</span>
              <span className="userrow__meta">
                {DISPUTE_REASON_LABELS[row.dispute.reasonCode]} ·{' '}
                {row.buyer?.name ?? 'buyer'} v {row.seller?.name ?? 'seller'} ·{' '}
                {timeAgo(row.dispute.updatedAt)}
              </span>
            </div>
            <div className="userrow__tags">
              <span className="badge">{formatMoney(row.heldMinor, row.currency)}</span>
              <span className={`badge badge--${row.dispute.status === 'under_mediation' ? 'warn' : ''}`}>
                {DISPUTE_STATUS_LABELS[row.dispute.status]}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One dispute, with everything a decision needs on the same screen.
 *
 * The whole thread, both parties' records, and what is actually held. A
 * mediator deciding from a summary is deciding from somebody else's reading of
 * it, so nothing here is summarised.
 */
function DisputeDetail({ row, onClose }: { row: AdminDisputeRow; onClose: () => void }) {
  const { dispute } = row;
  const [outcome, setOutcome] = useState<string>('refund_buyer');
  const [refund, setRefund] = useState(String(row.heldMinor / 100));
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settled = Boolean(dispute.resolvedAt);
  const refundMinor = outcome === 'split' ? Math.round(Number(refund) * 100) : 0;

  async function resolve() {
    setBusy(true);
    setError(null);
    try {
      await admin.resolve(dispute.id, { outcome, refundMinor, note: note.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not settle that.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <button className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={onClose}>
        ← All disputes
      </button>

      <div className="card card--pad stack">
        <div className="row row--between">
          <div>
            <h2 style={{ margin: 0 }}>{row.itemName}</h2>
            <span className="faint">{DISPUTE_REASON_LABELS[dispute.reasonCode]}</span>
          </div>
          <span className="badge badge--warn">{DISPUTE_STATUS_LABELS[dispute.status]}</span>
        </div>

        <dl style={{ margin: 0 }}>
          <div className="kv"><dt>Held</dt><dd>{formatMoney(row.heldMinor, row.currency)}</dd></div>
          <div className="kv">
            <dt>Protection fee</dt>
            <dd>{formatMoney(row.protectionFeeMinor, row.currency)}</dd>
          </div>
          <div className="kv">
            <dt>Raised by</dt>
            <dd>{dispute.raisedSide === 'buyer' ? row.buyer?.name : row.seller?.name} ({dispute.raisedSide})</dd>
          </div>
        </dl>

        {/* Both records, side by side. Somebody with nine clean sales and one
            complaint is a different case from somebody with three of each, and
            that context should not need a second screen. */}
        <div className="field-row">
          <div>
            <span className="faint">Buyer — {row.buyer?.name}</span>
            <div style={{ fontSize: 'var(--t-sm)' }}>
              {row.buyer?.trust.completedTransactions ?? 0} completed ·{' '}
              {row.buyer?.trust.disputesLost ?? 0} disputes lost
            </div>
          </div>
          <div>
            <span className="faint">Seller — {row.seller?.name}</span>
            <div style={{ fontSize: 'var(--t-sm)' }}>
              {row.seller?.trust.completedTransactions ?? 0} completed ·{' '}
              {row.seller?.trust.disputesLost ?? 0} disputes lost
            </div>
          </div>
        </div>
      </div>

      {dispute.offer && !settled && (
        <p className="notice notice--info">
          There is an offer on the table: {formatMoney(dispute.offer.refundMinor, row.currency)} back to
          the buyer. {dispute.offer.note}
        </p>
      )}

      <div className="stack">
        {dispute.messages.map((message) => (
          <article key={message.id} className="card card--pad stack">
            <div className="row row--between">
              <span className="userrow__name">
                {message.authorRole === 'buyer' ? row.buyer?.name
                  : message.authorRole === 'seller' ? row.seller?.name
                  : 'Figmark'}
                <span className="faint"> · {message.authorRole}</span>
              </span>
              <span className="faint">{timeAgo(message.createdAt)}</span>
            </div>
            {message.body && <p style={{ margin: 0, fontSize: 'var(--t-sm)' }}>{message.body}</p>}
            {message.evidence.length > 0 && (
              <div className="evidence">
                {message.evidence.map((item, index) => (
                  <a key={index} href={item.url ?? '#'} target="_blank" rel="noreferrer noopener"
                    className="evidence__item">
                    {item.url && <img src={item.url} alt={item.caption || 'Evidence'} loading="lazy" />}
                    <span className="faint">{item.caption || 'Photo'}</span>
                  </a>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      {settled ? (
        <div className="card card--pad stack">
          <span className="card__title">Settled</span>
          <p className="muted">
            {DISPUTE_OUTCOME_LABELS[dispute.resolution?.outcome ?? 'withdrawn']} ·{' '}
            {formatMoney(dispute.resolution?.refundMinor ?? 0, row.currency)} back to the buyer
          </p>
          <p className="faint">{dispute.resolutionNote}</p>
        </div>
      ) : (
        <div className="card card--pad stack">
          <span className="card__title">Decide</span>
          <label className="field">
            <span>Outcome</span>
            <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
              {DISPUTE_OUTCOMES.filter((entry) => entry !== 'withdrawn').map((entry) => (
                <option key={entry} value={entry}>{DISPUTE_OUTCOME_LABELS[entry]}</option>
              ))}
            </select>
          </label>

          {outcome === 'split' && (
            <label className="field">
              <span>Back to the buyer</span>
              <input value={refund} onChange={(event) => setRefund(event.target.value)} inputMode="decimal" />
              <span className="field__hint">
                Between nothing and {formatMoney(row.heldMinor, row.currency)}.
              </span>
            </label>
          )}

          <label className="field">
            <span>Reasoning</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3}
              placeholder="Why this way. Both parties read it." />
            <span className="field__hint">
              A ruling nobody can see the reasoning for is indistinguishable from an arbitrary one.
            </span>
          </label>

          {error && <p className="notice notice--error">{error}</p>}

          <button className="btn btn--danger" style={{ justifySelf: 'start' }}
            disabled={note.trim().length < 4} onClick={() => setConfirming(true)}>
            Settle this dispute
          </button>
        </div>
      )}

      {confirming && (
        <Confirm
          title="Settle this dispute?"
          confirmLabel="Settle"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={resolve}
        >
          <p>{DISPUTE_OUTCOME_LABELS[outcome as keyof typeof DISPUTE_OUTCOME_LABELS]}.</p>
          <p>
            {outcome === 'refund_buyer' && `${formatMoney(row.heldMinor, row.currency)} goes back to ${row.buyer?.name}, and the protection fee with it.`}
            {outcome === 'release_seller' && `${formatMoney(row.heldMinor, row.currency)} goes to ${row.seller?.name}. The fee is kept.`}
            {outcome === 'split' && `${formatMoney(refundMinor, row.currency)} back to ${row.buyer?.name}, the rest to ${row.seller?.name}. The fee is kept.`}
          </p>
          {outcome !== 'split' && (
            <p className="faint">
              A one-sided finding counts against the losing party's record.
            </p>
          )}
          <p className="notice notice--warn" style={{ margin: 0 }}>
            This moves the money and cannot be undone.
          </p>
        </Confirm>
      )}
    </div>
  );
}
