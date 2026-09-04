import { useState } from 'react';
import type { AuthUser } from '@shared/contracts';
import type { UserRole } from '@shared/enums';

interface Props {
  user: AuthUser | null;
  demoAccounts: Array<{ username: string; role: UserRole }>;
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
          <span className={`badge badge--role-${user.role}`}>{user.role}</span>
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
            <dt>Trust score</dt>
            <dd>
              {user.trust.score} <span className="muted">· not yet computed</span>
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
          {user.sellerProfile && (
            <div>
              <dt>Storefront</dt>
              <dd>
                {user.sellerProfile.storefrontName}{' '}
                <span className="muted">· {user.sellerProfile.tier} tier</span>
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
        The mock provider accepts the seeded accounts below. Signing in as a seller unlocks the lot
        manifest, which is a role-gated route.
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
                  {account.username} ({account.role})
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
