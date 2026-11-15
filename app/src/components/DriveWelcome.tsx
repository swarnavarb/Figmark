import { useEffect, useState } from 'react';
import { formatMoney } from '../format';
import { useSession } from '../session';

/*
 * The welcome a friend sees after opening somebody's Spread the word link
 * while signed out: whose link it was, the shop, and the credit waiting for
 * them if they join. Kept apart from SpreadKit so the shell can show it
 * without loading the rest.
 */

export interface DriveWelcomeInfo {
  inviter: string;
  storeName: string;
  welcomeMinor: number;
  endsAt: string;
}

const KEY = 'figmark:drive-welcome';
const EVENT = 'figmark:drive-welcome';

/** Remember the welcome for this visit, and tell the strip. */
export function rememberDriveWelcome(info: DriveWelcomeInfo) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    /* A private window: shown for this page only. */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: info }));
}

function read(): DriveWelcomeInfo | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DriveWelcomeInfo) : null;
  } catch {
    return null;
  }
}

function forget() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Nothing kept to forget. */
  }
}

export function DriveWelcome() {
  const { user, promptAuth } = useSession();
  const [info, setInfo] = useState<DriveWelcomeInfo | null>(() => read());

  useEffect(() => {
    const onWelcome = (event: Event) => setInfo((event as CustomEvent<DriveWelcomeInfo>).detail);
    window.addEventListener(EVENT, onWelcome);
    return () => window.removeEventListener(EVENT, onWelcome);
  }, []);

  // Signed up or in: the welcome has done its job.
  useEffect(() => {
    if (user && info) {
      forget();
      setInfo(null);
    }
  }, [user, info]);

  if (!info || user || Date.parse(info.endsAt) < Date.now()) return null;
  const first = info.inviter.split(/\s+/)[0] || info.inviter;
  return (
    <aside className="dwelcome" role="status">
      <span className="dwelcome__gift" aria-hidden="true">🎁</span>
      <span className="dwelcome__copy">
        <strong>{first} invited you to {info.storeName}</strong>
        <span>
          {info.welcomeMinor > 0
            ? <>Join Figmark free and get <b>{formatMoney(info.welcomeMinor, 'INR')}</b> to spend there.</>
            : <>Join Figmark free - it counts for {first}.</>}
        </span>
      </span>
      <button type="button" className="btn btn--sm dwelcome__go" onClick={() => promptAuth(`Join ${info.storeName} on Figmark`, 'signup')}>
        Join free
      </button>
      <button type="button" className="dwelcome__close" aria-label="Hide" onClick={() => { forget(); setInfo(null); }}>×</button>
    </aside>
  );
}
