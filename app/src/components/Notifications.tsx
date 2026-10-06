import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type AppNotification } from '../api';
import { Icon } from './Icon';
import { useToast } from './Feedback';
import { timeAgo } from '../format';
import { disablePush, enablePush, pushState, setBadge, syncPush, type PushState } from '../push';

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
  const toast = useToast();
  const [push, setPush] = useState<PushState>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);

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

  // A device that is on stays on for whoever is signed in now; and a push
  // arriving while the site is open is news for the bell too.
  useEffect(() => {
    void syncPush().then(pushState).then(setPush);
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'figmark:notification') void load();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [load]);

  // The number on the home-screen icon, where the device shows one.
  useEffect(() => setBadge(unread), [unread]);

  async function turnOn() {
    setPushBusy(true);
    try {
      const next = await enablePush();
      setPush(next);
      if (next === 'on') toast('Notifications are on for this device.');
      else if (next === 'blocked') toast('Notifications are blocked. Allow them for this site in your browser settings.', 'error');
    } catch {
      toast('Could not turn notifications on. Try again.', 'error');
    } finally {
      setPushBusy(false);
    }
  }

  async function turnOff() {
    setPushBusy(true);
    try {
      await disablePush();
      setPush(await pushState());
    } catch {
      toast('Could not turn notifications off. Try again.', 'error');
    } finally {
      setPushBusy(false);
    }
  }

  async function sendTest() {
    try {
      const { sent } = await api.pushTest();
      toast(sent > 0 ? 'Sent. It should appear in a moment.' : 'No device took it. Turn notifications off and on again.', sent > 0 ? 'ok' : 'error');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send a test.', 'error');
    }
  }

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

          <PushRow state={push} busy={pushBusy} onEnable={() => void turnOn()}
            onDisable={() => void turnOff()} onTest={() => void sendTest()} />

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

/**
 * Where this device stands on lock-screen notifications, and the one thing to
 * do about it. Says nothing at all where the site or the browser cannot.
 */
function PushRow({ state, busy, onEnable, onDisable, onTest }: {
  state: PushState;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
}) {
  if (state === 'unsupported') return null;

  if (state === 'needs-install') {
    return (
      <div className="bell__push">
        <span>
          To get notifications on iPhone: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>,
          and open Figmark from the new icon.
        </span>
      </div>
    );
  }

  if (state === 'blocked') {
    return (
      <div className="bell__push">
        <span className="faint">Notifications are blocked for this site. Allow them in your browser settings to get them here.</span>
      </div>
    );
  }

  if (state === 'on') {
    return (
      <div className="bell__push">
        <span className="faint">Notifications are on for this device.</span>
        <span className="bell__push-actions">
          <button type="button" className="btn btn--quiet btn--sm" onClick={onTest}>Send a test</button>
          <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={onDisable}>Turn off</button>
        </span>
      </div>
    );
  }

  return (
    <div className="bell__push">
      <span>Get these on your lock screen, even when Figmark is closed.</span>
      <button type="button" className="btn btn--sm" disabled={busy} onClick={onEnable}>
        {busy ? 'Turning on…' : 'Turn on'}
      </button>
    </div>
  );
}
