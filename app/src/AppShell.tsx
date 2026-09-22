import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Notifications } from './components/Notifications';
import { TabBar } from './components/TabBar';
import { Avatar, Icon } from './components/ui';
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

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    navigate(term.trim() ? `/?q=${encodeURIComponent(term.trim())}` : '/');
  }

  return (
    <div className="shell shell--tabbed">
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
          <NavLink to="/forwarders" className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}>
            Forwarders
          </NavLink>
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

      <Outlet />

      <TabBar />
    </div>
  );
}

/**
 * The avatar opens who you are: your page, your shop, what you bought, and the
 * way out. "My Purchases" rather than "My Orders" - it is the buyer's word.
 */
function ProfileMenu({ name, onSignOut }: { name: string; onSignOut: () => void }) {
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
          <Link role="menuitem" to="/shop" className="pmenu__item">🏪 My Storefront</Link>
          <Link role="menuitem" to="/purchases" className="pmenu__item">🛍️ My Purchases</Link>
          <button role="menuitem" type="button" className="pmenu__item pmenu__item--out" onClick={onSignOut}>
            👋 Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
