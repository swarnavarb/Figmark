/**
 * The loading mark, styled by public/boot/loader.css so the copy in
 * index.html can paint before any script arrives.
 */
export function Preloader({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? 'fmload fmload--sm' : 'fmload'} role="status" aria-label="Loading">
      <div className="fmload__orbit" aria-hidden="true"><i /><i /><i /></div>
      <div className="fmload__ring" aria-hidden="true" />
      <div className="fmload__mark" aria-hidden="true" />
    </div>
  );
}

/** Anything on screen that is still standing in for content. */
const PENDING = '.skel, .skel-card, .skel-row, .pskel__slab, .pskel__face, [data-boot-pending]';
/** However long the first screen takes, the page is not held hostage past this. */
const LONGEST_MS = 8000;
/** A screen can hand over from one placeholder to the next with a frame of nothing between. */
const SETTLE_MS = 160;

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

/**
 * Take the loading screen from index.html away once the first screen is drawn
 * with its content.
 *
 * Without this a refresh showed two loaders in a row: this screen while the
 * app started, then the page's own skeleton while its data arrived. Now the
 * skeleton happens underneath, and only moving between screens shows one.
 */
export function liftBootScreen(): void {
  const veil = document.getElementById('boot');
  if (!veil) return;
  const started = performance.now();
  let timer = 0;
  let done = false;

  const lift = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    veil.classList.add('boot--out');
    window.setTimeout(() => veil.remove(), 400);
  };
  const check = () => {
    window.clearTimeout(timer);
    if (performance.now() - started > LONGEST_MS) return lift();
    timer = window.setTimeout(() => (waiting() ? check() : lift()), waiting() ? 120 : SETTLE_MS);
  };

  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.setTimeout(lift, LONGEST_MS);
  check();
}
