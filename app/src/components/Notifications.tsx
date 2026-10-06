import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AppNotification } from '../api';
import { Icon } from './Icon';
import { PushRow, usePush } from './PushControls';
import { timeAgo } from '../format';
import { setBadge } from '../push';

/**
 * What happened while you were not looking.
 *
 * The bell only earns its place because every row goes somewhere: tapping the
 * news that somebody answered your want opens that want. A notification that
 * announces something and then leaves you to find it is an interruption, not a
 * message.
 *
 * Polled while the site is open; a minute is soon enough for "somebody
 * answered your want" and costs one small request. When it is closed, the
 * same notices reach the lock screen as Web Push (see push.ts), and a push
 * that lands while it is open refreshes the bell on the spot.
 */
const POLL_MS = 60_000;

export function Notifications() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const push = usePush();

  const load = useCallback(async () => {
    try {
      const result = await api.notifications();
      setRows(result.notifications);
      setUnread(result.unread);
    } catch {
      // A bell that cannot load is not worth an error on somebody's screen.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // A push arriving while the site is open is news for the bell too.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'figmark:notification') void load();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [load]);

  // The number on the home-screen icon, where the device shows one.
  useEffect(() => setBadge(unread), [unread]);

  // Clicking anywhere else closes it, which is what everybody expects a
  // dropdown to do and what nothing else on the page will do for it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  async function follow(row: AppNotification) {
    setOpen(false);
    try {
      await api.markNotificationsRead(row.id);
    } catch {
      // Going where it points matters more than recording that it was read.
    }
    await load();
    navigate(row.link);
  }

  return (
    <div className="bell" ref={panel}>
      <button type="button" className="bell__button" aria-label={
        unread > 0 ? `${unread} unread notifications` : 'Notifications'
      } onClick={() => setOpen(!open)}>
        {<Icon name="bell" size={18} />}
        {unread > 0 && <span className="bell__dot">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell__panel">
          <div className="bell__head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="btn btn--quiet btn--sm"
                onClick={() => void api.markNotificationsRead().then(load)}>
                Mark all read
              </button>
            )}
          </div>

          <PushRow push={push} />

          {rows.length === 0 ? (
            <p className="faint" style={{ padding: '14px' }}>Nothing yet.</p>
          ) : (
            <div className="bell__list">
              {rows.map((row) => (
                <button key={row.id} type="button"
                  className={`bell__row${row.read ? '' : ' is-unread'}`}
                  onClick={() => void follow(row)}>
                  <span className="bell__title">{row.title}</span>
                  <span className="faint">{row.body}</span>
                  <span className="faint">{timeAgo(row.createdAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

