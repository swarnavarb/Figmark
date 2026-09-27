import {
  useCallback, useEffect, useRef, useState,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiRequestError, api, type SocialSearchResult } from '../api';
import { ProfileMenu } from '../AppShell';
import { useSession } from '../session';
import { Avatar } from './ui';
import { Icon, type IconName } from './Icon';
import { Notifications } from './Notifications';
import { VoicePicker, useVoice } from './SocialVoice';
import { seenMap, unreadOf } from './Channels';

/**
 * The social tab's own chrome: one gradient block for the header, a slim bar
 * that takes its place once you scroll, the search for people, and the bar a
 * room keeps at its top.
 *
 * The marketplace header is about things - search listings, forwarders - and
 * none of that belongs here. Here the header is about people: who you are
 * speaking as, what is new since you last looked, and a way to find somebody.
 */

export type SocialView = 'feed' | 'channels' | 'wanted' | 'forums' | 'messages';

export const SOCIAL_VIEWS: { id: SocialView; label: string; icon: IconName }[] = [
  { id: 'feed', label: 'Feed', icon: 'spark' },
  { id: 'channels', label: 'Channels', icon: 'megaphone' },
  { id: 'wanted', label: 'ISO', icon: 'target' },
  { id: 'forums', label: 'Forums', icon: 'forum' },
  { id: 'messages', label: 'Messages', icon: 'mail' },
];

/** What is waiting in each section, for the numbers on the tabs. */
interface Pulse {
  messages: number;
  channels: number;
  forums: number;
}

function usePulse(): Pulse {
  const [pulse, setPulse] = useState<Pulse>({ messages: 0, channels: 0, forums: 0 });
  useEffect(() => {
    let live = true;
    void Promise.allSettled([api.inbox(), api.channels(), api.forums()]).then(([inbox, channels, forums]) => {
      if (!live) return;
      const seen = seenMap();
      setPulse({
        messages: inbox.status === 'fulfilled' ? inbox.value.threads.reduce((sum, row) => sum + row.unread, 0) : 0,
        channels: channels.status === 'fulfilled'
          ? channels.value.channels.filter((row) => !row.mine).reduce((sum, row) => sum + unreadOf(row, seen), 0)
          : 0,
        // Joined forums with a post since you last looked in.
        forums: forums.status === 'fulfilled'
          ? forums.value.forums.filter((row) => row.member && row.lastPostAt && (!seen[row.id] || row.lastPostAt > seen[row.id]!)).length
          : 0,
      });
    });
    return () => {
      live = false;
    };
  }, []);
  return pulse;
}

function count(value: number): string {
  return value > 99 ? '99+' : String(value);
}

/**
 * The top of the social tab.
 *
 * Edge to edge with its lower corners rounded, so the brand, the bell, who you
 * are and the sections read as one object rather than four strips. Once it has
 * scrolled away a slim copy locks to the top: the sections and search, the two
 * things you reach for mid-scroll.
 */
export function SocialTop({ view, onView }: { view: SocialView; onView: (view: SocialView) => void }) {
  const { user, signOut } = useSession();
  const pulse = usePulse();
  const [compact, setCompact] = useState(false);
  const [searching, setSearching] = useState(false);
  const tabs = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = tabs.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver(
      ([entry]) => setCompact(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 0)),
      { threshold: 0 },
    );
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  // The open section is always in sight in the slim bar, which scrolls
  // sideways on a narrow screen.
  const slim = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const row = slim.current;
    const on = row?.querySelector<HTMLElement>('.is-on');
    if (row && on) row.scrollLeft = on.offsetLeft - (row.clientWidth - on.clientWidth) / 2;
  }, [view, compact]);

  const badge = (id: SocialView) =>
    id === 'messages' ? pulse.messages : id === 'channels' ? pulse.channels : id === 'forums' ? pulse.forums : 0;

  const pick = (id: SocialView) => {
    onView(id);
    if (compact) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const tabRow = (small: boolean) => SOCIAL_VIEWS.map((entry) => {
    const waiting = badge(entry.id);
    return (
      <button key={entry.id} type="button" aria-pressed={view === entry.id}
        className={`soctab${small ? ' soctab--sm' : ''}${view === entry.id ? ' is-on' : ''}`}
        onClick={() => pick(entry.id)}>
        <Icon name={entry.icon} size={small ? 14 : 16} />
        <span>{entry.label}</span>
        {waiting > 0 && <span className="soctab__badge">{count(waiting)}</span>}
      </button>
    );
  });

  return (
    <>
      <header className="soctop">
        <span className="soctop__stripes" aria-hidden="true" />
        <div className="soctop__in">
          <div className="soctop__bar">
            <Link to="/" className="soctop__mark" aria-label="Figmark home" />
            <h1 className="soctop__title">Social</h1>
            <span className="soctop__live" aria-hidden="true">Live</span>
            <div className="soctop__tools">
              <button type="button" className="soctop__icon" aria-label="Search people, shops and forums"
                onClick={() => setSearching(true)}>
                <Icon name="search" size={18} />
              </button>
              {user && <span className="soctop__voice"><VoicePicker size={34} /></span>}
              {user && <Notifications />}
              {user && <ProfileMenu name={user.displayName} onSignOut={() => void signOut()} />}
            </div>
          </div>

          <nav className="soctop__tabs" aria-label="Social sections" ref={tabs}>
            {tabRow(false)}
          </nav>
        </div>
      </header>

      <div className={`soccompact${compact ? ' is-on' : ''}`} aria-hidden={!compact}>
        <div className="soccompact__in">
          <button type="button" className="soccompact__mark" aria-label="Back to the top"
            tabIndex={compact ? 0 : -1} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
          <nav className="soccompact__tabs" aria-label="Social sections" ref={slim}>{compact && tabRow(true)}</nav>
          <button type="button" className="soccompact__search" aria-label="Search people, shops and forums"
            tabIndex={compact ? 0 : -1} onClick={() => setSearching(true)}>
            <Icon name="search" size={17} />
          </button>
        </div>
      </div>

      {searching && <SocialSearch onClose={() => setSearching(false)} />}
    </>
  );
}

/* ── Search ────────────────────────────────────────────────────────────── */

/**
 * Find somebody.
 *
 * People, shops and forums - never items, which the marketplace search is
 * for. Results come in as you type, and following happens from the row, so
 * finding somebody and following them is one motion.
 */
export function SocialSearch({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { voice } = useVoice();
  const [q, setQ] = useState('');
  const [result, setResult] = useState<SocialSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followed, setFollowed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    document.body.classList.add('is-locked');
    return () => {
      document.removeEventListener('keydown', key);
      document.body.classList.remove('is-locked');
    };
  }, [onClose]);

  useEffect(() => {
    const needle = q.trim();
    if (!needle) {
      setResult(null);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = window.setTimeout(() => {
      api.socialSearch(needle)
        .then((found) => {
          if (!live) return;
          setResult(found);
          setError(null);
        })
        .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Search failed.'))
        .finally(() => live && setBusy(false));
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  const open = (to: string) => {
    onClose();
    navigate(to);
  };

  const follow = async (id: string) => {
    try {
      const { following } = await api.follow(id);
      setFollowed((all) => ({ ...all, [id]: following }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not follow.');
    }
  };

  const followButton = (id: string, already: boolean) => {
    // A shop has no follows of its own; the button is for people.
    if (voice.storeId) return null;
    const on = followed[id] ?? already;
    return (
      <button type="button" className={`followbtn${on ? ' is-on' : ''}`} onClick={() => void follow(id)}>
        {on ? <><Icon name="check" size={12} /> Following</> : <><Icon name="plus" size={12} /> Follow</>}
      </button>
    );
  };

  const empty = result && result.people.length + result.shops.length + result.forums.length === 0;

  return (
    <div className="socsearch social" role="dialog" aria-modal="true" aria-label="Search people, shops and forums">
      <div className="socsearch__bar">
        <label className="socsearch__field">
          <Icon name="search" size={17} />
          <input autoFocus value={q} onChange={(event) => setQ(event.target.value)}
            placeholder="People, shops, forums…" aria-label="Search people, shops and forums" />
          {busy && <span className="writer__spin socsearch__spin" aria-hidden="true" />}
        </label>
        <button type="button" className="socsearch__close" onClick={onClose}>Cancel</button>
      </div>

      <div className="socsearch__body">
        {error && <p className="notice notice--error">{error}</p>}
        {!q.trim() && (
          <div className="socsearch__intro">
            <span className="socsearch__glyph" aria-hidden="true"><Icon name="users" size={26} /></span>
            <strong>Find your people</strong>
            <span className="faint">Search by name or @handle. Items live in the Buy search.</span>
          </div>
        )}
        {empty && <p className="socsearch__none">Nobody by that name yet.</p>}

        {result && result.shops.length > 0 && (
          <section className="socsearch__group">
            <h2>Shops</h2>
            {result.shops.map((shop) => (
              <div key={shop.id} className="socsearch__row">
                <button type="button" className="socsearch__open"
                  onClick={() => open(shop.handle ? `/${shop.handle}` : `/social/c/${shop.id}`)}>
                  {shop.photoUrl ? <img className="socsearch__photo" src={shop.photoUrl} alt="" /> : <Avatar name={shop.name} size={44} />}
                  <span className="socsearch__who">
                    <strong>{shop.name} <span className="socsearch__kind">Shop</span></strong>
                    <span className="faint">{shop.handle ? `@${shop.handle} · ` : ''}{shop.followerCount} followers</span>
                  </span>
                </button>
                {shop.mine ? <span className="faint">Yours</span> : followButton(shop.id, shop.following)}
              </div>
            ))}
          </section>
        )}

        {result && result.people.length > 0 && (
          <section className="socsearch__group">
            <h2>People</h2>
            {result.people.map((person) => (
              <div key={person.id} className="socsearch__row">
                <button type="button" className="socsearch__open"
                  onClick={() => person.handle && open(`/${person.handle}`)}>
                  <Avatar name={person.name} size={44} />
                  <span className="socsearch__who">
                    <strong>{person.name}</strong>
                    <span className="faint">{person.handle ? `@${person.handle}` : ''}{person.bio ? ` · ${person.bio}` : ''}</span>
                  </span>
                </button>
                {followButton(person.id, person.following)}
              </div>
            ))}
          </section>
        )}

        {result && result.forums.length > 0 && (
          <section className="socsearch__group">
            <h2>Forums</h2>
            {result.forums.map((forum) => (
              <div key={forum.id} className="socsearch__row">
                <button type="button" className="socsearch__open" onClick={() => open(`/social/f/${forum.id}`)}>
                  <span className="forumav" aria-hidden="true"><Icon name="forum" size={20} /></span>
                  <span className="socsearch__who">
                    <strong>{forum.name}</strong>
                    <span className="faint">{forum.memberCount} members{forum.member ? ' · joined' : ''}</span>
                  </span>
                </button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

/* ── A room's bar ──────────────────────────────────────────────────────── */

/**
 * The strip a channel, a forum or a conversation keeps at its top.
 *
 * Low and edge to edge in the tab's gradient, locked while you scroll: back,
 * who this is, how big it is, and the one thing you might want to do about
 * them. Back goes back - to the list, the post, the profile, wherever you
 * came in from - and only falls back to `fallback` when there is nowhere to
 * go back to.
 */
export function RoomBar({ onBack, avatar, title, sub, action, tone = 'shop', reveal = false }: {
  onBack: () => void;
  avatar: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  tone?: 'shop' | 'forum' | 'chat';
  /**
   * Stay out of sight until the room's own header has scrolled away. A room
   * with a hero already says all of this at the top; the bar is for when the
   * hero is gone.
   */
  reveal?: boolean;
}) {
  const past = useScrolledPast(reveal ? REVEAL_AFTER_PX : 0);
  const shown = !reveal || past;
  return (
    <div className={`roombar roombar--${tone}${reveal ? ' roombar--reveal' : ''}${shown ? ' is-on' : ''}`}
      aria-hidden={!shown}>
      <div className="roombar__in">
        <button type="button" className="roombar__back" aria-label="Back" onClick={onBack}>
          <Icon name="back" size={19} />
        </button>
        <span className="roombar__avatar">{avatar}</span>
        <span className="roombar__text">
          <strong className="roombar__title">{title}</strong>
          {sub && <span className="roombar__sub">{sub}</span>}
        </span>
        {action && <span className="roombar__action">{action}</span>}
      </div>
    </div>
  );
}

const REVEAL_AFTER_PX = 150;

/** Whether the page has scrolled further down than `px`. */
export function useScrolledPast(px: number): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (px <= 0) return;
    const check = () => setPast(window.scrollY > px);
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [px]);
  return past;
}

/* ── Long press ────────────────────────────────────────────────────────── */

const LONG_PRESS_MS = 420;
const WANDER_PX = 10;

/**
 * Hold to open a message's actions - reply, react, copy - as every messenger
 * does, and right-click to do the same with a mouse.
 *
 * A tap stays a tap: links, photos and the quote inside a bubble keep
 * working, and a finger that moves is scrolling, not holding.
 */
export function useLongPress(onLong: () => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        navigator.vibrate?.(12);
        onLong();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > WANDER_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault();
      cancel();
      onLong();
    },
    /** Swallows the click that ends a long press, so it does not also tap. */
    onClickCapture: (event: ReactMouseEvent) => {
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
        fired.current = false;
      }
    },
  };
}
