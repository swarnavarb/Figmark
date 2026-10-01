import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { FloatingCalc } from './components/FloatingCalcFab';
import { Notifications } from './components/Notifications';
import { ScrollBars } from './components/ScrollBars';
import { ScrollManager } from './components/ScrollManager';
import { TabBar } from './components/TabBar';
import { Avatar, Icon } from './components/ui';
import { api } from './api';
import { useSession } from './session';

/**
 * Persistent chrome: brand, search, and the Sell action.
 *
 * Search and "+ Sell" stay reachable from every page - the Xianyu pattern
 * where listing something is never more than one tap away.
 */
export function AppShell() {
  const { user, warning, sessionsInsecure, missingContainers, signOut } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const { pathname } = useLocation();
  const social = pathname.startsWith('/social') || pathname.startsWith('/messages/');
  // A room you write in: the tab bar steps aside for the bar you write from.
  const room = pathname.startsWith('/social/c/') || pathname.startsWith('/messages/');

  // The phone's own status bar takes the social tab's colour, so the header
  // reads as running to the very top of the screen.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = social ? '#FF3A5C' : '#080B12';
  }, [social]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    navigate(term.trim() ? `/?q=${encodeURIComponent(term.trim())}` : '/');
  }

  return (
    // The social screens bring their own header - one gradient block with the
    // brand, the bell and you on it - so the marketplace one steps aside there.
    <div className={`shell shell--tabbed${social ? ' shell--social' : ''}${room ? ' shell--room' : ''}`}>
      <ScrollManager />
      <ScrollBars />
      <header className="nav">
        <NavLink to="/" className="brand" onClick={() => setTerm('')}>
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">Figmark</span>
        </NavLink>

        <form className="nav__search" onSubmit={submitSearch} role="search">
          <div className="search">
            <span className="search__icon">
              <Icon name="search" />
            </span>
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search figures, kits, sneakers, electronics…"
              aria-label="Search listings"
            />
          </div>
        </form>

        {/* Buy, sell and social moved to the tab bar; what belongs up here is
            the things that are not a section - search, who you are, and the
            way out. */}
        <nav className="nav__links">
          {/* The cart: every Buy not yet paid or booked. Forwarders, which
              used to sit here, are under Services now. */}
          {user && <CartButton />}
          {/* Before the avatar, because it is about you rather than about the
              app, and because that is where a thumb already goes. */}
          {user && <Notifications />}
          {user ? (
            <ProfileMenu name={user.displayName} onSignOut={() => void signOut()} />
          ) : (
            <NavLink to="/me" className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}>Profile</NavLink>
          )}
        </nav>
      </header>

      {sessionsInsecure && (
        <div className="page page--notice">
          <p className="notice notice--error notice--standing">
            Sessions are signed with the development key published in this repository, so they can be
            forged. Set <code>AUTH_SESSION_SECRET</code> in the app settings before any real user data.
          </p>
        </div>
      )}

      {/* A feature whose container does not exist fails on its own screen and
          nowhere else, which makes it look like a bug in that screen. Name it
          where every screen can see it. */}
      {missingContainers.length > 0 && (
        <div className="page page--notice">
          <p className="notice notice--error notice--standing">
            The database is missing {missingContainers.length === 1 ? 'a container' : 'containers'}:{' '}
            <code>{missingContainers.join(', ')}</code>. Anything that reads {missingContainers.length === 1 ? 'it' : 'them'} will
            fail. Run <code>npm run azure:provision</code> to create {missingContainers.length === 1 ? 'it' : 'them'}.
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
      <Suspense fallback={<main className="page"><p className="muted">Loading…</p></main>}>
        <Outlet />
      </Suspense>

      {user && <FloatingCalc />}

      <TabBar />
    </div>
  );
}

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
          <button role="menuitem" type="button" className="pmenu__item pmenu__item--out" onClick={onSignOut}>
            👋 Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
