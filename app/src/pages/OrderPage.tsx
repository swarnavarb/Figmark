import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { isDirect, isLotEvent, labelFor } from '@shared/fulfilment';
import { WAITING_FOR_A_LOT, WAITING_FOR_LOT } from '@shared/routes';
import { AUTO_RELEASE_DAYS, REVIEW_REVEAL_DAYS, type OrderSide } from '@shared/orders';
import { reasonsFor } from '@shared/disputes';
import { DISPUTE_REASON_LABELS } from '@shared/enums';
import type { Order, SellerPaymentDetails } from '@shared/models';
import {
  ApiRequestError, api,
  type Checkout, type EscrowOption, type EvidenceDraft, type LotSummary, type OrderState, type OrderTracking,
} from '../api';
import { Ladder } from '../components/Ladder';
import { PaymentHistory } from '../components/Buy';
import { orderMoney } from '@shared/payments';
import { ErrorNotice, Icon, Modal, PersonLink, StepMark } from '../components/ui';
import { formatDate, formatDateOrdinal, formatMoney, timeAgo } from '../format';

/**
 * One order, as the buyer sees it.
 *
 * Nothing here mentions a shipment lot. The timeline is the order's own
 * history, so an item moved into a later consignment gains an event rather
 * than rewinding, and the only facts inherited from the lot are the tracking
 * reference and the dispatch estimate.
 */
/**
 * Colour for the order's own status chip.
 *
 * Kept distinct on purpose - `rejected` and `cancelled` read the same colour
 * only by accident, and section 21 is explicit that the two must never be
 * confused. Colour is never the only signal: the word beside it is the same
 * `order.status` text either way.
 */
function statusTone(status: Order['status']): string {
  switch (status) {
    case 'delivered': case 'cancelled_reversed': return 'ok';
    case 'rejected': case 'dispute_raised': return 'danger';
    case 'cancelled': return 'quiet';
    case 'payment_reversal_pending': return 'accent';
    default: return 'warn';
  }
}

export function OrderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const cameFrom = (useLocation().state as { from?: string } | null)?.from ?? null;
  const [data, setData] = useState<OrderTracking | null>(null);
  const [state, setState] = useState<OrderState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [tab, setTab] = useState<'tracking' | 'details'>('tracking');
  const [checkpointBusy, setCheckpointBusy] = useState(false);

  async function toggleWarehouse(order: Order) {
    setCheckpointBusy(true);
    try {
      await api.setCheckpoint(order.id, 'china_received', !order.checkpoints?.china_received);
      await load();
    } finally {
      setCheckpointBusy(false);
    }
  }

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
  /** The lot it is in now, as opposed to the ones it has been in. */
  const latestLotAt = [...order.stageHistory].reverse().find(isLotEvent)?.enteredAt ?? null;

  return (
    <main className="page">
      {/* Back to exactly where they came from - the list, its filters, and
          this order within it - rather than to the top of some list. Opened
          from anywhere that did not say (a notification, a shared link), a
          seller lands on their orders with this one in view. */}
      <button className="btn btn--quiet" style={{ marginBottom: 16 }}
        onClick={() => navigate(
          cameFrom ?? (state.side === 'seller' ? '/shop?tab=payments' : '/purchases'),
          { state: { focusOrder: order.id } },
        )}>
        <Icon name="back" size={14} /> {state.side === 'seller' ? 'Orders' : 'My Purchases'}
      </button>

      <div className="page__head">
        <div>
          <h1>{order.itemName}</h1>
          <p className="muted">
            {state.side === 'seller' ? 'Sold to' : 'From'} <PersonLink party={state.counterparty} /> · ordered{' '}
            {timeAgo(order.createdAt)}
          </p>
        </div>
        <span className={`badge badge--${statusTone(order.status)} order-status`}>
          {order.status.replace(/_/g, ' ')}
        </span>
      </div>

      {/* What to do about it comes before where it is: someone opening this
          screen with a payment to make should not have to scroll past a
          timeline to find the button. */}
      <OrderActions state={state} onDone={load} />
      <DisputePanel state={state} onDone={load} />

      <div className="tabs tabs--vivid">
        <button type="button" className={`tab${tab === 'tracking' ? ' is-on' : ''}`}
          onClick={() => setTab('tracking')}>
          Tracking
        </button>
        <button type="button" className={`tab${tab === 'details' ? ' is-on' : ''}`}
          onClick={() => setTab('details')}>
          Details
        </button>
      </div>

      {tab === 'tracking' && (
        <div className="card card--pad stack">
          <div className="row row--between">
            <h2 style={{ margin: 0 }}>Where it is</h2>
            {/* The same tick the order row offers, so a seller working from
                this screen never has to go back to the list for it. */}
            {state.side === 'seller' && !isDirect(order) && (
              <button type="button" className={`orow__toggle${order.checkpoints?.china_received ? ' is-on' : ''}`}
                aria-pressed={Boolean(order.checkpoints?.china_received)}
                onClick={() => void toggleWarehouse(order)}
                disabled={checkpointBusy}>
                <Icon name={order.checkpoints?.china_received ? 'check' : 'box'} size={13} />
                <span>China WH</span>
              </button>
            )}
          </div>

          {/* The lot's own ladder, in the seller's words, when there is a
              lot. An item waiting for one gets what has actually happened
              and a line saying what it is waiting for - not five hollow
              circles implying a journey nobody has booked. */}
          {data.awaitingLot || data.route ? (
            data.route ? (
              /* One ladder, not two.
               *
               * This used to draw the pre-lot template above the lot's
               * route, and the two overlap: both open with the order being
               * placed and the parcel reaching the China warehouse. The
               * result put the same event on screen twice in contradictory
               * states - ticked in the top ladder, hollow in the one below.
               * Once there is a lot, the lot's route is the whole
               * journey and the only thing worth drawing. */
              <>
                {/* Which shipment it is in, before the journey rather than
                    after it: for an item bought into a lot that is the first
                    thing its buyer wants, and the timeline below is the
                    answer to the second. */}
                <span className="field__hint">
                  Travelling in {data.route.lotName} · lot #{data.route.lotNumber}
                </span>
                {/* With what the seller actually said along the way, hung
                    off the rung it happened at and dated - so a payment made
                    after the parcel reached the warehouse reads under the
                    warehouse tick, not above it. */}
                <Ladder steps={data.route.steps} current={data.route.currentStep}
                  history={data.order.stageHistory}
                  waitingFor={data.route.waitingForLot ? WAITING_FOR_LOT : null}
                  /* The lot is where a seller's next question leads - change
                     it, or go and move it on - so the answers sit on the lot
                     itself rather than on a screen they have to go and find.
                     Only on the lot it is in now: the earlier ones are
                     history, and history is not a control. */
                  lotAction={state.side === 'seller'
                    ? (event) => (event.enteredAt === latestLotAt ? (
                        <span className="ladder__lot-acts">
                          <button type="button" className="ladder__act"
                            onClick={() => setChanging(true)}>
                            Change lot
                          </button>
                          <Link className="ladder__act ladder__act--move"
                            to={`/shop?tab=lots&lot=${encodeURIComponent(data.route!.lotId)}`}>
                            Record progress to the lot
                          </Link>
                        </span>
                      ) : null)
                    : undefined} />
              </>
            ) : (
              <>
                <Ladder steps={data.preLot.steps} current={data.preLot.currentStep}
                  history={data.order.stageHistory}
                  waitingFor={data.preLot.waitingForLot ? WAITING_FOR_A_LOT : null} />
                <p className="notice notice--info">
                  <strong>Not yet added to a shipment lot.</strong> The rest of the journey
                  appears as soon as your order is added to a lot.
                </p>
              </>
            )
          ) : (
            <ol className="track" style={{ flexWrap: 'wrap' }}>
              {stages.map((stage, index) => (
                <li key={stage}
                  className={`track__step${index < currentIndex ? ' is-done' : ''}${index === currentIndex ? ' is-current' : ''}`}>
                  <span className="track__dot" aria-hidden="true">
                    <StepMark state={index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'} size={7} />
                  </span>
                  <span>{labelFor(stage)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {tab === 'details' && (
        <div className="detail">
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

            {data.listing && (
              <Link to={`/listing/${data.listing.id}`} className="order-product">
                {data.listing.photoUrl
                  ? <img src={data.listing.photoUrl} alt="" className="order-product__thumb" />
                  : <span className="order-product__thumb order-product__thumb--none" aria-hidden="true" />}
                <span className="order-product__body">
                  <span className="order-product__name">{data.listing.title}</span>
                  <span className="faint">View item</span>
                </span>
              </Link>
            )}
          </div>

          <aside className="stack">
            <PaymentHistory order={order} side={state.side} onChanged={load} />

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
      )}

      {changing && data.route && (
        <ChangeLotDialog
          orderId={order.id}
          current={{ id: data.route.lotId, name: data.route.lotName }}
          onClose={() => setChanging(false)}
          onDone={() => { setChanging(false); void load(); }}
        />
      )}
    </main>
  );
}

/**
 * Move this one item into a different lot, and say why.
 *
 * The note is on the same event as the move rather than beside it, because
 * "moved to the next run" and "the airline bumped us" are one thing that
 * happened: a buyer reading two rows would wonder what the other one was.
 */
function ChangeLotDialog({ orderId, current, onClose, onDone }: {
  orderId: string;
  current: { id: string; name: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [lotId, setLotId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.myLots()
      .then((result) => setLots(result.lots.filter((row) => row.lot.id !== current.id)))
      .catch(() => setLots([]));
  }, [current.id]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.assignOrderToLot(orderId, { lotId, note: note.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change lot" onClose={onClose}>
      <div className="stack">
        <p className="muted" style={{ marginTop: 0 }}>
          Travelling with <strong>{current.name}</strong>. Moving it starts this item on the new
          lot's route where that lot has got to.
        </p>

        <label className="field">
          <span>Move it to</span>
          <select value={lotId} onChange={(event) => setLotId(event.target.value)}>
            <option value="">Pick a lot…</option>
            {(lots ?? []).map((row) => (
              <option key={row.lot.id} value={row.lot.id}>
                {row.lot.lotNumber ? `LOT ${row.lot.lotNumber} — ` : ''}{row.lot.name}
              </option>
            ))}
          </select>
          {lots !== null && lots.length === 0 && (
            <span className="field__hint">
              No other lot to move it to. Open one on the Track tab first.
            </span>
          )}
        </label>

        <label className="field">
          <span>Note (optional)</span>
          <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)}
            placeholder="Missed the cut-off — riding the next run instead." />
          <span className="field__hint">The buyer reads this on their timeline, beside the move.</span>
        </label>

        {error && <ErrorNotice message={error} />}
        <div className="row">
          <button type="button" className="btn" disabled={busy || !lotId}
            onClick={() => void submit()}>
            {busy ? 'Moving…' : 'Move it'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
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
  // An unpaid order is a checkout, so it opens as one. There is nothing else to
  // do on it, and making the buyer press Pay to reach the question of how to pay
  // put a step in front of the only decision on the screen.
  const [paying, setPaying] = useState(() => state.actions.includes('pay'));
  const [settling, setSettling] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const { order, actions } = state;
  const disputeId = order.escrow.disputeId;

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
      await onDone();
      setPaying(false);
      setSettling(false);
      setDisputing(false);
      setCancelling(false);
      setReversing(false);
      setRejecting(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(null);
    }
  }

  /*
   * Whether this card has anything in it.
   *
   * Derived from the buttons the card can actually draw rather than from a
   * hand-kept list of actions to ignore, because the two can drift. Adding an
   * action without a button can no longer produce an empty rounded rectangle.
   */
  const DRAWN_HERE = [
    'pay', 'settle_claim', 'confirm', 'dispute', 'pay_more', 'accept', 'reject', 'cancel',
    'submit_reversal', 'confirm_reversal_details', 'ack_reversal', 'raise_dispute', 'ack_credit_refund',
  ] as const;
  const returned = (order.credits ?? []).filter((credit) => credit.status === 'refund_pending' && credit.pendingRefund);
  const returnedMinor = returned.reduce((sum, credit) => sum + (credit.pendingRefund?.amountMinor ?? 0), 0);
  const nothingToDo = !actions.some((action) =>
    (DRAWN_HERE as readonly string[]).includes(action));

  return (
    <div className="stack" style={{ marginBottom: 20 }}>
      {/* Only the held payment is simulated. A direct sale is real money that
          genuinely left the buyer's account — Figmark simply had no part in it,
          which the checkout says in its own words. Claiming otherwise here
          would tell somebody who has actually paid that they have not. */}
      {state.simulatedPayment && order.protection != null && (
        <p className="notice notice--warn">
          The escrow hold is simulated while no provider is connected — nothing is charged.
        </p>
      )}

      {/* A claimed payment is the one state where each side is waiting on a
          different thing, so each is told which. */}
      {order.paymentStatus === 'claimed' && (
        <p className="notice notice--purple">
          {state.side === 'buyer'
            ? 'You have told the seller you paid. They confirm it landed in their account before this moves — nothing else is needed from you.'
            : 'The buyer says they have paid. Check your own account, then say whether it arrived.'}
        </p>
      )}

      {order.paymentClaim?.decision === 'denied' && state.side === 'buyer' && (
        <p className="notice notice--warn">
          The seller says the payment has not arrived: {order.paymentClaim.decidedReason} You can
          send it again and tell them.
        </p>
      )}

      {/* What protection did or did not buy, once the choice has been made. */}
      {(order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') && (
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
            {actions.includes('pay_more') && (
              <Link to="/purchases" className="btn btn--lg">
                💳 Pay more · {formatMoney(orderMoney(order).outstandingMinor, order.currency)} left
              </Link>
            )}
            {actions.includes('settle_claim') && !settling && (
              <button className="btn btn--lg" onClick={() => setSettling(true)}>
                Did this payment arrive?
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
            {actions.includes('accept') && (
              <button className="btn btn--ok" disabled={busy !== null}
                onClick={() => void run('accept', () => api.acceptOrder(order.id))}>
                {busy === 'accept' ? 'Accepting…' : `✅ Accept${order.bookingOnly ? ' booking' : ''}`}
              </button>
            )}
            {actions.includes('reject') && !rejecting && (
              <button type="button" className="btn btn--danger" disabled={busy !== null}
                onClick={() => setRejecting(true)}>
                ❌ Reject
              </button>
            )}
            {actions.includes('cancel') && !cancelling && (
              <button className="btn btn--quiet" onClick={() => setCancelling(true)}>
                ❌ Cancel order
              </button>
            )}
            {(actions.includes('submit_reversal') || actions.includes('request_reversal_details')) && !reversing && (
              <button className="btn btn--lg" onClick={() => setReversing(true)}>
                ↩️ Payment reversal
              </button>
            )}
            {actions.includes('confirm_reversal_details') && (
              <button className="btn btn--lg" disabled={busy !== null}
                onClick={() => void run('confirm-details', () => api.confirmReversalDetails(order.id))}>
                {busy === 'confirm-details' ? 'Sending…' : "I've Updated My Payment Details"}
              </button>
            )}
            {actions.includes('ack_reversal') && (
              <span className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn--lg" disabled={busy !== null}
                  onClick={() => void run('ack', () => api.ackReversal(order.id, true))}>
                  {busy === 'ack' ? 'Sending…' : 'Payment Received'}
                </button>
                <button className="btn btn--quiet" disabled={busy !== null}
                  onClick={() => void run('ack-no', () => api.ackReversal(order.id, false))}>
                  Payment Not Received
                </button>
              </span>
            )}
            {actions.includes('ack_credit_refund') && (
              <div className="claimcard__ask">
                <p style={{ margin: 0 }}>
                  ↩️ The seller says they refunded{' '}
                  <b>{formatMoney(returnedMinor, order.currency)}</b>
                  {returned[0]?.pendingRefund?.reference ? ` (reference ${returned[0].pendingRefund.reference})` : ''}.
                  Did it reach you?
                </p>
                <span className="row" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn--ok" disabled={busy !== null}
                    onClick={() => void run('credit-yes', () => api.ackCreditRefund(order.id, true))}>
                    {busy === 'credit-yes' ? 'Sending…' : '✅ Received'}
                  </button>
                  <button className="btn btn--danger" disabled={busy !== null}
                    onClick={() => void run('credit-no', () => api.ackCreditRefund(order.id, false))}>
                    {busy === 'credit-no' ? 'Sending…' : '❌ Not received'}
                  </button>
                </span>
              </div>
            )}
            {actions.includes('raise_dispute') && (
              <button className="btn btn--danger" disabled={busy !== null}
                onClick={() => void run('dispute-reversal', () => api.raiseDispute(order.id))}>
                {busy === 'dispute-reversal' ? 'Raising…' : 'Raise a Dispute'}
              </button>
            )}
          </div>

          {rejecting && (
            <RejectOrder
              order={order}
              busy={busy === 'reject'}
              onReject={(reason) => run('reject', () => api.rejectOrder(order.id, reason))}
              onClose={() => setRejecting(false)}
            />
          )}

          {cancelling && (
            <CancelOrder
              order={order}
              busy={busy}
              onCancel={(body) => run('cancel', () => api.cancelOrder(order.id, body))}
              onClose={() => setCancelling(false)}
            />
          )}

          {reversing && (
            <ReversalPanel
              order={order}
              buyerHasReversalDetails={state.buyerHasReversalDetails}
              busy={busy}
              onRequestDetails={(message) => run('request-details', () => api.requestReversalDetails(order.id, message))}
              onSubmit={(body) => run('submit-reversal', () => api.submitReversal(order.id, body))}
              onClose={() => setReversing(false)}
            />
          )}

          {paying && (
            <BuyPanel
              order={order}
              busy={busy}
              onPaid={(body) => run('claim', () => api.claimPayment(order.id, body))}
              onBook={() => run('book', () => api.bookOrder(order.id))}
              onCancel={() => setPaying(false)}
            />
          )}

          {settling && (
            <SettleClaim
              order={order}
              busy={busy === 'settle'}
              onCancel={() => setSettling(false)}
              onAnswer={(body) => run('settle', () => api.settleClaim(order.id, body))}
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
 * Disputes on this order - the first, recording-only version.
 *
 * When the side that paid is told the money never came, they get a Dispute
 * button right there. Either side can also raise a dispute about anything
 * else, with a reason. Both only put it on record - on the timeline, in
 * My disputes for both people, and in a notification to the other side.
 */
function DisputePanel({ state, onDone }: { state: OrderState; onDone: () => Promise<void> }) {
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { order } = state;
  const raised = order.paymentDisputes ?? [];

  async function raise(key: string, body: { subject?: string; reason?: string }) {
    setBusy(key);
    setError(null);
    try {
      await api.flagDispute(order.id, body);
      setWriting(false);
      setReason('');
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not record that.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ marginBottom: 20 }}>
      {state.disputable.map((entry) => (
        <div key={entry.subject} className="disputebar">
          <span>⚠️ {entry.label}.</span>
          <button type="button" className="btn btn--sm btn--danger" disabled={busy !== null}
            onClick={() => void raise(entry.subject, { subject: entry.subject })}>
            {busy === entry.subject ? 'Recording…' : '⚖️ Dispute'}
          </button>
        </div>
      ))}

      {raised.map((dispute) => (
        <Link key={dispute.id} to="/disputes" className="disputebar disputebar--done">
          <span>
            ⚖️ Dispute raised by the {dispute.raisedBySide} on {formatDateOrdinal(dispute.raisedAt)}
            {dispute.reason ? ` — ${dispute.reason}` : ''}
          </span>
          <Icon name="right" size={14} />
        </Link>
      ))}

      {writing ? (
        <div className="card card--pad stack">
          <label className="field">
            <span>What is the dispute about?</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="The item arrived damaged and the seller is not answering…" />
            <span className="field__hint">
              It is recorded and the other side is told. It shows under My disputes for both of you.
            </span>
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--danger" disabled={busy !== null || reason.trim().length < 4}
              onClick={() => void raise('general', { reason: reason.trim() })}>
              {busy === 'general' ? 'Recording…' : 'Raise dispute'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setWriting(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
          onClick={() => setWriting(true)}>
          ⚖️ Raise a dispute
        </button>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/**
 * How to pay for this, which is two genuinely different transactions.
 *
 * Buying direct means the money leaves the buyer's bank and arrives in the
 * seller's, with this app holding nothing but both sides' account of it. Buying
 * with protection means an escrow holds it instead. They are not a setting on
 * one purchase: they differ in who has the money, who can be argued with, and
 * what happens if the box never turns up. So they are offered as two choices
 * with what each one costs and gives up written on it, rather than a tick box
 * on a single Pay button.
 */
function BuyPanel({ order, busy, onPaid, onBook, onCancel }: {
  order: Order;
  busy: string | null;
  onPaid: (body: { reference: string; screenshot: string | null; plan?: 'full' | 'advance' }) => void | Promise<void>;
  onBook: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [plan, setPlan] = useState<'full' | 'advance'>('full');
  const [quote, setQuote] = useState<Checkout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<'direct' | 'protected' | null>(null);
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

  const canProtect = quote.escrows.length > 0;
  const canPayDirect = quote.sellerPayment !== null;

  const dueNow = plan === 'advance' && quote.advanceMinor != null ? quote.advanceMinor : quote.itemMinor;

  if (route === 'direct' && quote.sellerPayment) {
    return (
      <DirectPay
        quote={{ ...quote, itemMinor: dueNow }}
        payment={quote.sellerPayment}
        busy={busy === 'claim'}
        onPaid={(body) => onPaid({ ...body, plan })}
        onBack={() => setRoute(null)}
      />
    );
  }

  return (
    <div className="stack">
      <div className="kv"><dt>Item</dt><dd>{formatMoney(quote.itemMinor, quote.currency)}</dd></div>

      {/* Full or advance, offered only where the seller takes an advance. The
          method chosen below is then the one every later payment uses. */}
      {quote.advanceMinor != null && (
        <div className="seg" role="radiogroup" aria-label="How much to pay now">
          <button type="button" role="radio" aria-checked={plan === 'full'}
            className={plan === 'full' ? 'is-on' : ''} onClick={() => setPlan('full')}>
            💯 Pay full · {formatMoney(quote.itemMinor, quote.currency)}
          </button>
          <button type="button" role="radio" aria-checked={plan === 'advance'}
            className={plan === 'advance' ? 'is-on' : ''} onClick={() => setPlan('advance')}>
            🌱 Pay advance · {formatMoney(quote.advanceMinor, quote.currency)}
          </button>
        </div>
      )}
      {plan === 'advance' && quote.advanceMinor != null && (
        <p className="notice notice--info">
          {quote.advancePercent}% now, {formatMoney(quote.itemMinor - quote.advanceMinor, quote.currency)} later
          from My Purchases — using the same payment method you pick here.
        </p>
      )}

      <button type="button" className="buyway" disabled={!canPayDirect}
        onClick={() => setRoute('direct')}>
        <span className="buyway__title">Buy directly from the seller</span>
        <span className="buyway__note">
          {canPayDirect
            ? <>Pay <PersonLink party={quote.seller} /> yourself, then show them it went through. Nothing is held, so anything that goes wrong is between the two of you.</>
            : <><PersonLink party={quote.seller} /> has not added any payment details, so there is nowhere to send the money.</>}
        </span>
        <span className="buyway__price">{formatMoney(dueNow, quote.currency)}</span>
      </button>

      <button type="button" className={`buyway${route === 'protected' ? ' is-on' : ''}`}
        disabled={!canProtect}
        onClick={() => {
          setRoute('protected');
          if (!chosen) setPicking(true);
        }}>
        <span className="buyway__title">Add buyer protection</span>
        <span className="badge badge--accent" style={{ justifySelf: 'start' }}>Escrow: Community Manager</span>
        <span className="buyway__note">
          {canProtect
            ? 'The payment is considered held by Figmark until you confirm the item arrived, and settled if the two of you disagree. Their fee is on top.'
            : 'Nobody approved to hold payments can be neutral in this trade.'}
        </span>
        <span className="buyway__price">
          {chosen
            ? formatMoney(quote.itemMinor + chosen.feeMinor, quote.currency)
            : `${formatMoney(quote.itemMinor, quote.currency)} + fee`}
        </span>
      </button>

      {!order.bookingOnly && (
        <button type="button" className="buyway" onClick={() => void onBook()}>
          <span className="buyway__title">📘 Book</span>
          <span className="buyway__note">
            Payment to be done immediately as the seller confirms the availability of the item. Booking
            itself does not count as payment.
          </span>
        </button>
      )}

      {route === 'protected' && chosen && (
        <div className="card card--pad stack">
          <div className="kv">
            <dt>{chosen.name} ({(chosen.feeBasisPoints / 100).toFixed(1)}%)</dt>
            <dd>{formatMoney(chosen.feeMinor, quote.currency)}</dd>
          </div>
          <div className="kv">
            <dt><strong>Total</strong></dt>
            <dd><strong>{formatMoney(quote.itemMinor + chosen.feeMinor, quote.currency)}</strong></dd>
          </div>
          <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
            onClick={() => setPicking(true)}>
            Choose a different escrow
          </button>

          {/* Said before the button rather than after it is pressed: the escrow
              is chosen and priced, and the part that moves the money is not
              built. Offering a live Pay here would be the screen lying. */}
          <p className="notice notice--warn" style={{ marginBottom: 0 }}>
            <strong>Work in progress.</strong> Choosing an escrow and pricing their fee works;
            paying into one does not yet. Buy directly from the seller in the meantime.
          </p>
          <button className="btn btn--lg" disabled>
            Pay {formatMoney(quote.itemMinor + chosen.feeMinor, quote.currency)}
          </button>
        </div>
      )}

      <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={onCancel}>
        Cancel
      </button>

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
            // Closing without choosing leaves no half-made decision behind.
            if (!chosen) setRoute(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Paying the seller yourself, and proving you did.
 *
 * The details are theirs, copied as they typed them — this app is not moving
 * the money and must not imply it checked the account exists. What it can do is
 * make the buyer's proof part of the order, because the screenshot is the whole
 * of their case if the seller later says nothing arrived.
 */
function DirectPay({ quote, payment, busy, onPaid, onBack }: {
  quote: Checkout;
  payment: SellerPaymentDetails;
  busy: boolean;
  onPaid: (body: { reference: string; screenshot: string | null }) => void | Promise<void>;
  onBack: () => void;
}) {
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [shrinking, setShrinking] = useState(false);
  const [paid, setPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setShrinking(true);
    setError(null);
    try {
      setScreenshot(await downscale(file));
    } catch {
      setError('That image could not be read. A PNG or JPEG screenshot works.');
    } finally {
      setShrinking(false);
    }
  }

  const rows: [string, string | null | undefined][] = [
    ['UPI', payment.upiId],
    ['Account name', payment.accountName],
    ['Account number', payment.accountNumber],
    ['IFSC', payment.ifsc],
  ];

  return (
    <div className="stack">
      <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }} onClick={onBack}>
        ← Other ways to pay
      </button>

      <div className="card card--pad stack">
        <div className="row row--between">
          <strong>Send {formatMoney(quote.itemMinor, quote.currency)} to <PersonLink party={quote.seller} /></strong>
        </div>
        {rows.filter(([, value]) => value).map(([label, value]) => (
          <div className="kv" key={label}>
            <dt>{label}</dt>
            <dd><code>{value}</code></dd>
          </div>
        ))}
        {payment.instructions && <p className="faint" style={{ margin: 0 }}>{payment.instructions}</p>}
      </div>

      <p className="notice notice--info">
        Figmark is not handling this payment and is not holding anything. Once you have sent it,
        tell <PersonLink party={quote.seller} /> here — they confirm it landed before the order moves.
      </p>

      <label className="tick tick--wide">
        <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
        <span>I have sent the payment</span>
      </label>

      {paid && (
        <>
          <label className="field">
            <span>Transaction reference</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="The UTR or reference your app gave you" />
          </label>

          <label className="field">
            <span>Screenshot of the confirmation</span>
            <input type="file" accept="image/*" onChange={(e) => void pick(e.target.files?.[0])} />
            <span className="field__hint">
              {shrinking ? 'Reading it…' : 'Shrunk on this device before it is sent. One of these two is enough, both is better.'}
            </span>
          </label>

          {screenshot && (
            <img src={screenshot} alt="Your payment confirmation" className="proof" />
          )}

          {error && <ErrorNotice message={error} />}

          <button className="btn btn--lg" style={{ justifySelf: 'start' }}
            disabled={busy || shrinking || (!reference.trim() && !screenshot)}
            onClick={() => void onPaid({ reference: reference.trim(), screenshot })}>
            {busy ? 'Sending…' : 'Tell the seller I have paid'}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Shrink a screenshot to something an order can carry.
 *
 * Phone screenshots are two or three megabytes and a Cosmos item stops at two,
 * so this is not a nicety. Long edge to 900px and JPEG at 0.7 puts a legible
 * payment confirmation at well under a hundred kilobytes — the numbers on it
 * stay readable, which is the only thing it is for.
 */
async function downscale(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2d context');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.7);
}

/**
 * Choosing who holds the money.
 *
 * A real decision, so it gets a dialog rather than a dropdown: these are named
 * people with their own fees, and the buyer is picking who to trust with the
 * whole amount until the box lands. Each one opens to show what they have
 * actually done — held, settled, holding now — because that record is the only
 * honest basis for the choice, and an escrow with none says so rather than
 * showing five blank stars.
 *
 * Tapping a name expands it; the arrow adds them. Two steps on purpose: reading
 * about somebody should not be the same gesture as handing them the money.
 *
 * The suggestion is the one the rest of the lot already uses. A consignment is
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
  const [openId, setOpenId] = useState<string | null>(quote.suggested?.agentId ?? null);

  // Suggested first: it is the answer most buyers should give.
  const ordered = [...quote.escrows].sort((a, b) => {
    const suggested = quote.suggested?.agentId;
    return Number(b.id === suggested) - Number(a.id === suggested);
  });

  return (
    <Modal title="Who should hold your payment?" onClose={onClose}>
      <p className="faint" style={{ marginTop: 0 }}>
        An escrow holds {formatMoney(quote.itemMinor, quote.currency)} until you confirm the item
        arrived, and decides if you and <PersonLink party={quote.seller} /> cannot agree. Their fee is on top.
      </p>

      <div className="stack" style={{ marginTop: 12 }}>
        {ordered.map((option) => {
          const isSuggested = quote.suggested?.agentId === option.id;
          const open = openId === option.id;
          return (
            <div key={option.id} className={`escrow${chosenId === option.id ? ' is-on' : ''}`}>
              <button type="button" className="escrow__head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : option.id)}>
                <div className="escrow__main">
                  <span className="escrow__name">
                    {option.name}
                    {isSuggested && <span className="badge badge--accent" style={{ marginLeft: 8 }}>suggested</span>}
                  </span>
                  <span className="faint">
                    {option.rating !== null
                      ? `${option.rating.toFixed(1)} out of 5 · ${option.settled} settled`
                      : 'No payments settled yet'}
                  </span>
                </div>
                <div className="escrow__fee">
                  {formatMoney(option.feeMinor, quote.currency)}
                  <span className="faint"> · {(option.feeBasisPoints / 100).toFixed(1)}%</span>
                </div>
              </button>

              {open && (
                <div className="escrow__more">
                  <div className="escrow__stats">
                    <Stat label="Held" value={String(option.held)} />
                    <Stat label="Settled" value={String(option.settled)} />
                    <Stat label="Holding now" value={String(option.openNow)} />
                  </div>
                  <p className="faint" style={{ margin: 0 }}>
                    {isSuggested
                      ? quote.suggested!.because
                      : `Approved to hold payments since ${formatDate(option.since)}.`}
                  </p>
                  <div className="row row--between" style={{ alignItems: 'center' }}>
                    <span className="faint">
                      Total with their fee{' '}
                      <strong>{formatMoney(quote.itemMinor + option.feeMinor, quote.currency)}</strong>
                    </span>
                    {/* The arrow is the commitment, separate from reading about
                        them. Labelled for anybody not seeing the glyph. */}
                    <button type="button" className="escrow__add"
                      aria-label={`Use ${option.name} as the escrow`}
                      onClick={() => onPick(option)}>
                      →
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/** A number under a word, for the escrow's record. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="tile__value" style={{ fontSize: 'var(--t-md)' }}>{value}</div>
      <div className="tile__label">{label}</div>
    </div>
  );
}

/**
 * Answering a claimed payment.
 *
 * The seller is being asked about a fact only their own bank holds, so the
 * screen shows the buyer's evidence and then gets out of the way. Denying needs
 * a reason because the buyer has already sent money somewhere and "no" on its
 * own tells them nothing about what to do next.
 */
function SettleClaim({ order, busy, onAnswer, onCancel }: {
  order: Order;
  busy: boolean;
  onAnswer: (body: { accept: boolean; reason?: string }) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const claim = order.paymentClaim;
  // What this claim is actually for - not the order's full price, which is
  // what an advance or a further instalment is never asking to be confirmed
  // against. Absent only on a claim recorded before this field existed.
  const claimedMinor = claim?.amountMinor ?? order.unitPriceMinor * order.quantity;
  const money = orderMoney(order);
  const balanceAfter = Math.max(0, money.outstandingMinor - claimedMinor);
  const claimLabel = claim?.plan === 'additional' ? 'Additional payment'
    : claim?.plan === 'advance' ? 'Advance payment' : 'Full payment';

  return (
    <div className="stack">
      <div className="card card--pad stack claimcard">
        <div className="claimcard__hero">
          <span className="claimcard__label">{claimLabel}</span>
          <span className="claimcard__amount">{formatMoney(claimedMinor, order.currency)}</span>
        </div>
        <div className="kv"><dt>Already paid before this</dt><dd>{formatMoney(money.paidMinor, order.currency)}</dd></div>
        <div className="kv"><dt>Order total</dt><dd>{formatMoney(money.totalMinor, order.currency)}</dd></div>
        <div className="kv"><dt>Balance left if accepted</dt><dd>{formatMoney(balanceAfter, order.currency)}</dd></div>
        {claim?.reference && (
          <div className="kv"><dt>Reference</dt><dd><code>{claim.reference}</code></dd></div>
        )}
        {claim?.claimedAt && (
          <div className="kv"><dt>Said to be paid</dt><dd>{timeAgo(claim.claimedAt)}</dd></div>
        )}
        {claim?.screenshot ? (
          <img src={claim.screenshot} alt="The buyer's payment confirmation" className="proof" />
        ) : (
          <p className="faint" style={{ margin: 0 }}>No screenshot — they gave a reference only.</p>
        )}
      </div>

      <p className="faint" style={{ margin: 0 }}>
        Check your own account before answering. Accepting is you saying this {formatMoney(claimedMinor, order.currency)} is there.
      </p>

      {denying ? (
        <>
          <label className="field">
            <span>What is wrong</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              placeholder="Nothing has arrived, the amount is short, the reference does not match…" />
            <span className="field__hint">The buyer reads this and acts on it.</span>
          </label>
          <div className="row">
            <button className="btn btn--lg" disabled={busy || reason.trim().length < 4}
              onClick={() => void onAnswer({ accept: false, reason: reason.trim() })}>
              {busy ? 'Sending…' : 'It has not arrived'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setDenying(false)}>Back</button>
          </div>
        </>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn--lg" disabled={busy}
            onClick={() => void onAnswer({ accept: true })}>
            {busy ? 'Confirming…' : 'Yes, it arrived'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => setDenying(true)}>
            No, it has not
          </button>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/**
 * Turning an order down before it is accepted - the same dialog the orders
 * list offers, reachable from the order's own page too, so nothing here is a
 * row-only action.
 */
function RejectOrder({ order, busy, onReject, onClose }: {
  order: Order;
  busy: boolean;
  onReject: (reason: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal title="Turn this order down" onClose={onClose}>
      <div className="form">
        <p className="muted">
          {order.itemName} — {formatMoney(order.unitPriceMinor * order.quantity, order.currency)}.
        </p>
        <label className="field">
          <span>Why</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3}
            placeholder="Sold the last one this morning — sorry. Happy to put you first on the next run." />
          <span className="field__hint">
            They see this word for word. If they have already sent money, say what happens to it.
          </span>
        </label>
        <p className="notice notice--warn" style={{ margin: 0 }}>
          The stock goes back on sale and, if they paid, the payment is marked for refund. This
          cannot be undone — a new order would have to be placed.
        </p>
        <button type="button" className="btn btn--danger btn--block" disabled={busy || reason.trim().length < 4}
          onClick={() => void onReject(reason.trim())}>
          {busy ? 'Sending…' : 'Turn it down'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Calling off an order already accepted or placed.
 *
 * Distinct from the pre-acceptance Reject dialog on the orders list: the
 * buyer was already told yes, so the reason and the message to them matter
 * more, not less. If anything was paid, cancelling here starts the reversal
 * instead of finishing straight away — the money needs somewhere to go
 * first.
 */
function CancelOrder({ order, busy, onCancel, onClose }: {
  order: Order;
  busy: string | null;
  onCancel: (body: { reason: string; message?: string }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const paid = orderMoney(order).paidMinor > 0;

  return (
    <div className="stack">
      <label className="field">
        <span>Why is this being cancelled</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
          placeholder="Out of stock, buyer requested it, could not fulfil…" />
      </label>
      <label className="field">
        <span>Message to the buyer</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
          placeholder={`Your order for ${order.itemName} has been cancelled${reason ? `: ${reason}` : '.'}`} />
        <span className="field__hint">Sent to them as a message. Edit it, or leave it blank for the default.</span>
      </label>
      {paid && (
        <p className="notice notice--warn" style={{ margin: 0 }}>
          Money has already been paid on this order. Cancelling starts a payment reversal — the order
          moves to <strong>Payment Reversal Pending</strong> until it is recorded.
        </p>
      )}
      <div className="row">
        <button type="button" className="btn btn--danger" disabled={busy !== null || reason.trim().length < 4}
          onClick={() => void onCancel({ reason: reason.trim(), message: message.trim() || undefined })}>
          {busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Back</button>
      </div>
    </div>
  );
}

/**
 * The reversal of a paid, cancelled order - one step at a time.
 *
 * Refuses to let the seller submit proof until the buyer has somewhere for
 * the money to go, and offers the nudge-the-buyer message instead.
 */
function ReversalPanel({ order, buyerHasReversalDetails, busy, onRequestDetails, onSubmit, onClose }: {
  order: Order;
  buyerHasReversalDetails: boolean | null;
  busy: string | null;
  onRequestDetails: (message?: string) => void | Promise<void>;
  onSubmit: (body: { reference?: string; screenshot?: string }) => void | Promise<void>;
  onClose: () => void;
}) {
  const [reference, setReference] = useState('');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const reversal = order.reversal;

  if (buyerHasReversalDetails === false) {
    return (
      <div className="stack">
        <p className="notice notice--warn" style={{ margin: 0 }}>
          The buyer has not added their Payment Reversal Details yet, so there is nowhere to send
          {' '}{formatMoney(reversal?.amountMinor ?? 0, order.currency)} back to.
        </p>
        <label className="field">
          <span>Message to the buyer</span>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
            placeholder={`Your order for ${order.itemName} is being cancelled and your payment will be reversed. `
              + 'Please update your Payment Reversal Details so we can send it back.'} />
        </label>
        <div className="row">
          <button type="button" className="btn" disabled={busy !== null}
            onClick={() => void onRequestDetails(message.trim() || undefined)}>
            {busy === 'request-details' ? 'Sending…' : 'Send reminder'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="kv"><dt>Reversal amount</dt><dd>{formatMoney(reversal?.amountMinor ?? 0, order.currency)}</dd></div>
      <label className="field">
        <span>Transaction reference</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / reference" />
      </label>
      <label className="field">
        <span>Screenshot of the reversal (optional if you have a reference)</span>
        <input type="file" accept="image/*"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void downscale(file).then(setScreenshot); }} />
      </label>
      {screenshot && <img src={screenshot} alt="Reversal proof" className="proof" />}
      <div className="row">
        <button type="button" className="btn" disabled={busy !== null || (!reference.trim() && !screenshot)}
          onClick={() => void onSubmit({ reference: reference.trim() || undefined, screenshot: screenshot ?? undefined })}>
          {busy === 'submit-reversal' ? 'Recording…' : 'Payment Reversed'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Close</button>
      </div>
    </div>
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
