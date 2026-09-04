import { useState } from 'react';
import type { AuthUser, DemoAccount } from '@shared/contracts';

interface Props {
  user: AuthUser | null;
  demoAccounts: DemoAccount[];
  demoPassword: string;
  busy: boolean;
  error: string | null;
  onSignIn: (username: string, password: string) => void;
  onSignOut: () => void;
}

/**
 * Exercises the auth seam end to end. It talks only to the API's auth routes -
 * it has no idea which provider is behind them, which is the property the swap
 * to real auth depends on.
 */
export function SignInPanel({
  user,
  demoAccounts,
  demoPassword,
  busy,
  error,
  onSignIn,
  onSignOut,
}: Props) {
  // `null` means "the user has not picked yet", so the field follows the first
  // seeded account once /api/health arrives. Seeding useState with
  // `demoAccounts[0]` instead would freeze the empty value from the first
  // render - the select would *display* the first account while the state
  // behind it stayed empty, and sign-in would post a blank username.
  const [chosenUsername, setChosenUsername] = useState<string | null>(null);
  const [chosenPassword, setChosenPassword] = useState<string | null>(null);

  const username = chosenUsername ?? demoAccounts[0]?.username ?? '';
  const password = chosenPassword ?? demoPassword;

  if (user) {
    return (
      <section className="panel">
        <div className="panel__head">
          <h2>Session</h2>
          <CapabilityBadges capabilities={user.capabilities} />
        </div>

        <p className="lead">
          Signed in as <strong>{user.displayName}</strong>
        </p>

        <dl className="facts">
          <div>
            <dt>User ID</dt>
            <dd className="mono">{user.id}</dd>
          </div>
          <div>
            <dt>Trust</dt>
            <dd>
              buyer {user.buyerTrust.score} · seller {user.sellerTrust.score}{' '}
              <span className="muted">· not yet computed</span>
            </dd>
          </div>
          <div>
            <dt>Verification</dt>
            <dd>
              <span className="muted">
                ID {user.verification.governmentId} · bank {user.verification.bankAccountMatch}
              </span>
            </dd>
          </div>
          {user.sellerProfile ? (
            <div>
              <dt>Storefront</dt>
              <dd>
                {user.sellerProfile.storefrontName}{' '}
                <span className="muted">· {user.sellerProfile.tier} tier</span>
              </dd>
            </div>
          ) : (
            <div>
              <dt>Storefront</dt>
              <dd className="muted">None yet · created on first listing</dd>
            </div>
          )}
          {user.forwarderProfile && (
            <div>
              <dt>Forwarder</dt>
              <dd>
                {user.forwarderProfile.companyName}{' '}
                <span className="muted">· {user.forwarderProfile.routes.length} routes</span>
              </dd>
            </div>
          )}
        </dl>

        <button type="button" className="button button--ghost" onClick={onSignOut} disabled={busy}>
          Sign out
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Session</h2>
      <p className="muted">
        The mock provider accepts the seeded accounts below. Every account can both buy and sell -
        the lot manifest is gated on the <code>sell</code> capability plus ownership, not on a role.
      </p>

      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          onSignIn(username, password);
        }}
      >
        <label className="field">
          <span>Account</span>
          {demoAccounts.length > 0 ? (
            <select value={username} onChange={(event) => setChosenUsername(event.target.value)}>
              {demoAccounts.map((account) => (
                <option key={account.username} value={account.username}>
                  {account.username} ({account.label})
                </option>
              ))}
            </select>
          ) : (
            <input
              value={username}
              onChange={(event) => setChosenUsername(event.target.value)}
              autoComplete="username"
            />
          )}
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setChosenPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>

        <button type="submit" className="button" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      {error && <p className="status status--bad">{error}</p>}
    </section>
  );
}

/** Shows what the account may do, rather than what it "is". */
function CapabilityBadges({ capabilities }: { capabilities: AuthUser['capabilities'] }) {
  const held = [
    capabilities.isAdmin && 'admin',
    capabilities.canBuy && 'buy',
    capabilities.canSell && 'sell',
    capabilities.canForward && 'forward',
  ].filter((entry): entry is string => typeof entry === 'string');

  if (held.length === 0) return <span className="badge">no capabilities</span>;

  return (
    <span className="badges">
      {held.map((capability) => (
        <span key={capability} className="badge badge--capability">
          {capability}
        </span>
      ))}
    </span>
  );
}
