import { useCallback, useEffect, useState } from 'react';
import type { AuthUser, HealthResponse } from '@shared/contracts';
import type { Lot, Order } from '@shared/models';
import { ApiRequestError, api, type ManifestTotals } from './api';
import { LotsPanel } from './components/LotsPanel';
import { SignInPanel } from './components/SignInPanel';
import { StatusPanel } from './components/StatusPanel';

/** Shared password for the seeded mock accounts; development only. */
const DEMO_PASSWORD = 'figmark-dev';

type Manifest = { lot: Lot; orders: Order[]; totals: ManifestTotals };

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // One initial load: whether the API is up, who we are, and what's for sale.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [healthResult, meResult, lotsResult] = await Promise.all([
          api.health(),
          api.me(),
          api.lots(),
        ]);
        if (cancelled) return;
        setHealth(healthResult);
        setUser(meResult.user);
        setLots(lotsResult.lots);
        setHealthError(null);
      } catch (err) {
        if (!cancelled) setHealthError(describe(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    setBusy(true);
    setAuthError(null);
    try {
      const result = await api.login(username, password);
      setUser(result.user);
    } catch (err) {
      setAuthError(describe(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    try {
      await api.logout();
      setUser(null);
      // A manifest is role-gated, so it must not outlive the session.
      setManifest(null);
      setManifestError(null);
    } catch (err) {
      setAuthError(describe(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const openManifest = useCallback(async (lot: Lot) => {
    setManifestError(null);
    try {
      setManifest(await api.manifest(lot.sellerId, lot.id));
    } catch (err) {
      setManifestError(describe(err));
    }
  }, []);

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead__brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <h1>Figmark</h1>
            <p>Group-buy lots, order manifests, escrow and verified two-sided reviews.</p>
          </div>
        </div>
        <p className="masthead__note">
          Scaffold — the build and deploy pipeline is live. Feature work starts from here.
        </p>
      </header>

      <main className="grid">
        <StatusPanel health={health} error={healthError} />

        <SignInPanel
          user={user}
          demoAccounts={health?.auth.demoAccounts ?? []}
          demoPassword={DEMO_PASSWORD}
          busy={busy}
          error={authError}
          onSignIn={(username, password) => void signIn(username, password)}
          onSignOut={() => void signOut()}
        />

        <div className="grid__wide">
          <LotsPanel
            lots={lots}
            user={user}
            manifest={manifest}
            manifestError={manifestError}
            onOpenManifest={(lot) => void openManifest(lot)}
            onCloseManifest={() => setManifest(null)}
          />
        </div>
      </main>

      <footer className="footer">
        <p>
          Seeded demo data. No real listings, users or payments.
          {health && <> Auth mode: {health.auth.mode}.</>}
        </p>
      </footer>
    </div>
  );
}

function describe(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
