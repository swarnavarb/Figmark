import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

/**
 * Where the page is scrolled to, per history entry.
 *
 * Going back returns to exactly where you were, and opening something new
 * starts at its top. The browser's own restoring cannot do the first: pages
 * here load their content after they open, so by the time the browser tries,
 * the page is too short to scroll to the old spot. So this remembers the spot
 * itself and keeps trying while the content arrives, and gives up the moment
 * you scroll yourself.
 */

const STORAGE_KEY = 'figmark:scroll';

/** Which address each history entry holds, by its place in the history. */
const entries = new Map<number, string>();
const indexNow = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;

/**
 * A back button for a screen with a known parent.
 *
 * When that parent is the page you came from, this goes back in history - so
 * it lands where you were on it - rather than opening a fresh copy at the top.
 * Opened from anywhere else, it opens the parent.
 */
export function useBack(parent: string) {
  const navigate = useNavigate();
  return () => {
    const index = indexNow();
    if (index > 0 && entries.get(index - 1) === parent) navigate(-1);
    else navigate(parent);
  };
}

/**
 * Back to exactly where you came from - the page, and the spot on it -
 * or to `fallback` when this page was opened directly.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return () => (indexNow() > 0 ? navigate(-1) : navigate(fallback));
}

/** A "← Parent" link that goes back to the spot you left, when it can. */
export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  const back = useBack(to);
  return <button type="button" className="backlink" onClick={back}>{children}</button>;
}

/**
 * Scroll so an element sits at the top of the screen, just under the app's
 * sticky header - for a screen that opens inside a page, whose "top" is its
 * own back button rather than the page's header.
 */
export function scrollToTopOf(element: Element | null) {
  if (!element) return;
  const header = document.querySelector('.nav')?.getBoundingClientRect().height ?? 0;
  const top = element.getBoundingClientRect().top + window.scrollY - header - 8;
  window.scrollTo(0, Math.max(0, top));
}

const GIVE_UP_MS = 5000;

function readSaved(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function writeSaved(saved: Record<string, number>) {
  try {
    // Only the most recent entries are worth keeping.
    const keys = Object.keys(saved);
    for (const key of keys.slice(0, Math.max(0, keys.length - 60))) delete saved[key];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* A private window: positions last only for this page load. */
  }
}

export function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const saved = useRef<Record<string, number>>(readSaved());
  const keyRef = useRef(location.key);
  const pathRef = useRef(location.pathname);
  const restoring = useRef<(() => void) | null>(null);

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    let frame = 0;
    const onScroll = () => {
      if (restoring.current || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        saved.current[keyRef.current] = window.scrollY;
      });
    };
    const persist = () => writeSaved(saved.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persist);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', persist);
      cancelAnimationFrame(frame);
      persist();
    };
  }, []);

  // Before paint, so a new page never flashes at the old page's position.
  useLayoutEffect(() => {
    entries.set(indexNow(), `${location.pathname}${location.search}`);
    if (keyRef.current === location.key) return;
    saved.current[keyRef.current] = saved.current[keyRef.current] ?? window.scrollY;
    const samePage = pathRef.current === location.pathname;
    keyRef.current = location.key;
    pathRef.current = location.pathname;
    writeSaved(saved.current);
    restoring.current?.();

    if (navigationType !== 'POP') {
      // A new page opens at its top. A tab or filter change on the same page
      // leaves the page where it is - the page decides that for itself.
      if (!samePage) window.scrollTo(0, 0);
      return;
    }

    const target = saved.current[location.key] ?? 0;
    const started = Date.now();
    let frame = 0;
    const stop = () => {
      cancelAnimationFrame(frame);
      for (const kind of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) window.removeEventListener(kind, stop);
      restoring.current = null;
    };
    const attempt = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) <= 1 || Date.now() - started > GIVE_UP_MS) {
        stop();
        return;
      }
      frame = requestAnimationFrame(attempt);
    };
    for (const kind of ['wheel', 'touchstart', 'keydown', 'mousedown'] as const) {
      window.addEventListener(kind, stop, { passive: true, once: true });
    }
    restoring.current = stop;
    attempt();
  }, [location.key, location.pathname, location.search, navigationType]);

  return null;
}
