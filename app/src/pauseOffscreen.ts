/**
 * Looping animations rest while nobody can see them.
 *
 * A CSS animation that runs for ever (a neon sign humming, a stage's bulbs,
 * the street's day, people walking) keeps the phone drawing frames even
 * scrolled far out of view. Whenever one starts, the section it sits in is
 * watched; while that section is off screen it carries `data-offscreen`, which
 * pauses every animation inside it (styles.css), and they carry on from where
 * they were the moment it scrolls back.
 *
 * Script-driven loops (requestAnimationFrame) watch for themselves - see
 * useOnScreen.
 */
const HOSTS = 'section, article, aside, header, footer, nav, a, li, [data-anim-host]';
/** An attribute rather than a class: React rewrites className, never this. */
const OFFSCREEN = 'data-offscreen';

let watcher: IntersectionObserver | null = null;
const watched = new WeakSet<Element>();

function hostOf(element: Element): Element {
  return element.closest(HOSTS) ?? element;
}

function loops(element: Element): boolean {
  return getComputedStyle(element).animationIterationCount.split(',').some((count) => count.trim() === 'infinite');
}

export function pauseOffscreenAnimations(): void {
  if (watcher || typeof IntersectionObserver === 'undefined') return;
  // A little margin, so an animation is already moving as it scrolls into view.
  watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.target.toggleAttribute(OFFSCREEN, !entry.isIntersecting);
  }, { rootMargin: '80px 0px' });
  const watch = (event: AnimationEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !loops(target)) return;
    const host = hostOf(target);
    if (watched.has(host)) return;
    watched.add(host);
    watcher?.observe(host);
  };
  document.addEventListener('animationstart', watch, true);
}

/** Whether an element is on screen (or near it), for loops driven by script rather than CSS. */
export function watchOnScreen(element: Element, onChange: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  const observer = new IntersectionObserver((entries) => {
    const last = entries[entries.length - 1];
    if (last) onChange(last.isIntersecting);
  }, { rootMargin: '80px 0px' });
  observer.observe(element);
  return () => observer.disconnect();
}
