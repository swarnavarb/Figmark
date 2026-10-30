import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CATEGORY_SHORT, NOTIFICATION_CATEGORIES, type NotificationCategory } from '@shared/notifications';
import { api, type AppNotification, type NotificationPage } from '../api';
import { Icon, type IconName } from './Icon';
import { PushRow, usePush } from './PushControls';
import { timeAgo } from '../format';
import { setBadge } from '../push';
import { isReloading, isStale, loadFresh } from '../freshness';
import { onBellChanged } from '../live';
import { Spinner } from './Spinner';

/**
 * What happened while you were not looking.
 *
 * The bell only earns its place because every row goes somewhere: tapping the
 * news that somebody answered your want opens that want. A notification that
 * announces something and then leaves you to find it is an interruption, not a
 * message.
 *
 * Asked again while the site is on screen (live.ts decides when: a minute,
 * ten when pushes bring the news, longer while nothing happens, one tab for
 * all of them), and each ask is answered in a line when nothing changed.
 * When it is closed, the same notices reach the lock screen as Web Push (see
 * push.ts), and a push that lands while it is open refreshes the bell on the
 * spot.
 *
 * Twenty at a time, newest first, with "Show older" for the rest, and a row of
 * filters so somebody who only wants their messages is not reading past their
 * parcels. Going to a page a notice points at reads it, however you got there:
 * opening the conversation is reading the news of it.
 *
 * One line per thing: a conversation, a post's likes, a lot's tracking. The
 * server folds each new event into that line and counts what is new since it
 * was last read; anything older that slipped through as a second line is
 * dropped here. Unread lines sit under "Unread", the rest under "Read" - by whether they were read, not by when they came.
 */
/** Said on the window when the bell brings news of an order or a payment, so
    the Sell tab's counts read again then rather than on a clock of their own. */
export const SALES_NEWS_EVENT = 'figmark:sales-news';
const SALES_NEWS: readonly NotificationCategory[] = ['orders', 'payments'];

/** Said on the window when the bell brings news of a message, so the inbox
    and the Messages tab's count read again then: away from a conversation,
    the bell's clock is how soon a new message is heard of. */
export const MESSAGES_NEWS_EVENT = 'figmark:messages-news';

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

/** The first - newest - line of each group, in order. */
function oneEach(rows: readonly AppNotification[]): AppNotification[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.group) return true;
    if (seen.has(row.group)) return false;
    seen.add(row.group);
    return true;
  });
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
  // Order and payment rows already seen (id and count), so only a new one is news.
  const salesSeen = useRef<Set<string> | null>(null);
  // The message lines last seen (id, count, read), so only a change is news.
  const messagesSeen = useRef<string | null>(null);
  // What the last first page was, for the server to answer "unchanged" against.
  const version = useRef<string | null>(null);
  // What the bell last showed, so a poll that changed nothing is not news.
  const showing = useRef('');

  const counts = (page: NotificationPage) => {
    setUnread(page.unread);
    setByCategory(page.unreadByCategory ?? {});
  };

  /* The newest page, merged over whatever older pages are already showing so
     a refresh does not throw away what somebody scrolled down to. A poll
     sends what it last saw and hears "unchanged" when nothing was written;
     it resolves whether the bell now says something new. */
  const load = useCallback(async (poll = false): Promise<boolean> => {
    const category = asked.current;
    try {
      const reply = poll ? await api.notificationsSince(version.current, category) : await api.notifications({ category });
      if (asked.current !== category) return false;
      if ('unchanged' in reply) return false;
      const page = reply;
      if (page.version) version.current = page.version;
      const said = `${page.unread}|${page.notifications.map((row) => `${row.id}:${row.count}:${row.read}`).join(',')}`;
      const news = said !== showing.current;
      showing.current = said;
      counts(page);
      const sales = page.notifications.filter((row) => SALES_NEWS.includes(row.category)).map((row) => `${row.id}:${row.count}`);
      if (salesSeen.current && sales.some((key) => !salesSeen.current!.has(key))) window.dispatchEvent(new Event(SALES_NEWS_EVENT));
      salesSeen.current = new Set([...(salesSeen.current ?? []), ...sales]);
      // Only a list that shows message lines can tell whether they changed.
      if (category === null || category === 'messages') {
        const messages = `${page.unreadByCategory?.messages ?? 0}|${page.notifications
          .filter((row) => row.category === 'messages').map((row) => `${row.id}:${row.count}:${row.read}`).join(',')}`;
        if (messagesSeen.current !== null && messages !== messagesSeen.current) window.dispatchEvent(new Event(MESSAGES_NEWS_EVENT));
        messagesSeen.current = messages;
      }
      const fresh = new Set(page.notifications.map((row) => row.id));
      const oldest = page.notifications[page.notifications.length - 1]?.createdAt;
      const older = oldest ? shown.current.filter((row) => !fresh.has(row.id) && row.createdAt < oldest) : [];
      // Older pages already showing keep their own place to carry on from.
      if (older.length === 0) setNextBefore(page.nextBefore);
      setRows(oneEach([...page.notifications, ...older]));
      return news;
    } catch {
      // A bell that cannot load is not worth an error on somebody's screen.
      return false;
    }
  }, []);

  // Loaded now, then whenever there may be news: a push, the tab coming
  // back, another tab hearing of some, or the clock.
  useEffect(() => onBellChanged(() => load(true)), [load]);

  // The number on the home-screen icon, where the device shows one.
  useEffect(() => setBadge(unread), [unread]);

  // Clicking anywhere else closes it, which is what everybody expects a
  // dropdown to do and what nothing else on the page will do for it.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) setOpen(false);
    };
    // And Escape, from anywhere on the page.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
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
        return oneEach([...current, ...page.notifications.filter((row) => !have.has(row.id))]);
      });
      setNextBefore(page.nextBefore);
    } catch {
      // The button stays, to try again.
    } finally {
      setLoadingMore(false);
    }
  }

  /* Straight there: being on the page reads it (above), and waiting for the
     server first only made every tap feel slow. */
  function follow(row: AppNotification) {
    setOpen(false);
    navigate(row.link);
    if (row.read) return;
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(0, count - 1));
    setByCategory((current) => ({ ...current, [row.category]: Math.max(0, (current[row.category] ?? 0) - 1) || undefined }));
    void api.markNotificationsRead(row.id).catch(() => undefined).then(() => load());
  }

  async function readAll() {
    await api.markNotificationsRead(filter ? { category: filter } : undefined).catch(() => undefined);
    await load();
  }

  const shownUnread = filter ? byCategory[filter] ?? 0 : unread;
  const fresh = rows.filter((row) => !row.read);
  const earlier = rows.filter((row) => row.read);

  const line = (row: AppNotification) => (
    <button key={row.id} type="button"
      className={`bell__row${row.read ? '' : ' is-unread'}`}
      onClick={() => follow(row)}>
      <span className={`bell__glyph bell__glyph--${row.category}`} aria-hidden="true">
        <Icon name={CATEGORY_ICON[row.category] ?? 'bell'} size={15} />
      </span>
      <span className="bell__text">
        <span className="bell__title">{row.title}</span>
        {row.body && <span className="faint bell__body">{row.body}</span>}
        <span className="faint bell__when">{timeAgo(row.createdAt)}</span>
      </span>
      {!row.read && (row.count > 1
        ? <span className="bell__count" aria-label={`${row.count} new`}>{row.count > 99 ? '99+' : row.count}</span>
        : <span className="bell__unread" aria-label="Unread" />)}
    </button>
  );

  return (
    <div className="bell" ref={panel}>
      <button type="button" className="bell__button" aria-label={
        unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'
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
              {fresh.length > 0 && earlier.length > 0 && <p className="bell__section">Unread</p>}
              {fresh.map(line)}
              {fresh.length > 0 && earlier.length > 0 && <p className="bell__section">Read</p>}
              {earlier.map(line)}
              {nextBefore && (
                <button type="button" className="bell__more" onClick={() => void more()} disabled={loadingMore}>
                  {loadingMore ? <><Spinner size={14} label="Loading" /> Show older</> : 'Show older'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Where a tapped lock-screen notification goes, when the app is already open.
 *
 * The service worker brings the open window forward and posts the link here;
 * this answers so it knows not to fall back, and moves within the app - no
 * reload, and it works on an iPhone's home-screen app, where the worker may
 * not navigate a window it did not load. Mounted once, inside the router.
 */
export function NotificationLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    const go = (raw: unknown) => {
      const link = typeof raw === 'string' && raw.startsWith('/') ? raw : '/';
      // Mid-way through reloading onto a new version, moving in place is lost:
      // the reload comes back to the address it started from. Loading the
      // page the tap is for instead overrides the reload, on the new version.
      if (isReloading()) {
        loadFresh(link);
        return;
      }
      const here = `${window.location.pathname}${window.location.search}`;
      if (link !== here) navigate(link);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; link?: unknown } | null;
      if (data?.type !== 'figmark:open') return;
      go(data.link);
      // Only the copy on screen answers. One still in the background has
      // moved too, but the worker carries on until the one being looked at
      // has it - and the handoff stays for that one to find.
      if (document.visibilityState !== 'visible') return;
      event.ports[0]?.postMessage({ ok: true });
      void forgetHandoff();
    };

    /* The same tap, left by the worker for a page that missed the message:
       frozen in the background, or reloaded onto a new version on the way.
       Looked for again over the next few seconds, because an iPhone puts the
       app on screen before the worker has run and left it. */
    let timers: number[] = [];
    const pickUp = async () => {
      if (document.visibilityState !== 'visible') return;
      const left = await readHandoff();
      if (left) go(left);
    };
    const onFront = () => {
      if (document.visibilityState !== 'visible') return;
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = HANDOFF_LOOKS_MS.map((delay) => window.setTimeout(() => void pickUp(), delay));
    };

    navigator.serviceWorker?.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onFront);
    window.addEventListener('focus', onFront);
    window.addEventListener('pageshow', onFront);
    onFront();
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onFront);
      window.removeEventListener('focus', onFront);
      window.removeEventListener('pageshow', onFront);
    };
  }, [navigate]);
  return null;
}

const HANDOFF_CACHE = 'figmark-open';
const HANDOFF_KEY = '/__figmark-open';
/** A tap older than this was handled some other way, or is not news any more. */
const HANDOFF_FRESH_MS = 2 * 60_000;
/** When a page that has just come to the front looks for one. */
const HANDOFF_LOOKS_MS = [0, 300, 800, 1500, 3000, 6000];

async function readHandoff(): Promise<string | null> {
  try {
    if (!('caches' in window)) return null;
    const cache = await caches.open(HANDOFF_CACHE);
    const found = await cache.match(HANDOFF_KEY);
    if (!found) return null;
    await cache.delete(HANDOFF_KEY);
    const { link, at } = (await found.json()) as { link?: unknown; at?: unknown };
    return typeof link === 'string' && typeof at === 'number' && Date.now() - at < HANDOFF_FRESH_MS ? link : null;
  } catch {
    return null;
  }
}

async function forgetHandoff(): Promise<void> {
  try {
    if ('caches' in window) await (await caches.open(HANDOFF_CACHE)).delete(HANDOFF_KEY);
  } catch {
    // Expires on its own.
  }
}

/**
 * When a newer version went live while somebody was using the page, their
 * next move to another page loads it, at the page they were going to.
 */
export function FreshOnNavigate() {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (isStale()) loadFresh(`${location.pathname}${location.search}${location.hash}`);
  }, [location.pathname, location.search, location.hash]);
  return null;
}
