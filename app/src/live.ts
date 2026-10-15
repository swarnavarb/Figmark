import { pushState } from './push';

/**
 * When to look for news, in one place.
 *
 * The bell, an open conversation and an open room each say what to do when
 * there may be something new; this decides when that is. Today it is a
 * clock that only runs while the page is on screen, a push arriving, and the
 * tab coming back to the front. Later a live connection can say it instead,
 * and none of the pages need change.
 *
 * - Nothing is asked from a tab nobody can see. Coming back looks at once.
 * - A push that lands while the site is open is news there and then.
 * - With push on for this device, the clock is only a safety net.
 * - The bell backs off while nothing happens, and one tab asks for them all.
 */

type Look = () => Promise<boolean | void>;

/** The bell's clock: a minute, or ten when pushes bring the news. */
const BELL_MS = 60_000;
const BELL_PUSH_MS = 10 * 60_000;
/** Polls in a row that found nothing stretch the wait: 1, 1, 1, 2, 2, then 5 minutes. */
const QUIET_STEPS = [1, 1, 1, 2, 2, 5];
/** However long the quiet, never longer than this between looks (or the push clock, if longer). */
const QUIET_CAP_MS = 5 * 60_000;
/** A look this recent, from this tab or another, makes the next one unnecessary. */
const RECENT_MS = 3_000;

const LAST_LOOK_KEY = 'figmark:bell-looked-at';
const CHANNEL = 'figmark:live';

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/* ---- What the page hears ----------------------------------------------- */

const pushHeard = new Set<(link: string | null) => void>();
const fronted = new Set<() => void>();
const hidden = new Set<() => void>();
const othersSaw = new Set<() => void>();
let broadcast: BroadcastChannel | null = null;
let pushOn = false;
let started = false;

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  // A push that lands while the site is open (see sw.js), naming where it points.
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: string; link?: string | null } | null;
    if (data?.type === 'figmark:notification') pushHeard.forEach((heard) => heard(data.link ?? null));
  });
  let wasVisible = visible();
  const onFront = () => {
    const now = visible();
    if (now && !wasVisible) {
      void refreshPush();
      fronted.forEach((front) => front());
    }
    if (!now && wasVisible) hidden.forEach((hide) => hide());
    wasVisible = now;
  };
  document.addEventListener('visibilitychange', onFront);
  // An iPhone home-screen app coming back from the background fires this
  // rather than visibilitychange on some versions.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    wasVisible = false;
    onFront();
  });
  try {
    broadcast = new BroadcastChannel(CHANNEL);
    broadcast.onmessage = (event: MessageEvent) => {
      if ((event.data as { type?: string } | null)?.type === 'bell') othersSaw.forEach((saw) => saw());
    };
  } catch {
    // No BroadcastChannel: each tab simply keeps its own bell.
  }
  void refreshPush();
}

async function refreshPush() {
  try {
    pushOn = (await pushState()) === 'on';
  } catch {
    pushOn = false;
  }
}

/** Where a link goes, without its query: what a push is matched against. */
function pathOf(link: string): string {
  try {
    return new URL(link, window.location.origin).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return link;
  }
}

/* ---- Shared between tabs ----------------------------------------------- */

function lastLook(): number {
  try {
    return Number(window.localStorage.getItem(LAST_LOOK_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markLook(at: number) {
  try {
    window.localStorage.setItem(LAST_LOOK_KEY, String(at));
  } catch {
    // Without storage every visible tab asks for itself, as before.
  }
}

/* ---- The bell ---------------------------------------------------------- */

/**
 * Call `look` whenever the bell may have something new. It resolves true
 * when it found news, which resets the back-off and tells the other tabs.
 *
 * One tab asks for them all: whichever visible tab's clock comes round first
 * looks, and the others see it was done a moment ago and wait. News found in
 * one is said to the rest, which look for themselves.
 */
export function onBellChanged(look: Look): () => void {
  start();
  let timer: number | undefined;
  let quiet = 0;
  let mine = 0;
  let stopped = false;

  const wait = () => {
    const base = pushOn ? BELL_PUSH_MS : BELL_MS;
    const step = QUIET_STEPS[Math.min(quiet, QUIET_STEPS.length - 1)]!;
    return Math.min(base * step, Math.max(base, QUIET_CAP_MS));
  };

  const schedule = (ms = wait()) => {
    window.clearTimeout(timer);
    if (stopped || !visible()) return;
    timer = window.setTimeout(() => void tick(), ms);
  };

  /** Look, and say any news to the other tabs - except a tab's first look, which is only news to itself. */
  const run = async (tell = true) => {
    const now = Date.now();
    mine = now;
    markLook(now);
    try {
      const news = await look();
      if (news) {
        quiet = 0;
        if (tell) broadcast?.postMessage({ type: 'bell' });
      } else {
        quiet += 1;
      }
    } catch {
      quiet += 1;
    }
  };

  const tick = async () => {
    if (stopped || !visible()) return;
    // Another tab looked within this wait: its news, if any, was said to us.
    if (Date.now() - lastLook() < wait() - RECENT_MS) {
      schedule(wait() - (Date.now() - lastLook()));
      return;
    }
    await run();
    schedule();
  };

  /** Look now, unless this tab just did. */
  const now = async () => {
    if (stopped) return;
    quiet = 0;
    if (Date.now() - mine < RECENT_MS) {
      schedule();
      return;
    }
    await run();
    schedule();
  };

  // Coming back looks at once, which also catches whatever arrived while away.
  const onFront = () => void now();
  const onHidden = () => window.clearTimeout(timer);
  const onPush = () => {
    if (visible()) void now();
  };
  const onOthers = () => {
    if (!visible()) return;
    quiet = 0;
    // The tab that found it already asked; this one asks for its own view.
    void look().catch(() => undefined);
    schedule();
  };
  // Somebody using the page is somebody worth being prompt for.
  const onActive = () => {
    if (quiet < 3) return;
    quiet = 0;
    schedule();
  };

  fronted.add(onFront);
  hidden.add(onHidden);
  pushHeard.add(onPush);
  othersSaw.add(onOthers);
  window.addEventListener('pointerdown', onActive, { passive: true });
  window.addEventListener('keydown', onActive);
  // The first look is the page's own load; the clock starts from it.
  void run(false).then(() => schedule());

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    fronted.delete(onFront);
    hidden.delete(onHidden);
    pushHeard.delete(onPush);
    othersSaw.delete(onOthers);
    window.removeEventListener('pointerdown', onActive);
    window.removeEventListener('keydown', onActive);
  };
}

/* ---- A conversation or a room ------------------------------------------ */

/**
 * Call `look` while `path` is open: on a clock while it is on screen, at
 * once when it comes back to the front, and when a push points at it.
 */
function whileOpen(path: string, every: () => number, look: Look): () => void {
  start();
  let timer: number | undefined;
  let stopped = false;
  let busy = false;

  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      await look();
    } catch {
      // A missed refresh is caught by the next one.
    } finally {
      busy = false;
    }
  };
  const schedule = () => {
    window.clearTimeout(timer);
    if (stopped || !visible()) return;
    timer = window.setTimeout(() => void run().then(schedule), every());
  };
  const onFront = () => void run().then(schedule);
  const onHidden = () => window.clearTimeout(timer);
  const onPush = (link: string | null) => {
    if (!visible() || (link !== null && pathOf(link) !== path)) return;
    void run().then(schedule);
  };

  fronted.add(onFront);
  hidden.add(onHidden);
  pushHeard.add(onPush);
  schedule();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    fronted.delete(onFront);
    hidden.delete(onHidden);
    pushHeard.delete(onPush);
  };
}

/** A conversation: every 10 seconds, or 30 when pushes bring its messages. */
export function onThreadChanged(handle: string, look: Look): () => void {
  return whileOpen(`/messages/${encodeURIComponent(handle)}`, () => (pushOn ? 30_000 : 10_000), look);
}

/** A channel or forum room: every 12 seconds while it is on screen. */
export function onChannelChanged(path: string, look: Look): () => void {
  return whileOpen(path.replace(/\/+$/, ''), () => 12_000, look);
}
