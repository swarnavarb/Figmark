/**
 * Keeping an open copy of the site on the version that is live.
 *
 * A browser tab picks up a new deploy whenever somebody reloads it. A
 * home-screen app does not: an iPhone resumes it from memory, as it was, for
 * days, so a fix can be live for everyone and still not reach the person who
 * keeps Figmark on their home screen. Notification taps arriving at an old page
 * that does not know how to follow them was exactly that.
 *
 * So the page asks, when it is brought back to the front and every few
 * minutes while it is open, which script the live site starts with. The
 * script's name changes with every build, so a different name is a new
 * version. Coming back to the front is the moment to reload: nothing is half
 * typed. Found while somebody is using it, the reload waits for their next
 * move to another page, which is a load they asked for anyway.
 */

const EVERY_MS = 5 * 60_000;

let stale = false;

/** The entry script this page was started with, e.g. /assets/main-abc123.js. */
function runningScript(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script ? new URL(script.src, window.location.origin).pathname : null;
}

async function liveScript(): Promise<string | null> {
  try {
    const response = await fetch(`/index.html?fresh=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return null;
    const match = (await response.text()).match(/<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/);
    return match ? new URL(match[1]!, window.location.origin).pathname : null;
  } catch {
    return null;
  }
}

async function check(): Promise<boolean> {
  const running = runningScript();
  // The dev server serves source, not built assets: nothing to compare.
  if (!running) return false;
  const live = await liveScript();
  if (live && live !== running) stale = true;
  return stale;
}

/** Pick up a new service worker too: it is what follows notification taps. */
function updateWorker(): void {
  void navigator.serviceWorker?.getRegistration('/sw.js')
    .then((registration) => registration?.update())
    .catch(() => undefined);
}

/** True when a newer version is live; the next page change loads it. */
export function isStale(): boolean {
  return stale;
}

export function keepFresh(): void {
  const onFront = async () => {
    if (document.visibilityState !== 'visible') return;
    updateWorker();
    if (await check()) window.location.reload();
  };
  document.addEventListener('visibilitychange', () => void onFront());
  // An iPhone home-screen app coming back from the background fires this
  // rather than visibilitychange on some versions.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void onFront();
  });
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      updateWorker();
      void check();
    }
  }, EVERY_MS);
}
