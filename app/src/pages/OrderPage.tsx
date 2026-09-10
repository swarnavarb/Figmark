import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { labelFor } from '@shared/fulfilment';
import { AUTO_RELEASE_DAYS, REVIEW_REVEAL_DAYS, type OrderSide } from '@shared/orders';
import { reasonsFor } from '@shared/disputes';
import { DISPUTE_REASON_LABELS } from '@shared/enums';
import type { Order } from '@shared/models';
import {
  ApiRequestError, api,
  type Checkout, type EscrowOption, type EvidenceDraft, type OrderState, type OrderTracking,
} from '../api';
import { ErrorNotice, Icon, Modal } from '../components/ui';
import { formatDate, formatMoney, timeAgo } from '../format';

/**
 * One order, as the buyer sees it.
 *
 * Nothing here mentions a shipment batch. The timeline is the order's own
 * history, so an item moved into a later consignment gains an event rather
 * than rewinding, and the only facts inherited from the batch are the tracking
 * reference and the dispatch estimate.
 */
export function OrderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<OrderTracking | null>(null);
  const [state, setState] = useState<OrderState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Two calls because they answer different questions - where the parcel is,
  // and what may be done about it - and the second settles the escrow clock on
  // the way past, so it has to be re-read after every action.
  const load = useCallback(async () => {
    try {
      const [tracking, current] = await Promise.all([api.orderTracking(id), api.orderState(id)]);
      setData(tracking);
      setState(current);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this order.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data || !state) return <main className="page"><p className="muted">Loading…</p></main>;

  const { order, stages, currentStage } = data;
  const currentIndex = stages.indexOf(currentStage);
  // Newest first: what just happened matters more than what happened first.
  const history = [...order.stageHistory].reverse();

  return (
    <main className="page">
      {/* Both sides read this screen, so it goes back to whichever list they
          came from rather than always to the buyer's. */}
      <button className="btn btn--quiet" style={{ marginBottom: 16 }}
        onClick={() => navigate(state.side === 'seller' ? '/me?tab=sales' : '/me?tab=purchases')}>
        <Icon name="back" size={14} /> {state.side === 'seller' ? 'My sales' : 'My purchases'}
      </button>

      <div className="page__head">
        <div>
          <h1>{order.itemName}</h1>
          <p className="muted">
            {state.side === 'seller' ? 'Sold to' : 'From'} {state.counterpartyName} · ordered{' '}
            {timeAgo(order.createdAt)}
          </p>
        </div>
        <span className={`badge badge--${order.status === 'delivered' ? 'ok' : 'warn'}`}>
          {order.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* What to do about it comes before where it is: someone opening this
          screen with a payment to make should not have to scroll past a
          timeline to find the button. */}
      <OrderActions state={state} onDone={load} />

      <div className="detail">
        <div className="card card--pad stack">
          <h2>Where it is</h2>

          <ol className="track" style={{ flexWrap: 'wrap' }}>
            {stages.map((stage, index) => (
              <li key={stage}
                className={`track__step${index < currentIndex ? ' is-done' : ''}${index === currentIndex ? ' is-current' : ''}`}>
                <span className="track__dot" aria-hidden="true" />
                <span>{labelFor(stage)}</span>
              </li>
            ))}
          </ol>

          <div className="detail__section" style={{ marginTop: 8 }}>
            <h3>History</h3>
            {history.map((event, index) => (
              <div key={`${event.stage}-${event.enteredAt}-${index}`} className="comment">
                <div className="comment__head">
                  <span className="comment__who">{labelFor(event.stage)}</span>
                  <span className="faint">{formatDate(event.enteredAt)}</span>
                </div>
                {event.note && <p className="muted">{event.note}</p>}
              </div>
            ))}
          </div>
        </div>

        <aside className="stack">
          <div className="card card--pad stack">
            <div className="row row--between">
              <span className="muted">Total</span>
              <span className="detail__price" style={{ fontSize: 'var(--t-lg)' }}>
                {formatMoney(order.unitPriceMinor * order.quantity, order.currency)}
              </span>
            </div>
            <dl style={{ margin: 0 }}>
              <div className="kv"><dt>Quantity</dt><dd>{order.quantity}</dd></div>
              <div className="kv"><dt>Condition</dt><dd>{order.condition}</dd></div>
              <div className="kv">
                <dt>Payment</dt>
                <dd>{order.paymentStatus.replace(/_/g, ' ')}</dd>
              </div>
              <div className="kv"><dt>Escrow</dt><dd>{order.escrow.state}</dd></div>
              {data.estimatedDispatchAt && (
                <div className="kv"><dt>Est. dispatch</dt><dd>{formatDate(data.estimatedDispatchAt)}</dd></div>
              )}
            </dl>

            {data.trackingReference ? (
              <div>
                <span className="faint">Tracking reference</span>
                <div className="mono" style={{ marginTop: 4 }}>{data.trackingReference}</div>
              </div>
            ) : (
              <p className="faint">No tracking reference yet. It appears once the seller dispatches.</p>
            )}
          </div>

          {/* Only while it is actually held. On a finished order this was still
              explaining a hold that had already been released. */}
          {order.escrow.state === 'held' && (
            <p className="notice notice--info">
              {order.protection?.escrowName ?? 'An escrow'} is holding this, and passes it to the seller
              when you confirm delivery — or on its own {AUTO_RELEASE_DAYS} days after dispatch if you
              neither confirm nor dispute it.
            </p>
          )}
          {order.escrow.state === 'released' && order.completedAt && (
            <p className="notice notice--ok">
              Payment released to the seller on {formatDate(order.completedAt)}.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

/**
 * What this person may do to this order, and nothing they may not.
 *
 * The list comes from the server rather than being re-derived here, so a button
 * can never appear for something the API is about to refuse.
 */
function OrderActions({ state, onDone }: { state: OrderState; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [disputing, setDisputing] = useState(false);

  const { order, actions } = state;
  const disputeId = order.escrow.disputeId;

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onDone();
      setPaying(false);
      setDisputing(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  const nothingToDo = actions.length === 0 || (actions.length === 1 && actions[0] === 'review');

  return (
    <div className="stack" style={{ marginBottom: 20 }}>
      {/* Said plainly, everywhere money is mentioned: no provider is wired up,
          and a screen that implied one would be lying about a payment. */}
      {state.simulatedPayment && order.paymentStatus !== 'unpaid' && (
        <p className="notice notice--warn">
          Payments are simulated while no provider is connected — nothing is charged.
        </p>
      )}

      {/* What protection did or did not buy, once the choice has been made. */}
      {order.paymentStatus !== 'unpaid' && (
        order.protection ? (
          <p className="notice notice--ok">
            Held by <strong>{order.protection.escrowName}</strong> —{' '}
            {formatMoney(order.protection.feeMinor, order.currency)} protection fee. Either side can open
            a dispute, and they settle it.
            {order.protection.refundedAt && ' The fee was refunded.'}
          </p>
        ) : (
          <p className="notice notice--info">
            Paid without protection, so the money went straight to the seller. There is nobody holding
            anything if this goes wrong.
          </p>
        )
      )}

      {disputeId && (
        <Link to={`/dispute/${disputeId}`} className="notice notice--warn"
          style={{ display: 'block', textDecoration: 'none' }}>
          There is an open dispute on this order — tap to read it.
        </Link>
      )}

      {!nothingToDo && (
        <div className="card card--pad stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {actions.includes('pay') && !paying && (
              <button className="btn btn--lg" onClick={() => setPaying(true)}>
                Pay {formatMoney(order.unitPriceMinor * order.quantity, order.currency)}
              </button>
            )}
            {actions.includes('confirm') && (
              <button className="btn btn--lg" disabled={busy !== null}
                onClick={() => void run('confirm', () => api.confirmOrder(order.id))}>
                {busy === 'confirm' ? 'Releasing…' : 'It arrived — complete the order'}
              </button>
            )}
            {actions.includes('dispute') && !disputing && (
              <button className="btn btn--quiet" onClick={() => setDisputing(true)}>
                Something is wrong
              </button>
            )}
          </div>

          {paying && (
            <PayPanel
              order={order}
              busy={busy}
              onPay={(p, escrowAgentId) => run('pay', () => api.payOrder(order.id, p, escrowAgentId))}
              onCancel={() => setPaying(false)}
            />
          )}

          {disputing && (
            <DisputeForm
              side={state.side ?? 'buyer'}
              busy={busy === 'dispute'}
              onCancel={() => setDisputing(false)}
              onOpen={(body) => run('dispute', () => api.openDispute(order.id, body))}
            />
          )}

          {error && <ErrorNotice message={error} />}
        </div>
      )}

      {order.completedAt && <ReviewPanel state={state} onDone={onDone} />}
    </div>
  );
}

/**
 * Choosing whether to buy protection, with both outcomes stated.
 *
 * A default here would be the whole decision: the buyer is choosing between
 * paying a fee and having no recourse, and neither is obviously right for a
 * ₹200 order from someone they have bought from ten times. So nothing is
 * pre-selected and both buttons say what they cost.
 */
function PayPanel({ order, busy, onPay, onCancel }: {
  order: Order;
  busy: string | null;
  onPay: (protection: boolean, escrowAgentId?: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [quote, setQuote] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Ticked, but nobody chosen yet — which is what opens the picker. */
  const [wantProtection, setWantProtection] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<EscrowOption | null>(null);

  useEffect(() => {
    void api
      .checkout(order.id)
      .then(setQuote)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not price this order.'),
      );
  }, [order.id]);

  if (error) return <ErrorNotice message={error} />;
  if (!quote) return <p className="muted">Loading…</p>;

  const available = quote.escrows.length > 0;
  const total = quote.itemMinor + (chosen?.feeMinor ?? 0);

  function tick(on: boolean) {
    setWantProtection(on);
    // Ticking the box is the question, not the answer: protection means somebody
    // holds the money, so the next thing to say is who.
    if (on && !chosen) setPicking(true);
    if (!on) setChosen(null);
  }

  return (
    <div className="stack">
      <div className="kv"><dt>Item</dt><dd>{formatMoney(quote.itemMinor, quote.currency)}</dd></div>

      {available ? (
        <>
          <label className="tick tick--wide">
            <input type="checkbox" checked={wantProtection} onChange={(e) => tick(e.target.checked)} />
            <span>Buyer protection</span>
          </label>

          {wantProtection && chosen && (
            <>
              <div className="kv">
                <dt>{chosen.name} ({(chosen.feeBasisPoints / 100).toFixed(1)}%)</dt>
                <dd>{formatMoney(chosen.feeMinor, quote.currency)}</dd>
              </div>
              <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
                onClick={() => setPicking(true)}>
                Choose a different escrow
              </button>
            </>
          )}

          <p className="faint">
            {wantProtection
              ? 'Your payment goes to the escrow, not the seller, and stays there until you confirm the item arrived. If the two of you disagree, they settle it.'
              : `Without protection the money goes to ${quote.sellerName} immediately and any problem is between the two of you.`}
          </p>

          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn--lg" disabled={busy !== null || (wantProtection && !chosen)}
              onClick={() => void onPay(Boolean(chosen), chosen?.id)}>
              {busy === 'pay' ? 'Paying…' : `Pay ${formatMoney(total, quote.currency)}`}
            </button>
            <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <p className="faint">
            Nobody approved to hold payments can be neutral in this trade, so this one goes to{' '}
            {quote.sellerName} directly.
          </p>
          <div className="row">
            <button className="btn btn--lg" disabled={busy !== null} onClick={() => void onPay(false)}>
              {busy === 'pay' ? 'Paying…' : `Pay ${formatMoney(quote.itemMinor, quote.currency)}`}
            </button>
            <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}

      {picking && (
        <EscrowPicker
          quote={quote}
          chosenId={chosen?.id ?? null}
          onPick={(option) => {
            setChosen(option);
            setPicking(false);
          }}
          onClose={() => {
            setPicking(false);
            // Closing without choosing unticks the box, rather than leaving it
            // ticked over a choice that was never made.
            if (!chosen) setWantProtection(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Choosing who holds the money.
 *
 * A real decision, so it gets a dialog rather than a dropdown: these are named
 * people with their own fees, and the buyer is picking who to trust with the
 * whole amount until the box lands.
 *
 * The suggestion is the one the rest of the batch already uses. A consignment is
 * one shipment with one set of problems, and thirty buyers each picking a
 * different holder turns one conversation into thirty — so the number of others
 * who agreed is shown, because that is the actual reason to go along with them.
 */
function EscrowPicker({ quote, chosenId, onPick, onClose }: {
  quote: Checkout;
  chosenId: string | null;
  onPick: (option: EscrowOption) => void;
  onClose: () => void;
}) {
  // Suggested first: it is the answer most buyers should give.
  const ordered = [...quote.escrows].sort((a, b) => {
    const suggested = quote.suggested?.agentId;
    return Number(b.id === suggested) - Number(a.id === suggested);
  });

  return (
    <Modal title="Who should hold your payment?" onClose={onClose}>
      <p className="faint" style={{ marginTop: 0 }}>
        An escrow holds {formatMoney(quote.itemMinor, quote.currency)} until you confirm the item
        arrived, and decides if you and {quote.sellerName} cannot agree. Their fee is on top.
      </p>

      <div className="stack" style={{ marginTop: 12 }}>
        {ordered.map((option) => {
          const isSuggested = quote.suggested?.agentId === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`escrow${chosenId === option.id ? ' is-on' : ''}`}
              onClick={() => onPick(option)}
            >
              <div className="escrow__main">
                <span className="escrow__name">
                  {option.name}
                  {isSuggested && <span className="badge badge--accent" style={{ marginLeft: 8 }}>suggested</span>}
                </span>
                <span className="faint">
                  {isSuggested ? quote.suggested!.because : `${option.heldBefore} transactions on record`}
                </span>
              </div>
              <div className="escrow__fee">
                {formatMoney(option.feeMinor, quote.currency)}
                <span className="faint"> · {(option.feeBasisPoints / 100).toFixed(1)}%</span>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Opening a dispute: a reason from a list, what happened, and what shows it.
 *
 * The list is per side — a seller cannot claim a parcel never arrived — and it
 * is what makes the queue triageable later. The photographs are most of the
 * argument in a dispute about a physical object, so they are asked for here
 * rather than chased afterwards.
 */
function DisputeForm({ side, busy, onOpen, onCancel }: {
  side: OrderSide;
  busy: boolean;
  onOpen: (body: { reasonCode: string; reason: string; evidence: EvidenceDraft[] }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const reasons = reasonsFor(side);
  const [reasonCode, setReasonCode] = useState<string>(reasons[0]!);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState<EvidenceDraft[]>([]);

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void onOpen({ reasonCode, reason: reason.trim(), evidence: evidence.filter((e) => e.url.trim()) });
      }}
    >
      <label className="field">
        <span>What went wrong?</span>
        <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
          {reasons.map((code) => (
            <option key={code} value={code}>{DISPUTE_REASON_LABELS[code]}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>In your own words</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          placeholder="What happened, and what you would like done about it." autoFocus />
        <span className="field__hint">
          The other side reads everything here, and so does whoever settles it if they cannot.
        </span>
      </label>

      <EvidenceFields evidence={evidence} onChange={setEvidence} />

      <div className="row">
        <button type="submit" className="btn" disabled={busy || reason.trim().length < 4}>
          {busy ? 'Opening…' : 'Open dispute'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/**
 * Photographs, as links.
 *
 * The same shape the storefront photo already uses: uploads land when blob
 * storage is wired, and the field a reader renders is the same either way.
 */
export function EvidenceFields({ evidence, onChange }: {
  evidence: EvidenceDraft[];
  onChange: (next: EvidenceDraft[]) => void;
}) {
  return (
    <div className="stack">
      {evidence.map((item, index) => (
        <div className="field-row" key={index}>
          <label className="field">
            <span>Photo link</span>
            <input value={item.url} inputMode="url" placeholder="https://…"
              onChange={(e) => onChange(evidence.map((entry, i) => (i === index ? { ...entry, url: e.target.value } : entry)))} />
          </label>
          <label className="field">
            <span>What it shows</span>
            <input value={item.caption}
              onChange={(e) => onChange(evidence.map((entry, i) => (i === index ? { ...entry, caption: e.target.value } : entry)))} />
          </label>
        </div>
      ))}
      {evidence.length < 8 && (
        <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
          onClick={() => onChange([...evidence, { url: '', caption: '' }])}>
          <Icon name="plus" size={13} /> Add a photo
        </button>
      )}
    </div>
  );
}

/**
 * The two-sided review, and why the other one is not showing yet.
 *
 * Neither is visible until both are written, so the wait is explained rather
 * than looking like the counterparty said nothing.
 */
function ReviewPanel({ state, onDone }: { state: OrderState; onDone: () => Promise<void> }) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const other = state.side === 'buyer' ? 'the seller' : 'the buyer';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.reviewOrder(state.order.id, rating, body.trim());
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that review.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card--pad stack">
      <h2 style={{ margin: 0, fontSize: 'var(--t-md)' }}>How did it go?</h2>

      {state.myReview ? (
        <>
          <div className="row">
            <Stars value={state.myReview.rating} />
            <span className="faint">your rating of {other}</span>
          </div>
          {state.myReview.body && <p className="muted">{state.myReview.body}</p>}
        </>
      ) : (
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Rating</span>
            <div className="row" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={rating === value}
                  aria-label={`${value} out of 5`}
                  className={`starbtn${value <= rating ? ' is-on' : ''}`}
                  onClick={() => setRating(value)}
                >
                  ★
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            <span>Anything worth saying?</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
              placeholder={`How ${other} handled it. Optional.`} />
            <span className="field__hint">
              Hidden until {other} writes theirs, or {REVIEW_REVEAL_DAYS} days pass — so neither of you can
              answer the other's rating with one of your own.
            </span>
          </label>
          {error && <ErrorNotice message={error} />}
          <button type="submit" className="btn" style={{ justifySelf: 'start' }} disabled={busy}>
            {busy ? 'Saving…' : 'Leave review'}
          </button>
        </form>
      )}

      <div className="detail__section">
        <h3>What {other} said</h3>
        {state.theirReview ? (
          <>
            <Stars value={state.theirReview.rating} />
            {state.theirReview.body && <p className="muted">{state.theirReview.body}</p>}
          </>
        ) : state.theirReviewPending ? (
          <p className="faint">
            Written, and hidden until you write yours — that is what stops either of you rating in reply.
          </p>
        ) : (
          <p className="faint">Nothing yet.</p>
        )}
      </div>
    </div>
  );
}

/** A rating, as the shape everyone already reads without a legend. */
export function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} out of 5`}>
      {'★'.repeat(value)}
      <span className="stars__off">{'★'.repeat(5 - value)}</span>
    </span>
  );
}
