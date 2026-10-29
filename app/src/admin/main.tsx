import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuthUser, HealthResponse } from '@shared/contracts';
import type { OpsOverview, OverviewQueues } from '@shared/overview';
import { ApiRequestError, admin } from './api';
import { UsersView } from './UsersView';
import { DisputesView } from './DisputesView';
import { ApprovalsView } from './ApprovalsView';
import { PaymentsView } from './PaymentsView';
import { AuditView } from './AuditView';
import { LearnView } from './LearnView';
import { ReportsView } from './ReportsView';
import { SettingsView } from './SettingsView';
import { StoresView } from './StoresView';
import { DevicesView } from './DevicesView';
import { PhotosView } from './PhotosView';
import { RoutesView } from './RoutesView';
import { ChallengeView } from './ChallengeView';
import { DashboardView } from './DashboardView';
import { GROUPS, SECTIONS, isTab, type Tab } from './sections';
import { backOps, goOps, useOpsPath } from './nav';
import { BackBar } from '../components/ScrollManager';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Feedback';
import '../styles.css';
import '../styles/admin.css';

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

function Console() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const { path } = useOpsPath();
  const first = path.split('/')[0] ?? '';
  const tab: Tab = isTab(first) ? first : 'overview';
  const nested = path.includes('/');
  const ready = Boolean(user?.capabilities.isAdmin && !user.mfaRequired);
  const overview = useOverview(ready, tab);

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

  // The phone's menu closes on the way to wherever it was used to go.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    document.documentElement.classList.add('ops-locked');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('ops-locked');
    };
  }, [menuOpen]);

  if (loading) return <main className="ops__body"><Loading /></main>;
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
          list of email addresses. Nobody has it by default — including whoever deployed this. The address
          must also be confirmed on the account (Profile → Verification).
        </p>
        <button className="btn btn--quiet" style={{ justifySelf: 'start' }}
          onClick={() => void admin.signOut().then(refresh)}>
          Sign out
        </button>
      </main>
    );
  }

  // An operator, but without the second factor the console requires.
  if (user.mfaRequired) {
    return (
      <main className="ops__body stack">
        <h1>Turn on two-factor sign-in</h1>
        <p className="muted">
          Operators need two-factor sign-in before they can use this console. Turn it on in the marketplace under
          Profile → Settings → Two-factor sign-in, then come back.
        </p>
        <a className="btn" style={{ justifySelf: 'start' }} href="/me?tab=settings">Open settings</a>
        <button className="btn btn--quiet" style={{ justifySelf: 'start' }}
          onClick={() => void refresh()}>
          I have turned it on
        </button>
      </main>
    );
  }

  const queues = overview.data?.queues;

  return (
    <div className="opsx">
      <header className="opsx__top">
        <button type="button" className="opsx__menu" aria-label="Open the menu" aria-expanded={menuOpen}
          aria-controls="ops-menu" onClick={() => setMenuOpen(true)}>
          <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
          {queues && waitingTotal(queues) > 0 && <i className="opsx__pip" aria-hidden="true" />}
        </button>
        <span className="opsx__where ops__brand">Figmark <span className="ops__tag">OPERATIONS</span></span>
      </header>

      <div className={`opsx__scrim${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />

      <aside id="ops-menu" className={`opsx__side${menuOpen ? ' is-open' : ''}`} aria-label="Console">
        <div className="opsx__brand">
          <span className="ops__brand">Figmark <span className="ops__tag">OPERATIONS</span></span>
          <button type="button" className="opsx__close" aria-label="Close the menu" onClick={() => setMenuOpen(false)}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <nav className="opsx__nav">
          {GROUPS.map((group) => (
            <div key={group.title ?? 'home'} className="opsx__group">
              {group.title && <span className="opsx__heading">{group.title}</span>}
              {group.sections.map((section) => {
                const waiting = section.queue ? queues?.[section.queue] ?? 0 : 0;
                const urgent = section.tab === 'disputes' && (queues?.disputesOverdue ?? 0) > 0;
                return (
                  <button key={section.tab} type="button"
                    className={`opsx__item${tab === section.tab ? ' is-on' : ''}`}
                    aria-current={tab === section.tab ? 'page' : undefined}
                    onClick={() => (tab === section.tab && !nested ? setMenuOpen(false) : goOps(section.tab))}>
                    <Icon name={section.icon} size={18} />
                    <span className="opsx__label">{section.label}</span>
                    {waiting > 0 && (
                      <span className={`opsx__count${urgent ? ' opsx__count--urgent' : ''}`}
                        aria-label={`${waiting} waiting`}>{waiting > 99 ? '99+' : waiting}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="opsx__foot">
          <span className="opsx__who" title={user.email}>{user.email}</span>
          <button className="btn btn--ghost btn--sm" onClick={() => void admin.signOut().then(refresh)}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="opsx__main ops">
        {/* A screen opened inside a tab draws its own back control; a tab's is back to the overview. */}
        {!nested && tab !== 'overview' && <BackBar onBack={() => backOps('overview')} title={SECTIONS[tab].label} />}

        {tab === 'overview' ? (
          <DashboardView data={overview.data} error={overview.error} busy={overview.busy} onRefresh={overview.reload} />
        ) : tab === 'users' ? <UsersView />
          : tab === 'stores' ? <StoresView />
          : tab === 'disputes' ? <DisputesView />
          : tab === 'approvals' ? <ApprovalsView />
          : tab === 'payments' ? <PaymentsView />
          : tab === 'reports' ? <ReportsView />
          : tab === 'devices' ? <DevicesView />
          : tab === 'photos' ? <PhotosView />
          : tab === 'routes' ? <RoutesView />
          : tab === 'challenge' ? <ChallengeView />
          : tab === 'settings' ? <SettingsView />
          : tab === 'audit' ? <AuditView />
          : <LearnView />}

        <BackendStatus />
      </main>
    </div>
  );
}

const waitingTotal = (queues: OverviewQueues) =>
  (queues.disputesOpen ?? 0) + (queues.actionsPending ?? 0) + (queues.reportsOpen ?? 0) + (queues.storesPending ?? 0);

/** How long the overview counts as fresh: opening another tab inside it does not ask again. */
const OVERVIEW_FRESH_MS = 30_000;

/**
 * The overview, held by the console: the dashboard draws it and the menu's
 * counts come from it, so the two never disagree. Asked for again on a tab
 * change once it is older than half a minute - after an operator has worked a
 * queue, its count is current by the time they look - and shown as it was
 * while the new one is on its way, so nothing blanks.
 */
function useOverview(ready: boolean, tab: Tab) {
  const [data, setData] = useState<OpsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(0);

  const reload = useCallback(() => {
    asked.current = Date.now();
    setBusy(true);
    admin.overview()
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the overview.'))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    if (ready && Date.now() - asked.current > OVERVIEW_FRESH_MS) reload();
  }, [ready, tab, reload]);

  return { data, error, busy, reload };
}

/**
 * What the API is running on, at the foot of the console.
 *
 * The marketplace has a banner for this; the console had nothing, so a
 * misconfigured or unreachable database looked identical to an empty one from
 * in here. It is quiet when everything is as it should be and states the
 * problem when it is not, because the person reading this screen is the one who
 * would fix it.
 */
function BackendStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    void admin.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  if (!health) return null;

  const data = health.data;
  const missing = data.missingContainers ?? [];
  const wrong = !data.connected || data.signInAccounts === 0 || missing.length > 0;

  return (
    <footer className="ops__status">
      {wrong ? (
        <p className="notice notice--error">{data.detail}</p>
      ) : (
        <p className="faint">
          {[
            data.backend,
            // The in-memory backend has no database to name, and an empty
            // segment between two separators reads as a missing value.
            data.database,
            `${data.signInAccounts} sign-in account(s)`,
            `v${health.version}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </footer>
  );
}

/** A sign-in of its own, so no marketplace session assumption leaks in here. */
function SignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [askOtp, setAskOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await admin.signIn(identifier, password, askOtp ? otp : undefined);
      await onSignedIn();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'mfa_required') setAskOtp(true);
      else setError(err instanceof ApiRequestError ? err.message : 'Could not sign in.');
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
        {askOtp && (
          <label className="field">
            <span>Code from your authenticator app</span>
            <input value={otp} onChange={(e) => setOtp(e.target.value.slice(0, 16))} autoFocus
              autoComplete="one-time-code" required />
          </label>
        )}
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
