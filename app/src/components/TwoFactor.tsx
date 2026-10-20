import { useState, type FormEvent } from 'react';
import { ApiRequestError, api } from '../api';
import { ErrorNotice } from './ui';
import { useSession } from '../session';

/**
 * Two-factor sign-in with an authenticator app: scan, type the first code,
 * keep the recovery codes. Required of operators and community managers; on
 * offer to everybody else.
 */
export function TwoFactorSettings() {
  const { user, refresh } = useSession();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user) return null;

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiRequestError ? err.message : fallback);

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const started = await api.startMfaSetup(password);
      // Loaded only here: nobody else needs a QR encoder.
      const { default: qrcode } = await import('qrcode-generator');
      const qr = qrcode(0, 'M');
      qr.addData(started.uri);
      qr.make();
      setSetup({ ...started, qr: qr.createDataURL(5, 2) });
      setPassword('');
    } catch (err) {
      fail(err, 'Could not start setting it up.');
    } finally {
      setBusy(false);
    }
  }

  async function enable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const on = await api.enableMfa(code);
      setRecovery(on.recoveryCodes);
      setSetup(null);
      setCode('');
      await refresh();
    } catch (err) {
      fail(err, 'Could not turn it on.');
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.disableMfa(password, code);
      setTurningOff(false);
      setPassword('');
      setCode('');
      await refresh();
    } catch (err) {
      fail(err, 'Could not turn it off.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card card--pad stack" style={{ marginTop: 18, maxWidth: 560 }} id="two-factor">
      <span className="card__title">Two-factor sign-in</span>
      {user.mfaRequired && (
        <p className="notice notice--warn" style={{ margin: 0 }}>
          You operate the marketplace or decide disputes, so you need this on before you can act as staff.
        </p>
      )}

      {recovery && (
        <div className="stack">
          <p className="notice notice--ok" style={{ margin: 0 }} role="status">
            Two-factor sign-in is on. Keep these recovery codes somewhere safe: each signs you in once if you lose
            your phone. They are not shown again.
          </p>
          <pre className="twofa__codes">{recovery.join('\n')}</pre>
          <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={() => setRecovery(null)}>
            I have saved them
          </button>
        </div>
      )}

      {!recovery && user.mfaEnabled && !turningOff && (
        <>
          <p className="faint" style={{ margin: 0 }}>On. Signing in asks for a code from your authenticator app.</p>
          <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={() => setTurningOff(true)}>
            Turn off…
          </button>
        </>
      )}

      {!recovery && user.mfaEnabled && turningOff && (
        <form className="form" onSubmit={disable}>
          <label className="field">
            <span>Your password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          <label className="field">
            <span>A code from your app, or a recovery code</span>
            <input value={code} onChange={(e) => setCode(e.target.value.slice(0, 16))} autoComplete="one-time-code" required />
          </label>
          {error && <ErrorNotice message={error} />}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn--danger" disabled={busy}>Turn off two-factor</button>
            <button type="button" className="btn btn--quiet" onClick={() => { setTurningOff(false); setError(null); }}>Keep it on</button>
          </div>
        </form>
      )}

      {!recovery && !user.mfaEnabled && !setup && (
        <form className="form" onSubmit={start}>
          <p className="faint" style={{ margin: 0 }}>
            Signing in will also ask for a code from an authenticator app (Google Authenticator, Microsoft
            Authenticator, 1Password and the like), so a stolen password is not enough.
          </p>
          <label className="field">
            <span>Your password, to start</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {error && <ErrorNotice message={error} />}
          <button type="submit" className="btn" style={{ justifySelf: 'start' }} disabled={busy || !password}>
            {busy ? 'Please wait…' : 'Set up two-factor'}
          </button>
        </form>
      )}

      {!recovery && !user.mfaEnabled && setup && (
        <form className="form" onSubmit={enable}>
          <p className="faint" style={{ margin: 0 }}>Scan this with your authenticator app, or on this phone tap “Open in app”.</p>
          <img className="twofa__qr" src={setup.qr} alt="QR code to add Figmark to an authenticator app" width={190} height={190} />
          <p className="faint" style={{ margin: 0 }}>
            Or type this key: <code className="twofa__key">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
            {' · '}<a href={setup.uri}>Open in app</a>
          </p>
          <label className="field">
            <span>The 6-digit code it shows</span>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" required />
          </label>
          {error && <ErrorNotice message={error} />}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn" disabled={busy || code.length !== 6}>Turn on</button>
            <button type="button" className="btn btn--quiet" onClick={() => { setSetup(null); setCode(''); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
