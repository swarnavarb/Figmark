import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
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
          <NavLink to="/me" className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`} title={user?.displayName}>
            {user ? <Avatar name={user.displayName} size={28} /> : 'Profile'}
          </NavLink>
          <button type="button" className="btn btn--quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>

      {sessionsInsecure && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <p className="notice notice--error">
            Sessions are signed with the development key published in this repository, so they can be
            forged. Set <code>AUTH_SESSION_SECRET</code> in the app settings before any real user data.
          </p>
        </div>
      )}

      {/* A feature whose container does not exist fails on its own screen and
          nowhere else, which makes it look like a bug in that screen. Name it
          where every screen can see it. */}
      {missingContainers.length > 0 && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <p className="notice notice--error">
            The database is missing {missingContainers.length === 1 ? 'a container' : 'containers'}:{' '}
            <code>{missingContainers.join(', ')}</code>. Anything that reads {missingContainers.length === 1 ? 'it' : 'them'} will
            fail. Run <code>npm run azure:provision</code> to create {missingContainers.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}

      {warning && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <p className="notice notice--info">{warning}</p>
        </div>
      )}

      <Outlet />

      <TabBar />
    </div>
  );
}
