import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar, Icon } from './components/ui';
import { useSession } from './session';

/**
 * Persistent chrome: brand, search, and the Sell action.
 *
 * Search and "+ Sell" stay reachable from every page - the Xianyu pattern
 * where listing something is never more than one tap away.
 */
export function AppShell() {
  const { user, warning, signOut } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    navigate(term.trim() ? `/?q=${encodeURIComponent(term.trim())}` : '/');
  }

  return (
    <div className="shell">
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

        <nav className="nav__links">
          <NavLink to="/batches" className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}>
            Batches
          </NavLink>
          <NavLink to="/forwarders" className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`}>
            Forwarders
          </NavLink>
          <NavLink to="/sell" className="btn" style={{ padding: '8px 14px' }}>
            <Icon name="plus" size={15} /> Sell
          </NavLink>
          <NavLink to="/me" className={({ isActive }) => `nav__link${isActive ? ' is-active' : ''}`} title={user?.displayName}>
            {user ? <Avatar name={user.displayName} size={28} /> : 'Profile'}
          </NavLink>
          <button type="button" className="btn btn--quiet" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>

      {warning && (
        <div className="page" style={{ paddingBottom: 0 }}>
          <p className="notice notice--info">{warning}</p>
        </div>
      )}

      <Outlet />
    </div>
  );
}
