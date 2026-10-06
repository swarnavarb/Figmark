import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { api } from '../api';
import { useToast } from './Feedback';
import { useSession } from '../session';
import {
  canPromptInstall, deviceBrowser, devicePlatform, isInstalled, onInstallPromptChange, promptInstall, reportDevice,
} from '../device';
import { disablePush, enablePush, pushState, syncPush, type PushState } from '../push';

/**
 * Lock-screen notifications for this device: where it stands, the one thing
 * to do about it, and the steps when that thing happens outside the page.
 *
 * Phones install first. On an iPhone notifications only work from the home
 * screen, and on Android that is where they belong beside every other app's,
 * so a phone in a browser tab is shown how to put Figmark on its home screen,
 * and only the home-screen copy offers "Turn on". A computer turns them on
 * where it is.
 *
 * Four places show it - the bell, the profile card, the floating prompt and
 * the steps sheet - and all read one shared state, so turning it on in one
 * is on in all of them.
 */

/* ── Shared state ─────────────────────────────────────────────────────────── */

interface Shared {
  state: PushState | null;
  busy: boolean;
  guide: boolean;
}

let shared: Shared = { state: null, busy: false, guide: false };
const listeners = new Set<() => void>();
const set = (next: Partial<Shared>) => {
  shared = { ...shared, ...next };
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let checking: Promise<void> | null = null;
/** Ask the browser where things stand. Once at a time. */
function refresh(): Promise<void> {
  checking ??= syncPush()
    .then(pushState)
    .then((state) => set({ state }))
    .catch(() => undefined)
    .finally(() => { checking = null; });
  return checking;
}

export function openPushGuide(): void {
  set({ guide: true });
}

export function usePush() {
  const toast = useToast();
  const snapshot = useSyncExternalStore(subscribe, () => shared);

  useEffect(() => {
    if (shared.state === null) void refresh();
  }, []);

  const turnOn = useCallback(async (): Promise<PushState | null> => {
    set({ busy: true });
    try {
      const next = await enablePush();
      set({ state: next });
      if (next === 'on') toast('Notifications are on for this device.');
      else if (next === 'blocked') toast('Notifications are blocked. See the steps to allow them.', 'error');
      return next;
    } catch {
      toast('Could not turn notifications on. Try again.', 'error');
      return null;
    } finally {
      set({ busy: false });
    }
  }, [toast]);

  const turnOff = useCallback(async () => {
    set({ busy: true });
    try {
      await disablePush();
      set({ state: await pushState() });
    } catch {
      toast('Could not turn notifications off. Try again.', 'error');
    } finally {
      set({ busy: false });
    }
  }, [toast]);

  const sendTest = useCallback(async () => {
    try {
      const { sent } = await api.pushTest();
      toast(
        sent > 0 ? 'Sent. Lock your phone - it should appear in a moment.' : 'No device took it. Turn notifications off and on again.',
        sent > 0 ? 'ok' : 'error',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send a test.', 'error');
    }
  }, [toast]);

  return { ...snapshot, turnOn, turnOff, sendTest, openGuide: openPushGuide };
}

type Push = ReturnType<typeof usePush>;

/* ── Words ────────────────────────────────────────────────────────────────── */

function explain(state: PushState): string {
  switch (state) {
    case 'needs-install':
      return devicePlatform() === 'ios'
        ? 'Add Figmark to your Home Screen to get notifications on this iPhone.'
        : 'Install Figmark on your home screen to get notifications on this phone.';
    case 'blocked':
      return 'Notifications are blocked for Figmark on this device.';
    case 'on':
      return 'Notifications are on for this device.';
    case 'off':
      return 'Get these on your lock screen, even when Figmark is closed.';
    case 'unavailable':
      return 'Notifications are not set up on this site yet.';
    case 'unsupported':
      return 'This browser cannot show notifications from Figmark.';
  }
}

function Buttons({ push, quiet }: { push: Push; quiet?: boolean }) {
  const strong = quiet ? 'btn btn--quiet btn--sm' : 'btn btn--sm';
  if (push.state === 'on') {
    return (
      <span className="bell__push-actions">
        <button type="button" className={strong} onClick={() => void push.sendTest()}>Send a test</button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={push.busy} onClick={() => void push.turnOff()}>
          Turn off
        </button>
      </span>
    );
  }
  if (push.state === 'off') {
    return (
      <button type="button" className="btn btn--sm" disabled={push.busy} onClick={() => void push.turnOn()}>
        {push.busy ? 'Turning on…' : 'Turn on'}
      </button>
    );
  }
  if (push.state === 'needs-install' || push.state === 'blocked') {
    return <button type="button" className="btn btn--sm" onClick={push.openGuide}>Show me how</button>;
  }
  return null;
}

/** The row at the top of the bell. Silent where this browser or site cannot do it. */
export function PushRow({ push }: { push: Push }) {
  if (!push.state || push.state === 'unsupported' || push.state === 'unavailable') return null;
  return (
    <div className="bell__push">
      <span className={push.state === 'on' ? 'faint' : undefined}>{explain(push.state)}</span>
      <Buttons push={push} quiet />
    </div>
  );
}

/** A card for the profile page. Always says where things stand, so a missing notification can be explained. */
export function PushCard() {
  const push = usePush();
  if (!push.state) return null;
  return (
    <section className="card card--pad stack" style={{ marginBottom: 18 }}>
      <span className="card__title">Notifications on this device</span>
      <div className="row row--between" style={{ gap: 12, alignItems: 'center' }}>
        <span className={push.state === 'on' ? 'faint' : undefined}>{explain(push.state)}</span>
        <Buttons push={push} />
      </div>
    </section>
  );
}

/* ── The floating prompt and the steps ────────────────────────────────────── */

const NUDGE_DELAY_MS = 4000;
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SNOOZE_KEY = 'figmark:push-nudge-snooze';

function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Mounted once, while somebody is signed in: reports where this copy is
 * used, floats the prompt a few seconds after sign-in or opening the app,
 * and holds the steps sheet any of the four places can open.
 *
 * The prompt shows after every sign-in. On an ordinary visit it waits three
 * days after "Not now", so it asks rather than nags.
 */
export function PushHost() {
  const { user } = useSession();
  // Who was signed in on the last render: undefined on the first one. Nobody
  // then somebody is a fresh sign-in; somebody from the start is opening the app.
  const previous = useRef<string | null | undefined>(undefined);
  const [freshFor, setFreshFor] = useState<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = user?.id ?? null;
    if (user && before === null) setFreshFor(user.id);
  }, [user]);
  if (!user) return null;
  return <SignedInPush key={user.id} userId={user.id} fresh={freshFor === user.id} />;
}

function SignedInPush({ userId, fresh }: { userId: string; fresh: boolean }) {
  const push = usePush();
  const [nudge, setNudge] = useState(false);
  const shown = useRef(false);

  // Where this copy is used, for the operators' figures: once a day, or when it changes.
  useEffect(() => {
    if (push.state) void reportDevice(userId, push.state);
  }, [userId, push.state]);

  useEffect(() => {
    if (!push.state || shown.current) return undefined;
    const wanted = push.state === 'off' || push.state === 'needs-install' || push.state === 'blocked';
    if (!wanted) return undefined;
    if (!fresh && snoozedUntil() > Date.now()) return undefined;
    const timer = setTimeout(() => {
      shown.current = true;
      setNudge(true);
    }, NUDGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [push.state, fresh]);

  // Turned on (here or anywhere else): nothing left to ask.
  useEffect(() => {
    if (push.state === 'on') setNudge(false);
  }, [push.state]);


  function later() {
    setNudge(false);
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      // Asked again next visit instead.
    }
  }

  return (
    <>
      {nudge && !push.guide && (
        <div className="pushnudge" role="dialog" aria-label="Turn on notifications">
          <span className="pushnudge__icon" aria-hidden="true">🔔</span>
          <span className="pushnudge__text">
            <strong>Get real-time updates</strong>
            <span>Know the moment your order moves, a payment lands or someone replies.</span>
          </span>
          <span className="pushnudge__actions">
            <button type="button" className="btn btn--sm" onClick={() => { setNudge(false); push.openGuide(); }}>
              Turn on
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={later}>Not now</button>
          </span>
        </div>
      )}
      {push.guide && <PushGuide push={push} onClose={() => set({ guide: false })} />}
    </>
  );
}

/** The share icon as iOS draws it, so the step points at what is on screen. */
function ShareGlyph() {
  return (
    <svg className="pushguide__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AddGlyph() {
  return (
    <svg className="pushguide__glyph" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="pushguide__steps">{children}</ol>;
}

/** What to do on this device, from wherever it stands, ending in notifications on. */
function PushGuide({ push, onClose }: { push: Push; onClose: () => void }) {
  const platform = devicePlatform();
  const browser = deviceBrowser();
  const installed = isInstalled();
  const [installable, setInstallable] = useState(canPromptInstall());
  const [justInstalled, setJustInstalled] = useState(false);
  useEffect(() => onInstallPromptChange(() => setInstallable(canPromptInstall())), []);

  // Escape closes it, as any sheet should.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  let title = 'Turn on notifications';
  let body: ReactNode;
  let action: ReactNode = <button type="button" className="btn" onClick={onClose}>Got it</button>;

  if (push.state === 'on') {
    title = "You're all set";
    body = <p>Notifications are on for this device. Send a test to see one arrive - lock your phone first.</p>;
    action = (
      <span className="pushguide__actions">
        <button type="button" className="btn" onClick={() => void push.sendTest()}>Send a test</button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Done</button>
      </span>
    );
  } else if (push.state === 'needs-install' && platform === 'ios') {
    title = 'Add Figmark to your Home Screen';
    const where = browser === 'safari'
      ? <>at the bottom of Safari</>
      : browser === 'chrome' ? <>at the top right of Chrome</> : <>in your browser&apos;s menu</>;
    body = (
      <>
        <p>iPhones only show notifications from apps on the Home Screen. It takes four taps:</p>
        <Steps>
          <li>Tap the <strong>Share</strong> button <ShareGlyph /> {where}.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong> <AddGlyph />.</li>
          <li>Tap <strong>Add</strong>. Figmark appears on your Home Screen.</li>
          <li>Open Figmark from that icon, sign in, and tap <strong>Turn on</strong> when it asks.</li>
        </Steps>
        {browser !== 'safari' && browser !== 'chrome' && (
          <p className="faint">Can&apos;t find Share? Open this page in Safari and start again from step 1.</p>
        )}
      </>
    );
  } else if (push.state === 'needs-install') {
    title = 'Install Figmark on your phone';
    if (justInstalled) {
      body = <p>Installed. Open <strong>Figmark</strong> from your home screen, sign in, and tap <strong>Turn on</strong> when it asks.</p>;
    } else if (installable) {
      body = (
        <>
          <p>Figmark installs like an app, with notifications next to all your others.</p>
          <Steps>
            <li>Tap <strong>Install Figmark</strong> below, then <strong>Install</strong>.</li>
            <li>Open Figmark from your home screen and sign in.</li>
            <li>Tap <strong>Turn on</strong> when it asks, then <strong>Allow</strong>.</li>
          </Steps>
        </>
      );
      action = (
        <span className="pushguide__actions">
          <button type="button" className="btn" onClick={() => void promptInstall().then((yes) => yes && setJustInstalled(true))}>
            Install Figmark
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>Not now</button>
        </span>
      );
    } else {
      const menu = browser === 'samsung'
        ? <>the <strong>☰</strong> menu at the bottom right, then <strong>Add page to</strong> → <strong>Home screen</strong></>
        : browser === 'firefox'
          ? <>the <strong>⋮</strong> menu, then <strong>Install</strong></>
          : <>the <strong>⋮</strong> menu at the top right, then <strong>Add to Home screen</strong> or <strong>Install app</strong></>;
      body = (
        <>
          <p>Figmark installs like an app, with notifications next to all your others.</p>
          <Steps>
            <li>Tap {menu}.</li>
            <li>Tap <strong>Install</strong> (or <strong>Add</strong>).</li>
            <li>Open Figmark from your home screen and sign in.</li>
            <li>Tap <strong>Turn on</strong> when it asks, then <strong>Allow</strong>.</li>
          </Steps>
        </>
      );
    }
  } else if (push.state === 'blocked') {
    title = 'Allow notifications';
    body = platform === 'ios' ? (
      <>
        <p>Notifications were turned off for Figmark. To allow them:</p>
        <Steps>
          <li>Open the <strong>Settings</strong> app.</li>
          <li>Tap <strong>Notifications</strong>, then <strong>Figmark</strong>.</li>
          <li>Turn on <strong>Allow Notifications</strong>, then come back here.</li>
        </Steps>
      </>
    ) : platform === 'android' && installed ? (
      <>
        <p>Notifications were turned off for Figmark. To allow them:</p>
        <Steps>
          <li>Press and hold the <strong>Figmark</strong> icon on your home screen.</li>
          <li>Tap <strong>App info</strong> (ⓘ), then <strong>Notifications</strong>.</li>
          <li>Turn on <strong>Show notifications</strong>, then come back here.</li>
        </Steps>
      </>
    ) : (
      <>
        <p>This browser was told not to show Figmark&apos;s notifications. To allow them:</p>
        <Steps>
          <li>Tap the icon at the left of the address bar (a lock or sliders).</li>
          <li>Set <strong>Notifications</strong> to <strong>Allow</strong>.</li>
          <li>Reload this page.</li>
        </Steps>
      </>
    );
  } else {
    body = (
      <>
        <p>Hear the moment your order moves, a payment lands or someone replies - even when Figmark is closed.</p>
        <Steps>
          <li>Tap <strong>Turn on notifications</strong> below.</li>
          <li>Tap <strong>Allow</strong> when {platform === 'ios' || platform === 'android' ? 'your phone' : 'your browser'} asks.</li>
        </Steps>
      </>
    );
    action = (
      <span className="pushguide__actions">
        <button type="button" className="btn" disabled={push.busy} onClick={() => void push.turnOn()}>
          {push.busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Not now</button>
      </span>
    );
  }

  return (
    <div className="pushguide" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="pushguide__sheet" role="dialog" aria-modal="true" aria-labelledby="pushguide-title">
        <div className="pushguide__head">
          <h2 id="pushguide-title">{title}</h2>
          <button type="button" className="pushguide__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="pushguide__body">{body}</div>
        {action}
      </div>
    </div>
  );
}
