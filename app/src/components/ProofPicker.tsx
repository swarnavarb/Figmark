import { useState } from 'react';
import { ApiRequestError, api } from '../api';
import { shrink } from './PhotoManager';

/**
 * Attach a screenshot of a transfer.
 *
 * Shrunk on the phone and uploaded to the photo store straight away, so what
 * the refund carries is the photo's address rather than the image itself -
 * an order can have several refunds, and a record holding every screenshot
 * inline would run out of room.
 */
export function ProofPicker({ value, onChange }: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange((await api.uploadPhoto(await shrink(file))).url);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That screenshot did not upload.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="proofpick">
      {value ? (
        <div className="proofpick__done">
          <a href={value} target="_blank" rel="noopener noreferrer">
            <img src={value} alt="Transfer screenshot" className="proofpick__img" />
          </a>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange(null)}>Remove</button>
        </div>
      ) : (
        <label className={`proofpick__add${busy ? ' is-busy' : ''}`}>
          <input type="file" accept="image/*" disabled={busy}
            onChange={(event) => void pick(event.target.files?.[0])} />
          <span>{busy ? 'Uploading…' : '📎 Attach screenshot'}</span>
        </label>
      )}
      {error && <span className="field__hint" style={{ color: 'var(--danger-text)' }}>{error}</span>}
    </div>
  );
}
