import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DISPUTE_OUTCOMES,
  DISPUTE_OUTCOME_LABELS,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
} from '@shared/enums';
import { ApiRequestError, api, type EscrowHolding } from '../api';
import { EmptyState, ErrorNotice, Modal } from '../components/ui';
import { formatMoney, timeAgo } from '../format';

/**
 * What an escrow is holding, and what is waiting on them.
 *
 * Their whole job on one screen. The money in their name at the top, because
 * that is the number they are accountable for; then the arguments, because
 * those are the only part that needs them to do anything.
 */
export function EscrowPage() {
  const [data, setData] = useState<{ heldMinor: number; holdings: EscrowHolding[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<EscrowHolding | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.escrowHoldings());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your holdings.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <main className="page tab-view"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  const waiting = data.holdings.filter((row) => row.decidable);
  const currency = data.holdings[0]?.order.currency ?? 'INR';

  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>Escrow</h1>
          <p className="muted">Payments in your name, and the ones that need a decision.</p>
        </div>
      </div>

      <div className="card card--pad stack" style={{ marginBottom: 18 }}>
        <div className="tiles tiles--big">
          <Tile value={formatMoney(data.heldMinor, currency)} label="Holding" />
          <Tile value={String(waiting.length)} label="Need you" />
        </div>
      </div>

      {data.holdings.length === 0 ? (
        <EmptyState title="Nothing in your name yet">
          Buyers choose an escrow at checkout. Anything they pick you for lands here.
        </EmptyState>
      ) : (
        <div className="stack">
          {data.holdings.map((row) => (
            <article key={row.order.id} className="card card--pad stack">
              <div className="row row--between">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{row.order.itemName}</div>
                  <span className="faint">{row.buyerName} → {row.sellerName}</span>
                </div>
                <span className="badge badge--accent">
                  {formatMoney(row.order.escrow.amountMinor, row.order.currency)}
                </span>
              </div>

              <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className={`badge badge--${row.order.escrow.state === 'disputed' ? 'warn' : ''}`}>
                  {row.order.escrow.state}
                </span>
                {row.dispute && (
                  <span className="badge">{DISPUTE_STATUS_LABELS[row.dispute.status]}</span>
                )}
              </div>

              {row.dispute && (
                <>
                  <p className="muted" style={{ margin: 0 }}>
                    {DISPUTE_REASON_LABELS[row.dispute.reasonCode]} — raised by the{' '}
                    {row.dispute.raisedSide} {timeAgo(row.dispute.createdAt)}
                  </p>
                  {row.dispute.resolution ? (
                    <p className="faint">
                      {DISPUTE_OUTCOME_LABELS[row.dispute.resolution.outcome]} ·{' '}
                      {formatMoney(row.dispute.resolution.refundMinor, row.order.currency)} to the buyer
                    </p>
                  ) : row.decidable ? (
                    <button className="btn" style={{ justifySelf: 'start' }} onClick={() => setDeciding(row)}>
                      Settle it
                    </button>
                  ) : (
                    <p className="faint">
                      The two of them are still working on it. You step in if they cannot, or when the
                      response window runs out.
                    </p>
                  )}
                  <Link to={`/dispute/${row.dispute.id}`} className="btn btn--quiet btn--sm"
                    style={{ justifySelf: 'start' }}>
                    Read the thread
                  </Link>
                </>
              )}
            </article>
          ))}
        </div>
      )}

      {deciding && (
        <SettleDialog holding={deciding} onClose={() => setDeciding(null)} onDone={async () => {
          setDeciding(null);
          await load();
        }} />
      )}
    </main>
  );
}

/**
 * The decision, with the money it moves spelled out.
 *
 * The reasoning is required because both parties read it: a ruling nobody can
 * see the thinking behind is indistinguishable from an arbitrary one, and the
 * escrow was chosen precisely to be somebody whose thinking counts.
 */
function SettleDialog({ holding, onClose, onDone }: {
  holding: EscrowHolding;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [outcome, setOutcome] = useState('refund_buyer');
  const [refund, setRefund] = useState(String(holding.order.escrow.amountMinor / 100));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const held = holding.order.escrow.amountMinor;
  const currency = holding.order.currency;
  const refundMinor = outcome === 'split' ? Math.round(Number(refund) * 100) : 0;

  async function settle() {
    setBusy(true);
    setError(null);
    try {
      await api.disputeSettle(holding.dispute!.id, { outcome, refundMinor, note: note.trim() });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not settle that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Settle this dispute" onClose={onClose}>
      <p className="faint" style={{ marginTop: 0 }}>
        You are holding {formatMoney(held, currency)} for {holding.order.itemName}.
      </p>

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
          <span>Back to {holding.buyerName}</span>
          <input value={refund} onChange={(event) => setRefund(event.target.value)} inputMode="decimal" />
          <span className="field__hint">Between nothing and {formatMoney(held, currency)}.</span>
        </label>
      )}

      <label className="field">
        <span>Reasoning</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3}
          placeholder="Why this way. Both of them read it." />
      </label>

      {error && <ErrorNotice message={error} />}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={busy || note.trim().length < 4} onClick={settle}>
          {busy ? 'Settling…' : 'Move the money'}
        </button>
      </div>
    </Modal>
  );
}

/** A number under a word. Local because the shop console's lives with the shop. */
function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="tile">
      <div className="tile__value" style={{ fontSize: 'var(--t-lg)' }}>{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}
