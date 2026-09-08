import { useEffect, useState, type FormEvent } from 'react';
import type { DemoAccount } from '@shared/contracts';
import { checkUsername, suggestUsername, USERNAME_PROBLEMS } from '@shared/handles';
import { ApiRequestError, api } from '../api';
import { ErrorNotice } from '../components/ui';
import { useSession } from '../session';

type Mode = 'signin' | 'signup';

/**
 * The single entry point for signed-out visitors.
 *
 * Sign-in takes an email or a phone number - the server normalises and resolves
 * either. Sign-up collects the minimum that makes an account usable; ID and
 * bank verification are deferred to the point they actually matter.
 */
export function AuthPage() {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<Mode>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoAccount[]>([]);
  const [durable, setDurable] = useState(true);
  /** Set when the server already knows no sign-in can succeed. */
  const [blocked, setBlocked] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  /** Empty means "use the suggestion", which is what the placeholder shows. */
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // The seeded sign-in hint, shown only while the mock provider is active.
  useEffect(() => {
    let cancelled = false;
    void api
      .health()
      .then((health) => {
        if (cancelled) return;
        if (health.auth.mode === 'mock') setDemo(health.auth.demoAccounts);
        setDurable(health.auth.accountsDurable);
        // Say why sign-in cannot work before the form is filled in, rather
        // than letting an empty or unreachable database answer a correct
        // password with "that password is wrong".
        if (!health.data.connected) {
          setBlocked(`The ${health.data.backend} store behind this deployment is not reachable. ${health.data.detail}`);
        } else if (health.data.signInAccounts === 0) {
          setBlocked(
            `This deployment is connected to a database that holds no accounts, so nobody can sign in. ${health.data.detail}`,
          );
        } else {
          setBlocked(null);
        }
      })
      .catch((err: unknown) => {
        // Swallowing this is how a deployment ends up showing neither the demo
        // hint nor a reason: both are read from health, and a failed read left
        // the page looking merely ordinary while nothing worked.
        if (cancelled) return;
        setBlocked(
          `The API status check failed, so this page cannot tell you what is wrong: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // What the server would pick if the field is left alone, and what is wrong
  // with it when it is not.
  const suggested = suggestUsername(displayName);
  const problem = username.trim() ? checkUsername(username) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signIn(identifier, password);
      else await signUp({ displayName, username: username.trim() || undefined, email, phone, password });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function useDemoAccount(account: DemoAccount) {
    setMode('signin');
    setIdentifier(account.identifier);
    // The label carries the demo password after the separator.
    setPassword(account.label.split('·').pop()?.trim() ?? '');
    setError(null);
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="auth__brand">
          <span className="brand__mark" style={{ width: 44, height: 44, borderRadius: 13 }} aria-hidden="true" />
          <div>
            <h1>Figmark</h1>
            <p className="auth__tag">Group-buy lots, verified sellers, escrow-held payments.</p>
          </div>
        </div>

        <div className="card auth__card">
          <div className="auth__switch" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'signin'}
              className={mode === 'signin' ? 'is-on' : ''} onClick={() => { setMode('signin'); setError(null); }}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'}
              className={mode === 'signup' ? 'is-on' : ''} onClick={() => { setMode('signup'); setError(null); }}>
              Create account
            </button>
          </div>

          <form className="form" onSubmit={submit}>
            {mode === 'signup' && (
              <>
                <label className="field">
                  <span>Your name</span>
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    autoComplete="name" placeholder="Arjun Mehta" required />
                </label>
                {/* Your address here. Left blank it is taken from your name,
                    because nobody should be stopped at the door by it. */}
                <label className="field">
                  <span>Username</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    placeholder={suggested || 'arjun_mehta'} />
                  <span className="field__hint">
                    {problem
                      ? USERNAME_PROBLEMS[problem]
                      : <>People find you at <code>/{username.trim() || suggested || 'yourname'}</code> and message you at{' '}
                        <code>@{username.trim() || suggested || 'yourname'}</code>.</>}
                  </span>
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Email</span>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email" placeholder="you@example.com" required />
                  </label>
                  <label className="field">
                    <span>Phone</span>
                    <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                      autoComplete="tel" placeholder="+91 98765 43210" required />
                  </label>
                </div>
              </>
            )}

            {mode === 'signin' && (
              <label className="field">
                <span>Email or phone</span>
                <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username" placeholder="you@example.com" required />
              </label>
            )}

            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signup' ? 'At least 8 characters' : ''} required />
              {mode === 'signup' && (
                <span className="field__hint">
                  You can browse and buy straight away. ID and bank details are only needed later, for payouts and
                  high-value listings.
                </span>
              )}
            </label>

            {blocked && !error && <p className="notice notice--warn">{blocked}</p>}

            {error && <ErrorNotice message={error} />}

            {mode === 'signup' && !durable && (
              <p className="notice notice--info">
                This server keeps accounts in memory. An account you create here works now but is lost when the
                server restarts — sign in with the demo account below for something that always works.
              </p>
            )}

            <button type="submit" className="btn btn--lg btn--block"
              disabled={busy || (mode === 'signup' && problem !== null)}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {/* Every seeded sign-in, not just the first: the shop owner and the
              supplier who packs for them see different halves of the same lot,
              and both are worth trying. */}
          {demo.length > 0 && mode === 'signin' && (
            <div className="auth__demo">
              <strong>{demo.length === 1 ? 'Demo account' : 'Demo accounts'}</strong>
              {demo.map((account) => (
                <div key={account.identifier} style={{ marginTop: 10 }}>
                  <div>
                    <code>{account.identifier}</code> · <code>{account.label.split('·').pop()?.trim()}</code>
                  </div>
                  <button type="button" className="btn btn--ghost" style={{ marginTop: 6 }}
                    onClick={() => useDemoAccount(account)}>
                    Fill {account.label.includes('packing') ? 'the packer' : 'the shop owner'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
