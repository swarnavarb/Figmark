import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { FloatingCalc } from './components/FloatingCalcFab';
import { Notifications } from './components/Notifications';
import { ScrollBars } from './components/ScrollBars';
import { ScrollManager } from './components/ScrollManager';
import { TabBar, tabFor, type TabId } from './components/TabBar';
import { MarketSearch } from './components/MarketSearch';
import { ViewportSync } from './components/ViewportSync';
import { Avatar, Icon, Modal } from './components/ui';
import { api } from './api';
import { useSession } from './session';
import { VerifyNudge, VerifyPrompt } from './components/VerifyNudges';
import { inviteCodeFor } from './components/inviteCode';
import { setPhotoQuery } from './photoQuery';
import { PageLoading } from './components/Feedback';

/** The sign-in sheet, fetched the first time somebody needs it. */
const AuthModal = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthModal })));

/**
 * Persistent chrome: brand, search, the cart and who you are.
 *
 * Search and "+ Sell" stay reachable from every page - the Xianyu pattern
 * where listing something is never more than one tap away.
 */
// A forum's hero opens in this colour (see .forumhero), so the phone's status
// bar takes it too rather than the Social tab's pink.
const FORUM_STATUS = '#C627CB';

export function AppShell() {
  const { user, warning, sessionsInsecure, missingContainers, dataPerWorker, testEnvironment, signOut, authPrompt, closeAuth, promptAuth } = useSession();
  const isStaff = Boolean(user?.capabilities?.isAdmin);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const [searching, setSearching] = useState(false);
  const { pathname } = useLocation();
  const social = pathname.startsWith('/social') || pathname.startsWith('/messages/');
  // A room you write in: the tab bar steps aside for the bar you write from.
  const room = pathname.startsWith('/social/c/') || pathname.startsWith('/messages/');

  // A test site is kept out of search results, so nobody finds it instead of
  // the real one. Added once the health check names the environment.
  useEffect(() => {
    if (!testEnvironment) return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [testEnvironment]);

  useInviteParam();
  // The invite code goes on every link this person shares; ask for it early
  // so the share sheet never waits on it.
  useEffect(() => { void inviteCodeFor(user?.id); }, [user?.id]);

  // Each section's header carries that section's hue, the same one its pill
  // in the tab bar does; a page outside the six reads as Shop, as the bar does.
  const tone = tabFor(pathname).id;
  // Before paint: Safari picks its status bar colour from the first frame it
  // sees, so a frame in the wrong tone sticks. (public/boot/tone.js sets the first
  // page's tone before any of this loads.)
  useLayoutEffect(() => {
    document.documentElement.dataset.tone = tone;
    // The phone's own status bar takes the header's colour, so the header
    // reads as running to the very top of the screen. A new tag rather than
    // a changed one: Safari does not always notice an edited theme-color.
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = pathname.startsWith('/social/f/') ? FORUM_STATUS : TONE_STATUS[tone];
    document.querySelectorAll('meta[name="theme-color"]').forEach((old) => old.remove());
    document.head.append(meta);
  }, [tone, pathname]);

  const closeSearch = useCallback(() => setSearching(false), []);
  const submitSearch = useCallback((term: string) => {
    setSearching(false);
    // On the catalogue a search narrows what is already filtered rather than
    // throwing the filters away; from anywhere else it starts fresh.
    const next = new URLSearchParams(pathname === '/' ? params : undefined);
    // Words replace a photo search rather than narrowing it.
    next.delete('photo');
    if (term) next.set('q', term);
    else next.delete('q');
    const suffix = next.toString();
    navigate(suffix ? `/?${suffix}` : '/');
  }, [navigate, params, pathname]);
  /** A photo search starts the catalogue afresh: the photo is the whole question. */
  const searchPhoto = useCallback((dataUrl: string) => {
    setSearching(false);
    navigate(`/?photo=${setPhotoQuery(dataUrl).id}`);
  }, [navigate]);

  return (
    // The social screens bring their own header - one gradient block with the
    // brand, the bell and you on it - so the marketplace one steps aside there.
    <div className={`shell shell--tabbed${social ? ' shell--social' : ''}${room ? ' shell--room' : ''}`}>
      {/* The colour under the clock, and what Safari reads for its status
          bar (see .topstrip in the stylesheet). A new element for each
          section: Safari samples its status bar colour again when the bar
          at the top is replaced, but not when its colour changes. */}
      <div key={pathname.startsWith('/social/f/') ? `${tone}-forum` : tone} className="topstrip" aria-hidden="true" />
      <ScrollManager />
      <ScrollBars />
      <ViewportSync />
      <header className="nav">
        <NavLink to="/" className="brand" aria-label="Figmark home">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">Figmark</span>
        </NavLink>

        {/* Buy, sell and social moved to the tab bar; what belongs up here is
            the things that are not a section - search, who you are, and the
            way out. */}
        <nav className="nav__links">
          {/* The social tab's search, with items in it: a glass icon that
              opens the search sheet, marked while a search is on. */}
          <button type="button" className={`navsearch${query || params.get('photo') ? ' is-set' : ''}`} onClick={() => setSearching(true)}
            aria-label={query ? `Searching for ${query}. Change the search` : 'Search items, shops, people and forums'}>
            <Icon name="search" size={18} />
          </button>
          {/* The cart: every Buy not yet paid or booked. Forwarders, which
              used to sit here, are under Services now. */}
          {user && <CartButton />}
          {/* Before the avatar, because it is about you rather than about the
              app, and because that is where a thumb already goes. */}
          {user && <Notifications />}
          {/* A guest sees the same bell, locked, and a way in where the avatar goes. */}
          {!user && (
            <div className="bell">
              <button type="button" className="bell__button" aria-label="Notifications - sign in to see them"
                onClick={() => promptAuth('Sign in to see your notifications.')}>
                <Icon name="bell" size={18} />
              </button>
            </div>
          )}
          {user ? (
            <ProfileMenu name={user.displayName} onSignOut={() => void signOut()} />
          ) : (
            <button type="button" className="btn btn--sm navlogin" onClick={() => promptAuth(undefined, 'signin')}>Log in</button>
          )}
        </nav>
      </header>
      {/* Not a dialog: browsing needs no verification, so the reminder waits up here.
          The social screens' headers run to the top of the screen, so there it
          sits under the social header instead (see SocialPage). */}
      {!social && <VerifyNudge />}

      {isStaff && sessionsInsecure && (
        <div className="page page--notice">
          <p className="notice notice--error notice--standing">
            Sessions are signed with the development key published in this repository, so they can be
            forged. Set <code>AUTH_SESSION_SECRET</code> in the app settings before any real user data.
          </p>
        </div>
      )}

      {/* Setup problems are for the people running the site: a visitor is told
          nothing about how it is built or what is missing. */}
      {/* Staff act on other people's money: until two-factor is on, say so on every screen. */}
      {user?.mfaRequired && <StaffMfaNotice />}

      {/* A feature whose container does not exist fails on its own screen and
          nowhere else, which makes it look like a bug in that screen. Name it
          where every screen can see it. */}
      {isStaff && missingContainers.length > 0 && (
        <div className="page page--notice">
          <p className="notice notice--error notice--standing">
            The database is missing {missingContainers.length === 1 ? 'a container' : 'containers'}:{' '}
            <code>{missingContainers.join(', ')}</code>. Anything that reads {missingContainers.length === 1 ? 'it' : 'them'} will
            fail. Run <code>npm run azure:provision</code> to create {missingContainers.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}

      {/* Development shares the code and the look of the real site, so say on
          every page which one this is. */}
      {testEnvironment && (
        <div className="page page--notice">
          <p className="notice notice--info notice--standing">
            <strong>{testEnvironment.toUpperCase()}</strong> - this is a test site with test data. Nothing here is real.
          </p>
        </div>
      )}

      {/* Each worker has its own memory, so a tester's new account or item is
          there on one page load and gone on the next. Say so before it reads as a bug. */}
      {isStaff && dataPerWorker && (
        <div className="page page--notice">
          <p className="notice notice--warn notice--standing">
            This test server keeps its data in memory on each of its workers, so something you create can be
            missing on the next page load and is lost on restart. Point it at Cosmos DB for shared testing.
          </p>
        </div>
      )}

      {warning && (
        <div className="page page--notice">
          <p className="notice notice--info notice--standing">{warning}</p>
        </div>
      )}

      {/* Each screen is its own download (see main.tsx), fetched the first
          time it is opened; the chrome around it stays put meanwhile. */}
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>

      {user && <FloatingCalc />}

      <TabBar />
      {searching && <MarketSearch initial={query} onClose={closeSearch} onSubmit={submitSearch} onPhoto={searchPhoto} />}
      {authPrompt && <Suspense fallback={null}><AuthModal reason={authPrompt.reason} mode={authPrompt.mode} onClose={closeAuth} /></Suspense>}
      <VerifyPrompt />
    </div>
  );
}

/**
 * The colour each section's header runs in, keyed in the stylesheet by
 * `data-tone` on the root. This is the phone's status bar under the clock, and
 * the same colour as the header's top edge (--top-rgb in the stylesheet), so
 * the two read as one block. public/boot/tone.js repeats the paths and
 * colours, to set the first page's tone before paint.
 */
const TONE_STATUS: Record<TabId, string> = {
  buy: '#5B5EF1',
  discover: '#8B2FC9',
  sell: '#177ACE',
  services: '#3A8C4E',
  social: '#FF3471',
  quests: '#C46A08',
};

/**
 * The cart, with how many items are waiting in it.
 *
 * Re-counted whenever the screen changes, because that is when an item can
 * have joined it (Buy on a listing) or left it (paid or booked on the order).
 */
function CartButton() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api.myItems()
      .then((result) => {
        if (cancelled) return;
        setCount(result.groups.reduce((total, group) => total + group.items.filter((item) => !item.placed).length, 0));
      })
      .catch(() => { /* A count that cannot load is simply not shown. */ });
    return () => { cancelled = true; };
  }, [pathname]);

  return (
    <NavLink to="/cart" className={({ isActive }) => `navcart${isActive ? ' is-active' : ''}`}
      aria-label={count > 0 ? `Cart, ${count} ${count === 1 ? 'item' : 'items'}` : 'Cart'}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2" />
        <circle cx="10" cy="20" r="1.3" />
        <circle cx="17" cy="20" r="1.3" />
      </svg>
      {count > 0 && <span className="navcart__dot">{count > 9 ? '9+' : count}</span>}
    </NavLink>
  );
}

/**
 * The avatar opens who you are: your page, your shop, what you bought, and the
 * way out. "My Purchases" rather than "My Orders" - it is the buyer's word.
 */
export function ProfileMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const { signOutEverywhere } = useSession();
  // One Sign Out, and then the question of where: just here, or everywhere.
  const [choosing, setChoosing] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="pmenu" ref={box}>
      <button type="button" className="pmenu__btn" aria-haspopup="menu" aria-expanded={open}
        title={name} onClick={() => setOpen((now) => !now)}>
        <Avatar name={name} size={30} />
      </button>
      {open && (
        <div className="pmenu__panel" role="menu">
          <span className="pmenu__who">{name}</span>
          <Link role="menuitem" to="/me" className="pmenu__item">🙂 My Profile</Link>
          <Link role="menuitem" to="/quests" className="pmenu__item">🏆 Quests &amp; rewards</Link>
          <Link role="menuitem" to="/shop" className="pmenu__item">🏪 My Storefront</Link>
          <Link role="menuitem" to="/purchases" className="pmenu__item">🛍️ My Purchases</Link>
          <Link role="menuitem" to="/cart" className="pmenu__item">🛒 My Cart</Link>
          <Link role="menuitem" to="/wallet" className="pmenu__item">👛 My wallet</Link>
          <Link role="menuitem" to="/disputes" className="pmenu__item">⚖️ My disputes</Link>
          <Link role="menuitem" to="/learn" className="pmenu__item">📘 Learn</Link>
          <Link role="menuitem" to="/legal" className="pmenu__item">📄 Terms &amp; policies</Link>
          <button role="menuitem" type="button" className="pmenu__item pmenu__item--out"
            onClick={() => { setOpen(false); setChoosing(true); }}>
            👋 Sign Out
          </button>
        </div>
      )}
      {choosing && (
        <Modal title="Sign out" onClose={() => setChoosing(false)}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Sign out of this device only, or of every phone and computer this account is signed in on?
            </p>
            <button type="button" className="btn" onClick={() => { setChoosing(false); onSignOut(); }}>
              Sign out from this device
            </button>
            <button type="button" className="btn btn--danger" onClick={() => { setChoosing(false); void signOutEverywhere(); }}>
              Sign out from everywhere
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setChoosing(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * A page opened from a shared link carries the sharer's invite as `?i=`.
 *
 * The server counts the open for them, and a guest keeps the invite until
 * they sign up. Then the code comes off the address, so it is not copied on
 * by accident and does not count twice.
 */
function useInviteParam() {
  const [params] = useSearchParams();
  const { pathname, state } = useLocation();
  const navigate = useNavigate();
  const code = params.get('i');

  useEffect(() => {
    // `/s/...` is about to become the page itself; count it once it has.
    if (!code || pathname.startsWith('/i/') || pathname.startsWith('/s/')) return;
    const item = pathname.match(/^\/listing\/([^/]+)$/);
    const handle = pathname.match(/^\/([A-Za-z0-9_.]+)$/);
    const page = item ? { t: 'item' as const, id: decodeURIComponent(item[1]!) }
      : handle ? { t: 'profile' as const, id: handle[1]! }
        : null;
    void api.openInvite(code, page).catch(() => undefined);
    const rest = new URLSearchParams(params);
    rest.delete('i');
    const suffix = rest.toString();
    navigate(`${pathname}${suffix ? `?${suffix}` : ''}`, { replace: true, state });
    // Only the code arriving somewhere it can be counted is an event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, pathname.startsWith('/s/')]);
}

/** Set once the two-factor reminder is closed; back on the next visit. */
const MFA_NOTICE_HIDDEN_KEY = 'figmark.staffMfa.hidden';

/**
 * Operators and community managers without two-factor: staff actions are
 * refused until it is on, so the reminder comes back every visit - but it can
 * be closed for this one, rather than sitting over every screen.
 */
function StaffMfaNotice() {
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(MFA_NOTICE_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden) return null;

  function hide() {
    setHidden(true);
    try {
      sessionStorage.setItem(MFA_NOTICE_HIDDEN_KEY, '1');
    } catch {
      /* A private window: it comes back next page load, which is fine. */
    }
  }

  return (
    <div className="page page--notice">
      <p className="notice notice--warn notice--standing notice--closable">
        <span>Turn on two-factor sign-in to keep acting as staff. <Link to="/me?tab=settings">Set it up</Link></span>
        <button type="button" className="notice__close" aria-label="Hide for now" onClick={hide}>✕</button>
      </p>
    </div>
  );
}
