import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AADHAAR_MOBILE_RULE, maskMobile, verifiedChecks } from '@shared/verification';
import { ApiRequestError, api, type VerificationStatus } from '../api';
import { ErrorNotice } from '../components/ui';
import { useSession } from '../session';

/**
 * Verification: email, then WhatsApp, then Aadhaar.
 *
 * All three open buying and selling - listings, private deals and power sales
 * included - and browsing stays open without them. The one rule people trip
 * on is said before every step it matters to: the WhatsApp number and the
 * Aadhaar-linked mobile must be the same number, because the Aadhaar is
 * matched against the WhatsApp-verified one.
 */
export function VerifyPage() {
  const { user, refresh } = useSession();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.verifyStatus());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your verification.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useCallback((next: VerificationStatus) => {
    setStatus(next);
    // The session carries the capabilities every screen reads; bring it up to date.
    void refresh();
  }, [refresh]);

  if (!user) return null;
  if (error && !status) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!status) return <main className="page"><p className="muted">Loading…</p></main>;

  const { checks } = status;
  const done = checks.email && checks.phone && checks.aadhaar;

  return (
    <main className="page vfy">
      <h1>Verification</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        To buy or sell on Figmark - including private deals and power sales - verify all three. Browsing is open
        without them. It takes about two minutes.
      </p>

      {done ? (
        <p className="notice notice--ok">
          ✓ You are verified. You can buy and sell, and your page shows the Email, WhatsApp and Aadhaar ticks.
        </p>
      ) : (
        <p className="notice notice--warn vfy__rule">
          <strong>Important:</strong> {AADHAAR_MOBILE_RULE}
        </p>
      )}

      <ol className="vfy__steps">
        <li className={`card card--pad stack vfy__step${checks.email ? ' is-done' : ''}`}>
          <StepHead n={1} title="Email" done={checks.email} />
          {checks.email ? <p className="faint">{status.email} is verified.</p> : <EmailStep status={status} onChange={changed} />}
        </li>

        <li className={`card card--pad stack vfy__step${checks.phone ? ' is-done' : ''}`}>
          <StepHead n={2} title="WhatsApp number" done={checks.phone} />
          {checks.phone
            ? <p className="faint">{status.phone} is verified on WhatsApp.</p>
            : <WhatsAppStep status={status} onChange={changed} reload={load} />}
        </li>

        <li className={`card card--pad stack vfy__step${checks.aadhaar ? ' is-done' : ''}`}>
          <StepHead n={3} title="Aadhaar" done={checks.aadhaar} />
          {checks.aadhaar && status.aadhaar ? (
            <p className="faint">
              Verified as {status.aadhaar.name}, Aadhaar ending {status.aadhaar.last4}, matched to {status.phone}.
            </p>
          ) : !checks.phone ? (
            <p className="faint">Verify your WhatsApp number first: your Aadhaar is matched against it.</p>
          ) : (
            <AadhaarStep status={status} onChange={changed} />
          )}
        </li>
      </ol>
    </main>
  );
}

function StepHead({ n, title, done }: { n: number; title: string; done: boolean }) {
  return (
    <div className="row row--between">
      <span className="card__title">{n}. {title}</span>
      <span className={`badge ${done ? 'badge--ok' : ''}`}>{done ? '✓ Verified' : 'Not yet'}</span>
    </div>
  );
}

/* ── Email ─────────────────────────────────────────────────────────────── */

/** Type back the six digits we emailed. Also used by the sign-up gate. */
export function EmailStep({ status, onChange, devCode: initialDevCode }: {
  status: VerificationStatus;
  onChange: (status: VerificationStatus) => void;
  /** Only on a local run with no email service: the code, shown on screen. */
  devCode?: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [devCode, setDevCode] = useState(initialDevCode);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange((await api.confirmEmailCode(code)).status);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const sent = await api.sendEmailCode();
      setDevCode(sent.devCode);
      setNote(`A new code is on its way to ${sent.sentTo}.`);
      onChange(sent.status);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send the code.');
    } finally {
      setBusy(false);
    }
  }

  if (!status.ready.email) {
    return (
      <p className="notice notice--info">
        Email codes are not switched on for this server yet, so this step cannot be finished here. An operator can
        approve your account meanwhile.
      </p>
    );
  }

  return (
    <form className="form" onSubmit={confirm}>
      <p className="faint" style={{ margin: 0 }}>
        {status.emailCodePending
          ? <>Enter the 6-digit code we emailed to <strong>{status.email}</strong>. Check spam if it is not there.</>
          : <>We will email a 6-digit code to <strong>{status.email}</strong>.</>}
      </p>
      {devCode && (
        <p className="notice notice--info" style={{ margin: 0 }}>
          Local server with no email service: your code is <strong>{devCode}</strong>.
        </p>
      )}
      {status.emailCodePending && (
        <label className="field">
          <span>Code</span>
          <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required />
        </label>
      )}
      {note && <p className="faint" style={{ margin: 0 }}>{note}</p>}
      {error && <ErrorNotice message={error} />}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {status.emailCodePending && (
          <button type="submit" className="btn" disabled={busy || code.length !== 6}>Verify email</button>
        )}
        <button type="button" className={`btn ${status.emailCodePending ? 'btn--ghost' : ''}`} disabled={busy}
          onClick={() => void resend()}>
          {status.emailCodePending ? 'Send a new code' : 'Send code'}
        </button>
      </div>
    </form>
  );
}

/* ── WhatsApp ──────────────────────────────────────────────────────────── */

function WhatsAppStep({ status, onChange, reload }: {
  status: VerificationStatus;
  onChange: (status: VerificationStatus) => void;
  reload: () => Promise<void>;
}) {
  const [started, setStarted] = useState<{ link: string; message: string; businessNumber: string } | null>(null);
  const [editing, setEditing] = useState(!status.phone);
  const [phone, setPhone] = useState(status.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // While a code is out, look for the answer: it arrives by WhatsApp, not here.
  const waiting = Boolean(status.phoneChallenge) && !status.checks.phone;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void reload(), 4000);
    return () => window.clearInterval(timer);
  }, [waiting, reload]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.startWhatsApp();
      setStarted(result);
      onChange(result.status);
      window.open(result.link, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not start WhatsApp verification.');
    } finally {
      setBusy(false);
    }
  }

  async function savePhone(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange((await api.changePhone(phone)).status);
      setEditing(false);
      setStarted(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that number.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="notice notice--warn vfy__rule" style={{ margin: 0 }}>
        Your WhatsApp number <strong>must be the mobile number linked to your Aadhaar</strong>. If they differ, the
        Aadhaar step will fail - change the number below before you continue.
      </p>

      {editing ? (
        <form className="form" onSubmit={savePhone}>
          <label className="field">
            <span>Mobile number (linked to your Aadhaar, on WhatsApp)</span>
            <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel" placeholder="+91 98765 43210" required />
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={busy}>Save number</button>
            {status.phone && <button type="button" className="btn btn--quiet" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </form>
      ) : (
        <p style={{ margin: 0 }}>
          Your number: <strong>{status.phone}</strong>{' '}
          <button type="button" className="linklike" onClick={() => setEditing(true)}>Change</button>
        </p>
      )}

      {!status.ready.whatsapp ? (
        <p className="notice notice--info" style={{ margin: 0 }}>
          WhatsApp verification is not switched on for this server yet. An operator can approve your account
          meanwhile.
        </p>
      ) : !editing && (
        <>
          <p className="faint" style={{ margin: 0 }}>
            Tap the button: WhatsApp opens with a message already written. Send it <strong>from {status.phone}</strong>{' '}
            without changing it. This page updates by itself once it arrives.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void start()}>
              {started || waiting ? 'Open WhatsApp again' : 'Verify on WhatsApp'}
            </button>
          </div>
          {started && (
            <details className="faint">
              <summary>WhatsApp did not open?</summary>
              <p>Send this message to <strong>{started.businessNumber}</strong> on WhatsApp, from {status.phone}:</p>
              <code className="vfy__msg">{started.message}</code>
            </details>
          )}
          {waiting && !status.phoneChallenge?.error && <p className="faint" style={{ margin: 0 }}>Waiting for your WhatsApp message…</p>}
          {status.phoneChallenge?.error && (
            <p className="notice notice--error" style={{ margin: 0 }}>Not verified: {status.phoneChallenge.error}</p>
          )}
        </>
      )}

      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/* ── Aadhaar ───────────────────────────────────────────────────────────── */

interface Detector {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** The QR's text from an image or a video frame: the browser's own reader, else jsQR. */
async function readQr(source: CanvasImageSource, width: number, height: number): Promise<string | null> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const found = await new Native({ formats: ['qr_code'] }).detect(source);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch {
      /* fall through to jsQR */
    }
  }
  // Large enough for the densest Aadhaar QR, small enough to stay quick.
  const scale = Math.min(1, 2000 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { default: jsQR } = await import('jsqr');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

function AadhaarStep({ status, onChange }: { status: VerificationStatus; onChange: (status: VerificationStatus) => void }) {
  const [consent, setConsent] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // The camera, read a few times a second until a QR turns up.
  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        while (!stopped) {
          if (video.videoWidth > 0) {
            const text = await readQr(video, video.videoWidth, video.videoHeight);
            if (text) {
              setQr(text);
              setScanning(false);
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      } catch {
        setError('Could not open the camera. Upload a photo or screenshot of the QR instead.');
        setScanning(false);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scanning]);

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const text = await readQr(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      if (text) setQr(text);
      else setError('No QR code found in that picture. Crop it to the QR and make sure it is sharp, then try again.');
    } catch {
      setError('That file could not be read as a picture.');
    }
  }

  async function submit(text: string) {
    setBusy(true);
    setError(null);
    try {
      onChange((await api.verifyAadhaar(text)).status);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Verification failed. Try again.');
      setQr(null);
    } finally {
      setBusy(false);
    }
  }

  if (!status.ready.aadhaar) {
    return (
      <p className="notice notice--info">
        Aadhaar verification is not switched on for this server yet. An operator can approve your account meanwhile.
      </p>
    );
  }

  return (
    <div className="stack">
      <p className="notice notice--warn vfy__rule" style={{ margin: 0 }}>
        The mobile linked to your Aadhaar must be <strong>{status.phone}</strong> ({maskMobile(status.phone)}), the
        number you verified on WhatsApp. If it is a different number, change your number in step 2 first.
      </p>
      <p className="faint" style={{ margin: 0 }}>
        Scan the large QR code on your Aadhaar letter, your e-Aadhaar PDF (download it from myaadhaar.uidai.gov.in) or
        the mAadhaar app. It is signed by UIDAI and checked on our server - no OTP, no upload of your card.
      </p>

      <label className="vfy__consent">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        <span>
          I agree to Figmark reading my Aadhaar Secure QR to verify who I am. Figmark keeps only my name, date of birth,
          gender and the last 4 digits of my Aadhaar - never the full number, my address or my photo.
        </span>
      </label>

      {qr ? (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="badge badge--ok">QR read</span>
          <button type="button" className="btn" disabled={busy || !consent} onClick={() => void submit(qr)}>
            {busy ? 'Checking…' : 'Verify Aadhaar'}
          </button>
          <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => setQr(null)}>Scan again</button>
        </div>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={!consent || scanning} onClick={() => setScanning(true)}>
              Scan with camera
            </button>
            <label className={`btn btn--ghost${consent ? '' : ' is-disabled'}`} aria-disabled={!consent}>
              Upload QR picture
              <input type="file" accept="image/*" hidden disabled={!consent}
                onChange={(event) => void fromFile(event.target.files?.[0])} />
            </label>
          </div>
          {scanning && (
            <div className="vfy__camera">
              <video ref={videoRef} playsInline muted />
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setScanning(false)}>Stop</button>
            </div>
          )}
          <details className="faint">
            <summary>Have the QR's text from another scanner app?</summary>
            <textarea className="vfy__paste" value={pasted} onChange={(event) => setPasted(event.target.value)}
              placeholder="A long number, thousands of digits" rows={3} />
            <button type="button" className="btn btn--sm" disabled={!consent || busy || pasted.trim().length < 100}
              onClick={() => void submit(pasted.trim())}>
              Verify this
            </button>
          </details>
        </>
      )}

      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/* ── Prompts the rest of the app raises ────────────────────────────────── */

/**
 * Straight after sign-up, and for any account whose email is not yet verified:
 * the email code, over whatever page they are on.
 */
export function EmailGate() {
  const { user, signupEmail, signOut, refresh } = useSession();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [later, setLater] = useState(false);
  const needed = Boolean(user) && !verifiedChecks(user!).email;

  useEffect(() => {
    if (!needed) return;
    void api.verifyStatus().then(setStatus).catch(() => setStatus(null));
  }, [needed, user?.id]);

  if (!needed || later || !status) return null;

  return (
    <div className="authpop" role="dialog" aria-modal="true" aria-label="Verify your email">
      <div className="authpop__panel stack">
        <h2 style={{ margin: 0 }}>Verify your email</h2>
        <p className="faint" style={{ margin: 0 }}>
          One last step to finish signing up. After this you can browse; your WhatsApp number and Aadhaar can be
          verified any time from Profile → Verification, and are needed to buy or sell.
        </p>
        {signupEmail?.error && <p className="notice notice--warn" style={{ margin: 0 }}>{signupEmail.error}</p>}
        <EmailStep status={status} devCode={signupEmail?.devCode}
          onChange={(next) => {
            setStatus(next);
            if (next.checks.email) void refresh();
          }} />
        <div className="row row--between" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => void signOut()}>Sign out</button>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setLater(true)}>Later</button>
        </div>
      </div>
    </div>
  );
}

/** Opened when the server refuses a purchase or a listing for want of verification. */
export function VerifyPrompt() {
  const { verifyPrompt, closeVerifyPrompt } = useSession();
  if (!verifyPrompt) return null;
  return (
    <div className="authpop" role="dialog" aria-modal="true" aria-label="Verification needed"
      onMouseDown={(event) => event.target === event.currentTarget && closeVerifyPrompt()}>
      <div className="authpop__panel stack">
        <h2 style={{ margin: 0 }}>Verify to continue</h2>
        <p style={{ margin: 0 }}>{verifyPrompt}</p>
        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--quiet" onClick={closeVerifyPrompt}>Not now</button>
          <Link to="/verify" className="btn" onClick={closeVerifyPrompt}>Verify now</Link>
        </div>
      </div>
    </div>
  );
}
