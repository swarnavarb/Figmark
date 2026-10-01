import { useState } from 'react';
import { RECEIVED_AS_MAX, RECEIVED_AS_OPTIONS } from '@shared/buttons';
import { Modal } from './ui';

/**
 * The warehouse button, pressed for an item that is not in a lot yet.
 *
 * Two honest answers. Put it in a lot - after which the lot's route says what
 * happens next. Or say where it was received, since without a lot nothing
 * else does: the international warehouse, the freight forwarder's, the
 * supplier's, or the seller's own words. Either way the button does what it
 * always did - it ticks the warehouse checkpoint - only the label the buyer
 * reads is chosen here.
 */
export function ReceivedDialog({ itemName, busy = false, onLot, onPick, onClose }: {
  itemName: string;
  busy?: boolean;
  /** Put it in a lot instead. */
  onLot: () => void;
  /** Mark it received, in these words. */
  onPick: (label: string) => void;
  onClose: () => void;
}) {
  const [own, setOwn] = useState('');
  const [writing, setWriting] = useState(false);

  return (
    <Modal title="Not in a lot yet" onClose={onClose}>
      <div className="stack">
        <p className="rcvd__intro">
          <b>{itemName}</b> isn't in a lot yet. Put it in one - or say where it was received. The buyer reads
          your words; the button works the same either way.
        </p>

        <button type="button" className="rcvd__lot" disabled={busy} onClick={onLot}>
          <span aria-hidden="true">📦</span>
          <span className="rcvd__text">
            <b>Put it in a lot</b>
            <span>The lot's route takes it from there.</span>
          </span>
        </button>

        <span className="rcvd__or">or mark it received as</span>

        <div className="rcvd__options">
          {RECEIVED_AS_OPTIONS.map((label) => (
            <button key={label} type="button" className="rcvd__option" disabled={busy} onClick={() => onPick(label)}>
              <span aria-hidden="true">{/forwarder/i.test(label) ? '🤝' : /supplier/i.test(label) ? '🏭' : '🏬'}</span>
              {label}
            </button>
          ))}
          {writing ? (
            <form className="rcvd__own" onSubmit={(event) => {
              event.preventDefault();
              if (own.trim()) onPick(own.trim());
            }}>
              <input value={own} onChange={(event) => setOwn(event.target.value)} maxLength={RECEIVED_AS_MAX}
                placeholder="e.g. Received at our Yiwu office" aria-label="Where it was received" autoFocus />
              <button type="submit" className="btn btn--sm" disabled={busy || !own.trim()}>Mark received</button>
            </form>
          ) : (
            <button type="button" className="rcvd__option rcvd__option--own" disabled={busy} onClick={() => setWriting(true)}>
              <span aria-hidden="true">✏️</span> In my own words…
            </button>
          )}
        </div>

        <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>Not yet</button>
      </div>
    </Modal>
  );
}
