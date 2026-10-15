import { useEffect, useRef, useState, type ReactNode } from 'react';
import { nextButton } from '@shared/buttons';
import { inLot, isDirect } from '@shared/fulfilment';
import { useNavigate } from 'react-router-dom';
import { ReceivedDialog } from './ReceivedDialog';
import type { OrderCheckpoint } from '@shared/enums';
import { NOT_ACCEPTED_MESSAGE, awaitingAcceptance, isStopped } from '@shared/orders';
import { stepButtonLabel, stepTickKey, ticksOf, type RouteStep, type StepAssignee } from '@shared/routes';
import { ApiRequestError, api, type OrderState } from '../api';
import { formatDate } from '../format';
import { ErrorNotice, Modal } from './ui';
import { useUndo } from './Undo';

/** A button on a rung: the one to press next, one already pressed, or one further on, not open yet. */
export type StepButtonState = 'done' | 'next' | 'later';

type Vars = { origin?: string | null; destination?: string | null };

/**
 * Where a timeline's buttons stand.
 *
 * They go one at a time: the next one opens once the one before it is
 * pressed, and only the last one pressed - the one the item is on - can be
 * taken back. None is next while the lot still has to carry the item there.
 */
export function timelineButtons(
  steps: readonly RouteStep[],
  current: number,
  pressed: (key: string) => boolean,
): { next: number; waitingOnLot: boolean } {
  const found = nextButton(steps, current, pressed);
  return {
    next: found && 'step' in found ? found.index : -1,
    waitingOnLot: Boolean(found && found.index < 0),
  };
}

/**
 * How a keyed rung's button is drawn, and whether a pressed one may be
 * undone: only the last one pressed, and only while the item is still on its
 * step - not once a later button, or the lot, has moved it on.
 */
export function buttonStateAt(
  steps: readonly RouteStep[], index: number, current: number, next: number, pressed: (key: string) => boolean,
): { state: StepButtonState; undoable: boolean } {
  const key = stepTickKey(steps[index]!);
  if (key && pressed(key)) {
    const laterPressed = steps.slice(index + 1).some((step) => {
      const other = stepTickKey(step);
      return other !== null && pressed(other);
    });
    return { state: 'done', undoable: index >= current && !laterPressed };
  }
  return { state: index === next ? 'next' : 'later', undoable: false };
}

/**
 * The seller's button on one rung of a timeline: the tick that reaches this
 * step, in the words the route gave it. The same button on a real order and
 * in the Route Studio's preview, so what a seller tries there is what they
 * press here. The next one is big; a pressed one is a small tick that undoes.
 */
export function StepButton({ step, state, undoable = state === 'done', busy = false, vars, onPress, children }: {
  step: Pick<RouteStep, 'trigger' | 'button' | 'name' | 'custom' | 'assignee'>;
  state: StepButtonState;
  /** A pressed button that is not the last one pressed stays a plain tick: undo the later ones first. */
  undoable?: boolean;
  busy?: boolean;
  vars?: Vars;
  onPress: () => void;
  /** Anything else that belongs on this rung for the seller: courier details, a badge. */
  children?: ReactNode;
}) {
  const label = stepButtonLabel(step, vars);
  const shut = state === 'later' || (state === 'done' && !undoable);
  return (
    <span className="stepact">
      <button type="button" className={`stepact__btn is-${state}`} disabled={busy || shut} aria-pressed={state === 'done'}
        title={state === 'done'
          ? (undoable ? `${label} - pressed. Tap to undo.` : `${label} - pressed. Undo the steps after it first.`)
          : state === 'later' ? 'Opens once the button before it is pressed' : `Press when this has happened: ${step.name}`}
        onClick={onPress}>
        <span aria-hidden="true">{state === 'done' ? '✓' : state === 'later' ? '🔒' : '⚡'}</span>
        {label}
        {state === 'done' && undoable && <span className="stepact__undo">undo</span>}
      </button>
      {step.assignee && state === 'next' && <AssigneeTag who={step.assignee} />}
      {children}
    </span>
  );
}

/** Who else may press a button, said beside it. */
export function AssigneeTag({ who }: { who: StepAssignee }) {
  return (
    <span className={`stepact__who is-${who}`}>
      {who === 'supplier' ? '🏭 Supplier' : who === 'forwarder' ? '✈️ Forwarder' : '🧑‍🔧 Handler'} can press this too
    </span>
  );
}

/** What sits on the rung after the item's own when the lot, not a button, moves it next. */
export function LotMoves({ onOpen }: { onOpen?: () => void }) {
  return (
    <span className="stepact">
      <span className="stepact__wait">🚢 Moved from the lot's Tracking</span>
      {onOpen && (
        <button type="button" className="ladder__act ladder__act--move" onClick={onOpen}>Open the lot →</button>
      )}
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
export function useStepActs(
  state: OrderState | null,
  onDone: () => void | Promise<void>,
  /** Opened from an order card's Dispatched or Delivered button: ask straight away. */
  opening?: OrderCheckpoint | null,
  /** The lot's countries, for the words on the buttons. */
  vars?: Vars,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shipping, setShipping] = useState(false);
  const [asking, setAsking] = useState(false);
  /** The warehouse button pressed with no lot yet: asking where, or to put it in one. */
  const [receiving, setReceiving] = useState(false);
  const navigate = useNavigate();
  const opened = useRef(false);
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');

  const order = state?.order;
  const offerUndo = useUndo();
  const live = Boolean(state && order && state.side === 'seller' && order.placedAt !== null && !isStopped(order.status));

  async function tick(checkpoint: string, on: boolean, shipment?: { courier?: string; awb?: string; label?: string }) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.setCheckpoint(order.id, checkpoint, on, shipment);
      const undo = result.undo;
      if (undo) {
        offerUndo({
          label: `${order.itemName} updated`,
          until: undo.until,
          undo: async () => { await api.setCheckpoint(order.id, checkpoint, !on, undefined, undo.id); },
          onUndone: () => void onDone(),
        });
      }
      setShipping(false);
      setAsking(false);
      setReceiving(false);
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
  const released = order.hold.state === 'released';
  const held = order.hold.state === 'held';

  function openShipping() {
    setCourier(order!.shipment?.courier ?? '');
    setAwb(order!.shipment?.awb ?? '');
    setShipping(true);
  }

  function press(step: RouteStep, pressed: boolean) {
    const checkpoint = stepTickKey(step)!;
    if (pressed) {
      void tick(checkpoint, false);
      return;
    }
    if (checkpoint === 'dispatched') { openShipping(); return; }
    if (checkpoint === 'china_received' && !inLot(order!) && !isDirect(order!)) { setReceiving(true); return; }
    if (checkpoint === 'delivered') { setAsking(true); return; }
    void tick(checkpoint, true);
  }

  const ticks = ticksOf(order);
  const pressedNow = (key: string) => Boolean(ticks[key]) || (key === 'delivered' && delivered);

  function actFor(current: number) {
    return (step: RouteStep, index: number, steps: readonly RouteStep[]): ReactNode => {
      const at = timelineButtons(steps, current, pressedNow);
      const checkpoint = stepTickKey(step);
      if (!checkpoint) {
        return at.waitingOnLot && index === current + 1
          ? <LotMoves onOpen={order!.lotId ? () => navigate(`/shop?tab=lots&lot=${encodeURIComponent(order!.lotId!)}`) : undefined} />
          : null;
      }
      const pressed = pressedNow(checkpoint);
      const { state: shown, undoable } = buttonStateAt(steps, index, current, at.next, pressedNow);
      // A booking the seller has not accepted cannot be shipped or handed
      // over; the Accept button above is the way forward.
      if (shown === 'next' && (checkpoint === 'dispatched' || checkpoint === 'delivered') && awaitingAcceptance(order!)) {
        return <span className="field__hint">{NOT_ACCEPTED_MESSAGE}</span>;
      }
      /* Undoing is not offered where it would undo something else too: a
         dispatch once delivered, a delivery the buyer has already confirmed. */
      const frozen = pressed && ((checkpoint === 'dispatched' && delivered) || (checkpoint === 'delivered' && (received || released)));
      return (
        <StepButton step={step} state={shown} undoable={undoable && !frozen} busy={busy} vars={vars}
          onPress={() => press(step, pressed)}>
          {checkpoint === 'dispatched' && dispatched && !delivered && (
            <button type="button" className="ladder__act" disabled={busy} onClick={openShipping}>
              {order!.shipment ? '✏️ Courier & AWB' : '➕ Courier & AWB'}
            </button>
          )}
          {checkpoint === 'delivered' && delivered && (received || released) && (
            <span className="badge badge--ok">{received ? '📬 Buyer confirmed' : 'Delivered'}{released ? ' · paid out' : ''}</span>
          )}
          {checkpoint === 'dispatched' && shown === 'next' && held && (
            <span className="field__hint">Starts the {state!.autoReleaseDays}-day protection window.</span>
          )}
          {checkpoint === 'delivered' && delivered && !received && held && (
            <span className="field__hint">
              Waiting for the buyer to confirm{order!.hold.autoReleaseAt ? ` — releases on ${formatDate(order!.hold.autoReleaseAt)} if no dispute` : ''}.
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

      {receiving && (
        <ReceivedDialog itemName={order.itemName} busy={busy}
          onLot={() => navigate(`/shop?tab=lots&spotlight=new&file=${encodeURIComponent(order.id)}`)}
          onPick={(label) => void tick('china_received', true, { label })}
          onClose={() => setReceiving(false)} />
      )}

    </>
  );

  return { actFor, dialogs };
}
