import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CATEGORY_SHORT, NOTIFICATION_CATEGORIES, type NotificationCategory } from '@shared/notifications';
import { api, type AppNotification, type NotificationPage } from '../api';
import { Icon, type IconName } from './Icon';
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
 *
 * Twenty at a time, newest first, with "Show older" for the rest, and a row of
 * filters so somebody who only wants their messages is not reading past their
 * parcels. Going to a page a notice points at reads it, however you got there:
 * opening the conversation is reading the news of it.
 */
const POLL_MS = 60_000;

const CATEGORY_ICON: Record<NotificationCategory, IconName> = {
  messages: 'message',
  orders: 'truck',
  payments: 'bank',
  social: 'heart',
  reviews: 'star',
  drops: 'bolt',
};

/** The path and query a link names, so a visit can be matched to it. */
function placeOf(link: string): { path: string; query: string } {
  try {
    const url = new URL(link, window.location.origin);
    return { path: url.pathname.replace(/\/+$/, '') || '/', query: url.search };
  } catch {
    return { path: link, query: '' };
  }
}

/** Whether being at `pathname?search` means having seen what `link` points at. */
function isAt(link: string, pathname: string, search: string): boolean {
  const place = placeOf(link);
  if (place.path === '/' || place.path !== (pathname.replace(/\/+$/, '') || '/')) return false;
  // A link that names a voice or a tab must be visited in that one.
  if (!place.query) return true;
  const want = new URLSearchParams(place.query);
  const have = new URLSearchParams(search);
  return [...want.entries()].every(([key, value]) => have.get(key) === value);
}

export function Notifications() {
  const navigate = useNavigate();
  const location = useLocation();
  const [rows, setRows] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [byCategory, setByCategory] = useState<NotificationPage['unreadByCategory']>({});
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationCategory | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const push = usePush();
  // The filter a response was asked for, so a slow one for the old filter is dropped.
  const asked = useRef<NotificationCategory | null>(null);
  const shown = useRef<AppNotification[]>([]);
  shown.current = rows;

  const counts = (page: NotificationPage) => {
    setUnread(page.unread);
    setByCategory(page.unreadByCategory ?? {});
  };

  /* The newest page, merged over whatever older pages are already showing so
     a refresh does not throw away what somebody scrolled down to. */
  const load = useCallback(async () => {
    const category = asked.current;
    try {
      const page = await api.notifications({ category });
      if (asked.current !== category) return;
      counts(page);
      const fresh = new Set(page.notifications.map((row) => row.id));
      const oldest = page.notifications[page.notifications.length - 1]?.createdAt;
      const older = oldest ? shown.current.filter((row) => !fresh.has(row.id) && row.createdAt < oldest) : [];
      // Older pages already showing keep their own place to carry on from.
      if (older.length === 0) setNextBefore(page.nextBefore);
      setRows([...page.notifications, ...older]);
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

  /* Being on the page a notice points at is having seen it, whether you got
     there from the bell, the lock screen, the inbox or a link. */
  useEffect(() => {
    const seen = rows.filter((row) => !row.read && isAt(row.link, location.pathname, location.search));
    if (seen.length === 0) return;
    const ids = new Set(seen.map((row) => row.id));
    setRows((current) => current.map((row) => (ids.has(row.id) ? { ...row, read: true } : row)));
    setUnread((count) => Math.max(0, count - ids.size));
    setByCategory((current) => {
      const next = { ...current };
      for (const row of seen) next[row.category] = Math.max(0, (next[row.category] ?? 0) - 1) || undefined;
      return next;
    });
    void api.markNotificationsRead({ ids: [...ids] }).catch(() => undefined);
  }, [location.pathname, location.search, rows]);

  function choose(category: NotificationCategory | null) {
    if (category === filter) return;
    asked.current = category;
    setFilter(category);
    shown.current = [];
    setRows([]);
    setNextBefore(null);
    void load();
  }

  async function more() {
    if (!nextBefore || loadingMore) return;
    const category = asked.current;
    setLoadingMore(true);
    try {
      const page = await api.notifications({ before: nextBefore, category });
      if (asked.current !== category) return;
      counts(page);
      setRows((current) => {
        const have = new Set(current.map((row) => row.id));
        return [...current, ...page.notifications.filter((row) => !have.has(row.id))];
      });
      setNextBefore(page.nextBefore);
    } catch {
      // The button stays, to try again.
    } finally {
      setLoadingMore(false);
    }
  }

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

  async function readAll() {
    await api.markNotificationsRead(filter ? { category: filter } : undefined).catch(() => undefined);
    await load();
  }

  const shownUnread = filter ? byCategory[filter] ?? 0 : unread;

  return (
    <div className="bell" ref={panel}>
      <button type="button" className="bell__button" aria-label={
        unread > 0 ? `${unread} unread notifications` : 'Notifications'
      } aria-expanded={open} onClick={() => setOpen(!open)}>
        {<Icon name="bell" size={18} />}
        {unread > 0 && <span className="bell__dot">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="bell__panel">
          <div className="bell__head">
            <strong>Notifications</strong>
            {shownUnread > 0 && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => void readAll()}>
                {filter ? `Mark ${CATEGORY_SHORT[filter].toLowerCase()} read` : 'Mark all read'}
              </button>
            )}
          </div>

          <PushRow push={push} />

          <div className="bell__filters" role="tablist" aria-label="Show">
            <button type="button" role="tab" aria-selected={filter === null}
              className={`bell__chip${filter === null ? ' is-on' : ''}`} onClick={() => choose(null)}>
              All
            </button>
            {NOTIFICATION_CATEGORIES.map((category) => (
              <button key={category} type="button" role="tab" aria-selected={filter === category}
                className={`bell__chip${filter === category ? ' is-on' : ''}`} onClick={() => choose(category)}>
                {CATEGORY_SHORT[category]}
                {(byCategory[category] ?? 0) > 0 && <span className="bell__chip-count">{byCategory[category]}</span>}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <p className="faint bell__empty">
              {filter ? `No ${CATEGORY_SHORT[filter].toLowerCase()} notifications yet.` : 'Nothing yet.'}
            </p>
          ) : (
            <div className="bell__list">
              {rows.map((row) => (
                <button key={row.id} type="button"
                  className={`bell__row${row.read ? '' : ' is-unread'}`}
                  onClick={() => void follow(row)}>
                  <span className={`bell__glyph bell__glyph--${row.category}`} aria-hidden="true">
                    <Icon name={CATEGORY_ICON[row.category] ?? 'bell'} size={15} />
                  </span>
                  <span className="bell__text">
                    <span className="bell__title">{row.title}</span>
                    {row.body && <span className="faint bell__body">{row.body}</span>}
                    <span className="faint bell__when">{timeAgo(row.createdAt)}</span>
                  </span>
                  {!row.read && <span className="bell__unread" aria-label="Unread" />}
                </button>
              ))}
              {nextBefore && (
                <button type="button" className="bell__more" onClick={() => void more()} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Show older'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
