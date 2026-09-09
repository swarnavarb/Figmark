import { StrictMode, useCallback, useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuthUser } from '@shared/contracts';
import { ApiRequestError, admin } from './api';
import { UsersView } from './UsersView';
import { DisputesView } from './DisputesView';
import '../styles.css';

/**
 * The operations console.
 *
 * Its own bundle, its own entry point, its own sign-in — deliberately not a tab
 * inside the marketplace. Everything in here deletes accounts, deletes what
 * people made, or moves money between strangers, and that surface should not be
 * one route away from the screen a buyer browses on.
 *
 * It is built to be served from a host of its own. Nothing here links back into
 * the marketplace and nothing in the marketplace links here, so pointing
 * `admin.<domain>` at this bundle is a DNS and hosting change rather than a
 * code one. Until then it lives at `/admin`.
 *
 * Access is not a role on a row. `isAdmin` is derived at request time from the
 * ADMIN_EMAILS setting, so it cannot be acquired by signing up, by a bug in a
 * write path, or by restoring a database from somewhere else. A deployment that
 * has not configured it has no operators at all, which is the right state for
 * one nobody has set up.
 */

type Tab = 'users' | 'disputes';

function Console() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('users');

  const refresh = useCallback(async () => {
    try {
      setUser((await admin.me()).user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) return <main className="ops__body"><p className="muted">Loading…</p></main>;
  if (!user) return <SignIn onSignedIn={refresh} />;

  // Signed in, but not as an operator. Said plainly rather than shown an empty
  // console: the fix is a configuration change, and the person reading this is
  // the one who would make it.
  if (!user.capabilities.isAdmin) {
    return (
      <main className="ops__body stack">
        <h1>Not an operator</h1>
        <p className="muted">
          <code>{user.email}</code> is signed in, but is not listed as an operator of this marketplace.
        </p>
        <p className="notice notice--info">
          Operators are named in the <code>ADMIN_EMAILS</code> application setting, as a comma-separated
          list of email addresses. Nobody has it by default — including whoever deployed this.
        </p>
        <button className="btn btn--quiet" style={{ justifySelf: 'start' }}
          onClick={() => void admin.signOut().then(refresh)}>
          Sign out
        </button>
      </main>
    );
  }

  return (
    <>
      <header className="ops__head">
        <div className="ops__brand">
          Figmark <span className="ops__tag">OPERATIONS</span>
        </div>
        <div className="row">
          <span className="faint">{user.email}</span>
          <button className="btn btn--quiet btn--sm" onClick={() => void admin.signOut().then(refresh)}>
            Sign out
          </button>
        </div>
      </header>

      <main className="ops__body ops">
        <div className="tabs">
          {(['users', 'disputes'] as Tab[]).map((entry) => (
            <button key={entry} className={`tab${tab === entry ? ' is-on' : ''}`} onClick={() => setTab(entry)}>
              {entry === 'users' ? 'People and stores' : 'Disputes'}
            </button>
          ))}
        </div>

        {tab === 'users' ? <UsersView /> : <DisputesView />}
      </main>
    </>
  );
}

/** A sign-in of its own, so no marketplace session assumption leaks in here. */
function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await admin.signIn(identifier, password);
      await onSignedIn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ops__body" style={{ maxWidth: 380, paddingTop: 64 }}>
      <div className="ops__brand" style={{ marginBottom: 20 }}>
        Figmark <span className="ops__tag">OPERATIONS</span>
      </div>
      <form className="card card--pad form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password" required />
        </label>
        {error && <p className="notice notice--error">{error}</p>}
        <button type="submit" className="btn btn--lg btn--block" disabled={busy}>
          {busy ? 'Please wait…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from admin.html.');

createRoot(container).render(
  <StrictMode>
    <Console />
  </StrictMode>,
);
