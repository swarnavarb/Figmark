import { useState, type ReactNode } from 'react';
import { Modal } from './ui';

export type Shipment = { courier?: string; awb?: string };

/**
 * Courier and AWB, asked as Dispatched is pressed - on the spot, without
 * leaving the list. Nothing is focused on open, so a phone does not throw its
 * keyboard over the question before it has been read; both fields are
 * optional, because the AWB often comes only once the courier has collected.
 */
export function ShipDialog({ intro, awb: askAwb = true, hint = 'No AWB yet? Dispatch now and add it later.', busy = false, onClose, onSave }: {
  intro: ReactNode;
  /** False when one answer would go on several parcels, each with its own AWB. */
  awb?: boolean;
  hint?: string;
  busy?: boolean;
  onClose: () => void;
  onSave: (shipment: Shipment) => void;
}) {
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  return (
    <Modal title="🚚 Dispatch it" onClose={onClose}>
      <form className="stack" onSubmit={(event) => {
        event.preventDefault();
        onSave({ courier: courier.trim() || undefined, awb: askAwb ? awb.trim() || undefined : undefined });
      }}>
        <p style={{ margin: 0 }}>{intro}</p>
        <label className="field">
          <span>Courier name</span>
          <input value={courier} onChange={(event) => setCourier(event.target.value)} maxLength={80}
            placeholder="Delhivery, Blue Dart, DTDC…" />
        </label>
        {askAwb && (
          <label className="field">
            <span>AWB / tracking number</span>
            <input value={awb} onChange={(event) => setAwb(event.target.value)} maxLength={80}
              placeholder="e.g. 1234567890" className="mono" />
          </label>
        )}
        <span className="field__hint">{hint}</span>
        <button type="submit" className="btn btn--block" disabled={busy}>{busy ? 'Saving…' : '🚚 Mark dispatched'}</button>
        <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>Cancel</button>
      </form>
    </Modal>
  );
}
