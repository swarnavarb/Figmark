import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SerialButton } from '@shared/buttons';
import { Modal } from './ui';

type LotButton = Extract<SerialButton, { kind: 'lot' }>;

/**
 * Every button an item in a lot has, one after another.
 *
 * The route's own presses (received, packed, ready, dispatched, delivered and
 * the shop's custom ones) and the lot's moves sit on one numbered line in the
 * order they happen, so the next thing to do is the first one not yet lit.
 * Drawn the same on the order card and in the lot's Tracking, and every press
 * asks first - each one changes what a buyer reads.
 */
export function SerialButtons({ buttons, busy, who, onItem, onLot, onGated, orderLink }: {
  buttons: readonly SerialButton[];
  busy: boolean;
  /** Named in every confirmation, so nobody confirms the wrong parcel. */
  who: { itemName: string; buyerName: string; lotName: string };
  onItem: (key: string, on: boolean) => void | Promise<void>;
  onLot: (button: LotButton) => void | Promise<void>;
  /** A lot move that would carry items past the warehouse unticked: go and check them in. */
  onGated?: (button: LotButton) => void;
  /** Dispatched asks for the courier and AWB, which the order page takes. */
  orderLink?: { to: string; state?: unknown };
}) {
  const [asking, setAsking] = useState<{ button: SerialButton; on: boolean } | null>(null);
  const nextAt = buttons.findIndex((button) => !button.done);
  const doneCount = buttons.filter((button) => button.done).length;

  function confirm() {
    if (!asking) return;
    const { button, on } = asking;
    setAsking(null);
    if (button.kind === 'item') void onItem(button.key, on);
    else void onLot(button);
  }

  return (
    <div className="serial">
      <div className="serial__head">
        <span>Route</span>
        <span className="serial__count">{doneCount}/{buttons.length}</span>
      </div>
      <ol className="serial__list">
        {buttons.map((button, index) => {
          const state = button.done ? 'done' : index === nextAt ? 'next' : 'later';
          const className = `serial__btn serial__btn--${state} serial__btn--${button.kind}`;
          const body = (
            <>
              <span className="serial__n" aria-hidden="true">{button.done ? '✓' : index + 1}</span>
              <span className="serial__label">{button.label}</span>
              {button.kind === 'lot' && <span className="serial__tag">🚢 Lot</span>}
            </>
          );
          /* Dispatched is pressed on the order, where the courier and AWB go in. */
          if (button.kind === 'item' && button.lastMile === 'dispatched' && !button.done && orderLink) {
            return (
              <li key={`${button.kind}:${index}`}>
                <Link to={orderLink.to} state={{ ...(orderLink.state as object | undefined), act: 'dispatched' }}
                  className={className} title="Opens the order for the courier and AWB">
                  {body}
                </Link>
              </li>
            );
          }
          /* A lot already past a step cannot be moved back from an item. */
          const inert = button.kind === 'lot' && button.done;
          return (
            <li key={`${button.kind}:${index}`}>
              <button type="button" className={className} disabled={busy || inert}
                title={button.kind === 'lot'
                  ? button.done ? 'The lot is past this step' : `Moves the whole lot to: ${button.step}`
                  : button.done ? `Done — press to undo: ${button.step}` : `Moves this item to: ${button.step}`}
                onClick={() => setAsking({ button, on: !button.done })}>
                {body}
              </button>
            </li>
          );
        })}
      </ol>

      {asking && (
        <Modal
          title={asking.button.kind === 'lot'
            ? asking.button.gated ? 'Not all items are checked in' : 'Move the whole lot?'
            : asking.on ? 'Confirm this step' : 'Undo this step?'}
          onClose={() => setAsking(null)}>
          <div className="stack">
            {asking.button.kind === 'lot' ? (
              asking.button.gated ? (
                <p>
                  Some items in <strong>{who.lotName}</strong> have not been marked received at the
                  international warehouse. Moving the lot to <strong>{asking.button.label}</strong> would
                  carry them past a checkpoint they have not reached.
                </p>
              ) : (
                <p>
                  <strong>{who.lotName}</strong> moves to <strong>{asking.button.label}</strong>. Every
                  item in it moves with it, and every buyer in it reads the new step.
                </p>
              )
            ) : asking.on ? (
              <p>
                <strong>{asking.button.label}</strong> for <strong>{who.itemName}</strong>
                {' '}({who.buyerName}). Their tracking moves to “{asking.button.step}”.
                {asking.button.lastMile === 'delivered' && (
                  <> They are told it arrived and can review it. A payment under buyer protection is
                  not released by this; once every item in the lot is delivered, the lot closes itself.</>
                )}
              </p>
            ) : (
              <p>
                Take back <strong>{asking.button.label}</strong> on <strong>{who.itemName}</strong>
                {' '}({who.buyerName})? Their tracking goes back to the step before.
              </p>
            )}

            {asking.button.kind === 'lot' && asking.button.gated ? (
              onGated && (
                <button type="button" className="btn btn--block"
                  onClick={() => { const button = asking.button as LotButton; setAsking(null); onGated(button); }}>
                  Check the items in
                </button>
              )
            ) : (
              <button type="button" className={`btn btn--block${asking.on ? '' : ' btn--danger'}`}
                disabled={busy} onClick={confirm}>
                {asking.button.kind === 'lot'
                  ? `🚢 Move lot to ${asking.button.label}`
                  : asking.on ? `Yes — ${asking.button.label}` : 'Undo it'}
              </button>
            )}
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
