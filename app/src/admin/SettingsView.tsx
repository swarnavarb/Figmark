import { useEffect, useState } from 'react';
import { AUTO_RELEASE_MAX_DAYS, AUTO_RELEASE_MIN_DAYS, type MarketSettings } from '@shared/settings';
import { ApiRequestError, admin } from './api';
import { timeAgo } from '../format';

/**
 * Marketplace rules an operator can change.
 *
 * One today: how long a payment held under buyer protection waits after the
 * item leaves for the buyer before it goes to the seller on its own, if the
 * buyer neither confirms nor disputes. A change applies to clocks that start
 * from now on; every order keeps the deadline it was given.
 */
export function SettingsView() {
  const [settings, setSettings] = useState<MarketSettings | null>(null);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void admin.settings()
      .then((current) => { setSettings(current); setDays(String(current.autoReleaseDays)); })
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the settings.'));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await admin.saveSettings({ autoReleaseDays: Number(days) });
      setSettings(next);
      setDays(String(next.autoReleaseDays));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  if (!settings && !error) return <p className="muted">Loading…</p>;

  const value = Number(days);
  const valid = Number.isInteger(value) && value >= AUTO_RELEASE_MIN_DAYS && value <= AUTO_RELEASE_MAX_DAYS;
  const changed = settings !== null && value !== settings.autoReleaseDays;

  return (
    <div className="stack">
      <div className="card card--pad stack">
        <h2>Buyer protection</h2>
        <label className="field">
          <span>Release held payments automatically after (days)</span>
          <input type="number" inputMode="numeric" min={AUTO_RELEASE_MIN_DAYS} max={AUTO_RELEASE_MAX_DAYS}
            value={days} onChange={(e) => { setDays(e.target.value); setSaved(false); }} style={{ maxWidth: 140 }} />
        </label>
        <p className="field__hint">
          The clock starts when an item is dispatched to its buyer (or when it is marked delivered, if nobody
          ticked dispatched). If the buyer has not confirmed delivery or opened a dispute by then, the payment
          goes to the seller. A dispute stops the clock. Between {AUTO_RELEASE_MIN_DAYS} and {AUTO_RELEASE_MAX_DAYS} days.
        </p>
        <p className="field__hint">
          Changing this affects clocks that start from now on. Orders already counting down keep the date their
          buyer was shown.
        </p>
        {settings?.updatedAt && (
          <p className="faint">Last changed {timeAgo(settings.updatedAt)}{settings.updatedBy ? ` by ${settings.updatedBy}` : ''}.</p>
        )}
        {error && <p className="notice notice--error">{error}</p>}
        {saved && <p className="notice notice--ok">Saved. New protection windows are {settings?.autoReleaseDays} days.</p>}
        <button className="btn" style={{ justifySelf: 'start' }} disabled={busy || !valid || !changed}
          onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
