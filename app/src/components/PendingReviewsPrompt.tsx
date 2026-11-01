import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PendingReviews } from '../api';
import { useSession } from '../session';
import { Modal, Thumb } from './ui';
import '../styles/PendingReviews.css';

/**
 * "You have 2 pending reviews."
 *
 * A review written while the trade is fresh is what a trust tier is built
 * from, and the people who owe one rarely remember on their own. So for a week
 * after an order completes, a few minutes after they are using the app, a
 * signed-in person is asked once a day, with the items named and one tap to the
 * place to write it. The server decides what is still owed and for how long;
 * this only decides when to ask, and never twice in a day.
 */

/** How long after the app opens before asking: long enough to have done what they came for. */
const ASK_AFTER_MS = 3 * 60 * 1000;
const SEEN_KEY = 'figmark.reviewPromptDay';

const today = (): string => new Date().toISOString().slice(0, 10);

function askedToday(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === today();
  } catch {
    return false;
  }
}

function markAsked(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, today());
  } catch {
    /* A private window: it may ask again on the next visit, which is harmless. */
  }
}

export function PendingReviewsPrompt() {
  const { user } = useSession();
  const [owed, setOwed] = useState<PendingReviews | null>(null);

  useEffect(() => {
    if (!user || askedToday()) return undefined;
    let live = true;
    const timer = window.setTimeout(() => {
      // Still not asked by another tab in the meantime.
      if (askedToday()) return;
      void api.pendingReviews().then((result) => {
        if (live && (result.pending.length > 0 || result.toConfirm.length > 0)) setOwed(result);
      }).catch(() => undefined);
    }, ASK_AFTER_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [user?.id]);

  if (!owed) return null;
  const close = () => { markAsked(); setOwed(null); };
  const count = owed.pending.length;
  const first = owed.pending[0];

  return (
    <Modal title={count > 0 ? `You have ${count} pending review${count === 1 ? '' : 's'}` : 'Confirm your delivery'} onClose={close}>
      <div className="pendrev">
        <p className="pendrev__lead">
          Review {count === 1 ? 'it' : 'them'} to rank up your trust and reputation.
          {owed.toConfirm.length > 0 && ' Confirming that your orders arrived counts too.'}
        </p>
        <ul className="pendrev__list">
          {owed.pending.slice(0, 4).map((entry) => (
            <li key={entry.orderId}>
              <Link to={`/order/${encodeURIComponent(entry.orderId)}`} onClick={close} className="pendrev__item">
                <Thumb seed={entry.orderId} label={entry.itemName} className="pendrev__thumb"
                  photo={entry.photoUrl ? { url: entry.photoUrl, thumbUrl: entry.photoUrl } : null} />
                <span className="pendrev__text">
                  <b>{entry.itemName}</b>
                  <small>{entry.side === 'buyer' ? 'Review the shop' : 'Review the buyer'}</small>
                </span>
                <span className="pendrev__go">Review</span>
              </Link>
            </li>
          ))}
          {owed.toConfirm.slice(0, 3).map((entry) => (
            <li key={entry.orderId}>
              <Link to={`/order/${encodeURIComponent(entry.orderId)}`} onClick={close} className="pendrev__item">
                <span className="pendrev__text">
                  <b>{entry.itemName}</b>
                  <small>Delivered - tell the shop it arrived</small>
                </span>
                <span className="pendrev__go">Confirm</span>
              </Link>
            </li>
          ))}
        </ul>
        {count > 4 && <p className="pendrev__more">and {count - 4} more in My Purchases.</p>}
        <div className="pendrev__acts">
          <button type="button" className="btn btn--ghost" onClick={close}>Later</button>
          {first && (
            <Link to={`/order/${encodeURIComponent(first.orderId)}`} className="btn" onClick={close}>Review now</Link>
          )}
        </div>
      </div>
    </Modal>
  );
}
