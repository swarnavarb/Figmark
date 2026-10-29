import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { Icon } from './Icon';

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
 * Back to exactly where you came from - the page, and the spot on it - or to
 * `fallback` when this page was opened directly, from a link or a bookmark.
 *
 * Every back control in the app does this. They used to differ: some went back
 * in history, some opened their section's front page however you had arrived.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return () => (canGoBack() ? navigate(-1) : navigate(fallback));
}

/** Whether there is a screen of this app's to go back to in this tab. */
export function canGoBack(): boolean {
  return indexNow() > 0;
}

/** The same thing under its older name. */
export const useBack = useGoBack;

/**
 * The one back control: a "<" button, and beside it the screen's title or a
 * word on where you are.
 *
 * `title` is the screen's own heading and is drawn as its h1, so a page with a
 * back bar does not repeat its name underneath. `children` is a plain line
 * instead, for a screen whose heading is further down (a hero, a card).
 * `onBack` is for a view inside a page (a lot opened from the list, say),
 * where back means the list rather than the previous address.
 */
export function BackBar({ onBack, title, children, actions, label = 'Back' }: {
  onBack: () => void;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  label?: string;
}) {
  return (
    <div className={`backbar${title ? ' backbar--title' : ''}`}>
      <button type="button" className="backbar__btn" aria-label={label} onClick={onBack}>
        <Icon name="back" size={20} />
      </button>
      {title ? <h1 className="backbar__title">{title}</h1> : children ? <span className="backbar__text">{children}</span> : null}
      {actions && <span className="backbar__actions">{actions}</span>}
    </div>
  );
}

/** A back bar for a page: back where you came from, or `to` when opened directly. */
export function BackLink({ to, title, children, actions }: {
  to: string;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const back = useGoBack(to);
  return <BackBar onBack={back} title={title} actions={actions}>{children}</BackBar>;
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
