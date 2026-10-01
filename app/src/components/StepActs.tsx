import { useState, type ReactNode } from 'react';
import { isDirect } from '@shared/fulfilment';
import type { OrderCheckpoint } from '@shared/enums';
import { isStopped } from '@shared/orders';
import { stepButtonLabel, type RouteStep } from '@shared/routes';
import { ApiRequestError, api, type OrderState } from '../api';
import { formatDate } from '../format';
import { ErrorNotice, Modal } from './ui';

/** Where a step's button stands: pressed, within reach, or not yet. */
export type StepButtonState = 'done' | 'next' | 'locked';

/**
 * Pressed is pressed wherever it sits. Otherwise a button is within reach
 * once the step before it has been reached - the timeline unlocks one step
 * at a time - and locked past that.
 */
export function stepButtonState(index: number, current: number, pressed: boolean): StepButtonState {
  if (pressed) return 'done';
  return index <= current + 1 ? 'next' : 'locked';
}

/**
 * The seller's button on one rung of a timeline: the tick that reaches this
 * step, in the words the route gave it. The same button on a real order and
 * in the Route Studio's preview, so what a seller tries there is what they
 * press here.
 */
export function StepButton({ step, state, busy = false, onPress, children }: {
  step: Pick<RouteStep, 'trigger' | 'button' | 'name'>;
  state: StepButtonState;
  busy?: boolean;
  onPress: () => void;
  /** Anything else that belongs on this rung for the seller: courier details, a badge. */
  children?: ReactNode;
}) {
  const label = stepButtonLabel(step);
  return (
    <span className="stepact">
      <button type="button" className={`stepact__btn is-${state}`} disabled={busy} aria-pressed={state === 'done'}
        title={state === 'done' ? `${label} — pressed. Tap to undo.` : state === 'locked'
          ? `${label} — unlocks once the step before it is reached` : `Press when this happens: ${step.name}`}
        onClick={onPress}>
        <span aria-hidden="true">{state === 'done' ? '✓' : state === 'locked' ? '🔒' : '⚡'}</span>
        {label}
      </button>
      {children}
    </span>
  );
}

/**
 * Every button on a real order's timeline, and the two dialogs behind them.
 *
 * Dispatched asks for the courier and AWB; delivered asks first, because the
 * buyer is told and the protection clock is what it starts. Every other step
 * is one press. A step not yet reached can still be pressed - a parcel does
 * not wait for the screen - but it asks first, so it is never done by a slip.
 */
export function useStepActs(state: OrderState | null, onDone: () => void | Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipping, setShipping] = useState(false);
  const [asking, setAsking] = useState(false);
  const [skipping, setSkipping] = useState<RouteStep | null>(null);
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');

  const order = state?.order;
  const live = Boolean(state && order && state.side === 'seller' && order.placedAt !== null && !isStopped(order.status));

  async function tick(checkpoint: OrderCheckpoint, on: boolean, shipment?: { courier: string; awb: string }) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await api.setCheckpoint(order.id, checkpoint, on, shipment);
      setShipping(false);
      setAsking(false);
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!live || !state || !order) {
    return { actFor: (_current: number) => undefined, dialogs: null };
  }

  const dispatched = Boolean(order.checkpoints?.dispatched);
  const delivered = order.status === 'delivered';
  const received = Boolean(order.receivedAt);
  const released = order.escrow.state === 'released';
  const held = order.escrow.state === 'held';

  function openShipping() {
    setCourier(order!.shipment?.courier ?? '');
    setAwb(order!.shipment?.awb ?? '');
    setShipping(true);
  }

  function press(step: RouteStep, pressed: boolean) {
    const checkpoint = step.trigger!;
    if (pressed) {
      void tick(checkpoint, false);
      return;
    }
    if (checkpoint === 'dispatched') { openShipping(); return; }
    if (checkpoint === 'delivered') { setAsking(true); return; }
    void tick(checkpoint, true);
  }

  function actFor(current: number) {
    return (step: RouteStep, index: number): ReactNode => {
      if (!step.trigger) return null;
      const checkpoint = step.trigger;
      const pressed = Boolean(order!.checkpoints?.[checkpoint]) || (checkpoint === 'delivered' && delivered);
      const at = stepButtonState(index, current, pressed);
      /* Undoing is not offered where it would undo something else too: a
         dispatch once delivered, a delivery the buyer has already confirmed. */
      const frozen = pressed && ((checkpoint === 'dispatched' && delivered) || (checkpoint === 'delivered' && (received || released)));
      return (
        <StepButton step={step} state={at} busy={busy || frozen}
          onPress={() => (at === 'locked' ? setSkipping(step) : press(step, pressed))}>
          {checkpoint === 'dispatched' && dispatched && !delivered && (
            <button type="button" className="ladder__act" disabled={busy} onClick={openShipping}>
              {order!.shipment ? '✏️ Courier & AWB' : '➕ Courier & AWB'}
            </button>
          )}
          {checkpoint === 'delivered' && delivered && (received || released) && (
            <span className="badge badge--ok">{received ? '📬 Buyer confirmed' : 'Delivered'}{released ? ' · paid out' : ''}</span>
          )}
          {checkpoint === 'dispatched' && at === 'next' && held && (
            <span className="field__hint">Starts the {state!.autoReleaseDays}-day protection window.</span>
          )}
          {checkpoint === 'delivered' && delivered && !received && held && (
            <span className="field__hint">
              Waiting for the buyer to confirm{order!.escrow.autoReleaseAt ? ` — releases on ${formatDate(order!.escrow.autoReleaseAt)} if no dispute` : ''}.
            </span>
          )}
        </StepButton>
      );
    };
  }

  const dialogs = (
    <>
      {error && <ErrorNotice message={error} />}

      {shipping && (
        <Modal title={dispatched ? '🚚 Courier & AWB' : '🚚 Dispatch it'} onClose={() => setShipping(false)}>
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            void tick('dispatched', true, { courier: courier.trim(), awb: awb.trim() });
          }}>
            <p style={{ margin: 0 }}>
              {isDirect(order)
                ? 'Add the courier and AWB so the buyer can track their parcel.'
                : 'Add the courier and AWB for this parcel, if you have them.'}
            </p>
            <label className="field">
              <span>Courier name</span>
              <input value={courier} onChange={(event) => setCourier(event.target.value)} maxLength={80}
                placeholder="Delhivery, Blue Dart, DTDC…" autoFocus />
            </label>
            <label className="field">
              <span>AWB / tracking number</span>
              <input value={awb} onChange={(event) => setAwb(event.target.value)} maxLength={80}
                placeholder="e.g. 1234567890" className="mono" />
            </label>
            {!dispatched && (
              <span className="field__hint">
                No AWB yet? Dispatch now and add it later.
                {held ? ` This starts the ${state.autoReleaseDays}-day protection window.` : ''}
              </span>
            )}
            <button type="submit" className="btn btn--block"
              disabled={busy || (dispatched && !courier.trim() && !awb.trim())}>
              {busy ? 'Saving…' : dispatched ? 'Save details' : '🚚 Mark dispatched'}
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setShipping(false)}>Cancel</button>
          </form>
        </Modal>
      )}

      {asking && (
        <Modal title="Mark delivered?" onClose={() => setAsking(false)}>
          <div className="stack">
            <p style={{ margin: 0 }}>
              This tells <strong>{state.counterparty.name}</strong> that <strong>{order.itemName}</strong> has
              reached them. They can then add it to their collection and review the order.
              {held && ' It does not release the held payment - the buyer confirms that, or it releases on its own if they raise no dispute.'}
            </p>
            <button type="button" className="btn btn--block" disabled={busy}
              onClick={() => void tick('delivered', true)}>
              {busy ? 'Marking…' : 'Mark delivered'}
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {skipping && (
        <Modal title="Skip ahead?" onClose={() => setSkipping(null)}>
          <div className="stack">
            <p style={{ margin: 0 }}>
              <strong>{skipping.name}</strong> is further along than this item has got. Press{' '}
              <strong>{stepButtonLabel(skipping)}</strong> anyway? The timeline jumps to it.
            </p>
            <button type="button" className="btn btn--block" disabled={busy}
              onClick={() => { const step = skipping; setSkipping(null); press(step, false); }}>
              Yes, it happened
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setSkipping(null)}>Not yet</button>
          </div>
        </Modal>
      )}
    </>
  );

  return { actFor, dialogs };
}
