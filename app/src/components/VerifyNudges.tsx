import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { verifiedChecks } from '@shared/verification';
import { Icon, useDialog } from './ui';
import { useSession } from '../session';

/*
 * The verification reminders shown around the app. Kept apart from the
 * Verification page so the shell and the Sell, Shop and Social pages can show
 * them without loading that page - and its QR reader - on every visit.
 */

/**
 * A slim strip under the header for an account whose email is not verified.
 *
 * This was a dialog over the page straight after sign-up, which put a code
 * between a new person and the thing they came to look at. Browsing needs no
 * verification, so the reminder waits at the top instead: one line, a link to
 * the code, and a way to put it away for this visit.
 */
const NUDGE_DISMISSED_KEY = 'figmark:verify-nudge-dismissed';

export function VerifyNudge() {
  const { user } = useSession();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(NUDGE_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (!user || dismissed || verifiedChecks(user).email) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(NUDGE_DISMISSED_KEY, '1');
    } catch {
      /* A private window: it comes back next page load, which is fine. */
    }
  }

  return (
    <div className="vnudge" role="status">
      <span className="vnudge__text">
        📧 We emailed you a code{user.email ? <> at <b>{user.email}</b></> : null}. Enter it to finish signing up.
      </span>
      <Link to="/verify" className="btn btn--sm">Enter code</Link>
      <button type="button" className="iconbtn vnudge__close" aria-label="Hide for now" onClick={dismiss}>✕</button>
    </div>
  );
}

/**
 * Everything between a new account and its first sale, as one list.
 *
 * Verification and the storefront used to be separate doors - a dialog here, a
 * warning there, a gate on the Sell tab - and nobody could tell how many were
 * left. Shown on the Sell tab until all of it is done.
 */
/** Whether the Start selling list has been folded on this device. */
const SETUP_FOLDED_KEY = 'figmark.setup.folded';

export function SetupChecklist({ hasStore, onOpenStore }: { hasStore: boolean; onOpenStore?: () => void }) {
  const { user } = useSession();
  /* Open until the seller folds it; folded stays folded on this device. */
  const [folded, setFolded] = useState(() => {
    try { return window.localStorage.getItem(SETUP_FOLDED_KEY) === '1'; } catch { return false; }
  });
  if (!user) return null;
  const fold = (next: boolean) => {
    setFolded(next);
    try { window.localStorage.setItem(SETUP_FOLDED_KEY, next ? '1' : '0'); } catch { /* Lasts as long as the screen. */ }
  };
  const checks = verifiedChecks(user);
  const rows: { id: string; label: string; done: boolean; go: ReactNode }[] = [
    { id: 'account', label: 'Create your account', done: true, go: null },
    { id: 'email', label: 'Confirm your email', done: checks.email, go: <Link to="/verify">Enter code</Link> },
    { id: 'phone', label: 'Verify your WhatsApp number', done: checks.phone, go: <Link to="/verify">Verify</Link> },
    { id: 'aadhaar', label: 'Verify your Aadhaar', done: checks.aadhaar, go: <Link to="/verify">Verify</Link> },
    {
      id: 'store', label: 'Open your storefront', done: hasStore,
      go: onOpenStore ? <button type="button" className="linkbtn" onClick={onOpenStore}>Open</button> : null,
    },
  ];
  const done = rows.filter((row) => row.done).length;
  if (done === rows.length) return null;
  const next = rows.find((row) => !row.done)!;

  return (
    <section className={`card card--pad setupcheck${folded ? ' is-folded' : ''}`} aria-label="Start selling">
      <button type="button" className="setupcheck__head" aria-expanded={!folded} aria-controls="setupcheck-list"
        onClick={() => fold(!folded)}>
        <span className="card__title">Start selling</span>
        <span className="faint">{folded ? `Next: ${next.label}` : `${done} of ${rows.length} done`}</span>
        <Icon name={folded ? 'down' : 'up'} size={16} />
      </button>
      <span className="setupcheck__bar" aria-hidden="true"><span style={{ width: `${(done / rows.length) * 100}%` }} /></span>
      {!folded && <>
      <ol className="setupcheck__list" id="setupcheck-list">
        {rows.map((row) => (
          <li key={row.id} className={`setupcheck__row${row.done ? ' is-done' : ''}${row === next ? ' is-next' : ''}`}>
            <span className="setupcheck__tick" aria-hidden="true">{row.done ? '✓' : ''}</span>
            <span className="setupcheck__label">{row.label}</span>
            {!row.done && row.go}
          </li>
        ))}
      </ol>
      {!checks.aadhaar && (
        <p className="faint" style={{ margin: 0 }}>
          You can fill in a listing before you are verified - it is kept as a draft and goes live once you are.
        </p>
      )}
      </>}
    </section>
  );
}

/** Opened when the server refuses a purchase or a listing for want of verification. */
export function VerifyPrompt() {
  const { verifyPrompt, closeVerifyPrompt } = useSession();
  if (!verifyPrompt) return null;
  return <VerifyPromptBox message={verifyPrompt} onClose={closeVerifyPrompt} />;
}

function VerifyPromptBox({ message: verifyPrompt, onClose: closeVerifyPrompt }: { message: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, closeVerifyPrompt);
  return (
    <div ref={box} tabIndex={-1} className="authpop" role="dialog" aria-modal="true" aria-label="Verification needed"
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
