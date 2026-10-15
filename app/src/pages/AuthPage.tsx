import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { DemoAccount } from '@shared/contracts';
import { checkUsername, suggestUsername, USERNAME_PROBLEMS } from '@shared/handles';
import { ApiRequestError, api } from '../api';
import { ErrorNotice, Icon } from '../components/ui';
import { useSession } from '../session';

type Mode = 'signin' | 'signup';

/**
 * The single entry point for signed-out visitors.
 *
 * Sign-in takes an email, a phone number or a username - the server normalises
 * and resolves any of them. Sign-up collects the minimum that makes an account usable; ID and
 * bank verification are deferred to the point they actually matter.
 */
export function AuthPage() {
  return (
    <div className="auth">
      <div className="auth__panel">
        <AuthBrand />
        <AuthCard />
      </div>
    </div>
  );
}

function AuthBrand() {
  return (
    <div className="auth__brand">
      <span className="brand__mark" style={{ width: 44, height: 44, borderRadius: 13 }} aria-hidden="true" />
      <div>
        <h1>Figmark</h1>
        <p className="auth__tag">Pre-orders, verified sellers, Buyer Protection on payments.</p>
      </div>
    </div>
  );
}

/**
 * Sign in or sign up, over whatever page the guest is on.
 *
 * Opened by anything that needs an account. It closes itself once they are
 * in (see session.tsx), and since the address never changed they are still
 * on the page they were reading, now able to do the thing they pressed.
 */
export function AuthModal({ reason, onClose }: { reason: string | null; onClose: () => void }) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', escape);
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', escape);
      document.body.style.overflow = was;
    };
  }, [onClose]);

  return (
    <div className="authpop" role="dialog" aria-modal="true" aria-label="Sign in or create an account"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="authpop__panel">
        <button type="button" className="authpop__close" aria-label="Close" onClick={onClose}>✕</button>
        <AuthBrand />
        <p className="authpop__why">🔒 {reason ?? 'Sign in or create a free account to do that.'} You stay on this page.</p>
        <AuthCard initialMode="signup" />
      </div>
    </div>
  );
}

function AuthCard({ initialMode = 'signin' }: { initialMode?: Mode }) {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<Mode>(initialMode);
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
  /** Whether the username field is unfolded; most people keep the one made from their name. */
  const [pickHandle, setPickHandle] = useState(false);

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
        if (health.auth.sessionSecretSource === 'missing') {
          setBlocked('Sign-in is switched off on this server: it has no session signing key. An operator needs to set AUTH_SESSION_SECRET.');
        } else if (!health.data.connected) {
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
  // Kept per name, not per render: the fallback has a random tail, and a
  // placeholder that changes on every keystroke elsewhere reads as a glitch.
  const plainSuggestion = useMemo(() => (displayName.trim() ? suggestUsername(displayName) : ''), [displayName]);
  // The first variant of it nobody holds yet, so what is shown is what they get.
  const free = useFreeHandle(mode === 'signup' && !pickHandle ? plainSuggestion : '');
  const suggested = free.base === plainSuggestion && free.handle ? free.handle : plainSuggestion;
  const wanted = username.trim();
  const problem = wanted ? checkUsername(wanted) : null;
  const availability = useUsernameAvailability(mode === 'signup' && !problem ? wanted : '');
  const usernameState: 'idle' | 'checking' | 'free' | 'taken' = !wanted
    ? 'idle'
    : problem
      ? 'taken'
      : availability.name !== wanted || availability.state === 'checking'
        ? 'checking'
        : availability.state === 'unknown' ? 'idle' : availability.state;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await signIn(identifier, password);
      else if (username.trim()) await signUp({ displayName, username: username.trim(), email, phone, password });
      else await signUp({ displayName, username: suggested || undefined, usernameSuggested: true, email, phone, password });
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
                <label className="field">
                  <span>Mobile (WhatsApp)</span>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" required />
                  <span className="field__hint">Use the number you have on WhatsApp.</span>
                </label>
                <label className="field">
                  <span>Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email" placeholder="you@example.com" required />
                  <span className="field__hint">We email you a code to confirm it.</span>
                </label>
              </>
            )}

            {mode === 'signin' && (
              <label className="field">
                <span>Email, phone or username</span>
                <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  placeholder="you@example.com or arjunmehta" required />
              </label>
            )}

            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={mode === 'signup' ? 'At least 8 characters' : ''} required />
            </label>

            {mode === 'signup' && (
              <>
                {/* Your address here. Left alone it is taken from your name,
                    because nobody should be stopped at the door by it - so it
                    stays folded away until somebody wants to pick their own. */}
                <button type="button" className="disclose" aria-expanded={pickHandle}
                  onClick={() => setPickHandle(!pickHandle)}>
                  <Icon name={pickHandle ? 'down' : 'right'} size={14} />
                  {pickHandle ? 'Username' : <>Suggested username: <code>@{wanted || suggested || 'yourname'}</code></>}
                  <span className="faint">optional, change it any time</span>
                </button>
                {pickHandle && (
                  <label className="field">
                    <span className={`handlefield handlefield--${usernameState}`}>
                      <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())}
                        autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                        placeholder={suggested || 'arjunmehta'} aria-label="Username"
                        aria-invalid={usernameState === 'taken'} aria-describedby="signup-username-hint" />
                      <span className="handlefield__status" aria-hidden="true">
                        {usernameState === 'checking' && <span className="handlefield__spin" />}
                        {usernameState === 'free' && <HandleMark ok />}
                        {usernameState === 'taken' && <HandleMark ok={false} />}
                      </span>
                    </span>
                    <span id="signup-username-hint" className={`field__hint handlefield__hint--${usernameState}`} aria-live="polite">
                      {problem
                        ? USERNAME_PROBLEMS[problem]
                        : usernameState === 'checking'
                          ? <>Checking whether <code>@{wanted}</code> is free…</>
                          : usernameState === 'taken'
                            ? availability.reason ?? `@${wanted} is already taken.`
                            : usernameState === 'free'
                              ? <><code>@{wanted}</code> is available. People find you at <code>/{wanted}</code>.</>
                              : <>Left empty, you are <code>@{suggested || 'yourname'}</code>.</>}
                    </span>
                  </label>
                )}
              </>
            )}

            {blocked && !error && <p className="notice notice--warn">{blocked}</p>}

            {error && <ErrorNotice message={error} />}

            {mode === 'signup' && !durable && (
              <p className="notice notice--info">
                This server keeps accounts in memory. An account you create here works now but is lost when the
                server restarts, and a server with several workers may not find it on every visit — sign in with
                the demo account below for something that always works.
              </p>
            )}

            <button type="submit" className="btn btn--lg btn--block"
              disabled={busy || (mode === 'signup' && (usernameState === 'taken' || usernameState === 'checking'))}>
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
  );
}

/**
 * Whether `name` is still free, asked a moment after the typing stops.
 *
 * Each new name cancels the question about the last one, so a slow answer for
 * "arju" can never land on top of the answer for "arjun". A failed check is
 * not a refusal: the server checks again when the account is made.
 */
function useUsernameAvailability(name: string) {
  const [result, setResult] = useState<{ name: string; state: 'checking' | 'free' | 'taken' | 'unknown'; reason: string | null }>(
    { name: '', state: 'free', reason: null },
  );
  useEffect(() => {
    if (!name) return;
    setResult({ name, state: 'checking', reason: null });
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.usernameAvailable(name, controller.signal)
        .then((answer) => setResult({ name, state: answer.available ? 'free' : 'taken', reason: answer.reason }))
        .catch(() => {
          if (!controller.signal.aborted) setResult({ name, state: 'unknown', reason: null });
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [name]);
  return result;
}

/**
 * The suggestion made from a name, or the first variant of it that is free.
 *
 * Tried in order - the plain one, then with a short tail - a moment after the
 * name stops changing. The tails are drawn once per name, so the line under
 * the form does not flicker between guesses. A failed check offers the plain
 * one: the server settles a clash on a suggestion itself.
 */
function useFreeHandle(base: string) {
  const [result, setResult] = useState<{ base: string; handle: string | null }>({ base: '', handle: null });
  useEffect(() => {
    if (!base) return;
    const stem = base.slice(0, 25);
    const tries = [base, ...Array.from({ length: 4 }, () => `${stem}_${Math.random().toString(36).slice(2, 6)}`)];
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      for (const handle of tries) {
        if (checkUsername(handle)) continue;
        const answer = await api.usernameAvailable(handle, controller.signal).catch(() => null);
        if (controller.signal.aborted) return;
        if (!answer || answer.available) {
          setResult({ base, handle });
          return;
        }
      }
      setResult({ base, handle: tries[tries.length - 1]! });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [base]);
  return result;
}

function HandleMark({ ok }: { ok: boolean }) {
  return (
    <svg className={`handlefield__mark handlefield__mark--${ok ? 'ok' : 'no'}`} viewBox="0 0 20 20" width="20" height="20">
      <circle cx="10" cy="10" r="9" />
      {ok ? <path d="M6 10.4l2.6 2.6L14 7.6" /> : <path d="M7 7l6 6M13 7l-6 6" />}
    </svg>
  );
}
