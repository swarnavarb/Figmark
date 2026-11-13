import { useState } from 'react';
import { api } from '../api';
import { Icon } from './ui';

/**
 * "Where is my parcel", handed to somebody else.
 *
 * The buyer sends it to whoever is waiting at home; the shop sends it to a
 * buyer who asked on WhatsApp instead of opening the app. The page it opens
 * needs no account and shows the journey only - no name, address or money.
 */
export function ShareTracking({ orderId, itemName, seller }: { orderId: string; itemName: string; seller: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function link(): Promise<string | null> {
    if (url) return url;
    setBusy(true);
    try {
      const { path } = await api.trackLink(orderId);
      const full = `${window.location.origin}${path}`;
      setUrl(full);
      return full;
    } catch {
      setSaid('Could not make the link. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const text = (full: string) => `Track ${itemName} here: ${full}`;

  async function share() {
    const full = await link();
    if (!full) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Tracking: ${itemName}`, text: text(full), url: full });
        return;
      } catch {
        /* Closed the sheet, or no share here: the clipboard below. */
      }
    }
    try {
      await navigator.clipboard.writeText(full);
      setSaid('Link copied.');
    } catch {
      setSaid(null);
    }
  }

  return (
    <div className="sharetrack card card--pad">
      <div className="sharetrack__text">
        <b>{seller ? 'Send the buyer a tracking link' : 'Share tracking'}</b>
        <span className="field__hint">
          Opens without an account and shows where it is and roughly when it lands - never a name, address or price.
        </span>
      </div>
      <div className="sharetrack__acts">
        <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void share()}>
          <Icon name="share" size={14} /> Share link
        </button>
        <button type="button" className="btn btn--sm btn--ghost" disabled={busy}
          onClick={async () => {
            const full = await link();
            if (full) window.open(`https://wa.me/?text=${encodeURIComponent(text(full))}`, '_blank', 'noopener');
          }}>
          WhatsApp
        </button>
      </div>
      {url && <input className="sharetrack__url" readOnly value={url} aria-label="Tracking link" onFocus={(event) => event.target.select()} />}
      {said && <span className="faint" role="status">{said}</span>}
    </div>
  );
}
