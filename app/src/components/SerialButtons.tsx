import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { SerialButton } from '@shared/buttons';
import { shortButtonLabel } from '@shared/routes';
import { Modal } from './ui';
import { ShipDialog, type Shipment } from './ShipDialog';

type ItemButton = Extract<SerialButton, { kind: 'item' }>;

/** What the line draws: one of the item's own buttons, or the single stop for the lot's moves. */
type Entry =
  | { kind: 'item'; button: ItemButton }
  | { kind: 'lot'; done: boolean; step: string };

/**
 * An item's buttons in a lot, one after another on an even grid, read left
 * to right: done ones carry a tick, the rest their place on the line.
 *
 * Only the item's own presses are buttons here (received, packed, ready,
 * dispatched, delivered and the shop's custom ones). The lot's moves happen
 * to the whole crate, so they are one stop on the line - "Lot" - at the point
 * in the route where the crate takes over, and it opens the lot's Tracking,
 * where the crate is moved. Every press of the item's own asks first: each
 * one changes what a buyer reads.
 */
export function SerialButtons({ buttons, busy, who, onItem, onLot, orderLink, stepOf, compact = false, shipHere = false, fold = false }: {
  buttons: readonly SerialButton[];
  busy: boolean;
  /** Named in every confirmation, so nobody confirms the wrong parcel. */
  who: { itemName: string; buyerName: string };
  onItem: (key: string, on: boolean, shipment?: Shipment) => void | Promise<void>;
  /** The Lot stop: takes the seller to the lot's Tracking. */
  onLot: () => void;
  /** Dispatched asks for the courier and AWB, which the order page takes. */
  orderLink?: { to: string; state?: unknown };
  /**
   * Where it is on the route, counted over every step - the one count every
   * screen uses. The buttons below are fewer than the steps (the lot's moves
   * fold into one stop), so their own tally is never the headline.
   */
  stepOf?: { at: number; of: number } | null;
  /** Small pills in a row, for an order on a slim row. */
  compact?: boolean;
  /** Dispatched asks for the courier and AWB right here, instead of on the order page. */
  shipHere?: boolean;
  /**
   * Folded to the one button that is next, with every step a tap away - for
   * a list, where a whole line of pills on every card is more than anyone reads.
   */
  fold?: boolean;
}) {
  const [asking, setAsking] = useState<{ button: ItemButton; on: boolean } | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const [shipping, setShipping] = useState<ItemButton | null>(null);

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
  /* One at a time, both ways: only the next one presses, and only the last
     one pressed takes back. */
  const lastDone = entries.reduce((last, entry, index) => (doneOf(entry) ? index : last), -1);

  function confirm() {
    if (!asking) return;
    const { button, on } = asking;
    setAsking(null);
    void onItem(button.key, on);
  }

  const dialogs = (
    <>
      {shipping && (
        <ShipDialog busy={busy} onClose={() => setShipping(null)}
          intro={<><b>{who.itemName}</b> for <b>{who.buyerName}</b>. Add the courier and AWB so they can track their parcel.</>}
          onSave={(shipment) => { const button = shipping; setShipping(null); void onItem(button.key, true, shipment); }} />
      )}

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
    </>
  );

  /* One stop on the line, drawn the same folded or open. */
  const stop = (entry: Entry, index: number) => {
    const done = doneOf(entry);
    const state = done ? 'done' : index === nextAt ? 'next' : 'later';
    const shut = entry.kind === 'item' && (state === 'later' || (done && index !== lastDone));
    const className = `serial__btn serial__btn--${state} serial__btn--${entry.kind}`;
    /* Each stop comes in after the one before it. */
    const style = { '--s': index } as CSSProperties;

    if (entry.kind === 'lot') {
      return (
        <li key="lot" style={style}>
          <button type="button" className={className}
            title={done ? 'The lot has done its part — open its Tracking' : `Open the lot's Tracking to move it — next: ${entry.step}`}
            onClick={onLot}>
            <span className="serial__n" aria-hidden="true">{done ? '✓' : index + 1}</span>
            <span className="serial__label">{fold && !unfolded ? 'Move lot' : 'Lot'}</span>
          </button>
        </li>
      );
    }

    const { button } = entry;
    const body = (
      <>
        <span className="serial__n" aria-hidden="true">{done ? '✓' : index + 1}</span>
        <span className="serial__label">{compact ? shortButtonLabel(button.key, button.label) : button.label}</span>
      </>
    );
    /* Dispatched is pressed on the order, where the courier and AWB go in. */
    if (button.lastMile === 'dispatched' && !done && shipHere && !shut) {
      return (
        <li key={button.key} style={style}>
          <button type="button" className={className} disabled={busy || shut} title="Asks for the courier and AWB"
            onClick={() => setShipping(button)}>
            {body}
          </button>
        </li>
      );
    }
    if (button.lastMile === 'dispatched' && !done && orderLink && !shut) {
      return (
        <li key={button.key} style={style}>
          <Link to={orderLink.to} state={{ ...(orderLink.state as object | undefined), act: 'dispatched' }}
            className={className} title="Opens the order for the courier and AWB">
            {body}
          </Link>
        </li>
      );
    }
    return (
      <li key={button.key} style={style}>
        <button type="button" className={className} disabled={busy || shut}
          title={shut ? (done ? 'Done. Undo the buttons after it first.' : 'Opens once the button before it is pressed')
            : done ? `Done — press to undo: ${button.step}` : `Moves this item to: ${button.step}`}
          onClick={() => setAsking({ button, on: !done })}>
          {body}
        </button>
      </li>
    );
  };

  const folded = fold && !unfolded;
  const allDone = doneCount === entries.length;
  const stepWord = stepOf ? `Step ${Math.min(stepOf.at + 1, stepOf.of)} of ${stepOf.of}` : 'Route';
  const tally = `${doneCount} of ${entries.length} ${entries.length === 1 ? 'button' : 'buttons'} done`;

  if (folded) {
    return (
      <div className={`serial serial--folded${compact ? ' serial--compact' : ''}`}>
        <div className="serial__fold">
          <span className="serial__where" title={tally}>
            {allDone ? '✓ All done' : stepWord}
            <span className="serial__meter" aria-hidden="true">
              <span style={{ width: `${entries.length ? (doneCount / entries.length) * 100 : 0}%` }} />
            </span>
          </span>
          {!allDone && nextAt >= 0 && <ol className="serial__list serial__list--one">{stop(entries[nextAt]!, nextAt)}</ol>}
          <button type="button" className="serial__more" aria-expanded={false} onClick={() => setUnfolded(true)}>
            All steps
          </button>
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className={`serial${compact ? ' serial--compact' : ''}`}>
      <div className="serial__head">
        <span>{stepWord}</span>
        {fold
          ? <button type="button" className="serial__more" aria-expanded onClick={() => setUnfolded(false)}>Fewer</button>
          : allDone
            ? <span className="serial__count serial__count--all">✓ All done</span>
            : <span className="serial__count" title="Buttons pressed">{tally}</span>}
      </div>
      <ol className="serial__list">
        {entries.map(stop)}
      </ol>
      {dialogs}
    </div>
  );
}

