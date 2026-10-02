import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SerialButton } from '@shared/buttons';
import { Modal } from './ui';

type ItemButton = Extract<SerialButton, { kind: 'item' }>;

/** What the line draws: one of the item's own buttons, or the single stop for the lot's moves. */
type Entry =
  | { kind: 'item'; button: ItemButton }
  | { kind: 'lot'; done: boolean; step: string };

/**
 * An item's buttons in a lot, one after another with arrows between them.
 *
 * Only the item's own presses are buttons here (received, packed, ready,
 * dispatched, delivered and the shop's custom ones). The lot's moves happen
 * to the whole crate, so they are one stop on the line - "Lot" - at the point
 * in the route where the crate takes over, and it opens the lot's Tracking,
 * where the crate is moved. Every press of the item's own asks first: each
 * one changes what a buyer reads.
 */
export function SerialButtons({ buttons, busy, who, onItem, onLot, orderLink }: {
  buttons: readonly SerialButton[];
  busy: boolean;
  /** Named in every confirmation, so nobody confirms the wrong parcel. */
  who: { itemName: string; buyerName: string };
  onItem: (key: string, on: boolean) => void | Promise<void>;
  /** The Lot stop: takes the seller to the lot's Tracking. */
  onLot: () => void;
  /** Dispatched asks for the courier and AWB, which the order page takes. */
  orderLink?: { to: string; state?: unknown };
}) {
  const [asking, setAsking] = useState<{ button: ItemButton; on: boolean } | null>(null);

  /* The lot's moves fold into one stop, where the first of them falls. */
  const entries: Entry[] = [];
  const lotSteps = buttons.filter((button) => button.kind === 'lot');
  for (const button of buttons) {
    if (button.kind === 'item') entries.push({ kind: 'item', button });
    else if (!entries.some((entry) => entry.kind === 'lot')) {
      const ahead = lotSteps.find((step) => !step.done);
      entries.push({
        kind: 'lot',
        done: !ahead,
        step: (ahead ?? lotSteps[lotSteps.length - 1])?.step ?? '',
      });
    }
  }
  const doneOf = (entry: Entry) => (entry.kind === 'lot' ? entry.done : entry.button.done);
  const nextAt = entries.findIndex((entry) => !doneOf(entry));
  const doneCount = entries.filter(doneOf).length;

  function confirm() {
    if (!asking) return;
    const { button, on } = asking;
    setAsking(null);
    void onItem(button.key, on);
  }

  return (
    <div className="serial">
      <div className="serial__head">
        <span>Route</span>
        <span className="serial__count">{doneCount}/{entries.length}</span>
      </div>
      <ol className="serial__list">
        {entries.map((entry, index) => {
          const done = doneOf(entry);
          const state = done ? 'done' : index === nextAt ? 'next' : 'later';
          const className = `serial__btn serial__btn--${state} serial__btn--${entry.kind}`;
          const arrow = index > 0 && <span className="serial__arrow" aria-hidden="true">→</span>;

          if (entry.kind === 'lot') {
            return (
              <li key="lot">
                {arrow}
                <button type="button" className={className}
                  title={done ? 'The lot has done its part — open its Tracking' : `Open the lot's Tracking to move it — next: ${entry.step}`}
                  onClick={onLot}>
                  <span className="serial__n" aria-hidden="true">{done ? '✓' : '🚢'}</span>
                  <span className="serial__label">Lot</span>
                </button>
              </li>
            );
          }

          const { button } = entry;
          const body = (
            <>
              <span className="serial__n" aria-hidden="true">{done ? '✓' : index + 1}</span>
              <span className="serial__label">{button.label}</span>
            </>
          );
          /* Dispatched is pressed on the order, where the courier and AWB go in. */
          if (button.lastMile === 'dispatched' && !done && orderLink) {
            return (
              <li key={button.key}>
                {arrow}
                <Link to={orderLink.to} state={{ ...(orderLink.state as object | undefined), act: 'dispatched' }}
                  className={className} title="Opens the order for the courier and AWB">
                  {body}
                </Link>
              </li>
            );
          }
          return (
            <li key={button.key}>
              {arrow}
              <button type="button" className={className} disabled={busy}
                title={done ? `Done — press to undo: ${button.step}` : `Moves this item to: ${button.step}`}
                onClick={() => setAsking({ button, on: !done })}>
                {body}
              </button>
            </li>
          );
        })}
      </ol>

      {asking && (
        <Modal title={asking.on ? 'Confirm this step' : 'Undo this step?'} onClose={() => setAsking(null)}>
          <div className="stack">
            {asking.on ? (
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
            <button type="button" className={`btn btn--block${asking.on ? '' : ' btn--danger'}`}
              disabled={busy} onClick={confirm}>
              {asking.on ? `Yes — ${asking.button.label}` : 'Undo it'}
            </button>
            <button type="button" className="btn btn--quiet btn--block" onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
