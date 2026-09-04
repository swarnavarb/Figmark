import { useEffect, useState, type FormEvent } from 'react';
import type { DemoAccount } from '@shared/contracts';
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
  const [demo, setDemo] = useState<DemoAccount | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // The seeded sign-in hint, shown only while the mock provider is active.
  useEffect(() => {
    let cancelled = false;
    void api
      .health()
      .then((health) => {
        if (cancelled) return;
        const account = health.auth.demoAccounts[0];
        if (health.auth.mode === 'mock' && account) setDemo(account);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signIn(identifier, password);
      else await signUp({ displayName, email, phone, password });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function useDemoAccount() {
    if (!demo) return;
    setMode('signin');
    setIdentifier(demo.identifier);
    // The label carries the demo password after the separator.
    setPassword(demo.label.split('·').pop()?.trim() ?? '');
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

            {error && <ErrorNotice message={error} />}

            <button type="submit" className="btn btn--lg btn--block" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {demo && mode === 'signin' && (
            <div className="auth__demo">
              <strong>Demo account</strong>
              <div style={{ marginTop: 6 }}>
                <code>{demo.identifier}</code> · <code>{demo.label.split('·').pop()?.trim()}</code>
              </div>
              <button type="button" className="btn btn--ghost" style={{ marginTop: 10 }} onClick={useDemoAccount}>
                Fill demo credentials
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
