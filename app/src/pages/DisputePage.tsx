import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ManagerMark } from '../components/ManagerBadge';
import { DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS } from '@shared/enums';
import {
  DISPUTE_SUBJECT_LABELS, DISPUTE_TOPIC_LABELS, MAX_ROUNDS, NEEDS_ADMIN, SANCTION_LABELS, XP_PENALTY, releaseDueAt,
} from '@shared/disputes';
import type { DisputeRound, DisputeSanction, DisputeSanctionKind } from '@shared/models';
import { ApiRequestError, api, type DisputeView, type EvidenceDraft, type ForumRow } from '../api';
import { ScreenshotPicker } from '../components/DisputeFlows';
import { Avatar, ErrorNotice, Icon, useConfirm } from '../components/ui';
import { formatDateOrdinal, formatMoney, timeAgo } from '../format';

/**
 * One dispute: a three-way thread between the person who raised it, the
 * person it is against, and the community manager deciding the current round.
 *
 * Everything any of them writes, the others read - a decision made on
 * evidence one side never saw is imposed, not decided. Above the thread is
 * what is at stake and where it stands round by round; below it, what this
 * viewer can do now.
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

  const { dispute, order, parties, role } = data;
  const rounds = dispute.rounds ?? [];
  const current = rounds[rounds.length - 1] ?? null;
  const about = dispute.subjectRef
    ? DISPUTE_SUBJECT_LABELS[dispute.subjectRef.type]
    : data.holdsMoney ? DISPUTE_REASON_LABELS[dispute.reasonCode] : DISPUTE_TOPIC_LABELS[dispute.topic ?? 'general'];
  const back = order
    ? { to: `/order/${order.id}`, label: order.itemName }
    : { to: '/disputes', label: 'My disputes' };
  const nameOf = (userId: string) =>
    userId === parties.raiser.id ? parties.raiser.name
      : userId === parties.respondent.id ? parties.respondent.name
      : rounds.find((round) => round.managerId === userId)?.managerName
        ?? rounds.flatMap((round) => round.reassigned ?? []).find((entry) => entry.fromId === userId)?.fromName
        ?? 'Figmark';
  const me = role === 'raiser' ? parties.raiser.id : role === 'respondent' ? parties.respondent.id : null;

  return (
    <main className="page tab-view">
      <Link to={back.to} className="btn btn--quiet" style={{ marginBottom: 14 }}>
        <Icon name="back" size={14} /> {back.label}
      </Link>

      <div className="page__head dhead">
        <div style={{ minWidth: 0 }}>
          <span className="dhead__kicker">⚖️ Dispute · {about}</span>
          <h1 className="dhead__title">
            {parties.raiser.name}<ManagerMark id={parties.raiser.id} /> <span className="faint">vs</span> {parties.respondent.name}<ManagerMark id={parties.respondent.id} />
          </h1>
        </div>
        <span className={`badge badge--${dispute.status === 'resolved' ? 'ok' : dispute.status === 'withdrawn' ? '' : 'warn'}`}>
          {dispute.result?.how === 'settled' ? 'Settled' : DISPUTE_STATUS_LABELS[dispute.status]}
        </span>
      </div>

      <Progress view={data} />
      <Outcome view={data} />

      <div className="card card--pad stack" style={{ marginBottom: 16 }}>
        {dispute.subjectRef && (
          <blockquote className="dthread__quote">
            “{dispute.subjectRef.excerpt}”
            {dispute.subjectRef.link && <> · <Link to={dispute.subjectRef.link}>View it ↗</Link></>}
          </blockquote>
        )}
        {data.holdsMoney && data.heldMinor !== null && (
          <div className="kv">
            <dt>Held by Figmark</dt>
            <dd>{formatMoney(data.heldMinor, data.currency)}</dd>
          </div>
        )}
        {order && !data.holdsMoney && (
          <p className="faint" style={{ margin: 0 }}>
            This purchase was paid without buyer protection, or its protection has ended, so Figmark is not holding
            the money. A decision here can flag and warn, but cannot move it.
          </p>
        )}
        {current && !dispute.resolvedAt && (
          <div className="kv">
            <dt>Round {current.n} of {MAX_ROUNDS}</dt>
            <dd>{current.managerName}<ManagerMark id={current.managerId} /> decides by {formatDateOrdinal(current.decideBy)}</dd>
          </div>
        )}
        {data.overdue && !dispute.resolvedAt && (
          <p className="notice notice--warn" style={{ margin: 0 }}>
            The community manager is past their deadline. Figmark has been asked to reassign it, and if nobody does
            within two days it moves to another manager automatically.
          </p>
        )}
        <Rounds rounds={rounds} currency={data.currency} nameOf={nameOf} parties={parties} />
      </div>

      {dispute.offer && !dispute.resolvedAt && (
        <div className="card card--pad stack" style={{ marginBottom: 16, borderColor: 'var(--accent-line)' }}>
          <span className="card__title">
            {dispute.offer.fromUserId === me ? 'Your settlement offer' : `${nameOf(dispute.offer.fromUserId)} offered to settle`}
          </span>
          {data.holdsMoney && (
            <div className="kv">
              <dt>Back to the buyer</dt>
              <dd>{formatMoney(dispute.offer.refundMinor, data.currency)}</dd>
            </div>
          )}
          {(dispute.offer.terms || dispute.offer.note) && <p className="muted" style={{ margin: 0 }}>{dispute.offer.terms || dispute.offer.note}</p>}
          <p className="faint" style={{ margin: 0 }}>
            A settlement ends it with nobody winning or losing, and no community manager needs to confirm it.
          </p>
          {data.actions.includes('accept_settlement') && (
            <AcceptButton id={dispute.id} offerId={dispute.offer.id} onDone={load}
              summary={data.holdsMoney ? `${formatMoney(dispute.offer.refundMinor, data.currency)} back to the buyer, the rest to the seller` : (dispute.offer.terms || dispute.offer.note || 'the terms above')} />
          )}
        </div>
      )}

      <div className="stack">
        {dispute.messages.map((message) => {
          const mine = message.authorId === me || (role === 'manager' && message.authorId === current?.managerId);
          const label = message.authorRole === 'company' ? 'Figmark' : nameOf(message.authorId);
          const tag = message.authorRole === 'manager' ? 'Community manager'
            : message.authorId === parties.raiser.id ? 'Raised it'
            : message.authorId === parties.respondent.id ? 'Against' : null;
          if (message.authorRole === 'company') {
            return <p key={message.id} className="dnote"><span>{message.body}</span> <span className="faint">· {timeAgo(message.createdAt)}</span></p>;
          }
          return (
            <article key={message.id} className={`card card--pad post dmsg${mine ? ' post--mine' : ''}`}>
              <div className="post__head">
                <Avatar name={label} size={32} />
                <div className="post__who">
                  <span className="post__name">
                    {label}<ManagerMark id={message.authorId} />{mine && ' (you)'} {tag && <span className="badge">{tag}</span>}
                  </span>
                  <span className="faint">{timeAgo(message.createdAt)}</span>
                </div>
              </div>
              {message.body && <p className="post__body">{message.body}</p>}
              {message.evidence.length > 0 && (
                <div className="evidence">
                  {message.evidence.map((item, index) => {
                    // Only screenshots uploaded here are shown as pictures. An
                    // outside link stays a link, so opening the thread does not
                    // tell somebody else's server who is reading it.
                    const uploaded = Boolean(item.url && item.url.startsWith('/api/photos/'));
                    return (
                      <a key={index} href={item.url ?? '#'} target="_blank" rel="noreferrer noopener"
                        className={`evidence__item${uploaded ? '' : ' evidence__item--link'}`}>
                        {uploaded ? <img src={item.url!} alt={item.caption || 'Evidence'} loading="lazy" />
                          : <span className="evidence__host">🔗 {hostOf(item.url)}</span>}
                        <span className="faint">{item.caption || (uploaded ? 'Screenshot' : 'Outside link')}</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {role === 'manager' && !data.actions.includes('decide') && !dispute.resolvedAt && current && !current.decision && (
        <p className="notice notice--info" style={{ marginTop: 16 }}>
          You can decide once {parties.respondent.name} has answered, or when their response window runs out
          {dispute.respondByAt ? ` on ${formatDateOrdinal(dispute.respondByAt)}` : ''}.
        </p>
      )}
      {data.actions.length > 0 && <DisputeActions view={data} onDone={load} />}
    </main>
  );
}

/** How it ended, or how it stands, in one line at the top. */
function Outcome({ view }: { view: DisputeView }) {
  const { dispute, parties } = view;
  const result = dispute.result;
  if (!result) return null;
  const name = (userId: string | null) =>
    userId === parties.raiser.id ? parties.raiser.name : userId === parties.respondent.id ? parties.respondent.name : 'Nobody';
  return (
    <div className={`notice ${result.how === 'decided' ? 'notice--info' : ''}`} style={{ marginBottom: 16 }}>
      {result.how === 'decided' && (
        <>
          <b>Final: {name(result.winnerId)} won.</b> Round {result.finalRound}'s decision stands
          {dispute.release
            ? `. The held payment was released: ${formatMoney(dispute.release.toBuyerMinor, view.currency)} to the buyer, ${formatMoney(dispute.release.toSellerMinor, view.currency)} to the seller.`
            : view.holdsMoney
              ? `. The payment stays held until the community manager holding it releases it${releaseDueAt(dispute) ? ` - or Figmark releases it as decided on ${formatDateOrdinal(releaseDueAt(dispute)!)}` : ''}.`
              : '.'}
        </>
      )}
      {result.how === 'settled' && (
        <><b>Settled between the two of them.</b> Nobody won or lost.{result.terms ? ` Terms: ${result.terms}` : ''}</>
      )}
      {result.how === 'withdrawn' && (
        <><b>Withdrawn</b> by {parties.raiser.name}. It counts for nobody{view.holdsMoney ? ', and the payment is held again as before' : ''}.</>
      )}
    </div>
  );
}

/** Each round: who heard it, who paid, and what they decided. */
function Rounds({ rounds, currency, nameOf, parties }: {
  rounds: DisputeRound[];
  currency: string;
  nameOf: (id: string) => string;
  parties: { raiser: { name: string }; respondent: { name: string } };
}) {
  if (rounds.length === 0) return null;
  return (
    <ol className="drounds">
      {rounds.map((round) => (
        <li key={round.n} className={`drounds__item${round.decision ? ' is-decided' : ''}`}>
          <div className="drounds__head">
            <b>Round {round.n}</b>
            <span className="faint">
              {round.managerName}<ManagerMark id={round.managerId} />
              {round.assignedBy === 'protection' ? ' · holding the payment' : round.assignedBy === 'raiser' ? ' · chosen' : ' · assigned by availability'}
            </span>
          </div>
          <span className="faint">
            {round.payment
              ? `${round.n === 1 ? 'Raised' : 'Escalated'} by ${nameOf(round.payment.payerId)} · paid ${formatMoney(round.payment.amountMinor, round.payment.currency || currency)}`
              : 'Covered by buyer protection'}
          </span>
          {(round.reassigned ?? []).map((entry) => (
            <span key={entry.at} className="faint">Reassigned from {entry.fromName} {entry.by === 'system' ? 'automatically' : 'by Figmark'}</span>
          ))}
          {round.decision ? (
            <p className="drounds__decision">
              <b>In favour of {round.decision.favour === 'raiser' ? parties.raiser.name : parties.respondent.name}.</b>{' '}
              {round.decision.reasoning}
              {round.decision.refundMinor !== null && ` · ${formatMoney(round.decision.refundMinor, currency)} back to the buyer`}
            </p>
          ) : <span className="faint">Waiting for a decision.</span>}
        </li>
      ))}
    </ol>
  );
}

function AcceptButton({ id, offerId, summary, onDone }: {
  id: string; offerId?: string; summary: string; onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  return (
    <>
      {dialog}
      <button className="btn" style={{ justifySelf: 'start' }} disabled={busy}
        onClick={() => void (async () => {
          const sure = await confirm({
            title: 'Accept this settlement?',
            body: `It ends the dispute now: ${summary}. Nobody wins or loses, and it cannot be undone.`,
            action: 'Accept and settle',
          });
          if (!sure) return;
          setBusy(true);
          setError(null);
          try {
            await api.disputeAccept(id, offerId);
            await onDone();
          } catch (err) {
            setError(err instanceof ApiRequestError ? err.message : 'Could not accept that.');
            await onDone();
          } finally {
            setBusy(false);
          }
        })()}>
        {busy ? 'Settling…' : 'Accept and settle'}
      </button>
      {error && <ErrorNotice message={error} />}
    </>
  );
}

function hostOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).hostname : 'link';
  } catch {
    return 'link';
  }
}

/**
 * Where it stands, as steps: raised, each round, final. The current step is
 * lit, so anybody opening it knows at a glance what happens next.
 */
function Progress({ view }: { view: DisputeView }) {
  const { dispute } = view;
  const rounds = dispute.rounds ?? [];
  if (rounds.length === 0) return null;
  const closed = Boolean(dispute.resolvedAt);
  const steps = [
    { key: 'raised', label: 'Raised', done: true, on: false },
    ...rounds.map((round, index) => ({
      key: `r${round.n}`,
      label: `Round ${round.n}`,
      done: Boolean(round.decision) || closed,
      on: !closed && index === rounds.length - 1,
    })),
    { key: 'final', label: dispute.result?.how === 'settled' ? 'Settled' : dispute.result?.how === 'withdrawn' ? 'Withdrawn' : 'Final', done: closed, on: false },
  ];
  return (
    <ol className="dsteps" aria-label="Progress">
      {steps.map((step) => (
        <li key={step.key} className={`dsteps__step${step.done ? ' is-done' : ''}${step.on ? ' is-on' : ''}`}>
          <span className="dsteps__dot" aria-hidden="true">{step.done ? '✓' : ''}</span>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Write, settle, withdraw, escalate - and, for the manager, decide; for the
 * holder of a protected payment, release it.
 */
function DisputeActions({ view, onDone }: { view: DisputeView; onDone: () => Promise<void> }) {
  const { dispute, actions } = view;
  const [body, setBody] = useState('');
  const [shots, setShots] = useState<EvidenceDraft[]>([]);
  const [offering, setOffering] = useState(false);
  const [refund, setRefund] = useState('');
  const [terms, setTerms] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onDone();
      setBody('');
      setShots([]);
      setOffering(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  async function escalate() {
    const fee = view.escalation.feeMinor ?? 0;
    const sure = await confirm({
      title: `Escalate to round ${view.escalation.nextRound}?`,
      body: `Another community manager, picked by availability, decides it again. The escalation fee is ${formatMoney(fee, view.currency)}, paid through the payment gateway and not refunded. If the first two decisions agree, that is the final result.`,
      action: `Pay ${formatMoney(fee, view.currency)} and escalate`,
    });
    if (sure) await run('escalate', () => api.disputeEscalate(dispute.id));
  }

  return (
    <div className="card card--pad stack" style={{ marginTop: 16 }}>
      {dialog}
      {actions.includes('reply') && (
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          void run('reply', () => api.disputeReply(dispute.id, body.trim(), shots));
        }}>
          <label className="field">
            <span>Add to the thread</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
              placeholder={view.role === 'manager' ? 'Ask either of them something, or say what you need to see.' : 'Answer, or add what you have.'} />
          </label>
          <ScreenshotPicker value={shots} onChange={setShots} />
          <button type="submit" className="btn" style={{ justifySelf: 'start' }}
            disabled={busy !== null || (body.trim().length === 0 && shots.length === 0)}>
            {busy === 'reply' ? 'Posting…' : 'Post'}
          </button>
        </form>
      )}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        {actions.includes('propose_settlement') && !offering && (
          <button className="btn btn--ghost" onClick={() => setOffering(true)}>Propose a settlement</button>
        )}
        {actions.includes('escalate') && (
          <button className="btn btn--ghost" disabled={busy !== null} onClick={() => void escalate()}>
            {busy === 'escalate' ? 'Escalating…' : `Escalate · ${formatMoney(view.escalation.feeMinor ?? 0, view.currency)}`}
          </button>
        )}
        {actions.includes('withdraw') && (
          <button className="btn btn--quiet" disabled={busy !== null}
            onClick={() => void (async () => {
              const sure = await confirm({
                title: 'Withdraw this dispute?',
                body: `It closes now and counts for nobody. The fee you paid is not refunded${view.holdsMoney ? ', and the payment goes back on hold as it was' : ''}.`,
                action: 'Withdraw',
                danger: true,
              });
              if (sure) await run('withdraw', () => api.disputeWithdraw(dispute.id));
            })()}>
            {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw this'}
          </button>
        )}
        {actions.includes('request_release') && (
          <button className="btn" disabled={busy !== null}
            onClick={() => void (async () => {
              const toBuyer = dispute.resolution?.refundMinor ?? 0;
              const held = view.heldMinor ?? 0;
              const sure = await confirm({
                title: 'Release the held payment?',
                body: `As decided: ${formatMoney(toBuyer, view.currency)} to the buyer and ${formatMoney(Math.max(0, held - toBuyer), view.currency)} to the seller, through the payment gateway.`,
                action: 'Release it',
              });
              if (sure) await run('release', () => api.disputeRelease(dispute.id));
            })()}>
            {busy === 'release' ? 'Releasing…' : 'Release the held payment as decided'}
          </button>
        )}
      </div>
      {actions.includes('escalate') && view.escalation.by && (
        <p className="faint" style={{ margin: 0 }}>
          You can escalate until {formatDateOrdinal(view.escalation.by)}. After that, this decision is final.
        </p>
      )}

      {offering && (
        <form className="form" onSubmit={(event) => {
          event.preventDefault();
          const minor = view.holdsMoney ? Math.round(Number(refund) * 100) : 0;
          void run('offer', () => api.disputeOffer(dispute.id, minor, terms.trim()));
        }}>
          {view.holdsMoney && view.heldMinor !== null && (
            <label className="field">
              <span>Back to the buyer</span>
              <input value={refund} onChange={(e) => setRefund(e.target.value)} inputMode="decimal"
                placeholder={String(view.heldMinor / 100)} autoFocus />
              <span className="field__hint">
                Between nothing and {formatMoney(view.heldMinor, view.currency)}. Paid out through the gateway the moment it is accepted.
              </span>
            </label>
          )}
          <label className="field">
            <span>Terms</span>
            <input value={terms} onChange={(e) => setTerms(e.target.value)}
              placeholder={view.holdsMoney ? 'Half back for the damage, keep the item.' : 'I will take the comment down and apologise.'} />
          </label>
          <div className="row">
            <button type="submit" className="btn"
              disabled={busy !== null || (view.holdsMoney ? refund.trim() === '' : terms.trim().length < 4)}>
              {busy === 'offer' ? 'Sending…' : 'Propose'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setOffering(false)}>Cancel</button>
          </div>
        </form>
      )}

      {actions.includes('decide') && <DecideForm view={view} onDone={onDone} />}

      {error && <ErrorNotice message={error} />}
    </div>
  );
}

const KINDS: DisputeSanctionKind[] = ['remove_content', 'warning_post', 'flag', 'rating_reduction', 'alert_banner', 'xp_deduction'];

/**
 * The community manager's decision: in whose favour, why, and what should
 * happen if this decision ends up standing.
 */
function DecideForm({ view, onDone }: { view: DisputeView; onDone: () => Promise<void> }) {
  const { dispute, parties } = view;
  const [favour, setFavour] = useState<'raiser' | 'respondent' | ''>('');
  const [reasoning, setReasoning] = useState('');
  const [refund, setRefund] = useState('');
  const [picked, setPicked] = useState<Partial<Record<DisputeSanctionKind, DisputeSanction>>>({});
  const [forums, setForums] = useState<ForumRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.forums().then((body) => setForums(body.forums)).catch(() => setForums([]));
  }, []);

  // Actions fall on whoever the decision goes against - never the winner.
  const loserId = favour === 'raiser' ? parties.respondent.id : favour === 'respondent' ? parties.raiser.id : '';
  const loserName = favour === 'raiser' ? parties.respondent.name : parties.raiser.name;
  // Content can only come down if it is the loser's own.
  const canRemove = Boolean(dispute.subjectRef && dispute.subjectRef.type !== 'user' && dispute.subjectRef.ownerId === loserId);
  const available = KINDS.filter((kind) => kind !== 'remove_content' || canRemove);

  function choose(next: 'raiser' | 'respondent') {
    setFavour(next);
    // Switching sides moves every chosen action onto the new loser.
    const nextLoser = next === 'raiser' ? parties.respondent.id : parties.raiser.id;
    setPicked((current) => Object.fromEntries(Object.entries(current)
      .filter(([kind]) => kind !== 'remove_content' || dispute.subjectRef?.ownerId === nextLoser)
      .map(([kind, entry]) => [kind, { ...entry!, targetUserId: nextLoser }])));
  }

  function toggle(kind: DisputeSanctionKind) {
    setPicked((current) => {
      const next = { ...current };
      if (next[kind]) delete next[kind];
      else {
        next[kind] = {
          kind,
          targetUserId: loserId,
          message: '',
          ...(kind === 'warning_post' || kind === 'alert_banner' ? { days: 7 } : {}),
          ...(kind === 'xp_deduction' ? { severity: 'light' as const } : {}),
          ...(kind === 'rating_reduction' ? { points: 5 } : {}),
          ...(kind === 'warning_post' ? { forumId: null } : {}),
        };
      }
      return next;
    });
  }
  const edit = (kind: DisputeSanctionKind, patch: Partial<DisputeSanction>) =>
    setPicked((current) => ({ ...current, [kind]: { ...current[kind]!, ...patch } }));

  async function submit() {
    if (!favour) return;
    setBusy(true);
    setError(null);
    try {
      const sanctions = Object.values(picked).map((entry) => ({ ...entry!, targetUserId: loserId }));
      await api.disputeDecide(dispute.id, {
        favour,
        reasoning: reasoning.trim(),
        refundMinor: view.holdsMoney && refund.trim() !== '' ? Math.round(Number(refund) * 100) : null,
        sanctions,
      });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not record that decision.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack decide">
      <span className="card__title">Your decision</span>
      <div className="decide__sides" role="radiogroup" aria-label="In whose favour">
        <label className={`raise__manager${favour === 'raiser' ? ' is-on' : ''}`}>
          <input type="radio" name="favour" checked={favour === 'raiser'} onChange={() => choose('raiser')} />
          <b>In favour of {parties.raiser.name}</b><span className="faint">who raised it</span>
        </label>
        <label className={`raise__manager${favour === 'respondent' ? ' is-on' : ''}`}>
          <input type="radio" name="favour" checked={favour === 'respondent'} onChange={() => choose('respondent')} />
          <b>In favour of {parties.respondent.name}</b><span className="faint">who it is against</span>
        </label>
      </div>
      <label className="field">
        <span>Reasoning</span>
        <textarea rows={4} value={reasoning} onChange={(e) => setReasoning(e.target.value)}
          placeholder="All three of you read this. Say what the evidence showed." />
      </label>
      {view.holdsMoney && view.heldMinor !== null && (
        <label className="field">
          <span>Back to the buyer, if this decision stands</span>
          <input value={refund} onChange={(e) => setRefund(e.target.value)} inputMode="decimal"
            placeholder="Leave empty for all or nothing" />
          <span className="field__hint">Up to {formatMoney(view.heldMinor, view.currency)}. Released when the result is final.</span>
        </label>
      )}

      {favour && (
        <fieldset className="decide__sanctions">
          <legend>Actions against {loserName}, if this decision stands</legend>
          {available.map((kind) => {
            const entry = picked[kind];
            return (
              <div key={kind} className="decide__sanction">
                <label className="decide__check">
                  <input type="checkbox" checked={Boolean(entry)} onChange={() => toggle(kind)} />
                  {SANCTION_LABELS[kind]}
                  {NEEDS_ADMIN.includes(kind) && <span className="badge">Figmark approves</span>}
                </label>
                {entry && (
                  <div className="field-row">
                    <label className="field">
                      <span>{kind === 'warning_post' ? 'Warning everyone sees' : kind === 'alert_banner' ? 'Alert on their page' : 'Note'}</span>
                      <input value={entry.message} maxLength={300} onChange={(e) => edit(kind, { message: e.target.value })} />
                    </label>
                    {(kind === 'warning_post' || kind === 'alert_banner') && (
                      <label className="field">
                        <span>Days</span>
                        <input type="number" min={1} max={60} value={entry.days ?? 7}
                          onChange={(e) => edit(kind, { days: Number(e.target.value) })} />
                      </label>
                    )}
                    {kind === 'warning_post' && (
                      <label className="field">
                        <span>Where</span>
                        <select value={entry.forumId ?? ''} onChange={(e) => edit(kind, { forumId: e.target.value || null })}>
                          <option value="">The feed</option>
                          {forums.map((forum) => <option key={forum.id} value={forum.id}>{forum.name}</option>)}
                        </select>
                      </label>
                    )}
                    {kind === 'xp_deduction' && (
                      <label className="field">
                        <span>Severity</span>
                        <select value={entry.severity} onChange={(e) => edit(kind, { severity: e.target.value as 'light' | 'severe' })}>
                          <option value="light">Light (−{XP_PENALTY.light} XP)</option>
                          <option value="severe">Severe (−{XP_PENALTY.severe} XP)</option>
                        </select>
                      </label>
                    )}
                    {kind === 'rating_reduction' && (
                      <label className="field">
                        <span>Rating points</span>
                        <input type="number" min={1} max={50} value={entry.points ?? 5}
                          onChange={(e) => edit(kind, { points: Number(e.target.value) })} />
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <p className="faint" style={{ margin: 0 }}>
            Nothing runs until the result is final - and only from the decision that stands. Alert banners and XP
            deductions also wait for Figmark to approve them.
          </p>
        </fieldset>
      )}

      {error && <ErrorNotice message={error} />}
      <button type="button" className="btn" style={{ justifySelf: 'start' }}
        disabled={busy || !favour || reasoning.trim().length === 0} onClick={() => void submit()}>
        {busy ? 'Recording…' : 'Record decision'}
      </button>
    </div>
  );
}
