import { useEffect, useRef, useState, type ReactNode } from 'react';
import { nextButton } from '@shared/buttons';
import { isDirect } from '@shared/fulfilment';
import type { OrderCheckpoint } from '@shared/enums';
import { isStopped } from '@shared/orders';
import { stepButtonLabel, type RouteStep, type StepTrigger } from '@shared/routes';
import { ApiRequestError, api, type OrderState } from '../api';
import { formatDate } from '../format';
import { ErrorNotice, Modal } from './ui';

/** A button on a rung: the one to press next, or one already pressed. */
export type StepButtonState = 'done' | 'next';

type Vars = { origin?: string | null; destination?: string | null };

/**
 * Where a timeline's buttons stand.
 *
 * One button is ever offered: the first one past where the item is, not yet
 * pressed - the same one its order card shows. None while the lot still has
 * to carry it there. Everything further on is not drawn at all; a parcel that
 * outruns the screen is caught by "something further on already happened?",
 * which lists them on purpose rather than leaving them lying on every rung.
 */
export function timelineButtons(
  steps: readonly RouteStep[],
  current: number,
  pressed: (trigger: StepTrigger) => boolean,
): { next: number; waitingOnLot: boolean; later: { step: RouteStep; index: number }[] } {
  const found = nextButton(steps, current, pressed);
  const next = found && 'step' in found ? found.index : -1;
  const from = next >= 0 ? next : current;
  return {
    next,
    waitingOnLot: Boolean(found && found.index < 0),
    later: steps
      .map((step, index) => ({ step, index }))
      .filter(({ step, index }) => index > from && step.trigger && !pressed(step.trigger)),
  };
}

/**
 * The seller's button on one rung of a timeline: the tick that reaches this
 * step, in the words the route gave it. The same button on a real order and
 * in the Route Studio's preview, so what a seller tries there is what they
 * press here. The next one is big; a pressed one is a small tick that undoes.
 */
export function StepButton({ step, state, busy = false, vars, onPress, children }: {
  step: Pick<RouteStep, 'trigger' | 'button' | 'name'>;
  state: StepButtonState;
  busy?: boolean;
  vars?: Vars;
  onPress: () => void;
  /** Anything else that belongs on this rung for the seller: courier details, a badge. */
  children?: ReactNode;
}) {
  const label = stepButtonLabel(step, vars);
  return (
    <span className="stepact">
      <button type="button" className={`stepact__btn is-${state}`} disabled={busy} aria-pressed={state === 'done'}
        title={state === 'done' ? `${label} - pressed. Tap to undo.` : `Press when this has happened: ${step.name}`}
        onClick={onPress}>
        <span aria-hidden="true">{state === 'done' ? '✓' : '⚡'}</span>
        {label}
        {state === 'done' && <span className="stepact__undo">undo</span>}
      </button>
      {children}
    </span>
  );
}

/** What sits on the rung after the item's own when the lot, not a button, moves it next. */
export function LotMoves({ onSkip }: { onSkip?: () => void }) {
  return (
    <span className="stepact">
      <span className="stepact__wait">🚢 The lot moves this one</span>
      {onSkip && <SkipLink onClick={onSkip} />}
    </span>
  );
}

/** The way to press a button further on, kept small: the screen being behind is the exception. */
export function SkipLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="stepact__skip" onClick={onClick}>
      Something further on already happened?
    </button>
  );
}

/** The buttons further on, listed so one can be pressed on purpose. */
export function SkipPicker({ later, vars, onPick, onClose }: {
  later: { step: RouteStep; index: number }[];
  vars?: Vars;
  onPick: (step: RouteStep) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Already happened?" onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>
          Pick what has happened. The timeline jumps to it, and the steps before it count as done.
        </p>
        <div className="stepact__later">
          {later.map(({ step }) => (
            <button key={step.id} type="button" className="stepact__pick" onClick={() => onPick(step)}>
              <span aria-hidden="true">⚡</span>
              <span className="stepact__pick-label">{stepButtonLabel(step, vars)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>Not yet</button>
      </div>
    </Modal>
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
export function useStepActs(
  state: OrderState | null,
  onDone: () => void | Promise<void>,
  /** Opened from an order card's Dispatched or Delivered button: ask straight away. */
  opening?: OrderCheckpoint | null,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipping, setShipping] = useState(false);
  const [asking, setAsking] = useState(false);
  const [picking, setPicking] = useState<{ step: RouteStep; index: number }[] | null>(null);
  const opened = useRef(false);
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

  /* Once, when the order is first there to act on. */
  useEffect(() => {
    if (opened.current || !live || !order || !opening) return;
    opened.current = true;
    if (opening === 'dispatched' && !order.checkpoints?.dispatched) {
      setCourier(order.shipment?.courier ?? '');
      setAwb(order.shipment?.awb ?? '');
      setShipping(true);
    }
    if (opening === 'delivered' && order.status !== 'delivered') setAsking(true);
  }, [live, order, opening]);

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

  const pressedNow = (checkpoint: StepTrigger) =>
    Boolean(order.checkpoints?.[checkpoint]) || (checkpoint === 'delivered' && delivered);

  function actFor(current: number) {
    return (step: RouteStep, index: number, steps: readonly RouteStep[]): ReactNode => {
      const at = timelineButtons(steps, current, pressedNow);
      if (!step.trigger) {
        return at.waitingOnLot && index === current + 1
          ? <LotMoves onSkip={at.later.length ? () => setPicking(at.later) : undefined} />
          : null;
      }
      const checkpoint = step.trigger;
      const pressed = pressedNow(checkpoint);
      if (!pressed && index !== at.next) return null;
      /* Undoing is not offered where it would undo something else too: a
         dispatch once delivered, a delivery the buyer has already confirmed. */
      const frozen = pressed && ((checkpoint === 'dispatched' && delivered) || (checkpoint === 'delivered' && (received || released)));
      return (
        <StepButton step={step} state={pressed ? 'done' : 'next'} busy={busy || frozen}
          onPress={() => press(step, pressed)}>
          {checkpoint === 'dispatched' && dispatched && !delivered && (
            <button type="button" className="ladder__act" disabled={busy} onClick={openShipping}>
              {order!.shipment ? '✏️ Courier & AWB' : '➕ Courier & AWB'}
            </button>
          )}
          {checkpoint === 'delivered' && delivered && (received || released) && (
            <span className="badge badge--ok">{received ? '📬 Buyer confirmed' : 'Delivered'}{released ? ' · paid out' : ''}</span>
          )}
          {checkpoint === 'dispatched' && !pressed && held && (
            <span className="field__hint">Starts the {state!.autoReleaseDays}-day protection window.</span>
          )}
          {checkpoint === 'delivered' && delivered && !received && held && (
            <span className="field__hint">
              Waiting for the buyer to confirm{order!.escrow.autoReleaseAt ? ` — releases on ${formatDate(order!.escrow.autoReleaseAt)} if no dispute` : ''}.
            </span>
          )}
          {!pressed && at.later.length > 0 && <SkipLink onClick={() => setPicking(at.later)} />}
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

      {picking && (
        <SkipPicker later={picking} onClose={() => setPicking(null)}
          onPick={(step) => { setPicking(null); press(step, false); }} />
      )}
    </>
  );

  return { actFor, dialogs };
}
