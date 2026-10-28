/** Anything on screen that is still standing in for content. */
const PENDING = '.skel, .skel-card, .skel-row, .pskel__slab, .pskel__face, [data-boot-pending]';
/**
 * How long the loading screen waits for the first screen's content. Past this
 * the page's own skeletons take over: they show the shape of what is coming,
 * which a logo cannot, and a page that is drawn but still filling in feels
 * faster than one hidden behind a veil.
 */
const HOLD_MS = 2500;
/** If the stylesheet never arrives, the page is not held hostage past this. */
const LONGEST_MS = 8000;
/** A screen can hand over from one placeholder to the next with a frame of nothing between. */
const SETTLE_MS = 160;

/**
 * Whether the app's stylesheet is in. index.html loads it without blocking the
 * first paint (see app/vite.config.ts), so the loading screen can show while
 * it downloads; the screen must not lift onto a page without its styles.
 */
function styled(): boolean {
  return [...document.querySelectorAll<HTMLLinkElement>('link[data-fm-css]')].every((link) => link.sheet !== null);
}

function waiting(): boolean {
  // Before React's first commit there is nothing to judge yet.
  if (!document.getElementById('root')?.firstElementChild) return true;
  const height = window.innerHeight;
  for (const element of document.querySelectorAll(PENDING)) {
    const box = element.getBoundingClientRect();
    // Only what can be seen: a "loading more" row far below the fold is not
    // the first screen waiting.
    if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < height) return true;
  }
  return false;
}

/** Turn on the stylesheet index.html fetched without letting it block the first paint. */
export function applyDeferredStyles(): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[data-fm-css]')) link.media = 'all';
}

/**
 * Take the loading screen from index.html away once the first screen is drawn
 * with its content, or after HOLD_MS with its skeletons. `then` runs once it
 * has gone.
 *
 * Without this a refresh showed two loaders in a row: this screen while the
 * app started, then the page's own skeleton while its data arrived. Now a
 * quick page arrives whole, and a slow one shows its skeleton rather than a
 * logo for seconds on end.
 */
export function liftBootScreen(then?: () => void): void {
  const veil = document.getElementById('boot');
  if (!veil) {
    then?.();
    return;
  }
  const started = performance.now();
  let timer = 0;
  let done = false;

  const lift = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    veil.classList.add('boot--out');
    window.setTimeout(() => {
      veil.remove();
      then?.();
    }, 400);
  };
  const ready = () => {
    if (!styled()) return false;
    if (!document.getElementById('root')?.firstElementChild) return false;
    return performance.now() - started > HOLD_MS || !waiting();
  };
  const check = () => {
    window.clearTimeout(timer);
    if (performance.now() - started > LONGEST_MS) return lift();
    timer = window.setTimeout(() => (ready() ? lift() : check()), ready() ? SETTLE_MS : 120);
  };

  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[data-fm-css]')) link.addEventListener('load', check);
  window.setTimeout(lift, LONGEST_MS);
  check();
}
