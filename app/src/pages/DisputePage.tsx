import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DISPUTE_OUTCOME_LABELS, DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS } from '@shared/enums';
import { RESPONSE_DAYS } from '@shared/disputes';
import { ApiRequestError, api, type DisputeView, type EvidenceDraft, type PartyRef } from '../api';
import { Avatar, ErrorNotice, Icon, PersonLink } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import { EvidenceFields } from './OrderPage';

/**
 * One dispute, worked by whichever side is reading it.
 *
 * Deliberately one screen for both parties rather than a buyer view and a
 * seller view. Everything either of them writes, the other reads: a dispute
 * settled on evidence one side never saw is not settled, it is imposed. So the
 * thread is the page, and the actions sit under it.
 */
export function DisputePage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<DisputeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.dispute(id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not open this dispute.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <main className="page tab-view"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  const { dispute, order, side, actions, parties } = data;
  const held = order.escrow.amountMinor;
  const them = side === 'buyer' ? parties.seller : parties.buyer;

  return (
    <main className="page tab-view">
      <Link to={`/order/${order.id}`} className="btn btn--quiet" style={{ marginBottom: 14 }}>
        <Icon name="back" size={14} /> {order.itemName}
      </Link>

      <div className="page__head">
        <div>
          <h1>Dispute</h1>
          <p className="muted">
            {DISPUTE_REASON_LABELS[dispute.reasonCode]} · with <PersonLink party={them} />
          </p>
        </div>
        <span className={`badge badge--${dispute.status === 'resolved' ? 'ok' : 'warn'}`}>
          {DISPUTE_STATUS_LABELS[dispute.status]}
        </span>
      </div>

      {/* The money is the subject, so it is stated once at the top rather than
          left to be inferred from the order behind it. */}
      <div className="card card--pad stack" style={{ marginBottom: 16 }}>
        <div className="kv">
          <dt>Held</dt>
          <dd>{formatMoney(held, order.currency)}</dd>
        </div>
        {order.protection && (
          <div className="kv">
            <dt>Protection fee paid</dt>
            <dd>{formatMoney(order.protection.feeMinor, order.currency)}</dd>
          </div>
        )}
        {dispute.resolution && (
          <>
            <div className="kv">
              <dt>Outcome</dt>
              <dd>{DISPUTE_OUTCOME_LABELS[dispute.resolution.outcome]}</dd>
            </div>
            <div className="kv">
              <dt>Back to the buyer</dt>
              <dd>{formatMoney(dispute.resolution.refundMinor, order.currency)}</dd>
            </div>
            <p className="faint">
              {dispute.resolution.byCompany ? 'Settled by Figmark' : 'Agreed between both sides'} ·{' '}
              {dispute.resolution.note}
            </p>
          </>
        )}
        {data.overdue && !dispute.resolvedAt && (
          <p className="notice notice--warn">
            <PersonLink party={them} /> has had {RESPONSE_DAYS} days to answer. You can ask Figmark to settle it.
          </p>
        )}
      </div>

      {/* The offer on the table, if there is one. Above the thread because it
          is the thing to act on, not the thing to read. */}
      {dispute.offer && !dispute.resolvedAt && (
        <div className="card card--pad stack" style={{ marginBottom: 16, borderColor: 'var(--accent-line)' }}>
          <span className="card__title">
            {dispute.offer.fromUserId === (side === 'buyer' ? order.buyerId : order.sellerId)
              ? 'Your offer'
              : `${them} offered to settle`}
          </span>
          <div className="kv">
            <dt>Back to the buyer</dt>
            <dd>{formatMoney(dispute.offer.refundMinor, order.currency)}</dd>
          </div>
          {dispute.offer.note && <p className="muted">{dispute.offer.note}</p>}
          {actions.includes('accept') && (
            <AcceptButton id={dispute.id} onDone={load} />
          )}
        </div>
      )}

      <div className="stack">
        {dispute.messages.map((message) => {
          const mine = message.authorId === (side === 'buyer' ? order.buyerId : order.sellerId);
          // The company speaks as itself and has no page; the two parties do.
          const who: PartyRef | null =
            message.authorRole === 'company' ? null
              : message.authorRole === 'buyer' ? parties.buyer
              : parties.seller;
          const label = who?.name ?? 'Figmark';
          return (
            <article key={message.id} className={`card card--pad post${mine ? ' post--mine' : ''}`}>
              <div className="post__head">
                <Avatar name={label} size={32} />
                <div className="post__who">
                  <span className="post__name">
                    {who ? <PersonLink party={who} /> : label}{mine && ' (you)'}
                  </span>
                  <span className="faint">{timeAgo(message.createdAt)}</span>
                </div>
              </div>
              {message.body && <p className="post__body">{message.body}</p>}
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
          );
        })}
      </div>

      {actions.length > 0 && (
        <DisputeActions view={data} onDone={load} />
      )}

      {dispute.status === 'under_mediation' && (
        <p className="notice notice--info" style={{ marginTop: 16 }}>
          Figmark is reading this. You can still add to the thread — anything you post here is what the
          decision gets made on.
        </p>
      )}
    </main>
  );
}

function AcceptButton({ id, onDone }: { id: string; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button className="btn" style={{ justifySelf: 'start' }} disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void api
            .disputeAccept(id)
            .then(onDone)
            .catch((err: unknown) =>
              setError(err instanceof ApiRequestError ? err.message : 'Could not accept that.'),
            )
            .finally(() => setBusy(false));
        }}>
        {busy ? 'Settling…' : 'Accept and settle'}
      </button>
      {error && <ErrorNotice message={error} />}
    </>
  );
}

/**
 * Reply, offer, withdraw, escalate.
 *
 * The order is deliberate: talking first, settling between yourselves second,
 * and involving the company last. Escalation only appears once the other side
 * has actually had their days, because "ask Figmark" as an opening move makes
 * the company the first port of call for every disagreement.
 */
function DisputeActions({ view, onDone }: { view: DisputeView; onDone: () => Promise<void> }) {
  const { dispute, order, actions } = view;
  const [body, setBody] = useState('');
  const [evidence, setEvidence] = useState<EvidenceDraft[]>([]);
  const [offering, setOffering] = useState(false);
  const [refund, setRefund] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const held = order.escrow.amountMinor;

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onDone();
      setBody('');
      setEvidence([]);
      setOffering(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function reply(event: FormEvent) {
    event.preventDefault();
    await run('reply', () =>
      api.disputeReply(dispute.id, body.trim(), evidence.filter((item) => item.url.trim())),
    );
  }

  return (
    <div className="card card--pad stack" style={{ marginTop: 16 }}>
      {actions.includes('reply') && (
        <form className="form" onSubmit={reply}>
          <label className="field">
            <span>Add to the thread</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
              placeholder="Answer, or add what you have." />
          </label>
          <EvidenceFields evidence={evidence} onChange={setEvidence} />
          <button type="submit" className="btn" style={{ justifySelf: 'start' }}
            disabled={busy !== null || (body.trim().length === 0 && evidence.length === 0)}>
            {busy === 'reply' ? 'Posting…' : 'Post'}
          </button>
        </form>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        {actions.includes('offer') && !offering && (
          <button className="btn btn--ghost" onClick={() => setOffering(true)}>Offer a settlement</button>
        )}
        {actions.includes('withdraw') && (
          <button className="btn btn--quiet" disabled={busy !== null}
            onClick={() => void run('withdraw', () => api.disputeWithdraw(dispute.id))}>
            {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw this'}
          </button>
        )}
        {actions.includes('escalate') && (
          <button className="btn btn--quiet" disabled={busy !== null}
            onClick={() => void run('escalate', () => api.disputeEscalate(dispute.id))}>
            {busy === 'escalate' ? 'Sending…' : 'Ask Figmark to settle it'}
          </button>
        )}
      </div>

      {offering && (
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            const minor = Math.round(Number(refund) * 100);
            void run('offer', () => api.disputeOffer(dispute.id, minor, note.trim()));
          }}
        >
          <label className="field">
            <span>Back to the buyer</span>
            <input value={refund} onChange={(e) => setRefund(e.target.value)} inputMode="decimal"
              placeholder={String(held / 100)} autoFocus />
            <span className="field__hint">
              Between nothing and {formatMoney(held, order.currency)}. Nothing means the seller keeps it
              all; the full amount is a complete refund.
            </span>
          </label>
          <label className="field">
            <span>Why</span>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Half back for the damage, keep the item." />
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={busy !== null || refund.trim() === ''}>
              {busy === 'offer' ? 'Offering…' : 'Make offer'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setOffering(false)}>Cancel</button>
          </div>
        </form>
      )}

      {error && <ErrorNotice message={error} />}
    </div>
  );
}
