import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { labelFor } from '@shared/fulfilment';
import { AUTO_RELEASE_DAYS, REVIEW_REVEAL_DAYS, type OrderSide } from '@shared/orders';
import { reasonsFor } from '@shared/disputes';
import { DISPUTE_REASON_LABELS } from '@shared/enums';
import type { Order, SellerPaymentDetails } from '@shared/models';
import {
  ApiRequestError, api,
  type Checkout, type EscrowOption, type EvidenceDraft, type OrderState, type OrderTracking,
} from '../api';
import { ErrorNotice, Icon, Modal, PersonLink } from '../components/ui';
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
            {state.side === 'seller' ? 'Sold to' : 'From'} <PersonLink party={state.counterparty} /> · ordered{' '}
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
  // An unpaid order is a checkout, so it opens as one. There is nothing else to
  // do on it, and making the buyer press Pay to reach the question of how to pay
  // put a step in front of the only decision on the screen.
  const [paying, setPaying] = useState(() => state.actions.includes('pay'));
  const [settling, setSettling] = useState(false);
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
      setSettling(false);
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
        <p className="notice notice--info">
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
          </div>

          {paying && (
            <BuyPanel
              order={order}
              busy={busy}
              onPaid={(body) => run('claim', () => api.claimPayment(order.id, body))}
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
function BuyPanel({ order, busy, onPaid, onCancel }: {
  order: Order;
  busy: string | null;
  onPaid: (body: { reference: string; screenshot: string | null }) => void | Promise<void>;
  onCancel: () => void;
}) {
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

  if (route === 'direct' && quote.sellerPayment) {
    return (
      <DirectPay
        quote={quote}
        payment={quote.sellerPayment}
        busy={busy === 'claim'}
        onPaid={onPaid}
        onBack={() => setRoute(null)}
      />
    );
  }

  return (
    <div className="stack">
      <div className="kv"><dt>Item</dt><dd>{formatMoney(quote.itemMinor, quote.currency)}</dd></div>

      <button type="button" className="buyway" disabled={!canPayDirect}
        onClick={() => setRoute('direct')}>
        <span className="buyway__title">Buy directly from the seller</span>
        <span className="buyway__note">
          {canPayDirect
            ? <>Pay <PersonLink party={quote.seller} /> yourself, then show them it went through. Nothing is held, so anything that goes wrong is between the two of you.</>
            : <><PersonLink party={quote.seller} /> has not added any payment details, so there is nowhere to send the money.</>}
        </span>
        <span className="buyway__price">{formatMoney(quote.itemMinor, quote.currency)}</span>
      </button>

      <button type="button" className={`buyway${route === 'protected' ? ' is-on' : ''}`}
        disabled={!canProtect}
        onClick={() => {
          setRoute('protected');
          if (!chosen) setPicking(true);
        }}>
        <span className="buyway__title">Add buyer protection</span>
        <span className="buyway__note">
          {canProtect
            ? 'An escrow holds the money until you confirm the item arrived, and settles it if the two of you disagree. Their fee is on top.'
            : 'Nobody approved to hold payments can be neutral in this trade.'}
        </span>
        <span className="buyway__price">
          {chosen
            ? formatMoney(quote.itemMinor + chosen.feeMinor, quote.currency)
            : `${formatMoney(quote.itemMinor, quote.currency)} + fee`}
        </span>
      </button>

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

  return (
    <div className="stack">
      <div className="card card--pad stack">
        <div className="kv">
          <dt>Amount</dt>
          <dd>{formatMoney(order.unitPriceMinor * order.quantity, order.currency)}</dd>
        </div>
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
        Check your own account before answering. Accepting is you saying the money is there.
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
