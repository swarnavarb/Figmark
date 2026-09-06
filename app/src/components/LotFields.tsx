import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Lot } from '@shared/models';
import { ApiRequestError, api, type LotDetails } from '../api';
import { ErrorNotice } from './ui';

/**
 * The details that describe a batch, in one place.
 *
 * Creating a batch and correcting one later are the same form: every field is
 * editable afterwards, so having two definitions of what a batch has would only
 * be an opportunity for them to disagree.
 */
export function LotDetailFields({ value, onChange }: {
  value: LotDetails;
  onChange: (next: LotDetails) => void;
}) {
  const set = <K extends keyof LotDetails>(key: K, next: LotDetails[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <>
      <label className="field">
        <span>Lot name *</span>
        <input value={value.name} onChange={(e) => set('name', e.target.value)}
          placeholder="Guangzhou run — October" required autoFocus />
        <span className="field__hint">The only thing you must fill in. Buyers never see it.</span>
      </label>

      <div className="field-row">
        <label className="field">
          <span>Origin</span>
          <input value={value.origin ?? ''} onChange={(e) => set('origin', e.target.value)}
            placeholder="Guangzhou, CN" />
        </label>
        <label className="field">
          <span>Est. dispatch</span>
          <input type="date" value={(value.estimatedDispatchAt ?? '').slice(0, 10)}
            onChange={(e) => set('estimatedDispatchAt', e.target.value ? new Date(e.target.value).toISOString() : null)} />
          <span className="field__hint">Buyers see this date on their order.</span>
        </label>
      </div>

      <label className="field">
        <span>Notes</span>
        <input value={value.description ?? ''} onChange={(e) => set('description', e.target.value)}
          placeholder="Air freight, QC before repack" />
      </label>

      <div className="card card--pad stack">
        <div>
          <div style={{ fontWeight: 600 }}>Supplier</div>
          <span className="field__hint">
            Who you are buying this batch from at the origin — the overseas seller or agent, not your
            forwarder. Kept so you can reconcile the batch against their invoice later.
          </span>
        </div>
        <label className="field">
          <span>Name</span>
          <input value={value.supplierName ?? ''} onChange={(e) => set('supplierName', e.target.value)}
            placeholder="Baiyun Hobby Trading" />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Contact</span>
            <input value={value.supplierContact ?? ''} onChange={(e) => set('supplierContact', e.target.value)}
              placeholder="wechat / email / phone" />
          </label>
          <label className="field">
            <span>Their reference</span>
            <input value={value.supplierReference ?? ''} onChange={(e) => set('supplierReference', e.target.value)}
              placeholder="Invoice or order no." />
          </label>
        </div>
      </div>
    </>
  );
}

/** A blank set of details, so the two callers start from the same shape. */
export const emptyLotDetails = (): LotDetails => ({
  name: '',
  description: '',
  origin: '',
  estimatedDispatchAt: null,
  supplierName: '',
  supplierContact: '',
  supplierReference: '',
});

/** The details of an existing batch, ready to be edited. */
export const lotDetailsOf = (lot: Lot): LotDetails => ({
  name: lot.name,
  description: lot.description,
  origin: lot.origin ?? '',
  estimatedDispatchAt: lot.estimatedDispatchAt,
  supplierName: lot.supplier?.name ?? '',
  supplierContact: lot.supplier?.contact ?? '',
  supplierReference: lot.supplier?.reference ?? '',
});

/**
 * Open a batch without leaving the page you are on.
 *
 * A seller listing their first imported item has no batch to file it into, and
 * sending them to another screen to make one loses the listing they were half
 * way through writing.
 */
export function NewLotDialog({ onCreated, onCancel }: {
  onCreated: (lot: Lot) => void;
  onCancel: () => void;
}) {
  const [details, setDetails] = useState<LotDetails>(emptyLotDetails);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes it, as every dialog should.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.createLot({ ...details, name: details.name.trim() });
      onCreated(result.lot);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create the lot.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New lot" onClose={onCancel}>
      <form className="form" onSubmit={submit}>
        <LotDetailFields value={details} onChange={setDetails} />
        {error && <ErrorNotice message={error} />}
        <div className="row">
          <button type="submit" className="btn" disabled={busy || !details.name.trim()}>
            {busy ? 'Creating…' : 'Create lot'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
        </div>
        <span className="field__hint">Everything here can be changed later from My batches.</span>
      </form>
    </Modal>
  );
}

/** A centred panel over a scrim; on a phone it becomes a sheet from the bottom. */
export function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}
      onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal__panel">
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
