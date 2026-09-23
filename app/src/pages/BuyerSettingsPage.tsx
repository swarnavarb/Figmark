import { useEffect, useState } from 'react';
import { ApiRequestError, api } from '../api';
import { ErrorNotice } from '../components/ui';

/**
 * Buyer Settings - where a buyer says where a cancelled order's payment
 * should be reversed to.
 *
 * One section, deliberately: `Payment Reversal Details` is the only thing
 * this page is for. Free text throughout and no provider hard-coded, the same
 * discipline a seller's own payment details use - the platform is not moving
 * this money and must not pretend to have validated an account it cannot see.
 */
export function BuyerSettingsPage() {
  const [method, setMethod] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [accountName, setAccountName] = useState('');
  const [notes, setNotes] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.reversalDetails()
      .then(({ reversalDetails }) => {
        if (reversalDetails) {
          setMethod(reversalDetails.method);
          setIdentifier(reversalDetails.identifier);
          setAccountName(reversalDetails.accountName);
          setNotes(reversalDetails.notes ?? '');
          setQrCodeUrl(reversalDetails.qrCodeUrl ?? null);
        }
      })
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load this.'))
      .finally(() => setLoading(false));
  }, []);

  async function uploadQr(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read that image.'));
        reader.readAsDataURL(file);
      });
      const stored = await api.uploadPhoto(dataUrl);
      setQrCodeUrl(stored.url);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That image did not upload.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.saveReversalDetails({
        method: method.trim(), identifier: identifier.trim(), accountName: accountName.trim(),
        notes: notes.trim() || undefined, qrCodeUrl: qrCodeUrl ?? undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="page"><p className="muted">Loading…</p></main>;

  return (
    <main className="page">
      <div className="page__head">
        <h1>💳 Buyer Settings</h1>
      </div>

      <div className="card card--pad stack">
        <h2 style={{ margin: 0 }}>Payment Reversal Details</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          If a seller cancels a paid order, this is where they send your money back. Save it once and
          every reversal uses it.
        </p>

        <label className="field">
          <span>Payment method</span>
          <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="UPI, bank transfer…" />
        </label>
        <label className="field">
          <span>Account, UPI, or payment identifier</span>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@upi or account number" />
        </label>
        <label className="field">
          <span>Name on the account</span>
          <input value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        </label>
        <label className="field">
          <span>Anything else the seller needs (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="IFSC, branch, a note…" />
        </label>

        <label className="field">
          <span>Upload QR Code (optional)</span>
          <input type="file" accept="image/*" onChange={(e) => void uploadQr(e.target.files?.[0])} />
          <span className="field__hint">{uploading ? 'Uploading…' : 'A payment QR image, if you have one.'}</span>
        </label>
        {qrCodeUrl && <img src={qrCodeUrl} alt="Your payment QR code" className="proof" />}

        {error && <ErrorNotice message={error} />}
        {saved && <p className="notice notice--ok" style={{ margin: 0 }}>Saved.</p>}

        <button type="button" className="btn btn--lg" style={{ justifySelf: 'start' }}
          disabled={busy || !method.trim() || !identifier.trim() || !accountName.trim()}
          onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </main>
  );
}
